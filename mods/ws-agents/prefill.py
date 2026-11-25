#!/usr/bin/env python3
"""Pre-fills a live Herdr terminal's prompt without pressing Enter.

Usage:
  prefill.py <address> <text>

Reads the terminal's current size (`hc get <address> --json`), attaches a PTY of
the exact same size (`hc attach <address>`), sends each line as short bracketed
paste chunks separated by Ctrl-J (LF) so TUIs like Claude Code show the text
inline instead of collapsing it into `[Pasted text #1 +N lines]`, and detaches
with Ctrl-\\ so the user's clipboard and pane size are left untouched.
"""
import fcntl
import json
import os
import pty
import re
import select
import shutil
import struct
import subprocess
import sys
import termios
import time


def find_hc():
    found = shutil.which("hc")
    if found:
        return found
    home = os.path.expanduser("~")
    for cand in (
        "/opt/homebrew/bin/hc",
        "/usr/local/bin/hc",
        os.path.join(home, ".local", "bin", "hc"),
        os.path.join(home, ".cargo", "bin", "hc"),
    ):
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return "hc"


def sanitize(text):
    # Normalize CRLF/CR to LF and strip control chars (including ESC and Ctrl-\)
    # so bracketed paste cannot be broken out of or trigger hc attach's detach key.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)


def drain(fd, quiet_s=0.15, max_s=1.2):
    deadline = time.monotonic() + max_s
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            return
        r, _, _ = select.select([fd], [], [], min(quiet_s, left))
        if not r:
            return
        try:
            if not os.read(fd, 65536):
                return
        except OSError:
            return


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("usage: prefill.py <address> <text>\n")
        return 2
    addr = sys.argv[1]
    text = sanitize(sys.argv[2])
    if not text:
        return 0

    hc = find_hc()
    got = subprocess.run([hc, "get", addr, "--json"], capture_output=True, text=True)
    if got.returncode != 0:
        sys.stderr.write((got.stderr or got.stdout or "hc get failed").strip() + "\n")
        return 1
    try:
        info = json.loads(got.stdout)
    except Exception as e:
        sys.stderr.write(f"bad hc get output: {e}\n")
        return 1
    if info.get("state") != "live":
        sys.stderr.write("terminal is not live\n")
        return 1

    rows = int(info.get("rows") or 35)
    cols = int(info.get("cols") or 120)

    master, slave = pty.openpty()
    proc = None
    try:
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        proc = subprocess.Popen(
            [hc, "attach", addr],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True,
        )
        os.close(slave)
        slave = -1

        drain(master, quiet_s=0.18, max_s=1.5)
        if proc.poll() is not None:
            sys.stderr.write("hc attach ended before paste\n")
            return 1

        # Send one line at a time (in <=160-char bracketed-paste pieces) separated by
        # Ctrl-J (LF), so Claude Code / Codex / Agy / Pi display the text inline
        # instead of collapsing a multi-line paste into `[Pasted text #1 +N lines]`.
        lines = text.split("\n")
        piece = 160
        for idx, line in enumerate(lines):
            if line:
                for i in range(0, len(line), piece):
                    chunk = line[i : i + piece].encode("utf-8")
                    os.write(master, b"\x1b[200~" + chunk + b"\x1b[201~")
                    drain(master, quiet_s=0.04, max_s=0.1)
            if idx < len(lines) - 1:
                os.write(master, b"\n")
                drain(master, quiet_s=0.04, max_s=0.1)

        drain(master, quiet_s=0.2, max_s=0.5)
        os.write(master, b"\x1c")  # Ctrl-\ detaches hc attach
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
        return 0
    finally:
        if slave >= 0:
            try:
                os.close(slave)
            except OSError:
                pass
        try:
            os.close(master)
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())

// The bell's log, kept by the switcher's sidebar copy: ~/.herdr/notifications.json (what was read or
// dismissed, and the events only a toast said; notif.js has the rules), mirrored in shared
// "workspaces.notifications.store", and the bell's count in "workspaces.notifications.badge".
//
// It takes:
//   workspaces.notifications.act   [{ id, action, item?, items?, target?, group?, at }]: the list
//                                  (ws-notifications) asks: open (go there; an update is read),
//                                  dismiss, markAllRead, clearRead
//   workspaces.notifications.push  [{ id, title, body, level, action, at }]: every toast ws-toast showed
// and the background runner's notes (record(), from main.js notes(), before many become one toast).
// Notifications off in Settings > Features: nothing is logged or written, and the count is 0.
// The first time (no file yet), what's in the list then counts as read: the bell starts caught up.

import { home, readTextFile, writeTextFile, shared, setShared, agents, terminals, spaces, checking } from "herdr";
import {
  NOTIF_FILE, ACT_KEY, PUSH_KEY, STORE_KEY, BADGE_KEY, emptyStore, parseStore, pruneStore, mergeStore, markRead, markAllRead,
  dismissItem, clearRead, appendEvent, forgetEpisodes, classifyToast, buildItems, badgeOf, hasMultiWs, panelHeight, drainQueue,
} from "./notif.js";

// A toast waits this long for the switcher (a hidden sidebar unloads it) before it's dropped.
export const PUSH_TTL = 10 * 60e3;

const on = () => shared("workspaces.settings")?.features?.notifications !== false;

export class NotifLog {
  // open(target, cx): goes to an item's thing (main.js openNotification()).
  constructor(open) {
    this.open = open;
    this.store = emptyStore();
    this.text = undefined;  // the file as last read or written (null: not there)
    this.loaded = false;
    this.fresh = false;     // no file at the first read: what's listed then starts read
    this.waiting = [];      // events from before the file was read
    this.live = {};         // item id -> when it was first listed (what has no time of its own)
    this.dirty = false;
    this.writing = false;
    const now = Date.now();
    // What the list asked before this copy started was for an earlier one (an old "open" mustn't
    // happen late). Toasts shown before it started are taken (at most PUSH_TTL old; appendEvent
    // drops one already logged).
    this.actSeen = drainQueue(shared(ACT_KEY), [], now).seen;
    this.pushSeen = [];
    this.said = null;       // the store and badge as last published (text)
  }

  file() { return `${home()}/${NOTIF_FILE}`; }

  async load() {
    const text = await readTextFile(this.file()).catch(() => null);
    this.text = text;
    this.fresh = text == null;
    let s = pruneStore(parseStore(text), Date.now());
    for (const ev of this.waiting) s = appendEvent(s, ev, Date.now());
    this.waiting = [];
    this.store = s;
    this.loaded = true;
  }

  // A toast or a runner's note: logged when it's one worth keeping.
  record(toast) {
    if (!on()) return;
    const ev = classifyToast(toast);
    if (!ev) return;
    if (!this.loaded) { this.waiting.push(ev); return; }
    const next = appendEvent(this.store, ev, Date.now());
    if (next !== this.store) { this.store = next; this.save(); }
  }

  // The list as live state and the log give it now.
  items(now = Date.now()) {
    return buildItems({
      agents: agents(), terminals: terminals(), spaces: spaces(),
      defs: shared("workspaces.defs") ?? [], assigned: shared("workspaces.assigned") ?? {},
      runs: shared("workspaces.automation.runs") ?? [], automations: shared("workspaces.automations") ?? {},
      prs: shared("workspaces.prs") ?? null, store: { ...this.store, live: this.live },
      features: shared("workspaces.settings")?.features ?? {}, now,
    });
  }

  // Every 100 ms: the list's asks and the toasts shown since.
  drain(cx) {
    if (!this.loaded) return;
    const now = Date.now();
    let s = this.store;
    const acts = drainQueue(shared(ACT_KEY), this.actSeen, now);
    this.actSeen = acts.seen;
    for (const a of acts.run) {
      const ids = Array.isArray(a.items) ? a.items.filter((x) => typeof x === "string") : [];
      if (a.action === "open") {
        if (a.group === "updates" && typeof a.item === "string") s = markRead(s, a.item, now);
        try { this.open(a.target ?? null, cx); } catch (e) { console.log(`ws-switcher: couldn't open a notification: ${e?.message ?? e}`); }
      } else if (a.action === "markRead" && typeof a.item === "string") s = markRead(s, a.item, now);
      else if (a.action === "markAllRead") s = markAllRead(s, ids, now);
      else if (a.action === "dismiss" && typeof a.item === "string") s = dismissItem(s, a.item, now);
      else if (a.action === "clearRead") s = clearRead(s, ids, now);
    }
    const pushed = drainQueue(shared(PUSH_KEY), this.pushSeen, now, PUSH_TTL);
    this.pushSeen = pushed.seen;
    if (on()) for (const p of pushed.run) { const ev = classifyToast(p); if (ev) s = appendEvent(s, ev, now); }
    if (s !== this.store) { this.store = s; this.save(); this.publish(); }
  }

  // Every 500 ms: what's listed now (first-seen times), the mirror and the count.
  tick() {
    if (!this.loaded) return;
    const now = Date.now();
    const off = !on();
    // A finished agent that's working or idle again: its next finish is news.
    const fresh = forgetEpisodes(this.store, agents());
    if (fresh !== this.store) { this.store = fresh; this.save(); }
    let items = off ? [] : this.items(now);
    const live = {};
    for (const it of items) live[it.id] = this.live[it.id] ?? now;
    this.live = live;
    // The first run: what's there already isn't news.
    if (this.fresh && !off) {
      this.fresh = false;
      const old = items.filter((x) => x.group === "updates" && x.unread).map((x) => x.id);
      if (old.length) { this.store = markAllRead(this.store, old, now); items = this.items(now); }
      this.save();
    }
    this.publish(items);
  }

  publish(items = null) {
    const off = !on();
    const list = off ? [] : items ?? this.items();
    const b = badgeOf(list);
    const badge = { count: b.count, tone: b.tone, needs: b.needs, unread: b.unread, height: panelHeight(list, { multiWs: hasMultiWs(list, shared("workspaces.active") ?? null) }) };
    const store = { ...this.store, live: this.live };
    const text = JSON.stringify([store, badge]);
    if (text === this.said) return;
    this.said = text;
    if (JSON.stringify(store) !== JSON.stringify(shared(STORE_KEY) ?? null)) setShared(STORE_KEY, store);
    if (JSON.stringify(badge) !== JSON.stringify(shared(BADGE_KEY) ?? null)) setShared(BADGE_KEY, badge);
  }

  // The file: written when the log changes (never during a check, never while Notifications is off).
  // Only when it's still what was last read or written; else the two are merged and tried again.
  save() {
    if (checking() || !on() || !this.loaded) return;
    this.dirty = true;
    if (this.writing) return;
    this.writing = true;
    (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          this.store = pruneStore(this.store, Date.now());
          for (let i = 0; i < 3; i++) {
            const text = JSON.stringify(this.store);
            if (text === this.text) break;
            try { await writeTextFile(this.file(), text, this.text ?? null); this.text = text; break; }
            catch {
              const cur = await readTextFile(this.file()).catch(() => null);
              this.text = cur;
              if (cur != null) this.store = mergeStore(this.store, parseStore(cur));
            }
          }
        }
      } catch (e) { console.log(`ws-switcher: couldn't write the notifications log: ${e?.message ?? e}`); }
      this.writing = false;
    })();
  }
}

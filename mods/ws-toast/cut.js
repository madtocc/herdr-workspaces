// The toast's body, cut to what two lines hold (no imports, so node can test it). GPUI can't clamp a
// wrapped text to two lines, so the body box is two lines tall (overflow hidden) and the text is cut
// here first, at a word, with "…", so a long body ends in "…" on its second line.
// About 40 characters of 12px text fit a line of the toast's 268px; two lines, with what wrapping
// at words loses, take 80.
export const BODY_MAX = 80;
export function twoLines(text, max = BODY_MAX) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  // Counted in characters (code points), so an emoji is never cut in half.
  const chars = [...s];
  if (chars.length <= max) return s;
  const cut = chars.slice(0, max - 1).join("");
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:·-]+$/, "")}…`;
}

// The side panel's width against the room it has. No imports, so `node` can test it.
//
// Herdr gives a block with a px width that width first and the terminals what's left,
// and keeps the width through any window size: a panel widened in a big window covers
// the terminals in a smaller one.

// The least the terminals keep beside the panel, in the layout's px (before zoom), when
// the layout's `main` block doesn't say (its `min`, which also stops a drag there).
export const KEEP = 400;

// px: the panel's width now. room: what the panel and the terminals share. min: the
// panel's own least. keep: the terminals' least. held: { want, set } while this has narrowed the panel (want: the
// width it had, set: the one it got), null when it hasn't or the person has dragged it
// since. Returns { px, held }: the width to set (null: leave it) and what to remember.
// A narrowed panel grows back to `want` as the room returns.
export function fit(px, room, min, held, keep = KEEP) {
  const most = Math.max(min, Math.floor(room - keep));
  const ours = Boolean(held) && held.set === px;
  if (px > most) return { px: most, held: { want: ours ? held.want : px, set: most } };
  if (!ours) return { px: null, held: null };
  const back = Math.min(held.want, most);
  if (back <= px) return { px: null, held };
  return { px: back, held: back === held.want ? null : { want: held.want, set: back } };
}

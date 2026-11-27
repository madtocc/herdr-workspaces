// What a space's row is called, from Herdr 0.1.18's spaces (`repoName()`, `EMOJI`, `spaceAvatar()` and
// the name less its emoji that `gitTail()` compares with). No imports, so a unit check can load it.

const base = (path) => path.replace(/\/+$/, "").split("/").pop();

// A repo's name from its git folder: the folder holding .git, a bare repo's own
// name, or the folder holding a hidden bare repo (<project>/.bare).
export const repoName = (common) => {
  if (common.endsWith("/.git")) return base(common.slice(0, -5));
  const own = base(common);
  return own === ".bare" ? base(common.slice(0, -own.length - 1)) : own.replace(/\.git$/, "");
};

// Keep the whole leading emoji in the avatar (same rule in spaces and picker).
// Newer pictographs such as 🖥 may be drawn as emoji without VS16. A trailing
// selector, modifier or joiner can signal that we matched only part of a glyph.
export const EMOJI = /^(?:[#*0-9]️?⃣|\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|(?=[\u{1F000}-\u{1FFFF}])\p{Extended_Pictographic}|\p{Extended_Pictographic}(?=️)|\p{Emoji_Modifier_Base}(?=\p{Emoji_Modifier}))️?[\p{Emoji_Modifier}\u{E0020}-\u{E007F}]*(?:‍\p{Extended_Pictographic}️?\p{Emoji_Modifier}?)*)(?![\p{Grapheme_Extend}\p{Emoji_Modifier}‍])/u;
export function spaceAvatar(name) {
  return EMOJI.exec(name)?.[0] ?? ([...name][0]?.toUpperCase() ?? "?");
}

// The git tail's test: a branch or repo the name already says ("🚀 api" on branch api).
export function sameAsName(name) {
  const full = name.toLowerCase();
  const emoji = EMOJI.exec(name)?.[0];
  const label = emoji ? name.slice(emoji.length).trim().toLowerCase() : full;
  return (a) => { const text = a.toLowerCase(); return text === full || text === label; };
}

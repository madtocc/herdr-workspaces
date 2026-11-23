// The sidebar footer's rows as rules with no imports, so node can test them: which rows
// it shows, and what height to ask for its block (main.js: fitFooter()) so a row turned
// off leaves no hole.
//
// The layout file says how tall the footer is with every row shown (`sidebar-footer`'s px
// in layouts/<name>.json); this never decides that. With rows hidden the block is asked to
// be that less a row's height for each one, and with every row shown, that.

// Every row, top to bottom; `feature`: its add-on's key in Settings > Features (the row
// is shown while that's on). Presets, Settings and Add machine are always there. History,
// once the first row, opens from the tab bar's Views menu now.
export const ROWS = [
  { id: "automations", feature: "automations" },
  { id: "presets" },
  { id: "settings" },
  { id: "machine" },
];
export const ROW = 28; // a row's height, px (main.js draws them at this)
export const FOOTER = "sidebar-footer"; // the footer's block id in the layout

// The rows shown, by id, for `on(key)`: whether that add-on is on.
export const footerRows = (on) => ROWS.filter((r) => !r.feature || on(r.feature)).map((r) => r.id);

// The footer block's px in a layout file's text, or null: no such file, not JSON, no
// footer block, or one not sized in px (then the block is left alone).
export function footerPx(text) {
  let tree = null;
  try { tree = JSON.parse(String(text ?? "")); } catch { return null; }
  const find = (n) => {
    if (!n || typeof n !== "object") return null;
    if (n.id === FOOTER) return n;
    for (const c of Array.isArray(n.children) ? n.children : []) {
      const got = find(c);
      if (got) return got;
    }
    return null;
  };
  const px = find(tree)?.size?.px;
  return typeof px === "number" && px > 0 ? px : null;
}

// The px to ask for with `hidden` rows left out, from the file's px (null: leave it alone).
export const footerWant = (filePx, hidden) => (filePx ? Math.max(ROW, filePx - ROW * Math.max(0, hidden)) : null);

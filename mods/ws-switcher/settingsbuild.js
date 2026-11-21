// ws-settings' main.js, built from Herdr's own Settings window so the package's Extras can be a
// section of it. Herdr's window is its bundled mod frame-settings (frame/settings/main.js under
// the app home), rewritten at every start, with a fixed list of sections; a mod can't add one.
// So ws-settings is a copy of it with a few small patches, rebuilt by the switcher's sidebar copy
// whenever Herdr's file changes (main.js: settingsCopy()), so Herdr's own sections stay current.
// When Herdr changed the file so that a patch no longer finds its place, the copy is the fallback
// instead: a window with only the Extras section and a button to Herdr's Settings.
//
// No imports, so node can test it: buildSettings(source, meta) -> { ok, text, why }.

export const SOURCE = "frame/settings/main.js"; // under the app home: Herdr's Settings window
export const TARGET = "mods/ws-settings/main.js"; // under the app home: ours
export const EXTRAS = "./extras.js"; // the Extras page, beside ws-settings' main.js

// FNV-1a over the text: which source a copy was built from (not for security).
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Names the patches add at the top level of Herdr's file: none may be there already.
const OURS = ["extrasPage", "extrasInit", "askedSection", "EXTRAS_SECTION", "HERDR_SECTIONS"];

const count = (text, piece) => text.split(piece).length - 1;

function header(meta, from, note) {
  return `// GENERATED: don't edit. ws-settings is Herdr's Settings window (its bundled mod frame-settings,
// ${SOURCE}) with the Workspaces package's Extras as one more section (extras.js).
// Written by the ws-switcher mod (settingsbuild.js) from Herdr ${meta.version || "(unknown version)"}'s file, ${from}.
// ${note}
`;
}

// Each patch finds its place exactly once, or the build stops with why.
function patch(source) {
  let s = source;
  const fail = (why) => ({ ok: false, why });

  if (/\bfrom\s*["']\.\.?\//.test(s) || /\bimport\s*\(\s*["']\.\.?\//.test(s)) return fail("it imports files of its own folder, which a copy can't reach");
  const taken = OURS.find((n) => new RegExp(`\\b${n}\\b`).test(s));
  if (taken) return fail(`it already uses the name ${taken}`);

  // 1. Icons: Herdr's stay frame/settings/<name>.svg; a full path (ours) is used as it is.
  const icon = "const I = (name) => `frame/settings/${name}.svg`;";
  if (count(s, icon) !== 1) return fail("its icon helper I() isn't the one this copy knows");
  s = s.replace(icon, "const I = (name) => (name.includes(\"/\") ? name : `frame/settings/${name}.svg`);");

  // 2. The sections: Herdr's list, then Extras.
  const start = "const SECTIONS = [";
  if (count(s, start) !== 1) return fail("its list of sections (SECTIONS) isn't where this copy looks");
  const at = s.indexOf(start);
  const end = s.indexOf("\n];", at);
  if (end < 0) return fail("its list of sections (SECTIONS) doesn't end where this copy looks");
  const list = s.slice(at + start.length - 1, end + 3);
  if (count(list, "[") !== count(list, "]")) return fail("its list of sections (SECTIONS) isn't one this copy can follow");
  s = `${s.slice(0, at)}const HERDR_SECTIONS = [${s.slice(at + start.length, end + 3)}\nconst SECTIONS = [...HERDR_SECTIONS, EXTRAS_SECTION];${s.slice(end + 3)}`;

  // 3. The section to open: Herdr's props (app.settings), else the one asked for through shared state.
  const asked = "const asked = props()?.section;";
  if (count(s, asked) !== 1) return fail("the section it opens on isn't read where this copy looks");
  s = s.replace(asked, "const asked = props()?.section ?? askedSection();");

  // 4. The body: the Extras page for its section, else Herdr's pages.
  const pages = s.match(/this\.section === "look"(\s*)\?/g) ?? [];
  if (pages.length !== 1) return fail("the body that picks a section's page isn't the one this copy knows");
  s = s.replace(/this\.section === "look"(\s*)\?/, (_m, ws) => `this.section === "extras"${ws}? extrasPage(this)${ws}: this.section === "look"${ws}?`);

  // 5. The Extras page's own state, set up after Herdr's init.
  const cls = s.match(/^export default class (\w+) extends View \{/gm) ?? [];
  if (cls.length !== 1) return fail("its window class isn't declared the way this copy knows");
  const name = cls[0].match(/class (\w+)/)[1];
  if (!/^ {2}init\(/m.test(s)) return fail("its window has no init() this copy can follow");
  s = `${s.replace(/\s*$/, "")}

// ws-settings: the Extras page's state, read once the window has set up its own.
{
  const herdrInit = ${name}.prototype.init;
  ${name}.prototype.init = function (p, cx) {
    herdrInit.call(this, p, cx);
    extrasInit(this, cx);
  };
}
`;
  return { ok: true, text: `import { extrasPage, extrasInit, askedSection, EXTRAS_SECTION } from "${EXTRAS}";\n${s}` };
}

// The window when Herdr's can't be followed: Extras alone, and a way to Herdr's own Settings.
function fallback() {
  return `import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme, run, props, closeOverlay } from "herdr";
import { extrasPage, extrasInit } from "${EXTRAS}";

export default class Settings extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    extrasInit(this, cx);
  }

  render(cx) {
    const t = theme();
    const herdrs = () => { closeOverlay(props()?.overlay); run("app.settings"); };
    return v_flex().id("settings").track_focus(this.handle).w_full().h(620).min_h(0)
      .on_key_down((e, cx) => { if (e.key !== "escape") return; closeOverlay(props()?.overlay); cx.stop_propagation(); })
      .child(h_flex().flex_none().gap(16).px(28).py(14).items_center().border_b(1).border_color(t.border)
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().text_size(16).font_semibold().text_color(t.foreground).child("Settings"))
          .child(div().text_size(12.5).line_height("18px").text_color(t.dim)
            .child("Herdr's Settings changed in a way this copy can't follow yet, so here are only the package's settings.")))
        .child(div().id("st-herdr").flex_none().px(12).py(5).rounded(7).border_1().border_color(t.border).bg(t.raised).cursor_pointer()
          .text_size(13).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(herdrs).child("Open Herdr's Settings")))
      .child(div().relative().flex_1().min_h(0).w_full()
        .child(div().id("st-body").size_full().overflow_y_scroll().child(div().px(28).py(22).child(extrasPage(this))))
        .child(Scrollbar.vertical("st-body").mode("always").absolute().inset_0()));
  }
}
`;
}

// The text of ws-settings' main.js for Herdr's Settings source (null: there's none).
// meta: { version } (Herdr's, for the header). ok false: the fallback, and why.
export function buildSettings(source, meta = {}) {
  if (typeof source !== "string" || !source.trim()) {
    const why = `Herdr has no ${SOURCE}`;
    return { ok: false, why, text: header(meta, "(none found)", `Fallback: ${why}.`) + fallback() };
  }
  const from = `source ${hash(source)}`;
  const r = patch(source);
  if (r.ok) return { ok: true, why: null, text: header(meta, from, "Patches: icons by full path, Extras after Herdr's sections, a section asked through shared state, its page, its init.") + r.text };
  return { ok: false, why: r.why, text: header(meta, from, `Fallback: ${r.why}.`) + fallback() };
}

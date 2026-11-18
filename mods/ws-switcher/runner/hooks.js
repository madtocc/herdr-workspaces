// @ts-nocheck
// Lets Node load the mod's own files: their `import … from "herdr"` and
// `"fs/promises"` get the runner's stand-ins (herdr.js, fs.js).
const HERDR = new URL("./herdr.js", import.meta.url).href;
const FS = new URL("./fs.js", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "herdr") return { url: HERDR, shortCircuit: true };
  if (specifier === "fs/promises" && context.parentURL && context.parentURL !== FS && context.parentURL !== HERDR) return { url: FS, shortCircuit: true };
  return next(specifier, context);
}

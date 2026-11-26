// @ts-nocheck
// Lets Node load the mod's own files: their `import … from "herdr"` and
// `"fs/promises"` get the runner's stand-ins (herdr.js, fs.js).
const HERDR = new URL("./herdr.js", import.meta.url).href;
const FS = new URL("./fs.js", import.meta.url).href;

// The stand-in for a specifier, or null for Node's own answer.
function standIn(specifier, context) {
  if (specifier === "herdr") return { url: HERDR, shortCircuit: true };
  if (specifier === "fs/promises" && context.parentURL && context.parentURL !== FS && context.parentURL !== HERDR) return { url: FS, shortCircuit: true };
  return null;
}

// module.registerHooks (synchronous).
export function resolveWith(specifier, context, next) {
  return standIn(specifier, context) ?? next(specifier, context);
}

// module.register (a loader thread).
export async function resolve(specifier, context, next) {
  return standIn(specifier, context) ?? next(specifier, context);
}

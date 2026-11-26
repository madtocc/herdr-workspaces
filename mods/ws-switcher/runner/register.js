// @ts-nocheck
// The runner's stand-ins for "herdr" and "fs/promises" (hooks.js). Node 22.15+ has registerHooks,
// in this thread; older ones (20.6+) the module.register() newer ones warn about.
import * as mod from "node:module";
import { resolveWith } from "./hooks.js";

if (typeof mod.registerHooks === "function") mod.registerHooks({ resolve: resolveWith });
else mod.register("./hooks.js", import.meta.url);

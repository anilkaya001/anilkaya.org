import vm from "node:vm";
import { readFileSync } from "node:fs";

const JS = new URL("../../assets/js/", import.meta.url);

export function bootUI(patches = [], file = "flows-ui.js") {
  const proxy = new Proxy(function () {}, { get: () => proxy, apply: () => proxy });
  const win = { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), addEventListener() {}, location: { pathname: "/flows/" } };
  const ctx = {
    window: win,
    document: { getElementById: () => null, documentElement: {}, addEventListener() {}, styleSheets: [], createElement: () => ({ getContext: () => proxy, style: {}, width: 0, height: 0 }) },
    Intl, console, setTimeout, clearTimeout, requestAnimationFrame: (f) => f(), navigator: {}, performance: { now: () => 0 }, BigInt,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  win.window = win;
  Object.assign(win, ctx);
  vm.createContext(ctx);
  let text = readFileSync(new URL(file, JS), "utf8");
  for (const [from, to] of patches) {
    if (text.split(from).length !== 2) throw new Error("mutant anchor must occur exactly once in " + file + ": " + from.slice(0, 70));
    text = text.replace(from, to);
  }
  vm.runInContext('"use strict";\n' + text, ctx);
  return ctx.window.FlowsUI;
}

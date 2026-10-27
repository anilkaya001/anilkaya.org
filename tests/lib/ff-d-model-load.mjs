import vm from "node:vm";
import { readFileSync } from "node:fs";
import { bootUI } from "./ui-boot.mjs";
import { fireRegistry } from "../../shared/ff-pages-fire.js";

const JS = new URL("../../assets/js/", import.meta.url);

export function loadModel(patches = [], registry = fireRegistry()) {
  const ui = bootUI();
  const win = { FlowsUI: Object.freeze({ F: ui.F }) };
  const ctx = { window: win, document: {}, Math, Number, JSON, Object, Array, String, Set, RegExp, isFinite };
  vm.createContext(ctx);
  let text = readFileSync(new URL("flows-ff-composer.js", JS), "utf8");
  for (const [from, to] of patches) {
    if (text.split(from).length !== 2) throw new Error("plant anchor must occur exactly once: " + from.slice(0, 80));
    text = text.replace(from, to);
  }
  vm.runInContext(text, ctx);
  return { model: win.FlowsUI.ffFire.composer.createModel(registry, ui.F), composer: win.FlowsUI.ffFire.composer, registry };
}

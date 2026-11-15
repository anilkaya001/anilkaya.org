import vm from "node:vm";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);

function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (q === "`" && src[j] === "$" && src[j + 1] === "{") { j = balance(src, j + 1) ; continue; }
    if (src[j] === q) return j;
  }
  throw new Error("unterminated string at " + i);
}

function balance(src, i) {
  const open = src[i], close = { "{": "}", "(": ")", "[": "]" }[open];
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === "`") { j = skipString(src, j); continue; }
    if (c === "/" && src[j + 1] === "/") { j = src.indexOf("\n", j); continue; }
    if (c === "/" && /[(,=:!&|?{};+\-*%<>~^]\s*$/.test(src.slice(Math.max(0, j - 40), j))) {
      for (let k = j + 1; k < src.length; k++) {
        if (src[k] === "\\") { k++; continue; }
        if (src[k] === "[") { for (k++; src[k] !== "]"; k++) if (src[k] === "\\") k++; continue; }
        if (src[k] === "/") { j = k; break; }
      }
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j;
  }
  throw new Error("unbalanced from " + i);
}

export function sliceDecl(src, name) {
  const fn = new RegExp("\\n(\\s*)function " + name + "\\s*\\(").exec(src);
  if (fn) {
    const start = fn.index + 1;
    const paren = fn.index + fn[0].length - 1;
    const bodyAt = src.indexOf("{", balance(src, paren));
    return src.slice(start, balance(src, bodyAt) + 1);
  }
  const cn = new RegExp("\\n(\\s*)const " + name + " = ").exec(src);
  if (!cn) throw new Error("no declaration of " + name);
  const start = cn.index + 1;
  let j = cn.index + cn[0].length;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === "`") { j = skipString(src, j); continue; }
    if (c === "(" || c === "{" || c === "[") { j = balance(src, j); continue; }
    if (c === ";") return src.slice(start, j + 1);
  }
  throw new Error("unterminated declaration " + name);
}

export function pageSource(rel, patches = []) {
  let text = readFileSync(new URL(rel, ROOT), "utf8");
  for (const [from, to] of patches) {
    if (text.split(from).length !== 2) throw new Error("planted build anchor must occur exactly once in " + rel + ": " + from.slice(0, 80));
    text = text.replace(from, () => to);
  }
  return text;
}

export function pagePick(rel, names, globals = {}, patches = []) {
  const src = pageSource(rel, patches);
  const code = '"use strict";\n' + names.map((n) => sliceDecl(src, n)).join("\n") + "\n({ " + names.join(", ") + " });";
  const ctx = vm.createContext({ Math, Number, String, Array, Object, Date, JSON, BigInt, RegExp, Map, Set, Intl, isFinite, ...globals });
  return vm.runInContext(code, ctx);
}

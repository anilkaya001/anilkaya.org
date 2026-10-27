import { eq } from "./member-batteries.mjs";

const INSERTERS = /\.(append|prepend|before|after|replaceWith|replaceChildren)\(/g;

function closeOf(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < text.length && text[i] !== c; i += 1) if (text[i] === "\\") i += 1;
    } else if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function withoutBuilders(args) {
  let out = "";
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < args.length && args[i] !== c; i += 1) if (args[i] === "\\") i += 1;
      out += '""';
    } else if (args[i] === "h" && args[i + 1] === "(" && !/[\w$.]/.test(args[i - 1] || " ")) {
      const end = closeOf(args, i + 1);
      if (end === -1) return out;
      i = end;
    } else out += args[i];
  }
  return out;
}

export function nullAppends(text) {
  const hits = [];
  for (const m of text.matchAll(INSERTERS)) {
    const open = m.index + m[0].length - 1;
    const end = closeOf(text, open);
    if (end === -1) continue;
    const args = text.slice(open + 1, end);
    if (args.includes(".filter(")) continue;
    if (/\bnull\b|\bundefined\b/.test(withoutBuilders(args))) hits.push(text.slice(0, m.index).split("\n").length + ": " + m[0] + args.slice(0, 60));
  }
  return hits;
}

export function nullGuardBattery(files) {
  for (const [rel, text] of files) eq(nullAppends(text), [], rel + ": no call that inserts nodes can be handed null or undefined");
  eq(nullAppends("x.append(a ? b : null)").length, 1, "the scan catches a ternary with null");
  eq(nullAppends("x.replaceChildren(...[a, b ? c : null])").length, 1, "and a spread list that holds one");
  eq(nullAppends("x.before(undefined)").length, 1, "and undefined");
  eq(nullAppends("x.replaceWith(y ?? null)").length, 1, "and a replacement that may be null");
  eq(nullAppends('x.after(h("p", null, q ? r : null))').length, 0, "while a builder call drops its own nulls");
  eq(nullAppends("x.replaceChildren(...[a, b ? c : null].filter(Boolean))").length, 0, "and a filtered list is fine");
  eq(nullAppends('x.append("null")').length, 0, "and a string that says null is only text");
  eq(nullAppends("x.prepend(a, b)").length, 0, "and plain nodes are fine");
}

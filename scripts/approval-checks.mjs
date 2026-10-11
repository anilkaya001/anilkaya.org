import { rectHitsPoly } from "./approval-worlds.mjs";

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

export const FRAME_INFO_JS = `(() => {
  const txt = (n) => (n.textContent || "").replace(/\\s+/g, " ").trim();
  const all = (sel) => [...document.querySelectorAll(sel)];
  return {
    docTitle: document.title,
    text: document.body.innerText,
    aria: all("[aria-label]").map((n) => n.getAttribute("aria-label")),
    titles: all("[title]").map((n) => n.getAttribute("title")),
    alts: all("img[alt]").map((n) => n.getAttribute("alt")),
    nav: all("nav a").map(txt),
    headings: all("h1,h2,h3,h4,[role=heading]").map((n) => ({ tag: n.tagName.toLowerCase(), text: txt(n) })),
    header: all(".header-sentence").map(txt),
    chips: all(".chip").map(txt),
    badges: all(".badge").map((n) => ({ text: txt(n), row: (n.closest("[data-state]") || {}).dataset ? n.closest("[data-state]").dataset.state : null })),
    og: all('meta[property^="og:"]').map((n) => n.getAttribute("content")),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

export function textProblems(info) {
  const out = [];
  const everything = [info.text, ...info.aria, ...info.titles, ...info.alts, ...info.og, info.docTitle].join("\n");
  if (/\bat\s+(ask|bid)\b/i.test(everything)) out.push("the words \"at ask\" or \"at bid\" appear: the vendor's term is ask side and bid side");
  if (/\bNOW\b/.test(everything)) out.push("a \"NOW\" badge appears: the word for the Screen is Screen");
  for (const h of info.headings) if (/\bFDR\b/.test(h.text)) out.push(`FDR in a heading (${h.tag}): ${h.text}`);
  if (/\bFDR\b/.test(info.docTitle)) out.push("FDR in the document title");
  const banned = /\b(Unusual|Radar)\b/;
  for (const n of info.nav) if (banned.test(n)) out.push(`a nav label reads "${n}"`);
  if (banned.test(info.docTitle)) out.push("the document title carries Unusual or Radar");
  for (const h of info.headings) if (banned.test(h.text)) out.push(`a heading reads "${h.text}"`);
  for (const s of info.header) if (words(s) > 14) out.push(`a header sentence of ${words(s)} words: ${s}`);
  for (const c of info.chips) if (words(c) > 3) out.push(`a chip of ${words(c)} words: ${c}`);
  for (const b of info.badges) if (b.row === "screen" && !/^Screen$/.test(b.text)) out.push(`a Screen row carries the badge "${b.text}"`);
  return out;
}

const dist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
const distToPoly = (p, pts) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, dist(p, pts[i - 1], pts[i]));
  return d;
};

export function seamProblems(scene) {
  const out = [];
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  const names = scene.nodes.filter((n) => n.kind === "name");
  if (!names.length) out.push("the scene has no Name layer");
  for (const b of scene.bands) {
    const f = nodes.get(b.from), t = nodes.get(b.to);
    if (!f || !t) { out.push(`band ${b.id}: an end is not a node`); continue; }
    if (t.layer !== f.layer + 1) out.push(`band ${b.id} runs from layer ${f.layer} to layer ${t.layer}: a band joins neighbouring layers only`);
    for (const nm of names) {
      if (nm.id === b.from || nm.id === b.to) continue;
      if (b.pts.some((p) => Math.hypot(p[0] - nm.x, p[1] - nm.y) < nm.r - 0.5)) out.push(`band ${b.id} crosses the Name node ${nm.id}`);
    }
    const nameEnd = [f, t].find((n) => n.kind === "name");
    if (nameEnd && t === nameEnd && !(b.p1[0] <= nameEnd.x)) out.push(`band ${b.id} enters ${nameEnd.id} on its far side`);
    if (nameEnd && f === nameEnd && !(b.p0[0] >= nameEnd.x)) out.push(`band ${b.id} leaves ${nameEnd.id} from its near side`);
  }
  for (const p of scene.pulses || []) {
    const b = scene.bands[p.band];
    if (!b) { out.push(`pulse ${p.id} names no band`); continue; }
    if (!(p.from >= 0 && p.to <= 1 && p.to > p.from)) out.push(`pulse ${p.id} runs outside its band's length`);
    for (const q of p.pts) if (distToPoly(q, b.pts) > b.w / 2 + 1.6) { out.push(`pulse ${p.id} leaves band ${b.id}: it spans two bands`); break; }
    for (const nm of names) if (p.pts.some((q) => Math.hypot(q[0] - nm.x, q[1] - nm.y) < nm.r - 0.5) && nm.id !== b.from && nm.id !== b.to) out.push(`pulse ${p.id} passes through ${nm.id}`);
  }
  return out;
}

export function conservationProblems(scene, tol = 1e-6) {
  const out = [];
  const total = scene.total;
  scene.layers.forEach((ids, li) => {
    const sum = ids.reduce((s, id) => s + scene.nodes.find((n) => n.id === id).v, 0);
    if (Math.abs(sum - total) > Math.max(tol, total * 1e-9)) out.push(`layer ${li} sums to ${sum} against ${total}`);
  });
  const into = new Map(), outOf = new Map();
  for (const b of scene.bands) { into.set(b.to, (into.get(b.to) || 0) + b.v); outOf.set(b.from, (outOf.get(b.from) || 0) + b.v); }
  for (const n of scene.nodes) {
    if (n.layer > 0 && Math.abs((into.get(n.id) || 0) - n.v) > 1e-6) out.push(`${n.id}: inflow ${into.get(n.id) || 0} against ${n.v}`);
    if (n.layer < 3 && Math.abs((outOf.get(n.id) || 0) - n.v) > 1e-6) out.push(`${n.id}: outflow ${outOf.get(n.id) || 0} against ${n.v}`);
  }
  return out;
}

export function scaleProblems(scene) {
  const out = [];
  const vmax = scene.vMax;
  const k = scene.vertical ? 0.5 : 1;
  for (const n of scene.nodes) {
    const want = (6 + 28 * Math.sqrt(n.v / vmax)) * k;
    if (Math.abs(n.r - want) > 0.01) out.push(`${n.id}: radius ${n.r} against ${want.toFixed(2)}`);
  }
  const wk = scene.vertical ? 0.6 : 1;
  for (const b of scene.bands) {
    const want = Math.min(42, Math.max(1.25, b.v * 0.75)) * wk;
    if (Math.abs(b.w - want) > 0.01) out.push(`band ${b.id}: width ${b.w} against ${want.toFixed(2)}`);
  }
  const hits = [...new Set(scene.nodes.map((n) => n.r))];
  if (scene.nodes.some((n) => n.r < (scene.vertical ? 3 : 9))) out.push("a node is smaller than the floor");
  return out.concat(hits.length ? [] : ["no nodes"]);
}

export function labelProblems(labels, solids, bounds) {
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    if (bounds && (a.x < 0 || a.y < 0 || a.x + a.w > bounds.w || a.y + a.h > bounds.h)) out.push(`${a.id} leaves the frame`);
    for (let j = i + 1; j < labels.length; j++) {
      const b = labels[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id} overlaps ${b.id}`);
    }
    for (const s of solids) {
      if (s.poly && rectHitsPoly(a, s.poly)) out.push(`${a.id} overlaps ${s.id}`);
      else if (s.circle) {
        const cx = Math.max(a.x, Math.min(s.circle.x, a.x + a.w)), cy = Math.max(a.y, Math.min(s.circle.y, a.y + a.h));
        if (Math.hypot(cx - s.circle.x, cy - s.circle.y) < s.circle.r - 0.5) out.push(`${a.id} overlaps ${s.id}`);
      }
    }
  }
  return out;
}

export function gateOf(row, gates, answers) {
  const need = gates.rows[row];
  if (!need) throw new Error(`${row} names ${gates.decision} and has no placement in gates.json`);
  const states = need.map((p) => {
    if (!(p in answers.recorded)) throw new Error(`${row} needs ${p}, which has no answer slot`);
    const a = answers.recorded[p];
    return a === null || a === undefined ? "gated" : a === "yes" ? "released" : "changes";
  });
  if (states.includes("gated")) return "gated";
  if (states.includes("changes")) return "changes";
  return "released";
}

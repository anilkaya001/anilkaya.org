const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const COLOR = {
  bull: "#2ee37a", bear: "#ff5a4e", unsided: "#4ea2ff", slate: "#6f7d99",
  calls: "#19a4b7", puts: "#a464e3", gold: "#ffd60a", up: "#30d158", down: "#ff453a",
  ink: "#f5f5f7", ink2: "#b4b6c4", ink3: "#9a9cad",
};

export const r1 = (x) => Math.round(x * 10) / 10;
export const r2 = (x) => Math.round(x * 100) / 100;
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const money = (v) => "$" + (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + "M";
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function camera({ cx, cy, scale, yaw = 0, pitch = 0, dist = 9 }) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return {
    p(x, y, z) {
      const X = x * cyw + z * syw;
      let Z = -x * syw + z * cyw;
      const Y = y * cp - Z * sp;
      Z = y * sp + Z * cp;
      const k = dist / (dist + Z);
      return { x: cx + X * k * scale, y: cy - Y * k * scale, k, z: Z };
    },
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
export const mix = (a, b, t) => {
  const x = hex(a), y = hex(b);
  return "#" + [0, 1, 2].map((i) => Math.round(lerp(x[i], y[i], clamp(t, 0, 1))).toString(16).padStart(2, "0")).join("");
};

export function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

export function networkRows(world, { names = 10 } = {}) {
  const net = world.network;
  const rows = net.names.map((n) => {
    const calls = n.ca + n.cb, puts = n.pb + n.pa, sided = calls + puts;
    const cp = calls + (sided ? n.u * calls / sided : 0), pp = puts + (sided ? n.u * puts / sided : 0);
    return { id: n.id, label: n.label, residual: !!n.residual, calls: cp, puts: pp, bull: n.ca + n.pb, bear: n.cb + n.pa, unsided: n.u, total: n.v, sectors: n.sectors };
  });
  const ranked = rows.filter((n) => !n.residual).sort((a, b) => b.total - a.total);
  const keep = ranked.slice(0, names);
  const fold = ranked.slice(names);
  const other = rows.find((n) => n.residual);
  const merged = other ? { ...other, sectors: { ...other.sectors } } : { id: "Other", label: "Other names", residual: true, calls: 0, puts: 0, bull: 0, bear: 0, unsided: 0, total: 0, sectors: {} };
  for (const f of fold) {
    for (const k of ["calls", "puts", "bull", "bear", "unsided", "total"]) merged[k] += f[k];
    for (const [s, v] of Object.entries(f.sectors)) merged.sectors[s] = (merged.sectors[s] || 0) + v;
  }
  return { keep, other: merged, rows };
}

export function networkScene(world, opts = {}) {
  const vertical = !!opts.compact;
  const W = opts.w || (vertical ? 358 : 1124), H = opts.h || (vertical ? 400 : 560);
  const net = world.network;
  const { keep, other } = networkRows(world, { names: opts.names || 10 });
  const nameNodes = [...keep, other].filter((n) => n.total > 0);
  const total = nameNodes.reduce((s, n) => s + n.total, 0);

  const sectorV = new Map(), sideV = { calls: 0, puts: 0 };
  const ssEdge = new Map(), snEdge = [];
  for (const n of nameNodes) {
    const share = (s) => (n.total ? n.sectors[s] / n.total : 0);
    for (const [s, v] of Object.entries(n.sectors)) {
      sectorV.set(s, (sectorV.get(s) || 0) + v);
      const c = n.calls * share(s), p = n.puts * share(s);
      sideV.calls += c; sideV.puts += p;
      ssEdge.set("calls>" + s, (ssEdge.get("calls>" + s) || 0) + c);
      ssEdge.set("puts>" + s, (ssEdge.get("puts>" + s) || 0) + p);
      snEdge.push({ s, n: n.id, v });
    }
  }
  const sectors = net.sectors.filter((s) => sectorV.has(s.id)).map((s) => ({ ...s, v: sectorV.get(s.id) }));
  sectors.sort((a, b) => (a.residual ? 1 : 0) - (b.residual ? 1 : 0) || b.v - a.v);
  const vMax = Math.max(sideV.calls, sideV.puts, ...sectors.map((s) => s.v), ...nameNodes.map((n) => n.total));
  const scaleR = vertical ? 0.5 : 1;
  const radius = (v) => (6 + 28 * Math.sqrt(v / vMax)) * scaleR;
  const bandW = (v) => clamp(v * 0.75, 1.25, 42) * (vertical ? 0.6 : 1);

  const bull = nameNodes.reduce((s, n) => s + n.bull, 0), bear = nameNodes.reduce((s, n) => s + n.bear, 0), uns = nameNodes.reduce((s, n) => s + n.unsided, 0);
  const layers = [
    [{ id: "side:calls", label: "Calls", v: sideV.calls, color: COLOR.calls, kind: "side" }, { id: "side:puts", label: "Puts", v: sideV.puts, color: COLOR.puts, kind: "side" }],
    sectors.map((s) => ({ id: "sec:" + s.id, label: s.label, v: s.v, color: s.residual ? COLOR.slate : "#8aa4d6", kind: "sector", residual: !!s.residual })),
    nameNodes.map((n, i) => ({ id: "name:" + n.id, label: n.label, v: n.total, kind: "name", rank: n.residual ? null : i + 1, residual: n.residual, bull: n.bull, bear: n.bear, unsided: n.unsided, color: n.residual ? COLOR.slate : "#8aa4d6" })),
    [
      { id: "lean:bull", label: "Bullish", glyph: "▲", v: bull, color: COLOR.bull, kind: "lean" },
      { id: "lean:bear", label: "Bearish", glyph: "▼", v: bear, color: COLOR.bear, kind: "lean" },
      { id: "lean:uns", label: "Unsided", glyph: "–", v: uns, color: COLOR.slate, kind: "lean" },
    ].filter((l) => l.v > 0),
  ];

  const nLayers = layers.length;
  const yaw = (opts.yaw || 0) * DEG;
  const pitch = (opts.pitch === undefined ? 11 : opts.pitch) * DEG;
  const S = vertical ? 1 : 135;
  const cam = vertical ? null : camera({ cx: W / 2, cy: H / 2 + 6, scale: S, yaw, pitch, dist: 9 });
  const colX = [-3, -1, 1, 3];
  const colZ = (x) => 0.12 * x * x;
  const gap = vertical ? 5 : 11;
  const pitchRes = 1.6;

  const nodes = [];
  for (let li = 0; li < nLayers; li++) {
    const list = layers[li];
    list.forEach((n) => { n.r = radius(n.v); n.layer = li; });
    let ext = 0;
    list.forEach((n, i) => {
      const g = i === 0 ? 0 : n.residual && !list[i - 1].residual ? gap * pitchRes : gap;
      n.gapBefore = g;
      ext += g + 2 * n.r;
    });
    let cursor = -ext / 2;
    list.forEach((n) => {
      cursor += n.gapBefore;
      const c = cursor + n.r;
      cursor += 2 * n.r;
      n.b = c;
      if (vertical) {
        n.x = [52, 134, 216, 296][li];
        n.y = H / 2 + 10 + n.b;
        n.k = 1;
      } else {
        const q = cam.p(colX[li], -n.b / S, colZ(colX[li]));
        n.x = q.x; n.y = q.y; n.k = q.k; n.z = q.z;
      }
      nodes.push(n);
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  const add = (from, to, v, color, layer, extra) => { if (v > 1e-9) edges.push({ from, to, v, w: bandW(v), color, layer, ...extra }); };
  for (const [k, v] of ssEdge) { const [side, s] = k.split(">"); add("side:" + side, "sec:" + s, v, side === "calls" ? COLOR.calls : COLOR.puts, 0, { side }); }
  const foldTo = (id) => (keep.some((n) => n.id === id) ? id : other.id);
  const snAgg = new Map();
  for (const e of snEdge) { const key = e.s + ">" + foldTo(e.n); snAgg.set(key, (snAgg.get(key) || 0) + e.v); }
  for (const [k, v] of snAgg) {
    const [s, n] = k.split(">");
    const node = nameNodes.find((x) => x.id === n);
    const callShare = node.calls / (node.calls + node.puts);
    add("sec:" + s, "name:" + n, v, mix(COLOR.puts, COLOR.calls, callShare), 1, {});
  }
  for (const n of nameNodes) {
    add("name:" + n.id, "lean:bull", n.bull, COLOR.bull, 2, {});
    add("name:" + n.id, "lean:bear", n.bear, COLOR.bear, 2, {});
    add("name:" + n.id, "lean:uns", n.unsided, COLOR.unsided, 2, {});
  }

    for (const n of nodes) { n.out = []; n.in = []; }
  edges.forEach((e, i) => { e.id = i; e.f = byId.get(e.from); e.t = byId.get(e.to); e.f.out.push(e); e.t.in.push(e); });
  const cross = (n) => n.y;
  const order = (list, key) => list.sort((a, b) => cross(key(a)) - cross(key(b)) || a.id - b.id);
  for (let pass = 0; pass < 2; pass++) {
    for (const n of nodes) { order(n.out, (e) => e.t); order(n.in, (e) => e.f); }
  }
  for (const n of nodes) {
    for (const [list, side] of [[n.out, "out"], [n.in, "in"]]) {
      const tot = list.reduce((s, e) => s + e.w, 0);
      let c = -tot / 2;
      for (const e of list) {
        const off = c + e.w / 2;
        c += e.w;
        const along = Math.sqrt(Math.max(n.r * n.r - off * off, 0));
        const dirn = side === "out" ? 1 : -1;
        e[side === "out" ? "p0" : "p1"] = [n.x + dirn * along, n.y + off];
      }
    }
  }
  for (const e of edges) {
    const a = e.p0, b = e.p1;
    const mx = (a[0] + b[0]) / 2;
    e.c1 = [mx, a[1]];
    e.c2 = [mx, b[1]];
    e.pts = [];
    for (let i = 0; i <= 28; i++) e.pts.push(cubic(a, e.c1, e.c2, b, i / 28).map(r2));
    e.len = 0;
    for (let i = 1; i < e.pts.length; i++) e.len += Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]);
  }

  const vmaxEdge = Math.max(...edges.map((e) => e.v));
  const pulses = [];
  if (opts.pulses) {
    for (const e of edges) {
      const count = clamp(Math.round(1 + 3 * Math.sqrt(e.v / vmaxEdge)), 1, 4);
      const period = 7 - (7 - 2.4) * Math.sqrt(e.v / vmaxEdge);
      const len = Math.min(18 / Math.max(e.len, 1), 0.5);
      for (let k = 0; k < count; k++) {
        const t0 = ((k / count) + (e.id * 0.137)) % 1;
        const a = clamp(t0, 0, 1 - len), b = a + len;
        const seg = [];
        for (let i = 0; i <= 6; i++) seg.push(cubic(e.p0, e.c1, e.c2, e.p1, a + (b - a) * (i / 6)).map(r2));
        pulses.push({ id: "pu" + e.id + "-" + k, band: e.id, from: a, to: b, period: r2(period), phase: r2(t0), pts: seg });
      }
    }
  }

  const headers = layers.map((l, li) => ({ layer: li, name: ["SIDE", "SECTOR", "NAME", "LEAN"][li], total: l.reduce((s, n) => s + n.v, 0), x: r1(l.reduce((s, n) => s + n.x, 0) / l.length), y: vertical ? 22 : r1(Math.min(...l.map((n) => n.y - n.r)) - 36) }));
  if (!vertical) { for (const h of headers) h.x = r1(cam.p(colX[h.layer], 0, colZ(colX[h.layer])).x); }

  const labels = [];
  const chipH = vertical ? 16 : 22, pad = vertical ? 3 : 8, fs = vertical ? 10.5 : 12.5;
  const short = { "Other names": "Other", "No sector": "No sec.", Cyclical: "Cyc.", Unsided: "Uns.", Bullish: "Bull", Bearish: "Bear", Energy: "Energy" };
  for (const n of nodes) {
    const rank = n.rank ? n.rank + "  " : "";
    const base = vertical ? (n.glyph ? n.glyph + " " : "") + (short[n.label] || n.label) : rank + (n.glyph ? n.glyph + " " : "") + n.label + "  " + money(n.v);
    const w = Math.ceil(base.length * (vertical ? 6 : 7.1) + pad * 2);
    let x, y;
    if (vertical && n.layer === 0) { x = n.x - w / 2; y = n.id === "side:calls" ? n.y - n.r - 3 - chipH : n.y + n.r + 3; }
    else if (vertical) { x = n.x + n.r + 3; y = n.y - chipH / 2; }
    else if (n.layer === 0) { x = n.x - n.r - 10 - w; y = n.y - chipH / 2; }
    else { x = n.x + n.r + 10; y = n.y - chipH / 2; }
    labels.push({ id: n.id, text: base, x: r1(x), y: r1(y), w, h: chipH, fs, side: n.layer === 0 && !vertical ? "left" : "right" });
  }

  return {
    W, H, vertical, total, vMax, nodes: nodes.map((n) => ({ id: n.id, layer: n.layer, kind: n.kind, label: n.label, v: n.v, r: r2(n.r), x: r2(n.x), y: r2(n.y), k: n.k, bull: n.bull, bear: n.bear, unsided: n.unsided, color: n.color, glyph: n.glyph, rank: n.rank, residual: !!n.residual })),
    bands: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, layer: e.layer, v: e.v, w: r2(e.w), color: e.color, p0: e.p0.map(r2), p1: e.p1.map(r2), c1: e.c1.map(r2), c2: e.c2.map(r2), pts: e.pts, len: r1(e.len) })),
    pulses, headers, labels, layers: layers.map((l) => l.map((n) => n.id)), yaw: opts.yaw || 0, S, cam: vertical ? null : { cx: W / 2, cy: H / 2 + 6, scale: S, yaw, pitch, colX, colZ: colX.map(colZ) },
  };
}

const bandPath = (b) => {
  const h = b.w / 2;
  const sh = (p, d) => [p[0], p[1] + d];
  const a0 = sh(b.p0, -h), a1 = sh(b.c1, -h), a2 = sh(b.c2, -h), a3 = sh(b.p1, -h);
  const d0 = sh(b.p1, h), d1 = sh(b.c2, h), d2 = sh(b.c1, h), d3 = sh(b.p0, h);
  const f = (p) => r1(p[0]) + " " + r1(p[1]);
  return `M${f(a0)}C${f(a1)} ${f(a2)} ${f(a3)}L${f(d0)}C${f(d1)} ${f(d2)} ${f(d3)}Z`;
};
const centre = (b) => `M${b.p0.join(" ")}C${b.c1.join(" ")} ${b.c2.join(" ")} ${b.p1.join(" ")}`;

export function networkSvg(scene, o = {}) {
  const { W, H, vertical } = scene;
  const out = [];
  const lit = o.lit ? new Set(o.lit) : null;
  const dimmed = (id) => lit && !lit.has(id);
  out.push(`<svg class="scene" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.aria || "Flow network of flagged option premium")}" xmlns="http://www.w3.org/2000/svg">`);
  out.push(`<defs><radialGradient id="ground" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="#0b1120"/><stop offset="0.52" stop-color="#080d19"/><stop offset="1" stop-color="#05070c"/></radialGradient>`);
  out.push(`<filter id="blur6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter><filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
  const seen = new Set();
  for (const n of scene.nodes) {
    const key = n.color.slice(1);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`<radialGradient id="sp${key}" cx="34%" cy="30%" r="78%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.16" stop-color="${mix(n.color, "#ffffff", 0.35)}"/><stop offset="0.62" stop-color="${n.color}"/><stop offset="1" stop-color="${mix(n.color, "#000000", 0.62)}"/></radialGradient>`);
  }
  out.push(`</defs><rect width="${W}" height="${H}" fill="url(#ground)"/>`);
  if (scene.cam) {
    const cam = camera({ cx: scene.cam.cx, cy: scene.cam.cy, scale: scene.cam.scale, yaw: scene.cam.yaw, pitch: scene.cam.pitch, dist: 9 });
    const fy = -2.35;
    out.push(`<g class="floor" stroke="rgba(120,160,255,0.10)" fill="none" stroke-width="1">`);
    for (let x = -4.5; x <= 4.5; x += 0.75) { const a = cam.p(x, fy, -0.4), b = cam.p(x, fy, 7); out.push(`<line x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" opacity="${r2(0.9 - Math.abs(x) * 0.12)}"/>`); }
    for (let z = -0.4; z <= 7; z += 0.9) { const a = cam.p(-4.5, fy, z), b = cam.p(4.5, fy, z); out.push(`<line x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" opacity="${r2(Math.max(0.15, 0.9 - z * 0.11))}"/>`); }
    out.push(`</g>`);
    out.push(`<g class="planes">`);
    scene.cam.colX.forEach((cx, i) => {
      const z = scene.cam.colZ[i];
      const q = [cam.p(cx - 0.5, 1.85, z), cam.p(cx + 0.5, 1.85, z), cam.p(cx + 0.5, -2.05, z), cam.p(cx - 0.5, -2.05, z)];
      out.push(`<polygon points="${q.map((p) => r1(p.x) + "," + r1(p.y)).join(" ")}" fill="rgba(96,140,255,0.06)" stroke="rgba(140,180,255,0.22)" stroke-width="1"/>`);
    });
    out.push(`</g>`);
    out.push(`<g class="shadows">`);
    for (const n of scene.nodes) {
      const g = cam.p(scene.cam.colX[n.layer], -2.35, scene.cam.colZ[n.layer]);
      out.push(`<ellipse cx="${r1(n.x + (n.y - scene.H / 2) * 0.05)}" cy="${r1(g.y + 6)}" rx="${r1(n.r * 1.05)}" ry="${r1(n.r * 0.26)}" fill="#000" opacity="0.35" filter="url(#blur6)"/>`);
    }
    out.push(`</g>`);
  }
  out.push(`<g class="bands" style="mix-blend-mode:screen">`);
  const order = [...scene.bands].sort((a, b) => a.layer - b.layer);
  for (const b of order) {
    const dim = dimmed(b.id);
    out.push(`<path class="band" data-band="${b.id}" data-from="${b.from}" data-to="${b.to}" d="${bandPath(b)}" fill="${b.color}" fill-opacity="${dim ? 0.06 : 0.28}" stroke="${b.color}" stroke-opacity="${dim ? 0.08 : 0.55}" stroke-width="1"/>`);
  }
  out.push(`</g>`);
  if (scene.pulses.length && !o.noPulses) {
    out.push(`<g class="pulses" filter="url(#glow)">`);
    for (const p of scene.pulses) {
      const b = scene.bands[p.band];
      if (o.animate) out.push(`<circle class="pulse" r="3.2" fill="#fff" fill-opacity="0.85" data-pulse="${p.id}" data-band="${p.band}"><animateMotion dur="${p.period}s" begin="-${r2(p.phase * p.period)}s" repeatCount="indefinite" path="${centre(b)}"/></circle>`);
      else out.push(`<polyline class="pulse" data-pulse="${p.id}" data-band="${p.band}" points="${p.pts.map((q) => q.join(",")).join(" ")}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${vertical ? 1.6 : 2.4}" stroke-linecap="round"/>`);
    }
    out.push(`</g>`);
  }
  const nodeOrder = [...scene.nodes].sort((a, b) => (a.k || 1) - (b.k || 1));
  out.push(`<g class="nodes">`);
  for (const n of nodeOrder) {
    const dim = dimmed(n.id);
    const key = n.color.slice(1);
    out.push(`<g class="node" data-node="${esc(n.id)}" data-kind="${n.kind}" data-v="${r2(n.v)}" opacity="${dim ? 0.35 : 1}"${o.breathe ? ` style="transform-origin:${n.x}px ${n.y}px;animation:breathe 6s ease-in-out ${r2((n.rank || n.layer) * 0.37)}s infinite"` : ""}>`);
    out.push(`<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="url(#sp${key})"/>`);
    if (n.kind === "name") {
      const share = n.bull + n.bear > 0 ? n.bull / (n.bull + n.bear) : 0.5;
      const rc = n.residual ? COLOR.slate : mix(COLOR.bear, COLOR.bull, share);
      const rr = n.r - 1.6;
      out.push(`<path class="ring-l" d="M${n.x} ${r1(n.y - rr)}A${r1(rr)} ${r1(rr)} 0 0 0 ${n.x} ${r1(n.y + rr)}" fill="none" stroke="${COLOR.slate}" stroke-width="3" stroke-opacity="0.95"/>`);
      out.push(`<path class="ring-r" d="M${n.x} ${r1(n.y - rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${n.x} ${r1(n.y + rr)}" fill="none" stroke="${rc}" stroke-width="3" stroke-opacity="0.95"/>`);
    } else {
      out.push(`<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="none" stroke="${mix(n.color, "#ffffff", 0.5)}" stroke-opacity="0.35" stroke-width="1"/>`);
    }
    out.push(`</g>`);
  }
  out.push(`</g>`);
  if (o.flare) {
    const n = scene.nodes.find((x) => x.id === o.flare);
    if (n) {
      out.push(`<g class="flare"><circle cx="${n.x}" cy="${n.y}" r="${r1(n.r + 11)}" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="2"${o.animate ? ` style="animation:flare 1.2s ease-out 1"` : ""}/><circle cx="${n.x}" cy="${n.y}" r="${r1(n.r + 22)}" fill="none" stroke="#9ecbff" stroke-opacity="0.35" stroke-width="1.5"/></g>`);
    }
  }
  out.push(`<g class="labels" font-family="Inter,system-ui,sans-serif">`);
  for (const l of scene.labels) {
    const dim = dimmed(l.id);
    out.push(`<g class="chip" data-chip="${esc(l.id)}" opacity="${dim ? 0.4 : 1}"><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${vertical ? 7 : 11}" fill="rgba(11,17,32,0.82)" stroke="rgba(255,255,255,0.10)"/><text x="${r1(l.x + l.w / 2)}" y="${r1(l.y + l.h / 2 + l.fs * 0.35)}" text-anchor="middle" font-size="${l.fs}" fill="#f5f5f7">${esc(l.text)}</text></g>`);
  }
  for (const h of scene.headers) {
    if (vertical) out.push(`<text class="colhead" x="${h.x}" y="${h.y}" text-anchor="middle" font-size="9" letter-spacing="1" fill="#b4b6c4" font-weight="600">${h.name}<tspan x="${h.x}" dy="11" fill="#9a9cad">${money(h.total)}</tspan></text>`);
    else out.push(`<text class="colhead" x="${h.x}" y="${h.y}" text-anchor="middle" font-size="11" letter-spacing="1.2" fill="#b4b6c4" font-weight="600">${h.name} · ${money(h.total)}</text>`);
  }
  out.push(`</g></svg>`);
  return out.join("\n");
}

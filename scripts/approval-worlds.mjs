import { camera, COLOR, r1, r2, esc, mix, clamp, rng } from "./approval-scene.mjs";

const DEG = Math.PI / 180;

export function rectsHit(a, b, m = 0) {
  return a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
}

function project(poly, axis) {
  let lo = Infinity, hi = -Infinity;
  for (const p of poly) { const d = p[0] * axis[0] + p[1] * axis[1]; lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return [lo, hi];
}

export function rectHitsPoly(rect, poly) {
  const box = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h]];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = [b[0] - a[0], b[1] - a[1]];
    const n = [-e[1], e[0]];
    const len = Math.hypot(n[0], n[1]) || 1;
    axes.push([n[0] / len, n[1] / len]);
  }
  for (const ax of axes) {
    const [a0, a1] = project(box, ax), [b0, b1] = project(poly, ax);
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}

export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function pText(h) {
  const v = Math.pow(10, -h);
  const exp = Math.floor(Math.log10(v) + 1e-9);
  const lead = v / Math.pow(10, exp);
  const step = lead <= 1.0001 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10;
  const e = step === 10 ? exp + 1 : exp;
  const val = (step === 10 ? 1 : step) * Math.pow(10, e);
  return "p below " + val.toFixed(Math.max(0, -e));
}

export const SKYLINE_FLOOR_H = 4.3;

export function skylineScene(world, opts = {}) {
  const sk = world.skyline;
  const W = opts.w || 1124, H = opts.h || 560;
  const cam = camera({ cx: opts.cx || 440, cy: 420, scale: 74, yaw: -22 * DEG, pitch: 27 * DEG, dist: 12 });
  const unit = 0.5;
  const cols = 8, rows = sk.tiles.length / cols;
  const tileW = 0.92;
  const tiles = sk.tiles.map((t, i) => {
    const gx = (i % cols) - (cols - 1) / 2, gz = Math.floor(i / cols) - (rows - 1) / 2;
    const corners = [[gx - tileW / 2, gz - tileW / 2], [gx + tileW / 2, gz - tileW / 2], [gx + tileW / 2, gz + tileW / 2], [gx - tileW / 2, gz + tileW / 2]].map(([x, z]) => cam.p(x, 0, z));
    const c = cam.p(gx, 0, gz);
    return { ...t, gx, gz, poly: corners.map((q) => [r2(q.x), r2(q.y)]), cx: r2(c.x), cy: r2(c.y) };
  });
  const byName = new Map(tiles.map((t) => [t.t, t]));
  const prisms = [];
  for (const r of sk.rows) {
    const t = byName.get(r.t);
    if (!t) continue;
    const half = 0.34;
    const base = (y) => [[t.gx - half, t.gz - half], [t.gx + half, t.gz - half], [t.gx + half, t.gz + half], [t.gx - half, t.gz + half]].map(([x, z]) => cam.p(x, y, z));
    const solidTop = Math.min(r.h, SKYLINE_FLOOR_H) * unit;
    const fullTop = r.h * unit;
    const b0 = base(0), b1 = base(solidTop), b2 = base(fullTop);
    const pts = [...b0, ...b2].map((q) => [q.x, q.y]);
    prisms.push({
      t: r.t, h: r.h, dir: r.dir, chg: r.chg, p: pText(r.h), extrapolated: r.h > SKYLINE_FLOOR_H, above: r.h >= sk.hStar,
      b0, b1, b2, hull: hull(pts).map((q) => [r2(q[0]), r2(q[1])]),
      top: { x: r2((b2[0].x + b2[2].x) / 2), y: r2((b2[0].y + b2[2].y) / 2) },
    });
  }
  prisms.sort((a, b) => (a.b0[0].y + a.b0[2].y) - (b.b0[0].y + b.b0[2].y));
  const span = (cols + 0.2) / 2, depth = (rows + 0.2) / 2;
  const planeY = sk.hStar * unit;
  const plane = [[-span, -depth], [span, -depth], [span, depth], [-span, depth]].map(([x, z]) => cam.p(x, planeY, z)).map((q) => [r2(q.x), r2(q.y)]);
  const wall = { x0: -span, x1: span, z: -depth };
  const decades = [];
  for (let d = 1; d <= 6; d++) {
    const a = cam.p(wall.x0, d * unit, wall.z), b = cam.p(wall.x1, d * unit, wall.z);
    decades.push({ d, a: [r2(a.x), r2(a.y)], b: [r2(b.x), r2(b.y)], text: pText(d), floor: d === 4 });
  }
  const floorPoly = [[-span, -depth], [span, -depth], [span, depth], [-span, depth]].map(([x, z]) => cam.p(x, 0, z)).map((q) => [r2(q.x), r2(q.y)]);
  const callers = prisms.filter((p) => p.above).sort((a, b) => b.h - a.h);
  const marginX = W - 300;
  const callouts = callers.map((p, i) => ({ id: p.t, text: `${p.t} ${p.dir > 0 ? "▲ +" : "▼ −"}${Math.abs(p.chg).toFixed(1)}%  ${p.p}`, x: marginX, y: 150 + i * 44, w: 268, h: 34, from: [p.top.x, p.top.y] }));
  return { W, H, tiles, prisms, plane, planeY, decades, floorPoly, callouts, hStar: sk.hStar, wall, unit, solids: prisms.map((p) => ({ id: p.t, poly: p.hull })), labels: callouts.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })), cam };
}

export function skylineSvg(sc, o = {}) {
  const out = [];
  out.push(`<svg class="scene" viewBox="0 0 ${sc.W} ${sc.H}" width="100%" role="img" aria-label="${esc(o.aria || "Move skyline")}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif">`);
  out.push(`<defs><radialGradient id="g2" cx="46%" cy="40%" r="75%"><stop offset="0" stop-color="#0b1120"/><stop offset="0.6" stop-color="#080d19"/><stop offset="1" stop-color="#05070c"/></radialGradient>`);
  out.push(`<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(255,255,255,0.05)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.55)" stroke-width="1.4"/></pattern></defs>`);
  out.push(`<rect width="${sc.W}" height="${sc.H}" fill="url(#g2)"/>`);
  out.push(`<polygon points="${sc.floorPoly.map((p) => p.join(",")).join(" ")}" fill="rgba(96,140,255,0.04)" stroke="rgba(140,180,255,0.18)"/>`);
  for (const t of sc.tiles) {
    const c = t.dir > 0 ? COLOR.up : t.dir < 0 ? COLOR.down : COLOR.slate;
    out.push(`<polygon class="tile" data-t="${esc(t.t)}" points="${t.poly.map((p) => p.join(",")).join(" ")}" fill="${c}" fill-opacity="${0.10 + Math.min(0.28, Math.abs(t.chg || 0) * 0.04)}" stroke="rgba(255,255,255,0.08)"/>`);
  }
  for (const d of sc.decades) {
    out.push(`<line x1="${d.a[0]}" y1="${d.a[1]}" x2="${d.b[0]}" y2="${d.b[1]}" stroke="${d.floor ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)"}" stroke-dasharray="${d.floor ? "" : "2 4"}"/>`);
    out.push(`<text x="${d.a[0] - 8}" y="${d.a[1] + 4}" text-anchor="end" font-size="11" fill="#9a9cad">${esc(d.text)}</text>`);
  }
  const tiles = new Map(sc.tiles.map((t) => [t.t, t]));
  for (const p of sc.prisms) {
    const c = p.dir > 0 ? COLOR.up : COLOR.down;
    const face = (pts, f, op) => `<polygon points="${pts.map((q) => r1(q.x) + "," + r1(q.y)).join(" ")}" fill="${f}" fill-opacity="${op}" stroke="${mix(c, "#ffffff", 0.35)}" stroke-opacity="0.55" stroke-width="1"/>`;
    const q0 = p.b0, q1 = p.b1;
    out.push(`<g class="prism" data-t="${esc(p.t)}" data-h="${p.h}">`);
    out.push(face([q0[3], q0[2], q1[2], q1[3]], mix(c, "#000000", 0.5), 0.85));
    out.push(face([q0[2], q0[1], q1[1], q1[2]], mix(c, "#000000", 0.28), 0.88));
    out.push(face([q1[0], q1[1], q1[2], q1[3]], c, 0.95));
    if (p.extrapolated) {
      const q2 = p.b2;
      out.push(`<polygon points="${[q1[3], q1[2], q2[2], q2[3]].map((q) => r1(q.x) + "," + r1(q.y)).join(" ")}" fill="url(#hatch)" stroke="${c}" stroke-dasharray="3 3" stroke-opacity="0.8"/>`);
      out.push(`<polygon points="${[q1[2], q1[1], q2[1], q2[2]].map((q) => r1(q.x) + "," + r1(q.y)).join(" ")}" fill="url(#hatch)" stroke="${c}" stroke-dasharray="3 3" stroke-opacity="0.8"/>`);
      out.push(`<polygon points="${p.b2.map((q) => r1(q.x) + "," + r1(q.y)).join(" ")}" fill="none" stroke="${c}" stroke-dasharray="3 3" stroke-width="1.2"/>`);
    }
    out.push(`</g>`);
    const t = tiles.get(p.t);
    if (t) out.push(`<text x="${t.cx}" y="${t.cy + 3}" text-anchor="middle" font-size="9" fill="#ffffff" fill-opacity="0.7">${p.dir > 0 ? "▲" : "▼"}</text>`);
  }
  out.push(`<polygon class="plane" points="${sc.plane.map((p) => p.join(",")).join(" ")}" fill="${COLOR.gold}" fill-opacity="0.10" stroke="${COLOR.gold}" stroke-opacity="0.8" stroke-dasharray="7 5" stroke-width="1.4"/>`);
  const pf = [(sc.plane[2][0] + sc.plane[3][0]) / 2, (sc.plane[2][1] + sc.plane[3][1]) / 2];
  out.push(`<g class="plane-label"><rect x="${r1(pf[0] - 118)}" y="${r1(pf[1] - 2)}" width="236" height="22" rx="11" fill="rgba(11,17,32,0.86)" stroke="${COLOR.gold}" stroke-opacity="0.5"/><text x="${r1(pf[0])}" y="${r1(pf[1] + 13)}" text-anchor="middle" font-size="11.5" fill="${COLOR.gold}">no measured rate yet (design 10%)</text></g>`);
  for (const c of sc.callouts) {
    const mid = [c.x - 18, c.y + c.h / 2];
    out.push(`<polyline class="leader" points="${c.from[0]},${c.from[1]} ${mid[0]},${mid[1]} ${c.x},${mid[1]}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>`);
    out.push(`<g class="callout" data-t="${esc(c.id)}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="8" fill="rgba(11,17,32,0.86)" stroke="rgba(255,255,255,0.14)"/><text x="${c.x + 12}" y="${c.y + c.h / 2 + 4.5}" font-size="12.5" fill="#f5f5f7">${esc(c.text)}</text></g>`);
  }
  out.push(`</svg>`);
  return out.join("\n");
}

export function lollipopSvg(world, o = {}) {
  const sk = world.skyline;
  const rows = [...sk.rows].sort((a, b) => b.h - a.h).slice(0, 12);
  const W = 358, rh = 26, top = 34, left = 62, right = 22;
  const H = top + rows.length * rh + 30;
  const x = (h) => left + (W - left - right) * (h / 6);
  const out = [];
  out.push(`<svg class="scene" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.aria || "Sorted list of rarity with the selection line")}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif"><rect width="${W}" height="${H}" fill="#080d19" rx="12"/>`);
  for (let d = 1; d <= 6; d++) out.push(`<line x1="${x(d)}" y1="${top - 8}" x2="${x(d)}" y2="${H - 24}" stroke="rgba(255,255,255,0.08)"/><text x="${x(d)}" y="${H - 10}" text-anchor="middle" font-size="9.5" fill="#9a9cad">${d}</text>`);
  rows.forEach((r, i) => {
    const y = top + i * rh + rh / 2;
    const c = r.dir > 0 ? COLOR.up : COLOR.down;
    out.push(`<text x="10" y="${y + 4}" font-size="11.5" fill="#f5f5f7" font-weight="600">${esc(r.t)}</text><text x="${left - 10}" y="${y + 4}" text-anchor="end" font-size="9.5" fill="${c}">${r.dir > 0 ? "▲" : "▼"}</text>`);
    out.push(`<line x1="${left}" y1="${y}" x2="${x(Math.min(r.h, SKYLINE_FLOOR_H))}" y2="${y}" stroke="${c}" stroke-width="2"/>`);
    if (r.h > SKYLINE_FLOOR_H) out.push(`<line x1="${x(SKYLINE_FLOOR_H)}" y1="${y}" x2="${x(r.h)}" y2="${y}" stroke="${c}" stroke-width="2" stroke-dasharray="3 3"/>`);
    out.push(`<circle cx="${x(r.h)}" cy="${y}" r="4.5" fill="${c}"/>`);
  });
  out.push(`<line class="selection" x1="${x(sk.hStar)}" y1="${top - 14}" x2="${x(sk.hStar)}" y2="${H - 24}" stroke="${COLOR.gold}" stroke-dasharray="6 4" stroke-width="1.5"/>`);
  out.push(`<text x="${x(sk.hStar) - 4}" y="${top - 18}" text-anchor="end" font-size="9.5" fill="${COLOR.gold}">no measured rate yet (design 10%)</text>`);
  out.push(`<text x="${W - right}" y="${H - 10}" text-anchor="end" font-size="9.5" fill="#9a9cad">decades of scan p</text></svg>`);
  return out.join("\n");
}

const gammaAt = (k, t) => {
  const a = 1.0 + 0.9 * Math.exp(-t * 3.2), b = 0.55 + 0.5 * t;
  return a * Math.exp(-(((k - 0.03) / 0.07) ** 2)) - b * 0.9 * Math.exp(-(((k + 0.085) / 0.05) ** 2)) + 0.28 * a * Math.exp(-(((k - 0.15) / 0.045) ** 2)) - 0.12 * Math.exp(-(((k + 0.22) / 0.06) ** 2));
};

export function terrainScene(world, opts = {}) {
  const tr = world.terrain;
  const W = opts.w || 1124, H = opts.h || 560;
  const nk = 31, ne = tr.expiries.length;
  const kmin = -0.26, kmax = 0.26;
  const cam = camera({ cx: 480, cy: 365, scale: 80, yaw: -17 * DEG, pitch: 31 * DEG, dist: 13 });
  const gx = (i) => ((i / (nk - 1)) - 0.5) * 6.4;
  const gz = (j) => ((j / (ne - 1)) - 0.5) * 4.2;
  const hgt = (v) => v * 0.62;
  const grid = [];
  const maxAbs = 2.2;
  for (let j = 0; j < ne; j++) {
    const t = Math.sqrt(tr.expiries[j].days / 365);
    const row = [];
    for (let i = 0; i < nk; i++) {
      const k = kmin + (kmax - kmin) * (i / (nk - 1));
      const g = gammaAt(k, t) * tr.scale;
      const q = cam.p(gx(i), hgt(g), gz(j));
      row.push({ k: r2(k), g: r2(g), x: r2(q.x), y: r2(q.y), z: q.z });
    }
    grid.push(row);
  }
  const cells = [];
  for (let j = 0; j < ne - 1; j++) for (let i = 0; i < nk - 1; i++) {
    const p = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
    const g = (p[0].g + p[1].g + p[2].g + p[3].g) / 4;
    cells.push({ poly: p.map((q) => [q.x, q.y]), g: r2(g), z: (p[0].z + p[2].z) / 2 });
  }
  cells.sort((a, b) => b.z - a.z);
  const zeros = [];
  for (let j = 0; j < ne; j++) {
    const pts = [];
    for (let i = 0; i < nk - 1; i++) {
      const a = grid[j][i], b = grid[j][i + 1];
      if ((a.g <= 0 && b.g > 0) || (a.g >= 0 && b.g < 0)) {
        const f = a.g / (a.g - b.g);
        const k = a.k + (b.k - a.k) * f;
        const q = cam.p(gx(i + f), 0, gz(j));
        pts.push({ k: r2(k), x: r2(q.x), y: r2(q.y) });
      }
    }
    zeros.push({ j, expiry: tr.expiries[j].label, pts });
  }
  const contours = [];
  const levels = [-0.9, -0.45, 0.45, 0.9, 1.4];
  for (const lv of levels) {
    const segs = [];
    for (let j = 0; j < ne - 1; j++) for (let i = 0; i < nk - 1; i++) {
      const c = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
      const edge = [[0, 1], [1, 2], [2, 3], [3, 0]];
      const hits = [];
      for (const [a, b] of edge) {
        const ga = c[a].g - lv, gb = c[b].g - lv;
        if ((ga < 0) !== (gb < 0)) { const f = ga / (ga - gb); hits.push([c[a].x + (c[b].x - c[a].x) * f, c[a].y + (c[b].y - c[a].y) * f]); }
      }
      if (hits.length === 2) segs.push(hits.map((q) => [r1(q[0]), r1(q[1])]));
    }
    contours.push({ level: lv, segs, dashed: lv < 0 });
  }
  const profile = [];
  for (let i = 0; i < nk; i++) {
    let s = 0;
    for (let j = 0; j < ne; j++) s += grid[j][i].g;
    profile.push({ k: grid[0][i].k, g: s / ne });
  }
  const wallZ = gz(0) - 0.7;
  const pw = profile.map((p, i) => { const q = cam.p(gx(i), 1.55 + hgt(p.g) * 0.55, wallZ); return [r2(q.x), r2(q.y)]; });
  let flip = null;
  for (let i = 0; i < nk - 1; i++) {
    if (profile[i].g * profile[i + 1].g < 0) { const f = profile[i].g / (profile[i].g - profile[i + 1].g); flip = { k: r2(profile[i].k + (profile[i + 1].k - profile[i].k) * f), i: i + f }; break; }
  }
  const flipPt = flip ? (() => { const q = cam.p(gx(flip.i), 1.55, wallZ); return [r2(q.x), r2(q.y)]; })() : null;
  const si = ((tr.spotK - kmin) / (kmax - kmin)) * (nk - 1);
  const plane = [cam.p(gx(si), -0.3, gz(0) - 0.4), cam.p(gx(si), -0.3, gz(ne - 1) + 0.4), cam.p(gx(si), 1.7, gz(ne - 1) + 0.4), cam.p(gx(si), 1.7, gz(0) - 0.4)].map((q) => [r2(q.x), r2(q.y)]);
  const axisK = [-0.2, -0.1, 0, 0.1, 0.2].map((k) => { const i = ((k - kmin) / (kmax - kmin)) * (nk - 1); const q = cam.p(gx(i), -0.3, gz(ne - 1) + 0.5); return { k, x: r2(q.x), y: r2(q.y) }; });
  const axisE = tr.expiries.map((e, j) => { const q = cam.p(gx(nk - 1) + 0.25, 0, gz(j)); return { label: e.label, x: r2(q.x), y: r2(q.y) }; });
  const wallQuad = [cam.p(gx(0), -0.3, wallZ), cam.p(gx(nk - 1), -0.3, wallZ), cam.p(gx(nk - 1), 2.1, wallZ), cam.p(gx(0), 2.1, wallZ)].map((q) => [r2(q.x), r2(q.y)]);
  return { W, H, cells, zeros, contours, pw, wallQuad, flip, flipPt, plane, axisK, axisE, maxAbs, grid, nk, ne, spotK: tr.spotK };
}

const gamColor = (g) => (g >= 0 ? mix("#10223f", "#388cf0", clamp(g / 1.6, 0, 1)) : mix("#1c1410", "#d9741b", clamp(-g / 1.1, 0, 1)));

export function terrainSvg(sc, o = {}) {
  const out = [];
  out.push(`<svg class="scene" viewBox="0 0 ${sc.W} ${sc.H}" width="100%" role="img" aria-label="${esc(o.aria || "Dealer gamma terrain")}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif"><defs><radialGradient id="g3" cx="46%" cy="40%" r="75%"><stop offset="0" stop-color="#0b1120"/><stop offset="0.6" stop-color="#080d19"/><stop offset="1" stop-color="#05070c"/></radialGradient></defs><rect width="${sc.W}" height="${sc.H}" fill="url(#g3)"/>`);
  out.push(`<polygon class="wall" points="${sc.wallQuad.map((p) => p.join(",")).join(" ")}" fill="rgba(96,140,255,0.05)" stroke="rgba(140,180,255,0.2)"/>`);
  for (const c of sc.cells) out.push(`<polygon points="${c.poly.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ")}" fill="${gamColor(c.g)}" stroke="${gamColor(c.g)}" stroke-width="0.6"/>`);
  for (const ct of sc.contours) for (const s of ct.segs) out.push(`<line x1="${s[0][0]}" y1="${s[0][1]}" x2="${s[1][0]}" y2="${s[1][1]}" stroke="${ct.level > 0 ? "rgba(158,203,255,0.8)" : "rgba(255,190,120,0.8)"}" stroke-width="1"${ct.dashed ? ' stroke-dasharray="3 3"' : ""}/>`);
  for (const z of sc.zeros) if (z.pts.length) out.push(`<polyline class="zero" points="${z.pts.map((p) => p.x + "," + p.y).join(" ")}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`);
  out.push(`<polygon class="spot" points="${sc.plane.map((p) => p.join(",")).join(" ")}" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.55)" stroke-width="1.2"/>`);
  out.push(`<polyline class="profile" points="${sc.pw.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${COLOR.gold}" stroke-width="2.2"/>`);
  if (sc.flipPt) out.push(`<circle cx="${sc.flipPt[0]}" cy="${sc.flipPt[1]}" r="4.5" fill="${COLOR.gold}"/><text x="${sc.flipPt[0] + 9}" y="${sc.flipPt[1] - 8}" font-size="11.5" fill="${COLOR.gold}">flip, strike ${(Math.exp(sc.flip.k) * 100).toFixed(0)}% of spot</text>`);
  for (const a of sc.axisK) out.push(`<text x="${a.x}" y="${a.y + 14}" text-anchor="middle" font-size="10.5" fill="#9a9cad">${a.k === 0 ? "0" : (a.k > 0 ? "+" : "−") + Math.abs(a.k).toFixed(1)}</text>`);
  for (const a of sc.axisE) out.push(`<text x="${a.x + 8}" y="${a.y + 4}" font-size="10.5" fill="#9a9cad">${esc(a.label)}</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

export function gridSvg(sc, o = {}) {
  const W = 358, left = 34, top = 24, cw = (W - left - 10) / (sc.nk - 1), rh = 20;
  const H = top + sc.ne * rh + 34;
  const out = [];
  out.push(`<svg class="scene" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.aria || "Dealer gamma grid")}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif"><rect width="${W}" height="${H}" fill="#080d19" rx="12"/>`);
  sc.grid.forEach((row, j) => {
    row.forEach((c, i) => out.push(`<rect x="${r1(left + i * cw)}" y="${top + j * rh}" width="${r1(cw + 0.6)}" height="${rh - 1}" fill="${gamColor(c.g)}"/>`));
    out.push(`<text x="${left - 5}" y="${top + j * rh + 13}" text-anchor="end" font-size="9.5" fill="#9a9cad">${esc(sc.axisE[j].label)}</text>`);
  });
  for (const z of sc.zeros) {
    const pts = z.pts.map((p) => [left + ((p.k - sc.grid[0][0].k) / (sc.grid[0][sc.nk - 1].k - sc.grid[0][0].k)) * (sc.nk - 1) * cw + 0, top + z.j * rh + 1, top + z.j * rh + rh - 2]);
    for (const p of pts) out.push(`<line x1="${r1(p[0])}" y1="${p[1]}" x2="${r1(p[0])}" y2="${p[2]}" stroke="#fff" stroke-width="2"/>`);
  }
  const sx = left + ((sc.spotK - sc.grid[0][0].k) / (sc.grid[0][sc.nk - 1].k - sc.grid[0][0].k)) * (sc.nk - 1) * cw;
  out.push(`<line x1="${r1(sx)}" y1="${top - 6}" x2="${r1(sx)}" y2="${top + sc.ne * rh}" stroke="rgba(255,255,255,0.7)" stroke-dasharray="3 3"/><text x="${r1(sx)}" y="${top - 9}" text-anchor="middle" font-size="9.5" fill="#f5f5f7">spot</text>`);
  out.push(`<text x="${left}" y="${H - 12}" font-size="9.5" fill="#9a9cad">log-moneyness, −0.26 to +0.26</text></svg>`);
  return out.join("\n");
}

export function essvi(k, theta, rho, psi) {
  const x = psi * k / theta;
  return (theta / 2) * (1 + rho * x + Math.sqrt((x + rho) ** 2 + 1 - rho * rho));
}

export function surfaceScene(world, opts = {}) {
  const sf = world.surface;
  const W = opts.w || 1124, H = opts.h || 560;
  const slices = sf.slices;
  const nk = 29, nt = 17;
  const kmin = -0.34, kmax = 0.34;
  const cam = camera({ cx: 470, cy: 372, scale: 80, yaw: -14 * DEG, pitch: 28 * DEG, dist: 13 });
  const at = (tau) => {
    let a = slices[0], b = slices[slices.length - 1];
    for (let i = 0; i < slices.length - 1; i++) if (tau >= slices[i].tau && tau <= slices[i + 1].tau) { a = slices[i]; b = slices[i + 1]; break; }
    const f = clamp((tau - a.tau) / Math.max(b.tau - a.tau, 1e-9), 0, 1);
    return { theta: a.theta + (b.theta - a.theta) * f, rho: a.rho + (b.rho - a.rho) * f, psi: a.psi + (b.psi - a.psi) * f, kq: a.kq + (b.kq - a.kq) * f };
  };
  const tmin = slices[0].tau, tmax = slices[slices.length - 1].tau;
  const tauAt = (j) => { const u = (j / (nt - 1)) * (slices.length - 1), i = Math.min(Math.floor(u), slices.length - 2), f = u - i; return slices[i].tau + (slices[i + 1].tau - slices[i].tau) * f; };
  const gx = (i) => ((i / (nk - 1)) - 0.5) * 7;
  const gz = (j) => ((j / (nt - 1)) - 0.5) * 4.6;
  const grid = [];
  for (let j = 0; j < nt; j++) {
    const tau = tauAt(j), s = at(tau);
    const row = [];
    for (let i = 0; i < nk; i++) {
      const k = kmin + (kmax - kmin) * (i / (nk - 1));
      const w = essvi(k, s.theta, s.rho, s.psi);
      const iv = Math.sqrt(Math.max(w, 1e-9) / tau);
      const inside = Math.abs(k) <= s.kq * (0.5 + 0.5 * 1);
      const q = cam.p(gx(i), (Math.min(iv, 0.9) - 0.2) * 2.5, gz(j));
      row.push({ k: r2(k), iv: r2(iv * 100) / 100, inside: Math.abs(k) <= s.kq, x: r2(q.x), y: r2(q.y), z: q.z, tau });
    }
    grid.push(row);
  }
  const cells = [];
  for (let j = 0; j < nt - 1; j++) for (let i = 0; i < nk - 1; i++) {
    const p = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
    const iv = (p[0].iv + p[1].iv + p[2].iv + p[3].iv) / 4;
    cells.push({ poly: p.map((q) => [q.x, q.y]), iv, inside: p.every((q) => q.inside), z: (p[0].z + p[2].z) / 2 });
  }
  cells.sort((a, b) => b.z - a.z);
  const dots = [];
  const R = rng(5);
  for (const s of slices) {
    const tau = s.tau;
    const j = (() => { let best = 0, d = 9; for (let q = 0; q < nt; q++) { const dd = Math.abs(tauAt(q) - tau); if (dd < d) { d = dd; best = q; } } return best; })();
    const n = Math.min(9, sf.quotesPerSlice);
    for (let m = 0; m < n; m++) {
      const k = -s.kq + (2 * s.kq) * (m / (n - 1));
      const fit = Math.sqrt(essvi(k, s.theta, s.rho, s.psi) / tau);
      const spread = 0.006 + 0.004 * R() + 0.012 * Math.abs(k);
      const off = (R() - 0.5) * spread * 1.6 + (sf.outliers.some((o) => o[0] === s.tau && o[1] === m) ? spread * 2.4 : 0);
      const mid = fit + off;
      const gi = ((k - kmin) / (kmax - kmin)) * (nk - 1);
      const lo = cam.p(gx(gi), (Math.min(mid - spread, 0.9) - 0.2) * 2.5, gz(j)), hi = cam.p(gx(gi), (Math.min(mid + spread, 0.9) - 0.2) * 2.5, gz(j)), c = cam.p(gx(gi), (Math.min(mid, 0.9) - 0.2) * 2.5, gz(j));
      dots.push({ x: r2(c.x), y: r2(c.y), lo: r2(lo.y), hi: r2(hi.y), outside: Math.abs(off) > spread, tau, k: r2(k) });
    }
  }
  const eventRow = (() => { let best = 0, d = 9; for (let q = 0; q < nt; q++) { const dd = Math.abs(tauAt(q) - sf.event.tau); if (dd < d) { d = dd; best = q; } } return best; })();
  const ridge = grid[eventRow].map((c) => [c.x, c.y]);
  const seam = (() => { const c = grid[sf.seam.j][sf.seam.i]; return { x: c.x, y: c.y }; })();
  const axisK = [-0.3, -0.15, 0, 0.15, 0.3].map((k) => { const i = ((k - kmin) / (kmax - kmin)) * (nk - 1); const q = cam.p(gx(i), -1.0, gz(nt - 1) + 0.5); return { k, x: r2(q.x), y: r2(q.y) }; });
  const axisT = slices.filter((s, i) => i % 2 === 0).map((s) => { const j = (() => { let best = 0, d = 9; for (let q = 0; q < nt; q++) { const dd = Math.abs(tauAt(q) - s.tau); if (dd < d) { d = dd; best = q; } } return best; })(); const q = cam.p(gx(nk - 1) + 0.25, -1.0, gz(j)); return { label: s.label, x: r2(q.x), y: r2(q.y) }; });
  return { W, H, cells, dots, ridge, seam, axisK, axisT, grid, nk, nt, eventLabel: sf.event.label, tauAt };
}

const ivColor = (iv) => mix("#1b3a6b", "#ffd60a", clamp((iv - 0.18) / 0.5, 0, 1));

export function surfaceSvg(sc, o = {}) {
  const out = [];
  out.push(`<svg class="scene" viewBox="0 0 ${sc.W} ${sc.H}" width="100%" role="img" aria-label="${esc(o.aria || "Implied volatility surface")}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif"><defs><radialGradient id="g4" cx="46%" cy="40%" r="75%"><stop offset="0" stop-color="#0b1120"/><stop offset="0.6" stop-color="#080d19"/><stop offset="1" stop-color="#05070c"/></radialGradient><pattern id="hatch2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.5)" stroke-width="1.2"/></pattern></defs><rect width="${sc.W}" height="${sc.H}" fill="url(#g4)"/>`);
  for (const c of sc.cells) {
    const col = ivColor(c.iv);
    out.push(`<polygon points="${c.poly.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ")}" fill="${col}" fill-opacity="${c.inside ? 0.95 : 0.32}" stroke="${col}" stroke-opacity="${c.inside ? 0.95 : 0.32}" stroke-width="0.6"/>`);
    if (!c.inside) out.push(`<polygon points="${c.poly.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ")}" fill="url(#hatch2)" fill-opacity="0.35"/>`);
  }
  out.push(`<polyline class="ridge" points="${sc.ridge.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-dasharray="2 3"/>`);
  for (const d of sc.dots) {
    out.push(`<line x1="${d.x}" y1="${d.lo}" x2="${d.x}" y2="${d.hi}" stroke="${d.outside ? COLOR.down : "#ffffff"}" stroke-width="1.2" stroke-opacity="0.85"/><circle cx="${d.x}" cy="${(d.lo + d.hi) / 2}" r="2.6" fill="${d.outside ? COLOR.down : "#ffffff"}"/>`);
  }
  out.push(`<g class="seam"><circle cx="${sc.seam.x}" cy="${sc.seam.y}" r="9" fill="none" stroke="${COLOR.down}" stroke-width="2"/><text x="${sc.seam.x + 14}" y="${sc.seam.y + 4}" font-size="11.5" fill="${COLOR.down}">seam: calendar audit fails</text></g>`);
  const re = sc.ridge[Math.floor(sc.ridge.length * 0.78)];
  out.push(`<text x="${re[0] + 8}" y="${re[1] - 10}" font-size="11.5" fill="#f5f5f7">${esc(sc.eventLabel)}</text>`);
  for (const a of sc.axisK) out.push(`<text x="${a.x}" y="${a.y + 14}" text-anchor="middle" font-size="10.5" fill="#9a9cad">${a.k === 0 ? "0" : (a.k > 0 ? "+" : "−") + Math.abs(a.k).toFixed(1)}</text>`);
  for (const a of sc.axisT) out.push(`<text x="${a.x + 8}" y="${a.y + 4}" font-size="10.5" fill="#9a9cad">${esc(a.label)}</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

export function heatSvg(sc, o = {}) {
  const W = 358, left = 34, top = 22, cw = (W - left - 10) / (sc.nk - 1), rh = 16;
  const H = top + sc.nt * rh + 34;
  const out = [];
  out.push(`<svg class="scene" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.aria || "Implied volatility heatmap")}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif"><defs><pattern id="hatch3" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,0.5)" stroke-width="1"/></pattern></defs><rect width="${W}" height="${H}" fill="#080d19" rx="12"/>`);
  sc.grid.forEach((row, j) => row.forEach((c, i) => {
    out.push(`<rect x="${r1(left + i * cw)}" y="${top + j * rh}" width="${r1(cw + 0.6)}" height="${rh - 1}" fill="${ivColor(c.iv)}" fill-opacity="${c.inside ? 1 : 0.35}"/>`);
    if (!c.inside) out.push(`<rect x="${r1(left + i * cw)}" y="${top + j * rh}" width="${r1(cw + 0.6)}" height="${rh - 1}" fill="url(#hatch3)" fill-opacity="0.4"/>`);
  }));
  out.push(`<text x="${left}" y="${H - 12}" font-size="9.5" fill="#9a9cad">log-moneyness −0.42 to +0.42; hatched: extrapolated, shape assumed</text></svg>`);
  return out.join("\n");
}

export function relationsScene(world, opts = {}) {
  const rel = world.relations;
  const W = opts.w || 1124, H = opts.h || 560;
  const cx = W / 2 - (opts.shift || 0), cy = H / 2, R = Math.min(W, H * 1.55) * (opts.compact ? 0.33 : 0.29);
  const sectors = rel.sectors;
  const total = rel.names.length;
  const nodes = [];
  let a = -Math.PI / 2;
  const per = (Math.PI * 2) / total;
  const gapEvery = Math.PI * 2 / 90;
  for (const s of sectors) {
    const group = rel.names.filter((n) => n.s === s.id);
    group.forEach((n, i) => {
      const th = a + per * i + per / 2;
      nodes.push({ t: n.t, s: s.id, color: s.color, x: r2(cx + Math.cos(th) * R), y: r2(cy + Math.sin(th) * R), th, lx: r2(cx + Math.cos(th) * (R + (opts.compact ? 14 : 20))), ly: r2(cy + Math.sin(th) * (R + (opts.compact ? 14 : 20))) });
    });
    a += per * group.length;
  }
  const idx = new Map(nodes.map((n) => [n.t, n]));
  const edges = (opts.empty ? [] : rel.edges).filter((e) => e.stab >= 0.5).map((e) => {
    const p = idx.get(e.a), q = idx.get(e.b);
    const op = e.stab >= 0.9 ? 0.85 : e.stab >= 0.7 ? 0.55 : 0.3;
    const mid = [(p.x + q.x) / 2 * 0.2 + cx * 0.8, (p.y + q.y) / 2 * 0.2 + cy * 0.8];
    return { ...e, p: [p.x, p.y], q: [q.x, q.y], mid: mid.map(r2), op, lag: e.lag };
  });
  return { W, H, cx, cy, R, nodes, edges, community: opts.empty ? null : rel.community, sectors };
}

export function relationsSvg(sc, o = {}) {
  const out = [];
  out.push(`<svg class="scene" viewBox="0 0 ${sc.W} ${sc.H}" width="100%" role="img" aria-label="${esc(o.aria || "Names on a ring with tested edges")}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif"><defs><radialGradient id="g5" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#0b1120"/><stop offset="1" stop-color="#05070c"/></radialGradient><filter id="cg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter></defs><rect width="${sc.W}" height="${sc.H}" fill="url(#g5)"/>`);
  out.push(`<circle cx="${sc.cx}" cy="${sc.cy}" r="${r1(sc.R)}" fill="none" stroke="rgba(255,255,255,0.08)"/>`);
  if (sc.community) {
    const mem = sc.community.members.map((t) => sc.nodes.find((n) => n.t === t)).filter(Boolean);
    const gx = mem.reduce((s, n) => s + n.x, 0) / mem.length, gy = mem.reduce((s, n) => s + n.y, 0) / mem.length;
    out.push(`<ellipse class="community" cx="${r1(gx)}" cy="${r1(gy)}" rx="${r1(sc.R * 0.24)}" ry="${r1(sc.R * 0.24)}" fill="#388cf0" fill-opacity="0.26" filter="url(#cg)"/>`);
    const tx = gx + (sc.cx - gx) * 0.62, ty = gy + (sc.cy - gy) * 0.62;
    out.push(`<text class="community-caption" x="${r1(tx)}" y="${r1(ty)}" text-anchor="middle" font-size="${o.compact ? 10 : 12}" fill="#9ecbff">${esc(sc.community.caption)}</text>`);
  }
  for (const e of sc.edges) {
    out.push(`<path class="edge" data-a="${e.a}" data-b="${e.b}" data-stab="${e.stab}" d="M${e.p[0]} ${e.p[1]}Q${e.mid[0]} ${e.mid[1]} ${e.q[0]} ${e.q[1]}" fill="none" stroke="#9ecbff" stroke-opacity="${e.op}" stroke-width="${e.stab >= 0.9 ? 2.4 : e.stab >= 0.7 ? 1.8 : 1.3}"/>`);
  }
  for (const e of sc.edges.filter((x) => x.label)) {
    const lx = (e.p[0] + 2 * e.mid[0] + e.q[0]) / 4, ly = (e.p[1] + 2 * e.mid[1] + e.q[1]) / 4;
    out.push(`<g class="edge-label"><rect x="${r1(lx - 36)}" y="${r1(ly - 9)}" width="72" height="17" rx="8" fill="rgba(11,17,32,0.88)" stroke="rgba(255,255,255,0.14)"/><text x="${r1(lx)}" y="${r1(ly + 3.6)}" text-anchor="middle" font-size="10" fill="#f5f5f7">${e.stab.toFixed(2)}${e.lag ? " · " + e.lag + " min" : ""}</text></g>`);
  }
  for (const n of sc.nodes) {
    const anchor = n.lx > sc.cx + 6 ? "start" : n.lx < sc.cx - 6 ? "end" : "middle";
    out.push(`<circle class="rnode" data-t="${n.t}" cx="${n.x}" cy="${n.y}" r="${o.compact ? 4.5 : 6.5}" fill="${n.color}" stroke="rgba(255,255,255,0.5)"/><text x="${n.lx}" y="${n.ly + 4}" text-anchor="${anchor}" font-size="${o.compact ? 9 : 11.5}" fill="#f5f5f7">${n.t}</text>`);
  }
  if (!sc.edges.length) out.push(`<text class="empty" x="${sc.cx}" y="${sc.cy + 4}" text-anchor="middle" font-size="${o.compact ? 13 : 16}" fill="#f5f5f7">No stable links this week</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

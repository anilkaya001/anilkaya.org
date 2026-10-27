export const NEAR_Z = 0.25;

export const FIXED_BAND = 0.025;

export const MIN_WINDOWS = 5;

export const SESSION_CAP = 30;

export const DAYS_PER_YEAR = 365;

export const COLUMN_KEYS = Object.freeze(["side", "expiry", "money", "flags"]);

export const SIDE_NODES = Object.freeze([
  { id: "side:ca", label: "Calls · ask side", cp: "C", ask: true },
  { id: "side:cb", label: "Calls · bid side", cp: "C", ask: false },
  { id: "side:pa", label: "Puts · ask side", cp: "P", ask: true },
  { id: "side:pb", label: "Puts · bid side", cp: "P", ask: false },
]);

export const EXPIRY_NODES = Object.freeze([
  { id: "exp:d0", label: "Same day" },
  { id: "exp:w1", label: "1 to 7 days" },
  { id: "exp:m1", label: "8 to 31 days" },
  { id: "exp:far", label: "32 days and over" },
]);

export const MONEY_NODES = Object.freeze({
  scaled: [
    { id: "mny:itm", label: "In the money" },
    { id: "mny:near", label: "Near the money" },
    { id: "mny:otm", label: "Out of the money" },
  ],
  fixed: [
    { id: "mny:itm", label: "In the money, past 2.5%" },
    { id: "mny:near", label: "Within 2.5% of spot" },
    { id: "mny:otm", label: "Out of the money, past 2.5%" },
  ],
});

export const FLAG_NODES = Object.freeze([
  { id: "flg:so", label: "Sweep and all opening" },
  { id: "flg:s", label: "Sweep" },
  { id: "flg:o", label: "All opening" },
  { id: "flg:n", label: "Neither flag" },
  { id: "flg:u", label: "Flags not read" },
]);

export const TITLES = Object.freeze({ side: "Side", expiry: "Expiry", money: "Strike against spot", flags: "Flags" });

export const FACE_LINES = Object.freeze({
  gross: "Vendor-flagged windows, not every execution. Premium is gross; legs of a spread count separately.",
  ask: "Ask side is the vendor's attribution of premium; the bid side is the same attribution for the other quote. Premium with no stated side is not drawn and is counted apart. No lean on this page.",
  flags: "Opening: every trade in the window is flagged opening by the vendor. Sweep: the window contains a sweep.",
  spot: "One session spot, not the price at each window's time.",
});

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

export function calendarDays(fromIso, toIso) {
  const a = DAY.exec(String(fromIso));
  const b = DAY.exec(String(toIso));
  if (!a || !b) return null;
  const t1 = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const t2 = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  if (iso(t1) !== a[0] || iso(t2) !== b[0]) return null;
  return Math.round((t2 - t1) / 86400000);
}

export function expiryBucket(days) {
  if (!Number.isInteger(days) || days < 0) return null;
  return days === 0 ? "exp:d0" : days <= 7 ? "exp:w1" : days <= 31 ? "exp:m1" : "exp:far";
}

export function volFor(days, term, iv30) {
  const rows = (Array.isArray(term) ? term : [])
    .filter((r) => r && finite(r.dte) !== null && r.dte > 0 && finite(r.vol) !== null && r.vol > 0)
    .map((r) => ({ dte: r.dte, vol: r.vol, w: r.vol * r.vol * r.dte }))
    .sort((x, y) => x.dte - y.dte);
  if (rows.length) {
    const t = Math.max(days, 1);
    const upper = rows.findIndex((r) => r.dte >= t);
    if (upper === 0) return { vol: rows[0].vol, from: "term" };
    if (upper < 0) return { vol: rows[rows.length - 1].vol, from: "term" };
    const lo = rows[upper - 1];
    const hi = rows[upper];
    const frac = (t - lo.dte) / (hi.dte - lo.dte);
    const total = lo.w * (1 - frac) + hi.w * frac;
    return { vol: Math.sqrt(total / t), from: "term" };
  }
  const iv = finite(iv30);
  return iv !== null && iv > 0 ? { vol: iv, from: "iv30" } : null;
}

export function moneyness(cp, strike, spot, sigma, days) {
  const k = finite(strike);
  const s = finite(spot);
  if (k === null || !(k > 0) || s === null || !(s > 0)) return null;
  let z;
  if (sigma === null) {
    const gap = k - s;
    if (Math.abs(gap) <= FIXED_BAND * s) return "mny:near";
    z = gap;
  } else {
    if (!(sigma > 0)) return null;
    z = Math.log(k / s) / (sigma * Math.sqrt(Math.max(days, 1) / DAYS_PER_YEAR));
    if (Math.abs(z) <= NEAR_Z) return "mny:near";
  }
  return (cp === "C") === (z < 0) ? "mny:itm" : "mny:otm";
}

export function flagNode(sweep, opening) {
  if (typeof sweep !== "boolean" || typeof opening !== "boolean") return "flg:u";
  return sweep && opening ? "flg:so" : sweep ? "flg:s" : opening ? "flg:o" : "flg:n";
}

export function sideSplit(cp, premium, ask, bid) {
  let a = finite(ask);
  let b = finite(bid);
  if (a !== null && !(a >= 0 && a <= 1)) a = null;
  if (b !== null && !(b >= 0 && b <= 1)) b = null;
  if (a !== null && b !== null && a + b > 1 + 1e-9) { a = null; b = null; }
  const askPart = a === null ? 0 : premium * a;
  const bidPart = b === null ? 0 : premium * b;
  const noSide = Math.max(0, premium - askPart - bidPart);
  const valid = a !== null && b !== null && noSide <= premium * 1e-9;
  const c = cp === "C";
  return { valid, noSide, parts: [[c ? "side:ca" : "side:pa", askPart], [c ? "side:cb" : "side:pb", bidPart]].filter((x) => x[1] > 0) };
}

export function shares(values) {
  const total = values.reduce((a, v) => a + v, 0);
  if (!(total > 0)) return values.map(() => null);
  const rows = values.map((v, i) => {
    const exact = (v * 100) / total;
    return { i, v, whole: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let unused = 100 - rows.reduce((a, r) => a + r.whole, 0);
  const queue = rows.slice().sort((x, y) => y.rest - x.rest || y.v - x.v || x.i - y.i);
  const bump = new Set();
  for (const r of queue) {
    if (unused <= 0) break;
    bump.add(r.i);
    unused--;
  }
  return rows.map((r) => r.whole + (bump.has(r.i) ? 1 : 0));
}

export function buildNet(alerts, ctx = {}) {
  const session = typeof ctx.session === "string" ? ctx.session.slice(0, 10) : null;
  if (alerts === undefined || alerts === null) return { state: "unavailable", reason: "This name's dossier carries no flagged-window record." };
  if (typeof alerts !== "object") return { state: "unavailable", reason: "The flagged windows were not published for this name." };
  if (alerts.status === "absent" || alerts.status === "pending") return { state: "pending", reason: "The flagged windows publish with tonight's run." };
  if (alerts.status === "quiet") return { state: "quiet", reason: "No window of this name was flagged in the session." };
  if (alerts.status !== "ok") return { state: "unavailable", reason: "The flagged windows are not available: " + String(alerts.why || alerts.status || "no reason published").replace(/[.\s]+$/, "") + "." };
  const dots = Array.isArray(alerts.dots) ? alerts.dots : [];
  if (!dots.length) return { state: "quiet", reason: "The record carries no flagged window." };
  if (session && alerts.asOf && String(alerts.asOf).slice(0, 10) !== session) {
    return { state: "stale", reason: "The windows are for " + String(alerts.asOf).slice(0, 10) + ", not the card's session " + session + "." };
  }
  const sessionDay = session || (alerts.asOf ? String(alerts.asOf).slice(0, 10) : null);
  const excluded = { window: 0, noSide: 0, noSidePrem: 0, unflagged: 0 };
  const spot = finite(ctx.spot) !== null && ctx.spot > 0 ? ctx.spot : null;
  const iv30 = finite(ctx.iv30) !== null && ctx.iv30 > 0 ? ctx.iv30 : null;
  const termOn = Array.isArray(ctx.term) && ctx.term.some((r) => r && finite(r.vol) !== null && r.vol > 0 && finite(r.dte) !== null && r.dte > 0);
  const moneyOn = spot !== null;
  const basis = !moneyOn ? "none" : termOn ? "term" : iv30 !== null ? "iv30" : "fixed";
  const parts = [];
  let seen = 0;
  dots.forEach((d, i) => {
    seen++;
    const p = finite(d && d.p);
    const cp = d && (d.cp === "C" || d.cp === "P") ? d.cp : null;
    const days = d && typeof d.e === "string" && sessionDay ? calendarDays(sessionDay, d.e) : null;
    const bucket = expiryBucket(days);
    const k = finite(d && d.k);
    if (p === null || !(p > 0) || cp === null || bucket === null || (moneyOn && !(k > 0))) { excluded.window++; return; }
    let sigma = null;
    if (basis === "term" || basis === "iv30") {
      const v = volFor(days, ctx.term, iv30);
      sigma = v ? v.vol : null;
    }
    const money = moneyOn ? moneyness(cp, k, spot, sigma, days) : null;
    if (moneyOn && money === null) { excluded.window++; return; }
    const flag = flagNode(d.sw, d.op);
    if (flag === "flg:u") excluded.unflagged++;
    const split = sideSplit(cp, p, d.a, d.b);
    if (!split.valid) { excluded.noSide++; excluded.noSidePrem += split.noSide; }
    for (const [side, v] of split.parts) parts.push({ w: i, v, nodes: [side, bucket, money, flag] });
  });
  const total = parts.reduce((a, x) => a + x.v, 0);
  const drawnWindows = new Set(parts.map((x) => x.w)).size;
  const prem = finite(alerts.prem) !== null && alerts.prem >= 0 ? alerts.prem : null;
  const sumAll = dots.reduce((a, d) => a + (finite(d && d.p) !== null && d.p > 0 ? d.p : 0), 0);
  if (prem !== null && sumAll > prem * 1.001 + 1) return { state: "inconsistent", reason: "The listed windows add to more than the name's flagged premium, so no network is drawn." };
  if (!(total > 0)) return { state: "unavailable", reason: sessionDay === null ? "The windows carry no session date, so days to expiry cannot be counted." : "No listed window could be placed: " + excluded.window + " had a missing or invalid price, side, strike or expiry." };
  const cover = prem !== null && prem > 0 ? total / prem : null;
  const sidedShare = total + excluded.noSidePrem > 0 ? total / (total + excluded.noSidePrem) : null;
  const columns = [];
  const defs = [SIDE_NODES, EXPIRY_NODES, moneyOn ? MONEY_NODES[basis === "fixed" ? "fixed" : "scaled"] : null, FLAG_NODES];
  const keys = ["side", "expiry", "money", "flags"];
  defs.forEach((def, c) => {
    if (!def) return;
    const nodes = [];
    for (const n of def) {
      const mine = parts.filter((x) => x.nodes[c] === n.id);
      const v = mine.reduce((a, x) => a + x.v, 0);
      if (v > 0) nodes.push({ id: n.id, label: n.label, v, windows: new Set(mine.map((x) => x.w)).size });
    }
    const pct = shares(nodes.map((n) => n.v));
    nodes.forEach((n, i) => { n.pct = pct[i]; });
    columns.push({ key: keys[c], title: TITLES[keys[c]], index: c, nodes });
  });
  const live = columns.map((c) => c.index);
  const bands = [];
  for (let j = 0; j + 1 < live.length; j++) {
    const m = new Map();
    for (const x of parts) {
      const a = x.nodes[live[j]];
      const b = x.nodes[live[j + 1]];
      const key = a + ">" + b;
      m.set(key, (m.get(key) || 0) + x.v);
    }
    bands.push([...m].map(([key, v]) => { const [a, b] = key.split(">"); return { a, b, v }; }).sort((x, y) => y.v - x.v || (x.a + x.b < y.a + y.b ? -1 : 1)));
  }
  const paths = new Map();
  for (const x of parts) {
    const key = live.map((i) => x.nodes[i]).join(">");
    const e = paths.get(key) || { ids: live.map((i) => x.nodes[i]), v: 0, windows: new Set() };
    e.v += x.v;
    e.windows.add(x.w);
    paths.set(key, e);
  }
  const pathList = [...paths.values()].map((e) => ({ ids: e.ids, v: e.v, windows: e.windows.size })).sort((a, b) => b.v - a.v || (a.ids.join() < b.ids.join() ? -1 : 1));
  const coverNote = cover === null ? "not stated" : cover >= 0.75 ? "standard" : cover >= 0.5 ? "wide" : "largest";
  return {
    state: drawnWindows < MIN_WINDOWS ? "thin" : "ok",
    reason: drawnWindows < MIN_WINDOWS ? "Too few windows for a map." : null,
    session: sessionDay, total, windows: drawnWindows, listed: seen, n: finite(alerts.n), complete: typeof alerts.complete === "boolean" ? alerts.complete : null,
    cover, sidedShare, coverNote, gap: cover === null ? null : Math.max(0, Math.round(100 * (1 - cover))), prem,
    basis, spot, excluded, columns, bands, paths: pathList, parts,
  };
}

export function readoutFor(net, id) {
  const col = net.columns.find((c) => c.nodes.some((n) => n.id === id));
  if (!col) return null;
  const node = col.nodes.find((n) => n.id === id);
  const idx = col.index;
  const mine = net.parts.filter((x) => x.nodes[idx] === id);
  const total = mine.reduce((a, x) => a + x.v, 0);
  const others = net.columns.filter((c) => c !== col).map((c) => {
    const sums = new Map();
    for (const x of mine) sums.set(x.nodes[c.index], (sums.get(x.nodes[c.index]) || 0) + x.v);
    const rows = c.nodes.map((n) => ({ id: n.id, label: n.label, v: sums.get(n.id) || 0 })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
    return { key: c.key, title: c.title, rows };
  });
  return { id, label: node.label, column: col.title, pct: node.pct, v: total, windows: node.windows, of: net.total, others };
}

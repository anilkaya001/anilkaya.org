import { LIMITS, METRICS, PAYLOADS, REGISTRY_VERSION, metricById } from "../../shared/ff-contract.js";
import { clone, dateAdd, emit, histSeries, makeHist, median, priorDays, quant, zOracle } from "./ff-c-kit.mjs";

const SHIPPED = METRICS.filter((m) => m.status === "ready" || m.status === "limited");
const NAME_IDS = SHIPPED.filter((m) => m.subject === "ticker").map((m) => m.id);
const SECTOR_IDS = SHIPPED.filter((m) => m.subject === "sector").map((m) => m.id);
const spec = (id) => metricById(id).baseline;

function inputs(E) {
  const universe = E.get("universe");
  return {
    universe, session: universe.sessionDate,
    histOf: (t) => E.get("hist:" + t) || null, cardXOf: (t) => E.get("card-x:" + t) || null, cardOf: (t) => E.get("card:" + t) || null,
  };
}

function build(M, base, over = {}) {
  return M.metrics.buildMetrics({ sessionDate: base.session, generatedAt: "2026-08-24T22:30:00.000Z", universe: base.universe, histOf: base.histOf, cardXOf: base.cardXOf, cardOf: base.cardOf, ...over });
}

function uCell(u, key, t) {
  const i = u.t.indexOf(t);
  if (i < 0) return null;
  const raw = u.cols[key][i];
  const [, scale] = u.units[key];
  return typeof raw === "number" ? raw / scale : null;
}

function expandWhy(list) {
  const out = new Set();
  for (const item of list || []) {
    if (Array.isArray(item)) for (let i = item[0]; i <= item[1]; i++) out.add(i);
    else out.add(item);
  }
  return out;
}

function auditEmit(M, R, E) {
  const base = inputs(E);
  const built = build(M, base);
  R.ok(built.payload && !built.reason, "emit: payload built");
  const p = built.payload;
  const bytes = JSON.stringify(p).length;
  R.ok(bytes <= PAYLOADS.metrics.maxBytes, "emit: under the byte cap");
  R.eq(Object.keys(p).sort(), [...PAYLOADS.metrics.top].sort(), "emit: top-level keys are the contract's");
  R.eq(p.sessionDate, base.session, "emit: session");
  R.eq(p.registryVersion, REGISTRY_VERSION, "emit: registry version");
  R.eq(new Set(p.t).size, p.t.length, "emit: names unique");
  R.eq(p.t.length, base.universe.t.length, "emit: every universe name is in the payload");
  R.eq([...p.t].sort(), [...base.universe.t].sort(), "emit: payload names are the universe names");
  const carded = base.universe.t.filter((t) => base.histOf(t) || base.cardXOf(t));
  R.eq(p.t.slice(0, carded.length), carded, "emit: carded names come first in universe order");
  R.eq(p.windows.carded, carded.length, "emit: carded count");
  for (const id of Object.keys(p.cols)) {
    R.ok(NAME_IDS.includes(id), "emit: shipped metric only " + id);
    R.ok(p.cols[id].length <= p.t.length, "emit: column no longer than names " + id);
    R.ok(p.cols[id].every((v) => v === null || Number.isInteger(v)), "emit: integers or null " + id);
  }
  for (const m of METRICS.filter((x) => x.status === "hidden" || x.status === "warming")) R.ok(!(m.id in p.cols), "emit: no column for " + m.status + " metric " + m.id);
  const rr = p.cols["vol.rr25.30d"] || [];
  void rr;

  const subset = carded.slice(0, 60);
  for (const t of subset) {
    const i = p.t.indexOf(t);
    const h = base.histOf(t);
    const get = (id) => (p.cols[id] ? (p.cols[id][i] === undefined ? null : p.cols[id][i]) : null);
    const reasonOf = (id) => {
      for (const [reason, list] of Object.entries((p.why || {})[id] || {})) if (expandWhy(list).has(i)) return reason;
      return null;
    };
    if (h && h.volume && h.volume.asOf === base.session) {
      const s = histSeries(h);
      const np = s.np.get(base.session);
      R.eq(get("flow.net_premium"), typeof np === "number" ? quant(np, "flow.net_premium") : null, "flow.net_premium " + t);
      const pairs = [["flow.net_premium.z20", np, s.np, "np"], ["flow.volume.z20", s.vol.get(base.session), s.vol, "vol"]];
      for (const [id, x, series] of pairs) {
        if (typeof x !== "number") continue;
        const o = zOracle(x, series, base.session, spec(id));
        if (o.reason) {
          R.eq(get(id), null, id + " null when " + o.reason + " " + t);
          R.eq(reasonOf(id), o.reason, id + " reason " + t);
        } else {
          R.eq(get(id), quant(o.z, id), id + " z " + t);
          R.eq(p.n[id][i], o.n, id + " n " + t);
          R.eq(expandWhy((() => {
            const f = (p.f || {})[id] || [];
            return f;
          })()).has(i), Boolean(o.floored), id + " floored " + t);
        }
      }
      const vol = s.vol.get(base.session);
      const pc = s.pc.get(base.session);
      const thin = (() => {
        const clean = new Map();
        for (const [d, v] of s.pc) {
          const vv = s.vol.get(d);
          if (typeof vv !== "number" || !(v > 0)) continue;
          if (vv / (1 + v) >= LIMITS.thinContracts && (vv * v) / (1 + v) >= LIMITS.thinContracts) clean.set(d, v);
        }
        return clean;
      })();
      if (typeof pc === "number" && typeof vol === "number") {
        if (!thin.has(base.session)) R.eq(reasonOf("flow.pc_volume.z20"), "thin", "pc thin today " + t);
        else {
          const o = zOracle(pc, thin, base.session, spec("flow.pc_volume.z20"));
          if (!o.reason) R.eq(get("flow.pc_volume.z20"), quant(o.z, "flow.pc_volume.z20"), "pc z " + t);
        }
      }
    }
    const ed = uCell(base.universe, "ed", t);
    R.eq(get("earn.sessions"), ed === null ? null : quant(ed, "earn.sessions"), "earn.sessions " + t);
    R.eq(get("earn.clear_10"), ed === null ? null : ed > 10 ? 1 : 0, "earn.clear_10 " + t);
    const d1 = uCell(base.universe, "dIv1d", t);
    R.eq(get("vol.iv.30d.chg1d"), d1 === null ? null : quant(Number((d1 * 100).toPrecision(12)), "vol.iv.30d.chg1d"), "chg1d " + t);
    const x = base.cardXOf(t);
    if (x && x.sessionDate === base.session) {
      const nx = x.earnings && x.earnings.next;
      R.eq(get("earn.confirmed"), nx && typeof nx.confirmed === "boolean" ? (nx.confirmed ? 1 : 0) : null, "earn.confirmed " + t);
      const implied = x.term && x.term.status === "ok" && x.term.asOf === base.session && x.term.eventMove ? x.term.eventMove.meanAbs : null;
      const moves = ((x.earnings && x.earnings.events) || []).slice(0, LIMITS.maxPastReports).map((r) => r[3]).filter((v) => typeof v === "number").map(Math.abs);
      if (typeof implied === "number" && implied > 0 && moves.length >= LIMITS.minPastReports) {
        const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
        R.eq(get("earn.implied_ratio"), mean > 0 ? quant(implied / mean, "earn.implied_ratio") : null, "implied ratio " + t);
      } else R.eq(get("earn.implied_ratio"), null, "implied ratio absent " + t);
      const sk = x.skew && x.skew.status === "ok" ? x.skew.series : null;
      if (sk && sk.d.length >= 2 && sk.d[sk.d.length - 1] === base.session) {
        const pts = (v) => Math.round(-v * 1000) / 10;
        const a = pts(sk.rr25[sk.rr25.length - 1]);
        const b = pts(sk.rr25[sk.rr25.length - 2]);
        R.eq(get("vol.rr25.30d.x0"), a > 0 && b <= -0.5 ? 1 : 0, "x0 " + t);
      }
      const dyn = x.ivDyn;
      if (d1 !== null && dyn && dyn.status === "ok" && dyn.asOf === base.session && typeof dyn.volOfVol === "number") {
        const scale = Math.max(dyn.volOfVol, spec("vol.iv.30d.zvov").floor.abs);
        const want = Number.isInteger(dyn.changes) && dyn.changes < LIMITS.baselineMin ? null : quant(d1 / scale, "vol.iv.30d.zvov");
        R.eq(get("vol.iv.30d.zvov"), want, "zvov " + t);
      }
    }
    const card = base.cardOf(t);
    const fact = card && card.sessionDate === base.session && card.engine && Array.isArray(card.engine.facts) ? card.engine.facts.find((f) => f.id === "skew.rr25.30") : null;
    R.eq(get("vol.rr25.30d"), fact && typeof fact.v === "number" && fact.g >= 2 ? quant(Number((fact.v * 100).toPrecision(12)), "vol.rr25.30d") : null, "rr25 " + t);
  }

  const rest = base.universe.t.filter((t) => !carded.includes(t)).slice(0, 25);
  for (const t of rest) {
    const i = p.t.indexOf(t);
    R.eq(p.cols["flow.net_premium"] ? p.cols["flow.net_premium"][i] ?? null : null, null, "not carded has no flow " + t);
    const why = (p.why || {})["flow.net_premium.z20"] || {};
    R.ok(expandWhy(why.not_carded).has(i), "not carded reason " + t);
  }

  const sec = p.sectors;
  R.ok(sec && Array.isArray(sec.names), "emit: sector block");
  for (let k = 0; k < sec.names.length; k++) {
    const name = sec.names[k];
    const members = [];
    carded.forEach((t) => {
      const u = base.universe.t.indexOf(t);
      const sk = base.universe.sec[u];
      if (base.universe.sectors[sk] !== name) return;
      const h = base.histOf(t);
      if (!h || !h.volume || h.volume.asOf !== base.session) return;
      const s = histSeries(h);
      if (typeof s.np.get(base.session) !== "number") return;
      const have = priorDays(base.session, 20).filter((d) => typeof s.np.get(d) === "number").length;
      if (have >= 18) members.push(s.np);
    });
    R.eq(sec.members[k], members.length, "sector members " + name);
    const get = (id) => (sec.cols[id] ? sec.cols[id][k] ?? null : null);
    if (members.length < LIMITS.minConstituents) {
      R.eq(get("sector.breadth_pos"), null, "sector thin has no breadth " + name);
      R.ok(expandWhy(((sec.why || {})["sector.breadth_pos"] || {}).sector_coverage).has(k), "sector coverage reason " + name);
      continue;
    }
    const total = (d) => {
      let sum = 0;
      for (const s of members) {
        const v = s.get(d);
        if (typeof v !== "number") return null;
        sum += v;
      }
      return sum;
    };
    const series = new Map();
    for (const d of priorDays(base.session, 20)) {
      const v = total(d);
      if (v !== null) series.set(d, v);
    }
    const o = zOracle(total(base.session), series, base.session, spec("sector.net_premium.z20"));
    R.eq(get("sector.net_premium.z20"), o.reason ? null : quant(o.z, "sector.net_premium.z20"), "sector z " + name);
    R.eq(get("sector.breadth_pos"), quant(members.filter((s) => s.get(base.session) > 0).length / members.length, "sector.breadth_pos"), "sector breadth " + name);
  }
  void SECTOR_IDS;
  const again = build(M, base);
  R.eq(JSON.stringify(again.payload), JSON.stringify(p), "emit: deterministic");
  return { base, p, carded };
}

function auditSynthetic(M, R, E) {
  const base = inputs(E);
  const session = base.session;
  const universe = clone(base.universe);
  const names = universe.t.slice(0, 12);
  const days = [...priorDays(session, 20), session];
  const plain = (np, over = {}) => makeHist(session, days, np, days.map(() => 100000), days.map(() => 1), over);
  const wave = days.map((_, i) => 1000000 + (i % 5) * 400000 - (i % 3) * 300000);
  const run = (histMap, extra = {}) => M.metrics.buildMetrics({
    sessionDate: session, generatedAt: "2026-08-24T22:30:00.000Z", universe, histOf: (t) => histMap[t] || null, cardXOf: (t) => (t === names[6] ? { sessionDate: session } : null), cardOf: () => null, ...extra,
  });
  const idx = (r, t) => r.payload.t.indexOf(t);
  const val = (r, id, t) => (r.payload.cols[id] ? r.payload.cols[id][idx(r, t)] ?? null : null);
  const why = (r, id, t) => {
    for (const [reason, list] of Object.entries((r.payload.why || {})[id] || {})) if (expandWhy(list).has(idx(r, t))) return reason;
    return null;
  };

  const [a, b, c, d, e, f] = names;
  const stale = plain(wave, { volume: { ...plain(wave).volume, asOf: dateAdd(session, -3) } });
  const short = makeHist(session, days.slice(-12), wave.slice(-12), days.slice(-12).map(() => 100000), days.slice(-12).map(() => 1));
  const flat = plain(days.map(() => 5000000));
  const spike = plain([...wave.slice(0, 20), 9000000]);
  const thin = makeHist(session, days, wave, days.map(() => 150), days.map(() => 1));
  const r = run({ [a]: plain(wave), [b]: stale, [c]: short, [d]: flat, [e]: spike, [f]: thin });

  R.eq(val(r, "flow.net_premium", a), quant(wave[20], "flow.net_premium"), "syn: value");
  const o = zOracle(wave[20], new Map(days.map((x, i) => [x, wave[i]])), session, spec("flow.net_premium.z20"));
  R.eq(val(r, "flow.net_premium.z20", a), quant(o.z, "flow.net_premium.z20"), "syn: z against the oracle");
  R.eq(r.payload.n["flow.net_premium.z20"][idx(r, a)], 20, "syn: baseline count");
  R.eq(val(r, "flow.net_premium.z20", b), null, "syn: stale hist has no z");
  R.eq(why(r, "flow.net_premium.z20", b), "stale", "syn: stale reason");
  R.eq(val(r, "flow.net_premium", b), null, "syn: stale hist has no value");
  R.eq(val(r, "flow.net_premium.z20", c), null, "syn: short history has no z");
  R.eq(why(r, "flow.net_premium.z20", c), "warming", "syn: short history is warming");
  const flo = expandWhy((r.payload.f || {})["flow.net_premium.z20"]);
  R.ok(flo.has(idx(r, d)), "syn: a flat history is floored");
  R.ok(!flo.has(idx(r, a)), "syn: a varied history is not floored");
  R.eq(val(r, "flow.net_premium.z20", d), 0, "syn: flat history, value at the median, is zero");
  const o2 = zOracle(9000000, new Map(days.slice(0, 20).map((x, i) => [x, wave[i]])), session, spec("flow.net_premium.z20"));
  R.eq(val(r, "flow.net_premium.z20", e), quant(o2.z, "flow.net_premium.z20"), "syn: a spike is a large z");
  R.ok(val(r, "flow.net_premium.z20", e) > 300, "syn: the spike is many sigma");
  R.eq(why(r, "flow.pc_volume.z20", f), "thin", "syn: thin contract counts are thin, not a ratio");
  R.eq(val(r, "flow.pc_volume.z20", f), null, "syn: thin has no value");
  R.ok(val(r, "flow.pc_volume.z20", a) !== null || why(r, "flow.pc_volume.z20", a) !== null, "syn: pc is a value or a reason");
  R.eq(why(r, "flow.net_premium", names[6]), null, "syn: missing is the absence of a reason");
  R.eq(val(r, "flow.net_premium", names[6]), null, "syn: a name carded without a hist has no value, not zero");
  R.ok(r.payload.cols["flow.net_premium"].length <= idx(r, names[6]) || r.payload.cols["flow.net_premium"][idx(r, names[6])] === null, "syn: no zero for the missing name");
  void c;

  const one = clone(universe);
  one.sec = one.t.map(() => 0);
  one.sectors = ["Energy"];
  const sectorNames = one.t.slice(0, 12);
  const mkSector = (count) => {
    const map = {};
    sectorNames.forEach((t, i) => {
      const dd = days.slice(-count);
      map[t] = makeHist(session, dd, dd.map((_, j) => 1000000 + ((i * 7 + j * 3) % 11) * 100000), dd.map(() => 100000), dd.map(() => 1));
    });
    return map;
  };
  const sectorRun = (count) => M.metrics.buildMetrics({ sessionDate: session, generatedAt: "x", universe: one, histOf: (t) => mkSector(count)[t] || null, cardXOf: () => null, cardOf: () => null });
  const full = sectorRun(21);
  R.eq(full.payload.sectors.members, [12], "sector: twelve constituents with a full baseline");
  const totals = new Map(days.map((d, j) => [d, sectorNames.reduce((a, _, i) => a + 1000000 + ((i * 7 + j * 3) % 11) * 100000, 0)]));
  const os = zOracle(totals.get(session), totals, session, spec("sector.net_premium.z20"));
  R.eq(full.payload.sectors.cols["sector.net_premium.z20"], [quant(os.z, "sector.net_premium.z20")], "sector: the sum's z against the oracle");
  R.eq(full.payload.sectors.cols["sector.breadth_pos"], [100], "sector: every constituent positive");
  const shortSector = sectorRun(17);
  R.eq(shortSector.payload.sectors.members, [0], "sector: constituents with 16 prior days are not in the set");
  R.eq(shortSector.payload.sectors.cols["sector.net_premium.z20"], [], "sector: no z without a set");
  R.ok(expandWhy(shortSector.payload.sectors.why["sector.net_premium.z20"].sector_coverage).has(0), "sector: coverage reason");

  const pcDays = days;
  const lopsided = makeHist(session, pcDays, wave, pcDays.map(() => 1000), pcDays.map(() => 0.05));
  const lop = run({ [a]: lopsided });
  R.eq(why(lop, "flow.pc_volume.z20", a), "thin", "syn: one thin side is thin");
  const mkSkew = (cur, prev) => ({ sessionDate: session, skew: { status: "ok", series: { d: [dateAdd(session, -3), session], rr25: [prev, cur] } } });
  const skewCards = { [names[7]]: mkSkew(-0.02, 0.01), [names[8]]: mkSkew(-0.02, 0.003), [names[9]]: mkSkew(0.02, 0.01), [names[10]]: mkSkew(-0.02, -0.01) };
  const sk = run({}, { cardXOf: (t) => skewCards[t] || (t === names[6] ? { sessionDate: session } : null) });
  R.eq(val(sk, "vol.rr25.30d.x0", names[7]), 1, "skew: put-minus-call to call-minus-put, crossing out of the put-rich band");
  R.eq(val(sk, "vol.rr25.30d.x0", names[8]), 0, "skew: inside the half-point band is not a crossing");
  R.eq(val(sk, "vol.rr25.30d.x0", names[9]), 0, "skew: staying put-rich is not a crossing");
  R.eq(val(sk, "vol.rr25.30d.x0", names[10]), 0, "skew: staying call-rich is not a crossing");

  const unknown = M.metrics.buildMetrics({ sessionDate: session, generatedAt: "x", universe: { status: "unavailable", t: [] }, histOf: () => null, cardXOf: () => null, cardOf: () => null });
  R.eq(unknown.payload, null, "syn: no universe, no payload");
  R.eq(unknown.reason, "universe_unavailable", "syn: no universe reason");
  let threw = false;
  try {
    M.metrics.buildMetrics({ sessionDate: "x", generatedAt: "x", universe, histOf: () => null, cardXOf: () => null, cardOf: () => null });
  } catch {
    threw = true;
  }
  R.ok(threw, "syn: a bad session throws");

  const old = clone(universe);
  old.sessionDate = dateAdd(session, -7);
  const rs = M.metrics.buildMetrics({ sessionDate: session, generatedAt: "x", universe: old, histOf: () => null, cardXOf: () => null, cardOf: () => null });
  R.eq(why(rs, "earn.sessions", names[0]), "stale", "syn: a stale universe is stale, not carried");
  R.eq(val(rs, "earn.sessions", names[0]), null, "syn: a stale universe has no sessions");

  const many = Array.from({ length: 9000 }, (_, i) => ({ t: "SYA" + String(i).padStart(4, "0"), oc: "SYA" + String(i) + "260918C00100000", cp: "C", k: 100, exp: "2026-09-18", prem: 100000 + i, size: 500, oi: 1000, voi: 2, px: 99, spanStart: "2026-08-24T14:00:00.000Z" }));
  const carriedBig = { windows: many, from: dateAdd(session, -3), reason: null };
  const big = build(M, base, { carried: carriedBig });
  const bigBytes = JSON.stringify(big.payload).length;
  R.ok(bigBytes <= PAYLOADS.metrics.maxBytes, "cap: carried windows are shed to fit");
  R.ok(big.payload.windows.cut > 0, "cap: the cut is counted");
  R.eq(big.payload.windows.carry.n + big.payload.windows.cut, many.length, "cap: kept plus cut is every carried window");
  R.eq(big.stats.carryCut, big.payload.windows.cut, "cap: stats name the cut");

  const dayCard = (oc, curr, prev) => ({ sessionDate: session, panels: { oiDeltas: { status: "ok", rows: [{ oc, currOi: curr, prevOi: prev }] } } });
  const w = [
    { t: "SYA101", oc: "OC1", size: 100, prem: 9 }, { t: "SYA102", oc: "OC2", size: 100, prem: 8 }, { t: "SYA103", oc: "OC3", size: 100, prem: 7 },
    { t: "SYA104", oc: "OC4", size: 100, prem: 6 }, { t: "SYA105", oc: "OC5", size: 0, prem: 6 },
  ];
  const cards = { SYA101: dayCard("OC1", 1050, 1000), SYA102: dayCard("OC2", 900, 1000), SYA103: dayCard("OC3", 1500, 1000), SYA104: { sessionDate: dateAdd(session, -3), panels: dayCard("OC4", 1100, 1000).panels } };
  const conf = M.metrics.confirmCarry({ windows: w, from: "2026-08-21", reason: null }, (t) => cards[t] || null, session);
  const oic = conf.rows.map((x) => x.oic);
  R.eq(oic, [50, 0, 100, null, null], "carry: confirmation share is the added open interest over the window size, clamped, and absent is null");
  const cols = M.metrics.carryColumns(conf.rows);
  R.eq(M.metrics.carryRows(cols).map((x) => x.oic), oic, "carry: columns round-trip");
  R.eq(M.metrics.carryRows(null), [], "carry: no block, no rows");
  void median;
}

async function auditRequest(M, R) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 202, text: async () => "queued" };
  };
  const out = await M.metrics.requestRun({ url: "https://x.test/api/ff/run", token: "tok", session: "2026-08-24", cadence: "nightly", fetchImpl });
  R.eq(out, { ok: true, status: 202, body: "queued" }, "request: result");
  R.eq(seen[0].init.method, "POST", "request: POST");
  R.eq(seen[0].init.redirect, "error", "request: never follows a redirect with the bearer");
  R.eq(seen[0].init.headers.Authorization, "Bearer tok", "request: bearer");
  R.eq(JSON.parse(seen[0].init.body), { cadence: "nightly", session: "2026-08-24" }, "request: body");
  R.ok(seen[0].init.signal !== undefined, "request: bounded");
  const bad = await M.metrics.requestRun({ url: "https://x.test/", token: "t", session: "2026-08-24", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "no" }) });
  R.eq([bad.ok, bad.status], [false, 401], "request: refusal is reported, not thrown");
}

function auditCarry(M, R, E) {
  const C = M.carry;
  const S = "2026-08-24";
  const mk = (t, oc, prem, o = {}) => ({ t, oc, cp: "C", k: 100, exp: "2026-09-18", prem, size: 10, oi: 5, voi: 1, px: 99, spanStart: "2026-08-24T14:00:00.000Z", opening: true, ...o });
  const rows = [
    mk("SYA101", "B", 500), mk("SYA101", "A", 500), mk("SYA102", "C", 900), mk("SYA103", "D", 100, { opening: false }), mk("SYA104", "E", 100, { size: 0 }),
    mk("SYA105", "F", null), mk("SYA106", "G", 50, { opening: null }), { t: 7, oc: "H", opening: true, prem: 5, size: 1 }, null,
  ];
  const w = C.carryWindows({ rows });
  R.eq(w.map((x) => x.oc), ["C", "A", "B"], "carry: only opening windows with a premium and a size, largest first, ties by name then contract");
  R.eq(Object.keys(w[0]).sort(), [...C.CARRY_FIELDS].sort(), "carry: the contract's fields");
  R.eq(C.carryWindows(null), [], "carry: no alerts, no windows");
  const lots = Array.from({ length: 400 }, (_, i) => mk("SYA" + String(i % 50).padStart(3, "0"), "O" + i, 1000 + i));
  R.eq(C.carryWindows({ rows: lots }).length, 180, "carry: at most 180 windows");
  R.eq(C.carryWindows({ rows: lots })[0].prem, 1399, "carry: the largest first");
  const p = C.buildCarry({ sessionDate: S, generatedAt: "g", alerts: { rows }, carried: null });
  R.eq(Object.keys(p).sort(), [...PAYLOADS.carry.top].sort(), "carry: top-level keys are the contract's");
  R.eq(p.windows.length, 3, "carry: windows");
  R.ok(!("prior" in p), "carry: no prior without a carried session");
  const q = C.buildCarry({ sessionDate: S, generatedAt: "g", alerts: { rows }, carried: { windows: w, from: "2026-08-21", reason: null } });
  R.eq(q.prior, { sessionDate: "2026-08-21", windows: w }, "carry: the confirmed session is kept beside tonight's");
  const fat = Array.from({ length: 180 }, (_, i) => mk("SYA" + String(i).padStart(3, "0"), "O".repeat(30) + i, 1000 + i, { cp: "C" }));
  const prior = Array.from({ length: 600 }, (_, i) => mk("SYB" + i, "P".repeat(60) + i, 10 + i));
  const sized = C.buildCarry({ sessionDate: S, generatedAt: "g", alerts: { rows: fat }, carried: { windows: prior, from: "2026-08-21", reason: null } });
  R.ok(JSON.stringify(sized).length <= PAYLOADS.carry.maxBytes, "carry: under the cap");
  R.eq(sized.windows.length, 180, "carry: tonight's windows are kept whole when the prior is shed");
  const stored = { sessionDate: "2026-08-21", windows: w };
  R.eq(C.resolveCarried(stored, S), { windows: w, from: "2026-08-21", reason: null }, "resolve: last session's windows are the ones to confirm");
  const same = { sessionDate: S, windows: [], prior: { sessionDate: "2026-08-21", windows: w } };
  R.eq(C.resolveCarried(same, S).windows, w, "resolve: a rerun the same night confirms the prior session");
  R.eq(C.resolveCarried({ sessionDate: S, windows: [] }, S).reason, "same_session", "resolve: a rerun with no prior has nothing to confirm");
  R.eq(C.resolveCarried({ sessionDate: "2026-08-18", windows: w }, S).reason, "stale", "resolve: an older record is not confirmed against");
  R.eq(C.resolveCarried({ sessionDate: "2026-08-25", windows: w }, S).reason, "same_session", "resolve: a newer record is not confirmed against");
  R.eq(C.resolveCarried(null, S).reason, "missing", "resolve: none is missing");
  R.eq(C.resolveCarried({ windows: w }, S).reason, "missing", "resolve: no date is missing");
  R.eq(C.resolveCarried(stored, S).windows.length, 3, "resolve: windows");
  void E;
}

async function auditSection(M, R, E) {
  const S = M.section;
  const base = inputs(E);
  const store = { universe: base.universe, flowalerts: E.get("flowalerts") };
  for (const t of base.universe.t) {
    for (const k of ["hist:", "card-x:", "card:"]) if (E.get(k + t)) store[k + t] = E.get(k + t);
  }
  const calls = [];
  const stub = (over = {}) => ({
    store, read: async () => null, put: async (key, payload) => {
      calls.push(["put", key, JSON.stringify(payload).length, payload]);
    }, ask: async (a) => {
      calls.push(["ask", a]);
      return { ok: true, status: 202, body: "ok" };
    }, env: { FLOWS_INGEST_TOKEN: "tok" }, dry: false, now: () => "2026-08-24T22:30:00.000Z", url: () => "https://x.test/api/ff/run", ...over,
  });
  const ctx = { sessionDate: base.session };
  let out = await S.ffStage(ctx, stub());
  R.eq(out.published, ["ff-metrics", "ff-carry"], "stage: both payloads published, metrics first");
  R.eq(calls.filter((c) => c[0] === "put").map((c) => c[1]), ["ff-metrics", "ff-carry"], "stage: put order");
  R.eq(calls.filter((c) => c[0] === "ask").length, 1, "stage: the evaluator is asked once");
  R.eq(calls.find((c) => c[0] === "ask")[1], { url: "https://x.test/api/ff/run", token: "tok", session: base.session, cadence: "nightly" }, "stage: the request");
  R.ok(out.run && out.run.ok, "stage: run result");

  calls.length = 0;
  out = await S.ffStage(ctx, stub({ dry: true }));
  R.eq(calls.filter((c) => c[0] === "ask").length, 0, "stage: a dry run asks for nothing");
  R.eq(out.run, null, "stage: dry run has no run result");

  calls.length = 0;
  out = await S.ffStage(ctx, stub({ env: {} }));
  R.eq(calls.filter((c) => c[0] === "ask").length, 0, "stage: no token, no request");
  R.eq(out.run.ok, false, "stage: no token is reported");

  calls.length = 0;
  out = await S.ffStage(ctx, stub({ ask: async () => {
    throw new Error("boom");
  } }));
  R.eq(out.run.ok, false, "stage: a failing request is a result, not a throw");
  R.eq(out.published.length, 2, "stage: a failing request keeps the payloads");

  calls.length = 0;
  out = await S.ffStage(ctx, stub({ store: { ...store, universe: { status: "unavailable", t: [] } } }));
  R.eq(out.published, ["ff-carry"], "stage: no universe, no metrics, the carry still goes");
  R.eq(out.failures.length, 1, "stage: the failure is named");
  const wantWindows = store.flowalerts.rows.filter((x) => x.opening === true && typeof x.t === "string" && typeof x.oc === "string" && Number.isFinite(x.prem) && Number.isFinite(x.size) && x.size > 0).length;
  R.ok(wantWindows > 0, "stage: the fixture has opening windows");
  R.eq(calls.find((c) => c[1] === "ff-carry")[3].windows.length, wantWindows, "stage: the carry does not wait for the metrics");
  R.eq(calls.filter((c) => c[0] === "ask").length, 0, "stage: no metrics, no request");

  calls.length = 0;
  let leaked = null;
  try {
    await S.ffStage(ctx, stub({ put: async () => {
      const e = new Error("fixture");
      e.fixtureLeak = true;
      throw e;
    } }));
  } catch (error) {
    leaked = error;
  }
  R.ok(leaked && leaked.fixtureLeak, "stage: a fixture leak is rethrown, never a soft failure");

  const stages = { log: [], skip(id, why) {
    this.log.push(["skip", id, why]);
  }, async run(id, work, onError) {
    this.log.push(["run", id]);
    try {
      return await work();
    } catch (error) {
      onError(error);
      return null;
    }
  }, detail(f) {
    this.log.push(["detail", f]);
  } };
  const cx = { sessionDate: base.session, stages };
  await S.runFf(cx, { ...stub(), env: { FF_NIGHTLY: "off" } });
  R.eq(stages.log, [["skip", "ff", "FF_NIGHTLY is off"]], "runFf: off skips with its reason");
  R.ok(!("ff" in cx), "runFf: off leaves no result");
  stages.log.length = 0;
  const quiet = console.log;
  console.log = () => {};
  await S.runFf(cx, stub());
  console.log = quiet;
  R.eq(stages.log.map((x) => x[0]), ["run", "detail"], "runFf: runs the stage and records detail");
  R.ok(cx.ff && cx.ff.published.length === 2, "runFf: result kept on the context");
  R.ok(S.ffNightlyOn({}) && S.ffNightlyOn({ FF_NIGHTLY: "on" }) && !S.ffNightlyOn({ FF_NIGHTLY: " OFF " }), "ffNightlyOn");
  R.eq(S.FF_PUBLISHES, ["ff-metrics", "ff-carry"], "publishes list");
  R.eq(S.runUrl("https://flows.test/api/flows/ingest"), "https://flows.test/api/ff/run", "run url is on the ingest origin");
  void metricById;
}

export async function battery(M, R, only = null) {
  const E = emit();
  const pick = (name) => !only || only.includes(name);
  if (pick("emit")) auditEmit(M, R, E);
  if (pick("syn")) auditSynthetic(M, R, E);
  if (pick("request")) await auditRequest(M, R);
  if (pick("carry")) auditCarry(M, R, E);
  if (pick("section")) await auditSection(M, R, E);
}

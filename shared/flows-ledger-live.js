import { ledgerView } from "./flows-sfc-view.js";
import { readUniverse, deltaMicroOf } from "./flows-sfc.js";
import { createLedgerBook, projectWindow } from "./flows-ledger-book.js";
import { textHash } from "./flows-ledger-strip.js";

export const BOOK_VERSION = 1;

export const ALL_SCOPE = Object.freeze({ kind: "all", key: "all" });

export function ledgerLiveMode(env) {
  const v = String((env && env.FLOWS_LEDGER_LIVE) || "").trim().toLowerCase();
  return v === "on" || v === "owner" ? v : "off";
}

export const ledgerLiveOn = (env, owner) => {
  const mode = ledgerLiveMode(env);
  return mode === "on" || (mode === "owner" && owner === true);
};

const obj = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? v : null);

const keep = (feed, columns) => {
  const f = obj(feed);
  if (!f) return null;
  const out = {};
  for (const c of columns) if (f[c] !== undefined) out[c] = f[c];
  return out;
};

export function tideSlice(breadth) {
  const b = obj(breadth);
  if (!b) return null;
  const out = { units: b.units === undefined ? null : b.units, session: b.session === undefined ? null : b.session };
  const block = obj(b.sectors);
  if (block) {
    const rows = {};
    for (const [name, feed] of Object.entries(obj(block.rows) || {})) rows[name] = keep(feed, ["status", "reason", "date", "n", "ncp", "npp"]);
    out.sectors = { t: block.t === undefined ? null : block.t, rows };
  }
  const etf = obj(b.etf);
  if (etf) {
    out.etf = {};
    for (const [name, feed] of Object.entries(etf)) out.etf[name] = keep(feed, ["status", "reason", "date", "t", "ncp", "npp"]);
  }
  return out;
}

export function universeSlice(universe) {
  const u = obj(universe);
  if (!u) return null;
  return { t: Array.isArray(u.t) ? u.t : [], sectors: Array.isArray(u.sectors) ? u.sectors : [], sec: Array.isArray(u.sec) ? u.sec : [], cols: { mcap: u.cols && Array.isArray(u.cols.mcap) ? u.cols.mcap : [] } };
}

export function buildBook({ at, view, live, nightly, breadth, universe, clock }) {
  const payload = obj(live && live.payload) || {};
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((r) => {
    const p = projectWindow(r);
    if (p === null) return null;
    const la = Date.parse(typeof r.lastAt === "string" ? r.lastAt : "");
    const dm = deltaMicroOf(r);
    return { ...p, la: Number.isFinite(la) ? la : null, dm: Number.isInteger(dm) ? dm : null };
  }).filter(Boolean);
  const nightlyP = obj(nightly && nightly.payload);
  const nightlySession = nightlyP ? (obj(nightlyP.record) && typeof nightlyP.record.date === "string" ? nightlyP.record.date : typeof nightlyP.sessionDate === "string" ? nightlyP.sessionDate.slice(0, 10) : null) : null;
  const nightlyAt = nightlyP ? Date.parse(nightlyP.readAt || nightlyP.generatedAt) : NaN;
  return {
    v: BOOK_VERSION, status: "ok", serverNow: at, session: live.session, readAt: live.readAt,
    record: { date: obj(payload.record) && typeof payload.record.date === "string" ? payload.record.date : live.session, everEntered: obj(payload.record) && Number.isFinite(payload.record.everEntered) ? payload.record.everEntered : null },
    rows, universe: universeSlice(universe), breadth: tideSlice(breadth && breadth.payload), clock: clock === undefined ? null : clock,
    nightly: nightlyP ? { session: nightlySession, readAt: Number.isFinite(nightlyAt) ? nightlyAt : null } : null,
    period: view.period.id, viewHash: textHash(JSON.stringify(view)),
  };
}

export function notLive({ at, view }) {
  return { v: BOOK_VERSION, status: "not-live", serverNow: at, period: view.period ? view.period.id : null, why: view.why || "The intraday read is not live." };
}

const nightlyInput = (n) => (n && n.session ? { payload: { record: { date: n.session }, readAt: Number.isFinite(n.readAt) ? new Date(n.readAt).toISOString() : null } } : null);

const baseInput = (base, extra = {}) => ({
  now: base.serverNow, scope: ALL_SCOPE, period: null,
  live: { payload: { rows: base.rows, record: base.record }, readAt: base.readAt, session: base.session },
  nightly: nightlyInput(base.nightly), breadth: base.breadth ? { payload: base.breadth } : null, universe: base.universe, clock: base.clock, ...extra,
});

export function baseParity(base) {
  const view = ledgerView(baseInput(base));
  const got = textHash(JSON.stringify(view));
  return { ok: got === base.viewHash, got, want: base.viewHash, status: view.status };
}

const universeKey = (u) => (u ? textHash(JSON.stringify([u.t, u.sectors, u.sec, u.cols && u.cols.mcap])) : "none");

export function createLiveLedger({ deltaMicro = deltaMicroOf } = {}) {
  const S = { engine: null, uni: null, ukey: null, universe: null, breadth: null, clock: null, nightly: null, readAt: null, session: null, serverNow: null, baseKeys: null, entered: 0 };

  function applyBase(base) {
    if (!base || base.status !== "ok" || !Array.isArray(base.rows)) return { ok: false, why: base && base.why ? base.why : "no base" };
    const uni = readUniverse(base.universe);
    const key = universeKey(base.universe);
    if (S.engine === null || S.session !== base.session) {
      S.engine = createLedgerBook({ column: uni.columnOf, session: base.session, deltaMicro });
      S.ukey = key;
    } else if (S.ukey !== key) {
      S.ukey = key;
      S.engine.rebuild(uni.columnOf);
    }
    S.uni = uni;
    S.session = base.session;
    S.universe = base.universe;
    S.breadth = base.breadth;
    S.clock = base.clock;
    S.nightly = nightlyInput(base.nightly);
    S.serverNow = base.serverNow;
    if (Number.isFinite(base.readAt)) S.readAt = S.readAt === null ? base.readAt : Math.max(S.readAt, base.readAt);
    const results = { entered: 0, revised: 0, unchanged: 0, older: 0 };
    for (const row of base.rows) {
      const at = Number.isFinite(row.la) ? row.la : base.readAt;
      const r = S.engine.put(row, { at });
      if (r in results) results[r] += 1;
    }
    const settled = S.engine.settle();
    S.engine.markBase(base.rows, base.record && base.record.everEntered);
    return { ok: true, settled, results };
  }

  function put(rows, { at }) {
    if (S.engine === null) return { ok: false };
    let n = 0;
    for (const row of rows) { const r = S.engine.put(row, { at }); if (r === "entered" || r === "revised") n += 1; }
    return { ok: true, changed: n };
  }

  function settle() {
    return S.engine === null ? null : S.engine.settle();
  }

  function setRead(ms) {
    if (Number.isFinite(ms)) S.readAt = S.readAt === null ? ms : Math.max(S.readAt, ms);
  }

  const aligner = () => ({
    column: (c, at) => S.engine.alignedTotals((x) => S.engine.column(x.name) === c, at),
    name: (n, at) => S.engine.alignedTotals((x) => x.name === n, at),
    newer: (at) => S.engine.newerThan(() => true, at),
  });

  function view({ now, scope = ALL_SCOPE, period = null, aligned = true }) {
    const e = S.engine;
    return ledgerView({
      now, scope, period,
      live: { payload: { rows: e.heldRows(), record: { date: S.session, everEntered: e.seenTotal() } }, readAt: S.readAt, session: S.session },
      nightly: S.nightly, breadth: S.breadth ? { payload: S.breadth } : null, universe: S.universe, clock: S.clock,
      booked: e.snapshot({ collect: scope.kind === "name" }), aligner: aligned ? aligner() : null,
    });
  }

  function deltaCheck(base) {
    const bad = [];
    for (const row of base.rows) {
      if (!Number.isFinite(row.dm) && row.dm !== null) continue;
      const mine = deltaMicro(row);
      if ((mine === undefined ? null : mine) !== row.dm) bad.push({ t: row.t, oc: row.oc, mine, server: row.dm });
    }
    return bad;
  }

  return {
    applyBase, put, settle, setRead, view, deltaCheck,
    verify: () => S.engine.verify(),
    engine: () => S.engine,
    session: () => S.session,
    readAt: () => S.readAt,
    heldKeys: () => S.engine.heldKeys(),
    fingerprint: () => S.engine.fingerprint(),
    stats: () => S.engine.stats(),
    newestEnd: () => S.engine.newestEnd(),
    seenTotal: () => S.engine.seenTotal(),
  };
}

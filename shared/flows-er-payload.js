import { forward } from "./flows-calendar.js";
import { timingOf } from "./flows-reports.js";
import { vnum, isoDay, addDays } from "./flows-cross.js";
import { roundTo, joinSurprise } from "./flows-er-eps.js";
import { scoreEvents, todayOf, concordance, pooledVerdict } from "./flows-er-score.js";
import { impactInstant, ipoRows, listedRows, delistedRows } from "./flows-er-calendar.js";
import { scheduleRows, postRows } from "./flows-er-policy.js";
import { reduceFilters, reduceGrammar, reduceConfigs, reduceFired, halts14 } from "./flows-er-feed.js";
import { instantOf } from "./flows-time.js";

export const EVENTRISK_VERSION = 1;
export const EVENTRISK_BUDGET = 96 * 1024;
export const RISK_ROWS = 60;
export const EV_ROWS = 12;
export const HALT_DAYS = 14;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const whenOf = (v) => {
  const t = timingOf(v);
  return t === "pre" || t === "post" ? t : null;
};

const okBody = (r) => (isObj(r) && r.status === "ok" ? r.body : undefined);

const whyOf = (r) => (isObj(r) && typeof r.status === "string" && r.status !== "ok" ? (r.status === "skipped" ? "off" : r.status) : null);

export function buildRisk({ events, cardX, natr, pulse, sessionDate }) {
  if (!isObj(events) || !Array.isArray(events.rows)) {
    return { status: "unavailable", why: "failed", window: { sessions: null, through: null, names: 0 }, pooled: pooledVerdict([]), rows: [] };
  }
  const dated = events.rows.filter((r) => r && typeof r.t === "string" && isoDay(r.d)).slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const considered = dated.slice(0, RISK_ROWS);
  const rows = [];
  for (const r of considered) {
    const cx = typeof cardX === "function" ? cardX(r.t) : null;
    const earnings = cx && isObj(cx.earnings) ? cx.earnings : null;
    const evs = earnings && Array.isArray(earnings.events) ? earnings.events : [];
    const next = earnings && isObj(earnings.next) && earnings.next.d === r.d ? earnings.next : null;
    const when = next ? whenOf(next.when) : null;
    const scored = scoreEvents(evs);
    const emNow = vnum(r.im);
    const today = todayOf(emNow, scored);
    const epsPart = cx && isObj(cx.er) && isObj(cx.er.parts) && isObj(cx.er.parts.eps) && isObj(cx.er.parts.eps.x) && cx.er.parts.eps.x.ok === true ? cx.er.parts.eps.x.rows : [];
    const finEps = cx && isObj(cx.dx) && isObj(cx.dx.parts) && isObj(cx.dx.parts.financials) && isObj(cx.dx.parts.financials.x) && Array.isArray(cx.dx.parts.financials.x.eps) ? cx.dx.parts.financials.x.eps : [];
    const joined = joinSurprise(evs, epsPart, finEps).slice(0, EV_ROWS);
    const sur = concordance(joined);
    const last = joined.map((j) => j[3]).filter((x) => x !== null).slice(0, 4);
    const nr = natr && natr.get ? natr.get(r.t) : null;
    const natrV = nr && nr.ok ? nr.natr : null;
    const pu = pulse && pulse.get ? pulse.get(r.t) : null;
    const f = forward(r.d, sessionDate, when === "pre" ? "premarket" : when === "post" ? "postmarket" : null);
    rows.push({
      t: r.t,
      sec: typeof r.sector === "string" ? r.sector : null,
      d: r.d, when,
      ed: f ? f.ed : Number.isInteger(r.sdte) ? r.sdte : null,
      at: when ? impactInstant(r.d, when) : null,
      emNow: emNow === null ? null : roundTo(emNow, 6),
      hist: scored.hist,
      todayR: today.todayR, todayZ: today.todayZ,
      sur: { ...sur, last },
      natr: natrV, natrAt: nr && nr.ok ? nr.natrAt : null,
      ratioNatr: emNow !== null && natrV !== null && natrV > 0 ? roundTo(emNow / (natrV / 100), 4) : null,
      pulse: pu && pu.ok ? { at: pu.at, calls: pu.calls, puts: pu.puts, ratio: pu.ratio } : null,
      ev: joined,
    });
  }
  const pooled = pooledVerdict(rows);
  return {
    status: rows.length ? "ok" : "quiet",
    ...(rows.length ? {} : { why: "none" }),
    window: { sessions: events.windowSessions ?? null, through: events.through ?? null, names: rows.length },
    pooled,
    rows,
  };
}

export function buildIssues({ reads, prior, sessionDate, universe, readAt }) {
  const ipoBody = okBody(reads.ipo);
  const ipoWhy = whyOf(reads.ipo);
  const ipos = ipoBody !== undefined
    ? { asOf: sessionDate, ...ipoRows(ipoBody, sessionDate) }
    : { asOf: null, rows: [], why: ipoWhy || "failed" };
  const active = okBody(reads.active);
  const priorIssues = prior && isObj(prior.issues) ? prior.issues : null;
  let listed;
  let activeReadAt;
  if (active !== undefined) {
    listed = { asOf: sessionDate, ...listedRows(active, sessionDate) };
    activeReadAt = readAt;
  } else if (priorIssues && isObj(priorIssues.listed) && Array.isArray(priorIssues.listed.rows)) {
    const from = addDays(sessionDate, -30);
    listed = { ...priorIssues.listed, rows: priorIssues.listed.rows.filter((r) => r.d > from && r.d <= sessionDate) };
    activeReadAt = priorIssues.activeReadAt || null;
  } else {
    listed = { asOf: null, rows: [], why: whyOf(reads.active) || "unread" };
    activeReadAt = null;
  }
  const delReads = Array.isArray(reads.delisted) ? reads.delisted.filter((r) => isObj(r) && r.status === "ok") : [];
  const delFailed = Array.isArray(reads.delisted) ? reads.delisted.length - delReads.length : 0;
  let delisted;
  if (delReads.length) {
    const priorRows = priorIssues && isObj(priorIssues.delisted) && Array.isArray(priorIssues.delisted.rows) ? priorIssues.delisted.rows : [];
    const merged = delistedRows(delReads.map((r) => ({ date: r.date, body: r.body })), universe);
    const floor = addDays(sessionDate, -14);
    const keep = priorRows.filter((r) => r.d >= floor && !merged.rows.some((m) => m.t === r.t && m.d === r.d));
    const rows = [...merged.rows, ...keep].sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.t < b.t ? -1 : 1)).slice(0, 60);
    const days = [...new Set([...(priorIssues && isObj(priorIssues.delisted) && Array.isArray(priorIssues.delisted.days) ? priorIssues.delisted.days : []), ...merged.days])].sort().slice(-10);
    delisted = { asOf: sessionDate, days, rows, ...(delFailed ? { missing: delFailed } : {}) };
  } else if (priorIssues && isObj(priorIssues.delisted)) {
    delisted = priorIssues.delisted;
  } else {
    delisted = { asOf: null, days: [], rows: [], why: Array.isArray(reads.delisted) && reads.delisted.length ? "failed" : "unread" };
  }
  const parts = [ipos, listed, delisted];
  const ok = parts.filter((p) => !p.why);
  return {
    status: ok.length === 3 ? (ipos.rows.length || listed.rows.length || delisted.rows.length ? "ok" : "quiet") : ok.length ? "partial" : "unavailable",
    ...(ok.length ? {} : { why: ipos.why || "failed" }),
    ipos, listed, delisted, activeReadAt,
  };
}

export function buildPolicy({ reads, sessionDate, universe }) {
  const sched = Array.isArray(reads.schedule) ? reads.schedule.filter((r) => isObj(r) && r.status === "ok") : [];
  const schedFailed = Array.isArray(reads.schedule) ? reads.schedule.length - sched.length : 0;
  const postsBody = okBody(reads.posts);
  const schedule = sched.length || !Array.isArray(reads.schedule) || !reads.schedule.length
    ? scheduleRows(sched.map((r) => ({ body: r.body })), sessionDate) : { rows: [], dates: [], total: 0 };
  const posts = postsBody !== undefined ? postRows(postsBody, sessionDate, universe) : { rows: [], total: 0, dropped: 0, from: null };
  const sOk = sched.length > 0;
  const pOk = postsBody !== undefined;
  return {
    status: sOk && pOk ? (schedule.rows.length || posts.rows.length ? "ok" : "quiet") : sOk || pOk ? "partial" : "unavailable",
    ...(sOk || pOk ? {} : { why: whyOf(reads.posts) || "failed" }),
    schedule: { dates: schedule.dates, rows: schedule.rows.map((r) => ({ d: r.d, at: r.at, type: r.type, text: r.text, where: r.where, cov: r.cov, phase: r.phase })), ...(schedFailed ? { missing: schedFailed } : {}), ...(sOk ? {} : { why: whyOf((reads.schedule || [])[0]) || "failed" }) },
    posts: { from: posts.from, rows: posts.rows, dropped: posts.dropped, ...(pOk ? {} : { why: whyOf(reads.posts) || "failed" }) },
  };
}

export function buildFeed({ reads, prior, readAt, fromInstant }) {
  const priorFeed = prior && isObj(prior.feed) ? prior.feed : null;
  const fb = okBody(reads.filters);
  const gOverview = okBody(reads.grammar);
  const gTargets = {};
  for (const [id, r] of Object.entries(isObj(reads.grammarTargets) ? reads.grammarTargets : {})) {
    gTargets[id] = isObj(r) && r.status === "ok" ? r.body : { fail: whyOf(r) || "failed" };
  }
  let types = priorFeed && Array.isArray(priorFeed.types) ? priorFeed.types : null;
  let unknownTypes = priorFeed ? priorFeed.unknownTypes ?? 0 : 0;
  let grammar = priorFeed && isObj(priorFeed.grammar) ? priorFeed.grammar : null;
  let readTime = priorFeed ? priorFeed.readAt || null : null;
  if (fb !== undefined) {
    const f = reduceFilters(fb);
    if (f.ok) { types = f.types.map((t) => ({ id: t.id, label: t.label, can: t.can, perDay: t.perDay, fields: t.fields, target: t.target })); unknownTypes = f.unknownTypes; readTime = readAt; }
  }
  if (gOverview !== undefined || Object.keys(gTargets).length) {
    const g = reduceGrammar(gOverview, gTargets);
    grammar = { targets: g.targets.map((t) => ({ id: t.id, fields: t.fields, ...(t.why ? { why: t.why } : {}) })) };
  }
  const cfgBody = okBody(reads.configs);
  const cfg = cfgBody !== undefined ? reduceConfigs(cfgBody) : { fail: "unread" };
  const firedBody = okBody(reads.fired);
  const fired = firedBody !== undefined ? reduceFired(firedBody, fromInstant) : null;
  const owner = cfg.ok || fired ? { configs: cfg.ok ? cfg.configs : null, fired: fired ? fired.fired : null } : null;
  return {
    feed: {
      status: types ? "ok" : "unavailable",
      ...(types ? {} : { why: whyOf(reads.filters) || "unread" }),
      readAt: readTime,
      types: types || [],
      grammar: grammar || { targets: [] },
      unknownTypes,
      owner,
    },
    cfg, fired,
  };
}

export function buildEventRisk(input) {
  const { sessionDate, generatedAt, fixture = false, events, cardX, natr, pulse, reads, prior, universe, basis, readAt } = input;
  const risk = buildRisk({ events, cardX, natr, pulse, sessionDate });
  const issues = buildIssues({ reads, prior, sessionDate, universe, readAt: readAt || generatedAt });
  const policy = buildPolicy({ reads, sessionDate, universe });
  const fromMs = instantOf(generatedAt);
  const fromInstant = fromMs === null ? null : fromMs - HALT_DAYS * 86400000;
  const { feed, cfg, fired } = buildFeed({ reads, prior, readAt: readAt || generatedAt, fromInstant });
  const halts = fired
    ? { status: "ok", ...halts14(fired, cfg.ok ? cfg.configs : null) }
    : { status: "unavailable", why: whyOf(reads.fired) || "failed", configured: cfg.ok ? cfg.configs.some((c) => c.type === "trading_state") : null, rows: [] };
  if (fired && !fired.rows.length) halts.status = "quiet";
  const payload = {
    v: EVENTRISK_VERSION,
    sessionDate, generatedAt,
    ...(fixture ? { fixture: true } : {}),
    basis: { calls: basis && Number.isInteger(basis.calls) ? basis.calls : 0, refused: (basis && basis.refused) || {}, failed: (basis && basis.failed) || {}, shed: [] },
    risk, issues, policy, halts14: halts, feed,
  };
  return payload;
}

const bytesOf = (p) => JSON.stringify(p).length;

export function fitEventRisk(payload, max = EVENTRISK_BUDGET) {
  const p = JSON.parse(JSON.stringify(payload));
  const shed = Array.isArray(p.basis && p.basis.shed) ? p.basis.shed : (p.basis.shed = []);
  const over = () => bytesOf(p) > max;
  const steps = [
    ["risk.ev8", () => { for (const r of p.risk.rows) r.ev = r.ev.slice(0, 8); }],
    ["risk.ev6", () => { for (const r of p.risk.rows) r.ev = r.ev.slice(0, 6); }],
    ["posts.text", () => { for (const r of p.policy.posts.rows) if (r.text.length > 140) { r.text = r.text.slice(0, 139).replace(/\s+\S*$/, "") + "…"; r.cut = 1; } }],
    ["posts.30", () => { p.policy.posts.rows = p.policy.posts.rows.slice(0, 30); }],
    ["issues.30", () => { p.issues.listed.rows = p.issues.listed.rows.slice(0, 30); p.issues.delisted.rows = p.issues.delisted.rows.slice(0, 30); }],
    ["halts.60", () => { p.halts14.rows = p.halts14.rows.slice(0, 60); }],
    ["feed.grammar", () => { p.feed.grammar = { targets: [] }; p.feed.grammarStatus = "shed"; }],
    ["risk.ev0", () => { for (const r of p.risk.rows) r.ev = []; }],
  ];
  for (const [name, run] of steps) {
    if (!over()) break;
    run();
    shed.push(name);
  }
  if (over()) {
    const rows = p.risk.rows;
    let cut = rows.length;
    while (cut > 0 && over()) {
      cut--;
      const edge = rows[cut] ? rows[cut].d : null;
      while (cut > 0 && rows[cut - 1].d === edge) cut--;
      p.risk.rows = rows.slice(0, cut);
    }
    shed.push("risk.rows");
  }
  return p;
}

import {
  vnum, vstr, isoDay, addDays, nextWeekdayIso, sessionsBetween, easternDayOfInstant,
  medianOf, mean, SILENCE,
} from "./flows-cross.js";

export const EARNINGS_EVENTS = 12;

export const EARNINGS_MIN_EVENTS = 6;

export const CALENDAR_SESSIONS = 5;

export const CALENDAR_ROWS_PER_DAY = 40;

export const MACRO_ROWS = 40;

export const FDA_HORIZON_DAYS = 120;

export const FDA_ROWS = 60;

export const MOVE_FIELDS = Object.freeze({
  m1d: ["post_earnings_move_1d", 1],
  m3d: ["post_earnings_move_3d", 3],
  m1w: ["post_earnings_move_1w", 5],
  m2w: ["post_earnings_move_2w", 10],
  pre1d: ["pre_earnings_move_1d", 0],
  pre1w: ["pre_earnings_move_1w", 0],
  ls1d: ["long_straddle_1d", 1],
  ls1w: ["long_straddle_1w", 5],
  ss1d: ["short_straddle_1d", 1],
  ss1w: ["short_straddle_1w", 5],
});

export function reactionDay(reportDate, reportTime) {
  const d = isoDay(reportDate);
  if (!d) return null;
  const when = String(reportTime || "").toLowerCase();
  if (when === "premarket" || when === "pre" || when === "bmo") return d;
  return nextWeekdayIso(d);
}

export function earningsHistory(rows, {
  sessionDate = null, maxEvents = EARNINGS_EVENTS, minEvents = EARNINGS_MIN_EVENTS,
} = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r === "object" && isoDay(r.report_date))
    .slice()
    .sort((a, b) => (a.report_date < b.report_date ? 1 : a.report_date > b.report_date ? -1 : 0));

  let next = null;
  for (const r of list) {
    const d = isoDay(r.report_date);
    if (sessionDate && d > sessionDate) {
      next = { d, when: vstr(r.report_time), source: vstr(r.source),
        confirmed: vstr(r.source) !== null && vstr(r.source) !== "estimation",
        sessions: sessionsBetween(sessionDate, d) };
    }
  }

  const events = [];
  let masked = 0;
  for (const r of list) {
    const d = isoDay(r.report_date);
    if (sessionDate && d > sessionDate) continue;
    const em = vnum(r.expected_move_perc);
    if (em === null) continue;
    const rd = reactionDay(d, r.report_time);
    const lag = sessionDate && rd ? sessionsBetween(rd, sessionDate) : null;
    const ev = { d, when: vstr(r.report_time), rd, em };
    for (const [k, [field, needs]] of Object.entries(MOVE_FIELDS)) {
      const v = vnum(r[field]);
      const known = !sessionDate || (rd !== null && rd <= sessionDate && (needs === 0 || (lag !== null && lag >= needs - 1)));
      if (v !== null && !known) masked++;
      ev[k] = known ? v : null;
    }
    ev.r = ev.m1d !== null && em > 0 ? Math.abs(ev.m1d) / em : null;
    events.push(ev);
    if (events.length >= maxEvents) break;
  }

  const withR = events.filter((e) => e.r !== null);
  const unitSuspect = events.some((e) => e.em > 1) ||
    (withR.length > 0 && medianOf(withR.map((e) => Math.abs(e.m1d))) > 1);
  const straddles = (k) => events.map((e) => e[k]).filter((v) => v !== null);
  const drift = events
    .filter((e) => e.m1d !== null && e.m1w !== null && e.m1d !== 0)
    .map((e) => Math.sign(e.m1d) * (e.m1w - e.m1d));
  const hit = (k) => {
    const v = straddles(k);
    return v.length ? v.filter((x) => x > 0).length / v.length : null;
  };

  const base = {
    next,
    n: withR.length,
    events: events.map((e) => [e.d, e.when, e.em, e.m1d, e.m1w, e.pre1w, e.ls1d, e.ls1w]),
    eventCols: ["report date", "report time", "expected move (fraction)", "1d move", "1w move",
      "pre 1w move", "long straddle 1d", "long straddle 1w"],
    masked,
    minEvents,
  };
  if (unitSuspect) return { status: "unavailable", reason: SILENCE.unit, ...base };
  if (withR.length < minEvents) {
    return { status: events.length ? "thin" : "quiet", reason: SILENCE.few, ...base,
      medianRatio: null, beat: null };
  }
  return {
    status: "ok",
    ...base,
    medianRatio: medianOf(withR.map((e) => e.r)),
    beat: withR.filter((e) => e.r > 1).length / withR.length,
    medianAbsMove: medianOf(withR.map((e) => Math.abs(e.m1d))),
    medianExpected: medianOf(withR.map((e) => e.em)),
    ls1dHit: hit("ls1d"), ls1dMean: mean(straddles("ls1d")),
    ls1wHit: hit("ls1w"), ls1wMean: mean(straddles("ls1w")),
    ss1dHit: hit("ss1d"),
    drift: drift.length ? medianOf(drift) : null,
    driftN: drift.length,
    runup: medianOf(events.map((e) => e.pre1w)),
    runupAbs: medianOf(events.map((e) => (e.pre1w === null ? null : Math.abs(e.pre1w)))),
    rules: {
      ratio: "r_i = |post_earnings_move_1d| / expected_move_perc, median over the last events",
      beat: "share of events with r_i > 1",
      drift: "median of sign(m1d) * (m1w - m1d): positive means the day-one move kept going",
      straddle: "hit = share of events whose vendor long_straddle value is > 0; mean in the vendor's unit (unverified)",
      masking: "a move is withheld when its window ends after the session, so a later re-run cannot see the future",
    },
  };
}

export function historyDigest(h) {
  if (!h || h.status !== "ok") return h ? { status: h.status, reason: h.reason || null, n: h.n || 0 } : null;
  const r3 = (v) => (v === null || v === undefined ? null : Number(v.toFixed(3)));
  return { status: "ok", n: h.n, r: r3(h.medianRatio), beat: r3(h.beat), hit: r3(h.ls1dHit), drift: r3(h.drift) };
}

export function shapeEarningsCalendar(rows, { cap = CALENDAR_ROWS_PER_DAY, sessionDate = null } = {}) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const t = vstr(r.symbol) || vstr(r.ticker);
    const d = isoDay(r.report_date);
    if (!t || !d) continue;
    const pre = vnum(r.pre_earnings_close);
    const post = vnum(r.post_earnings_close);
    const postDate = isoDay(r.post_earnings_date);
    const reacted = postDate && (!sessionDate || postDate <= sessionDate) && pre !== null && post !== null && pre > 0;
    out.push({
      t, d,
      when: vstr(r.report_time),
      em: vnum(r.expected_move_perc),
      emUsd: vnum(r.expected_move),
      mcap: vnum(r.marketcap),
      sp: r.is_s_p_500 === true,
      opt: typeof r.has_options === "boolean" ? r.has_options : null,
      sector: vstr(r.sector),
      src: vstr(r.source),
      realized: reacted ? post / pre - 1 : null,
      postDate: reacted ? postDate : null,
    });
  }
  out.sort((a, b) => (b.mcap ?? -1) - (a.mcap ?? -1) || (a.t < b.t ? -1 : 1));
  return { rows: out.slice(0, cap), seen: out.length, shed: Math.max(0, out.length - cap) };
}

export function reactionGauge(rows) {
  const priced = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.realized !== null && r.realized !== undefined && r.em !== null && r.em > 0)
    .map((r) => ({ t: r.t, ratio: Math.abs(r.realized) / r.em, realized: r.realized, em: r.em }));
  if (!priced.length) return { status: "quiet", reason: SILENCE.absent, n: 0 };
  return {
    status: "ok",
    n: priced.length,
    medianRatio: medianOf(priced.map((p) => p.ratio)),
    beat: priced.filter((p) => p.ratio > 1).length / priced.length,
    rows: priced.slice(0, 30).map((p) => [p.t, Number(p.realized.toFixed(4)), Number(p.em.toFixed(4)), Number(p.ratio.toFixed(3))]),
    rule: "ratio = |post_earnings_close / pre_earnings_close - 1| / expected_move_perc over the reporters that reacted by the session",
  };
}

export function sessionCloseInstant(day) {
  const d = isoDay(day);
  if (!d) return null;
  for (const utcHour of [20, 21]) {
    const ms = Date.parse(`${d}T${String(utcHour).padStart(2, "0")}:00:00Z`);
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "numeric", hourCycle: "h23",
    }).format(new Date(ms));
    if (Number(hour) === 16) return ms;
  }
  return Date.parse(`${d}T20:00:00Z`);
}

const MACRO_TAGS = [
  ["fomc", /\bFOMC\b|Fed(eral)?\s+(Funds|Reserve|Interest)|Interest Rate Decision|Powell/i],
  ["cpi", /\bCPI\b|Consumer Price/i],
  ["ppi", /\bPPI\b|Producer Price/i],
  ["nfp", /Non-?farm|Payroll|Employment Situation/i],
  ["pce", /\bPCE\b|Personal Consumption/i],
  ["gdp", /\bGDP\b|Gross Domestic/i],
  ["claims", /Jobless Claims/i],
];

export function macroTag(event) {
  const s = String(event || "");
  for (const [tag, re] of MACRO_TAGS) if (re.test(s)) return tag;
  return null;
}

const looseNum = (v) => {
  const n = vnum(v);
  if (n !== null) return n;
  const s = vstr(v);
  if (!s) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(s.replace(/,/g, ""));
  return m ? Number(m[1]) : null;
};

export function shapeEconomicCalendar(rows, { sessionDate = null, cap = MACRO_ROWS } = {}) {
  const close = sessionDate ? sessionCloseInstant(sessionDate) : null;
  const out = [];
  let past = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const at = vstr(r.time);
    const ms = at ? Date.parse(at) : NaN;
    const event = vstr(r.event);
    if (!event || !Number.isFinite(ms)) continue;
    if (close !== null && ms <= close) { past++; continue; }
    const day = easternDayOfInstant(at);
    out.push({
      at: new Date(ms).toISOString(),
      day,
      sd: sessionDate && day ? sessionsBetween(sessionDate, day) : null,
      event,
      type: vstr(r.type),
      tag: macroTag(event),
      prev: looseNum(r.prev), prevRaw: r.prev === undefined ? null : r.prev,
      forecast: looseNum(r.forecast), forecastRaw: r.forecast === undefined ? null : r.forecast,
      period: vstr(r.reported_period),
    });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    status: out.length ? "ok" : "quiet",
    ...(out.length ? {} : { reason: SILENCE.absent }),
    rows: out.slice(0, cap),
    seen: out.length + past, past,
    tags: out.reduce((m, r) => { if (r.tag) m[r.tag] = (m[r.tag] || 0) + 1; return m; }, {}),
    rule: "events after the session's 16:00 ET close; the route takes no date, so earlier rows are dropped",
  };
}

const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, "0");

export function parseFdaTarget(raw) {
  const s = vstr(raw);
  if (!s) return null;
  const u = s.toUpperCase().replace(/\s+/g, " ").trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(u)) && isoDay(u)) return { from: u, to: u, p: "day", raw: s };
  if ((m = /^(\d{4})-(\d{2})$/.exec(u))) {
    const y = +m[1], mo = +m[2];
    if (mo >= 1 && mo <= 12) return { from: `${y}-${pad(mo)}-01`, to: lastDay(y, mo), p: "month", raw: s };
  }
  const yq = /^(\d{4})[- ]?Q([1-4])$/.exec(u) || /^Q([1-4])[- ]?(\d{4})$/.exec(u);
  if (yq) {
    const y = +(yq[1].length === 4 ? yq[1] : yq[2]);
    const q = +(yq[1].length === 4 ? yq[2] : yq[1]);
    return { from: `${y}-${pad(q * 3 - 2)}-01`, to: lastDay(y, q * 3), p: "quarter", raw: s };
  }
  const yh = /^(\d{4})[- ]?H([12])$/.exec(u) || /^H([12])[- ]?(\d{4})$/.exec(u);
  if (yh) {
    const y = +(yh[1].length === 4 ? yh[1] : yh[2]);
    const h = +(yh[1].length === 4 ? yh[2] : yh[1]);
    return { from: `${y}-${h === 1 ? "01" : "07"}-01`, to: h === 1 ? `${y}-06-30` : `${y}-12-31`, p: "half", raw: s };
  }
  const named = /^(\d{4})[- ]?(EARLY|MID|LATE)$/.exec(u) || /^(EARLY|MID|LATE)[- ]?(\d{4})$/.exec(u);
  if (named) {
    const y = +(/\d{4}/.exec(u)[0]);
    const w = /EARLY|MID|LATE/.exec(u)[0];
    const span = { EARLY: ["01-01", "04-30"], MID: ["04-01", "09-30"], LATE: ["09-01", "12-31"] }[w];
    return { from: `${y}-${span[0]}`, to: `${y}-${span[1]}`, p: w.toLowerCase(), raw: s };
  }
  if ((m = /^(\d{4})$/.exec(u))) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31`, p: "year", raw: s };
  return { from: null, to: null, p: "unparsed", raw: s };
}

export function shapeFdaCalendar(rows, {
  sessionDate = null, horizonDays = FDA_HORIZON_DAYS, cap = FDA_ROWS, carded = null,
} = {}) {
  const end = sessionDate ? addDays(sessionDate, horizonDays) : null;
  const out = [];
  let unparsed = 0, outside = 0, noOptions = 0;
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const t = vstr(r.ticker);
    if (!t) continue;
    if (r.has_options === false) { noOptions++; continue; }
    const tgt = parseFdaTarget(r.target_date) || (isoDay(r.end_date) ? { from: r.end_date, to: r.end_date, p: "day", raw: r.end_date } : null);
    if (!tgt || !tgt.from) { unparsed++; continue; }
    if (sessionDate && (tgt.to < sessionDate || (end && tgt.from > end))) { outside++; continue; }
    const key = vstr(r.unique_identifier) || `${t}|${vstr(r.drug)}|${tgt.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      t,
      drug: (vstr(r.drug) || "").slice(0, 60) || null,
      ind: (vstr(r.indication) || "").slice(0, 60) || null,
      cat: vstr(r.catalyst) || vstr(r.event_type),
      st: vstr(r.status),
      tgt: { from: tgt.from, to: tgt.to, p: tgt.p, raw: tgt.raw },
      mcap: vnum(r.marketcap),
      carded: carded ? carded.has(t) : null,
    });
  }
  out.sort((a, b) => (a.tgt.from < b.tgt.from ? -1 : a.tgt.from > b.tgt.from ? 1 : (a.t < b.t ? -1 : 1)));
  return {
    status: out.length ? "ok" : "quiet",
    ...(out.length ? {} : { reason: SILENCE.absent }),
    rows: out.slice(0, cap),
    kept: Math.min(out.length, cap), inWindow: out.length,
    unparsed, outside, noOptions,
    horizonDays,
    rule: "optionable names whose target window overlaps [session, session + horizon]; free-text targets are parsed to a window with a precision",
  };
}

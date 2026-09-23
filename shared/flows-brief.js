export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const rows = (p) => (p && p.status !== "pending" && Array.isArray(p.rows) ? p.rows : null);
const answered = (p) => (p && typeof p === "object" && p.status !== "pending" ? p : null);

export function silenceOf(payload, what, list) {
  if (payload === null || payload === undefined) {
    return { kind: "unreadable", what,
      say: "The " + what + " could not be read, so nothing about it is stated here. " +
           "That is a fault on this page rather than a fact about the session." };
  }
  if (typeof payload !== "object") {
    return { kind: "unreadable", what,
      say: "The " + what + " arrived in a shape this briefing cannot read." };
  }
  if (payload.status === "pending") {
    return { kind: "pending", what,
      say: "The " + what + " has not been published for this session yet. " +
           "Nothing has been measured, so nothing is claimed." };
  }
  const r = list === undefined ? rows(payload) : (Array.isArray(list) ? list : null);
  if (r !== null && r.length === 0) {
    return { kind: "quiet", what,
      say: "The " + what + " was measured and holds nothing. That is a reading, not a gap." };
  }

  if (r === null) {
    return { kind: "unreadable", what,
      say: "The " + what + " was published but this briefing could not find the " +
           "readings inside it, so nothing about it is stated here. That is a fault " +
           "on this page rather than a fact about the session." };
  }
  return null;
}

const fact = (id, say, n, lead) => {
  const f = { id, say, n: n || {} };
  if (lead && typeof lead === "object" && Array.isArray(lead.keys) && lead.keys.length) {
    f.lead = { label: String(lead.label || ""), keys: lead.keys.slice(),
      unit: lead.unit === undefined ? null : String(lead.unit) };
    if (lead.den && typeof lead.den === "object" && lead.den.key) {
      f.lead.den = { key: String(lead.den.key), word: String(lead.den.word || "") };
    }
  }
  return f;
};

const plural = (k, one, many) => (k === 1 ? one : many);

const stampSaid = (iso) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)
  ? iso.slice(0, 10) + " " + iso.slice(11, 16) + " UTC" : iso);

export const BRIEF_SLOTS = Object.freeze({
  long: "board:long",
  short: "board:short",
  watch: "board:watch",
  events: "events",
  alerts: "flowalerts",
  sectorPremium: "sector:premium",
});

export function briefStoreFrom(published) {
  const p = published && typeof published === "object" ? published : {};
  const out = {};
  for (const [slot, key] of Object.entries(BRIEF_SLOTS)) {
    out[slot] = Object.hasOwn(p, key) ? p[key] : { status: "pending" };
  }
  return out;
}

export function briefToday(store) {
  const s = store || {};
  const facts = [];
  const silences = [];

  const lng = answered(s.long), sht = answered(s.short);
  for (const [p, what] of [[s.long, "bullish board"], [s.short, "bearish board"]]) {
    const q = silenceOf(p, what);
    if (q) silences.push(q);
  }

  const lr = rows(s.long), sr = rows(s.short);
  const meta = lng || sht || null;
  const session = meta && meta.sessionDate ? String(meta.sessionDate) : null;

  const bull = lng ? num(lng.cleared) ?? (lr ? lr.length : null) : null;
  const bear = sht ? num(sht.cleared) ?? (sr ? sr.length : null) : null;
  const scored = meta ? num(meta.scored) : null;
  const neutral = meta ? num(meta.neutral) : null;

  if (bull !== null || bear !== null) {
    facts.push(fact("tilt",
      (bull === null ? "—" : bull) + " " + plural(bull, "name leans", "names lean") + " bullish and " +
      (bear === null ? "—" : bear) + " lean bearish" +
      (scored === null ? "" : " out of " + scored + " scored") +
      (neutral === null ? "" : ", with " + neutral + " inside the dead band") + ".",
      { bullish: bull, bearish: bear, scored, neutral, session },
      { label: "lean bull / bear", keys: ["bullish", "bearish"], unit: "names",
        den: { key: "scored", word: "scored" } }));
  }

  for (const [rs, side] of [[lr, "bullish"], [sr, "bearish"]]) {
    if (!rs || !rs.length) continue;
    const top = rs.find((r) => num(r && r.r) === 1) || rs[0];
    if (!top || !top.t) continue;
    const sc = num(top.s), cnv = num(top.cnv);
    facts.push(fact("top:" + side,
      "The " + side + " side is led by " + top.t +
      (sc === null ? "" : " at " + (sc < 0 ? "−" + Math.abs(sc) : (sc > 0 ? "+" : "") + sc)) +
      (cnv === null ? "" : ", conviction " + cnv) + ".",
      { ticker: String(top.t), score: sc, magnitude: sc === null ? null : Math.abs(sc),
        conviction: cnv, side }));
  }

  const sec = answered(s.sectorPremium);
  const secRows = sec && Array.isArray(sec.sectors) ? sec.sectors : null;
  if (sec && secRows && secRows.length) {
    const scored2 = secRows
      .map((r) => ({ t: (r && r.etf) || (r && r.sector), lean: num(r && r.leanRatio) }))
      .filter((r) => r.t && r.lean !== null)
      .sort((a, b) => b.lean - a.lean);
    if (scored2.length) {
      const hi = scored2[0], lo = scored2[scored2.length - 1];

      const returned = num(sec.returned);
      facts.push(fact("sectors",
        "Sector premium leans most bullish in " + hi.t + " and most bearish in " + lo.t +
        (returned !== null && returned !== scored2.length
          ? ", across the " + scored2.length + " of " + returned + " returned " +
            plural(returned, "basket", "baskets") + " that had a readable lean."
          : ", across " + scored2.length + " " + plural(scored2.length, "basket", "baskets") +
            " with a readable lean."),
        { mostBullish: hi.t, mostBullishLean: hi.lean,
          mostBearish: lo.t, mostBearishLean: lo.lean,
          readable: scored2.length, returned }));
    } else {

      facts.push(fact("sectors",
        "No sector basket returned both sides of its premium this session, so no lean " +
        "is stated for any of the " + secRows.length + " returned.",
        { returned: secRows.length, readable: 0 }));
    }
  } else {
    const q = silenceOf(s.sectorPremium, "sector premium lean", secRows);
    if (q) silences.push(q);
  }

  const alerts = briefAlertsFact(s.alerts);
  if (alerts) facts.push(alerts);

  return { session, facts, silences };
}

export function briefAlertsFact(payload) {
  const al = answered(payload);
  const ar = rows(payload);
  if (!al || !ar || !ar.length) return null;
  const readAt = typeof al.readAt === "string" && al.readAt ? al.readAt : null;
  const record = al.record && typeof al.record === "object" ? al.record : null;
  const reads = record ? num(record.reads) : null;
  const day = record && typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)
    ? record.date : null;
  const across = reads !== null && reads > 1;
  const seen = num(al.seen);
  const more = seen !== null && Number.isInteger(seen) && seen > ar.length ? seen : null;
  const lead = more === null ? ar.length : more;
  return fact("alerts",
    lead + " flagged " + plural(lead, "window", "windows") + " on the tape" +
    (across ? " across " + reads + " reads" + (day ? " on " + day : "") : "") +
    (more === null ? "" : ", " + ar.length + " of them held on the page") +
    (readAt ? (across ? ", the latest " : ", read ") + stampSaid(readAt) : "") + ".",
    { flagged: ar.length, readAt,
      readSaid: readAt ? stampSaid(readAt) : null,
      ...(more === null ? {} : { seen: more }),
      ...(across ? { reads, recordDate: day } : {}) });
}

export function briefYesterday(store) {
  const s = store || {};
  const facts = [];
  const silences = [];

  const lr = rows(s.long), sr = rows(s.short);
  const meta = answered(s.long) || answered(s.short) || null;

  const memory = meta && meta.memory && typeof meta.memory === "object" ? meta.memory : null;
  const prior = memory && memory.sessionDate ? String(memory.sessionDate) : null;

  if (!lr && !sr) {
    silences.push({ kind: "unreadable", what: "both boards",
      say: "Neither board could be read, so nothing is stated about what changed." });
    return { prior, facts, silences };
  }

  if (prior === null) {
    silences.push({ kind: "pending", what: "board memory",
      say: "This board carries no dated prior-board comparison, so no name is called new " +
           "or returning here. The score archive on Overview may still carry earlier readings." +
           (memory && typeof memory.note === "string" ? " " + memory.note : "") });
    return { prior, facts, silences };
  }

  const all = [].concat(lr || [], sr || []);
  const fresh = all.filter((r) => r && r.nw === true);
  const held = all.filter((r) => r && r.hy === true);

  facts.push(fact("entered",
    fresh.length + " " + plural(fresh.length, "name is", "names are") +
    " new to a side since the " + prior + " board.",
    { entered: fresh.length, prior },
    { label: "new to a side", keys: ["entered"], unit: "names" }));

  if (held.length) {
    facts.push(fact("incumbents",
      held.length + " " + plural(held.length, "name is", "names are") +
      " on the board by incumbency rather than by clearing the entry rank.",
      { incumbents: held.length, prior }));
  }

  const moved = all
    .map((r) => ({ t: r && r.t, dr: num(r && r.dr), r0: num(r && r.r0), r: num(r && r.r) }))
    .filter((r) => r.t && r.dr !== null && r.dr !== 0);
  if (moved.length) {

    const climbs = moved.filter((m) => m.dr > 0).length;
    const falls = moved.filter((m) => m.dr < 0).length;
    facts.push(fact("moves",
      climbs + " " + plural(climbs, "name", "names") + " climbed and " +
      falls + " fell against the " + prior + " board, of " + moved.length +
      " with a rank on both.",
      { climbed: climbs, fell: falls, comparable: moved.length, prior }));

    const up = moved.slice().sort((a, b) => b.dr - a.dr)[0];
    const down = moved.slice().sort((a, b) => a.dr - b.dr)[0];
    const ends = (m) => (m.r0 === null || m.r === null ? "" : ", from rank " + m.r0 + " to " + m.r);
    if (up && up.dr > 0) {
      facts.push(fact("climbed",
        up.t + " climbed " + up.dr + " " + plural(up.dr, "place", "places") + ends(up) + ".",
        { ticker: up.t, places: up.dr, from: up.r0, to: up.r }));
    }
    if (down && down.dr < 0) {
      const n = Math.abs(down.dr);
      facts.push(fact("fell",
        down.t + " fell " + n + " " + plural(n, "place", "places") + ends(down) + ".",
        { ticker: down.t, places: n, from: down.r0, to: down.r }));
    }
  }

  return { prior, facts, silences };
}

export function briefNext(store, options) {
  const s = store || {};
  const o = options || {};
  const facts = [];
  const silences = [];

  const meta = answered(s.long) || answered(s.short) || answered(s.events) || null;
  const origin = meta && meta.gateOrigin ? String(meta.gateOrigin) : null;
  const gateDays = meta ? num(meta.gateDays) : null;

  const lr = rows(s.long), sr = rows(s.short);
  const board = [].concat(lr || [], sr || []);

  const ev = answered(s.events);
  const evRows = rows(s.events);
  const due = (evRows || [])
    .map((r) => ({ t: r && r.t, dte: num(r && r.dte) }))
    .filter((r) => r.t && r.dte !== null && r.dte >= 0)
    .sort((a, b) => a.dte - b.dte);

  if (due.length) {
    const beforeNext = due.filter((r) => r.dte <= 1);
    if (beforeNext.length) {
      facts.push(fact("reporting",
        beforeNext.length + " " + plural(beforeNext.length, "name reports", "names report") +
        " before the next session: " + beforeNext.map((r) => r.t).join(", ") + ".",
        { count: beforeNext.length, tickers: beforeNext.map((r) => r.t), origin },
        { label: "report before next session", keys: ["count"], unit: "names" }));
    } else {

      const near = due[0];
      facts.push(fact("reporting",
        "No name on the calendar reports before the next session; the nearest of " +
        due.length + " dated is " + near.t + " in " + near.dte + " " +
        plural(near.dte, "session", "sessions") + ".",
        { count: 0, dated: due.length, nearest: near.t, nearestDte: near.dte, origin }));
    }
  } else if (ev) {
    silences.push({ kind: "quiet", what: "the earnings calendar",
      say: "The earnings calendar was read and carries no dated report from this session " +
           "onward, so nothing is scheduled. That is a reading, not a gap." });
  } else {
    const q = silenceOf(s.events, "earnings calendar", evRows);
    if (q) silences.push(q);
  }

  const gatedCount = ev && ev.byStage ? num(ev.byStage.gated) : null;
  if (gatedCount !== null && gateDays !== null) {
    facts.push(fact("gate",
      gatedCount + " " + plural(gatedCount, "name was", "names were") + " held out of scoring " +
      "by the " + gateDays + "-day earnings gate, so " + plural(gatedCount, "it is", "they are") +
      " absent from both boards on the calendar rather than on a signal.",
      { count: gatedCount, gateDays, origin }));
  }

  const wr = rows(s.watch);
  if (wr && wr.length) {
    const first = wr.find((r) => num(r && r.r) === 1) || wr[0];
    const resid = first ? num(first.resid) : null;
    facts.push(fact("nearly-in",
      wr.length + " " + plural(wr.length, "name sits", "names sit") + " inside the dead band" +
      (first && first.t
        ? ", " + first.t + " ranked nearest its edge" +
          (resid === null ? "" : " at a residual of " + resid)
        : "") + ".",
      { inBand: wr.length,
        nearest: first && first.t ? String(first.t) : null,
        nearestResidual: resid }));
  } else {
    const q = silenceOf(s.watch, "watch board");
    if (q) silences.push(q);
  }

  const flips = board
    .map((r) => ({ t: r && r.t, d: num(r && r.gFlipDist) }))
    .filter((r) => r.t && r.d !== null)
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  if (flips.length) {
    const f = flips[0];
    const pctSaid = (Math.abs(f.d) * 100).toFixed(1);
    const away = pctSaid + "% " + (f.d > 0 ? "above" : "below") + " spot";
    facts.push(fact("flip",
      f.t + " sits closest to its gamma flip, which is " + (f.d === 0 ? "at spot" : away) + ".",
      { ticker: f.t, distance: f.d, distancePct: Number(pctSaid) }));
  }

  if (!facts.length) {
    silences.push({ kind: "quiet", what: "the next session",
      say: "Nothing is scheduled and no name sits on a threshold this session, so there is " +
           "nothing to say about the next one. That is a measured emptiness." });
  }

  return { origin, gateDays, facts, silences, isForecast: false };
}

export function buildBrief(store) {
  return {
    today: briefToday(store),
    yesterday: briefYesterday(store),
    next: briefNext(store),
    notes: {
      measured: "Every figure above was measured by the nightly pipeline at the close of the " +
        "session it names and is quoted here unchanged; nothing on this page is computed " +
        "live or forecast.",
      scope: "Scores rank attention on one session. A high score is a reason to look, not a " +
        "direction, a horizon or a return.",
      silence: "Where a fact is absent the brief says which of three things happened: not " +
        "published, not readable, or measured and found empty. It never fills the gap with " +
        "a neutral value.",
      filings: "Congressional and insider rows are statutory disclosures filed days to weeks " +
        "after the trade. They describe what was disclosed, not what is being done now.",
    },
  };
}

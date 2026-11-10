import { fixedHalfUp } from "./flows-display-round.js";

export const TRANSPORT = Object.freeze({
  v: 1,
  classes: Object.freeze([
    Object.freeze({ id: "member", rank: 0, floor: 60 }),
    Object.freeze({ id: "live", rank: 1, floor: 40 }),
    Object.freeze({ id: "nightly", rank: 2, floor: 0 }),
    Object.freeze({ id: "background", rank: 3, floor: 0 }),
  ]),
  line: Object.freeze({
    start: 500,
    min: 250,
    max: 1500,
    raise: 1.25,
    cut: 0.7,
    clean: 0.002,
    dirty: 0.02,
    slowClean: 0.08,
    slowDirty: 0.25,
    evidenceCalls: 5000,
    evidenceUse: 0.6,
    settle: 1.15,
    probe: 1.08,
    reprobeNights: 14,
    history: 14,
  }),
});

export const LINE_VERDICTS = Object.freeze(["start", "thin", "idle", "hold", "raise", "capped", "ease", "cut"]);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const whole = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

const want = (v) => (v === Infinity ? Infinity : whole(v));

export function allocate({ line, demand = {}, classes = TRANSPORT.classes } = {}) {
  const total = whole(line);
  const seen = new Set();
  const list = (Array.isArray(classes) ? classes : []).map((c, i) => {
    const id = c && typeof c.id === "string" ? c.id : "";
    if (!id || seen.has(id)) throw new TypeError("a class needs an id of its own");
    seen.add(id);
    const rank = typeof c.rank === "number" && Number.isFinite(c.rank) ? c.rank : 0;
    return { id, rank, floor: whole(c.floor), i };
  }).sort((a, b) => a.rank - b.rank || a.i - b.i);
  const asked = (id) => want(demand && Object.hasOwn(demand, id) ? demand[id] : 0);
  const alloc = {};
  const floors = {};
  let left = total;
  let short = false;
  for (const c of list) {
    const due = Math.min(asked(c.id), c.floor);
    const got = Math.min(due, left);
    if (got < due) short = true;
    floors[c.id] = got;
    alloc[c.id] = got;
    left -= got;
  }
  for (let k = 0; k < list.length && left > 0;) {
    let j = k;
    while (j < list.length && list[j].rank === list[k].rank) j++;
    let open = list.slice(k, j).filter((c) => asked(c.id) > alloc[c.id]);
    while (open.length && left > 0) {
      const share = Math.floor(left / open.length);
      if (share === 0) {
        for (const c of open) {
          if (left === 0) break;
          alloc[c.id] += 1;
          left -= 1;
        }
        break;
      }
      for (const c of open) {
        const got = Math.min(asked(c.id) - alloc[c.id], share);
        alloc[c.id] += got;
        left -= got;
      }
      open = open.filter((c) => asked(c.id) > alloc[c.id]);
    }
    k = j;
  }
  return { line: total, alloc, floors, spare: left, short, order: list.map((c) => c.id) };
}

export function paceOf(perMinute) {
  const n = Math.max(1, whole(perMinute));
  return { perMinute: n, spacingMs: Math.ceil(60000 / n) };
}

export function shareOf(line, id, classes = TRANSPORT.classes) {
  const demand = {};
  let rank = null;
  for (const c of classes) if (c.id === id) rank = c.rank;
  if (rank === null) return 0;
  for (const c of classes) demand[c.id] = c.id === id ? Infinity : c.rank <= rank ? whole(c.floor) : 0;
  return allocate({ line, demand, classes }).alloc[id];
}

const clampLine = (n, cfg) => Math.min(cfg.max, Math.max(cfg.min, whole(n)));

const rowOk = (r) => !!r && typeof r === "object" && DAY_RE.test(String(r.d || "")) && Number.isInteger(r.l) && r.l > 0 &&
  Number.isInteger(r.c) && r.c >= 0 && Number.isInteger(r.r) && r.r >= 0 && LINE_VERDICTS.includes(r.v);

export function readLine(payload, cfg = TRANSPORT.line) {
  const s = payload && typeof payload === "object" && !Array.isArray(payload) ? payload.line : null;
  if (!s || typeof s !== "object" || Array.isArray(s) || s.v !== TRANSPORT.v) return null;
  if (!Number.isInteger(s.perMinute) || s.perMinute < cfg.min || s.perMinute > cfg.max) return null;
  const level = (v) => (Number.isInteger(v) && v >= cfg.min && v <= cfg.max ? v : null);
  const since = Number.isInteger(s.since) && s.since >= 0 ? s.since : 0;
  const history = (Array.isArray(s.history) ? s.history : []).filter(rowOk).slice(-cfg.history)
    .map((r) => ({ d: r.d, l: r.l, a: whole(r.a), c: r.c, r: r.r, s: whole(r.s), p: whole(r.p), v: r.v }));
  return { v: TRANSPORT.v, perMinute: s.perMinute, good: level(s.good), bad: level(s.bad), avoid: s.avoid === true, since, history };
}

export function lineOf(state, working, cfg = TRANSPORT.line) {
  if (state && Number.isInteger(state.perMinute)) return clampLine(state.perMinute, cfg);
  return clampLine(whole(working) || cfg.start, cfg);
}

export function stepLine(state, night, { working = null, cfg = TRANSPORT.line } = {}) {
  const used = lineOf(state, working, cfg);
  const level = (v) => (Number.isInteger(v) && v >= cfg.min && v <= cfg.max ? v : null);
  let good = state ? level(state.good) : null;
  let bad = state ? level(state.bad) : null;
  let avoid = !!(state && state.avoid === true);
  let since = state && Number.isInteger(state.since) && state.since >= 0 ? state.since : 0;
  const history = state && Array.isArray(state.history) ? state.history.slice() : [];
  const n = night && typeof night === "object" ? night : {};
  const calls = whole(n.calls);
  const refused = Math.min(calls, whole(n.refused));
  const alloc = whole(n.alloc);
  const peak = whole(n.peak);
  const slowed = Math.min(calls, whole(n.slowed));
  const share = calls > 0 ? refused / calls : null;
  const slow = calls > 0 ? slowed / calls : null;
  let next = used;
  let verdict = "hold";
  if (calls < cfg.evidenceCalls) {
    verdict = state ? "thin" : "start";
  } else if (share >= cfg.dirty || slow >= cfg.slowDirty) {
    bad = bad === null ? used : Math.min(bad, used);
    if (good !== null && good < used) {
      next = good;
    } else {
      good = null;
      next = Math.max(cfg.min, Math.floor(used * cfg.cut));
    }
    avoid = true;
    since = 0;
    verdict = "cut";
  } else if (share > cfg.clean || slow > cfg.slowClean) {
    if (good !== null && good < used) {
      bad = bad === null ? used : Math.min(bad, used);
      next = good;
      avoid = true;
      since = 0;
      verdict = "ease";
    }
  } else {
    if (!(alloc > 0) || peak < cfg.evidenceUse * alloc) {
      verdict = "idle";
    } else {
      good = good === null ? used : Math.max(good, used);
      since += 1;
      if (bad !== null && bad <= good) bad = null;
      let target = used;
      if (!avoid) {
        target = Math.ceil(used * cfg.raise);
      } else if (bad !== null && bad / good > cfg.settle) {
        target = Math.min(Math.ceil(used * cfg.raise), Math.floor((good + bad) / 2));
      } else if (since >= cfg.reprobeNights) {
        target = Math.ceil(good * cfg.probe);
        if (bad !== null && bad <= target) bad = null;
      }
      next = Math.min(cfg.max, Math.max(used, target));
      verdict = next > used ? "raise" : avoid || used >= cfg.max ? "capped" : "hold";
    }
  }
  const day = DAY_RE.test(String(n.day || "")) ? n.day : null;
  if (day) {
    const row = { d: day, l: used, a: alloc, c: calls, r: refused, s: slowed, p: peak, v: verdict };
    const at = history.findIndex((h) => h.d === day);
    if (at >= 0) history.splice(at, 1);
    history.push(row);
  }
  return {
    state: { v: TRANSPORT.v, perMinute: next, good, bad, avoid, since, history: history.slice(-cfg.history) },
    used, next, verdict, share, slow,
  };
}

export function lineSaid(step, { alloc = null } = {}) {
  if (!step) return "transport: no line on record";
  const pct = step.share === null ? "no calls"
    : fixedHalfUp(step.share, 2, 2) + "% refused, " + fixedHalfUp(step.slow, 1, 2) + "% of calls issued while backed off";
  const moved = step.next === step.used ? `stays at ${step.used}` : `${step.used} to ${step.next}`;
  return `transport: line ${moved} a minute (${step.verdict}; ${pct}` +
    (alloc !== null ? `; the run's share was ${alloc} a minute` : "") + ")";
}

export const RECONCILE = Object.freeze({
  switchEnv: "FLOWS_RECONCILE",
  items: 90,
  resendMax: 120,
  rounds: 2,
});

const DATED_RE = /(?:^|:)\d{4}-\d{2}-\d{2}(?::|$)/;

export function reconcilable(key) {
  const k = String(key || "");
  if (!k || k.startsWith("live:") || k === "meta") return false;
  return !DATED_RE.test(k);
}

export function chunksOf(list, size) {
  const n = Math.max(1, whole(size));
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function reconcilePlan(landed, { items = RECONCILE.items } = {}) {
  const keys = [...new Set(landed)].filter(reconcilable).sort();
  return { keys, chunks: chunksOf(keys, items) };
}

export function reconcileVerdict({ asked = 0, need = [], resent = 0, still = [], skipped = null } = {}) {
  if (skipped) return { ok: null, said: `reconcile: not run (${skipped})` };
  if (!asked) return { ok: null, said: "reconcile: no key to check" };
  if (!need.length) return { ok: true, said: `reconcile: the store holds all ${asked} key(s) this run wrote, by content hash` };
  if (!still.length) {
    return { ok: true, said: `reconcile: ${need.length} of ${asked} key(s) differed from what the run wrote; ${resent} written again and now held` };
  }
  return {
    ok: false,
    said: `reconcile: ${still.length} of ${asked} key(s) still differ from what the run wrote (${still.slice(0, 6).join(", ")})`,
  };
}

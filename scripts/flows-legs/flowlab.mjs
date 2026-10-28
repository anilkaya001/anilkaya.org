import { read, pastDeadline } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import { productById } from "../../shared/flows-products.js";
import { sessionOpen } from "../../shared/flows-freshness.js";
import {
  FLOWLAB_LIMITS, GROUPS, NIGHTLY_PRESETS, presetParams, reduceScreen, reduceVenues, reduceRoots, reduceGreek, reduceAnalytics, thirdFridayExpiry, analyticsOn,
} from "../../shared/flows-flowlab.js";

export const FLOWLAB_KEYS = Object.freeze(["flowlab-roots", "flowlab-venues", "flowlab-screen", "flowlab-groups", "flowlab-corr"]);

export const SECTION_ORDER = Object.freeze(["roots", "venues", "screen", "groups", "analytics"]);

export const SECTION_COST = Object.freeze({ roots: 1, venues: 2, screen: 3, groups: GROUPS.length, analytics: 2 });

export const SECTION_KEY = Object.freeze({ roots: "flowlab-roots", venues: "flowlab-venues", screen: "flowlab-screen", groups: "flowlab-groups", analytics: "flowlab-corr" });

export const NIGHTLY_MAX = 40;

export const BAR_COUNT = 13;

export const BAR_MS = 30 * 60000;

export const CORR_SYMBOLS = 20;

const encoder = new TextEncoder();

export const sizeOf = (value) => encoder.encode(JSON.stringify(value)).length;

export function failureOf(res) {
  if (res.status === 429) return "limited";
  if ([401, 402, 403, 422].includes(res.status)) return "plan";
  if (res.status === 404) return "empty";
  return "failed";
}

export function planSections({ cap, analytics }) {
  const run = [];
  const skipped = [];
  let left = Math.max(0, Number.isFinite(cap) ? Math.floor(cap) : 0);
  for (const section of SECTION_ORDER) {
    if (section === "analytics" && !analytics) continue;
    const cost = SECTION_COST[section];
    if (cost <= left) {
      run.push(section);
      left -= cost;
    } else skipped.push({ section, why: "cap" });
  }
  return { run, skipped, left };
}

export function callCeiling(env, extrasCalls, extrasCap) {
  const used = Number.isFinite(extrasCalls) ? extrasCalls : 0;
  const room = Number.isFinite(extrasCap) ? extrasCap - used : NIGHTLY_MAX;
  return Math.max(0, Math.min(NIGHTLY_MAX, Math.floor(room)));
}

export function fitTail(payload, capBytes, lists) {
  const out = { ...payload };
  const cut = {};
  while (sizeOf(out) > capBytes) {
    let pick = null;
    for (const entry of lists) {
      const len = entry[1](out).length;
      if (len > 0 && (pick === null || len > pick.len)) pick = { entry, len };
    }
    if (pick === null) break;
    const keep = Math.min(pick.len - 1, Math.floor(pick.len * 0.8));
    pick.entry[2](out, pick.entry[1](out).slice(0, keep));
    cut[pick.entry[0]] = keep;
  }
  return { payload: out, cut, fits: sizeOf(out) <= capBytes };
}

export function slimRow(row) {
  const r = row.ratios;
  return {
    c: row.c, t: row.t, cp: row.cp, k: row.k, e: row.e, px: row.px, vol: row.vol, oi: row.oi, premC: row.premC, ed: row.ed, lastFill: row.lastFill,
    ratios: { voi: r.voi, nameShare: r.nameShare, sweepShare: r.sweepShare, askLo: r.askLo, askHi: r.askHi, lean: r.lean },
    flags: row.flags,
  };
}

export function groupBars(x, openMs) {
  const bars = [];
  for (let i = 0; i < BAR_COUNT; i++) bars.push({ t: openMs + i * BAR_MS, d: null, v: null });
  x.t.forEach((t, i) => {
    const b = Math.floor((t - openMs) / BAR_MS);
    if (b < 0 || b >= BAR_COUNT) return;
    const d = x.series.dirDelta[i];
    const v = x.series.dirVega[i];
    if (d !== null) bars[b].d = (bars[b].d === null ? 0 : bars[b].d) + d;
    if (v !== null) bars[b].v = (bars[b].v === null ? 0 : bars[b].v) + v;
  });
  return bars;
}

export function topNames(rows, limit = CORR_SYMBOLS) {
  const totals = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.t !== "string" || !Number.isFinite(r.prem)) continue;
    totals.set(r.t, (totals.get(r.t) || 0) + r.prem);
  }
  return [...totals.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([t]) => t);
}

export async function readFlowlab({
  vendor, sessionDate, generatedAt, cap = NIGHTLY_MAX, env = {}, deadline = null, pool = null, width = 1, alertRows = [], log = () => {},
} = {}) {
  const plan = planSections({ cap, analytics: analyticsOn(env) });
  const head = { v: 1, generatedAt, session: sessionDate, sessionDate };
  const payloads = {};
  const detail = { flCalls: 0, flSkipped: plan.skipped.length, ran: plan.run.length };
  const failures = [];
  const reasons = {};
  let calls = 0;

  const get = async (path, params) => {
    if (pastDeadline(deadline)) return { ok: false, why: "deadline", status: null };
    calls += 1;
    const res = await read(vendor, path, params, { envelope: true });
    return res.ok ? res : { ok: false, why: failureOf(res), status: res.status, error: res.error };
  };

  const note = (section, why) => {
    reasons[section] = why;
    failures.push(`${section}: ${why}`);
  };

  const each = async (items, work) => {
    if (pool) await pool(items, work, { width, stopEarly: () => pastDeadline(deadline) });
    else for (const item of items) await work(item);
  };

  for (const section of plan.run) {
    if (section === "roots") {
      const res = await get(pathFor("optionable-roots"), {});
      const x = res.ok ? reduceRoots(res.body) : res;
      if (x.ok) payloads["flowlab-roots"] = { ...head, ...x.x };
      else note("roots", x.why);
    } else if (section === "venues") {
      const [ex, codes] = [await get(pathFor("exchange-breakdown", { date: sessionDate }), { limit: 500 }), await get(pathFor("exchange-breakdown", { date: sessionDate }), { limit: 500, by_trade_code: "true" })];
      const a = ex.ok ? reduceVenues(ex.body, {}) : ex;
      const b = codes.ok ? reduceVenues(codes.body, { mode: "codes" }) : codes;
      if (!a.ok && !b.ok) note("venues", a.why);
      else {
        const payload = {
          ...head,
          tickers: a.ok ? a.x.tickers : [],
          codes: b.ok ? b.x.tickers.map((q) => ({ t: q.t, top: q.top })) : [],
          ...(a.ok ? {} : { tickersWhy: a.why }),
          ...(b.ok ? {} : { codesWhy: b.why }),
        };
        const fit = fitTail(payload, productById("flowlab-venues").capBytes, [["tickers", (o) => o.tickers, (o, v) => { o.tickers = v; }], ["codes", (o) => o.codes, (o, v) => { o.codes = v; }]]);
        payloads["flowlab-venues"] = Object.keys(fit.cut).length ? { ...fit.payload, cut: fit.cut } : fit.payload;
        if (!a.ok) reasons.venues = a.why;
        if (!b.ok) reasons.venues = b.why;
      }
    } else if (section === "screen") {
      const presets = {};
      let firstWhy = null;
      for (const preset of NIGHTLY_PRESETS) {
        const res = await get(pathFor("contract-screener"), presetParams(preset, { asOf: sessionDate }));
        const x = res.ok ? reduceScreen(res.body, { session: sessionDate, preset, asOf: generatedAt, date: sessionDate }) : res;
        if (x.ok) presets[preset] = { n: x.x.n, unranked: x.x.unranked, dropped: x.x.dropped, minVolume: x.x.minVolume, rows: x.x.rows.map(slimRow) };
        else {
          presets[preset] = { why: x.why, rows: [] };
          firstWhy = firstWhy || x.why;
        }
      }
      if (Object.values(presets).every((p) => p.why)) note("screen", firstWhy);
      else {
        const lists = NIGHTLY_PRESETS.map((name) => [name, (o) => o.presets[name].rows, (o, v) => { o.presets = { ...o.presets, [name]: { ...o.presets[name], rows: v } }; }]);
        const startCap = FLOWLAB_LIMITS.screenPerPreset;
        for (const name of NIGHTLY_PRESETS) presets[name] = { ...presets[name], rows: presets[name].rows.slice(0, FLOWLAB_LIMITS.screenLimit) };
        const fit = fitTail({ ...head, presets }, productById("flowlab-screen").capBytes, lists);
        const cutRows = Object.keys(fit.cut).length ? { cut: fit.cut, startCap } : {};
        payloads["flowlab-screen"] = { ...fit.payload, ...cutRows };
        if (firstWhy) reasons.screen = firstWhy;
      }
    } else if (section === "groups") {
      const expiry = thirdFridayExpiry(sessionDate);
      if (!expiry) {
        note("groups", "failed");
        continue;
      }
      const openMs = sessionOpen(sessionDate);
      const groups = {};
      await each(GROUPS, async (g) => {
        const res = await get(pathFor("group-greek-flow-expiry", { flow_group: g, expiry }), { date: sessionDate });
        const x = res.ok ? reduceGreek(res.body, { group: true, expiry }) : res;
        groups[g] = x.ok ? { status: "ok", n: x.x.t.length, bars: groupBars(x.x, openMs), callC: x.x.net.callC, putC: x.x.net.putC } : { status: x.why };
      });
      const ordered = {};
      for (const g of GROUPS) if (groups[g]) ordered[g] = groups[g];
      for (const g of GROUPS) if (!ordered[g]) ordered[g] = { status: "cap" };
      const bad = Object.values(ordered).filter((q) => q.status !== "ok").length;
      if (bad === GROUPS.length) note("groups", Object.values(ordered)[0].status);
      else {
        payloads["flowlab-groups"] = { ...head, expiry, groups: ordered };
        if (bad) reasons.groups = `${bad} of ${GROUPS.length} group(s) not read`;
      }
    } else if (section === "analytics") {
      const symbols = topNames(alertRows);
      if (symbols.length < 3) {
        payloads["flowlab-corr"] = { ...head, status: "empty", symbols };
        continue;
      }
      const params = (extra) => ({ symbols: symbols.join(","), range: "3M", calculations: "correlation", ...extra });
      const win = await get(pathFor("analytics-window"), params({}));
      const sld = await get(pathFor("analytics-sliding"), params({ window_size: 20 }));
      const a = win.ok ? reduceAnalytics(win.body, { symbols, calc: "correlation" }) : win;
      const b = sld.ok ? reduceAnalytics(sld.body, { symbols, calc: "correlation" }) : sld;
      if (a.ok && b.ok) payloads["flowlab-corr"] = { ...head, status: "ok", symbols, window: a.x, sliding: b.x };
      else {
        payloads["flowlab-corr"] = { ...head, status: a.ok ? b.why : a.why, symbols };
        reasons.analytics = a.ok ? b.why : a.why;
      }
    }
  }
  if (!analyticsOn(env)) payloads["flowlab-corr"] = { ...head, status: "off" };
  detail.flCalls = calls;
  const sizes = {};
  for (const [key, value] of Object.entries(payloads)) sizes[key] = sizeOf(value);
  log(`  flowlab: ${calls} call(s) of ${cap}; ${Object.keys(payloads).length} key(s) built` + (plan.skipped.length ? `, ${plan.skipped.map((s) => s.section).join(", ")} skipped for the cap` : "") + (failures.length ? `; ${failures.join("; ")}` : ""));
  return { payloads, calls, skipped: plan.skipped, failures, reasons, detail, sizes };
}

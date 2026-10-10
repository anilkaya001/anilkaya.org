import {
  ACTIVITY_LIMIT, buildActivityRows, rankActivity, mergeActivity, activityBlock,
} from "../../shared/flows-activity.js";

export const ACTIVITY_PATH = "/api/option-activity/unusual";

export function activityRequest(sessionDate) {
  return { path: ACTIVITY_PATH, params: { date: sessionDate, limit: ACTIVITY_LIMIT, order: "premium", order_direction: "desc" } };
}

export function activityEnabled(env = process.env) {
  return String(env.FLOWS_UNUSUAL_V2 || "on").trim().toLowerCase() !== "off";
}

export function errorCodeOf(error) {
  const m = /HTTP (\d{3})/.exec(String((error && error.message) || ""));
  const http = m ? Number(m[1]) : null;
  return { code: http !== null && http >= 400 && http < 500 && http !== 429 ? "refused" : "read-failed", http };
}

export function fakeActivityRows(contractRows, sessionDate) {
  const rows = [];
  const list = Array.isArray(contractRows) ? contractRows : [];
  const day = String(sessionDate || "2026-01-02");
  const pad = (n, w) => String(n).padStart(w, "0");
  const symbol = (t, expiry, cp, k) => `${t}${expiry.slice(2, 4)}${expiry.slice(5, 7)}${expiry.slice(8, 10)}${cp}${pad(Math.round(k * 1000), 8)}`;
  list.forEach((r, i) => {
    if (i % 2) return;
    const vol = Math.max(200, Math.round(r.vol));
    const share = (f) => Math.round(vol * f);
    rows.push({
      option_symbol: symbol(r.t, r.expiry, r.cp, r.k), volume: vol, open_interest: r.oi,
      premium: String(vol * 150 + i * 1000), ask_side_volume: share(0.6), bid_side_volume: share(0.25), mid_volume: share(0.1), no_side_volume: 0,
      sweep_volume: share(0.4), floor_volume: share(0.05), multileg_volume: share(0.1), stock_multi_leg_volume: 0, cross_volume: 0,
      last_fill: `${day}T19:55:00Z`,
    });
  });
  rows.push({
    option_symbol: symbol("ZZZ", "2026-12-18", "C", 50), volume: 900, open_interest: 400, premium: "512000.00",
    ask_side_volume: 700, bid_side_volume: 100, mid_volume: 100, no_side_volume: 0,
    sweep_volume: 300, floor_volume: 0, multileg_volume: 100, stock_multi_leg_volume: 0, cross_volume: 0, last_fill: `${day}T20:00:00Z`,
  });
  rows.push({
    option_symbol: symbol("OLD", "2026-12-18", "P", 40), volume: 500, open_interest: 400, premium: "90000.00",
    ask_side_volume: 300, bid_side_volume: 100, mid_volume: 100, no_side_volume: 0,
    sweep_volume: 0, floor_volume: 0, multileg_volume: 0, stock_multi_leg_volume: 0, cross_volume: 0, last_fill: "2020-01-02T20:00:00Z",
  });
  return rows;
}

export async function readActivity({ uw, sessionDate, contractRows, enabled = true, dryRun = false, now = () => new Date().toISOString() }) {
  if (!enabled) return { block: activityBlock({ status: "off", code: "off", sessionDate, readAt: null }), calls: 0 };
  const readAt = now();
  let raw;
  let calls = 0;
  if (dryRun) raw = fakeActivityRows(contractRows, sessionDate);
  else {
    calls = 1;
    try {
      const req = activityRequest(sessionDate);
      raw = await uw(req.path, req.params);
    } catch (error) {
      const e = errorCodeOf(error);
      return { block: { ...activityBlock({ status: "unavailable", code: e.code, sessionDate, readAt }), ...(e.http ? { http: e.http } : {}) }, calls };
    }
  }
  if (!Array.isArray(raw)) return { block: activityBlock({ status: "unavailable", code: "unreadable-body", sessionDate, readAt }), calls };
  const built = buildActivityRows(raw, { sessionDate });
  const ranked = rankActivity(built.rows);
  const matched = mergeActivity(contractRows, built.rows);
  const status = built.rows.length ? "ok" : "quiet";
  return { block: activityBlock({ status, code: status === "quiet" ? (raw.length ? "off-session" : "no-rows") : null, sessionDate, readAt, built, ranked, matched }), calls };
}

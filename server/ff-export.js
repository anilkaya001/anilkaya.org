import { EXPORT_COLUMNS, TIME } from "../shared/ff-contract.js";
import { shiftDay } from "../shared/flows-freshness.js";
import { isRealDay } from "./ff-digest.js";

export const EXPORT = Object.freeze({ maxDays: 31, rowsPerStream: 1000, fenceDays: 5 });

export function exportRange(from, to) {
  if (!isRealDay(from) || !isRealDay(to) || to < from) return { ok: false, code: "malformed" };
  const span = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
  if (span > EXPORT.maxDays) return { ok: false, code: "range" };
  return { ok: true, from, to, days: span };
}

export const isoTrt = (ms) => new Date(ms + TIME.offsetMin * 60000).toISOString().slice(0, 19) + TIME.exportOffset;

const UNSAFE = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const safe = typeof value === "string" && UNSAFE.test(text) ? "'" + text : text;
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

const cellsOf = (r) => ({
  hit_id: r.hit_id,
  wire_id: r.wire_id,
  wire_version: r.wire_version,
  layer: r.layer,
  template: r.template,
  symbol: r.symbol,
  session: r.session,
  session_label: r.session_label,
  fired_at: isoTrt(r.fired_at),
  data_as_of: isoTrt(r.data_as_of),
  evaluator: r.evaluator,
  sentence: r.sentence,
  evidence_json: r.evidence_json,
});

export function buildExport({ range, read }) {
  const inRange = (r) => r.session >= range.from && r.session <= range.to;
  const fence = shiftDay(range.from, -EXPORT.fenceDays);
  const reached = (rows) => rows.length < EXPORT.rowsPerStream || rows.some((r) => r.session <= fence);
  const rows = [...read.member.filter(inRange), ...read.house.filter(inRange)].sort((a, b) => (a.fired_at - b.fired_at) || (a.hit_id < b.hit_id ? -1 : 1));
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const r of rows) {
    const cells = cellsOf(r);
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(cells[c])).join(","));
  }
  return { body: "\uFEFF" + lines.join("\r\n") + "\r\n", rows: rows.length, complete: reached(read.member) && reached(read.house) };
}

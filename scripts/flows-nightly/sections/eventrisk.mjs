import { eventRiskNightly } from "../../../shared/flows-er-switch.js";
import { buildEventRisk, fitEventRisk } from "../../../shared/flows-er-payload.js";
import { runEventRiskReads, sectorsPayload, NATR_NAMES, PULSE_NAMES } from "../../flows-legs/eventrisk.mjs";
import { DEADLINE_MS } from "../vendor-params.mjs";
import { poolWidth, runPooled, stats } from "../vendor.mjs";
import { publish, readStored } from "../store.mjs";

const byDateTicker = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

export function windowNamesOf(events) {
  const rows = events && Array.isArray(events.rows) ? events.rows.filter((r) => r && typeof r.t === "string" && typeof r.d === "string").slice().sort(byDateTicker) : [];
  return {
    window: rows.slice(0, NATR_NAMES).map((r) => r.t),
    near: rows.filter((r) => Number.isInteger(r.sdte) && r.sdte <= 2).slice(0, PULSE_NAMES).map((r) => r.t),
  };
}

async function priorOf(key) {
  const got = await readStored(key);
  if (got.failed) {
    console.warn(`  eventrisk: the previous ${key} could not be read (HTTP ${got.status || 0}); it is rebuilt from tonight's reads`);
    return null;
  }
  return got.payload || null;
}

export async function runEventRisk(ctx) {
  const { stages, sessionDate, generatedAt, cardX, eventsPayload, withTilt, vendor } = ctx;
  if (!eventRiskNightly(process.env)) {
    stages.skip("eventrisk", "FLOWS_EVENTRISK_NIGHTLY is off");
    return;
  }
  await stages.run("eventrisk", async () => {
    const prior = await priorOf("eventrisk");
    const priorSectors = await priorOf("er-sectors");
    const names = windowNamesOf(eventsPayload);
    const universe = new Set((withTilt || []).map((w) => w && w.row && w.row.ticker).filter(Boolean));
    const now = Date.parse(generatedAt) || Date.now();
    const got = await runEventRiskReads({
      uw: vendor, sessionDate, now, prior, priorSectors, windowNames: names.window, pulseNames: names.near,
      deadline: stats.startedAt + DEADLINE_MS, pool: runPooled, width: poolWidth(2).width, log: (line) => console.log(line),
    });
    const payload = fitEventRisk(buildEventRisk({
      sessionDate, generatedAt, events: eventsPayload, cardX: (t) => (cardX && cardX.get ? cardX.get(t) : null),
      natr: got.natr, pulse: got.pulse, reads: got.reads, prior, universe,
      basis: { calls: got.calls, refused: got.refused, failed: got.failed }, readAt: generatedAt,
    }));
    await publish("eventrisk", payload);
    if (got.sectors) {
      await publish("er-sectors", sectorsPayload(got.sectors, { readAt: generatedAt, keep: universe }));
    }
    stages.detail({
      erCalls: got.calls,
      erRefused: Object.keys(got.refused).length,
      erFailed: Object.values(got.failed).reduce((a, b) => a + b, 0),
      erNames: payload.risk.rows.length,
      erPosts: payload.policy.posts.rows.length,
      erHalts14: payload.halts14.rows.length,
    });
    console.log(`  eventrisk: ${payload.risk.rows.length} name(s) in the window, ${payload.policy.posts.rows.length} post(s), ${payload.halts14.rows.length} halt(s) in 14 days, ${Buffer.byteLength(JSON.stringify(payload))} bytes` +
      (payload.basis.shed.length ? `; shed ${payload.basis.shed.join(", ")}` : ""));
  }, (error) => {
    if (error && error.fixtureLeak) throw error;
    console.warn(`  eventrisk: ${error.message}`);
  });
}

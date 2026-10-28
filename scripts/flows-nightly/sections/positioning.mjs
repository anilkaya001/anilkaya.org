import { buildPositioning, fitPositioning } from "../../../shared/flows-pos-build.js";
import { positioningNightly } from "../../../shared/flows-pos-switch.js";
import { usableX } from "../../../shared/flows-vendor-extras.js";
import { readPositioning } from "../../flows-legs/positioning.mjs";
import { fakePositioningUw } from "../../flows-legs/positioning-fake.mjs";
import { stampNow } from "../../flows-legs/stamp.mjs";
import { DRY_RUN } from "../flags.mjs";
import { DEADLINE_MS } from "../vendor-params.mjs";
import { poolWidth, runPooled, stats, uw } from "../vendor.mjs";
import { publish, publishedStore, readStored } from "../store.mjs";

export function universeSectors(universe) {
  const out = {};
  if (!universe || !Array.isArray(universe.t) || !Array.isArray(universe.sec) || !Array.isArray(universe.sectors)) return out;
  universe.t.forEach((t, i) => {
    const k = universe.sec[i];
    if (typeof t === "string" && Number.isInteger(k) && typeof universe.sectors[k] === "string") out[t] = universe.sectors[k];
  });
  return out;
}

export function psParts(store, universe, now) {
  const ps = {};
  const adv = {};
  for (const t of Object.keys(universe)) {
    const card = store["card-x:" + t];
    if (!card || typeof card !== "object") continue;
    if (card.ps && card.ps.parts) ps[t] = card.ps.parts;
    const info = usableX(card.dx, "info", now);
    if (info && typeof info.x.adv30 === "number") adv[t] = info.x.adv30;
  }
  return { ps, adv };
}

export async function runPositioning(ctx) {
  const { stages, sessionDate, generatedAt, marketLegs } = ctx;
  if (!positioningNightly(process.env)) {
    stages.skip("positioning", "FLOWS_POSITIONING_NIGHTLY is off");
    return;
  }
  await stages.run("positioning", async () => {
    const got = await readStored("positioning");
    if (got && got.failed) throw new Error(`the previous positioning payload could not be read (HTTP ${got.status || 0}); it is left as it is`);
    const prior = got && got.payload ? got.payload : null;
    const date = sessionDate || stampNow().slice(0, 10);
    const read = await readPositioning({
      uw: DRY_RUN ? fakePositioningUw() : uw, sessionDate: date, prior, deadline: stats.startedAt + DEADLINE_MS,
      pool: runPooled, width: poolWidth(2).width, log: (line) => console.log(line),
    });
    const universe = universeSectors(marketLegs && marketLegs.universe);
    const now = Date.parse(generatedAt) || Date.now();
    const { ps, adv } = psParts(publishedStore, universe, now);
    const payload = fitPositioning(buildPositioning({
      sessionDate: date, generatedAt, now, universe, list: read.list, latest: read.latest, sectorsByCik: read.sectorsByCik,
      activityByCik: read.activityByCik, holdingsByCik: read.holdingsByCik, insiderBySector: read.insiderBySector,
      psByTicker: ps, advByTicker: adv, prior, refused: read.refused, failed: read.failed, calls: read.calls,
    }));
    await publish("positioning", payload);
    stages.detail({
      filers: payload.rotation.filers ? payload.rotation.filers.compared : 0,
      names: payload.shorts.ftd ? payload.shorts.ftd.names : 0,
      bytes: JSON.stringify(payload).length,
      shed: payload.basis.shed ? payload.basis.shed.length : 0,
    });
    console.log(`  positioning: rotation ${payload.rotation.status}, filings ${payload.filings.status}, insiders ${payload.insiders.status}, shorts ${payload.shorts.status}`);
  }, (error) => {
    console.warn(`  positioning: ${error.message} — every key above published before this leg ran`);
  });
}

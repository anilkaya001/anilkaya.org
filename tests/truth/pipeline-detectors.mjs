import * as card from "../../shared/flows-card.js";
import * as coverage from "../../shared/flows-coverage.js";
import * as contracts from "../../shared/flows-contracts.js";
import * as products from "../../shared/flows-products.js";
import * as meter from "../../shared/flows-call-meter.js";
import * as stages from "../../scripts/flows-nightly/stages.mjs";
import { boot } from "../pipeline-sim/index.mjs";
import { clientScenario } from "../pipeline-sim/client.mjs";
import { cardScenario } from "../pipeline-sim/cards.mjs";
import { storeScenario } from "../pipeline-sim/store.mjs";
import { contractsScenario } from "../pipeline-sim/contracts.mjs";
import { meterScenario, stagesScenario } from "../pipeline-sim/meter.mjs";

export const SEEDS = Object.freeze({ client: 10, card: 24, store: 40, contracts: 25, meter: 6, stages: 25 });

async function across(count, run) {
  const found = [];
  let checks = 0;
  for (let seed = 0; seed < count; seed++) {
    const r = await run(seed);
    checks += r.checks;
    for (const v of r.violations) found.push({ seed, message: v.message });
  }
  return { ok: found.length === 0, note: found.length ? `${found.length} violation(s) over ${count} seeds, first at seed ${found[0].seed}: ${String(found[0].message).slice(0, 160)}` : `${checks} checks over ${count} seeds, none broken`, found, checks };
}

export async function clientDetector(mod) {
  const time = boot();
  try {
    return await across(SEEDS.client, (seed) => clientScenario(seed, mod, { time }));
  } finally {
    time.uninstall();
  }
}

export const cardDetector = (mod) => across(SEEDS.card, (seed) => cardScenario(seed, { card: mod, coverage, reads: "plan" }));

export const coverageDetector = (mod) => across(SEEDS.store, (seed) => storeScenario(seed, mod));

export const contractsDetector = (mod) => across(SEEDS.contracts, (seed) => contractsScenario(seed, mod, { card, products }));

export const meterDetector = (mod) => across(SEEDS.meter, (seed) => meterScenario(seed, mod));

export const stagesDetector = (mod) => across(SEEDS.stages, (seed) => stagesScenario(seed, mod));

export const DETECTOR_OF = Object.freeze({ clientDetector, cardDetector, coverageDetector, contractsDetector, meterDetector, stagesDetector });

export { meter, stages, contracts };

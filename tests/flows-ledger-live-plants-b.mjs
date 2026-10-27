import assert from "node:assert/strict";
import { launch } from "./lib/browser.mjs";
import { PLANTS, BASE_LIVE, battery, plantArgs } from "./lib/ledger-live-battery.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const browser = await launch();

const base = await battery(browser, { verifyWait: 1000, liveJs: BASE_LIVE });
eq(base, [], "the correct build passes every check of the battery");
for (const p of PLANTS.slice(6)) {
  const failed = await battery(browser, plantArgs(p));
  ok(failed.includes(p.expect), `${p.id} (${p.title}) fails its check ${p.expect}; failed: ${failed.join(", ") || "none"}`);
}

await browser.close();
console.log(`✓ flows-ledger-live-plants-b: ${checks} assertions`);

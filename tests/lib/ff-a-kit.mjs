import { isDeepStrictEqual } from "node:util";
import { loadGraph, loadReal } from "./ff-a-graph.mjs";

export function recorder(heavy = true) {
  const fails = [];
  let checks = 0;
  const api = {
    heavy,
    ok(c, m) {
      checks++;
      if (!c) fails.push(m);
    },
    eq(a, b, m) {
      checks++;
      if (!isDeepStrictEqual(a, b)) fails.push(m + " | got " + JSON.stringify(a)?.slice(0, 160) + " want " + JSON.stringify(b)?.slice(0, 160));
    },
    near(a, b, tol, m) {
      checks++;
      if (!(typeof a === "number" && Math.abs(a - b) <= tol)) fails.push(m + " | got " + a + " want " + b + " tol " + tol);
    },
    rel(a, b, tol, m) {
      checks++;
      if (!(typeof a === "number" && Math.abs(a - b) <= tol * Math.abs(b))) fails.push(m + " | got " + a + " want " + b + " rel " + tol);
    },
    get fails() {
      return fails;
    },
    get checks() {
      return checks;
    },
  };
  return api;
}

export async function runBattery(battery, overrides = null, heavy = true) {
  const R = recorder(heavy);
  const mods = overrides ? await loadGraph(overrides) : await loadReal();
  try {
    await battery(mods, R);
  } catch (err) {
    R.fails.push("battery threw: " + (err && err.message ? err.message : err));
  }
  return R;
}

export async function holdsAndPlants(label, battery, plants, log = console.log) {
  const real = await runBattery(battery);
  if (real.fails.length) {
    for (const f of real.fails.slice(0, 20)) console.error("  FAIL " + f);
    throw new Error(`${label}: ${real.fails.length} of ${real.checks} checks failed on the real modules`);
  }
  let caught = 0;
  const survivors = [];
  for (const p of plants) {
    const r = await runBattery(battery, { [p.target]: p.transforms }, p.heavy === true);
    if (r.fails.length) caught++;
    else survivors.push(p.name);
  }
  if (survivors.length) throw new Error(`${label}: planted wrong builds that no check caught: ${survivors.join("; ")}`);
  log(`${label}: ${real.checks} checks hold on the real modules; ${caught} of ${plants.length} planted wrong builds fail`);
  return { checks: real.checks, plants: plants.length };
}

export const range = (n) => Array.from({ length: n }, (_, i) => i);

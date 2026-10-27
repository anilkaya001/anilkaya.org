import { collector, buildApi, makeApi } from "./ff-b-kit.mjs";
import { makeWorld } from "./ff-b-world.mjs";
import { loadChain } from "./ff-b-chain.mjs";
import { MUTANTS } from "./ff-b-mutants.mjs";
import { isBattery } from "./ff-b-run.mjs";
import * as wires from "./ff-b-batteries-wires.mjs";
import * as isolation from "./ff-b-batteries-isolation.mjs";
import * as inbox from "./ff-b-batteries-inbox.mjs";
import * as health from "./ff-b-batteries-health.mjs";
import * as reads from "./ff-b-batteries-reads.mjs";
import * as gates from "./ff-b-batteries-gates.mjs";
import * as flags from "./ff-b-batteries-flags.mjs";
import * as store from "./ff-b-batteries-store.mjs";
import * as lint from "./ff-b-batteries-lint.mjs";

export const DETECTORS = Object.freeze(
  Object.fromEntries([wires, isolation, inbox, health, reads, gates, flags, store, lint].flatMap((module) => Object.entries(module).filter(([, fn]) => isBattery(fn)))),
);

const quiet = async (fn) => {
  const keep = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.error = keep.error;
    console.warn = keep.warn;
  }
};

const chainBuild = (chain) => (opt = {}) => {
  const { world: worldOptions, ...rest } = opt;
  return makeApi({ world: makeWorld(worldOptions), modules: { createFfStore: chain.createFfStore, flowsFfRows: chain.flowsFfRows }, storeModule: chain.modules["server/ff-store.js"], ...rest });
};

export async function runDetectors(names, build) {
  const c = collector();
  for (const name of names) {
    const fn = DETECTORS[name];
    if (!fn) throw new Error("no detector named " + name);
    try {
      await quiet(() => fn(c, build));
    } catch (e) {
      c.failed.push({ id: name + " threw", detail: e && e.message ? e.message.slice(0, 160) : String(e), threw: true });
    }
  }
  return c;
}

export async function killMatrix(group, { only = null } = {}) {
  const mutants = MUTANTS.filter((mu) => mu.group === group && (!only || only.includes(mu.id)));
  const baseline = new Map();
  const results = [];
  let salt = 0;
  for (const mu of mutants) {
    for (const name of mu.detect) {
      if (baseline.has(name)) continue;
      const c = await runDetectors([name], buildApi);
      baseline.set(name, { checks: c.count(), failed: c.failed.map((f) => f.id) });
    }
    salt += 1;
    let chain;
    try {
      chain = await loadChain({ [mu.target]: mu.transforms }, salt);
    } catch (e) {
      throw new Error("planted build " + mu.id + " does not load: " + String(e && e.message).slice(0, 200));
    }
    const c = await runDetectors(mu.detect, chainBuild(chain));
    const byCheck = c.failed.filter((f) => !f.threw);
    const byThrow = c.failed.filter((f) => f.threw);
    const killed = byCheck.length > 0 || (mu.throwOk && byThrow.length > 0);
    results.push({ id: mu.id, title: mu.title, detect: mu.detect, killed, by: byCheck.length ? byCheck[0].id : byThrow.length ? byThrow[0].id : null, throwOnly: byCheck.length === 0 && byThrow.length > 0, checks: c.count() });
  }
  return { results, baseline };
}

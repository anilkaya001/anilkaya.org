import assert from "node:assert/strict";
import { loadMutated } from "./truth/mutants.mjs";
import * as real from "../shared/flows-er-switch.js";

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const MODE_CASES = [
  ["on", "on"], [" ON ", "on"], ["owner", "owner"], ["off", "off"], ["Off", "off"], ["", "owner"], [undefined, "owner"],
  ["true", "owner"], ["1", "owner"], ["yes", "owner"], ["onn", "owner"], ["0", "owner"], [null, "owner"], [5, "owner"],
];
const NIGHTLY_CASES = [["off", false], [" OFF ", false], ["on", true], ["", true], [undefined, true], ["0", true], ["false", true], ["no", true], ["Off", false], ["offf", true], [null, true], [0, true], ["owner", true], ["1", true]];
const CAP_CASES = [["400", 400], [" 12 ", 12], ["0", 0], ["1000", 1000], ["1001", 1000], ["99999", 1000], ["-1", 400], ["1.5", 400], ["abc", 400], ["", 400], [undefined, 400], ["1e3", 400], [250, 250], [-5, 400]];
const HALTS_CASES = [["on", true], [" ON ", true], ["off", false], ["true", false], ["1", false], ["", false], [undefined, false], ["yes", false], ["onn", false], ["owner", false], [null, false], [1, false], ["On", true], ["oN\n", true]];

function battery(mod, label) {
  const fails = [];
  const check = (a, b, m) => { try { assert.deepEqual(a, b, m); checks++; } catch (e) { fails.push(m); } };
  for (const [v, w] of MODE_CASES) check(mod.eventRiskMode({ FLOWS_EVENTRISK: v }), w, `${label} mode ${JSON.stringify(v)}`);
  check(mod.eventRiskMode({}), "owner", `${label} mode unset`);
  check(mod.eventRiskMode(undefined), "owner", `${label} mode no env`);
  for (const [v, w] of NIGHTLY_CASES) check(mod.eventRiskNightly({ FLOWS_EVENTRISK_NIGHTLY: v }), w, `${label} nightly ${JSON.stringify(v)}`);
  for (const [v, w] of CAP_CASES) check(mod.eventRiskCap({ FLOWS_EVENTRISK_CAP: v }), w, `${label} cap ${JSON.stringify(v)}`);
  for (const [v, w] of HALTS_CASES) check(mod.eventRiskHalts({ FLOWS_EVENTRISK_HALTS: v }), w, `${label} halts ${JSON.stringify(v)}`);
  for (const mode of ["on", "owner", "off", "junk", undefined]) {
    for (const owner of [true, false, undefined, "yes"]) {
      const m = mode === "junk" || mode === undefined ? "owner" : mode;
      const want = m === "on" || (m === "owner" && owner === true);
      check(mod.eventRiskOpen({ FLOWS_EVENTRISK: mode }, owner), want, `${label} open ${mode} ${owner}`);
    }
  }
  return fails;
}

eq(battery(real, "real"), [], "the shipped leaf passes its own battery");

const PLANTS = [
  ["owner read as on", [['return w === "on" || w === "off" ? w : "owner";', 'return w === "off" ? w : "on";']]],
  ["unset read as on", [['return w === "on" || w === "off" ? w : "owner";', 'return w === "owner" || w === "off" ? w : "on";']]],
  ["cap above 1,000 not clamped", [["return Math.min(Number(s), EVENTRISK_CAP_MAX);", "return Number(s);"]]],
  ["halts on for true", [['return word(env && env.FLOWS_EVENTRISK_HALTS) === "on";', 'return ["on", "true"].includes(word(env && env.FLOWS_EVENTRISK_HALTS));']]],
  ["nightly off for anything but on", [['return word(env && env.FLOWS_EVENTRISK_NIGHTLY) !== "off";', 'return word(env && env.FLOWS_EVENTRISK_NIGHTLY) === "on";']]],
  ["owner switch open to everyone", [['(m === "owner" && owner === true)', '(m === "owner")']]],
  ["negative cap accepted", [["/^\\d+$/.test(s)", "/^-?\\d+$/.test(s)"]]],
  ["mode not trimmed", [['(typeof v === "string" ? v.trim().toLowerCase() : "")', '(typeof v === "string" ? v.toLowerCase() : "")']]],
];
for (const [name, transforms] of PLANTS) {
  const mod = await loadMutated("shared/flows-er-switch.js", transforms);
  ok(battery(mod, name).length > 0, `planted build fails: ${name}`);
}

console.log(`flows-er-switch: ${checks} checks`);

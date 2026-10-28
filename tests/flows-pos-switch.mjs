import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../shared/flows-pos-switch.js";
import { OPS_SWITCHES } from "../server/ops.js";
import { flowsPageRows } from "../server/routes/flows-pages.js";
import { HttpError } from "../server/http.js";
import { loadMutated } from "./truth/mutants.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const SPELLINGS = ["on", "ON", " on ", "owner", "off", "Off", "", undefined, "yes", "0", "true", "of"];
const WANT = { on: "on", ON: "on", " on ": "on", owner: "owner", off: "off", Off: "off", "": "owner", yes: "owner", 0: "owner", true: "owner", of: "owner" };

function pageGate(mode, owner) {
  const rows = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => owner });
  const row = rows.find((r) => r.id === "flows.pages.positioning");
  const env = mode === undefined ? {} : { FLOWS_POSITIONING: mode };
  return row.handler({ request: new Request("https://x.test/flows/positioning/"), env, url: new URL("https://x.test/flows/positioning/") })
    .then((r) => r.status, (e) => (e instanceof HttpError ? e.status : -1));
}

async function battery(M) {
  const fails = [];
  const need = (c, m) => { if (!c && fails.length < 6) fails.push(m); };
  for (const s of SPELLINGS) {
    const env = s === undefined ? {} : { FLOWS_POSITIONING: s };
    const word = s === undefined ? "owner" : WANT[s];
    need(M.positioningWord(env) === word, `the word of ${JSON.stringify(s)} is ${word}`);
    need(M.positioningMode(env, true) === (word !== "off"), `an owner under ${JSON.stringify(s)}`);
    need(M.positioningMode(env, false) === (word === "on"), `a member under ${JSON.stringify(s)}`);
    need(M.positioningMode(env, undefined) === (word === "on"), `no owner flag under ${JSON.stringify(s)} is a member`);
    need(M.positioningMode(env, "yes") === (word === "on"), `an owner flag that is not true is a member under ${JSON.stringify(s)}`);
  }
  for (const [raw, want] of [[undefined, 600], ["", 600], ["0", 0], ["600", 600], ["1500", 1500], ["1501", 1500], ["99999", 1500], ["-1", 600], ["12.5", 600], ["abc", 600], [" 250 ", 250], [300, 300], [-3, 600], [2000, 1500]]) {
    need(M.positioningCap(raw === undefined ? {} : { FLOWS_POSITIONING_CAP: raw }) === want, `the cap of ${JSON.stringify(raw)} is ${want}`);
  }
  for (const [raw, want] of [[undefined, true], ["", true], ["off", false], [" OFF ", false], ["on", true], ["0", true], ["false", true], ["of", true]]) {
    need(M.positioningNightly(raw === undefined ? {} : { FLOWS_POSITIONING_NIGHTLY: raw }) === want, `the nightly switch ${JSON.stringify(raw)} is ${want}`);
  }
  return fails;
}

{
  eq(await battery(S), [], "THE THREE READERS OVER TWELVE SPELLINGS: on is case-blind and trimmed, anything else is owner, an unset cap is 600, a cap is clamped to 1,500 and a negative or non-integer one is the default, and only off turns the nightly off");
  for (const owner of [true, false]) {
    for (const s of SPELLINGS) {
      const env = s === undefined ? {} : { FLOWS_POSITIONING: s };
      const open = S.positioningMode(env, owner);
      eq(await pageGate(s, owner) === 200, open, `THE PAGE ROW AND THE READER AGREE for ${JSON.stringify(s)} as ${owner ? "an owner" : "a member"}`);
    }
  }
  const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
  ok(/^FLOWS_POSITIONING = "on"$/m.test(wrangler), "the page ships to every signed-in member");
  ok(!/FLOWS_POSITIONING_NIGHTLY|FLOWS_POSITIONING_CAP/.test(wrangler), "and the nightly switches are the pipeline's, not the Worker's");
  for (const name of ["FLOWS_POSITIONING", "FLOWS_POSITIONING_NIGHTLY", "FLOWS_POSITIONING_CAP"]) ok(OPS_SWITCHES.includes(name), `${name} is on the owner's Status switch list`);
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/flows-pipeline.yml"), "utf8");
  ok(/FLOWS_POSITIONING_NIGHTLY: \$\{\{ vars\.FLOWS_POSITIONING_NIGHTLY \}\}/.test(wf) && /FLOWS_POSITIONING_CAP: \$\{\{ vars\.FLOWS_POSITIONING_CAP \}\}/.test(wf), "the workflow passes both from repository variables, unset by default");
  const PLANTS = [
    ["on read case-sensitively", [["const word = (value) => (typeof value === \"string\" ? value.trim().toLowerCase() : \"\");", "const word = (value) => (typeof value === \"string\" ? value.trim() : \"\");"]]],
    ["unset read as on", [["  return \"owner\";\n}\n\nexport function positioningMode", "  return mode === \"\" ? \"on\" : \"owner\";\n}\n\nexport function positioningMode"]]],
    ["a misspelling read as off", [["  if (mode === \"off\") return \"off\";\n  return \"owner\";", "  if (mode === \"off\") return \"off\";\n  return mode === \"\" ? \"owner\" : \"off\";"]]],
    ["the cap not clamped at 1,500", [["return Math.min(n, POSITIONING_CAP_MAX);", "return n;"]]],
    ["a negative cap accepted", [["if (!/^\\d+$/.test(text)) return POSITIONING_CAP_DEFAULT;", "if (!/^-?\\d+$/.test(text)) return POSITIONING_CAP_DEFAULT;"]]],
    ["a truthy owner flag treated as an owner", [["(mode === \"owner\" && owner === true)", "(mode === \"owner\" && Boolean(owner))"]]],
    ["the nightly off for anything but off", [["return word(env && env.FLOWS_POSITIONING_NIGHTLY) !== \"off\";", "return word(env && env.FLOWS_POSITIONING_NIGHTLY) === \"on\";"]]],
  ];
  for (const [title, transforms] of PLANTS) {
    const mod = await loadMutated("shared/flows-pos-switch.js", transforms);
    ok((await battery(mod)).length > 0, "PLANTED WRONG BUILD FAILS: " + title);
  }
}

console.log(`✓ flows-pos-switch: ${checks} assertions — the three switch readers over twelve spellings, the page row's gate equal to the reader for an owner and a member, the shipped value, the Status list and the workflow variables, and seven planted wrong builds that each fail`);

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

function dry(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "er-nightly-"));
  const log = path.join(dir, "net.log");
  const out = path.join(dir, "emit") + path.sep;
  fs.mkdirSync(out, { recursive: true });
  const base = { ...process.env, FLOWS_DRY_NOW: "2026-08-24T21:45:00Z", ER_NET_LOG: log };
  delete base.UW_API_KEY;
  delete base.FLOWS_UW_BASE_URL;
  const res = spawnSync(process.execPath, ["--require", path.join(ROOT, "tests/lib/block-net.cjs"), path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", out],
    { cwd: ROOT, env: { ...base, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const files = fs.readdirSync(out);
  const read = (key) => { const f = path.join(out, "-" + key.replace(":", "-") + ".json"); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };
  const cards = () => files.filter((f) => f.startsWith("-card-x-")).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")));
  const net = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim() : "";
  return { res, files, read, cards, net, dir };
}

{
  const on = dry({ FLOWS_EVENTRISK_NIGHTLY: "on" });
  ok(on.res.status === 0, "the dry run with the nightly on exits 0: " + String(on.res.stderr).slice(-300));
  eq(on.net, "", "and makes no outbound call: every read of the event-risk stage went to the fake");
  const er = on.read("eventrisk");
  ok(er && er.fixture === true, "the eventrisk payload is written and stamped as fixture data");
  const sectors = on.read("er-sectors");
  ok(sectors === null || sectors.fixture === true, "and so is the weekly sectors key when it is written");
  const meta = on.read("meta");
  const rec = meta.stages.find((r) => r.id === "eventrisk");
  ok(rec && rec.status === "ok", "the stage record is ok");
  const ids = meta.stages.map((r) => r.id);
  ok(ids.indexOf("eventrisk") === ids.indexOf("compute") + 1, "and it runs directly after compute");
  ok(on.cards().some((c) => c.er), "the card-x parts carry the er section");
  fs.rmSync(on.dir, { recursive: true, force: true });
}

{
  const off = dry({ FLOWS_EVENTRISK_NIGHTLY: "off" });
  ok(off.res.status === 0, "the dry run with the nightly off exits 0");
  eq(off.net, "", "and makes no outbound call");
  ok(off.read("eventrisk") === null && off.read("er-sectors") === null, "no event-risk key is written");
  const meta = off.read("meta");
  const rec = meta.stages.find((r) => r.id === "eventrisk");
  ok(rec && rec.status === "skipped", "the stage is recorded skipped");
  ok(off.cards().every((c) => !("er" in c)), "and no card-x carries an er section");
  fs.rmSync(off.dir, { recursive: true, force: true });
}

{
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/flows-pipeline.yml"), "utf8");
  ok(/FLOWS_EVENTRISK_NIGHTLY: \$\{\{ vars\.FLOWS_EVENTRISK_NIGHTLY \|\| 'off' \}\}/.test(wf), "the workflow ships the nightly off until the repository variable says on");
}

console.log(`flows-er-nightly: ${checks} checks`);

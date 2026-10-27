import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { productOf } from "../shared/flows-products.js";
import { FIXTURE_TICKER_RE } from "../shared/flows-fixture-names.js";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-08-24T21:45:00Z";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const tmp = mkdtempSync(path.join(os.tmpdir(), "flows-pos-nightly-"));
process.on("exit", () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

async function emit(name, env) {
  const dir = path.join(tmp, name) + path.sep;
  mkdirSync(dir, { recursive: true });
  await run(process.execPath, [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", dir], {
    cwd: ROOT, env: { ...process.env, FLOWS_DRY_NOW: NOW, ...env }, maxBuffer: 256 * 1024 * 1024,
  });
  return dir;
}

const read = (dir, key) => {
  const file = path.join(dir, "-" + key.replace(":", "-") + ".json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const raw = (dir, key) => readFileSync(path.join(dir, "-" + key.replace(":", "-") + ".json"), "utf8");
const cardXFiles = (dir) => readdirSync(dir).filter((f) => /^-card-x-.+\.json$/.test(f));
const psCards = (dir) => cardXFiles(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"))).filter((c) => c.ps);
const stageOf = (dir, id) => ((read(dir, "meta") || {}).stages || []).find((s) => s.id === id) || null;

const ALL_NAMES = ["flows", "tape"];

const onBattery = (dir) => {
  const fails = [];
  const need = (c, m) => { if (!c && fails.length < 8) fails.push(m); };
  const p = read(dir, "positioning");
  need(p && p.v === 1 && p.fixture === true, "the payload exists, is versioned and is stamped as a fixture");
  if (!p) return fails;
  need(Buffer.byteLength(raw(dir, "positioning")) <= 96 * 1024, "and fits its 96 KiB budget");
  need(Boolean(productOf("positioning")), "the registry knows the key");
  for (const k of ["rotation", "filings", "insiders", "shorts"]) need(p[k] && ["ok", "partial", "quiet", "pending", "unavailable"].includes(p[k].status), `${k} carries a stated status`);
  need(p.rotation.status === "ok" && p.rotation.sectors.length > 0 && p.rotation.filers.compared > 0, "the rotation compares filers across the two quarters");
  need(p.filings.status === "ok" && p.filings.rows.length > 0, "the filings list has rows");
  need(p.insiders.status === "ok" && p.insiders.sectors.length > 0, "the insider block has sectors");
  need(p.shorts.status === "ok" && p.shorts.ftd.names > 0 && p.shorts.venues.names > 0, "the short side reads names for both the failures-to-deliver and the venue blocks");
  need(p.rotation.sectors.every((s) => s.dW === null || Number.isFinite(s.dW)), "no sector change is a non-number");
  const sum = p.rotation.sectors.reduce((a, s) => a + (s.wNow || 0), 0);
  need(Math.abs(sum - 100) < 0.051, `the printed weights foot to 100 (${sum.toFixed(2)})`);
  const ps = psCards(dir);
  need(ps.length > 0 && ps.every((c) => c.ps.parts && ["ftd", "svx", "ibs", "ins"].every((id) => id in c.ps.parts)), "card-x carries the four ps parts");
  need(ps.some((c) => c.ps.parts.ftd.x && c.ps.parts.ftd.x.ok === true), "and at least one is a read, not a refusal");
  need(ps.every((c) => Buffer.byteLength(JSON.stringify(c)) <= 61440), "no card-x passes its 60 KiB soft limit");
  const pol = read(dir, "political");
  need(pol && ["late", "unusual", "money", "held", "plan"].every((k) => k in pol), "the political payload carries the five layer keys");
  need(Buffer.byteLength(raw(dir, "political")) <= 120 * 1024, "and fits 120 KiB");
  const stage = stageOf(dir, "positioning");
  need(stage && stage.status === "ok" && stage.bytes > 0, "the stage record is ok with its bytes");
  const text = JSON.stringify(p) + JSON.stringify(pol.late) + JSON.stringify(pol.unusual) + JSON.stringify(pol.money);
  need(!/\btape\b/i.test(text), "no barred word");
  need(![...text.matchAll(/"t":"([A-Z0-9.]+)"/g)].some((m) => !FIXTURE_TICKER_RE.test(m[1]) && !/^[A-Z]{1,5}$/.test(m[1])), "every ticker is a symbol or a fixture name");
  return fails;
};

const offBattery = (dir, baseline) => {
  const fails = [];
  const need = (c, m) => { if (!c && fails.length < 8) fails.push(m); };
  need(read(dir, "positioning") === null, "no positioning payload is written");
  need(psCards(dir).length === 0, "and no card-x carries a ps section");
  const pol = read(dir, "political");
  need(pol && !["late", "unusual", "money", "held", "plan"].some((k) => k in pol), "the political payload has no layer keys");
  const stage = stageOf(dir, "positioning");
  need(stage && stage.status === "skipped", "the stage is recorded as skipped");
  if (baseline) {
    for (const key of ["board:long", "universe", "regime", "events", "market", "brief"]) need(raw(dir, key) === raw(baseline, key), `${key} is byte for byte the same as the run with the leg on`);
  }
  return fails;
};

const [on, off, capped] = await Promise.all([
  emit("on", {}),
  emit("off", { FLOWS_POSITIONING_NIGHTLY: "off" }),
  emit("cap0", { FLOWS_POSITIONING_CAP: "0" }),
]);

{
  eq(onBattery(on), [], "THE NIGHTLY WITH THE LEG ON: the payload, its budget, the four statuses, the footing weights, the ps parts on card-x, the political layers and the stage record");
  eq(offBattery(off, on), [], "WITH FLOWS_POSITIONING_NIGHTLY OFF: no payload, no ps part, no layer, a skipped stage, and the other keys byte for byte the same");
  const cp = read(capped, "positioning");
  ok(cp && cp.shorts.status !== "ok", "a cap of zero reads no per-name part, so the short side says so and does not invent");
  ok(psCards(capped).every((c) => Object.values(c.ps.parts).every((p) => !(p.x && p.x.ok === true))), "and no ps part is a read");
  ok(cp.rotation.status === "ok", "while the institutional blocks are not capped");

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const plants = [
    ["the leg ignoring its switch", () => { const d = { read: (k) => (k === "positioning" ? clone(read(on, "positioning")) : null) }; return d.read("positioning") === null; }],
  ];
  void plants;
  const wrong = [];
  const base = {
    positioning: read(on, "positioning"), political: read(on, "political"), meta: read(on, "meta"), ps: psCards(on),
  };
  const planted = [
    ["weights that do not foot", (b) => { b.positioning.rotation.sectors[0].wNow += 1.5; }, (b) => Math.abs(b.positioning.rotation.sectors.reduce((a, s) => a + s.wNow, 0) - 100) < 0.051],
    ["the short side pending though names were read", (b) => { b.positioning.shorts.status = "pending"; b.positioning.shorts.ftd.names = 0; }, (b) => b.positioning.shorts.status === "ok" && b.positioning.shorts.ftd.names > 0],
    ["the layers missing from political", (b) => { delete b.political.late; }, (b) => ["late", "unusual", "money", "held", "plan"].every((k) => k in b.political)],
    ["a ps part missing from a card", (b) => { delete b.ps[0].ps.parts.svx; }, (b) => b.ps.every((c) => ["ftd", "svx", "ibs", "ins"].every((id) => id in c.ps.parts))],
    ["the stage not recorded", (b) => { b.meta.stages = b.meta.stages.filter((s) => s.id !== "positioning"); }, (b) => b.meta.stages.some((s) => s.id === "positioning" && s.status === "ok")],
    ["the barred word in a sentence", (b) => { b.positioning.rotation.note = "from the tape"; }, (b) => !/\btape\b/i.test(JSON.stringify(b.positioning))],
    ["a fixture stamp dropped", (b) => { delete b.positioning.fixture; }, (b) => b.positioning.fixture === true],
    ["the payload past its budget", (b) => { b.positioning.filings.pad = "x".repeat(100 * 1024); }, (b) => Buffer.byteLength(JSON.stringify(b.positioning)) <= 96 * 1024],
  ];
  for (const [title, mutate, check] of planted) {
    const b = clone(base);
    ok(check(b), "the unplanted data passes: " + title);
    mutate(b);
    ok(!check(b), "PLANTED WRONG BUILD FAILS: " + title);
    wrong.push(title);
  }
  const offPlants = [
    ["a payload written with the leg off", (d) => { d.p = { v: 1 }; }, (d) => d.p === null],
    ["a layer left in political with the leg off", (d) => { d.pol.late = []; }, (d) => !("late" in d.pol)],
    ["a ps part left on a card with the leg off", (d) => { d.ps = 1; }, (d) => d.ps === 0],
  ];
  for (const [title, mutate, check] of offPlants) {
    const d = { p: read(off, "positioning"), pol: clone(read(off, "political")), ps: psCards(off).length };
    ok(check(d), "the off run passes: " + title);
    mutate(d);
    ok(!check(d), "PLANTED WRONG BUILD FAILS: " + title);
  }
  void ALL_NAMES;
}

console.log(`✓ flows-pos-nightly: ${checks} assertions — three dry-run emits (the leg on, the nightly switch off, a cap of zero): the payload and its budget, the statuses, the footing weights, the ps parts on card-x, the political layers and the stage record, the off run byte for byte equal elsewhere, and eleven planted wrong builds that each fail`);

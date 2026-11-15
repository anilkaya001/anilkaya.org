import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { COPY_BANNED, HOOKS } from "../shared/ff-contract.js";
import { FIRE_SHADOW_LINE } from "../shared/flows-pages.js";
import { CLIENT_DOUBLE } from "./lib/ff-d-world.mjs";
import { NAMES, metricsPayload, universePayload } from "./lib/ff-b-world.mjs";
import { MEMBER, loadWorker, mountEnv, pinClock, quiet, send, store } from "./lib/ff-u-mount.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const CLIENT = "assets/js/flows-ff-client.js";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon" };
const MONDAY = "2026-10-26";
const NOW = "2026-10-26T21:30:00Z";
const DASH = "—";
const BANNED = new RegExp("\\b(" + COPY_BANNED.join("|") + ")\\b", "i");
const ONLY = process.env.FF_U_ONLY || "";

const plant = (from, to) => {
  const src = read(CLIENT);
  if (src.split(from).length !== 2) throw new Error("plant anchor must occur exactly once: " + from.slice(0, 70));
  return src.replace(from, () => to);
};

function world(extra = {}) {
  const f = store();
  f.put("universe", universePayload());
  f.put("ff-metrics", metricsPayload(NAMES, { sessionDate: MONDAY, generatedAt: MONDAY + "T22:50:00.000Z" }));
  return { f, env: mountEnv(f.D1, extra) };
}

async function openFire(browser, worker, w, [width, height], o = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", hasTouch: width < 600 });
  ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await page.route("**/*", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (u.host !== "flows.test") { calls.push({ method: req.method(), path: u.href, status: 0, outside: true }); return r.abort(); }
    if (p.startsWith("/assets/")) {
      if (o.client && p === "/" + CLIENT) return r.fulfill({ contentType: "text/javascript", body: o.client });
      const file = path.join(ROOT, p);
      if (!fs.existsSync(file)) return r.fulfill({ status: 404, contentType: "text/plain", body: "" });
      return r.fulfill({ path: file, contentType: MIME[path.extname(file)] || "application/octet-stream" });
    }
    let body;
    try { body = req.postDataJSON(); } catch { body = undefined; }
    const headers = {};
    for (const k of ["idempotency-key", "if-none-match", "accept"]) if (req.headers()[k]) headers[k] = req.headers()[k];
    const out = await send(worker, w.env, p + u.search, { method: req.method(), body: body === null ? undefined : body, headers, as: o.as === undefined ? MEMBER : o.as });
    if (p.startsWith("/api/")) calls.push({ method: req.method(), path: p, status: out.status, json: out.json, body });
    const pass = {};
    for (const [k, v] of out.res.headers) if (!/^(content-length|content-encoding|set-cookie)$/i.test(k)) pass[k] = v;
    return r.fulfill({ status: out.status, headers: pass, body: out.text });
  });
  await page.goto("https://flows.test/flows/fire/");
  await page.waitForSelector("#ffxFire .ffx-c", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(700);
  return { ctx, page, errors, calls };
}

const visibleText = (page) => page.evaluate(() => {
  const out = [];
  const walk = document.createTreeWalker(document.querySelector(".flows-main"), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const e = n.parentElement;
    if (!e || e.closest("script,style,[hidden],dialog:not([open]),.visually-hidden")) continue;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const t = n.textContent.trim();
    if (t) out.push(t);
  }
  return out.join(" | ");
});

const scrolls = (page) => page.evaluate(() => {
  const d = document.scrollingElement;
  const m = document.querySelector(".flows-main");
  return [d.scrollHeight - window.innerHeight, d.scrollWidth - window.innerWidth, m ? m.scrollHeight - m.clientHeight : 0];
});

async function journey(browser, worker, o = {}) {
  const got = {};
  const w = world();
  const m = await openFire(browser, worker, w, [1440, 820], o);
  const { page, calls } = m;
  try {
    const text = await visibleText(page);
    got.shadow = text.split(FIRE_SHADOW_LINE).length - 1;
    got.boot = ["/api/ff/wires", "/api/ff/house", "/api/flows/universe"].map((p) => (calls.find((c) => c.path === p && c.method === "GET") || {}).status || null);
    const limits = (calls.find((c) => c.path === "/api/ff/wires") || { json: {} }).json.limits || null;
    got.cap = limits ? (await page.textContent("#ffxCap")).startsWith(limits.armed.used + " of " + limits.armed.max + " wires armed") : false;
    await page.click('[data-template="T01"]');
    await page.click('[data-k="scope-names"]');
    await page.fill('[data-k="names"]', "SYA101, SYA102");
    await page.press('[data-k="names"]', "Enter");
    await page.waitForTimeout(900);
    await page.waitForFunction(() => ["ok", "unavailable", "error"].includes(document.querySelector("#ffxPreview").getAttribute("data-state")));
    await page.waitForTimeout(400);
    const pv = calls.filter((c) => c.path === "/api/ff/preview").pop();
    got.previewRoute = pv ? [pv.status, pv.json && pv.json.preview ? pv.json.preview.status : null] : null;
    got.previewState = await page.getAttribute("#ffxPreview", "data-state");
    const view = pv && pv.json && pv.json.preview ? pv.json.preview : null;
    const shown = await page.textContent("#ffxPreview");
    got.previewNames = view && Array.isArray(view.subjects) ? view.subjects.every((s) => shown.includes(s.symbol)) && view.subjects.length === 2 : false;
    got.previewFirst = view && view.evaluator && view.evaluator.firstCheck ? shown.includes(view.evaluator.firstCheck.label) && / TRT\b/.test(view.evaluator.firstCheck.label) : false;
    got.previewBody = pv ? Object.keys(pv.body).every((k) => k === "ast" || k === "template") && "ast" in pv.body : null;
    await page.click('[data-k="arm"]', { force: true });
    await page.waitForSelector('.ffx-out[data-state="ok"]');
    const armed = calls.filter((c) => c.path === "/api/ff/wires" && c.method === "POST").pop();
    got.armRoute = armed ? [armed.status, /^w-[a-z2-7]{16}$/.test(armed.json.wire.id)] : null;
    const row = w.f.db.prepare("SELECT w.member_id AS member, w.status AS state, v.cadence AS cadence, v.scope_kind AS scope FROM ff_wire w JOIN ff_wire_version v ON v.wire_id = w.id AND v.version = w.current_version WHERE w.layer = 'member'").all().map((r) => ({ ...r }));
    got.stored = row.map((r) => [r.state, r.cadence, r.scope, typeof r.member === "string" && r.member.length > 0]);
    const done = await page.textContent(".ffx-out");
    got.armSaid = armed ? done.includes("Armed.") && done.includes(armed.json.wire.effectiveText) : false;
    await page.waitForFunction(() => document.querySelector("#ffxCap").textContent.startsWith("1 of "));
    got.capAfter = (await page.textContent("#ffxCap")).startsWith("1 of ");
    got.hits = w.f.db.prepare("SELECT COUNT(*) AS n FROM ff_hit").get().n;
    w.env.FF_ROUTE_WIRES = "off";
    await page.fill('[data-k="names"]', "SYB201");
    await page.press('[data-k="names"]', "Enter");
    await page.waitForTimeout(600);
    await page.click('[data-k="arm"]', { force: true });
    await page.waitForFunction(() => { const o = document.querySelector(".ffx-out"); return o && o.getAttribute("data-state") !== "ok" && o.querySelector("[data-ff-absent]"); });
    got.refused = [await page.getAttribute(".ffx-out [data-ff-absent]", "data-ff-absent"), (await page.textContent(".ffx-out")).trim().startsWith(DASH)];
    const refusal = calls.filter((c) => c.path === "/api/ff/wires" && c.method === "POST").pop();
    got.refusedRoute = [refusal.status, refusal.json.error.code, refusal.json.reason];
    got.stillOne = w.f.db.prepare("SELECT COUNT(*) AS n FROM ff_wire WHERE layer = 'member'").get().n;
    const all = await visibleText(page);
    got.banned = BANNED.test(all);
    got.clock = /\b\d{1,2}:\d{2}(?!\d)(?!:)(?! TRT)/.test(all) || /\b(UTC|GMT|ET|EST|EDT)\b/.test(all);
    got.outside = calls.filter((c) => c.outside).length;
    got.errors = m.errors;
  } catch (e) {
    got.crash = String(e).split("\n")[0];
  } finally {
    await m.ctx.close();
  }
  return got;
}

const WANT = {
  shadow: 1,
  boot: [200, 200, 200],
  cap: true,
  previewRoute: [200, "ok"],
  previewState: "ok",
  previewNames: true,
  previewFirst: true,
  previewBody: true,
  armRoute: [201, true],
  stored: [["armed", "nightly", "names", true]],
  armSaid: true,
  capAfter: true,
  hits: 0,
  refused: ["ff_off", true],
  refusedRoute: [404, "ff_off", "route_off"],
  stillOne: 1,
  banned: false,
  clock: false,
  outside: 0,
  errors: [],
};

const SAYS = {
  shadow: "the Fire page the Worker serves says once that it runs in shadow",
  boot: "the real client reads the member's wires, the house wires and the universe from the mounted routes",
  cap: "the header prints the limits the Worker answered",
  previewRoute: "the mounted preview route answers the real engine's view inside its envelope",
  previewState: "and the page reads it through the real client",
  previewNames: "the preview lists the names the engine evaluated",
  previewFirst: "and the first check the Worker worded, in TRT",
  previewBody: "the preview body names no member",
  armRoute: "arming through the page stores a member wire",
  stored: "armed, nightly, by names, under the session's member",
  armSaid: "the page says Armed with the Worker's own effective-session sentence",
  capAfter: "and the header counts the new wire",
  hits: "arming evaluates nothing",
  refused: "a refused arm shows a dash with the Worker's own error code",
  refusedRoute: "which is the closed route switch",
  stillOne: "and nothing more is stored",
  banned: "no banned word on the page",
  clock: "no clock time outside TRT",
  outside: "the page requests nothing off its own origin",
  errors: "no page error",
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const judge = (got) => (got.crash ? ["the journey stopped: " + got.crash] : Object.keys(WANT).filter((k) => !same(got[k], WANT[k])).map((k) => SAYS[k] + " (got " + JSON.stringify(got[k]) + ", want " + JSON.stringify(WANT[k]) + ")"));

const PLANTS = [
  ["the page runs on the test double", CLIENT_DOUBLE],
  ["the preview envelope is not unwrapped", plant("var UNWRAP = Object.freeze({ \"/api/ff/preview\": \"preview\" });", "var UNWRAP = Object.freeze({});")],
  ["the Worker's error code is ignored", plant("typeof e.code === \"string\" && e.code ? e.code : known", "false ? e.code : known")],
  ["fixture data is refused on a test host", plant("if (guard && !guard.host && (", "if (guard && (")],
  ["a write sends no body", plant("if (body !== undefined) init.body = JSON.stringify(body);", "if (false) init.body = JSON.stringify(body);")],
];

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const log = quiet();
const clock = pinClock(Date.parse(NOW));
const browser = await launch();
let kills = 0;
try {
  const worker = await loadWorker();
  if (!ONLY || ONLY === "journey") {
    const got = await journey(browser, worker);
    const bad = judge(got);
    if (got.crash) ok(false, bad[0] + " (seen so far " + JSON.stringify(got) + ")");
    else for (const k of Object.keys(WANT)) ok(!bad.some((b) => b.startsWith(SAYS[k])), bad.find((b) => b.startsWith(SAYS[k])) || SAYS[k]);
  }
  if (!ONLY || ONLY === "sizes") {
    for (const size of HOOKS.viewports) {
      const w = world();
      const m = await openFire(browser, worker, w, size);
      try {
        const label = size.join("x");
        const text = await visibleText(m.page);
        ok(text.split(FIRE_SHADOW_LINE).length === 2, label + ": the shadow sentence is visible once");
        const s = await scrolls(m.page);
        ok(s[0] <= 1 && s[1] <= 1 && s[2] <= 1, label + ": no page scroll with the shadow sentence on the page (overflow " + JSON.stringify(s) + ")");
        const box = await m.page.evaluate((line) => {
          const e = [...document.querySelectorAll(".flows-main *")].find((n) => n.children.length === 0 && n.textContent.trim() === line);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return [r.left >= 0, r.right <= window.innerWidth + 0.5, r.top >= 0, r.bottom <= window.innerHeight + 0.5, e.scrollWidth <= e.clientWidth + 1];
        }, FIRE_SHADOW_LINE);
        ok(box !== null && box.every(Boolean), label + ": the sentence is whole and on screen (" + JSON.stringify(box) + ")");
        ok(m.errors.length === 0, label + ": no page error (" + m.errors.join("; ") + ")");
        ok(m.calls.every((c) => c.status === 200), label + ": every route the page reads answers 200 (" + m.calls.filter((c) => c.status !== 200).map((c) => c.path + " " + c.status).join(", ") + ")");
      } finally {
        await m.ctx.close();
      }
    }
    const on = world({ FF_MODE: "on" });
    const live = await openFire(browser, worker, on, [1440, 820]);
    ok(!(await visibleText(live.page)).includes(FIRE_SHADOW_LINE), "with FF_MODE on the page does not say shadow");
    await live.ctx.close();
  }
  if (!failures.length && (!ONLY || ONLY === "plants")) {
    for (const [name, client] of PLANTS) {
      const got = await journey(browser, worker, { client });
      if (judge(got).length) kills++;
      else failures.push("planted build survives: " + name);
    }
  }
} finally {
  await browser.close();
  clock.restore();
  log.restore();
}

if (failures.length) {
  for (const f of failures) process.stderr.write("✗ " + f + "\n");
  process.stderr.write(`ff-u-fire: ${failures.length} failed of ${checks} checks\n`);
  process.exit(1);
}
process.stdout.write(`✓ ff-u-fire: ${checks} checks hold: the Fire page runs on the real client against the mounted Worker\n`);
process.stdout.write(`✓ ff-u-fire: ${kills} of ${PLANTS.length} planted wrong clients fail the journey\n`);

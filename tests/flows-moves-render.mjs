import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import * as M from "../shared/flows-moves0.js";
import { rarityText } from "../shared/flows-targets.js";
import * as SIG from "../shared/flows-moves-sig.js";
import { flowsPageRows, FLOWS_PAGE_SLUGS } from "../server/routes/flows-pages.js";
import { HttpError } from "../server/http.js";
import * as FX from "./lib/moves-fixture.mjs";
import { HORIZON_SESSIONS, horizonWords } from "../shared/flows-horizon.js";
import { bootUI } from "./lib/ui-boot.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const HTML = PAGES.movesPage({ username: "test" });
const JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-moves.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-moves.css"), "utf8");
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;
const COLOUR_FN = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/;
const FORBID = /\b(unusual|alert|alerts|screen|rare|sigma|radar)\b|\bat (the )?(ask|bid)\b/i;
const NOT_BUILT = /\bq\s*(<=|≤|<)|\bNOW\b|\bHawkes\b|1 in [\d,]+ of/;
const MINUS = "−", DASH = "—";
const SQRT252 = Math.sqrt(252);
const carried = (src, sentence) => sentence.split(String(HORIZON_SESSIONS)).every((piece) => src.includes(JSON.stringify(piece).slice(1, -1)));
const stripHtml = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<aside class="ak-dock"[\s\S]*?<\/aside>/, "").replace(/<aside class="fx-side"[\s\S]*?<\/aside>/, "");

const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
ok(/^FLOWS_MOVES = "on"$/m.test(wrangler), "the switch ships on: the owner opened the Moves page to every member on 2026-10-12");

{
  const text = stripHtml(HTML);
  eq((HTML.match(/<h1[ >]/g) || []).length, 1, "one h1");
  ok(/<title>Flows — Moves<\/title>/.test(HTML), "the title says Moves");
  ok(/<h1 id="fxTitle">Large moves<\/h1>/.test(HTML) && /data-fx-hero/.test(HTML), "the heading says Large moves");
  ok(!FORBID.test(text), "no forbidden word in the page's own text, title or description");
  ok(!NOT_BUILT.test(text) && !NOT_BUILT.test(JS), "no q, no flagged, no Hawkes and no boundary claim anywhere in the page or script");
  const nav = /<aside class="fx-side"[\s\S]*?<\/aside>/.exec(HTML)[0];
  ok(/href="\/flows\/moves\/"[^>]*aria-current="page"/.test(nav) && nav.includes(">Moves<"), "the rail names Moves on its own page");
  ok(/href="\/flows\/moves\/"/.test(PAGES.marketPage({ username: "test" })), "and every other page links it in the rail");
  ok(/\/assets\/js\/flows-moves\.js\?v=\d+/.test(HTML) && /\/assets\/css\/flows-moves\.css\?v=\d+/.test(HTML), "the controller and the sheet are versioned");
  ok(!/flows-feeds\.css|flows-chart\.js/.test(HTML), "no feeds sheet and no chart script");
  ok(/data-flows-page="moves"/.test(HTML), "the page owns the one-screen shell hook");
  for (const w of M.HEADER_SENTENCES) ok(M.wordCount(w) <= M.HEADER_WORDS_MAX, "a header sentence stays inside fourteen words: " + w);
  ok(!FORBID.test(M.HEADER_SENTENCES.join(" ")), "and uses none of the forbidden words");
  for (const w of [M.LINE, M.CAPTION, ...M.RADAR_SENTENCES]) ok(JS.includes(JSON.stringify(w).slice(1, -1)), "the controller carries the leaf's sentence: " + w);
  eq(bootUI().F.horizon(HORIZON_SESSIONS).apart, M.APART, "the page kernel prints the leaf's sentence for the earnings window");
  ok(!JS.includes(M.APART) && !/\b21\b/.test(JS.replace(/<h3>21 sessions<\/h3>|<h3>21 sessions <span|slice\(-21\)/g, "")), "and the controller carries no window of its own");
  for (const w of [M.SECTORS_LINE, M.MEDIAN_NOTE, M.BEYOND_NOTE, M.SHARE_NOTE, M.LEFT_OUT_NOTE, M.PINS_NOTE, M.WHY_NO_IV, M.WHY_ALL_EVENT]) ok(carried(JS, w), "the controller carries the leaf's sector sentence, around the payload's own window: " + w);
  ok(HTML.includes(M.SECTORS_LINE.replace("'", "&#39;")), "and the served sector box carries the one line that says what the table is");
  ok(JS.includes("const SECTOR_BEYOND = 2;") && M.SECTOR_BEYOND === 2 && JS.includes('const NO_SECTOR = "No sector";') && M.NO_SECTOR === "No sector", "the line at 2 IV-days and the name of the empty sector are shared with the leaf");
  ok(!JS.includes("not yet published") && JS.includes(JSON.stringify(SIG.SIG_FLAGGED_LINE).slice(1, -1)), "the muted note is gone and the test's sentence is carried");
  const panels = [...HTML.matchAll(/role="tab" aria-selected="(\w+)" aria-controls="(\w+)" data-v="(\w+)"/g)];
  eq(panels.map((x) => [x[2], x[3], x[1]]), [["mvMain", "field", "true"], ["mvLists", "lists", "false"], ["mvRail", "detail", "false"]], "three phone tabs control three panels, Field first");
  for (const id of ["mvMain", "mvLists", "mvRail", "mvPlot", "mvNow", "mvApart", "mvMoreDlg", "mvInfoDlg", "mvListSeg", "mvSecBox", "mvSec", "mvSecMore", "mvSecNote", "mvSecDlg", "mvSecG", "mvDir", "mvEarn", "mvSector", "mvClear", "mvFreeze"]) ok(new RegExp('id="' + id + '"').test(HTML), "the shell carries #" + id);
  const sentences = text.replace(/<[^>]+>/g, ". ").split(/[.!?]\s+/).map((s) => s.trim()).filter((s) => s.length > 3);
  for (const s of sentences) ok(M.wordCount(s) <= 14, "a sentence of the served HTML stays short: " + s.slice(0, 60));
  ok(!COLOUR_LITERAL.test(CSS), "the sheet holds no colour literal: tokens only");
  ok(!COLOUR_FN.test(JS.replace(/&#39;/g, "")), "and neither does the script");
  ok(COLOUR_LITERAL.test(CSS + "\n.x { color: #fff; }") && COLOUR_LITERAL.test(CSS + "\n.x { background: rgb(1, 2, 3); }"), "and the scan catches a planted literal");
  ok(!/(^|[^-\w])transition\b/.test(CSS.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "")), "every transition sits inside no-preference");
  ok(!/\bglobalThis\.|(?<![\w.])window\.[A-Za-z]+\s*=(?!=)/.test(JS.replace(/globalThis\.__MovesTest/, "")), "no new global");
  ok(!/scroll/.test(CSS.replace(/touch-action/g, "")) || !/overflow(-y)?:\s*(auto|scroll)/.test(CSS), "the sheet scrolls nothing");
}

{
  ok(FLOWS_PAGE_SLUGS.includes("moves"), "the route table lists the page");
  const mk = (mode, owner) => {
    const rows = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => owner });
    const row = rows.find((r) => r.id === "flows.pages.moves");
    return row.handler({ request: new Request("https://x.test/flows/moves/"), env: mode === undefined ? {} : { FLOWS_MOVES: mode }, url: new URL("https://x.test/flows/moves/") });
  };
  const status = async (mode, owner) => { try { return (await mk(mode, owner)).status; } catch (e) { ok(e instanceof HttpError, "a refusal is an HttpError"); return e.status; } };
  eq(await status(undefined, true), 200, "unset: the owner is served");
  eq(await status(undefined, false), 404, "unset: a member gets the 404 of an unknown page");
  eq(await status("owner", false), 404, "owner: a member gets 404");
  eq(await status("on", false), 200, "on: a member is served");
  eq(await status("off", true), 404, "off: even the owner gets 404");
  eq(await status("garbage", false), 404, "an unknown value fails closed for a member");
}

const LIST = FX.names();
const BODY = FX.universe(LIST);
const DEC = FX.decoded(BODY);
const pctT = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "") + Math.abs(+(v * 100).toFixed(1)).toFixed(1) + "%";
const sgn1 = (m) => (m < 0 ? MINUS : m > 0 ? "+" : "") + Math.abs(m).toFixed(1);
const typPct = (x) => (x * 100).toFixed(x * 100 >= 10 ? 0 : 1) + "%";
const PIN = ["SPY", "QQQ"];
const quant = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.max(0, Math.ceil(0.995 * s.length) - 1)] : 0; };

const model = (rows) => {
  const all = [];
  for (const r of rows) {
    if (!(r.iv > 0)) continue;
    const m = r.chg / (r.iv / SQRT252);
    const z = r.sig > 0 ? Math.log1p(r.chg) / r.sig : null;
    all.push({ ...r, m, a: Math.abs(m), z, event: (Number.isInteger(r.ed) && r.ed >= 0 && r.ed <= 21) || (Number.isInteger(r.rd) && r.rd >= 0 && r.rd <= 1) || (Number.isInteger(r.rdMax) && r.rdMax >= 0 && r.rdMax <= 2) });
  }
  const plotted = all.filter((x) => x.z !== null);
  const xmax = Math.min(12, Math.max(3, Math.ceil(quant(plotted.map((x) => Math.abs(x.z))))));
  const ymax = Math.min(10, Math.max(3, Math.ceil(quant(plotted.map((x) => x.a)))));
  const capMax = Math.max(0, ...plotted.filter((x) => !PIN.includes(x.t)).map((x) => x.cap || 0));
  return { all, plotted, xmax, ymax, capMax };
};
const byA = (a, b) => b.a - a.a || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
const rarityFull = (x) => {
  if (!(x.sig > 0)) return null;
  const lr = Math.abs(Math.log1p(x.chg));
  const level = lr >= 3 * x.sig ? 3 : lr >= 2 * x.sig ? 2 : 0;
  const hits = level === 3 ? x.f3 : level === 2 ? x.f2 : null;
  if (!level || hits === null || !Number.isInteger(hits) || hits < 0 || hits > 252) return null;
  return rarityText({ k: level, sigmaRef: x.sig, route: "empirical", hits });
};
const chipOf = (full) => (full === null ? DASH : /rarer than 1 in 250/.test(full) ? "beyond 1 in 250" : /about (1 in \d+)/.exec(full)[1]);

{
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(JS, sandbox);
  const T = sandbox.__MovesTest;
  ok(T && typeof T.rarityParts === "function", "the page exposes its pure functions only where there is no document");
  ok(typeof T.peerParts === "function", "the parts of the move are among them");
  for (const w of [...M.PARTS_SENTENCES, ...Object.values(M.PARTS_LABELS)]) ok(JS.includes(JSON.stringify(w).slice(1, -1)), "the controller carries the leaf's parts wording: " + w);
  ok(M.PEER_MIN === 10 && JS.includes("const PEER_MIN = 10;") && M.MAD_SCALE === 1.4826 && JS.includes("const MAD_SCALE = 1.4826;"), "the page and the leaf share the ten-peer floor and the 1.4826 scale of the median absolute deviation");
  for (const w of M.PARTS_SENTENCES) ok(M.wordCount(w) <= M.HEADER_WORDS_MAX && !FORBID.test(w), "a parts sentence stays inside fourteen words and uses no forbidden word: " + w);
  {
    const rnd = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const r = rnd(20261026);
    const SECS = ["A", "B", "C", null];
    let worlds = 0, subjects = 0, withPeers = 0, without = 0;
    for (let w = 0; w < 400; w++) {
      const rows = [];
      const n = Math.floor(r() * 120);
      for (let i = 0; i < n; i++) rows.push({ t: "T" + i, chg: r() < 0.08 ? null : Math.round((r() - 0.5) * 0.2 * 1e4) / 1e4, sector: SECS[Math.floor(r() * 4)] });
      if (r() < 0.7) rows.push({ t: "SPY", chg: r() < 0.1 ? null : Math.round((r() - 0.5) * 0.04 * 1e4) / 1e4, sector: SECS[Math.floor(r() * 3)] });
      if (r() < 0.7) rows.push({ t: "QQQ", chg: Math.round((r() - 0.5) * 0.04 * 1e4) / 1e4, sector: SECS[Math.floor(r() * 3)] });
      worlds++;
      for (const row of rows) {
        const a = T.peerParts(rows, row.t);
        const b = M.partsOf(rows, row.t);
        subjects++;
        if (b === null) { eq(a, null, "a name with no change has no parts: " + row.t); continue; }
        if (b.peers) withPeers++; else without++;
        eq(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), "the page's parts equal the leaf's for " + row.t + " in world " + w);
        if (b.parts.length) eq(b.parts.reduce((s, p) => s + p.tenths, 0), b.total, "the parts add to the rounded move exactly in world " + w);
      }
    }
    ok(worlds === 400 && subjects > 5000 && withPeers > 300 && without > 300, "the equality held over " + subjects + " subjects, " + withPeers + " with peers and " + without + " without");
    const world = [{ t: "S", chg: 0.031, sector: "X" }, { t: "SPY", chg: 0.004, sector: "X" }, ...[0.002, 0.005, 0.008, 0.010, 0.012, 0.012, 0.014, 0.016, 0.020, 0.030].map((c, i) => ({ t: "P" + i, chg: c, sector: "X" }))];
    const hand = T.peerParts(world, "S");
    eq(JSON.parse(JSON.stringify(hand.parts.map((p) => p.tenths))), [4, 8, 19], "hand worked: market 0.4, peers 0.8 above it, the name 1.9 above its peers");
    ok(Math.abs(hand.peers.median - 0.012) < 1e-15 && Math.abs(hand.peers.spread - 1.4826 * 0.004) < 1e-12 && Math.abs(hand.peers.z - 0.019 / (1.4826 * 0.004)) < 1e-9, "median 0.012, spread 1.4826 x 0.004 and z 3.2038");
    eq(T.peerParts(world.filter((x) => x.t !== "P0"), "S").peers, null, "nine peers give none");
    eq(T.peerParts(world.map((x) => (x.t === "P0" ? { ...x, chg: null } : x)), "S").peerWhy, "9 peers, needs 10.", "a null change is not a peer and is never a zero");
    eq(T.peerParts([{ t: "S", chg: 0.01, sector: "X" }, ...Array.from({ length: 10 }, (_, i) => ({ t: "P" + i, chg: 0.01, sector: "X" }))], "S").peers.z, null, "a zero spread has no z, not infinity");
    eq(T.peerParts([{ t: "S", chg: null, sector: "X" }], "S"), null, "a name with no change has no parts");
  }
  {
    const IV = Math.sqrt(252);
    const toLeaf = (rows) => rows.map((x) => ({ t: x.t, chg: x.chg, iv30p: x.iv, ed: x.ed, sector: x.sector }));
    const strip = (v) => JSON.parse(JSON.stringify(v.map(({ key, ...rest }) => rest)));
    const rnd = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const q = rnd(20261028);
    const NAMES = ["Alpha", "Beta", "Gamma", null, "Delta"];
    let worlds = 0, sectors = 0, empties = 0;
    for (let w = 0; w < 300; w++) {
      const rows = [];
      const n = Math.floor(q() * (w % 4 === 0 ? 8 : 90));
      for (let i = 0; i < n; i++) rows.push({ t: "T" + i, chg: q() < 0.06 ? null : Math.round((q() - 0.5) * 0.3 * 1e4) / 1e4, iv: q() < 0.08 ? (q() < 0.5 ? null : 0) : Math.round((0.15 + q() * 0.6) * 1e4) / 1e4, sector: NAMES[Math.floor(q() * 5)], ed: q() < 0.2 ? Math.floor(q() * 40) : null });
      if (q() < 0.6) rows.push({ t: "SPY", chg: 0.5, iv: 0.2, sector: "Alpha", ed: null });
      if (q() < 0.6) rows.push({ t: "QQQ", chg: -0.5, iv: 0.2, sector: "Beta", ed: null });
      const got = T.sectorStats(rows.map((r) => ({ ...r, event: M.eventInside({ ed: r.ed }) })), HORIZON_SESSIONS);
      const want = M.sectorStats(toLeaf(rows));
      worlds++;
      sectors += got.length;
      empties += got.filter((x) => x.median === null).length;
      eq(strip(got), JSON.parse(JSON.stringify(want)), "the page's sector figures equal the leaf's in world " + w);
      eq(JSON.parse(JSON.stringify(got.map((x) => x.key))), want.map((x) => (x.name === M.NO_SECTOR ? "__none" : x.name)), "and each row carries the key the sector filter uses, in world " + w);
    }
    ok(worlds === 300 && sectors > 600 && empties > 20, "the page's sector table equals the leaf's over " + worlds + " worlds, " + sectors + " sectors and " + empties + " with no median");
    const edge = (list) => JSON.parse(JSON.stringify(T.sectorStats(list.map((m, i) => ({ t: "E" + i, chg: m, iv: IV, sector: "X", ed: null, event: false })))))[0];
    eq(edge([2, -2]).beyond, 0, "the page: exactly 2 and exactly -2 are not beyond 2");
    eq(edge([2.01]).beyond, 1, "and 2.01 is");
    eq(edge([-2.01]).beyond, 1, "and -2.01");
    const flagged = (list, hz = HORIZON_SESSIONS, j = 0) => list.map((r) => ({ ...r, event: M.eventInside(r, hz, j) }));
    eq(T.sectorStats(flagged([{ t: "A", chg: 1, iv: IV, sector: "X", ed: 21 }, { t: "B", chg: 1, iv: IV, sector: "X", ed: 22 }]), HORIZON_SESSIONS)[0].n, 1, "the page: 21 sessions is inside the earnings window and 22 is not");
    eq(T.sectorStats(flagged([{ t: "A", chg: 1, iv: IV, sector: "X", ed: null, rd: 1 }, { t: "B", chg: 1, iv: IV, sector: "X", ed: null, rd: 2 }]), HORIZON_SESSIONS)[0].n, 1, "and a name that reacted a session ago is set apart where one that reacted two ago is not");
    eq(T.sectorStats([{ t: "A", chg: 1, iv: IV, sector: "X", event: true }], 30)[0].why, "Every measured name reports within 30 sessions.", "and the sentence for a sector with nothing left carries the payload's own window");
    for (const [b, n] of [[0, 5], [1, 300], [1, 200], [3, 8], [5, 5], [0, 0], [2, 1], [-1, 5], [1.5, 5]]) eq(T.shareText(b, n), M.shareText(b, n), "the page's share text equals the leaf's for " + b + " of " + n);
  }
  for (const level of [2, 3]) {
    for (let hits = 0; hits <= 252; hits++) {
      const sig = 0.02;
      const x = { chg: Math.expm1(level * sig + 0.001), sig, f2: level === 2 ? hits : 99, f3: level === 3 ? hits : 99 };
      const got = T.rarityParts(x);
      const want = rarityText({ k: level, sigmaRef: sig, route: "empirical", hits });
      eq(got.text, want, "the rarity sentence equals the leaf's rarityText at level " + level + ", " + hits + " of 252");
      eq(got.short, chipOf(want), "and its short form is the leaf's own phrase at " + hits);
    }
  }
  eq(T.rarityParts({ chg: 0.03, sig: 0.02, f2: null, f3: null }), null, "a missing count is no sentence, never a guess");
  eq(T.rarityParts({ chg: 0.03, sig: null, f2: 3, f3: 1 }), null, "a missing typical day is no sentence");
  eq(T.rarityParts({ chg: 0.019, sig: 0.01, f2: 3, f3: 1 }), T.rarityParts({ chg: 0.019, sig: 0.01, f2: 3, f3: 1 }), "deterministic");
  eq(T.rarityParts({ chg: 0.0199, sig: 0.01, f2: 3, f3: 1 }), null, "a simple change that is 1.99 typical days has no count");
  eq(T.rarityParts({ chg: 0.0201, sig: 0.01, f2: 3, f3: 1 }), null, "and so has one of 2.01 typical days that is 1.99 as a log return: the counts are on log returns");
  eq(T.rarityParts({ chg: -1.5, sig: 0.01, f2: 3, f3: 1 }), null, "a change of minus 100% or worse has no log return and no sentence");
  for (const [chg, iv] of [[-0.031, 0.35], [0.0231, 0.3], [0, 0.3], [-0.08, 0.4]]) eq(T.ivDays(chg, iv), M.ivDays(chg, iv), "ivDays equals the leaf for " + chg + " / " + iv);
  for (const bad of [null, 0, -1, NaN, "0.3"]) eq(T.ivDays(0.02, bad), null, "ivDays of " + String(bad) + " is null");
  eq(T.signed(-1.04), MINUS + "1.0", "a negative prints U+2212");
  eq(T.signed(0), "0.0", "zero prints no sign");
  const rows = DEC.map((r) => ({ t: r.t, chg: r.chg, iv30p: r.iv, sig: r.sig, cap: r.cap }));
  const pts = rows.map((r) => M.radarPoint(r)).filter(Boolean);
  const mine = model(DEC);
  const fromLeaf = M.radarDomain(pts);
  eq(fromLeaf, { xmax: mine.xmax, ymax: mine.ymax }, "the leaf's domain equals the independent quantile rule");
  const jj = (v) => JSON.parse(JSON.stringify(v));
  const fromPage = jj(T.domainOf(mine.all.map((x) => ({ z: x.z, a: x.a }))));
  eq(fromPage, fromLeaf, "and the page's domain equals the leaf's");
  eq(jj(T.domainOf([])), { xmax: 3, ymax: 3 }, "an empty field has the smallest domain");
  eq(jj(T.domainOf([{ z: 99, a: 99 }])), { xmax: 12, ymax: 10 }, "the domain is capped at 12 and 10");
  for (const r of [2.5, 4, 7, 14]) {
    for (const dir of ["up", "dn", "fl"]) {
      const d = T.markerPath(dir, r);
      let area;
      if (dir === "fl") area = Math.PI * r * r;
      else {
        const n = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
        const pts2 = [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]]];
        area = Math.abs(pts2[0][0] * (pts2[1][1] - pts2[2][1]) + pts2[1][0] * (pts2[2][1] - pts2[0][1]) + pts2[2][0] * (pts2[0][1] - pts2[1][1])) / 2;
        ok(dir === "up" ? pts2[0][1] < 0 : pts2[0][1] > 0, "a triangle points " + dir);
      }
      ok(Math.abs(area - Math.PI * r * r) < 1e-6 * area + 1e-9, "a " + dir + " marker has the area of a circle of radius " + r);
    }
  }
  ok(T.radiusOf(null, 1, 14) === 2.5 && T.radiusOf(1, 1, 14) === 14 && Math.abs(T.radiusOf(0.25, 1, 14) - 7) < 1e-12 && T.radiusOf(1e-9, 1, 14) === 2.5, "the radius is the square root of cap over the largest, floored at 2.5 px");
}

const FAKE_RT = `(() => { const UI = window.FlowsUI; const cbs = {};
  window.__rtFire = () => (cbs.px || []).forEach((f) => f());
  window.__strips = null;
  window.FlowsUI = Object.freeze({ ...UI, rt: { connect: () => ({ on: (k, f) => { (cbs[k] = cbs[k] || []).push(f); } }), feeds: () => Boolean(window.__strips), strips: () => window.__strips } }); })();`;

async function mount(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", ...(o.context || {}) });
  const page = await ctx.newPage();
  if (o.now) await page.clock.setFixedTime(new Date(o.now));
  const errors = [];
  const asked = [];
  const cardHits = {};
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows-rt.js") return r.fulfill({ contentType: "text/javascript", body: FAKE_RT });
    if (u.pathname === "/assets/js/flows-moves.js" && o.js) return r.fulfill({ contentType: "text/javascript", body: o.js });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search);
    if (u.pathname === "/api/flows/universe") return r.fulfill({ contentType: "application/json", status: o.status || 200, body: JSON.stringify(o.body || BODY), headers: { "X-Payload-Updated": String(Date.parse(FX.GENERATED_AT)) } });
    if (u.pathname === "/api/flows/card") {
      const t = u.searchParams.get("t");
      cardHits[t] = (cardHits[t] || 0) + 1;
      if (o.cardFail && (o.cardFail === "*" || o.cardFail === t) && cardHits[t] === 1) return r.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      if (t === "NOCARD") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "absent" }) });
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(FX.CARD(t)) });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (u.pathname === "/flows/ticker/") return r.fulfill({ contentType: "text/html", body: "<title>ticker</title><p>ticker stub</p>" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
  });
  await page.goto("https://example.test/flows/moves/");
  await page.waitForSelector("#mv[data-ready]", { timeout: 15000 });
  await page.waitForTimeout(o.settle === undefined ? 350 : o.settle);
  return { ctx, page, errors, asked, cardHits };
}

const fit = (page) => page.evaluate(() => {
  const se = document.scrollingElement;
  const inner = (el) => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5); };
  const dl = document.querySelector("dialog[open]");
  return { v: se.scrollHeight <= innerHeight, h: se.scrollWidth <= innerWidth, dlg: dl ? inner(dl) && dl.scrollHeight <= dl.clientHeight + 1 && dl.scrollWidth <= dl.clientWidth + 1 : true, sh: se.scrollHeight, ih: innerHeight, sw: se.scrollWidth, iw: innerWidth };
});

const clipped = (page) => page.evaluate(() => {
  const out = [];
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  for (const panel of document.querySelectorAll(".mv-panel")) {
    if (!vis(panel)) continue;
    const pr = panel.getBoundingClientRect();
    for (const el of panel.querySelectorAll("*")) {
      if (!vis(el) || (el.closest("svg") && el.tagName !== "svg")) continue;
      if (el.closest(".mv-listbox, .mv-plot")) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1 || r.left < pr.left - 1 || r.top < pr.top - 1) out.push(panel.id + ":" + el.className + ":" + Math.round(r.bottom - pr.bottom));
      if (el.matches(".kv, .mv-st, .mv-chip, .mv-tk") && el.scrollWidth > el.clientWidth + 1) out.push("text " + el.className + ":" + el.textContent.slice(0, 20));
    }
    for (const box of panel.querySelectorAll(".mv-listbox")) {
      if (!vis(box)) continue;
      const br = box.getBoundingClientRect();
      for (const c of box.children) { const r = c.getBoundingClientRect(); if (r.bottom > br.bottom + 1 || r.right > br.right + 1) out.push("child of " + box.id + " " + c.className + " " + Math.round(r.bottom - br.bottom)); }
    }
  }
  for (const el of document.querySelectorAll(".mv-chip")) if (vis(el) && el.scrollWidth > el.clientWidth + 1) out.push("chip " + el.textContent);
  return out;
});

const dots = (page) => page.evaluate(() => {
  const svg = document.getElementById("mvSvg");
  return {
    xmax: +svg.dataset.xmax, ymax: +svg.dataset.ymax, l: +svg.dataset.l, t: +svg.dataset.t, w: +svg.dataset.w, h: +svg.dataset.h,
    plotW: document.getElementById("mvPlot").clientWidth, plotH: document.getElementById("mvPlot").clientHeight,
    pts: Array.from(svg.querySelectorAll(".pt"), (e) => {
      const b = e.getBoundingClientRect(), s = svg.getBoundingClientRect();
      return { t: e.dataset.t, cls: e.getAttribute("class"), r: e.dataset.r === undefined ? null : +e.dataset.r, x: +e.dataset.x, y: +e.dataset.y, d: e.getAttribute("d"), tr: e.getAttribute("transform"), cx: b.left + b.width / 2 - s.left, cy: b.top + b.height / 2 - s.top, bw: b.width, bh: b.height, tab: (e.closest(".hit") || e).getAttribute("tabindex"), role: (e.closest(".hit") || e).getAttribute("role"), hidden: e.getAttribute("aria-hidden"), label: (e.closest(".hit") || e).getAttribute("aria-label"), sel: e.hasAttribute("data-sel") };
    }),
    rings: Array.from(svg.querySelectorAll(".ring"), (e) => ({ t: e.dataset.ring, r: +e.getAttribute("r"), cx: +e.getAttribute("cx"), cy: +e.getAttribute("cy"), off: e.getAttribute("class").includes("off") })),
    labels: Array.from(svg.querySelectorAll(".lab"), (e) => ({ t: e.dataset.lab, text: e.textContent, sel: e.getAttribute("class").includes("sel") })),
    refs: Array.from(svg.querySelectorAll(".ref"), (e) => e.dataset.ref),
    shapes: svg.querySelectorAll("path.boundary, .bound, [data-boundary]").length,
  };
});

const listRows = (page, id) => page.evaluate((i) => Array.from(document.querySelectorAll("#" + i + " .mv-row"), (r) => ({ t: r.dataset.t, m: r.querySelector('[data-k="m"]').textContent, chg: r.querySelector('[data-k="chg"]').textContent, how: r.querySelector('[data-k="how"]').textContent, title: r.title, label: r.getAttribute("aria-label"), cur: r.getAttribute("aria-current"), tab: r.tabIndex })), id);

const railKv = (page) => page.evaluate(() => {
  const out = {};
  for (const e of document.querySelectorAll("#mvRail .kv")) out[e.children[0].textContent] = e.children[1].textContent;
  const g = (s) => { const e = document.querySelector("#mvRail " + s); return e ? e.innerText : null; };
  const sp = document.querySelector("#mvRail .mv-spark polyline");
  return { kv: out, big: g(".big"), st: g(".mv-st"), why: g(".why"), say: g('[data-k="say"]'), open: document.querySelector("#mvRail .mv-open") ? document.querySelector("#mvRail .mv-open").getAttribute("href") : null, spark: sp ? sp.getAttribute("points").split(" ").length : 0, text: document.getElementById("mvRail").innerText, dates: Array.from(document.querySelectorAll("#mvRail .mv-dates span"), (e) => e.textContent) };
});

const PW = (() => {
  const T = 1e12;
  const peerChg = [0.002, 0.005, 0.008, 0.010, 0.012, 0.012, 0.014, 0.016, 0.020, 0.030];
  const rows = [
    ["SPY", 0.0044, 0.16, 90, "Alpha", 40 * T, 0.0065, 14, 3],
    ["QQQ", 0.011, 0.22, 90, "Alpha", 20 * T, 0.0085, 11, 2],
    ["A1", 0.031, 0.30, 60, "Alpha", 1 * T, 0.01, 12, 2],
    ...peerChg.map((c, i) => ["A_P" + i, c, 0.30, 60, "Alpha", (i + 1) * 1e10, 0.01, 10, 1]),
    ["B1", -0.020, 0.30, 60, "Beta", 1 * T, 0.01, 12, 2],
    ...Array.from({ length: 9 }, (_, i) => ["B_P" + i, 0.001 * (i - 4), 0.30, 60, "Beta", (i + 1) * 1e10, 0.01, 10, 1]),
    ["G1", 0.045, 0.30, 60, "Gamma", 1 * T, 0.01, 12, 2],
    ...Array.from({ length: 12 }, (_, i) => ["G_P" + i, 0.0005 * (i - 6), 0.30, 60, "Gamma", (i + 1) * 1e10, 0.01, 10, 1]),
    ["NOSEC", -0.047, 0.30, 60, null, 5e11, 0.01, 12, 2],
    ["E1", 0.0344, 0.30, 60, "Echo", 1 * T, 0.01, 12, 2],
    ...[0.001, 0.004, 0.008, 0.011, 0.0126, 0.0126, 0.014, 0.017, 0.02, 0.03].map((c, i) => ["E_P" + i, c, 0.30, 60, "Echo", (i + 1) * 1e10, 0.01, 10, 1]),
    ["D1", 0.052, 0.30, 60, "Delta", 1 * T, 0.01, 12, 2],
    ...Array.from({ length: 10 }, (_, i) => ["D_P" + i, 0.001 * (i + 1) - 0.0055, 0.30, 60, "Delta", (i + 1) * 1e10, 0.01, 10, 1]),
  ];
  const body = FX.universe(rows);
  const nulled = new Set(["G_P0", "G_P5", "G_P11"]);
  body.t.forEach((t, i) => { if (nulled.has(t)) body.cols.chg[i] = null; });
  const dec = FX.decoded(body).map((r, i) => (body.cols.chg[i] === null ? { ...r, chg: null } : r));
  return { body, rows: dec };
})();
const signedT = (k) => (k < 0 ? MINUS : k > 0 ? "+" : "") + Math.abs(k / 10).toFixed(1) + "%";
const tenthsOfText = (s) => Math.round(parseFloat(s.replace(MINUS, "-").replace(/[^0-9.+-]/g, "")) * 10);
const partsRead = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector("#mvRail " + s);
  return {
    items: Array.from(document.querySelectorAll("#mvRail .mv-pt"), (e) => ({ k: e.dataset.k, label: e.querySelector("i").textContent, v: e.querySelector("b").textContent, note: e.querySelector("em") ? e.querySelector("em").textContent : null, title: e.title })),
    why: q(".mv-pn") ? q(".mv-pn").textContent : null,
    total: q(".mv-st").textContent,
    big: q(".big").textContent,
    fits: Array.from(document.querySelectorAll("#mvRail .mv-parts, #mvRail .why"), (e) => e.scrollWidth <= e.clientWidth + 1),
    group: q(".mv-parts") ? q(".mv-parts").getAttribute("role") : null,
  };
});
const pickName = async (page, t) => {
  const d = await dots(page);
  const p = d.pts.find((q) => q.t === t);
  if (!p) throw new Error("no dot for " + t);
  const box = await page.locator("#mvPlot").boundingBox();
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await page.waitForTimeout(200);
};
const expectParts = (t) => {
  const r = M.partsOf(PW.rows, t);
  const items = r.parts.map((p) => ({ k: p.key, label: p.label, v: signedT(p.tenths), note: p.key === "peers" ? r.peers.n + " peers" : p.key === "name" && r.peers && r.peers.z !== null ? Math.abs(r.peers.z).toFixed(1) + "× peer spread" : null }));
  return { r, items, why: r.peers ? null : r.peerWhy };
};

async function partsBlock(browser, js, P, same) {
  for (const [w, h, extra] of [[1440, 820, {}], [1024, 768, {}], [390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const { ctx, page, errors } = await mount(browser, w, h, { context: extra, js, body: PW.body });
    if (w < 900) await page.click('#mvSeg5 [data-v="field"]');
    const order = ["A1", "E1", "B1", "G1", "NOSEC", "D1", "SPY", "QQQ"];
    for (const t of order) {
      if (w < 900) await page.click('#mvSeg5 [data-v="field"]');
      await pickName(page, t);
      if (w < 900) { await page.click('#mvSeg5 [data-v="detail"]'); await page.waitForTimeout(120); }
      const got = await partsRead(page);
      const want = expectParts(t);
      P(got.big === t, w + ": the drill panel is on " + t + " (" + got.big + ")");
      same(got.items.map((i) => ({ k: i.k, label: i.label, v: i.v, note: i.note })), want.items, w + " " + t + ": the printed parts are the leaf's parts, to the tenth of a percent");
      P(got.why === want.why, w + " " + t + ": the reason peers are missing is " + want.why + " (" + got.why + ")");
      P(got.group === "group", w + " " + t + ": the parts are one named group");
      if (got.items.length) {
        const sum = got.items.reduce((a, i) => a + tenthsOfText(i.v), 0);
        P(sum === tenthsOfText(got.total), w + " " + t + ": the printed parts add to the printed move exactly (" + sum + " vs " + tenthsOfText(got.total) + ")");
        P(got.items.every((i) => i.title.startsWith(i.label + " ") && i.title.includes(i.v)), w + " " + t + ": every part carries its full label and figure in its title");
      }
      if (w >= 900) P(got.fits.every(Boolean), w + " " + t + ": the parts and the caption beside them are not cut off");
      if (t === "A1") {
        same(got.items.map((i) => i.v), ["+0.4%", "+0.8%", "+1.9%"], w + ": the worked example: SPY +0.4%, peer median +1.2%, name +3.1% give 0.4, 0.8 and 1.9");
        same(got.items.map((i) => i.note), [null, "10 peers", "3.2× peer spread"], w + ": ten peers, and 0.019 over 1.4826 x 0.004 is 3.2 peer spreads");
        P(Math.abs(want.r.peers.z - 0.019 / (1.4826 * 0.004)) < 1e-9 && want.r.peers.median === 0.012, w + ": the leaf's median and z are the hand-worked 0.012 and " + (0.019 / (1.4826 * 0.004)).toFixed(4));
      }
      if (t === "E1") {
        same(got.items.map((i) => i.v), ["+0.4%", "+0.9%", "+2.1%"], w + ": rounding the levels, not the gaps: SPY 0.44 and peers 1.26 are 0.4 and 1.3, so the name's 3.44 leaves 2.1 and the parts add to 3.4");
        P(tenthsOfText(got.total) === 34, w + ": the printed move is 3.4");
      }
      if (t === "B1") same(got.items.map((i) => i.v), ["+0.4%", MINUS + "2.4%"], w + ": nine peers is below the ten needed: the market part and the name against the market remain");
      if (t === "G1") P(got.why === "9 peers, needs 10." && got.items.length === 2, w + ": three peers with no change are left out, so twelve names make nine and no peer part is drawn");
      if (t === "NOSEC") P(got.why === "No sector, so no peers." && got.items.length === 2, w + ": a name with no sector has the market part and no peers");
      if (t === "D1") P(want.r.peers && want.r.peers.n === 10 && got.items.length === 3 && got.why === null, w + ": exactly ten peers is enough");
      if (t === "SPY") P(got.items.length === 0 && got.why === "A market reference has no peers.", w + ": SPY has no parts, only the reason");
      if (t === "QQQ") P(got.items.length === 2 && got.why === "A market reference has no peers." && got.items[0].k === "market", w + ": QQQ is read against SPY alone: pins are never peers, though they share a sector with A1");
      if (t === "A1") {
        const f = await fit(page);
        P(f.v && f.h, w + ": the page does not scroll with the longest parts strip (" + f.sh + " of " + f.ih + ")");
        const cl = await clipped(page);
        P(cl.length === 0, w + ": nothing clipped with the parts strip " + cl.slice(0, 3).join(" | "));
      }
    }
    P(errors.length === 0, w + ": no page error in the parts block " + errors.join(" | "));
    await ctx.close();
  }
}

const flatShown = (m) => { const a = Math.round(Math.abs(m) * 10) / 10; return a === 0 ? 0 : m < 0 ? -a : a; };
const glyphOf = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "◆");
const shareExp = (b, n) => { const p = Math.round((100 * b) / n); return b > 0 && p === 0 ? "<1%" : p + "%"; };
const namesOf = (n) => n + (n === 1 ? " name" : " names");
const secExpect = (r) => [r.name === M.NO_SECTOR ? "__none" : r.name, r.name, r.median === null ? r.why : r.n === r.total ? namesOf(r.total) : r.n + " of " + namesOf(r.total), r.median === null ? DASH : glyphOf(flatShown(r.median)) + " " + sgn1(flatShown(r.median)), r.median === null ? DASH : r.beyond + " · " + shareExp(r.beyond, r.n), r.measured === 0];
const secRead = (page, sel) => page.evaluate((q) => Array.from(document.querySelectorAll(q + " .mv-srow"), (b) => ({ key: b.dataset.sector, name: b.querySelector(".mv-sn b").textContent, sub: b.querySelector(".mv-sn .sub").textContent, median: b.querySelector('[data-k="median"]').textContent, beyond: b.querySelector('[data-k="beyond"]').textContent, pressed: b.getAttribute("aria-pressed"), disabled: b.disabled, title: b.title, label: b.getAttribute("aria-label"), tab: b.tabIndex, h: b.offsetHeight })), sel);
const txt = (page, id) => page.evaluate((i) => document.getElementById(i).textContent, id);
const secKey = (r) => [r.key, r.name, r.sub, r.median, r.beyond, r.disabled];

const SEC_IV = Math.sqrt(252);
const SEC_T = 1e12;
const SEC_LIST = [
  ["SPY", 0.004, 0.16, 90, "Line", 40 * SEC_T, 0.0065, 14, 3],
  ["TB1", 0.01, 0.3, 60, "Tie B", 1e10, 0.01, 10, 1], ["TA1", 0.01, 0.3, 60, "Tie A", 1e10, 0.01, 10, 1],
  ...["L1", "L2", "L3", "L4", "L5", "L6"].map((t) => [t, 0.01, 0.3, 60, "Line", 1e10, 0.01, 10, 1]),
  ["F1", 0.001, 0.3, 60, "Flat", 1e10, 0.01, 10, 1],
  ["G1", 0.01, null, 60, "Ghost", 1e10, 0.01, 10, 1], ["G2", 0.01, null, 60, "Ghost", 1e10, 0.01, 10, 1],
  ["S1", 0.01, 0.3, 5, "Soon", 1e10, 0.01, 10, 1], ["S2", 0.01, 0.3, 5, "Soon", 1e10, 0.01, 10, 1],
];
const SEC_STRIPS = { TB1: [1, SEC_IV], TA1: [1, SEC_IV], L1: [2, SEC_IV], L2: [2.01, SEC_IV], L3: [-2, SEC_IV], L4: [-2.01, SEC_IV], L5: [0.4, SEC_IV], L6: [0, SEC_IV], F1: [-0.04, SEC_IV], G1: [0.01, null], G2: [0.02, null], S1: [3, SEC_IV], S2: [0.1, SEC_IV], SPY: [50, SEC_IV] };
const SEC_BIG = [["SPY", 0.004, 0.16, 90, "Funds", 40 * SEC_T, 0.0065, 14, 3], ...Array.from({ length: 30 }, (_, i) => ["Sec" + String(i).padStart(2, "0"), 0.004 * (i - 14), 0.3, 60, "Sector " + String(i).padStart(2, "0"), 1e10, 0.01, 10, 1]).flatMap((a, i) => [a, ["B" + String(i).padStart(2, "0"), 0.003 * (((i * 7) % 11) - 5), 0.3, 60, a[4], 1e10, 0.01, 10, 1]])];

async function sectorsBlock(browser, js, P, same) {
  const want = M.sectorStats(DEC.map((r) => ({ t: r.t, chg: r.chg, iv30p: r.iv, ed: r.ed, rd: r.rd, rdMax: r.rdMax, sector: r.sector })));
  const M1 = model(DEC);
  for (const [w, h, extra] of VIEWPORTS) {
    const phone = w < 900;
    const tag = w + "x" + h;
    const { ctx, page, errors } = await mount(browser, w, h, { context: extra, js });
    if (phone) { await page.click('#mvSeg5 [data-v="lists"]'); await page.waitForTimeout(150); }
    P(await page.locator("#mvSecBox").isHidden() && await page.locator("#mvNow").isVisible(), tag + ": the name lists are the opening view and the sector table is not shown");
    P((await page.locator('#mvListSeg [data-lv="names"]').getAttribute("aria-pressed")) === "true" && (await page.locator('#mvListSeg [data-lv="sectors"]').getAttribute("aria-pressed")) === "false", tag + ": the switch says Names");
    await page.click('#mvListSeg [data-lv="sectors"]');
    await page.waitForTimeout(150);
    P(await page.locator("#mvNow").isHidden() && await page.locator("#mvApart").isHidden() && await page.locator("#mvSecBox").isVisible(), tag + ": Sectors replaces both name lists");
    P((await page.locator('#mvListSeg [data-lv="sectors"]').getAttribute("aria-pressed")) === "true", tag + ": the switch says Sectors");
    const rows = await secRead(page, "#mvSec");
    const rh = rows.length ? rows[0].h : 36;
    P(rh === (phone ? 44 : 36), tag + ": a sector row is " + (phone ? 44 : 36) + " px high (" + rh + ")");
    const boxH = await page.evaluate(() => document.getElementById("mvSec").clientHeight);
    const shown = Math.max(1, Math.min(want.length, Math.floor(boxH / rh)));
    P(rows.length === shown, tag + ": as many sectors as fit are listed (" + rows.length + " of " + shown + ")");
    same(rows.map(secKey), want.slice(0, shown).map(secExpect), tag + ": every sector row is the leaf's name, count, median and beyond-2 share");
    P((await page.locator("#mvSecNote").innerText()) === shown + " of " + want.length, tag + ": the note counts the sectors");
    P((await page.locator("#mvSecMore").isHidden()) === (want.length <= shown), tag + ": Show all is offered exactly when sectors are left out");
    P(rows.every((r) => r.label.startsWith(r.name + ", ")) && rows.filter((r) => r.tab === 0).length === 1, tag + ": every row is named and exactly one is in the tab order");
    P(rows.every((r) => r.pressed === "false"), tag + ": no sector is selected at first");
    const f = await fit(page);
    P(f.v && f.h, tag + ": the page does not scroll with the sector table (" + f.sh + " of " + f.ih + ")");
    const cl = await clipped(page);
    P(cl.length === 0, tag + ": nothing clipped or past its panel in Sectors " + cl.slice(0, 3).join(" | "));
    if (!(await page.locator("#mvSecMore").isHidden())) {
      await page.click("#mvSecMore");
      await page.waitForTimeout(150);
      const k = Math.min(want.length, Math.max(1, Math.floor((h - 24 - 230) / rh)));
      const dr = await secRead(page, "#mvSecG");
      same(dr.map(secKey), want.slice(0, k).map(secExpect), tag + ": the dialog lists " + k + " sectors in the same order and figures");
      P((await page.locator("#mvSecT").innerText()) === (k === want.length ? "Sectors, " + want.length : "Largest " + k + " of " + want.length + " sectors"), tag + ": the dialog title counts what it shows");
      same(await page.locator("#mvSecP").innerText(), [M.SECTORS_LINE, M.MEDIAN_NOTE, M.BEYOND_NOTE, M.SHARE_NOTE, M.LEFT_OUT_NOTE, M.PINS_NOTE].join(" "), tag + ": the dialog says how to read the table");
      const fd = await fit(page);
      P(fd.v && fd.h && fd.dlg, tag + ": the dialog sits inside the viewport and scrolls nothing (" + JSON.stringify(fd) + ")");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(80);
    }
    const countNow = async () => {
      if (phone) { await page.click('#mvSeg5 [data-v="field"]'); await page.waitForTimeout(150); }
      const t = await txt(page, "mvCount");
      if (phone) { await page.click('#mvSeg5 [data-v="lists"]'); await page.waitForTimeout(150); }
      return t;
    };
    const first = rows[0];
    const pick = '#mvSec .mv-srow[data-sector="' + first.key + '"]';
    await page.click(pick);
    await page.waitForTimeout(150);
    const nIn = M1.plotted.filter((x) => (x.sector || "__none") === first.key).length;
    same(await page.locator("#mvSector").inputValue(), first.key, tag + ": choosing a sector sets the sector filter");
    P((await countNow()) === nIn + " of " + M1.plotted.length + " shown", tag + ": the field shows that sector's " + nIn + " names");
    const after = await secRead(page, "#mvSec");
    P(after[0].pressed === "true" && after.slice(1).every((r) => r.pressed === "false"), tag + ": and only that row says it is pressed");
    same(after.map(secKey), rows.map(secKey), tag + ": the table still lists every sector: the filter does not narrow it");
    await page.click(pick);
    await page.waitForTimeout(150);
    same(await page.locator("#mvSector").inputValue(), "", tag + ": choosing it again clears the filter");
    P((await countNow()) === M1.plotted.length + " of " + M1.plotted.length + " shown", tag + ": and the whole field is back");
    await page.focus('#mvSec .mv-srow[tabindex="0"]');
    await page.keyboard.press("ArrowDown");
    P(await page.evaluate(() => document.activeElement.dataset.sector) === rows[1].key, tag + ": ArrowDown moves to the next sector");
    await page.keyboard.press("End");
    P(await page.evaluate(() => document.activeElement.dataset.sector) === rows[rows.length - 1].key, tag + ": End moves to the last");
    await page.keyboard.press("Home");
    P(await page.evaluate(() => document.activeElement.dataset.sector) === rows[0].key, tag + ": Home moves to the first");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);
    same(await page.locator("#mvSector").inputValue(), rows[0].key, tag + ": Enter chooses the focused sector");
    await page.evaluate(() => document.getElementById("mvClear").click());
    await page.waitForTimeout(100);
    P((await secRead(page, "#mvSec")).every((r) => r.pressed === "false"), tag + ": Clear releases the row");
    await page.click('#mvListSeg [data-lv="names"]');
    await page.waitForTimeout(120);
    P(await page.locator("#mvSecBox").isHidden() && await page.locator("#mvNow").isVisible() && await page.locator("#mvApart").isVisible(), tag + ": Names brings the two lists back");
    if (phone) {
      const small = await page.evaluate(() => Array.from(document.querySelectorAll("#mvListSeg button"), (b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44 ? b.textContent : null; }).filter(Boolean));
      P(small.length === 0, tag + ": the list switch has 44 px targets " + small.join());
    }
    P(errors.length === 0, tag + ": no page error in the sector block " + errors.join(" | "));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await mount(browser, 1440, 820, { js, body: FX.universe(SEC_LIST), now: "2026-10-19T14:05:00Z" });
    await page.evaluate(([r]) => { window.__strips = { status: "ok", fields: ["chg", "iv30p"], rows: r, session: "2026-10-19" }; window.__rtFire(); }, [SEC_STRIPS]);
    await page.waitForTimeout(200);
    await page.click('#mvListSeg [data-lv="sectors"]');
    await page.waitForTimeout(150);
    const rows = await secRead(page, "#mvSec");
    same(rows.map(secKey), [
      ["Tie A", "Tie A", "1 name", "▲ +1.0", "0 · 0%", false],
      ["Tie B", "Tie B", "1 name", "▲ +1.0", "0 · 0%", false],
      ["Line", "Line", "6 names", "▲ +0.2", "2 · 33%", false],
      ["Flat", "Flat", "1 name", "◆ 0.0", "0 · 0%", false],
      ["Ghost", "Ghost", M.WHY_NO_IV, DASH, DASH, true],
      ["Soon", "Soon", M.WHY_ALL_EVENT, DASH, DASH, false],
    ], "hand worked: ties by name, six names whose medians 0 and 0.4 give 0.2 and whose two beyond 2 give 33%, -0.04 as a flat 0.0, no implied volatility and all-reporting as dashes with their reasons, and SPY (a 50 move in Line) left out");
    P(rows[0].title.includes("Tie A") && rows[4].title === M.WHY_NO_IV && rows[5].title === M.WHY_ALL_EVENT, "a dash carries its reason in the title");
    P(rows[4].label === "Ghost, no median. " + M.WHY_NO_IV, "and in the spoken label: " + rows[4].label);
    await page.evaluate(() => document.querySelector('#mvSec .mv-srow[data-sector="Ghost"]').click());
    await page.waitForTimeout(100);
    same(await page.locator("#mvSector").inputValue(), "", "a sector with no measured name cannot be chosen");
    await page.click('#mvSec .mv-srow[data-sector="Soon"]');
    await page.waitForTimeout(100);
    same(await page.locator("#mvSector").inputValue(), "Soon", "a sector whose names all report soon can");
    P(errors.length === 0, "no page error in the controlled sector world " + errors.join(" | "));
    await ctx.close();
  }
  {
    const list = [["SPY", 0.004, 0.16, 90, "Funds", 40 * SEC_T, 0.0065, 14, 3], ...Array.from({ length: 300 }, (_, i) => ["W" + String(i).padStart(3, "0"), i === 0 ? 0.05 : 0.001, 0.3, 60, "Wide", 1e10, 0.01, 10, 1])];
    const dec = FX.decoded(FX.universe(list));
    const all = M.sectorStats(dec.map((r) => ({ t: r.t, chg: r.chg, iv30p: r.iv, ed: r.ed, rd: r.rd, rdMax: r.rdMax, sector: r.sector })));
    P(all.length === 1 && all[0].n === 300 && all[0].beyond === 1, "the wide fixture is one sector of 300 names with exactly one beyond 2");
    const { ctx, page, errors } = await mount(browser, 1440, 820, { js, body: FX.universe(list) });
    await page.click('#mvListSeg [data-lv="sectors"]');
    await page.waitForTimeout(150);
    const rows = await secRead(page, "#mvSec");
    same(rows.map(secKey), all.map(secExpect), "one beyond 2 among 300 names is a third of a percent and prints as under 1%, not 0%");
    P(rows[0].beyond === "1 · <1%", "spelled out: " + rows[0].beyond);
    P(errors.length === 0, "no page error in the wide sector world " + errors.join(" | "));
    await ctx.close();
  }
  for (const [w, h, extra] of [VIEWPORTS[1], VIEWPORTS[2]]) {
    const phone = w < 900;
    const tag = "30 sectors at " + w + "x" + h;
    const dec = FX.decoded(FX.universe(SEC_BIG));
    const all = M.sectorStats(dec.map((r) => ({ t: r.t, chg: r.chg, iv30p: r.iv, ed: r.ed, rd: r.rd, rdMax: r.rdMax, sector: r.sector })));
    P(all.length === 30, tag + ": the fixture has 30 sectors and the Funds sector holding only SPY is not one of them");
    const { ctx, page, errors } = await mount(browser, w, h, { context: extra, js, body: FX.universe(SEC_BIG) });
    if (phone) { await page.click('#mvSeg5 [data-v="lists"]'); await page.waitForTimeout(150); }
    await page.click('#mvListSeg [data-lv="sectors"]');
    await page.waitForTimeout(150);
    const rows = await secRead(page, "#mvSec");
    const rh = rows[0].h;
    const boxH = await page.evaluate(() => document.getElementById("mvSec").clientHeight);
    const shown = Math.max(1, Math.min(30, Math.floor(boxH / rh)));
    P(rows.length === shown && shown < 30, tag + ": " + shown + " rows fit and 30 do not (" + rows.length + ")");
    same(rows.map(secKey), all.slice(0, shown).map(secExpect), tag + ": the rows are the largest medians first");
    P(!(await page.locator("#mvSecMore").isHidden()) && (await page.locator("#mvSecNote").innerText()) === shown + " of 30", tag + ": Show all is offered and the note says " + shown + " of 30");
    await page.click("#mvSecMore");
    await page.waitForTimeout(150);
    const k = Math.min(30, Math.max(1, Math.floor((h - 24 - 230) / rh)));
    const dr = await secRead(page, "#mvSecG");
    same(dr.map(secKey), all.slice(0, k).map(secExpect), tag + ": the dialog lists the " + k + " that fit its height");
    P((await page.locator("#mvSecT").innerText()) === "Largest " + k + " of 30 sectors", tag + ": and says it left some out");
    const fd = await fit(page);
    P(fd.v && fd.h && fd.dlg, tag + ": the dialog stays inside the viewport and scrolls nothing (" + JSON.stringify(fd) + ")");
    P(errors.length === 0, tag + ": no page error " + errors.join(" | "));
    await ctx.close();
  }
}

const VIEWPORTS = [[1440, 820, {}], [1024, 768, {}], [390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]];

class Stop extends Error {}
async function exercise(browser, js, early, only) {
  const problems = [];
  const P = (c, m) => { if (c) { checks++; return; } problems.push(m); if (early) throw new Stop(m); };
  const same = (a, b, m) => P(JSON.stringify(a) === JSON.stringify(b), m + " " + (JSON.stringify(a) === JSON.stringify(b) ? "" : JSON.stringify(a) + " != " + JSON.stringify(b)));
  const M0 = model(DEC);
  const ranked = M0.all.filter((x) => !x.event).sort(byA);
  const apart = M0.all.filter((x) => x.event).sort(byA);
  try {
    if (only === "sectors") { await sectorsBlock(browser, js, P, same); return problems; }
    if (only === "parts") { await partsBlock(browser, js, P, same); return problems; }
    for (const [w, h, extra] of VIEWPORTS) {
      const phone = w < 900;
      const { ctx, page, errors, asked } = await mount(browser, w, h, { context: extra, js });
      P(await page.evaluate(() => matchMedia("(pointer:coarse)").matches) === phone, w + ": the phone context is a coarse pointer and the others are not");
      const check = async (label) => {
        const f = await fit(page);
        P(f.v && f.h, w + "x" + h + " " + label + ": the page does not scroll (" + f.sh + " of " + f.ih + ", " + f.sw + " of " + f.iw + ")");
        P(f.dlg, w + "x" + h + " " + label + ": an open dialog sits inside the viewport and scrolls nothing");
        const cl = await clipped(page);
        P(cl.length === 0, w + "x" + h + " " + label + ": nothing clipped or past its panel " + cl.slice(0, 3).join(" | "));
      };
      const views = phone ? ["field", "lists", "detail"] : ["field"];
      for (const v of views) {
        if (phone) { await page.click('#mvSeg5 [data-v="' + v + '"]'); await page.waitForTimeout(150); }
        await check(v);
        if (v === "field") {
          const filters = [["up", async () => page.click('#mvDir [data-dir="up"]')], ["down", async () => page.click('#mvDir [data-dir="down"]')], ["earn", async () => { await page.click('#mvDir [data-dir="down"]'); await page.click("#mvEarn"); }], ["sector", async () => { await page.click("#mvEarn"); await page.selectOption("#mvSector", "Technology"); }]];
          for (const [name, act] of filters) { await act(); await page.waitForTimeout(80); await check("filter " + name); }
          await page.click("#mvClear");
          await page.waitForTimeout(80);
          await check("cleared");
        }
        if (v === "lists") {
          await page.click("#mvMore");
          await page.waitForTimeout(100);
          await check("show more dialog");
          await page.keyboard.press("Escape");
        }
        if (v === "field" || phone && v === "field") {
          await page.click("#mvInfoBtn");
          await page.waitForTimeout(100);
          await check("info dialog");
          await page.keyboard.press("Escape");
        }
        if (!phone && v === "field") {
          await page.click("#mvMore");
          await page.waitForTimeout(100);
          await check("show more dialog");
          await page.keyboard.press("Escape");
        }
      }
      if (phone) {
        const bad = await page.evaluate(() => Array.from(document.querySelectorAll(".mv-seg5 button, .mv-panel button, .mv-panel select, .mv-open, .mv-ibtn, .mv-row"), (b) => { const r = b.getBoundingClientRect(); return r.width && r.height && Math.min(r.width, r.height) < 43.5 && getComputedStyle(b).display !== "none" ? b.className + ":" + b.textContent.slice(0, 12) + ":" + Math.round(r.height) : null; }).filter(Boolean));
        P(bad.length === 0, "coarse pointer: every control in view is 44 px " + bad.join(" | "));
      }
      P(errors.length === 0, w + ": no page error " + errors.join(" | "));
      P(asked.every((a) => /^\/api\/flows\/(universe\?cols=t,sec,chg,iv30p,sig,f2,f3,ed,rd,mcap|card\?t=[A-Z0-9]+)$/.test(a)), w + ": no request beyond the universe projection and cards " + asked.join(","));
      P(asked.filter((a) => a.startsWith("/api/flows/universe")).length === 1, w + ": one universe read");
      await ctx.close();
    }

    {
      const { ctx, page, asked, cardHits } = await mount(browser, 1440, 820, { js, now: "2026-10-19T14:05:00Z" });
      const d = await dots(page);
      const compact = d.plotW < 560;
      P(d.l === (compact ? 34 : 44) && d.t === 10 && Math.abs(d.w - (d.plotW - d.l - 12)) < 1e-6 && Math.abs(d.h - (d.plotH - 10 - (compact ? 30 : 34))) < 1e-6, "the plot box is the host minus the margins");
      P(d.xmax === M0.xmax && d.ymax === M0.ymax, "the axes' extent is the 99.5th percentile rule: " + d.xmax + "," + d.ymax + " vs " + M0.xmax + "," + M0.ymax);
      const px = (z) => d.l + ((Math.max(-d.xmax, Math.min(d.xmax, z)) + d.xmax) / (2 * d.xmax)) * d.w;
      const py = (a) => d.t + (1 - Math.max(0, Math.min(d.ymax, a)) / d.ymax) * d.h;
      const rMax = compact ? 10 : 14;
      const plottedNames = new Set(M0.plotted.map((x) => x.t));
      same([...new Set(d.pts.map((p) => p.t))].sort(), [...plottedNames].sort(), "every name with a typical day and an implied day is drawn once, and no other");
      P(!d.pts.some((p) => ["NOIV", "NOSIG"].includes(p.t)), "a name with no implied volatility or no typical day is not drawn");
      let bad = 0, badR = 0, badShape = 0, badMid = 0, badRing = 0, area = 0;
      for (const x of M0.plotted) {
        const p = d.pts.find((q) => q.t === x.t);
        if (!p) { bad++; continue; }
        if (Math.abs(p.x - px(x.z)) > 0.01 || Math.abs(p.y - py(x.a)) > 0.01) bad++;
        const pin = PIN.includes(x.t);
        const dir = x.m > 0 ? "up" : x.m < 0 ? "dn" : "fl";
        if (!p.cls.split(" ").includes(dir)) badShape++;
        if (pin) { if (p.bw < 8.9 || p.bw > 9.6 || Math.abs(p.cx - p.x) > 0.6) badMid++; continue; }
        const r = x.cap > 0 && M0.capMax > 0 ? Math.max(2.5, rMax * Math.sqrt(x.cap / M0.capMax)) : 2.5;
        if (Math.abs(p.r - r) > 0.001) badR++;
        if (Math.abs(p.cx - p.x) > 0.6) badMid++;
        const n = (p.d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
        if (dir !== "fl") {
          const a = Math.abs(n[0] * (n[3] - n[5]) + n[2] * (n[5] - n[1]) + n[4] * (n[1] - n[3])) / 2;
          if (Math.abs(a - Math.PI * r * r) > 0.01 * Math.PI * r * r + 1e-6) area++;
          if (dir === "up" ? !(n[1] < 0) : !(n[1] > 0)) badShape++;
        }
        const ring = d.rings.find((q) => q.t === x.t);
        if (x.event ? !ring || ring.r <= p.r : !!ring) badRing++;
      }
      P(bad === 0, "every dot sits at the independent position of its typical days and implied multiple (" + bad + " off)");
      P(badR === 0, "dot radius is the square root of market cap over the largest, floored at 2.5 px (" + badR + " off)");
      P(area === 0, "every triangle has the area of its circle (" + area + " off)");
      P(badShape === 0, "direction is the class and the shape of the marker (" + badShape + " off)");
      P(badMid === 0, "markers are centred on their data position (" + badMid + " off)");
      P(badRing === 0, "a ring surrounds exactly the names reporting within 21 sessions (" + badRing + " off)");
      const edge = d.pts.find((p) => p.t === "EDGE");
      P(Math.abs(edge.x - (d.l + d.w)) < 0.01 && Math.abs(edge.y - d.t) < 0.01, "a name beyond the axis is drawn at the edge, not off the plot");
      const pins = d.pts.filter((p) => p.cls.includes("pin"));
      same(pins.map((p) => p.t).sort(), [...PIN].sort(), "SPY and QQQ are pinned as squares");
      P(d.pts.every((p) => (p.tab !== null) === (p.role === "button") && (p.tab === null) === (p.hidden === "true")), "a dot is either a button or hidden from the tree");
      P(d.pts.filter((p) => p.tab !== null).length <= 62 + 2, "at most sixty dots and the pins take the tab order");
      same(d.refs.sort(), [...[-3, -2, 2, 3].filter((v) => Math.abs(v) < d.xmax).map((v) => "x" + v), "y1"].sort(), "the reference marks are straight lines at 2 and 3 typical days and 1x implied");
      P(d.shapes === 0, "no boundary curve is drawn");
      const stamp = await page.locator("#mvStamp").innerText();
      P(/Oct 16/.test(stamp) && /read Oct 17 00:31 TRT/.test(stamp), "the stamp prints the read in TRT: " + stamp);
      P(new RegExp(M0.plotted.length + " of " + DEC.length + " names with a typical day").test(stamp), "and the number of names measured");
      P(!/UTC|GMT/.test(await page.locator("body").innerText()), "no other zone is named");
      P((await page.locator("#mvCount").innerText()) === M0.plotted.length + " of " + M0.plotted.length + " shown", "the count reads every drawn name");
      const fn = await page.locator("#mvFnote").innerText();
      P(fn.includes(M.X_LINE) && fn.includes(M.Y_LINE) && fn.includes(M.SIZE_LINE) && fn.includes(M.REF_LINE), "the foot carries the four reading sentences");
      const noSig = M0.all.length - M0.plotted.length;
      P(fn.includes(noSig + (noSig === 1 ? " name has" : " names have") + " no typical day"), "and counts the names it cannot draw");
      const clippedN = M0.plotted.filter((x) => Math.abs(x.z) > d.xmax || x.a > d.ymax).length;
      P(clippedN > 0 && fn.includes(clippedN + (clippedN === 1 ? " name is" : " names are") + " beyond the axis"), "and the names beyond the axis");
      P(d.labels.some((l) => l.t === "SPY" && l.text === "SPY " + (M0.plotted.find((x) => x.t === "SPY").m > 0 ? "▲" : "▼") + " " + pctT(M0.plotted.find((x) => x.t === "SPY").chg)), "a pin carries its label with the day's change");
      P(d.labels.filter((l) => l.sel).length === 1, "the selected name is labelled");

      const now = await listRows(page, "mvNow");
      const nBox = await page.evaluate(() => document.getElementById("mvNow").clientHeight);
      same(now.map((r) => r.t), ranked.slice(0, now.length).map((x) => x.t), "Large now lists the names outside the earnings window by IV-days, largest first");
      P(now.length === Math.min(ranked.length, Math.max(1, Math.floor(nBox / 36))), "and shows as many rows as fit");
      for (const r of now) {
        const x = ranked.find((y) => y.t === r.t);
        P(r.m === sgn1(x.m) && r.chg === pctT(x.chg), r.t + " prints its IV-days and its day's change");
        const full = rarityFull(x);
        P(r.how === chipOf(full), r.t + " chip is the rarityText phrase: " + r.how + " vs " + chipOf(full));
        P(r.title === (full === null ? ("" + r.title) : full), r.t + " title is exactly rarityText");
        P(full === null || r.label.includes(full), r.t + " spoken label carries the sentence");
      }
      const ap = await listRows(page, "mvApart");
      same(ap.map((r) => r.t), apart.slice(0, 3).map((x) => x.t), "names reporting within 21 sessions are ranked apart, three of them");
      const chipFor = (x) => (x.rd === 0 ? "Reaction day" : x.ed === 0 || x.rdMax === 1 || x.rdMax === 2 ? "Time unstated" : x.rd === 1 ? "Day after" : "");
      const chips = new Map(apart.map((x) => [x.t, chipFor(x)]));
      P(ap.every((r) => r.how === chips.get(r.t)), "an earnings name carries no rarity chip, a name that has reacted says so in its place, and one whose report time is not stated says that");
      P(ap.some((r) => r.t === "SAMEDAY" && r.how === "Time unstated"), "a report dated on the nightly's own session with no stated time is in the list with that chip, not as a reaction");
      P((await page.locator("#mvNowNote").innerText()) === now.length + " of " + ranked.length && (await page.locator("#mvApartNote").innerText()) === "3 of " + apart.length, "both notes count");
      P(!(await page.locator("#mvMore").isHidden()), "Show more is offered when the list is longer than the room");

      const big = await page.evaluate(() => { const r = document.querySelector('#mvNow .mv-row[data-t="BIGUP"], #mvApart .mv-row[data-t="BIGUP"]'); return r ? r.querySelector('[data-k="chg"]').textContent : null; });
      P(big === null || big === "+9.4%", "a stored 940 on the 1e4 scale prints as +9.4%, not +940%: " + big);
      const sel = ranked[0];
      let rk = await railKv(page);
      same(rk.big, sel.t, "the first name is selected at load");
      P(rk.open === "/flows/ticker/?t=" + sel.t, "Open ticker links to the ticker page");
      same(rk.kv["Typical day"], sel.sig === null ? DASH : typPct(sel.sig), "typical day");
      same(rk.kv["In typical days"], sgn1(sel.z), "typical days moved");
      same(rk.kv["Implied day"], typPct(sel.iv / SQRT252), "implied day is 30-day IV over the square root of 252");
      same(rk.kv["Times implied"], sel.a.toFixed(1) + "×", "times implied");
      same(rk.kv["IV-days"], sgn1(sel.m), "IV-days");
      const full = rarityFull(sel);
      P(rk.say === (full ? full[0].toUpperCase() + full.slice(1) + "." : rk.say), "the drill sentence is rarityText");
      same(rk.kv["Past 2 typical"], sel.f2 + " of 252", "the beyond-2 count");
      same(rk.kv["Past 3 typical"], sel.f3 + " of 252", "the beyond-3 count");
      P(rk.spark === 21, "the 21-session sparkline holds the card's last 21 closes (" + rk.spark + ")");
      P(rk.kv.Conviction === "64 /100" && rk.kv["IV percentile"] === "42" && !("IV rank" in rk.kv) && rk.kv["Dealer γ book"] === "Long" && rk.kv["Latest flow"] === "+$12.5M", "card context is read, with units");
      const wantSig = SIG.sigRun(DEC).items.find((i) => i.t === sel.t);
      const wantLine = wantSig.state === "tested" ? (wantSig.flag ? SIG.SIG_FLAGGED_LINE : SIG.SIG_PLAIN_LINE) : SIG.SIG_REASONS[wantSig.state];
      P(rk.text.includes(wantLine) && !rk.text.includes("not yet published"), "the drill panel carries the significance result or the reason for none: " + wantLine);
      P(cardHits[sel.t] === 1, "the card is asked for once");
      P(asked.indexOf("/api/flows/card?t=" + sel.t) > asked.findIndex((a) => a.startsWith("/api/flows/universe")), "after the universe, never before first paint");

      await page.click('#mvNow .mv-row[data-t="' + now[1].t + '"]');
      await page.waitForTimeout(450);
      rk = await railKv(page);
      same(rk.big, now[1].t, "a click on a row selects it");
      const nx = ranked.find((y) => y.t === now[1].t);
      same(rk.kv["Times implied"], nx.a.toFixed(1) + "×", "and the rail follows");
      P((await listRows(page, "mvNow"))[1].cur === "true", "the row says it is current");
      const dd = await dots(page);
      P(dd.pts.filter((p) => p.sel).map((p) => p.t).join() === now[1].t && dd.labels.some((l) => l.sel && l.t === now[1].t), "and so does the dot, with its label");
      const evRow = apart.find((x) => chipFor(x) === "");
      await page.click('#mvApart .mv-row[data-t="' + evRow.t + '"]');
      await page.waitForTimeout(450);
      rk = await railKv(page);
      P(/Earnings in \d+ sessions?/.test(rk.text) && rk.text.includes(M.APART), "an earnings name says so in the rail: event not separated");
      const unRow = apart.find((x) => chipFor(x) === "Time unstated");
      await page.click('#mvApart .mv-row[data-t="' + unRow.t + '"]');
      await page.waitForTimeout(450);
      rk = await railKv(page);
      P(rk.text.includes("Report time not stated") && rk.text.includes("Report time not stated: event not separated.") && !/Reaction session/.test(rk.text), "a report whose time is not stated says that in the rail, not that it reacted: " + rk.text.slice(0, 160));

      const countBefore = await page.locator(".pt:not(.off)").count();
      await page.click('#mvDir [data-dir="up"]');
      await page.waitForTimeout(100);
      const upN = M0.plotted.filter((x) => x.m > 0).length;
      P((await page.locator("#mvCount").innerText()) === upN + " of " + M0.plotted.length + " shown", "Up filters the field to risers");
      const upRows = await listRows(page, "mvNow");
      same(upRows.map((r) => r.t), ranked.filter((x) => x.m > 0).slice(0, upRows.length).map((x) => x.t), "and Large now to risers");
      const offDots = await page.evaluate(() => Array.from(document.querySelectorAll(".pt.off"), (e) => e.dataset.t));
      same(offDots.sort(), M0.plotted.filter((x) => !(x.m > 0) && !PIN.includes(x.t)).map((x) => x.t).sort(), "the others fade and take no part");
      P((await page.locator('#mvDir [data-dir="up"]').getAttribute("aria-pressed")) === "true", "the toggle says it is pressed");
      await page.click('#mvDir [data-dir="down"]');
      await page.waitForTimeout(100);
      same((await listRows(page, "mvNow")).map((r) => r.t), ranked.filter((x) => x.m < 0).slice(0, upRows.length).map((x) => x.t), "Down shows fallers");
      P((await page.locator("#mvClear").isVisible()), "Clear appears with a filter");
      await page.click("#mvEarn");
      await page.waitForTimeout(100);
      P((await page.locator("#mvNow").innerText()).includes("ranked below"), "Earnings week leaves the main list pointing at the ranked-apart one");
      same((await listRows(page, "mvApart")).map((r) => r.t), apart.filter((x) => x.m < 0).slice(0, 3).map((x) => x.t), "and keeps the direction filter in the ranked-apart list");
      await page.click("#mvClear");
      await page.selectOption("#mvSector", "Financials");
      await page.waitForTimeout(100);
      same((await listRows(page, "mvNow")).map((r) => r.t), ranked.filter((x) => x.sector === "Financials").slice(0, upRows.length).map((x) => x.t), "a sector filters the list");
      await page.click("#mvClear");
      await page.waitForTimeout(100);
      P((await page.locator(".pt:not(.off)").count()) === countBefore, "Clear restores the field");

      await page.click('#mvDir [data-dir="down"]');
      await page.waitForTimeout(80);
      const kept = await dots(page);
      same(kept.pts.filter((p) => p.cls.includes("pin")).map((p) => p.t).sort(), [...PIN].sort(), "the pins stay when a filter hides everything they are not");
      await page.click("#mvClear");

      const first = await page.locator('.hit[tabindex="0"]').first();
      await first.focus();
      const before = await page.evaluate(() => document.activeElement.dataset.t);
      const xb = (await dots(page)).pts.find((p) => p.t === before);
      await page.keyboard.press("ArrowLeft");
      const after = await page.evaluate(() => ({ t: document.activeElement.dataset.t, sel: document.querySelector(".pt[data-sel]") && document.querySelector(".pt[data-sel]").dataset.t }));
      const xa = (await dots(page)).pts.find((p) => p.t === after.t);
      P(after.t !== before && xa.x < xb.x && after.sel === after.t, "ArrowLeft moves to a dot on the left and selects it");
      await page.keyboard.press("ArrowRight");
      const back = await page.evaluate(() => document.activeElement.dataset.t);
      const xc = (await dots(page)).pts.find((p) => p.t === back);
      P(xc.x > xa.x, "ArrowRight moves back to the right");
      await Promise.all([page.waitForURL("**/flows/ticker/?t=*"), page.keyboard.press("Enter")]);
      P(new URL(page.url()).searchParams.get("t") === back, "Enter opens the ticker page of the focused dot");
      await ctx.close();
    }

    {
      const { ctx, page, cardHits } = await mount(browser, 1440, 820, { js });
      await page.focus('#mvNow .mv-row[tabindex="0"]');
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(700);
      P(Object.keys(cardHits).length <= 2, "four quick moves down the list ask for one more card, not four: " + Object.keys(cardHits).join());
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      const f = await page.evaluate(() => ({ t: document.activeElement.dataset.t, cur: document.querySelector('#mvNow .mv-row[aria-current="true"]').dataset.t }));
      P(f.t === f.cur && f.t === ranked[1].t, "ArrowDown moves down the list and selects");
      await page.keyboard.press("End");
      const e = await page.evaluate(() => document.activeElement.closest("#mvApart") !== null || document.activeElement.closest("#mvNow") !== null);
      P(e, "End stays in the lists");
      await page.keyboard.press("Home");
      P((await page.evaluate(() => document.activeElement.dataset.t)) === ranked[0].t, "Home returns to the first row");
      await page.click("#mvMore");
      const n = await page.locator("#mvMoreG button").count();
      const T = await page.locator("#mvMoreT").innerText();
      P(T === "Largest " + n + " of " + ranked.length + ", in IV-days" && n > 6, "Show more lists the largest that fit: " + T);
      same(await page.evaluate(() => Array.from(document.querySelectorAll("#mvMoreG b"), (b) => b.textContent)), ranked.slice(0, n).map((x) => x.t), "in IV-days order");
      await page.keyboard.press("ArrowRight");
      P(await page.evaluate(() => document.activeElement.closest("#mvMoreG") !== null), "arrows move inside the dialog grid");
      await page.click('#mvMoreG button:nth-child(3)');
      await page.waitForTimeout(300);
      P((await railKv(page)).big === ranked[2].t, "choosing a name in the dialog selects it");
      await page.click("#mvInfoBtn");
      const info = await page.locator("#mvInfoB").innerText();
      P(/Not built yet: flow clusters and replay\./.test(info) && !/parts of the move, flow clusters/.test(info) && !/a significance test/.test(info), "the info dialog says what is not built, and no longer lists the parts of the move");
      P(M.PARTS_SENTENCES.every((s) => info.includes(s)), "and explains the parts of the move in the leaf's own sentences");
      for (const w of SIG.SIG_INFO_SENTENCES) P(info.includes(w), "the info dialog states the test's limit: " + w);
      P(info.includes(M.REF_LINE) && !FORBID.test(info) && !NOT_BUILT.test(info), "and holds no forbidden word");
      for (const s of info.split(/(?<=\.)\s+/)) P(M.wordCount(s) <= 14, "an info sentence stays short: " + s.slice(0, 50));
      await page.keyboard.press("Escape");
      P(await page.evaluate(() => !document.querySelector("dialog[open]")), "Escape closes it");
      await ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 1440, 820, { js, context: { reducedMotion: "reduce" } });
      P(await page.evaluate(() => document.getAnimations().length) === 0, "reduced motion: nothing animates");
      P(await page.evaluate(() => getComputedStyle(document.querySelector(".mv-row")).transitionDuration) === "0s", "reduced motion: no transition");
      const text = await page.locator("#flowsMain").innerText();
      P(!FORBID.test(text) && !NOT_BUILT.test(text), "no forbidden word in the rendered text");
      P(!/(^|[\s(])-\d/.test(text) && !text.includes("NaN") && !text.includes("undefined") && !/\bnull\b/.test(text), "no hyphen minus, NaN, undefined or null in the rendered text");
      await ctx.close();
    }

    {
      const { ctx, page, asked } = await mount(browser, 1440, 820, { js, cardFail: "*" });
      P((await page.locator("#mvRail").innerText()).includes("could not be read (HTTP 500)"), "a card that fails says so and says the move is unaffected");
      await page.click("#mvRetry");
      await page.waitForTimeout(300);
      const rk = await railKv(page);
      P(rk.spark === 21 && rk.kv.Conviction === "64 /100", "Retry reads the card");
      P(asked.filter((a) => a.startsWith("/api/flows/card")).length === 2, "the card was asked for twice");
      await page.click('#mvNow .mv-row:nth-child(2)');
      await page.waitForTimeout(400);
      await ctx.close();
    }

    {
      const odd = FX.names(30);
      odd.push(["NOCARD", 0.6, 0.3, 60, "Energy", 1e11, 0.02, 9, 1]);
      const { ctx, page } = await mount(browser, 1440, 820, { js, body: FX.universe(odd) });
      P((await railKv(page)).big === "NOCARD", "the largest move is selected at load");
      P((await page.locator("#mvRail").innerText()).includes("NOCARD has no Flows card"), "a name with no card says so and shows no invented context");
      await ctx.close();
    }

    {
      const list = [];
      for (let i = 0; i < 40; i++) list.push(["Q" + String(i).padStart(2, "0"), 0.001, 0.3, 60, "Utilities", 1e10, 0.01, 5, 1]);
      for (let i = 0; i < 6; i++) list.push(["FLAG" + i, 0.035 + i * 0.001, 0.3, 60, "Technology", 2e10, 0.01, 0, 0]);
      list.push(["NEAR", 0.06, 0.3, 60, "Technology", 1e10, 0.01, 9, 4]);
      list.push(["EVT", 0.05, 0.3, 5, "Technology", 1e10, 0.01, 0, 0]);
      list.push(["NOSC", 0.05, 0.3, 60, "Technology", 1e10, null, null, null]);
      const dec = FX.decoded(FX.universe(list));
      const want = SIG.sigRun(dec);
      const refRej = (() => { const ps = want.items.map((i) => i.p); const live = ps.map((p, i) => [p, i]).filter(([p]) => p !== null).sort((a, b) => a[0] - b[0]); let cut = 0; live.forEach(([p], k) => { if (p <= ((k + 1) * 0.1) / live.length) cut = k + 1; }); return new Set(live.slice(0, cut).map(([, i]) => i)); })();
      P(want.items.filter((i) => i.state === "tested" && refRej.has(want.items.indexOf(i))).length === 6 && want.flagged === 6 && want.m === 47, "the scenario has six flagged among 47 counted names");
      const { ctx, page } = await mount(browser, 1440, 820, { js, body: FX.universe(list) });
      const fn = await page.locator("#mvFnote").innerText();
      P(fn.includes("6 of 7 tested names are beyond the usual after correction."), "the foot counts the flagged names: " + fn.slice(-90));
      const pick = async (t) => {
        const hit = await page.evaluate((x) => { const r = document.querySelector('.mv-row[data-t="' + x + '"]'); if (r) { r.click(); return null; } const e = document.querySelector('.pt[data-t="' + x + '"]'); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, t);
        if (hit) await page.mouse.click(hit[0], hit[1]);
        await page.waitForTimeout(120);
        return railKv(page);
      };
      let rk = await pick("FLAG5");
      P(rk.text.includes(SIG.SIG_FLAGGED_LINE), "a flagged name says it is beyond the usual");
      const w2 = want.items.find((i) => i.t === "FLAG5");
      same([rk.kv["p, own rate"], rk.kv["p, adjusted"]], [w2.p.toFixed(3), w2.adj.toFixed(3)], "its p and adjusted p");
      rk = await pick("NEAR");
      P(rk.text.includes(SIG.SIG_PLAIN_LINE) && !rk.text.includes(SIG.SIG_FLAGGED_LINE), "a tested name that does not pass says so");
      const wn = want.items.find((i) => i.t === "NEAR");
      same(rk.kv["p, adjusted"], wn.adj.toFixed(3), "its adjusted p is over the cut");
      rk = await pick("EVT");
      P(rk.text.includes(SIG.SIG_REASONS.event) && rk.kv["p, own rate"] === undefined, "an earnings name is refused with its reason");
      rk = await pick("Q00");
      P(rk.text.includes(SIG.SIG_REASONS.below) && rk.kv["p, adjusted"] === undefined, "a small move is not tested and says why");
      rk = await pick("NOSC");
      P(rk.big === "NOSC" && rk.text.includes(SIG.SIG_REASONS.noscale), "a name with no scale gets a reason, never a zero");
      await ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 1440, 820, { js, body: { status: "pending" } });
      const note = await page.locator("#mvNote").innerText();
      P(/not published yet/.test(note) && await page.locator("#mvStage").isHidden(), "a pending universe says so and draws nothing");
      await ctx.close();
      const m2 = await mount(browser, 1440, 820, { js, status: 500 });
      P(/could not be loaded/.test(await m2.page.locator("#mvNote").innerText()) && await m2.page.locator("#mvStage").isHidden(), "a failed read says so and draws nothing");
      await m2.ctx.close();
      const nocap = await mount(browser, 1440, 820, { js, body: FX.universe(LIST, { noCap: true }) });
      const dn = await dots(nocap.page);
      P(dn.pts.filter((p) => !p.cls.includes("pin")).every((p) => p.r === 2.5), "with no market cap column every dot is the smallest size");
      P((await nocap.page.locator("#mvFnote").innerText()).includes("No market cap is published"), "and the foot says so");
      await nocap.ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 1440, 820, { js, now: "2026-10-19T14:05:00Z" });
      const strips = (rows, session) => page.evaluate(([r, s]) => { window.__strips = { status: "ok", fields: ["chg", "iv30p"], rows: r, session: s }; window.__rtFire(); }, [rows, session]);
      await strips({ LIVE1: [0.08, 0.4], LIVE2: [-0.03, 0.3], BIGUP: [0.01, 0.4] }, "2026-10-19");
      await page.waitForTimeout(150);
      P(/Live roster/.test(await page.locator("#mvStamp").innerText()), "a roster for a newer session replaces the population and says so");
      P((await page.locator("#mvStamp").innerText()).includes("1 of 3 names with a typical day"), "and counts it");
      const live = await listRows(page, "mvNow");
      const val = { LIVE1: 0.08 / (0.4 / SQRT252), LIVE2: 0.03 / (0.3 / SQRT252), BIGUP: 0.01 / (0.4 / SQRT252) };
      same(live.map((r) => r.t), Object.keys(val).sort((x, y) => val[y] - val[x]), "the live roster is ranked by IV-days");
      await page.click("#mvFreeze");
      const st = await page.locator("#mvStamp").innerText();
      P(/Frozen at 17:05 TRT/.test(st) && st.includes(M.FROZEN_LINE), "Freeze prints the time in TRT and says scores are held: " + st);
      P((await page.locator("#mvFreeze").getAttribute("aria-pressed")) === "true" && (await page.locator("#mvFreeze").innerText()) === "Resume", "the button becomes Resume");
      await strips({ LIVE3: [0.2, 0.4], LIVE1: [0.08, 0.4] }, "2026-10-19");
      await page.waitForTimeout(150);
      same((await listRows(page, "mvNow")).map((r) => r.t), live.map((r) => r.t), "while frozen the lists do not move");
      await page.click("#mvFreeze");
      await page.waitForTimeout(150);
      same((await listRows(page, "mvNow")).map((r) => r.t)[0], "LIVE3", "Resume applies the held read");
      P(!/Frozen/.test(await page.locator("#mvStamp").innerText()), "and the frozen line goes");
      await ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 1440, 820, { js, now: "2026-10-19T14:05:00Z" });
      const strips = (rows, session) => page.evaluate(([r, s]) => { window.__strips = { status: "ok", fields: ["chg", "iv30p"], rows: r, session: s }; window.__rtFire(); }, [rows, session]);
      const LIVE = { EDGE22: [0.14, 0.2], REACT0: [0.11, 0.3], REACT1: [-0.07, 0.3], BIGUP: [0.09, 0.4], FWDUN: [0.05, 0.3] };
      await strips(LIVE, "2026-10-19");
      await page.waitForTimeout(150);
      same((await listRows(page, "mvApart")).map((r) => r.t).sort(), ["EDGE22", "FWDUN", "REACT0"], "ONE SESSION AFTER THE NIGHTLY a report 22 sessions out is 21 away and set apart, one that reacted on the nightly's session is the day after, and one due on this session or the next with no stated time is set apart");
      same((await listRows(page, "mvApart")).filter((r) => r.t === "FWDUN").map((r) => r.how), ["Time unstated"], "and the one with no stated time says so and is not called a reaction");
      await page.click('#mvApart .mv-row[data-t="FWDUN"]');
      await page.waitForTimeout(100);
      same(await page.evaluate(() => { const e = document.querySelector("#mvRail .mv-st.ev"); return e ? e.textContent : null; }), "Report time not stated", "its drill panel carries the tag that names the doubt");
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
      await page.mouse.move(700, 4);
      await page.waitForTimeout(100);
      same((await listRows(page, "mvNow")).map((r) => r.t).sort(), ["BIGUP", "REACT1"], "while one that reacted a session before the nightly's has aged out of the window");
      same((await listRows(page, "mvApart")).filter((r) => r.t === "REACT0").map((r) => r.how), ["Day after"], "and the day after says so in the rarity chip's place");
      P(!(await page.locator("#mvFnote").innerText()).includes("more than two sessions old"), "with no warning while the nightly is one session old");
      await strips(LIVE, "2026-10-21");
      await page.waitForTimeout(150);
      same((await listRows(page, "mvApart")).map((r) => r.t), [], "THREE SESSIONS AFTER THE NIGHTLY nothing is set apart, since no earnings state is placed that far on");
      P((await page.locator("#mvFnote").innerText()).includes("Earnings are not separated: the nightly data is more than two sessions old."), "and the foot says so");
      await ctx.close();
    }

    for (const [label, opts, wantHow, why] of [
      ["current", {}, ["Reaction day", "Time unstated"], "a report with a stated time due on the next session is its reaction day while that session trades, and one with no stated time is not called one: the map of unstated reports names only the second, and the horizon it is complete through covers the first"],
      ["older", { noThrough: true }, ["Time unstated", "Time unstated"], "a payload that carries no horizon for its map cannot tell a stated report from one it did not list, so it reads both as unstated rather than call either a reaction"],
    ]) {
      const live = await mount(browser, 1440, 820, { js, now: "2026-10-19T14:05:00Z", body: FX.universe(FX.names(), opts) });
      await live.page.evaluate(() => { window.__strips = { status: "ok", fields: ["chg", "iv30p"], rows: { FWDST: [0.05, 0.3], FWDUN: [0.05, 0.3] }, session: "2026-10-19" }; window.__rtFire(); });
      await live.page.waitForTimeout(150);
      const rows = (await listRows(live.page, "mvApart")).filter((r) => r.t === "FWDST" || r.t === "FWDUN").sort((a, b) => (a.t < b.t ? -1 : 1));
      same(rows.map((r) => r.how), wantHow, `ONE SESSION AFTER THE NIGHTLY, ${label} payload: ${why}`);
      await live.ctx.close();
    }

    {
      const nowhere = await mount(browser, 1440, 820, { js, body: FX.universe(FX.names(), { hz: null }) });
      same((await listRows(nowhere.page, "mvApart")).map((r) => r.t), [], "a payload with no earnings window sets nothing apart");
      P((await nowhere.page.locator("#mvFnote").innerText()).includes("Earnings are not separated: this payload does not state the earnings window."), "and says so in the foot");
      P((await nowhere.page.locator("#mvApartH").innerText()) === "Earnings window not stated", "and the heading of the earnings list does not name a window");
      await nowhere.ctx.close();
    }

    {
      const list = [];
      for (let i = 0; i < 6; i++) list.push(["FLAG" + i, 0.035 + i * 0.001, 0.3, 60, "Technology", 2e10, 0.01, 0, 0]);
      list.push(["EVT", 0.05, 0.3, 5, "Technology", 1e10, 0.01, 0, 0]);
      const bare = await mount(browser, 1440, 820, { js, body: FX.universe(list, { hz: null }) });
      const foot = await bare.page.locator("#mvFnote").innerText();
      P(foot.includes(SIG.SIG_FOOT_NONE) && !/tested names? (is|are) beyond/.test(foot), "WITH NO WINDOW STATED nothing is tested, since an earnings mover would pass as a clear name: " + foot.slice(-120));
      await bare.page.evaluate(() => document.querySelector('.mv-row[data-t="FLAG5"]').click());
      await bare.page.waitForTimeout(120);
      const rail = await bare.page.locator("#mvRail").innerText();
      P(rail.includes("Earnings are not separated, so no test.") && !rail.includes(SIG.SIG_FLAGGED_LINE) && !rail.includes(SIG.SIG_PLAIN_LINE), "a name's rail gives that reason and no p");
      same((await railKv(bare.page)).kv["p, own rate"], undefined, "and prints no p");
      await bare.ctx.close();
    }

    {
      const wide = await mount(browser, 1440, 820, { js, body: FX.universe(FX.names(), { hz: 30 }) });
      P((await wide.page.locator("#mvApartH").innerText()) === "Earnings within 30 sessions", "THE HEADING FOLLOWS THE PAYLOAD'S OWN WINDOW");
      await wide.page.click("#mvInfoBtn");
      P((await wide.page.locator("#mvInfoB").innerText()).includes("within 30 sessions"), "and the information dialog names it");
      await wide.ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 390, 844, { js, context: VIEWPORTS[2][2] });
      P((await page.locator("#mvSeg5").evaluate((e) => getComputedStyle(e).display)) === "grid", "the phone shows the three-way switch");
      await page.focus('#mvSeg5 [aria-selected="true"]');
      await page.keyboard.press("ArrowRight");
      P(await page.evaluate(() => document.getElementById("mvStage").dataset.view) === "lists", "ArrowRight on the switch opens Lists");
      await page.click('#mvNow .mv-row:nth-child(2)');
      await page.waitForTimeout(400);
      P(await page.evaluate(() => document.getElementById("mvStage").dataset.view) === "detail", "choosing a row opens Detail on a phone");
      P((await railKv(page)).big === ranked[1].t, "for that name");
      await page.click('#mvSeg5 [data-v="field"]');
      await page.waitForTimeout(150);
      const dd = await dots(page);
      const target = dd.pts.find((p) => p.t === ranked[3].t);
      const box = await page.locator("#mvPlot").boundingBox();
      await page.touchscreen.tap(box.x + target.x + 5, box.y + target.y + 5);
      await page.waitForTimeout(300);
      P(await page.evaluate(() => document.getElementById("mvStage").dataset.view) === "detail" && (await railKv(page)).big === ranked[3].t, "a tap within 22 px of a dot selects it");
      await ctx.close();
    }
    await partsBlock(browser, js, P, same);
    await sectorsBlock(browser, js, P, same);
  } catch (e) {
    if (!(e instanceof Stop)) problems.push("threw: " + String(e && e.message).split("\n")[0]);
  }
  return problems;
}

const browser = await launch();

{
  const bad = await exercise(browser, undefined, false);
  eq(bad, [], "the page passes the whole exercise: " + bad.slice(0, 3).join(" | "));
}

const rungFailures = (src) => {
  const bad = [];
  const sb = { globalThis: null };
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  const X = sb.__MovesTest;
  const table = [[0.097, 0.032, 2], [-0.095, 0.032, 3], [Math.expm1(2.5 * 0.02), 0.02, 2], [Math.expm1(-2.5 * 0.02), 0.02, 2], [Math.expm1(3.01 * 0.02), 0.02, 3], [Math.expm1(1.99 * 0.02), 0.02, 0]];
  for (const [chg, sig, level] of table) {
    const got = X.rarityParts({ chg, sig, f2: 11, f3: 5 });
    if ((got ? got.level : 0) !== level) bad.push(`chg ${chg} on sig ${sig} is rung ${got ? got.level : 0}, the log return puts it at ${level}`);
    const run = X.sigRun([{ t: "AAA", chg, sig, f2: 11, f3: 5, ed: null, event: false }], 0.1);
    const it = run.items[0];
    if ((it.level === null ? 0 : it.level) !== level) bad.push(`the test puts chg ${chg} on sig ${sig} at rung ${it.level}, not ${level}`);
    const z = Math.log1p(chg) / sig;
    if (!(Math.abs((it.z === null ? NaN : it.z) - z) < 1e-12)) bad.push(`its typical days are ${it.z}, not ${z}`);
  }
  const total = X.sigRun([{ t: "AAA", chg: -1, sig: 0.02, f2: 11, f3: 5, ed: null, event: false }], 0.1).items[0];
  if (total.state !== "nomove" || total.p !== null || total.z !== null) bad.push(`a change of -100% is state ${total.state}, not a move that cannot be tested`);
  return bad;
};
eq(rungFailures(JS), [], "the rung of a move, the test's rung and its typical days are read off the log return, the way the nightly counts are");

const unplacedFailures = (src) => {
  const bad = [];
  const sb = { globalThis: null };
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  const X = sb.__MovesTest;
  const mover = (t, event) => ({ t, chg: 0.09, sig: 0.02, f2: 3, f3: 1, event });
  const run = X.sigRun([mover("U0", null), mover("U1", undefined), mover("OK", false), mover("EV", true)], 0.1);
  const states = run.items.map((i) => i.state).join(",");
  if (states !== "unplaced,unplaced,tested,event") bad.push(`states ${states}`);
  if (run.m !== 1 || run.tested !== 1) bad.push(`the correction counts ${run.m} names, not the one placed`);
  if (run.items[0].p !== null || run.items[0].adj !== null || run.items[0].counted !== false) bad.push("an unplaced name carries a p");
  const sec = X.sectorStats([{ t: "A", chg: 0.5, iv: 0.3, sector: "X", event: null }, { t: "B", chg: 0.5, iv: 0.3, sector: "X" }], null)[0];
  if (sec.n !== 0 || sec.apart !== 0 || sec.median !== null || sec.why !== "Earnings are not separated, so no median.") bad.push(`sector of unplaced names: ${JSON.stringify([sec.n, sec.apart, sec.median, sec.why])}`);
  const mixed = X.sectorStats([{ t: "A", chg: 0.5, iv: 0.3, sector: "X", event: false }, { t: "B", chg: 0.5, iv: 0.3, sector: "X", event: null }], 21)[0];
  if (mixed.n !== 1 || mixed.apart !== 0) bad.push(`a placed name beside an unplaced one: n ${mixed.n}, apart ${mixed.apart}`);
  return bad;
};
eq(unplacedFailures(JS), [], "a name whose earnings state is not placed is neither tested nor counted in a sector median, and the correction counts only placed names");
for (const [why, from, to] of [
  ["an unplaced name tested", 'if (x.event !== true && x.event !== false) return { t: x.t, state: "unplaced"', 'if (false) return { t: x.t, state: "unplaced"'],
  ["an unplaced name counted in the median", "if (r.event === false) b.ms.push(m);", "if (r.event !== true) b.ms.push(m);"],
  ["an unplaced name counted as set apart", "apart: b.measured - n - b.unplaced,", "apart: b.measured - n,"],
  ["an unplaced sector given the all-event sentence", "b.unplaced > 0 ? WHY_UNPLACED : allEvent(hz)", "allEvent(hz)"],
]) {
  ok(JS.split(from).length === 2, `the planted build "${why}" targets one line`);
  ok(unplacedFailures(JS.replace(from, to)).length > 0, `the unplaced battery fails the planted build "${why}"`);
}
for (const [why, from, to] of [
  ["the rung read off the simple change", "const level = Math.abs(lm) >= 3 * x.sig ? 3 : Math.abs(lm) >= 2 * x.sig ? 2 : 0;", "const level = Math.abs(x.chg) >= 3 * x.sig ? 3 : Math.abs(x.chg) >= 2 * x.sig ? 2 : 0;"],
  ["the test's rung read off the simple change", "const level = Math.abs(lm) >= 3 * sig ? 3 : 2;", "const level = Math.abs(chg) >= 3 * sig ? 3 : 2;"],
  ["the test's typical days from the simple change", "const z = lm / sig;", "const z = chg / sig;"],
  ["a total loss said to have no typical day", 'state: "nomove", z: null', 'state: "noscale", z: null'],
]) {
  ok(JS.split(from).length === 2, `the planted build "${why}" targets one line`);
  ok(rungFailures(JS.replace(from, to)).length > 0, `the rung table fails the planted build "${why}"`);
}

const MUTANTS = [
  ["IV-days without the square root of 252", "(num(chg) === null || num(iv) === null || !(iv > 0) ? null : chg / (iv / SQRT_YEAR))", "(num(chg) === null || num(iv) === null || !(iv > 0) ? null : chg / iv)"],
  ["typical days lose their sign", "z: sig !== null && sig > 0 && logMove(r.chg) !== null ? logMove(r.chg) / sig : null", "z: sig !== null && sig > 0 && logMove(r.chg) !== null ? Math.abs(logMove(r.chg)) / sig : null"],
  ["a name with no typical day drawn at zero", "z: sig !== null && sig > 0 && logMove(r.chg) !== null ? logMove(r.chg) / sig : null", "z: sig !== null && sig > 0 && logMove(r.chg) !== null ? logMove(r.chg) / sig : 0"],
  ["dot area linear in market cap", "rMax * Math.sqrt(cap / capMax)", "rMax * (cap / capMax)"],
  ["the earnings window is one session short", ": F.earn(r, hz, j);", ": F.earn(r, hz - 1, j);"],
  ["the report-session column ignored", "rd: rd ? rd[i] : null, rdMax: num(un[t])", "rd: null, rdMax: num(un[t])"],
  ["the unstated-time ages ignored", "rdMax: num(un[t]), edMax: F.later(eu, u.edUnstatedThrough, t, ed ? ed[i] : null), sector: sector(i)", "rdMax: null, edMax: F.later(eu, u.edUnstatedThrough, t, ed ? ed[i] : null), sector: sector(i)"],
  ["the forward unstated-time ages ignored", "edMax: F.later(eu, u.edUnstatedThrough, t, ed ? ed[i] : null), sector: sector(i)", "edMax: null, sector: sector(i)"],
  ["the forward unstated-time map read straight", "edMax: F.later(eu, u.edUnstatedThrough, t, ed ? ed[i] : null), sector: sector(i)", "edMax: num(eu[t]), sector: sector(i)"],
  ["the horizon the map is complete through ignored", "F.later(eu, u.edUnstatedThrough, t, ed ? ed[i] : null)", "F.later(eu, undefined, t, ed ? ed[i] : null)"],
  ["every name outside the map read as stated", "F.later(eu, u.edUnstatedThrough, t, ed ? ed[i] : null)", "F.later(eu, 99, t, ed ? ed[i] : null)"],
  ["the live rows lose the forward unstated-time ages", "edMax: pick(t, \"edMax\"), sector: pick(t, \"sector\")", "edMax: null, sector: pick(t, \"sector\")"],
  ["a live session placed as the nightly's own", "const j = S.hz === null ? null : F.elapsed(S.day, S.ahead, s.session);", "const j = S.hz === null ? null : 0;"],
  ["the window taken from nowhere", "S.hz = got.hz;", "S.hz = 21;"],
  ["earnings names ranked with the rest", "now: ok.filter((x) => !x.event).sort(byA)", "now: ok.sort(byA)"],
  ["the 1-in-250 floor removed", "SESSIONS / hits > FLOOR_N", "SESSIONS / hits > FLOOR_N * 4"],
  ["the two and three typical day counts swapped", "const hits = level === 3 ? x.f3 : level === 2 ? x.f2 : null;", "const hits = level === 3 ? x.f2 : level === 2 ? x.f3 : null;"],
  ["a hyphen for a minus", "const signed = (m) => (m < 0 ? MINUS :", "const signed = (m) => (m < 0 ? \"-\" :"],
  ["up and down swapped", "const dirOf = (m) => (m > 0 ? \"up\" : m < 0 ? \"dn\" : \"fl\");", "const dirOf = (m) => (m > 0 ? \"dn\" : m < 0 ? \"up\" : \"fl\");"],
  ["Up filter shows fallers", "!(S.dir === \"up\" && !(x.m > 0))", "!(S.dir === \"up\" && !(x.m < 0))"],
  ["Freeze does not hold the order", "function holding() { return S.frozen || S.listHeld; }", "function holding() { return S.listHeld; }"],
  ["the pins dropped", "const PINS = [\"SPY\", \"QQQ\"];", "const PINS = [\"SPYX\"];"],
  ["the axis set by the single largest name", "const DOMAIN_Q = 0.995;", "const DOMAIN_Q = 1;"],
  ["the read time printed in UTC", "F.time(readAt)", "new Date(readAt).toISOString().slice(11, 16) + \" UTC\""],
  ["every hover asks for a card at once", "else cardTimer = setTimeout(() => { if (S.sel === t) run(); }, 220);", "else run();"],
  ["Show more ignores the room in the dialog", "Math.max(1, Math.floor((innerHeight - 24 - 170) / 44))", "999"],
  ["the market cap column used as the typical day", "sig: sig ? sig[i] : null, f2", "sig: cap ? cap[i] / 1e12 : null, f2"],
  ["a boundary curve drawn", "s += '<line class=\"ref\" data-ref=\"y1\"", "s += '<path class=\"boundary\" d=\"M0,0\"/><line class=\"ref\" data-ref=\"y1\""],
  ["the percent change multiplied twice", "const pct = (v) => F.pct(v, 1, true);", "const pct = (v) => F.pct(v * 100, 1, true);"],
  ["no correction: the raw p against the level", "const flag = it.state === \"tested\" && adj[i] <= q;", "const flag = it.state === \"tested\" && it.p <= q;"],
  ["no add-one in the page's rate", "p: (hits + 1) / (SESSIONS + 1) };\n  }\n  function sigRun", "p: hits / SESSIONS };\n  }\n  function sigRun"],
  ["names below 2 left out of the correction", "return { t: x.t, state: \"below\", z, level: null, hits: null, p: 1 };\n    const level", "return { t: x.t, state: \"below\", z, level: null, hits: null, p: null };\n    const level"],
  ["earnings names tested", "if (x.event === true) return { t: x.t, state: \"event\"", "if (false) return { t: x.t, state: \"event\""],
  ["an earnings state that is not placed read as no event", "? EARN_EVENT[st] : null;", "? EARN_EVENT[st] : false;"],
  ["a report of unstated time not set apart", "unstated: true, after: true", "unstated: false, after: true"],
  ["a report of unstated time called a reaction", "const tagText = (x) => (x.state === \"unstated\" ? \"Report time not stated\"", "const tagText = (x) => (x.state === \"unstated\" ? \"Reaction session\""],
  ["the unstated chip dropped", " : x.state === \"unstated\" ? \"Time unstated\" : \"\"", " : \"\""],
  ["names whose earnings are not placed tested", "if (x.event !== true && x.event !== false) return { t: x.t, state: \"unplaced\"", "if (false) return { t: x.t, state: \"unplaced\""],
  ["the flagged sentence on every tested name", "if (g.state === \"tested\") return g.flag ? SIG_FLAGGED_LINE : SIG_PLAIN_LINE;", "if (g.state === \"tested\") return SIG_FLAGGED_LINE;"],
  ["the foot counts the tested as flagged", "M.sg.flagged + \" of \"", "M.sg.tested + \" of \""],
  ["the old muted note back", "<span class=\"sub c\" data-k=\"sig\">' + esc(sigLine(x)) + \"</span>\"", "<span class=\"sub c\" data-k=\"sig\">Significance test: not yet published.</span>\""],
  ["the adjusted p shown as the raw p", "kv(\"p, adjusted\", x.sg.adj.toFixed(3))", "kv(\"p, adjusted\", x.sg.p.toFixed(3))"],
  ["the percentile called a rank", "kv(\"IV percentile\", cf.ivRank === null ? DASH : String(cf.ivRank))", "kv(\"IV rank\", cf.ivRank === null ? DASH : String(cf.ivRank))"],
  ["a ring on every name", "if (x.event) s += '<circle", "if (true) s += '<circle"],
  ["the name counted among its own peers", "if (r !== me && r.t !== t && !PINS.includes(r.t) && r.sector === me.sector && num(r.chg) !== null) v.push(r.chg);", "if (!PINS.includes(r.t) && r.sector === me.sector && num(r.chg) !== null) v.push(r.chg);"],
  ["the mean of the peers instead of the median", "const s = med(v);", "const s = v.reduce((a, b) => a + b, 0) / v.length;"],
  ["a missing change counted as a zero peer", "r.sector === me.sector && num(r.chg) !== null) v.push(r.chg);", "r.sector === me.sector) v.push(num(r.chg) === null ? 0 : r.chg);"],
  ["SPY and QQQ counted as peers", "!PINS.includes(r.t) && r.sector === me.sector", "r.sector === me.sector"],
  ["a floor of five peers", "const PEER_MIN = 10;", "const PEER_MIN = 5;"],
  ["the name's part rounded apart from the others", "tenths: tenthsOf(chg) - from });", "tenths: tenthsOf(chg - (peers ? peers.median : market)) });"],
  ["the market read from QQQ", "const spy = t === \"SPY\" ? null : rows.find((r) => r.t === \"SPY\");", "const spy = t === \"SPY\" ? null : rows.find((r) => r.t === \"QQQ\");"],
  ["the spread without the 1.4826", "z: d > 0 ? (chg - s) / d : null", "z: d > 0 ? (chg - s) / (d / MAD_SCALE) : null"],
  ["a part printed in hundredths", "Math.abs(k / 10).toFixed(1) + \"%\"", "Math.abs(k / 100).toFixed(1) + \"%\""],
  ["the parts strip dropped", "+ partsHtml(peerParts(M.rows, x.t)) +", "+ "],
];
const PARTS_MUTANTS = new Set(["the name counted among its own peers", "the mean of the peers instead of the median", "a missing change counted as a zero peer", "SPY and QQQ counted as peers", "a floor of five peers", "the name's part rounded apart from the others", "the market read from QQQ", "the spread without the 1.4826", "a part printed in hundredths", "the parts strip dropped"]);
ok([...PARTS_MUTANTS].every((n) => MUTANTS.some((m) => m[0] === n)) && PARTS_MUTANTS.size === 10, "the ten parts-of-the-move builds are the ones judged by the parts block alone");
for (const [name, from, to] of MUTANTS) {
  ok(JS.split(from).length === 2, "the planted build changes the module exactly once: " + name);
  const mutated = JS.replace(from, to);
  const problems = await exercise(browser, mutated, true, PARTS_MUTANTS.has(name) ? "parts" : undefined).catch((e) => ["threw: " + String(e.message).split("\n")[0]]);
  ok(problems.length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (first: " + problems[0] + ")");
}

const SEC_MUTANTS = [
  ["beyond counts a name exactly on the line", "Math.abs(m) > SECTOR_BEYOND).length;", "Math.abs(m) >= SECTOR_BEYOND).length;"],
  ["names reporting soon counted in the median", "if (r.event === false) b.ms.push(m);", "b.ms.push(m);"],
  ["SPY and QQQ counted in their sector", "if (!r || PINS.includes(r.t)) continue;", "if (!r) continue;"],
  ["a sector with no figures given a median of zero", "median: n ? med(b.ms) : null,", "median: n ? med(b.ms) : 0,"],
  ["ties left in the order the rows came", "|| cmp(a.name, b.name));", ");"],
  ["smallest median first", "(b.median === null ? 0 : b.median) - (a.median === null ? 0 : a.median)", "(a.median === null ? 0 : a.median) - (b.median === null ? 0 : b.median)"],
  ["a share that rounds to nothing printed as 0%", "return beyond > 0 && p === 0 ? \"<1%\" : p + \"%\";", "return p + \"%\";"],
  ["a flat median printed with a sign", "const flatten = (m) => ((m < 0 ? -1 : 1) * Math.round(Math.abs(m) * 10)) / 10 + 0;", "const flatten = (m) => m;"],
  ["choosing a chosen sector does not clear it", "S.sector = S.sector === key ? \"\" : key;", "S.sector = key;"],
  ["Show all never offered", "$(\"mvSecMore\").hidden = rows.length <= n;", "$(\"mvSecMore\").hidden = true;"],
  ["the count of names ignores the unmeasured", "r.n === r.total ? plural(r.total, \"name\", \"names\") : r.n + \" of \" + plural(r.total, \"name\", \"names\");", "plural(r.total, \"name\", \"names\");"],
  ["the share taken over every name, not the measured", "r.beyond + \" · \" + shareText(r.beyond, r.n))", "r.beyond + \" · \" + shareText(r.beyond, r.total))"],
  ["a sector with no names measured can be chosen", "(r.measured ? \"\" : \" disabled\")", "\"\""],
  ["the empty sector named Other", "const NO_SECTOR = \"No sector\";", "const NO_SECTOR = \"Other\";"],
  ["the dialog ignores its height", "Math.max(1, Math.floor((innerHeight - 24 - 230) / rh))", "999"],
  ["the name lists stay under the sector table", "for (const b of document.querySelectorAll(\"#mvLists .mv-box-now, #mvLists .mv-box-apart\")) b.hidden = sec;", "for (const b of document.querySelectorAll(\"#mvLists .mv-box-now, #mvLists .mv-box-apart\")) b.hidden = false;"],
  ["the table lists more rows than fit", "Math.min(rows.length, room || 1)", "rows.length"],
  ["the pressed state never set", "aria-pressed=\"' + (S.sector === r.key) + '\"", "aria-pressed=\"false\""],
  ["the filter key is the display name", "data-sector=\"' + esc(r.key) + '\"", "data-sector=\"' + esc(r.name) + '\""],
];
for (const [name, from, to] of SEC_MUTANTS) {
  ok(JS.split(from).length === 2, "the planted build changes the module exactly once: " + name);
  const problems = await exercise(browser, JS.replace(from, to), true, "sectors").catch((e) => ["threw: " + String(e.message).split("\n")[0]]);
  ok(problems.length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (first: " + problems[0] + ")");
}

await browser.close();
console.log(`✓ flows-moves-render: ${checks} assertions — the Moves page in Chromium against a synthetic universe of the real shape, no server and no feed data: no page scroll, no clipped cell and every dialog inside the viewport at 1440x820, 1024x768 and 390x844 in every panel and filter; each dot at the independent position of its typical days and implied multiple, sized by the square root of market cap, shaped by direction and ringed for earnings; the axes by the 99.5th percentile rule; SPY and QQQ pinned; the lists in IV-days with earnings names ranked apart; every rarity sentence equal to rarityText for all 253 counts at both levels; filters, Freeze and the live roster; the drill panel with a lazy card, a failure and a Retry; the keyboard and a phone tap; TRT; the parts of each move (market, the median of at least ten same-sector peers, the name against them) to the tenth of a percent, adding to the printed move; no boundary, q or flagged claim; and ${MUTANTS.length} planted wrong builds that each fail`);

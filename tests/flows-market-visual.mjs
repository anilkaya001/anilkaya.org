import assert from "node:assert/strict";
import { launch } from "./lib/browser.mjs";
import { openMarket } from "./lib/market-fixtures.mjs";
import { nightlyEmit, emitRead } from "./lib/nightly-emit.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const dir = nightlyEmit();
const market = emitRead(dir, "market");
const pulse = emitRead(dir, "pulse");
const breadth = emitRead(dir, "live-breadth");
const lastOf = (a) => { for (let i = a.length - 1; i >= 0; i--) if (typeof a[i] === "number") return a[i]; return null; };

const MINUS = "−";
const SCALE = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
function money(text) {
  const m = /^([+−-]?)\$([0-9.]+)([KMBT]?)$/.exec(String(text).trim());
  if (!m) return null;
  const dp = (m[2].split(".")[1] || "").length;
  const unit = SCALE[m[3]] || 1;
  return { v: (m[1] === "+" || m[1] === "" ? 1 : -1) * Number(m[2]) * unit, tol: 0.5 * Math.pow(10, -dp) * unit };
}
const near = (text, want) => { const p = money(text); return p !== null && Math.abs(p.v - want) <= p.tol + 1e-6; };

const lastPoint = pulse.tide.points[pulse.tide.points.length - 1];
const EXPECT = {
  net: lastPoint.callPrem - lastPoint.putPrem,
  calls: lastPoint.callPrem,
  puts: lastPoint.putPrem,
  etf: Object.fromEntries(["SPY", "QQQ", "IWM"].map((T) => [T, lastOf(breadth.etf[T].net)])),
  sectors: Object.entries(breadth.sectors.rows).map(([name, r]) => ({ name, net: lastOf(r.net) })),
};
const FLOOR = 0.06;
const SMALL = { name: "Basic Materials", net: 300000 };
const sectorsOf = (small) => EXPECT.sectors.map((s) => (small && s.name === SMALL.name ? { ...s, net: SMALL.net } : s));
const tweakOf = (small) => (small ? (route, body) => {
  if (route !== "lk" || !body.keys || !body.keys.breadth) return;
  const row = body.keys.breadth.payload.sectors.rows[SMALL.name];
  row.net = row.net.map((x, i, a) => (i === a.length - 1 ? SMALL.net : x));
} : null);

const FACTS = () => {
  const rect = (e) => e.getBoundingClientRect();
  const hero = [...document.querySelectorAll("#mkHero .mk-hc")].map((c) => {
    const r = rect(c);
    const bar = c.querySelector(".mk-hc-b");
    const meter = c.querySelector(".mk-mt");
    return {
      k: c.querySelector(".mk-hc-k").textContent, v: c.querySelector(".mk-hc-v").textContent, s: c.querySelector(".mk-hc-s").textContent,
      tone: c.dataset.tone || null, shown: r.width > 0 && r.height > 0, href: c.getAttribute("href"),
      spark: Boolean(c.querySelector(".mk-hc-p svg path.ln")),
      bar: bar ? [...bar.children].map((i) => ({ cls: i.className, w: rect(i).width / rect(bar).width })) : null,
      fill: meter && meter.querySelector(".mk-mt-f") ? rect(meter.querySelector(".mk-mt-f")).width / rect(meter).width : null,
      mark: meter && meter.querySelector(".mk-mt-m") ? (rect(meter.querySelector(".mk-mt-m")).left + 1 - rect(meter).left) / rect(meter).width : null,
    };
  });
  const tm = document.querySelector("#mkSecTides .mk-tm");
  const box = tm ? rect(tm) : null;
  const tiles = tm ? [...tm.querySelectorAll(":scope > .mk-small")].map((t) => {
    const r = rect(t);
    return { name: t.querySelector(".mk-small-n").getAttribute("title"), value: t.querySelector(".mk-small-h b").textContent, tone: t.dataset.tone || null,
      x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
  }) : [];
  const gts = [...document.querySelectorAll("#mktTape .mk-gt")].map((g) => {
    const m = g.querySelector(".mk-mt");
    const f = m && m.querySelector(".mk-mt-f");
    const u = m && m.querySelector(".mk-mt-u");
    return { label: g.querySelector(".ui-metric-l").textContent, fill: f ? rect(f).width / rect(m).width : null, up: u ? rect(u).width / rect(m).width : null };
  });
  return { hero, tm: box && { w: box.width, h: box.height }, tiles, gts };
};

function audit(f, { phone, small = false }) {
  const SECT = sectorsOf(small);
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(msg); };
  const H = Object.fromEntries(f.hero.map((c) => [c.k, c]));
  const netCell = H["Net tide"];
  need(netCell && near(netCell.v, EXPECT.net), "the hero net tide is not calls minus puts of the last tide bucket");
  need(netCell && netCell.tone === (EXPECT.net > 0 ? "up" : "down"), "the hero net tide tone does not follow its sign");
  need(phone || (netCell && netCell.spark), "the hero net tide has no path drawn");
  need(netCell && /^Calls /.test(netCell.s) && netCell.s.includes(" · Puts "), "the hero net tide does not name calls and puts");
  const parts = netCell ? netCell.s.replace("Calls ", "").split(" · Puts ") : [];
  need(parts.length === 2 && near(parts[0], EXPECT.calls) && near(parts[1], EXPECT.puts), "the hero calls and puts are not the last bucket's legs");
  const b = H["Breadth"];
  const tot = market.breadth.bull + market.breadth.bear + market.breadth.flat;
  need(b && b.v === (market.breadth.tilt < 0 ? MINUS : "+") + Math.abs(market.breadth.tilt).toFixed(2), "the hero breadth is not the signed tilt by names");
  need(b && b.bar && b.bar.length === 3, "the breadth bar is not three segments");
  if (b && b.bar && b.bar.length === 3) {
    const want = { "is-pos": market.breadth.bull / tot, "is-flat": market.breadth.flat / tot, "is-neg": market.breadth.bear / tot };
    for (const s of b.bar) need(Math.abs(s.w - want[s.cls]) < (phone ? 0.08 : 0.03), "a breadth segment is not its share of the priced names: " + s.cls);
  }
  need(b && b.tone === (market.breadth.tilt < 0 ? "down" : "up"), "the hero breadth tone does not follow its sign");
  const pc = H["Put / call"];
  need(pc && pc.v === market.pcr.premium.toFixed(2), "the hero put to call is not the premium ratio");
  need(pc && pc.fill !== null && Math.abs(pc.fill - Math.min(market.pcr.premium / 2, 1)) < 0.02, "the put to call meter is not on a 0 to 2 scale");
  need(pc && pc.mark !== null && Math.abs(pc.mark - 0.5) < 0.02, "the put to call parity mark is not at 1.0");
  for (const T of ["SPY", "QQQ", "IWM"]) {
    const c = H[T];
    need(c && near(c.v, EXPECT.etf[T]), "the hero " + T + " is not the last bucket of its options tide");
    need(c && c.tone === (EXPECT.etf[T] > 0 ? "up" : "down"), "the hero " + T + " tone does not follow its sign");
    need(phone || (c && c.spark), "the hero " + T + " has no path");
    need(c && c.href === "/flows/ticker/?t=" + T, "the hero " + T + " does not open its dossier");
    need(phone ? c && !c.shown : c && c.shown, "the hero " + T + " cell is " + (phone ? "shown on a phone" : "missing"));
  }
  const iv = H["IV 30d median"];
  need(iv && iv.v === (market.vol.iv30dMedian * 100).toFixed(1) + "%", "the hero IV median is not the payload's");
  need(phone || (iv && iv.fill !== null && Math.abs(iv.fill - market.vol.ivRankMedian) < 0.02), "the IV rank meter is not the rank on 0 to 100");

  need(f.tm && f.tiles.length === SECT.length, "the heat map does not hold one tile for each sector: " + f.tiles.length);
  if (f.tm && f.tiles.length === SECT.length) {
    const top = Math.max(...SECT.map((s) => Math.abs(s.net)));
    const weight = (s) => Math.max(Math.abs(s.net), top * FLOOR);
    const sum = SECT.reduce((a, s) => a + weight(s), 0);
    const area = f.tm.w * f.tm.h;
    let covered = 0;
    for (const t of f.tiles) {
      const s = SECT.find((x) => x.name === t.name);
      need(Boolean(s), "a tile names no sector: " + t.name);
      if (!s) continue;
      covered += t.w * t.h;
      need(Math.abs(t.w * t.h / area - weight(s) / sum) < 0.004, "the area of " + t.name + " is not its weight: " + (t.w * t.h / area).toFixed(4) + " against " + (weight(s) / sum).toFixed(4));
      need(near(t.value, s.net), "the value of " + t.name + " is not its net");
      need(t.tone === (s.net > 0 ? "up" : "down"), "the tone of " + t.name + " does not follow its sign");
      need(t.x >= -0.5 && t.y >= -0.5 && t.x + t.w <= f.tm.w + 0.5 && t.y + t.h <= f.tm.h + 0.5, t.name + " leaves the map");
    }
    need(Math.abs(covered - area) / area < 0.01, "the tiles do not cover the map");
    for (let i = 0; i < f.tiles.length; i++) for (let j = i + 1; j < f.tiles.length; j++) {
      const a = f.tiles[i], c = f.tiles[j];
      const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
      need(!(ox > 1 && oy > 1), "two tiles overlap: " + a.name + " and " + c.name);
    }
    const nets = f.tiles.map((t) => (SECT.find((x) => x.name === t.name) || { net: 0 }).net);
    need(nets.every((n, i) => i === 0 || nets[i - 1] >= n), "the tiles are not listed from the most net-bought sector to the most net-sold");
  }

  const G = Object.fromEntries(f.gts.map((g) => [g.label, g]));
  const split = market.premium.netPositive / (Math.abs(market.premium.netPositive) + Math.abs(market.premium.netNegative));
  need(G["Net premium"] && G["Net premium"].up !== null && Math.abs(G["Net premium"].up - split) < 0.03, "the net premium split is not calls over calls plus puts");
  need(G["P/C contracts"] && Math.abs(G["P/C contracts"].fill - Math.min(market.pcr.volume / 2, 1)) < 0.02, "the P/C contracts meter is not on a 0 to 2 scale");
  need(G["Calls at offer"] && Math.abs(G["Calls at offer"].fill - market.aggressor.callLift) < 0.02, "the calls at offer meter is not the share");
  need(G["IV rank median"] && Math.abs(G["IV rank median"].fill - market.vol.ivRankMedian) < 0.02, "the IV rank tile meter is not the rank");
  return bad;
}

async function run(browser, { phone, patch = null, small = false }) {
  const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 820 };
  const { context, page, errors } = await openMarket(browser, { rich: true, viewport, patch, tweak: tweakOf(small) });
  await page.waitForSelector("#mkHero .mk-hc");
  await page.waitForTimeout(1500);
  const first = await page.evaluate(FACTS);
  await page.click("#mkT-sectors");
  if (phone) await page.locator("#mkSub button").nth(0).click();
  await page.waitForSelector("#mkSecTides .mk-small");
  await page.waitForTimeout(1200);
  const second = await page.evaluate(FACTS);
  await page.click("#mkT-tide");
  if (phone) await page.locator("#mkSub button").nth(2).click();
  await page.waitForTimeout(600);
  const third = await page.evaluate(FACTS);
  await context.close();
  return { facts: { hero: first.hero, tm: second.tm, tiles: second.tiles, gts: third.gts }, errors };
}

const JS = "/assets/js/flows-market.js";
const MUTANTS = [
  ["area ignores the floor", JS, [["Math.max(Math.abs(c.net === null ? 0 : c.net), top * TM_FLOOR)", "Math.abs(c.net === null ? 0 : c.net)"]]],
  ["tiles not most net-bought first", JS, [["cells.sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity));", "cells.sort((a, b) => (a.net ?? -Infinity) - (b.net ?? -Infinity));"]]],
  ["breadth segments swapped", JS, [['h("i", { class: "is-pos", style: { width: (bull / bt * 100) + "%" } })', 'h("i", { class: "is-pos", style: { width: (bear / bt * 100) + "%" } })']]],
  ["put to call on the wrong scale", JS, [["Math.min(pp / 2, 1) * 100", "Math.min(pp, 1) * 100"]]],
  ["split bar upside down", JS, [["split: Math.abs(pos) / (Math.abs(pos) + Math.abs(neg))", "split: Math.abs(neg) / (Math.abs(pos) + Math.abs(neg))"]]],
  ["net tide path dropped", JS, [["vals: tv && tideNet !== null ? tv.net : null,", "vals: null,"]]],
  ["net tide from the wrong leg", JS, [["const tideNet = tv ? lastNum(tv.net) : null;", "const tideNet = tv ? lastNum(tv.call) : null;"]]],
  ["tile tone from the wrong sign", JS, [['"data-tone": toneOf(c.net), "data-nil"', '"data-tone": toneOf(-c.net), "data-nil"']]],
  ["ETF cell opens the wrong page", JS, [['href: "/flows/ticker/?t=" + T, cls: "is-etf"', 'href: "/flows/market/?t=" + T, cls: "is-etf"']]],
];

const browser = await launch();
try {
  for (const phone of [false, true]) {
    const label = phone ? "390 px" : "1440 px";
    const good = await run(browser, { phone });
    ok(good.errors.length === 0, `no page error at ${label}: ${good.errors.join("; ")}`);
    const bad = audit(good.facts, { phone });
    ok(bad.length === 0, `the market visuals at ${label} hold: ${bad.join("; ")}`);
    if (phone) continue;
    const tiny = await run(browser, { phone, small: true });
    const tinyBad = audit(tiny.facts, { phone, small: true });
    ok(tinyBad.length === 0, `with one sector far below the floor the heat map still holds: ${tinyBad.join("; ")}`);
    for (const [name, file, edits] of MUTANTS) {
      const m = await run(browser, { phone, patch: { [file]: edits }, small: true });
      const found = audit(m.facts, { phone, small: true });
      ok(found.length > 0 || m.errors.length > 0, `the planted wrong build "${name}" is caught`);
    }
  }
} finally {
  await browser.close();
}
console.log(`✓ flows-market-visual: ${checks} checks — the hero strip, the sector heat map and the tape meters against independent computations from the dry-run emit at 1440 and 390 px, and ${MUTANTS.length} planted wrong builds that each fail`);

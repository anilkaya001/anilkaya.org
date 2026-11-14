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
    const tag = c.querySelector(".mk-hc-src");
    const zero = meter && meter.querySelector(".mk-mt-b");
    return {
      k: c.querySelector(".mk-hc-k").textContent, v: c.querySelector(".mk-hc-v").textContent, s: c.querySelector(".mk-hc-s").textContent,
      said: c.querySelector(".mk-hc-s").innerText.trim(), saidShown: rect(c.querySelector(".mk-hc-s")).height > 0, tag: tag && rect(tag).width > 0 ? tag.textContent.trim() : null, src: c.dataset.src || null,
      button: c.tagName === "BUTTON", info: c.hasAttribute("data-info"), pop: c.getAttribute("aria-haspopup"), title: c.getAttribute("title") || "",
      zero: zero ? { l: (rect(zero).left - rect(meter).left) / rect(meter).width, w: rect(zero).width / rect(meter).width, cls: zero.className } : null,
      zlabel: meter ? meter.getAttribute("aria-label") : null, inside: [...c.children].every((e) => rect(e).right <= r.right + 0.5 && rect(e).bottom <= r.bottom + 0.5),
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
  const leak = [...document.querySelectorAll("#mkP-sectors .mk-small-p, #mkP-sectors .mk-small-p *")]
    .filter((e) => getComputedStyle(e).visibility !== "hidden").length;
  return { hero, tm: box && { w: box.width, h: box.height }, tiles, gts, leak };
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
  need(phone ? pc && !pc.shown : pc && pc.shown, "the hero put to call cell is " + (phone ? "shown on a phone, where the first three cells are the hero" : "missing"));
  need(phone || (pc && pc.fill !== null && Math.abs(pc.fill - Math.min(market.pcr.premium / 2, 1)) < 0.02), "the put to call meter is not on a 0 to 2 scale");
  need(phone || (pc && pc.mark !== null && Math.abs(pc.mark - 0.5) < 0.02), "the put to call parity mark is not at 1.0");
  need(f.hero.filter((c) => c.shown).length === (phone ? 3 : 8), "the hero does not show " + (phone ? "its first three cells on a phone" : "all eight cells"));
  need(f.hero.filter((c) => c.shown).every((c) => c.inside), "something in a hero cell leaves its cell");
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

  need(f.leak === 0, "a sector tile chart stays visible on another tab: " + f.leak);
  const G = Object.fromEntries(f.gts.map((g) => [g.label, g]));
  const split = market.premium.netPositive / (Math.abs(market.premium.netPositive) + Math.abs(market.premium.netNegative));
  need(G["Net premium"] && G["Net premium"].up !== null && Math.abs(G["Net premium"].up - split) < 0.03, "the net premium split is not bullish-leaning names over bullish plus bearish");
  need(G["P/C contracts"] && Math.abs(G["P/C contracts"].fill - Math.min(market.pcr.volume / 2, 1)) < 0.02, "the P/C contracts meter is not on a 0 to 2 scale");
  need(G["Call offer share"] && Math.abs(G["Call offer share"].fill - market.aggressor.callLift) < 0.02, "the call offer share meter is not the share");
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
  return { facts: { hero: first.hero, tm: second.tm, tiles: second.tiles, gts: third.gts, leak: third.leak }, errors };
}

const DASH = "\u2014";
const CAP_SCALE = 0.25;
const CAP_DEFINE = "Each stock's net premium over its total premium, averaged by market value.";
const CAP_OUTSIDE = "Index options and funds have no market value and are outside it.";
const signedPct = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "") + (Math.round(Math.abs(v) * 1000) / 10).toFixed(1) + "%";
const wholePct = (v) => Math.round(v * 100) + "%";
const liveOf = (body) => (body && body.keys && body.keys.breadth && body.keys.breadth.payload ? body.keys.breadth : null);
const fromNight = (n) => ({ src: "nightly", value: n.value, n: n.n, of: n.of, coverage: n.coverage });
const fromLive = (l) => ({ src: "live", value: l.value, n: l.n, of: l.of, coverage: l.coverage });
const CAP_WORLDS = [
  ["the live read is live and of the newest session", null, (n, l) => fromLive(l), [[1920, 1080], [1440, 820], [1024, 768], [390, 844]]],
  ["the live key has gone stale", (route, body) => {
    const b = route === "lk" && liveOf(body);
    if (b) Object.assign(b.fresh, { state: "stale", liveUntil: null, staleAt: null });
    if (route === "market") Object.assign(body.capTide, { coverage: 0.6234, n: 211 });
  }, (n) => ({ ...fromNight(n), coverage: 0.6234, n: 211 }), [[1920, 1080], [1440, 820], [1024, 768], [390, 844]]],
  ["the live key is fresh but no longer live", (route, body) => { const b = route === "lk" && liveOf(body); if (b) Object.assign(b.fresh, { state: "fresh", liveUntil: body.serverNow - 1000 }); },
    (n) => fromNight(n), [[1440, 820]]],
  ["the live session is older than the nightly's", (route, body) => { const b = route === "lk" && liveOf(body); if (b) b.payload.session = "2026-08-21"; }, (n) => fromNight(n), [[1440, 820]]],
  ["the live read was withheld and the nightly stands", (route, body) => { const b = route === "lk" && liveOf(body); if (b) Object.assign(b.payload.cap, { value: null, reason: "thin", equal: null }); },
    (n) => ({ ...fromNight(n), note: "The live read was withheld, so the nightly figure stands." }), [[1440, 820]]],
  ["a nightly figure beyond the meter's scale", (route, body) => { const b = route === "lk" && liveOf(body); if (b) delete b.payload.cap; if (route === "market") body.capTide.value = 0.3104; },
    (n) => ({ ...fromNight(n), value: 0.3104 }), [[1440, 820], [390, 844]]],
  ["both are withheld", (route, body) => {
    const b = route === "lk" && liveOf(body);
    if (b) Object.assign(b.payload.cap, { value: null, reason: "vendor-failed", n: 0, coverage: null, equal: null, effN: null, dollarNet: null });
    if (route === "market") Object.assign(body.capTide, { value: null, reason: "coverage", coverage: 0.31, equal: null, top: [] });
  }, () => ({ src: "live", value: null, short: "Live read failed", why: "The live read failed on this pass." }), [[1440, 820], [390, 844]]],
  ["only the nightly exists and it is withheld", (route, body) => {
    const b = route === "lk" && liveOf(body);
    if (b) delete b.payload.cap;
    if (route === "market") Object.assign(body.capTide, { value: null, reason: "coverage", coverage: 0.31, equal: null, top: [] });
  }, () => ({ src: "nightly", value: null, short: "Under half the market value", why: "The names read cover under half the market value." }), [[1440, 820]]],
  ["neither payload carries the figure", (route, body) => { const b = route === "lk" && liveOf(body); if (b) delete b.payload.cap; if (route === "market") delete body.capTide; },
    () => ({ src: null, value: null, short: "Not published yet", why: "The nightly build has not published this figure yet." }), [[1440, 820], [390, 844]]],
];

function capAudit(f, pop, want, { w }) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(msg); };
  const i = f.hero.findIndex((c) => c.k === "Cap-weighted tide");
  need(i === 1 && f.hero[0].k === "Net tide", "the cap-weighted cell is not right after the net tide");
  const c = f.hero[i];
  if (!c) return bad;
  need(c.shown && c.inside, "the cap-weighted cell is hidden or something leaves it");
  need(c.button && c.info && c.pop === "dialog", "the cap-weighted cell does not open a disclosure");
  need(c.src === want.src, "the cell is marked " + c.src + ", not " + want.src);
  need(!/UTC|GMT|\bET\b|Eastern|\btape\b/i.test(c.title + " " + pop), "the cell names another zone or the banned word");
  need(pop.includes(CAP_DEFINE) && pop.includes(CAP_OUTSIDE), "the disclosure does not define the measure and say what is outside it");
  if (want.value === null) {
    need(c.v === DASH, "a withheld figure prints " + c.v + ", not a dash");
    need(c.tone === null, "a withheld figure is toned " + c.tone);
    need(c.zero === null && c.zlabel === null, "a withheld figure draws a meter");
    need(c.said === want.short, "a withheld figure does not give its reason in the cell: " + c.said);
    need((c.title + " " + pop).includes(want.why), "a withheld figure does not give its reason in words");
    return bad;
  }
  const word = want.src === "live" ? "Live" : "Nightly";
  const cover = want.n + " of " + want.of + " names, " + wholePct(want.coverage) + " of market value";
  need(c.v === signedPct(want.value), "the cell prints " + c.v + ", the fixture says " + signedPct(want.value));
  need(c.tone === (want.value > 0 ? "up" : want.value < 0 ? "down" : null), "the cell's tone does not follow its sign: " + c.tone);
  need(c.tag === word || (c.saidShown && c.said.startsWith(word + " \u00b7 ")), "the cell does not say on screen that it shows the " + word.toLowerCase() + " figure: " + c.tag + " / " + c.said);
  need(!c.saidShown || c.said.includes(want.n + " of " + want.of), "the cell's second line does not count its names: " + c.said);
  need(w < 1900 || (c.saidShown && c.said === cover), "at full width the cell does not print its coverage: " + c.said);
  need(c.title.includes(cover + "."), "the title does not carry the coverage by market value: " + c.title);
  need(pop.replace(/\s+/g, " ").includes("Names " + want.n + " of " + want.of) && pop.replace(/\s+/g, " ").includes("Market value covered " + wholePct(want.coverage)), "the disclosure does not carry the names and the coverage");
  need(want.src !== "live" || (/Live read at \d\d:\d\d TRT/.test(c.title) && /Live read at \d\d:\d\d TRT/.test(pop)), "a live figure does not name its read time in TRT");
  need(want.src !== "nightly" || /Nightly figure for /.test(c.title), "a nightly figure does not name its session");
  need(!want.note || pop.includes(want.note), "the disclosure does not say why the nightly figure stands");
  const frac = Math.min(Math.abs(want.value) / CAP_SCALE, 1);
  const tol = w < 500 ? 0.02 : 0.012;
  need(c.zero !== null && Math.abs(c.zero.w - frac * 0.5) < tol, "the meter bar is not the figure on a scale of 25% a side: " + JSON.stringify(c.zero));
  need(c.zero !== null && Math.abs(c.zero.l - (want.value >= 0 ? 0.5 : 0.5 - frac * 0.5)) < tol, "the meter bar does not start at the centre on its own side: " + JSON.stringify(c.zero));
  need(c.zero !== null && c.zero.cls.includes(want.value < 0 ? "is-neg" : "is-pos"), "the meter bar is on the wrong side's colour");
  need(c.mark !== null && Math.abs(c.mark - 0.5) < 0.03, "the meter's zero mark is not at the centre: " + c.mark);
  need(c.zlabel !== null && c.zlabel.includes(signedPct(want.value)) && c.zlabel.includes("zero at the centre"), "the meter does not say its figure and scale: " + c.zlabel);
  return bad;
}

async function pooled(list, fn, width = 3) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = [list[i], await fn(list[i])]; }
  }));
  return out;
}

async function capRun(browser, world, [w, h], patch = null) {
  const [, tweak, expect] = world;
  const want = expect(market.capTide, breadth.cap);
  const { context, page, errors } = await openMarket(browser, { rich: true, viewport: { width: w, height: h }, patch, tweak });
  await page.waitForSelector("#mkHero .mk-hc");
  await page.waitForTimeout(1300);
  const f = await page.evaluate(FACTS);
  let pop = "";
  if (await page.locator("#mkHero button.mk-hc.is-cw").count()) {
    await page.click("#mkHero button.mk-hc.is-cw");
    await page.waitForTimeout(350);
    pop = await page.evaluate(() => { const p = document.getElementById("fxPop"); return p ? p.innerText : ""; });
  }
  await context.close();
  return { bad: capAudit(f, pop, want, { w }), errors };
}

const JS = "/assets/js/flows-market.js";
const CSS = "/assets/css/flows-market.css";
const CAP_MUTANTS = [
  ["the nightly figure stands while the live read is live", [["if (on && isNum(live.value) !== null) return pick(live, \"live\");", ""]], 0],
  ["a stale live key still counts as live", [["const on = Boolean(live && state === \"live\" && newer(lb.session, m));", "const on = Boolean(live && newer(lb.session, m));"]], 1],
  ["a key that is fresh but not live counts as live", [["const on = Boolean(live && state === \"live\" && newer(lb.session, m));", "const on = Boolean(live && state !== \"stale\" && newer(lb.session, m));"]], 2],
  ["an older live session outranks the nightly", [["const on = Boolean(live && state === \"live\" && newer(lb.session, m));", "const on = Boolean(live && state === \"live\");"]], 3],
  ["a withheld live read is shown ahead of a nightly figure", [["if (night && isNum(night.value) !== null) return Object.assign(pick(night, \"nightly\"), { liveWhy: on ? live.reason : null, liveHeld: Boolean(live && !on) });\n    if (on) return pick(live, \"live\");", "if (on) return pick(live, \"live\");"]], 4],
  ["a withheld figure is painted as zero", [["k: head, v: c.value === null ? DASH : F.pct(c.value, 1, true), tone: toneOf(c.value)", "k: head, v: F.pct(c.value === null ? 0 : c.value, 1, true), tone: toneOf(c.value)"]], 7],
  ["a withheld figure draws a bar at zero", [["node: frac === null ? null : h(\"span\", { class: \"mk-mt mk-mt-z\"", "node: h(\"span\", { class: \"mk-mt mk-mt-z\""]], 7],
  ["the sign is dropped", [["k: head, v: c.value === null ? DASH : F.pct(c.value, 1, true), tone: toneOf(c.value)", "k: head, v: c.value === null ? DASH : F.pct(Math.abs(c.value), 1), tone: toneOf(c.value)"]], 1],
  ["the fraction is printed as if it were the percent", [["k: head, v: c.value === null ? DASH : F.pct(c.value, 1, true), tone: toneOf(c.value)", "k: head, v: c.value === null ? DASH : F.pct(c.value / 100, 1, true), tone: toneOf(c.value)"]], 0],
  ["the meter is on another scale", [["const CAP_SCALE = 0.25;", "const CAP_SCALE = 1;"]], 0],
  ["the meter starts at its left edge, not at zero", [["left: c.value >= 0 ? \"50%\" : (50 - frac * 50) + \"%\"", "left: \"0%\""]], 0],
  ["the meter bar points the wrong way", [["left: c.value >= 0 ? \"50%\" : (50 - frac * 50) + \"%\"", "left: c.value < 0 ? \"50%\" : (50 - frac * 50) + \"%\""]], 1],
  ["a figure past the scale runs out of the meter", [["Math.min(Math.abs(c.value) / CAP_SCALE, 1)", "Math.abs(c.value) / CAP_SCALE"]], 5],
  ["coverage is counted by names, not by market value", [["\", \" + F.pct(c.coverage, 0) + \" of market value\"]", "\", \" + F.pct(c.n / c.of, 0) + \" of market value\"]"]], 1],
  ["the cell sits after breadth", [["      capCell(cell),\n    ];", "    ];"], ["    const pp = isNum(pcr.premium), pv = isNum(pcr.volume);", "    cells.push(capCell(cell));\n    const pp = isNum(pcr.premium), pv = isNum(pcr.volume);"]], 0],
  ["the cell does not say which figure it shows", [["tag: h(\"span\", { class: \"mk-hc-src\", \"data-src\": c.src }, word),", "tag: null,"], ["h(\"span\", { class: \"mk-cw-w\" }, word + \" \\u00b7 \")", "null"]], 0],
  ["the disclosure leaves out what is outside the measure", [["CAP_COPY.net, CAP_COPY.outside, CAP_COPY.scope, CAP_COPY.withheld],", "CAP_COPY.net, CAP_COPY.scope, CAP_COPY.withheld],"]], 0],
];
const MUTANTS = [
  ["tile charts leak onto other tabs", CSS, [["{ .mk-small-p { visibility: inherit; } }", "{ .mk-small-p { visibility: visible; } }"]]],
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
  const visits = CAP_WORLDS.flatMap((world) => world[3].map((size) => ({ world, size })));
  for (const [v, r] of await pooled(visits, ({ world, size }) => capRun(browser, world, size))) {
    ok(r.errors.length === 0, `no page error at ${v.size.join("x")} when ${v.world[0]}: ${r.errors.join("; ")}`);
    ok(r.bad.length === 0, `THE CAP-WEIGHTED CELL AT ${v.size.join("x")} WHEN ${v.world[0].toUpperCase()} is the fixture's figure, source, coverage and meter: ${r.bad.join("; ")}`);
  }
  for (const [[name], r] of await pooled(CAP_MUTANTS, ([, edits, world]) => capRun(browser, CAP_WORLDS[world], [1440, 820], { [JS]: edits }))) {
    if (process.env.MARKET_WHY) console.log("WHY", name, JSON.stringify(r.bad), r.errors.join("; "));
    ok(r.bad.length > 0, `the planted wrong build of the cap-weighted cell "${name}" is caught`);
  }
} finally {
  await browser.close();
}
console.log(`✓ flows-market-visual: ${checks} checks — the hero strip, the sector heat map and the tape meters against independent computations from the dry-run emit at 1440 and 390 px, the cap-weighted cell in ${CAP_WORLDS.length} worlds at up to four sizes, and ${MUTANTS.length + CAP_MUTANTS.length} planted wrong builds that each fail`);

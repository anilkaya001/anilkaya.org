import { showTab } from "./lib/market-fixtures.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as M from "../shared/flows-moves0.js";
import * as PAGES from "../shared/flows-pages.js";
import { targetFor } from "../shared/flows-targets.js";
import { HORIZON_SESSIONS } from "../shared/flows-horizon.js";
import { ahead as aheadOf } from "../shared/flows-calendar.js";
import { revealBelow } from "./lib/below-fold.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, "utf8");

const SQRT252 = 15.874507866387544;

{
  const px = (t, chg, sector = "X") => ({ t, chg, sector });
  const base = [0.002, 0.005, 0.008, 0.010, 0.012, 0.012, 0.014, 0.016, 0.020, 0.030].map((c, i) => px("P" + i, c));
  const world = [px("S", 0.031), px("SPY", 0.004), ...base];
  const got = M.partsOf(world, "S");
  deep(got.parts.map((p) => p.tenths), [4, 8, 19], "hand worked: SPY 0.4, the peer median 1.2 is 0.8 above it, the name's 3.1 is 1.9 above that");
  deep(got.parts.map((p) => p.label), ["Market (SPY)", "Peers vs market", "Name vs peers"], "and the labels say what each gap is");
  eq(got.total, 31, "the printed move is 3.1");
  near(got.peers.median, 0.012, 1e-15, "the peer median of ten is the mean of the fifth and sixth: 0.012");
  near(got.peers.spread, 1.4826 * 0.004, 1e-12, "the spread is 1.4826 times the median absolute deviation 0.004");
  near(got.peers.z, 0.019 / (1.4826 * 0.004), 1e-9, "z is 0.019 over that spread: 3.2038");
  eq(got.peers.n, 10, "ten peers");
  eq(M.partsOf(world.filter((x) => x.t !== "P0"), "S").peers, null, "nine peers is not enough");
  eq(M.partsOf(world.filter((x) => x.t !== "P0"), "S").peerWhy, "9 peers, needs 10.", "and says how many there were");
  deep(M.partsOf(world.filter((x) => x.t !== "P0"), "S").parts.map((p) => p.tenths), [4, 27], "with no peers the name is read against the market alone: 0.4, then 2.7");
  eq(M.partsOf(world.map((x) => (x.t === "P0" ? { ...x, chg: null } : x)), "S").peerWhy, "9 peers, needs 10.", "a null change is not a peer and is never a zero");
  eq(M.partsOf([...world, px("QQQ", 0.5)], "S").peers.n, 10, "QQQ is never a peer");
  eq(M.partsOf([...world, px("PX", 0.5, "Y")], "S").peers.n, 10, "nor is a name of another sector");
  eq(M.partsOf([...world, px("PN", 0.5, null)], "S").peers.n, 10, "nor one with no sector");
  eq(M.partsOf(world, "SPY").parts.length, 0, "SPY has no parts");
  eq(M.partsOf(world, "SPY").peerWhy, "A market reference has no peers.", "only the reason");
  deep(M.partsOf([...world, px("NOSEC", 0.02, null)], "NOSEC").parts.map((p) => p.tenths), [4, 16], "a name with no sector keeps the market part");
  eq(M.partsOf([...world, px("NOSEC", 0.02, null)], "NOSEC").peerWhy, "No sector, so no peers.", "and says why there are no peers");
  eq(M.partsOf(world.map((x) => (x.t === "SPY" ? { ...x, chg: null } : x)), "S").parts.length, 2, "with no SPY the parts are the peer median and the name's gap to it");
  deep(M.partsOf(world.map((x) => (x.t === "SPY" ? { ...x, chg: null } : x)), "S").parts.map((p) => p.label), ["Peers' median", "Name vs peers"], "labelled as such");
  eq(M.partsOf(world, "NOPE"), null, "an unknown name has none");
  eq(M.partsOf([px("S", null)], "S"), null, "a name with no change has none");
  eq(M.partsOf(null, "S"), null, "no rows, no parts");
  eq(M.partsOf([px("S", 0.01), ...Array.from({ length: 10 }, (_, i) => px("Q" + i, 0.01))], "S").peers.z, null, "a zero spread has no z");
  const flat = M.partsOf([px("S", -0.0003), px("SPY", 0.0002)], "S");
  eq(flat.total, 0, "a move that rounds to nothing is a plain zero, not minus zero");
  eq(flat.parts.reduce((a, p) => a + p.tenths, 0), flat.total, "and the parts still add to it");
  const drift = M.partsOf([px("S", 0.0344), px("SPY", 0.0044), ...[0.001, 0.004, 0.008, 0.011, 0.0126, 0.0126, 0.014, 0.017, 0.02, 0.03].map((c, i) => px("P" + i, c))], "S");
  deep(drift.parts.map((p) => p.tenths), [4, 9, 21], "levels are rounded, not gaps: 0.44 and 1.26 are 0.4 and 1.3, so the name's 3.44 leaves 2.1");
  eq(drift.parts.reduce((a, p) => a + p.tenths, 0), 34, "and the three add to the printed 3.4");
  for (const sentence of M.PARTS_SENTENCES) ok(M.wordCount(sentence) <= M.HEADER_WORDS_MAX && !M.FORBIDDEN_WORDS.some((w) => new RegExp("\\b" + w + "\\b", "i").test(sentence)), "a parts sentence is short and clean: " + sentence);
  ok(M.HEADER_SENTENCES.includes(M.PARTS_SENTENCES[0]), "and is held with the other header sentences");
}

{
  const IV = SQRT252;
  const r = (t, m, sector, ed) => ({ t, chg: m, iv30p: IV, sector, ed: ed === undefined ? null : ed });
  const find = (list, name) => list.find((x) => x.name === name);
  eq(M.ivDays(2, IV), 2, "a change of 2 on an IV of the square root of 252 is exactly 2 IV-days, so the boundary can be hit exactly");
  const hand = M.sectorStats([
    r("A1", -3, "Alpha"), r("A2", -0.5, "Alpha"), r("A3", 0.4, "Alpha"), r("A4", 2, "Alpha"), r("A5", 2.01, "Alpha"),
    r("A6", 9, "Alpha", 21), r("A7", 9, "Alpha", 22),
  ]);
  const alpha = find(hand, "Alpha");
  eq(alpha.total, 7, "hand worked: seven names in the sector");
  eq(alpha.measured, 7, "all seven have an implied day");
  eq(alpha.apart, 1, "one reports within 21 sessions and is left out of every figure");
  eq(alpha.n, 6, "which leaves six");
  near(alpha.median, 1.2, 1e-12, "the median of -3, -0.5, 0.4, 2, 2.01 and 9 is (0.4 + 2) over 2");
  eq(alpha.beyond, 3, "-3 and 2.01 are beyond 2, and so is the 9 that reports in 22 sessions; exactly 2 is not");
  near(alpha.share, 3 / 6, 1e-12, "share is that count over the six");
  eq(alpha.why, null, "a sector with figures gives no reason");
  eq(M.sectorStats([r("X", 2, "S"), r("Y", -2, "S")])[0].beyond, 0, "exactly 2 and exactly -2 are on the line and are not beyond it");
  eq(M.sectorStats([r("X", 2.0000001, "S")])[0].beyond, 1, "just past 2 is beyond");
  eq(M.sectorStats([r("X", -2.0000001, "S")])[0].beyond, 1, "and just past -2 is beyond");
  const mixed = M.sectorStats([
    r("B1", 1, "Ghost"), { t: "B2", chg: 1, iv30p: null, sector: "Ghost", ed: null }, { t: "B3", chg: 1, iv30p: 0, sector: "Ghost", ed: null },
    r("C1", 1, "Soon", 3), r("C2", 2, "Soon", 21),
    r("D1", 1, null), r("D2", 3, ""),
  ]);
  const ghost = find(mixed, "Ghost");
  eq(ghost.n, 1, "a name with no implied volatility is not measured and a name with it is");
  const none = M.sectorStats([{ t: "B2", chg: 1, iv30p: null, sector: "Ghost", ed: null }, { t: "B3", chg: 1, iv30p: 0, sector: "Ghost", ed: null }])[0];
  eq(none.median, null, "a sector with no implied volatility has no median, never zero");
  eq(none.beyond, null, "no count of names beyond, never zero");
  eq(none.share, null, "no share");
  eq(none.why, M.WHY_NO_IV, "and says why");
  eq(none.total, 2, "its names are still counted");
  eq(none.measured, 0, "though none is measured");
  const soon = find(mixed, "Soon");
  eq(soon.median, null, "a sector whose measured names all report soon has no median");
  eq(soon.why, M.WHY_ALL_EVENT, "and says that");
  eq(soon.apart, 2, "with both names counted apart");
  eq(soon.measured, 2, "and measured");
  const ns = find(mixed, M.NO_SECTOR);
  eq(ns.total, 2, "names with a null or empty sector are one sector, No sector");
  near(ns.median, 2, 1e-12, "whose median is the middle of 1 and 3");
  const pinned = M.sectorStats([r("SPY", 50, "Alpha"), r("QQQ", -50, "Alpha"), r("A1", 1, "Alpha"), r("SPY2", 1, "Funds")]);
  eq(pinned.length, 2, "SPY and QQQ are not in any sector");
  near(find(pinned, "Alpha").median, 1, 1e-12, "so they cannot move a sector's median");
  eq(find(pinned, "Alpha").total, 1, "or its count");
  eq(M.sectorStats([r("SPY", 1, "Funds"), r("QQQ", 1, "Funds")]).length, 0, "a sector holding only the two is not listed");
  eq(M.sectorStats(null).length, 0, "no rows, no sectors");
  eq(M.sectorStats([null, { t: 4 }, { t: "" }, undefined]).length, 0, "rows without a ticker are ignored");
  const tied = M.sectorStats([r("a", 1, "Zulu"), r("b", 1, "Alpha"), r("c", 1, "Mike"), r("d", 2, "Low"), r("e", -1, "Neg"), { t: "g", chg: 1, iv30p: null, sector: "Zed" }, { t: "h", chg: 1, iv30p: null, sector: "Abe" }]);
  deep(tied.map((x) => x.name), ["Low", "Alpha", "Mike", "Zulu", "Neg", "Abe", "Zed"], "largest median first, ties by name, a sector with no median last and by name");
  deep(M.sectorStats([r("a", 1, "Zulu"), r("b", 1, "Alpha")]).map((x) => x.name), M.sectorStats([r("b", 1, "Alpha"), r("a", 1, "Zulu")]).map((x) => x.name), "and the order does not depend on the order of the rows");
  eq(M.shareText(0, 5), "0%", "none of five is 0%");
  eq(M.shareText(1, 300), "<1%", "one of 300 is under half a percent and prints as under 1%, not as 0%");
  eq(M.shareText(1, 200), "1%", "one of 200 is half a percent and rounds to 1%");
  eq(M.shareText(3, 8), "38%", "three of eight is 37.5 and rounds up");
  eq(M.shareText(5, 5), "100%", "all of them");
  eq(M.shareText(0, 0), null, "of no names there is no share");
  eq(M.shareText(2, 1), null, "more than all is refused");
  eq(M.shareText(-1, 5), null, "and so is a negative count");
  eq(M.shareText(1.5, 5), null, "and a fraction");
  for (const sentence of [M.SECTORS_LINE, M.MEDIAN_NOTE, M.BEYOND_NOTE, M.SHARE_NOTE, M.LEFT_OUT_NOTE, M.PINS_NOTE, M.WHY_NO_IV, M.WHY_ALL_EVENT]) {
    ok(M.HEADER_SENTENCES.includes(sentence) && M.wordCount(sentence) <= M.HEADER_WORDS_MAX, "a sector sentence is held with the header sentences and is short: " + sentence);
  }
  eq(M.SECTOR_BEYOND, 2, "the line is 2 IV-days");
  deep(M.LIST_VIEWS, ["names", "sectors"], "the list has two views");
  for (const gone of ["MAP_CAP_LINE", "MAP_EQUAL_LINE", "KEY_EVENT", "VIEWS"]) ok(!(gone in M), gone + " described a map view that does not exist and is removed");
  const rnd = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const q = rnd(20261027);
  const NAMES = ["Alpha", "Beta", "Gamma", null, "", "Delta"];
  const brute = (rows) => {
    const groups = {};
    for (const x of rows) {
      if (!x || typeof x.t !== "string" || !x.t || x.t === "SPY" || x.t === "QQQ") continue;
      const name = x.sector ? x.sector : "No sector";
      (groups[name] = groups[name] || []).push(x);
    }
    const out = Object.keys(groups).map((name) => {
      const g = groups[name];
      const ms = g.map((x) => (typeof x.chg === "number" && typeof x.iv30p === "number" && x.iv30p > 0 ? x.chg / (x.iv30p / Math.sqrt(252)) : null));
      const measured = ms.filter((m) => m !== null).length;
      const clean = ms.filter((m, i) => m !== null && !(typeof g[i].ed === "number" && g[i].ed <= 21)).sort((a, b) => a - b);
      let median = null;
      if (clean.length) median = clean.length % 2 ? clean[(clean.length - 1) / 2] : (clean[clean.length / 2 - 1] + clean[clean.length / 2]) / 2;
      const beyond = clean.filter((m) => m > 2 || m < -2).length;
      return { name, total: g.length, measured, n: clean.length, median, beyond: clean.length ? beyond : null };
    });
    out.sort((a, b) => (a.median === null) - (b.median === null) || (a.median === null ? 0 : b.median - a.median) || (a.name < b.name ? -1 : 1));
    return out;
  };
  let worlds = 0, sectors = 0, empties = 0;
  for (let w = 0; w < 300; w++) {
    const rows = [];
    const n = Math.floor(q() * (w % 4 === 0 ? 8 : 90));
    for (let i = 0; i < n; i++) {
      rows.push({ t: "T" + i, chg: q() < 0.06 ? null : Math.round((q() - 0.5) * 0.3 * 1e4) / 1e4, iv30p: q() < 0.08 ? (q() < 0.5 ? null : 0) : Math.round((0.15 + q() * 0.6) * 1e4) / 1e4, sector: NAMES[Math.floor(q() * 6)], ed: q() < 0.2 ? Math.floor(q() * 40) : null });
    }
    if (q() < 0.6) rows.push({ t: "SPY", chg: 0.5, iv30p: 0.2, sector: "Alpha", ed: null });
    if (q() < 0.6) rows.push({ t: "QQQ", chg: -0.5, iv30p: 0.2, sector: "Beta", ed: null });
    const got = M.sectorStats(rows);
    const want = brute(rows);
    worlds++;
    sectors += got.length;
    empties += got.filter((x) => x.median === null).length;
    eq(got.length, want.length, "world " + w + ": the same sectors");
    got.forEach((x, i) => {
      const y = want[i];
      eq(x.name, y.name, "world " + w + ": order position " + i);
      deep([x.total, x.measured, x.n, x.beyond], [y.total, y.measured, y.n, y.beyond], "world " + w + " " + x.name + ": counts");
      if (y.median === null) eq(x.median, null, "world " + w + " " + x.name + ": no median"); else near(x.median, y.median, 1e-12, "world " + w + " " + x.name + ": median");
      eq(x.apart, y.measured - y.n, "world " + w + " " + x.name + ": apart");
      eq(x.share === null, y.n === 0, "world " + w + " " + x.name + ": a share only with figures");
    });
  }
  ok(worlds === 300 && sectors > 600 && empties > 20, "the leaf equals an independent computation over " + worlds + " worlds, " + sectors + " sectors and " + empties + " with no median");
}

{
  near(M.ivDays(-0.031, 0.35), -0.031 * SQRT252 / 0.35, 1e-12, "the definition worked by hand: chg / (iv30p / sqrt(252))");
  near(M.ivDays(-0.031, 0.35), -1.4062, 5e-4, "chg -3.1% on iv30p 35% is -1.4062 IV-days");
  eq(M.signedIvDays(M.ivDays(-0.031, 0.35)), "−1.4", "and prints as minus 1.4");
  eq(M.signedIvDays(M.ivDays(0.0, 0.35)), "0.0", "a flat day prints 0.0 with no sign");
  eq(M.signedIvDays(M.ivDays(0.0231, 0.3)), "+1.2", "a positive move carries a plus");
  near(M.ivDays(0.01, 0.2) * 0.2 / SQRT252, 0.01, 1e-15, "the inverse recovers the change");
  eq(M.ivDays(-0.08, 0.4) < M.ivDays(-0.08, 0.55), true, "a lower prior IV makes the same move more extreme: -3.2 against -2.3");
  near(M.ivDays(-0.08, 0.4), -3.1749, 5e-4, "the plan's worked example: -8% on a 40-point IV is -3.2");
  near(M.ivDays(-0.08, 0.55), -2.3090, 5e-4, "and -2.3 on the post-move 55-point IV");
  eq(M.UNIT, "IV-days", "the unit is IV-days");
  ok(M.registered && targetFor(M.MOVE_ID) && targetFor(M.MOVE_ID).source === "sigma_q1", "the definition names the registered target move.im1.h1");
}

{
  for (const iv of [null, undefined, 0, -0.2, NaN, Infinity, "0.35", {}]) eq(M.ivDays(-0.03, iv), null, `iv30p ${String(iv)} gives no value, never zero`);
  for (const c of [null, undefined, NaN, Infinity, "0.01"]) eq(M.ivDays(c, 0.3), null, `chg ${String(c)} gives no value, never zero`);
  eq(M.moveOf({ t: "AAA", chg: -0.05, iv30p: null }), null, "a name with iv30p null has no move");
  eq(M.moveOf({ t: "AAA", chg: -0.05, iv30p: 0 }), null, "a name with iv30p zero has no move");
  eq(M.moveOf({ t: "AAA", chg: -0.05, iv30p: -1 }), null, "a name with iv30p negative has no move");
  eq(M.moveOf({ t: "", chg: -0.05, iv30p: 0.3 }), null, "a row with no ticker has no move");
  eq(M.moveOf(null), null, "and a null row has none");
  const rows = [
    { t: "NOIV", chg: -0.2, iv30p: null }, { t: "ZERO", chg: 0.3, iv30p: 0 }, { t: "NEG", chg: 0.3, iv30p: -0.4 },
    { t: "OK", chg: 0.03, iv30p: 0.3 },
  ];
  const up = M.rankMoves(rows, "up");
  deep(up.clean.map((x) => x.t), ["OK"], "a name with iv30p null or not positive is absent from the list");
  deep(M.rankMoves(rows, "down").clean.map((x) => x.t), [], "and from the other side");
  const ctx = M.context(rows);
  eq(ctx.ranked, 1, "and from the context population");
}

{
  const rows = [
    { t: "A", chg: -0.08, iv30p: 0.4, iv30: 0.56, im: 0.9, ed: 40 },
    { t: "C", chg: -0.04, iv30p: 0.23, iv30: 0.23, im: 0.05, ed: 40 },
    { t: "D", chg: -0.01, iv30p: 0.3, iv30: 0.3, im: 0.02, ed: 40 },
  ];
  const prior = M.rankMoves(rows, "down").clean.map((x) => x.t);
  deep(prior, ["A", "C", "D"], "THE TIMING FIXTURE: the name whose IV rose 40% after the move ranks on the IV struck at the previous close");
  const wrongCurrent = rows.map((r) => ({ t: r.t, m: M.ivDays(r.chg, r.iv30) })).sort((a, b) => a.m - b.m).map((x) => x.t);
  deep(wrongCurrent, ["C", "A", "D"], "and a build that divides by the current IV ranks it second, so the fixture has teeth");
  near(M.moveOf(rows[0]).m, -3.1749, 5e-4, "its value is the prior-close one");
  const impliedMove = rows.map((r) => ({ t: r.t, m: r.chg / r.im })).sort((a, b) => a.m - b.m).map((x) => x.t);
  ok(impliedMove.join() !== prior.join(), "a build that used implied_move_perc as the unit orders them differently, so the fixture catches it");
  const twin = rows.map((r) => ({ ...r, im: 123 }));
  deep(M.rankMoves(twin, "down").clean.map((x) => x.m), M.rankMoves(rows, "down").clean.map((x) => x.m), "the feed's implied move changes nothing");
  deep(M.rankMoves(rows.map((r) => ({ ...r, iv30: 9 })), "down").clean.map((x) => x.m), M.rankMoves(rows, "down").clean.map((x) => x.m), "and neither does the current IV");
  const src = read("shared/flows-moves0.js");
  ok(!/implied_move|\.im\b|\biv30\b(?!p)/.test(src), "the module never reads the implied move or a current IV");
}

{
  const rows = [
    { t: "CLEAN1", chg: 0.01, iv30p: 0.3, ed: 22 },
    { t: "CLEAN2", chg: 0.002, iv30p: 0.3, ed: null },
    { t: "EDGE", chg: 0.09, iv30p: 0.3, ed: 21 },
    { t: "TODAY", chg: 0.2, iv30p: 0.3, ed: 0 },
    { t: "NEXT", chg: 0.5, iv30p: 0.3, ed: 1 },
  ];
  const up = M.rankMoves(rows, "up");
  deep(up.clean.map((x) => x.t), ["CLEAN1", "CLEAN2"], "a name with ed 21 or fewer is never in the clean list, whatever its size");
  deep(up.apart.map((x) => x.t), ["NEXT", "TODAY", "EDGE"], "it is ranked apart, by its own size");
  eq(M.eventInside(21), true, "ed 21 is inside the window");
  eq(M.eventInside(22), false, "ed 22 is not");
  eq(M.eventInside(null), false, "an unknown ed is not treated as an event");
  eq(M.eventInside({ ed: 21 }), true, "a row is read the same way as its ed");
  eq(M.eventInside({ ed: null, rd: 0 }), true, "a name that reported on the session is an event: its move is the report's");
  eq(M.eventInside({ ed: null, rd: 1 }), true, "and so is one that reported the session before, whose move still carries the drift");
  eq(M.eventInside({ ed: null, rd: 2 }), false, "but not one that reported two sessions before");
  eq(M.eventInside({ ed: null, rd: 1 }, 21, 1), false, "a day later the same row has aged out of the window");
  eq(M.eventInside({ ed: 21, rd: null }, 21, 1), true, "and a report 21 sessions out is 20 sessions out a day later");
  eq(M.eventInside({ ed: 22, rd: null }, 21, 1), true, "which brings a 22 inside it");
  eq(M.eventInside({ ed: 22, rd: null }), false, "where it was outside");
  eq(M.eventInside({ ed: null, rd: null, rdMax: 2 }), true, "a report of unstated time that may be one session old is an event");
  eq(M.eventInside({ ed: null, rd: null, rdMax: 3 }), false, "and one that is at least two old is not");
  eq(M.eventInside({}), false, "a row with neither is not");
  eq(M.moveOf(rows[2]).grade, 0, "an event name is grade 0");
  eq(M.moveOf(rows[0]).grade, 1, "a clean name is grade 1");
  const ctx = M.context(rows);
  eq(ctx.apart, 3, "the context counts the names set apart");
  eq(ctx.ranked, 2, "and ranks only the clean names");
}

{
  const rows = [
    { t: "P", chg: 0.1, iv30p: 0.3 },
    { t: "Q", chg: -0.02, iv30p: 0.2 },
    { t: "R", chg: 0.001, iv30p: 0.25 },
    { t: "S", chg: 0.06, iv30p: 0.18 },
  ];
  const ms = rows.map((r) => Math.abs(r.chg * SQRT252 / r.iv30p)).sort((a, b) => a - b);
  const want = (ms[1] + ms[2]) / 2;
  const ctx = M.context(rows);
  near(ctx.median, want, 1e-12, "the median |m| is the median of the prior-close IV-days");
  eq(ctx.beyond, 2, "and the names beyond 3 are counted strictly");
  eq(M.context([{ t: "X", chg: 3 * 0.3 / SQRT252, iv30p: 0.3 }]).beyond, 0, "a move of exactly 3 is not beyond 3");
  const wrong = rows.map((r) => Math.abs(r.chg * SQRT252 / (r.iv30p * 1.4))).sort((a, b) => a - b);
  ok(Math.abs((wrong[1] + wrong[2]) / 2 - ctx.median) > 0.1, "a median on a current IV 40% higher differs, so the fixture has teeth");
  eq(M.contextLine(ctx), `Median |m| ${want.toFixed(1)} IV-days; 2 of 4 beyond 3.`, "the line reads as the plan words it");
  eq(M.contextLine(M.context([])), null, "an empty population prints no line");
  eq(M.median([]), null, "an empty median is null");
  eq(M.median([3, 1, 2]), 2, "an odd median");
  eq(M.median([4, 1, 2, 3]), 2.5, "an even median");
}

{
  const rows = [
    { t: "U1", chg: 0.01, iv30p: 0.3 }, { t: "U2", chg: 0.04, iv30p: 0.3 }, { t: "U3", chg: 0.04, iv30p: 0.3 },
    { t: "D1", chg: -0.03, iv30p: 0.3 }, { t: "D2", chg: -0.05, iv30p: 0.3 }, { t: "Z", chg: 0, iv30p: 0.3 },
  ];
  deep(M.rankMoves(rows, "up").clean.map((x) => x.t), ["U2", "U3", "U1"], "risers run largest first and ties break by ticker");
  deep(M.rankMoves(rows, "down").clean.map((x) => x.t), ["D2", "D1"], "fallers run most negative first");
  ok(!M.rankMoves(rows, "up").clean.some((x) => x.t === "Z") && !M.rankMoves(rows, "down").clean.some((x) => x.t === "Z"), "a flat name is on neither list");
  deep(M.rankMoves(null, "up"), { clean: [], apart: [] }, "no rows rank to empty lists");
}

{
  const forbidden = new RegExp("\\b(?:" + M.FORBIDDEN_WORDS.join("|") + ")\\w*", "i");
  const lines = [...M.HEADER_SENTENCES, M.contextLine({ median: 0.6, beyond: 14, ranked: 640 })];
  for (const s of lines) {
    ok(M.wordCount(s) <= M.HEADER_WORDS_MAX, `"${s}" has ${M.wordCount(s)} words, at most ${M.HEADER_WORDS_MAX}`);
    ok(!forbidden.test(s), `"${s}" uses none of unusual, alert, screen or rare`);
  }
  eq(M.LINE, "A ranking, not a test: no error rate measured.", "the one line of copy is the plan's");
  eq(M.CAPTION, "IV as of the previous close.", "and the caption names the IV used");
  ok(forbidden.test("a rare move") && forbidden.test("Unusual") && forbidden.test("screened") && forbidden.test("alerts"), "the lint catches each forbidden word and its forms");
  deep(M.FORBIDDEN_WORDS.slice().sort(), ["alert", "rare", "screen", "unusual"], "the forbidden list is the plan's four");
}

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const TUE_1330 = Date.parse("2026-09-29T13:30:00-04:00");
const RTH = { phase: "rth", session: "2026-09-29", trading: true, lastClosed: "2026-09-28", endsAt: "2026-09-29T20:00:00.000Z" };
const iso = (ms) => new Date(ms).toISOString();
let NOW = TUE_1330;

const stamp = () => ({ readAt: iso(NOW - 60000), session: "2026-09-29", cadenceS: 900, liveUntil: iso(NOW + 1140000), staleAt: iso(NOW + 2640000), source: "actions", updatedAt: 1 });
const entry = (payload, upd = 1) => (payload ? { status: "ok", payload, updatedAt: upd, fresh: { state: "live", reason: "cadence", klass: "breadth", ...stamp(), updatedAt: upd } } : { status: "pending" });

async function mount(page, { html, url, answer }) {
  const asked = [];
  page._asked = asked;
  NOW = TUE_1330;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = decodeURIComponent(u.pathname.slice("/api/flows/".length) + u.search);
      asked.push(key);
      const a = answer(key, u) || { body: { status: "pending" } };
      return route.fulfill({ status: a.status || 200, contentType: "application/json", headers: { "X-Server-Now": String(NOW), ...(a.headers || {}) }, body: JSON.stringify(a.body) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  page._inflight = 0;
  const done = (r) => { if (/\/api\/flows\//.test(r.url())) page._inflight--; };
  page.on("request", (r) => { if (/\/api\/flows\//.test(r.url())) page._inflight++; });
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  await page.clock.install({ time: new Date(TUE_1330) });
  await page.goto("https://example.test" + url);
  if (/flows\/market/.test(url)) await page.click("#mkT-extremes");
  await settle(page);
}

const settle = async (page) => {
  await page.waitForTimeout(150);
  for (let i = 0; i < 200 && page._inflight > 0; i++) await page.waitForTimeout(50);
  await page.waitForTimeout(150);
};
const tick = async (page, ms) => { NOW += ms; await page.clock.runFor(ms); await settle(page); };

const FIELDS = ["px", "prev", "chg", "iv30", "iv30p", "im"];
const ROSTER = [
  { t: "AAA", chg: -0.08, iv30: 0.56, iv30p: 0.4, im: 0.9, ed: 40 },
  { t: "CCC", chg: -0.04, iv30: 0.23, iv30p: 0.23, im: 0.05, ed: 40 },
  { t: "DDD", chg: -0.01, iv30: 0.3, iv30p: 0.3, im: 0.02, ed: null },
  { t: "UUU", chg: 0.05, iv30: 0.25, iv30p: 0.25, im: 0.4, ed: 30 },
  { t: "VVV", chg: 0.02, iv30: 0.3, iv30p: 0.3, im: 0.9, ed: 40 },
  { t: "NOIV", chg: 0.09, iv30: 0.3, iv30p: null, im: 0.01, ed: 40 },
  { t: "ZERO", chg: -0.05, iv30: 0.3, iv30p: 0, im: 0.01, ed: 40 },
  { t: "EVT", chg: -0.2, iv30: 0.6, iv30p: 0.3, im: 0.5, ed: 5 },
];
const stripsOf = (rows, session = "2026-09-29") => ({
  v: 1, key: "live:strips", status: "ok", session, fields: FIELDS,
  rows: Object.fromEntries(rows.map((r) => [r.t, [100, 100 / (1 + r.chg), r.chg, r.iv30, r.iv30p, r.im]])),
  fresh: { readAt: iso(NOW - 60000), session, cadenceS: 900, source: "actions", writer: "flows-live" },
});
const universeOf = (rows, { day = "2026-09-28", iv = false } = {}) => ({
  status: "ok", v: 1, sessionDate: day, generatedAt: iso(TUE_1330 - 20 * 3600000), n: rows.length, screened: rows.length,
  hz: HORIZON_SESSIONS, ahead: aheadOf(day),
  t: rows.map((r) => r.t),
  cols: { chg: rows.map((r) => Math.round(r.chg * 1e4)), ed: rows.map((r) => r.ed), ...(rows.some((r) => r.rd !== undefined) ? { rd: rows.map((r) => (r.rd === undefined ? null : r.rd)) } : {}), ...(iv ? { iv30p: rows.map((r) => (r.iv30p === null || r.iv30p === undefined ? null : Math.round(r.iv30p * 1e3))) } : {}) },
  units: { chg: ["fraction", 1e4], ed: ["sessions", 1], ...(rows.some((r) => r.rd !== undefined) ? { rd: ["sessions", 1] } : {}), ...(iv ? { iv30p: ["vol", 1e3] } : {}) },
});
const MOVERS = {
  status: "ok", sessionDate: "2026-09-28", universe: 600, ranked: 590, priced: 500, unrankedChange: 10, unrankedPremium: 100,
  risers: [{ t: "RAWUP", chg: 0.2 }, { t: "RAWUP2", chg: 0.1 }], fallers: [{ t: "RAWDN", chg: -0.2 }],
  premium: { bullish: [{ t: "CALL", netPrem: 5e6 }], bearish: [{ t: "PUT", netPrem: -5e6 }] },
};

const NUM = (t) => t.replace(/−/g, "-");
const forbidden = new RegExp("\\b(?:" + M.FORBIDDEN_WORDS.join("|") + ")", "i");

const marketAnswer = (state) => (key) => {
  if (key.startsWith("movers")) return { body: MOVERS };
  if (key === "universe") return { body: universeOf(state.universe || ROSTER, state.uniOpts || {}) };
  if (key.startsWith("lk?k=")) {
    const ks = key.slice(5).split(",");
    if (ks.length === 1) return ks[0] === "strips" && state.strips ? { body: state.strips } : null;
    return { body: { serverNow: NOW, phase: RTH, keys: Object.fromEntries(ks.map((k) => [k, k === "strips" && state.strips ? entry(state.strips, state.upd) : entry(null)])) } };
  }
  if (key.startsWith("now")) return { body: { serverNow: NOW, expected: "2026-09-28", phase: RTH, keys: { "live:strips": { state: "live", reason: "cadence", klass: "breadth", ...stamp(), updatedAt: state.upd } } } };
  return null;
};

const readLists = (page) => page.evaluate(() => {
  const cols = [...document.querySelectorAll("#mktMovers .mk-movers-col")];
  const one = (c) => ({
    head: (c.querySelector(".mk-movers-h") || {}).textContent,
    clean: [...c.querySelectorAll(":scope > ul.mk-movers:not(.is-apart) li")].map((li) => [li.querySelector(".mk-mv-t").textContent, li.querySelector(".mk-mv-v").textContent]),
    apart: [...c.querySelectorAll(":scope > ul.is-apart li")].map((li) => [li.querySelector(".mk-mv-t").textContent, li.querySelector(".mk-mv-v").textContent]),
    apartCaption: (c.querySelector(".mk-apart") || {}).textContent || null,
  });
  const seg = [...document.querySelectorAll("#mktMovers .mk-lens .ui-seg-i")].map((b) => [b.textContent, b.getAttribute("aria-selected")]);
  const notes = [...document.querySelectorAll("#mktMovers .mk-lens-note p")].map((p) => p.textContent);
  return { cols: cols.map(one), seg, notes, text: document.getElementById("mktMovers").textContent };
});

const expectedLists = (rows) => {
  const moves = rows.map((r) => ({ t: r.t, chg: r.chg, iv30p: r.iv30p, ed: r.ed }));
  return { up: M.rankMoves(moves, "up"), down: M.rankMoves(moves, "down"), ctx: M.contextLine(M.context(moves)) };
};
const shape = (x) => x.map((m) => [m.t, NUM(M.signedIvDays(m.m))]);

const browser = revealBelow(await chromium.launch());
try {
  {
    const state = { strips: stripsOf(ROSTER), upd: 1 };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    const want = expectedLists(ROSTER);
    deep(got.seg, [["Raw change", "false"], ["In IV-days", "true"]], "THE OWNER'S ACCOUNT OPENS ON IV-DAYS");
    deep(got.cols[0].clean.map((r) => [r[0], NUM(r[1])]), shape(want.up.clean), "Risers are the roster's rows ranked by the move against the prior-close IV");
    deep(got.cols[1].clean.map((r) => [r[0], NUM(r[1])]), shape(want.down.clean), "Fallers likewise, in the leaf's order and to the leaf's digit");
    deep(got.cols[1].clean.map((r) => r[0]), ["AAA", "CCC", "DDD"], "THE TIMING FIXTURE ON THE PAGE: the name whose IV rose 40% after the move ranks first, on the IV struck at the previous close");
    deep(got.cols[0].clean.map((r) => r[0]), ["UUU", "VVV"], "Risers: only names with a prior-close IV");
    ok(![...got.cols[0].clean, ...got.cols[1].clean, ...got.cols[0].apart, ...got.cols[1].apart].some((r) => ["NOIV", "ZERO"].includes(r[0])), "a name with iv30p null or zero is on no list, never a zero (NOIV, the largest raw riser, is absent)");
    deep(got.cols[1].apart.map((r) => r[0]), ["EVT"], "a name with earnings inside 30 days is ranked apart");
    ok(!got.cols[1].clean.some((r) => r[0] === "EVT"), "and never beside the clean names");
    eq(got.cols[1].apartCaption, M.APART, "under the caption that says why");
    eq(got.notes[0], want.ctx, "THE MEDIAN LINE is computed on the prior-close IV, by the leaf's arithmetic");
    eq(got.notes[1], "Live roster, session 2026-09-29: 6 names.", "the source and the population are named");
    eq(got.notes[2], M.CAPTION + " " + M.LINE, "and the caption names the IV and the line says it is a ranking, not a test");
    eq(got.notes[3], M.GRADE_NOTE, "and the grade is said once: the IV is the 30-day IV, with no surface");
    ok(page._asked.some((k) => /^now\?.*strips/.test(k)), "the owner's heartbeat reads the live rows from the first beat");
    for (const n of got.notes) ok(!forbidden.test(n), `"${n}" uses none of the forbidden words`);
    ok(M.wordCount(got.notes[0]) <= M.HEADER_WORDS_MAX, "and the context line is within 14 words");
    ok(!forbidden.test(got.text.replace(/screened/g, "")), "the module's text uses none of unusual, alert, screen or rare");
    ok(!/RAWUP|RAWDN/.test(got.cols[0].clean.concat(got.cols[1].clean).flat().join(" ")), "no raw-change name leaks into the IV-days lists");
    ok(got.cols[2].head.includes("Calls") && got.cols[3].head.includes("Puts"), "Calls and Puts are untouched");

await showTab(page, "#mktMovers");
    await page.click("#mktMovers .mk-lens .ui-seg-i:nth-child(2)");
    await page.waitForFunction(() => !document.querySelector("#mktMovers li[data-t]"), null, { timeout: 15000 });
    await settle(page);
    const raw = await readLists(page);
    deep(raw.seg, [["Raw change", "true"], ["In IV-days", "false"]], "the switch goes back to raw change");
    const rawNames = await page.evaluate(() => [...document.querySelectorAll("#mktMovers .mk-movers-col")].map((c) => [...c.querySelectorAll("li .mk-mv-t")].map((n) => n.textContent)));
    deep(rawNames.slice(0, 2), [["RAWUP", "RAWUP2"], ["RAWDN"]], "MARKET'S EXTREMES KEEPS ITS RAW LISTS when the lens is off");
    eq(raw.notes.length, 0, "and prints none of the IV-days copy");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }

  {
    const state = { strips: stripsOf(ROSTER), upd: 1 };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "member", owner: false }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    deep(got.seg, [["Raw change", "true"], ["In IV-days", "false"]], "MEMBERS OPEN ON RAW CHANGE");
    ok(!page._asked.some((k) => /^lk\?k=.*strips/.test(k)), "and the live rows are not fetched for a lens nobody asked for");
    ok(page._asked.some((k) => /^now\?/.test(k)) && !page._asked.some((k) => /^now\?.*strips/.test(k)), "THE HEARTBEAT OF A MEMBER WITH THE LENS OFF does not read live:strips, so that key cannot move the pill of a page that does not use it");
await showTab(page, "#mktMovers");
    await page.click("#mktMovers .mk-lens .ui-seg-i:nth-child(3)");
    await page.waitForSelector("#mktMovers li[data-t]", { timeout: 15000 });
    await settle(page);
    ok(page._asked.some((k) => /^now\?.*strips/.test(k)), "and choosing IV-days adds it to the heartbeat");
    const on = await readLists(page);
    ok(page._asked.some((k) => k === "lk?k=strips"), "choosing IV-days reads the live rows once");
    deep(on.cols[1].clean.map((r) => r[0]), ["AAA", "CCC", "DDD"], "and ranks them");
    await page.close();
  }

  {
    const state = { strips: stripsOf(ROSTER), upd: 1 };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const order = async () => (await readLists(page)).cols[1].clean.map((r) => r[0]);
    deep(await order(), ["AAA", "CCC", "DDD"], "before the update");
    const moved = ROSTER.map((r) => (r.t === "DDD" ? { ...r, chg: -0.3 } : r));
    state.strips = stripsOf(moved);
    state.upd = 2;
    await page.hover("#mktMovers .mk-movers-col:nth-child(2) li");
    await tick(page, 31000);
    ok(page._asked.filter((k) => k === "lk?k=strips").length >= 1, "the heartbeat reads the changed live rows");
    deep(await order(), ["AAA", "CCC", "DDD"], "THE ORDER IS HELD while the pointer is on the list, though DDD now leads");
    await page.mouse.move(2, 2);
    await settle(page);
    deep(await order(), ["DDD", "AAA", "CCC"], "and it moves when the pointer leaves");
    await page.close();
  }

  {
    const state = { strips: null, upd: 1, uniOpts: { iv: false } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    await tick(page, 5000);
    const got = await readLists(page);
    eq(page._asked.filter((k) => /^lk\?k=.*strips/.test(k) && !k.includes("market")).length, 1, "WITH THE LIVE ROWS PENDING the lens asks for them once and does not loop on the answer");
    ok(got.cols[0].clean.length === 0 && got.cols[1].clean.length === 0, "and ranks nothing");
    eq(await page.evaluate(() => document.querySelectorAll("#mktMovers .mk-movers-col")[0].querySelectorAll(".ui-silent").length), 1, "saying so in place of the list, not a zero");
    await page.close();
  }

  {
    const EDGE = [
      { t: "E21", chg: -0.1, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 21 },
      { t: "E22", chg: -0.09, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 22 },
      { t: "E0", chg: -0.08, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 0 },
      { t: "U21", chg: 0.1, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 21 },
      { t: "U22", chg: 0.09, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 22 },
    ];
    const state = { strips: stripsOf(EDGE, "2026-09-29"), upd: 1, universe: EDGE, uniOpts: { day: "2026-09-29", iv: true } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    deep(got.cols[1].clean.map((r) => r[0]), ["E22"], "A NAME 22 SESSIONS FROM EARNINGS is among the clean names");
    deep(got.cols[1].apart.map((r) => r[0]), ["E21", "E0"], "and one 21 sessions from them is ranked apart, as is one reporting today");
    deep(got.cols[0].clean.map((r) => r[0]), ["U22"], "on the risers' side likewise");
    deep(got.cols[0].apart.map((r) => r[0]), ["U21"], "ed 21 never ranks beside the clean names");
    await page.close();
  }

  {
    const LIVE = [
      { t: "E21", chg: -0.1, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 21 },
      { t: "E22", chg: -0.09, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 22 },
      { t: "E23", chg: -0.085, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 23 },
      { t: "E0", chg: -0.08, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 0 },
      { t: "R0", chg: -0.07, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: null, rd: 0 },
      { t: "R1", chg: -0.06, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: null, rd: 1 },
      { t: "R2", chg: -0.05, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: null, rd: 2 },
      { t: "U22", chg: 0.09, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 22 },
      { t: "U23", chg: 0.08, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 23 },
    ];
    const state = { strips: stripsOf(LIVE), upd: 1, universe: LIVE };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    deep(got.cols[1].clean.map((r) => r[0]), ["E23", "R1", "R2"], "ONE SESSION AFTER THE NIGHTLY a report 23 sessions out is 22 away and clean, as are names that reacted two or more sessions ago, R1 having aged out of the window");
    deep(got.cols[1].apart.map((r) => r[0]), ["E21", "E22", "E0"], "while 22 is now inside the window and a report due on the nightly's own session has reacted, the three largest being listed");
    deep(got.cols[0].clean.map((r) => r[0]), ["U23"], "the risers' side moves the same way");
    deep(got.cols[0].apart.map((r) => r[0]), ["U22"], "a rise 22 sessions out is ranked apart a session later");
    deep(LIVE.filter((r) => M.eventInside(r, 21, 1)).map((r) => r.t).sort(), ["E0", "E21", "E22", "R0", "U22"], "which is the leaf's reading of the same rows one session on");
    await page.close();
  }

  {
    const TAIL = [
      { t: "TA1", chg: -0.15, iv30p: 0.3, ed: 30 }, { t: "TA2", chg: 0.12, iv30p: 0.28, ed: null }, { t: "TA3", chg: -0.02, iv30p: 0.35, ed: 60 },
      { t: "TA4", chg: 0.3, iv30p: 0.45, ed: 3 }, { t: "TA5", chg: 0.07, iv30p: null, ed: 50 },
    ];
    const ALL = ROSTER.concat(TAIL);
    const state = { strips: stripsOf(ROSTER, "2026-09-29"), upd: 1, universe: ALL, uniOpts: { day: "2026-09-29", iv: true } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    const want = expectedLists(ALL);
    deep(got.cols[1].clean.map((r) => r[0]), want.down.clean.map((m) => m.t).slice(0, 8), "AFTER THE NIGHTLY LANDS the lens ranks the whole universe, names outside the roster included");
    ok(got.cols[1].clean.some((r) => r[0] === "TA1") && got.cols[0].clean.some((r) => r[0] === "TA2"), "TA1 and TA2 are not roster names and rank");
    deep(got.cols[0].apart.map((r) => r[0]), ["TA4"], "a tail name with earnings in 3 sessions is ranked apart");
    ok(![...got.cols[0].clean, ...got.cols[1].clean].some((r) => r[0] === "TA5"), "and one with no prior-close IV is absent");
    eq(got.notes[0], want.ctx, "the median line is over the whole population, on the prior-close IV");
    eq(got.notes[1], "Nightly, session 2026-09-29: " + (ALL.length - 3) + " names.", "and names its source and population");
    await page.close();
  }

  {
    const TAIL = [{ t: "TA1", chg: -0.15, iv30p: 0.3, ed: 30 }];
    const state = { strips: stripsOf(ROSTER, "2026-09-29"), upd: 1, universe: ROSTER.concat(TAIL), uniOpts: { day: "2026-09-28", iv: true } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    ok(!got.cols[1].clean.some((r) => r[0] === "TA1"), "DURING THE SESSION yesterday's tail is never ranked beside today's roster");
    eq(got.notes[1], "Live roster, session 2026-09-29: " + (ROSTER.length - 2) + " names.", "the live rows are ranked alone and the source is named");
    await page.close();
  }

  {
    const state = { strips: null, upd: 1, universe: ROSTER, uniOpts: { day: "2026-09-28", iv: true } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    await tick(page, 5000);
    const got = await readLists(page);
    deep(got.cols[1].clean.map((r) => r[0]), ["AAA", "CCC", "DDD"], "WITH THE LIVE ROWS UNAVAILABLE the nightly's rows are ranked and say so");
    eq(got.notes[1], "Nightly, session 2026-09-28: " + (ROSTER.length - 2) + " names.", "under the nightly's session");
    eq(page._asked.filter((k) => k === "lk?k=strips").length, 1, "and the live rows were asked for once");
    await page.close();
  }

  {
    const NIGHT = "2026-09-28";
    const focus = {
      status: "ok", sessionDate: NIGHT, generatedAt: iso(TUE_1330 - 20 * 3600000), readAt: iso(TUE_1330 - 20 * 3600000),
      fields: ["px", "prev", "chg", "net", "lean", "iv30"],
      groups: [{ id: "mag7", kind: "leaders", label: "Mag 7", tickers: ["AAA", "CCC", "NOIV"], lead: "AAA" }],
      rows: { AAA: [92, 100, -0.08, 1e6, 0.1, 0.56], CCC: [96, 100, -0.04, 2e6, 0.2, 0.23], NOIV: [109, 100, 0.09, 1e6, 0.1, 0.3] },
      closes: { AAA: [100, 92], CCC: [100, 96], NOIV: [100, 109] },
    };
    const proj = {
      status: "ok", v: 1, sessionDate: NIGHT, generatedAt: iso(TUE_1330 - 20 * 3600000), n: 3, projection: ["chg", "ed", "iv30p", "sec", "t"], absent: [], hz: HORIZON_SESSIONS, ahead: aheadOf(NIGHT),
      t: ["AAA", "CCC", "NOIV"], sectors: ["Tech"], sec: [0, 0, 0],
      cols: { chg: [-800, -400, 900], iv30p: [400, 230, null], ed: [4, 40, 40] },
      units: { chg: ["fraction", 1e4], iv30p: ["vol", 1e3], ed: ["sessions", 1] },
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, {
      html: PAGES.overviewPage({ username: "test" }), url: "/flows/#view=focus",
      answer: (key) => (key.startsWith("focus") ? { body: focus } : key.startsWith("universe?cols=") ? { body: proj }
        : key.startsWith("now") ? { body: { serverNow: NOW, expected: NIGHT, phase: RTH, keys: {} } } : null),
    });
    await page.waitForSelector("#ccLeaders a[data-ticker] .hm-qd", { timeout: 15000 });
    await settle(page);
    const got = await page.evaluate(() => ({
      head: document.querySelector("#ccLeaders .hm-qhead").textContent,
      rows: Object.fromEntries([...document.querySelectorAll("#ccLeaders a.hm-qrow")].map((r) => [r.dataset.ticker, { d: r.querySelector(".hm-qd").firstChild.textContent, e: Boolean(r.querySelector(".hm-qd-e")), iv: r.querySelector(".hm-qiv").textContent }])),
    }));
    ok(got.head.endsWith("IV-days"), "Home's Leaders gain an IV-days column beside IV 30d");
    eq(NUM(got.rows.AAA.d), NUM(M.signedIvDays(M.ivDays(-0.08, 0.4))), "AAA: its nightly day change over the IV struck at the previous close, -3.2");
    eq(got.rows.AAA.e, true, "AAA reports in 4 sessions, so its value carries the event mark");
    eq(NUM(got.rows.CCC.d), NUM(M.signedIvDays(M.ivDays(-0.04, 0.23))), "CCC likewise");
    eq(got.rows.CCC.e, false, "and its earnings are 40 sessions away, so no mark");
    eq(got.rows.NOIV.d, "—", "a name with no prior-close IV is a dash, never 0.0");
    eq(got.rows.AAA.iv, "56.0%", "the existing IV 30d column still prints the current IV");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }

  {
    const NIGHT = "2026-09-28";
    const names = ["AAA", "CCC", "UUU", "NOIV", "E21", "E23"];
    const focus = {
      status: "ok", sessionDate: NIGHT, generatedAt: iso(TUE_1330 - 20 * 3600000), readAt: iso(TUE_1330 - 20 * 3600000),
      fields: ["px", "prev", "chg", "net", "lean", "iv30"],
      groups: [{ id: "mag7", kind: "leaders", label: "Mag 7", tickers: names, lead: "AAA" }],
      rows: Object.fromEntries(names.map((t) => [t, [100, 100, 0, 0, 0, 0.3]])), closes: Object.fromEntries(names.map((t) => [t, [100, 100]])),
    };
    const strips = stripsOf(ROSTER.filter((r) => names.includes(r.t)).concat([
      { t: "E21", chg: -0.05, iv30: 0.3, iv30p: 0.25, im: 0.1 }, { t: "E23", chg: -0.05, iv30: 0.3, iv30p: 0.25, im: 0.1 },
    ]));
    const proj = {
      status: "ok", v: 1, sessionDate: NIGHT, n: 6, projection: ["chg", "ed", "iv30p", "sec", "t"], absent: [], hz: HORIZON_SESSIONS, ahead: aheadOf(NIGHT),
      t: names, sectors: ["Tech"], sec: [0, 0, 0, 0, 0, 0],
      cols: { chg: [0, 0, 0, 0, 0, 0], iv30p: [111, 111, 111, 111, 111, 111], ed: [40, 40, 40, 40, 21, 23] }, units: { chg: ["fraction", 1e4], iv30p: ["vol", 1e3], ed: ["sessions", 1] },
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, {
      html: PAGES.overviewPage({ username: "test" }), url: "/flows/#view=focus",
      answer: (key) => {
        if (key.startsWith("focus")) return { body: focus };
        if (key.startsWith("universe?cols=")) return { body: proj };
        if (key.startsWith("lk?k=")) {
          const ks = key.slice(5).split(",");
          return { body: { serverNow: NOW, phase: RTH, keys: Object.fromEntries(ks.map((k) => [k, k === "strips" ? entry(strips) : entry(null)])) } };
        }
        if (key.startsWith("now")) return { body: { serverNow: NOW, expected: NIGHT, phase: RTH, keys: {} } };
        return null;
      },
    });
    await page.waitForSelector("#ccLeaders a[data-ticker] .hm-qd", { timeout: 15000 });
    await settle(page);
    const got = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#ccLeaders a.hm-qrow")].map((r) => [r.dataset.ticker, [r.dataset.src, r.querySelector(".hm-qd").firstChild.textContent, Boolean(r.querySelector(".hm-qd-e"))]])));
    eq(got.AAA[0], "live", "the live rows are read as live");
    eq(NUM(got.AAA[1]), NUM(M.signedIvDays(M.ivDays(-0.08, 0.4))), "and a live row divides by the strip's own prior-close IV, not the nightly column's 11.1 points nor the current IV");
    eq(NUM(got.UUU[1]), NUM(M.signedIvDays(M.ivDays(0.05, 0.25))), "UUU likewise");
    eq(got.NOIV[0], "live", "NOIV is read from the live rows");
    eq(got.NOIV[1], "—", "A LIVE ROW WITH NO STRIP IV is a dash: last night's 11.1 points are never paired with today's change");
    eq(got.E21[2], true, "a name 21 sessions from earnings at the nightly is 20 away on the live session and carries the event mark");
    eq(got.E23[2], false, "and one 23 sessions from them, 22 away on the live session, does not");
    eq(NUM(got.E23[1]), NUM(M.signedIvDays(M.ivDays(-0.05, 0.25))), "E23 is read on its strip IV");
    await page.close();
  }
} finally {
  await browser.close();
}

{
  const { applyTransforms, absolutise } = await import("./truth/mutants.mjs");
  const leafPath = ROOT + "shared/flows-moves0.js";
  const leafSource = read("shared/flows-moves0.js");
  const zFailures = (Z) => {
    const bad = [];
    const note = (c, m) => { if (!c) bad.push(m); };
    note(Math.abs(Z(0.097, 0.032) - Math.log(1.097) / 0.032) < 1e-12 && Math.abs(Z(0.097, 0.032) - 2.8931) < 1e-3, "+9.7% on a 3.2% typical day is 2.893 typical days, not 3.03");
    note(Math.abs(Z(-0.095, 0.032) - Math.log(0.905) / 0.032) < 1e-12 && Math.abs(Z(-0.095, 0.032) + 3.1196) < 1e-3, "-9.5% on a 3.2% typical day is -3.120 typical days, not -2.97");
    note(Math.abs(Z(Math.expm1(0.05), 0.02) - 2.5) < 1e-12 && Math.abs(Z(Math.expm1(-0.05), 0.02) + 2.5) < 1e-12, "a log move of 2.5 typical days in either direction is plus and minus 2.5");
    note(Z(0, 0.02) === 0, "a flat day is zero typical days");
    for (const c of [-1, -1.5, null, undefined, NaN, Infinity, "0.01"]) note(Z(c, 0.02) === null, `a change of ${String(c)} has no log return and no typical days`);
    for (const s of [0, -0.01, null, undefined, NaN, "0.02"]) note(Z(0.01, s) === null, `a typical day of ${String(s)} gives no typical days`);
    return bad;
  };
  deep(zFailures(M.zOf), [], "the typical days of a move are its log return over the typical day, the scale the nightly counts and the scale itself are on");
  const mutated = (transforms) => import("data:text/javascript;base64," + Buffer.from(absolutise(applyTransforms(leafSource, transforms, "moves0"), path.dirname(leafPath))).toString("base64"));
  for (const [why, transforms] of [
    ["the simple change over the typical day", [["return Math.log1p(c) / s;", "return c / s;"]]],
    ["the log return with the sign dropped", [["return Math.log1p(c) / s;", "return Math.abs(Math.log1p(c)) / s;"]]],
    ["a total loss read as a number", [["|| !(c > -1)) return null;", ") return null;"]]],
  ]) {
    const leaf = await mutated(transforms);
    ok(zFailures(leaf.zOf).length > 0, `the typical-days checks fail the planted build "${why}"`);
  }
}

console.log(`✓ flows-moves0: ${checks} assertions — the IV-days definition worked by hand, the timing fixture ranked on the previous close's IV in the leaf and on the page, a current-IV build and an implied-move build caught, earnings names ranked apart, absent IV never zero, the median line on the prior-close IV, the copy lint, the owner and member defaults, raw lists kept when the lens is off, the order held under the pointer, and Home's Leaders column`);

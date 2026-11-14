import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMutated } from "./truth/mutants.mjs";
import * as REAL from "../shared/flows-flowlab.js";
import { horizonEnd } from "../shared/flows-calendar.js";
import * as COPY from "../shared/flows-flowlab-copy.js";
import { lintText, tooLong } from "./lib/copy-lint.mjs";
import * as BUILD from "../server/flowlab.js";
import { flowlabBody } from "../shared/flows-page-flowlab.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const FX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures-flowlab.json"), "utf8"));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const N = FX.worlds.normal;
const T = FX.worlds.thin;

const centsText = (s) => {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(s));
  const whole = BigInt(m[2]) * 100n;
  const frac = BigInt(((m[3] || "") + "00").slice(0, 2));
  const rest = (m[3] || "").slice(2);
  let c = whole + frac;
  if (rest && (rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1))) || (rest[0] === "5" && c % 2n === 1n))) c += 1n;
  return Number(m[1] ? -c : c);
};

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function screenRow(over = {}) {
  return {
    ask_side_volume: 100, avg_price: "5.00", bid_side_volume: 50, chain_prev_close: "4.00", close: "5.00", cross_volume: 0, er_time: "premarket",
    expiry: "2026-11-20", floor_volume: 0, high: "5", last_fill: "2026-10-23 19:41:12.000000+00", low: "4", mid_volume: 20, multileg_volume: 0,
    next_earnings_date: "2026-11-05", no_side_volume: 30, open: "4", open_interest: 400, option_symbol: "SYX101261120C00120000", option_type: "call",
    premium: "300000.00", sector: "Technology", stock_multi_leg_volume: 0, stock_price: "118.40", strike: "120.00", sweep_volume: 40, ticker_vol: 4000,
    total_ask_changes: 0, total_bid_changes: 0, trades: 20, volume: 200, ...over,
  };
}

const screen = (L, rows, ctx = {}) => L.reduceScreen({ data: rows }, { session: FX.session, preset: "premium", asOf: "2026-10-23T20:00:00Z", ...ctx });

function minuteRow(i, va, vb, vm, vn) {
  const t = new Date(Date.UTC(2026, 9, 23, 13, 30 + i)).toISOString().replace(".000", "");
  return {
    avg_price: "1.00", close: "1.00", expiry: FX.expiry, high: "1.00", iv_high: "0.5", iv_low: "0.4", low: "1.00", open: "1.00", option_symbol: FX.contract,
    premium_ask_side: "0", premium_bid_side: "0", premium_mid_side: "0", premium_no_side: "0", start_time: t,
    volume_ask_side: va, volume_bid_side: vb, volume_mid_side: vm, volume_multi: 0, volume_no_side: vn, volume_stock_multi: 0,
  };
}

function profileRow(price, v, over = {}) {
  return { ask_vol: 0, bid_vol: 0, cross_vol: 0, date: FX.session, floor_vol: 0, mid_vol: 0, multi_vol: 0, price, sweep_vol: 0, transactions: 1, volume: v, ...over };
}

function battery(L) {
  const bad = [];
  const need = (cond, tag) => { if (!cond) bad.push(tag); };
  const safe = (tag, f) => { try { f(); } catch (e) { bad.push(tag + " threw " + String(e && e.message).slice(0, 80)); } };

  safe("osi", () => {
    const p = L.parseOsi("TSLA230526P00167500");
    need(p && p.root === "TSLA" && p.expiry === "2023-05-26" && p.cp === "p" && p.strike === 167.5 && p.milli === 167500, "osi: the documented example parses");
    need(L.osiOf("tsla", "2023-05-26", "P", 167.5) === "TSLA230526P00167500", "osi: built from parts");
    need(L.parseOsi("TSLA230526P0167500") === null, "osi: a 7-digit strike is refused");
    need(L.parseOsi("tsla230526P00167500") === null, "osi: a lowercase root is refused");
    need(L.parseOsi("TSLA231332C00100000") === null, "osi: an impossible date is refused");
    need(L.parseOsi("TSLA230526X00167500") === null, "osi: a bad right is refused");
    const r = lcg(5);
    let wrong = 0;
    for (let i = 0; i < 5000; i++) {
      const len = 1 + Math.floor(r() * 6);
      let root = String.fromCharCode(65 + Math.floor(r() * 26));
      for (let j = 1; j < len; j++) root += r() < 0.8 ? String.fromCharCode(65 + Math.floor(r() * 26)) : String(Math.floor(r() * 10));
      const y = 2024 + Math.floor(r() * 6);
      const mo = 1 + Math.floor(r() * 12);
      const d = 1 + Math.floor(r() * 28);
      const day = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const milli = 1 + Math.floor(r() * 99999998);
      const cp = r() < 0.5 ? "C" : "P";
      const text = L.osiOf(root, day, cp, milli / 1000);
      const back = L.parseOsi(text);
      if (!back || back.root !== root || back.expiry !== day || back.cp !== cp.toLowerCase() || back.milli !== milli) wrong++;
    }
    need(wrong === 0, "osi: the round trip over 5,000 generated contracts (" + wrong + " wrong)");
  });

  safe("ratios", () => {
    const a = screen(L, [screenRow({ open_interest: 0 })]);
    need(a.ok && a.x.rows[0].ratios.voi === null && a.x.rows[0].ratios.voiWhy === "no-oi", "ratios: voi with no open interest is null with its reason");
    const unsent = screen(L, [screenRow({ open_interest: null })]);
    need(unsent.ok && unsent.x.rows[0].oi === null && unsent.x.rows[0].ratios.voiWhy === "no-oi", "ratios: open interest the feed did not send stays null, never zero");
    const b = screen(L, [screenRow({ premium: "300000.00", volume: 200, ask_side_volume: 80, bid_side_volume: 40, mid_volume: 20, no_side_volume: 60 })]);
    const rb = b.x.rows[0].ratios;
    need(rb.askLo === 0.4 && rb.askHi === 0.8, "ratios: the ask range runs from ask over volume to all but the bid over volume (" + rb.askLo + ", " + rb.askHi + ")");
    need(rb.lean === 0, "ratios: a range across one half is undecided");
    need(rb.stated === 0.6, "ratios: the stated share is ask plus bid over volume; mid volume has no side (" + rb.stated + ")");
    const mid = screen(L, [screenRow({ volume: 1000, ask_side_volume: 400, bid_side_volume: 300, mid_volume: 300, no_side_volume: 0 })]).x.rows[0].ratios;
    need(mid.askLo === 0.4 && mid.askHi === 0.7 && mid.lean === 0, "ratios: mid volume widens the range and never moves it toward sellers (" + mid.askLo + "-" + mid.askHi + ", lean " + mid.lean + ")");
    const qqq = (m) => screen(L, [screenRow({ volume: 339738, ask_side_volume: 169804, mid_volume: m, bid_side_volume: 339724 - 169804 - m, no_side_volume: 14, premium: "9000000.00" })]).x.rows[0].ratios;
    need(qqq(100).lean === 0 && qqq(10).lean === -1, "ratios: sellers only when more than half of volume is on the bid (" + qqq(100).lean + "," + qqq(10).lean + ")");
    const gate = screen(L, [screenRow({ volume: 200, ask_side_volume: 30, bid_side_volume: 30, mid_volume: 100, no_side_volume: 40 })]).x.rows[0].ratios;
    need(gate.askWhy === "lowCoverage" && gate.lean === null, "ratios: the coverage gate counts ask and bid only (" + gate.askWhy + ")");
    const c = screen(L, [screenRow({ volume: 200, ask_side_volume: 120, bid_side_volume: 0, mid_volume: 60, no_side_volume: 20 })]);
    need(c.x.rows[0].ratios.askLo === 0.6 && c.x.rows[0].ratios.askHi === 1, "ratios: mid volume counts to neither side (" + c.x.rows[0].ratios.askLo + ", " + c.x.rows[0].ratios.askHi + ")");
    need(c.x.rows[0].ratios.lean === 1, "ratios: a call bought on the ask leans positive");
    const put = screen(L, [screenRow({ option_symbol: "SYX101261120P00110000", option_type: "put", volume: 200, ask_side_volume: 140, bid_side_volume: 20, mid_volume: 20, no_side_volume: 20 })]);
    need(put.x.rows[0].ratios.lean === -1, "ratios: a put bought on the ask leans negative by convention");
    const sold = screen(L, [screenRow({ option_symbol: "SYX101261120P00110000", option_type: "put", volume: 200, ask_side_volume: 20, bid_side_volume: 140, mid_volume: 20, no_side_volume: 20 })]);
    need(sold.x.rows[0].ratios.lean === 1, "ratios: a put sold on the bid leans positive by convention");
    const exceed = screen(L, [screenRow({ volume: 200, ask_side_volume: 150, bid_side_volume: 60, mid_volume: 0, no_side_volume: 0 })]);
    need(exceed.x.rows[0].ratios.askWhy === "sidesExceed" && exceed.x.rows[0].ratios.askLo === null, "ratios: sides past the volume give no range");
    const low = screen(L, [screenRow({ volume: 200, ask_side_volume: 20, bid_side_volume: 20, mid_volume: 0, no_side_volume: 160 })]);
    need(low.x.rows[0].ratios.askLo === null && low.x.rows[0].ratios.askWhy === "lowCoverage" && low.x.rows[0].ratios.lean === null, "ratios: under 40% stated hides the range with its code");
    const small = screen(L, [screenRow({ premium: "249999.99" })]);
    need(small.x.rows[0].ratios.askWhy === "smallClassified", "ratios: a cent under the premium floor hides the range");
    const edge = screen(L, [screenRow({ premium: "250000.00" })]);
    need(edge.x.rows[0].ratios.askLo !== null, "ratios: at the premium floor the range shows");
    const fill = screen(L, [screenRow({ premium: "300000.00", volume: 200 })]);
    need(fill.x.rows[0].ratios.avgFill === 300000 * 100 / (200 * 100), "ratios: average fill is premium cents over volume times 100");
    const multi = screen(L, [screenRow({ multileg_volume: 10, stock_multi_leg_volume: 30, volume: 200, sweep_volume: 50, floor_volume: 20, cross_volume: 10 })]);
    const rm = multi.x.rows[0].ratios;
    need(rm.multiShare === 0.2 && rm.sweepShare === 0.25 && rm.floorShare === 0.1 && rm.crossShare === 0.05, "ratios: multi, sweep, floor and cross shares of volume");
    need(rm.nameShare === 0.05, "ratios: name share is volume over name volume");
    const full = screen(L, N["contract-screener"].data);
    need(full.ok && full.x.rows.length === N["contract-screener"].data.length, "ratios: the normal fixture reduces whole");
    for (const row of full.x.rows) {
      const raw = N["contract-screener"].data.find((q) => q.option_symbol === row.c);
      need(row.premC === centsText(raw.premium), "ratios: premium is exact integer cents for " + row.c);
      need(row.ratios.voi === (raw.open_interest > 0 ? raw.volume / raw.open_interest : null), "ratios: fixture voi for " + row.c);
      if (row.ratios.askLo !== null) {
        need(row.ratios.askLo === raw.ask_side_volume / raw.volume && row.ratios.askHi === (raw.volume - raw.bid_side_volume) / raw.volume, "ratios: fixture range for " + row.c);
        const want = 2 * raw.ask_side_volume > raw.volume ? 1 : 2 * raw.bid_side_volume > raw.volume ? -1 : 0;
        need(row.ratios.lean === (row.cp === "p" ? -want : want), "ratios: fixture lean for " + row.c);
      }
    }
  });

  safe("rank", () => {
    const rows = screen(L, [
      screenRow({ option_symbol: "SYX101261120C00120000", premium: "400000.00", open_interest: 100, volume: 200 }),
      screenRow({ option_symbol: "SYX202261113C00045000", premium: "300000.00", open_interest: 0, volume: 200 }),
      screenRow({ option_symbol: "SYX303261218P00300000", option_type: "put", premium: "300000.00", open_interest: 400, volume: 200 }),
    ], { rank: "voi" });
    eq(rows.x.rows.map((r) => r.t), ["SYX101", "SYX303", "SYX202"], "rank: voi order puts the null last");
    need(rows.x.unranked === 1, "rank: the null key is counted");
    const tie = L.rankScreen(screen(L, [
      screenRow({ option_symbol: "SYX202261113C00045000", premium: "300000.00" }), screenRow({ option_symbol: "SYX101261120C00120000", premium: "300000.00" }),
    ]).x.rows, "premium");
    need(tie.rows[0].c === "SYX101261120C00120000", "rank: ties break by symbol ascending");
  });

  safe("preset", () => {
    const p = L.presetParams("earnings", { asOf: "2026-10-23" });
    need(p && /^\d+$/.test(p.max_earnings_dte), "preset: earnings carries a day count");
    need(Number(p.max_earnings_dte) === Math.round((Date.parse(horizonEnd("2026-10-23") + "T00:00:00Z") - Date.parse("2026-10-23T00:00:00Z")) / 86400000), "preset: earnings reads the shared horizon");
    need(L.presetParams("voi", { ticker: "SYX101", asOf: "2026-10-23" }).ticker_symbol === "SYX101", "preset: a ticker is added");
    need(L.presetParams("nope") === null, "preset: an unknown preset is refused");
  });

  safe("prints", () => {
    const r = L.reduceContract({ flow: N["contract-flow"] }, { c: FX.contract, date: FX.session });
    const p = r.x.prints;
    need(r.ok && p.ok && p.x.list.length === 50, "prints: fifty listed");
    const raw = N["contract-flow"].data;
    const live = raw.filter((q) => !q.canceled);
    need(p.x.sums.n === live.length && p.x.sums.canceled === raw.length - live.length, "prints: canceled prints are counted apart");
    need(p.x.sums.size === live.reduce((s, q) => s + q.size, 0), "prints: contracts sum leaves canceled prints out");
    need(p.x.sums.premC === live.reduce((s, q) => s + centsText(q.premium), 0), "prints: premium sum leaves canceled prints out");
    need(p.x.list.filter((q) => q.canceled).length === 2 && p.x.list.every((q) => !q.canceled || q.side === 0), "prints: canceled prints stay listed with no side");
    need(p.x.list.every((q, i, a) => i === 0 || a[i - 1].at >= q.at), "prints: newest first");
    need(p.x.outliers.ok === true && p.x.outliers.items.length >= 1, "prints: the 1,200 contract print is a size outlier");
    const few = L.reduceContract({ flow: T["contract-flow"] }, { c: FX.contract, date: FX.session }).x.prints;
    need(few.x.outliers.ok === false && few.x.outliers.why === "few-prints", "prints: five prints name no outliers");
    const base = raw.filter((q) => !q.canceled).slice(0, 19).map((q) => ({ ...q }));
    for (const q of base) if (q.size > 100) q.size = 20;
    base[3].size = 5000;
    base[3].premium = "250000.00";
    const nineteen = L.reduceContract({ flow: { data: base } }, { c: FX.contract, date: FX.session }).x.prints;
    need(nineteen.x.outliers.ok === false, "prints: nineteen prints name no outliers");
    const twenty = L.reduceContract({ flow: { data: [...base, { ...base[0], id: "x-20" }] } }, { c: FX.contract, date: FX.session }).x.prints;
    need(twenty.x.outliers.ok === true && twenty.x.outliers.items.length === 1, "prints: twenty prints name the one outlier");
    need(p.x.alertIds.length === 1, "prints: distinct alert ids");
  });

  safe("minutes", () => {
    const body = { data: [minuteRow(0, 0, 0, 100, 0), minuteRow(1, 5, 1, 0, 0), minuteRow(2, 20, 2, 0, 0)] };
    const m = L.reduceContract({ intraday: body }, { c: FX.contract, date: FX.session }).x.minutes;
    need(m.ok && m.x.firstAggressive === m.x.list[2].m, "minutes: the first aggressive minute needs the 10% clause");
    eq(m.x.cum, [0, 4, 22], "minutes: cumulative ask minus bid");
    const none = L.reduceContract({ intraday: { data: [minuteRow(0, 1, 1, 0, 0)] } }, { c: FX.contract }).x.minutes;
    need(none.x.firstAggressive === null, "minutes: none when the ratio never holds");
    const unsentRow = { ...minuteRow(0, 1, 1, 0, 0), premium_ask_side: null };
    delete unsentRow.premium_bid_side;
    const unsent = L.reduceContract({ intraday: { data: [unsentRow] } }, { c: FX.contract }).x.minutes.x.list[0];
    need(unsent.pa === null && unsent.pb === null && unsent.pm === 0, "minutes: a side premium the feed did not send stays null, a sent zero stays zero");
    const n = L.reduceContract({ intraday: N["contract-intraday"] }, { c: FX.contract }).x.minutes;
    need(n.ok && n.x.list.length === 380 && n.x.list.every((q, i, a) => i === 0 || a[i - 1].m < q.m), "minutes: 380 ascending bars");
  });

  safe("profile", () => {
    const tie = L.reduceContract({ profile: { data: [profileRow("1.00", 10), profileRow("1.01", 30), profileRow("1.02", 30), profileRow("1.03", 10)] } }, { date: FX.session }).x.profile.x;
    need(tie.poc === 101, "profile: a volume tie goes to the lower price (" + tie.poc + ")");
    need(tie.valueArea.lo === 101 && tie.valueArea.hi === 102 && tie.valueArea.v === 60 && tie.valueArea.of === 80, "profile: value area from the point of control");
    const flat = L.reduceContract({ profile: { data: [profileRow("1.00", 20), profileRow("1.01", 40), profileRow("1.02", 20)] } }, { date: FX.session }).x.profile.x;
    need(flat.valueArea.lo === 101 && flat.valueArea.hi === 102, "profile: equal neighbours go up (" + flat.valueArea.lo + "-" + flat.valueArea.hi + ")");
    const big = L.reduceContract({ profile: { data: [profileRow("1234567.89", 450000001), profileRow("1234567.90", 450000000)] } }, { date: FX.session }).x.profile.x;
    need(big.vwapC === 123456789, "profile: vwap is exact in integers (" + big.vwapC + ")");
    const sh = L.reduceContract({ profile: { data: [profileRow("1.00", 100, { sweep_vol: 25, floor_vol: 10, multi_vol: 5, cross_vol: 1 })] } }, { date: FX.session }).x.profile.x;
    need(sh.shares.sweep === 0.25 && sh.shares.floor === 0.1 && sh.shares.multi === 0.05 && sh.shares.cross === 0.01, "profile: four shares of the profile");
    const n = L.reduceContract({ profile: N["contract-profile"] }, { date: FX.session }).x.profile.x;
    need(n.levels.length === 30 && n.levels.every((l, i, a) => i === 0 || a[i - 1].px < l.px), "profile: thirty levels sorted by price");
    const off = L.reduceContract({ profile: { data: [profileRow("1.00", 10), profileRow("1.01", 10, { date: "2026-10-22" })] } }, { date: FX.session }).x.profile.x;
    need(off.offDate === 1 && off.levels.length === 1, "profile: a level dated another day is left out and counted");
  });

  safe("strikes", () => {
    const open = Date.UTC(2026, 9, 23, 13, 30);
    const row = (min, k, ca, cb, pa, pb, extra = {}) => ({
      call_premium: "0", call_premium_ask_side: "0", call_premium_bid_side: "0", call_trades: 1, call_volume: ca + cb + (extra.cu || 0), call_volume_ask_side: ca, call_volume_bid_side: cb, date: extra.date || FX.session,
      put_premium: "0", put_premium_ask_side: "0", put_premium_bid_side: "0", put_trades: 1, put_volume: pa + pb + (extra.pu || 0), put_volume_ask_side: pa, put_volume_bid_side: pb,
      strike: k, ticker: "SYX101", timestamp: new Date(open + min * 60000).toISOString().replace(".000", ""),
    });
    const ctx = { openMs: open, session: FX.session };
    const s = L.reduceStrikes({ data: [row(1, "100.00", 10, 4, 2, 7), row(14, "100.00", 3, 1, 0, 0), row(16, "105.00", 0, 0, 5, 1), row(-5, "100.00", 99, 0, 0, 0)] }, ctx);
    need(s.ok && s.x.outside === 1, "strikes: a row before the open is left out and counted");
    const i100 = s.x.strikes.indexOf(100);
    const i105 = s.x.strikes.indexOf(105);
    need(s.x.cells[i100][0] === (10 - 4) - (2 - 7) + (3 - 1), "strikes: a cell is call ask minus bid less put ask minus bid (" + s.x.cells[i100][0] + ")");
    need(s.x.cells[i105][1] === -(5 - 1), "strikes: a put bought on the ask counts negative (" + s.x.cells[i105][1] + ")");
    need(s.x.cells[i100][1] === null && s.x.cells[i105][0] === null, "strikes: a cell with no row is null, never zero");
    const u = L.reduceStrikes({ data: [row(1, "100.00", 10, 4, 0, 0, { cu: 9 }), row(1, "105.00", 10, 2, 0, 0, { cu: 3 })] }, ctx);
    const a = u.x.strikes.indexOf(100);
    const b = u.x.strikes.indexOf(105);
    need(u.x.cells[a][0] === 6 && u.x.unknown[a][0] === 9 && u.x.decided[a][0] === false, "strikes: a cell whose range includes zero is undecided");
    need(u.x.cells[b][0] === 8 && u.x.unknown[b][0] === 3 && u.x.decided[b][0] === true, "strikes: a cell whose range excludes zero is decided");
    need(u.x.cum[a] === 6 && u.x.cumUnknown[a] === 9, "strikes: session sums carry their unknown");
    need(u.x.sidedShare === (14 + 12) / (23 + 15), "strikes: the sided share is stated contracts over volume (" + u.x.sidedShare + ")");
    const off = L.reduceStrikes({ data: [row(1, "100.00", 1, 0, 0, 0, { date: "2026-10-22" })] }, ctx);
    need(off.ok === false && off.why === "not-session" && off.date === "2026-10-22", "strikes: rows of another session name that session");
    const mixed = L.reduceStrikes({ data: [row(1, "100.00", 1, 0, 0, 0), row(2, "100.00", 5, 0, 0, 0, { date: "2026-10-22" })] }, ctx);
    need(mixed.ok && mixed.x.offDate === 1 && mixed.x.cells[0][0] === 1, "strikes: a row of another session is left out and counted");
    const many = [];
    for (let i = 0; i < 30; i++) many.push(row(1, (100 + i).toFixed(2), 1, 0, 0, 0));
    const m = L.reduceStrikes({ data: many }, { ...ctx, center: 115 });
    need(m.x.strikes.length === 24 && m.x.of === 30, "strikes: the 24 strikes nearest the centre");
    need(m.x.strikes[0] === 103 && m.x.strikes[23] === 126, "strikes: nearest by distance, ties to the lower strike (" + m.x.strikes[0] + "-" + m.x.strikes[23] + ")");
    need(m.x.centerSource === "day" && m.x.center === 115, "strikes: a centre from the day's read is named");
    const med = L.reduceStrikes({ data: many }, ctx);
    need(med.x.centerSource === "median" && med.x.center === 114, "strikes: with no centre the volume median stands in (" + med.x.center + ")");
    const n = L.reduceStrikes(N["strike-flow-intraday"], { ...ctx, center: 120 });
    need(n.ok && n.x.rows + n.x.withheld + n.x.outside + n.x.dropped === N["strike-flow-intraday"].data.length, "strikes: the normal fixture reduces whole");
  });

  safe("rail", () => {
    const d = (k, ca, cb, pa, pb, extra = {}) => ({
      call_premium: "0", call_premium_ask_side: "0", call_premium_bid_side: "0", call_trades: 1, call_volume: ca + cb + (extra.cu || 0), call_volume_ask_side: ca, call_volume_bid_side: cb,
      date: extra.date || FX.session, put_premium: "0", put_premium_ask_side: "0", put_premium_bid_side: "0", put_trades: 1, put_volume: pa + pb + (extra.pu || 0),
      put_volume_ask_side: pa, put_volume_bid_side: pb, strike: k, ticker: "SYX101", timestamp: "2026-10-23T20:00:00Z",
    });
    const r = L.reduceStrikeDay([d("100.0", 30, 10, 5, 15), d("105.0", 2, 1, 0, 0, { cu: 9 }), d("110.0", 1, 0, 0, 0, { date: "2026-10-22" })], { session: FX.session });
    const at = (k) => r.x.strikes.find((q) => q.k === k);
    need(r.ok && r.x.of === 2, "rail: a row of another session is left out (" + (r.x && r.x.of) + ")");
    need(at(100).net === 30 && at(100).unknown === 0 && at(100).decided === true, "rail: a strike's net is ask minus bid, calls less puts");
    need(at(105).net === 1 && at(105).lo === -8 && at(105).hi === 10 && at(105).decided === false, "rail: a range across zero is undecided");
    need(r.x.sidedShare === 63 / 72, "rail: the sided share is stated contracts over volume (" + r.x.sidedShare + ")");
    const touch = L.reduceStrikeDay([d("100.0", 5, 0, 0, 0, { cu: 5 })], { session: FX.session }).x.strikes[0];
    need(touch.net === 5 && touch.lo === 0 && touch.decided === false, "rail: a range that touches zero is undecided");
    const twice = L.reduceStrikeDay([d("100.0", 3, 1, 0, 0), d("100.0", 2, 0, 0, 0)], { session: FX.session });
    need(twice.x.strikes.length === 1 && twice.x.strikes[0].net === 4, "rail: two rows of one strike are summed");
    const exceed = L.reduceStrikeDay([{ ...d("100.0", 3, 1, 0, 0), call_volume: 2 }], { session: FX.session });
    need(exceed.ok && exceed.x.strikes[0].net === null && exceed.x.strikes[0].why === "sidesExceed", "rail: sides past the volume give no net");
    const off = L.reduceStrikeDay([d("100.0", 3, 1, 0, 0, { date: "2026-10-22" })], { session: FX.session });
    need(off.ok === false && off.why === "not-session" && off.date === "2026-10-22", "rail: another session's day names it");
    const n = L.reduceStrikeDay(N["flow-per-strike"], { session: FX.session });
    need(n.ok && n.x.of === N["flow-per-strike"].length && n.x.strikes.length === 24 && n.x.center !== null, "rail: the normal fixture reduces whole, 24 strikes around its median");
  });

  safe("recent", () => {
    const e = (expiry, cp, pp, ca, cb, pa, pb, date = FX.session) => ({
      date, expiry, call_premium: cp, put_premium: pp, call_premium_ask_side: ca, call_premium_bid_side: cb, put_premium_ask_side: pa, put_premium_bid_side: pb,
      call_volume: 10, put_volume: 10, call_trades: 1, put_trades: 1, ticker: "SYX101",
    });
    const W = ["4022977.00", "2985942.00", "1000000.00", "2500000.00", "2000000.00", "489725.00"];
    const w = L.reduceExpiries([e("2026-10-30", ...W)], { session: FX.session }).x.rows[0];
    need(w.netC === -301027500, "recent: net is ask minus bid premium, calls less puts (" + w.netC + ")");
    need(w.unknownC === 101919400 && w.loC === -402946900 && w.hiC === -199108100, "recent: the range adds premium of unknown side to either end (" + [w.unknownC, w.loC, w.hiC] + ")");
    need(w.decided === true && w.callC - w.putC === 103703500, "recent: a range below zero is decided, whatever the gross difference");
    need(w.sidedShare === (100000000 + 250000000 + 200000000 + 48972500) / (402297700 + 298594200), "recent: the sided share is sided premium over premium (" + w.sidedShare + ")");
    const prints = L.reduceExpiries({ data: [{ id: "x", executed_at: "2026-10-23T14:00:00Z", expiry: "2026-10-30", premium: "100.00", size: 1 }] }, { session: FX.session });
    need(prints.ok === false && prints.why === "unshaped" && Array.isArray(prints.missing) && prints.missing.includes("call_premium"), "recent: a print-shaped body is unshaped and names the missing fields");
    const two = L.reduceExpiries([e("2026-10-30", ...W), e("2026-10-30", ...W, "2026-10-22")], { session: FX.session });
    need(two.ok && two.x.rows.length === 1 && two.x.offDate === 1, "recent: rows of another date are left out before a repeat is judged");
    const rep = L.reduceExpiries([e("2026-10-30", ...W), e("2026-10-30", ...W)], { session: FX.session });
    need(rep.ok === false && rep.why === "unshaped" && rep.repeated === "2026-10-30", "recent: a repeated expiry on one date is unshaped");
    const prior = L.reduceExpiries([e("2026-10-30", ...W, "2026-10-22")], { session: FX.session });
    need(prior.ok && prior.x.prior === true && prior.x.date === "2026-10-22", "recent: the previous session stands in and says so");
    const old = L.reduceExpiries([e("2026-10-30", ...W, "2026-10-20")], { session: FX.session });
    need(old.ok === false && old.why === "not-session" && old.date === "2026-10-20", "recent: an older date is not-session naming it");
    const exceed = L.reduceExpiries([e("2026-10-30", "100.00", "100.00", "80.00", "40.00", "10.00", "10.00")], { session: FX.session });
    need(exceed.ok && exceed.x.rows[0].netC === null && exceed.x.rows[0].why === "sidesExceed", "recent: stated sides past the premium give no net");
    const n = L.reduceExpiries(N["flow-per-expiry"], { session: FX.session });
    need(n.ok && n.x.rows.length === N["flow-per-expiry"].length && n.x.rows.every((q, i, all) => i === 0 || all[i - 1].e < q.e), "recent: the normal fixture reduces whole, by expiry");
  });

  safe("alert", () => {
    const a = L.reduceAlert(N["flow-alert-trades"]);
    need(a.ok && a.x.alert.chain === FX.contract && a.x.trades.length === 6 && a.x.more === true, "alert: the alert, its trades and the more flag");
    const dirty = L.reduceAlert({ alert: {}, trades: [{ size: 3 }, { executed_at: "2026-10-23T14:00:00Z", price: "1.00", size: 2, secret: "x" }], has_more: false });
    need(dirty.ok && dirty.x.dropped === 1 && dirty.x.trades.length === 1 && !("secret" in dirty.x.trades[0]), "alert: a trade without a time is dropped and unknown keys are ignored");
    need(L.reduceAlert({ alert: "none", trades: "none" }).ok === false, "alert: a wrong shape is unshaped");
  });

  safe("structure", () => {
    const s = L.reduceStructures(N["multi-leg"], { c: FX.contract, session: FX.session });
    need(s.ok && s.x.list.length === 1 && s.x.list[0].state === "candidate" && s.x.list[0].id.endsWith("1"), "structure: one candidate, labelled a candidate");
    const l = L.reduceLegs(N["multi-leg-legs"], { c: FX.contract });
    need(l.ok && l.x.confirmed === true && l.x.legs.length === 3, "structure: the legs list confirms the contract");
    const other = L.reduceLegs(N["multi-leg-legs"], { c: FX.other });
    need(other.ok && other.x.confirmed === false, "structure: a contract not among the legs is not confirmed");
    const off = L.reduceStructures(N["multi-leg"], { c: FX.contract, session: "2026-10-22" });
    need(off.ok && off.x.list.length === 0, "structure: a package from another session is not a candidate");
    need(s.x.searched === N["multi-leg"].data.length && s.x.found === 1 && off.x.searched === N["multi-leg"].data.length, "structure: the packages searched are counted, matched or not");
  });

  safe("greek", () => {
    const g = L.reduceGreek(N["greek-flow-expiry"], { expiry: FX.expiry });
    need(g.ok && g.x.unit === null, "greek: the unit is null");
    for (const k of ["dirDelta", "dirVega", "totDelta", "totVega"]) {
      const rel = g.x.rel[k];
      need(rel && Math.max(...rel.map(Math.abs)) === 1, "greek: " + k + " is divided by its largest absolute value");
    }
    const rows = N["group-greek-flow-expiry"].data.map((q, i) => (i === 0 ? { ...q, net_call_premium: "abc" } : q));
    const gg = L.reduceGreek({ data: rows }, { group: true });
    need(gg.ok && gg.x.dropped === 1 && gg.x.t.length === rows.length - 1, "greek: a group row whose premium is not a decimal is dropped");
    const zero = L.reduceGreek({ data: [{ ...N["greek-flow-expiry"].data[0], dir_delta_flow: "0", total_delta_flow: "0" }] }, {});
    need(zero.ok && zero.x.rel.dirDelta === null, "greek: an all-zero series has no shape");
    const bare = N["group-greek-flow-expiry"].data.map((q) => { const { net_call_premium: drop, ...rest } = q; return drop === undefined ? q : rest; });
    const none = L.reduceGreek({ data: bare }, { group: true });
    need(none.ok === false && none.why === "type:net_call_premium", "greek: a group with no net premiums names that field (" + none.why + ")");
    const openMs = Date.UTC(2026, 9, 23, 13, 30);
    const early = L.reduceGreek({ data: [{ ...N["greek-flow-expiry"].data[0], timestamp: "2026-10-23T11:30:00Z" }, ...N["greek-flow-expiry"].data] }, { openMs });
    need(early.ok && early.x.early === 1 && early.x.t[0] >= openMs && early.x.t.length === N["greek-flow-expiry"].data.length, "greek: minutes before the open are left out and counted");
  });

  safe("ladders", () => {
    const o = [];
    for (let c = 0; c <= 50; c++) o.push({ call_volume: 10, price: (100 + c / 100).toFixed(2), put_volume: 5 });
    const stock = (rows, date = FX.session) => ({ date, data: rows.map(([px, lit, off]) => ({ price: px, regular_volume: lit, dark_pool_volume: off })) });
    const l = L.reduceLadders({ options: { data: o }, stock: stock([["100.01", "600", "400"], ["100.02", "100", "0"]]) }, { session: FX.session });
    need(l.ok && l.x.w === 2 && l.x.widened === false && l.x.stockStep === 1, "ladders: the smallest width that gives 48 bins or fewer (" + (l.x && l.x.w) + ")");
    const bin = l.x.bins.find((q) => q.lo === 10000);
    need(bin && bin.call === 20 && bin.lit === 600 && bin.off === 400 && bin.offShare === 0.4, "ladders: bins merge both sides and off share is off over lit plus off");
    need(l.x.bins.some((q) => q.lit === null && q.call !== null), "ladders: a side with no row is null");
    need(l.x.offShare === 400 / 1100, "ladders: total off share is over lit plus off");
    need(l.x.stockRead === true && l.x.stockDate === FX.session, "ladders: the feed's string share counts are read");
    const wide = L.reduceLadders({ options: { data: o }, stock: stock([["100.00", "600", "400"], ["100.25", "100", "0"]]) }, { session: FX.session });
    need(wide.ok && wide.x.stockStep === 25 && wide.x.w === 25 && wide.x.widened === true, "ladders: bins are widened to the stock step (" + (wide.x && wide.x.w) + ")");
    const other = L.reduceLadders({ options: { data: o }, stock: stock([["100.01", "1", "1"]], "2026-10-22") }, { session: FX.session });
    need(other.ok && other.x.stockRead === false && other.x.stockWhy && other.x.stockWhy.why === "not-session" && other.x.stockWhy.date === "2026-10-22", "ladders: another session's stock levels are named and not drawn");
    const n = L.reduceLadders({ options: N["option-price-levels"], stock: N["darkpool-levels"] }, { session: FX.session });
    need(n.ok && n.x.bins.length > 0 && n.x.bins.length <= 48 && n.x.optionRead && n.x.stockRead, "ladders: the normal fixture fits 48 bins with both sides");
  });

  safe("lit", () => {
    const m = L.reduceLit(N["lit-recent"], { mode: "market" });
    need(m.ok && m.x.list.length === Math.min(N["lit-recent"].data.length, BUILD.LIT_LIMIT) && m.x.list.every((q, i, a) => i === 0 || a[i - 1].premC >= q.premC), "lit: the market list keeps every print read, by premium");
    const t = L.reduceLit(N["lit-ticker"], { mode: "ticker" });
    need(t.ok && t.x.list.length === 100 && t.x.list.every((q, i, a) => i === 0 || a[i - 1].at >= q.at), "lit: a ticker list is the newest 100");
    need(t.x.sums.canceled === 1 && t.x.sums.n === t.x.n - 1, "lit: a canceled print is out of the sums");
    const at = (i, premium) => ({ ...N["lit-recent"].data[1], executed_at: "2026-10-23T14:0" + i + ":00Z", premium });
    const floored = L.reduceLit({ data: [at(1, "600000.00"), at(2, "499999.99"), at(3, "500000.00")] }, { mode: "market", minPremiumC: 50000000 });
    need(floored.ok && floored.x.n === 2 && floored.x.below === 1 && floored.x.list.every((q) => q.premC >= 50000000), "lit: a print under the floor is left out and counted");
    const all = L.reduceLit({ data: [at(2, "499999.99")] }, { mode: "market", minPremiumC: 50000000 });
    need(all.ok === false && all.why === "empty", "lit: nothing over the floor is an empty read, not a shape fault");
    need(L.reduceLit(N["lit-recent"], { mode: "market", minPremiumC: 50000000 }).x.below === 0, "lit: the fixture's market prints are all over the floor");
  });

  safe("venues", () => {
    const row = (x, trades, contracts, prem) => ({ underlying_symbol: "SYX101", exchange: x, trade_code: "", trade_count: trades, contracts, premium: prem, call_trades: 0, put_trades: trades });
    const v = L.reduceVenues({ data: [row("A", 1, 5, 10), row("B", 8, 3, 20.5), row("C", 1, 2, 3)] }, {});
    const t = v.x.tickers[0];
    need(t.hhiN === "38" && t.hhiD === "100" && t.hhi === 0.38, "venues: concentration is over contracts, exactly (" + t.hhiN + "/" + t.hhiD + ")");
    need(t.exchanges[0].x === "A" && t.exchanges[1].premC === 2050, "venues: ranked by contracts, premium in cents");
    const c = L.reduceVenues(N["exchange-breakdown-codes"], { ticker: "SYX101", codes: true });
    const ct = c.x.tickers[0];
    const raw = N["exchange-breakdown-codes"].data.filter((q) => q.underlying_symbol === "SYX101");
    need(c.ok && c.x.tickers.length === 1 && ct.top.length === 4 && ct.top[0].code === "auto" && ct.codes === 4, "venues: the top trade codes by contracts");
    need(ct.total === raw.reduce((t, q) => t + q.contracts, 0) && ct.exchanges.reduce((t, q) => t + q.contracts, 0) === ct.total, "venues: the same read sums to the exchange split");
    const plain = L.reduceVenues(N["exchange-breakdown-codes"], { ticker: "SYX101" });
    need(plain.ok && plain.x.tickers[0].top === undefined, "venues: codes only when asked");
    const one = L.reduceVenues(N["exchange-breakdown"], { ticker: "SYX202" });
    need(one.ok && one.x.tickers.length === 1 && one.x.tickers[0].t === "SYX202", "venues: one ticker");
  });

  safe("roots", () => {
    const r = L.reduceRoots({ data: ["BRK.B", "aapl", "AAPL", "A", "TOOLONGSYMBOL1", "1X", "SYX101"] });
    need(r.ok && r.x.list === "A|AAPL|BRK.B|SYX101" && r.x.dropped === 3, "roots: sorted unique uppercase symbols (" + (r.x && r.x.list) + ")");
    need(L.rootListed(r.x.list, "AAPL") && !L.rootListed(r.x.list, "AAP"), "roots: membership by delimiters");
    need(L.reduceRoots({ data: "AAPL" }).ok === false, "roots: a string is unshaped");
  });

  safe("analytics", () => {
    const ctx = { symbols: ["SPY", "SYX101", "SYX202"], calc: "correlation" };
    need(L.reduceAnalytics(N["analytics-window"], ctx).ok === true, "analytics: the assumed shape is accepted");
    const out = L.reduceAnalytics({ data: { meta: {}, payload: { SPY: { SPY: 1.7 } } } }, ctx);
    need(out.ok === false && out.why === "unshaped", "analytics: a correlation of 1.7 is refused, not clipped");
    need(L.reduceAnalytics({ data: { meta: {}, payload: { ZZZ: { ZZZ: 1 } } } }, ctx).ok === false, "analytics: a symbol that was not asked is unshaped");
    need(L.reduceAnalytics({ data: { meta: null, payload: null } }, ctx).ok === false, "analytics: null parts are unshaped");
  });

  safe("groups", () => {
    need(L.thirdFridayExpiry("2026-10-23") === "2026-11-20" && L.thirdFridayExpiry("2026-11-20") === "2026-12-18", "groups: the monthly expiry after the session");
    need(L.groupEntry({ ok: false, why: "deadline" }, 0).status === "timeout" && L.groupEntry({ ok: false, why: "type:x" }, 0).status === "unshaped" && L.groupEntry(null, 0).status === "failed", "groups: a failed read keeps its status");
    const openMs = Date.UTC(2026, 9, 23, 13, 30);
    const g = L.groupEntry(L.reduceGreek(N["group-greek-flow-expiry"], { group: true, expiry: FX.expiry }), openMs);
    const raw = N["group-greek-flow-expiry"].data;
    need(g.status === "ok" && g.callC === raw.reduce((t, q) => t + centsText(q.net_call_premium), 0) && g.putC === raw.reduce((t, q) => t + centsText(q.net_put_premium), 0), "groups: the feed's net premiums summed in cents");
    need(g.bars.length === L.GROUP_BAR_COUNT && g.bars.every((q, i) => q.t === openMs + i * L.GROUP_BAR_MS), "groups: half-hour bars from the open");
    const all = L.orderGroups({ mag7: g });
    need(Object.keys(all).length === 25 && Object.keys(all)[0] === L.GROUPS[0] && all.mag7 === g && all.gold.status === "cap", "groups: every group in order, the unread named");
  });

  safe("modes", () => {
    need(L.flowlabMode({ FLOWS_FLOWLAB: "on" }, false) === "on", "mode: on admits a member");
    need(L.flowlabMode({ FLOWS_FLOWLAB: " ON " }, false) === "on", "mode: trimmed and lowercased");
    need(L.flowlabMode({ FLOWS_FLOWLAB: "owner" }, true) === "on" && L.flowlabMode({ FLOWS_FLOWLAB: "owner" }, false) === "off", "mode: owner admits owners only");
    need(L.flowlabMode({ FLOWS_FLOWLAB: "onn" }, true) === "off" && L.flowlabMode({}, true) === "off", "mode: a misspelled or absent value is off");
    need(L.analyticsOn({ FLOWS_FLOWLAB_ANALYTICS: "on" }) === true && L.analyticsOn({ FLOWS_FLOWLAB_ANALYTICS: "yes" }) === false, "mode: analytics only on the exact word");
    need(L.nightlyOn({}) === true && L.nightlyOn({ FLOWS_FLOWLAB_NIGHTLY: "off" }) === false, "mode: the nightly is on unless off");
  });

  return bad;
}

const base = battery(REAL);
assert.deepEqual(base, [], "the shipped leaf passes its own battery:\n" + base.join("\n"));
checks++;

const PLANTS = [
  ["voi-zero", [["voi: r.oi > 0 ? r.vol / r.oi : null,", "voi: r.oi > 0 ? r.vol / r.oi : 0,"]], "voi with no open interest"],
  ["hi-old-bound", [["const { vol, ask, bid, premC } = r;", "const { vol, ask, bid, premC, none } = r;"], ["hi: (vol - bid) / vol,", "hi: (ask + none) / vol,"]], "all but the bid"],
  ["mid-on-ask", [["const base = { lo: ask / vol, hi: (vol - bid) / vol, stated };", "const base = { lo: (ask + (r.mid || 0)) / vol, hi: (vol - bid) / vol, stated };"]], "mid volume counts to neither side"],
  ["mid-counted-stated", [["const sided = ask + bid;", "const sided = ask + bid + (r.mid || 0);"]], "coverage gate counts ask and bid only"],
  ["down-under-half", [["const buy = 2 * ask > vol ? 1 : 2 * bid > vol ? -1 : 0;", "const buy = 2 * ask > vol ? 1 : 2 * ask < vol ? -1 : 0;"]], "never moves it toward sellers"],
  ["put-lean-unflipped", [["return cp === \"p\" ? -buy : buy;", "return buy;"]], "a put bought"],
  ["value-area-ties-down", [["if (up >= down) { hi++;", "if (up > down) { hi++;"]], "equal neighbours go up"],
  ["poc-ties-high", [["if (levels[i].v > levels[poc].v) poc = i;", "if (levels[i].v >= levels[poc].v) poc = i;"]], "volume tie goes to the lower"],
  ["vwap-float", [["return Number((2n * num + den) / (2n * den));", "return Math.round(Number(num) / Number(den));"]], "vwap is exact"],
  ["canceled-in-sums", [["const live = out.filter((p) => !p.canceled);", "const live = out.filter(() => true);"]], "leaves canceled prints out"],
  ["outliers-at-19", [["if (live.length >= FLOWLAB_LIMITS.outlierMinPrints) {", "if (live.length >= 19) {"]], "nineteen prints"],
  ["null-cell-zero", [["const blank = () => strikes.map(() => new Array(FLOWLAB_LIMITS.bucketCount).fill(null));", "const blank = () => strikes.map(() => new Array(FLOWLAB_LIMITS.bucketCount).fill(0));"]], "never zero"],
  ["put-sign", [["const net = (f.ca - f.cb) - (f.pa - f.pb);", "const net = (f.ca - f.cb) + (f.pa - f.pb);"]], "put bought on the ask counts negative"],
  ["cell-always-decided", [["const call = cells.map((line, i) => line.map((v, b) => (v === null ? null : decided(v, unknown[i][b]))));", "const call = cells.map((line) => line.map((v) => (v === null ? null : true)));"]], "range includes zero is undecided"],
  ["decided-at-the-edge", [["export const decided = (net, unknown) => net !== null && unknown !== null && Math.abs(net) > unknown;", "export const decided = (net, unknown) => net !== null && unknown !== null && Math.abs(net) >= unknown - 1;"]], "touches zero is undecided"],
  ["centre-ignored", [["const given = Number.isFinite(ctx.center) && ctx.center > 0 ? ctx.center : null;", "const given = null;"]], "centre from the day's read"],
  ["strikes-any-session", [["const { keep, latest } = sessionRows(list, ctx.session);\n  if (!keep.length) return { ok: false, why: \"not-session\", date: latest };\n  const rows = [];", "const { latest } = sessionRows(list, ctx.session);\n  const keep = list.filter(isObj);\n  if (!keep.length) return { ok: false, why: \"not-session\", date: latest };\n  const rows = [];"]], "rows of another session"],
  ["recent-net-gross", [["netC: lean.net,", "netC: c.callC - c.putC,"]], "net is ask minus bid premium"],
  ["recent-lenient", [["const shaped = list.filter((r) => isObj(r) && typeof premCents(r.call_premium) === \"number\" && typeof premCents(r.put_premium) === \"number\");", "const shaped = list.filter((r) => isObj(r));"]], "print-shaped body"],
  ["recent-no-date-filter", [["if (typeof row.date !== \"string\" || row.date.slice(0, 10) !== date) { offDate++; continue; }", ""]], "rows of another date are left out"],
  ["recent-no-prior", [["const date = session === null ? latest : has(session) ? session : has(prior) ? prior : null;", "const date = session === null ? latest : has(session) ? session : null;"]], "previous session stands in"],
  ["ladder-widest", [["for (const w of WIDTHS_C) {", "for (const w of [...WIDTHS_C].reverse()) {"]], "smallest width"],
  ["off-share-lit-only", [["q.off / (q.lit + q.off)", "q.off / q.lit"]], "off share is off over lit plus off"],
  ["ladder-shares-as-integers", [["const lit = isObj(row) ? shareCount(row.regular_volume) : null;", "const lit = isObj(row) && Number.isSafeInteger(row.regular_volume) ? row.regular_volume : null;"]], "string share counts"],
  ["ladder-step-ignored", [["if (stepC === null || stepC <= w) return { w, widened: false };", "return { w, widened: false };"]], "widened to the stock step"],
  ["hhi-by-trades", [["hhiN += BigInt(r.contracts) * BigInt(r.contracts);", "hhiN += BigInt(r.trades) * BigInt(r.trades);"]], "concentration is over contracts"],
  ["codes-not-read", [["if (codes && typeof row.trade_code === \"string\" && row.trade_code) bump(m.code, row.trade_code, row, prem.cents);", ""]], "top trade codes"],
  ["osi-seven-digits", [["([CP])(\\d{8})$/", "([CP])(\\d{7,8})$/"]], "a 7-digit strike"],
  ["roots-lowercase", [["export const ROOT_RE = /^[A-Z][A-Z0-9.]{0,9}$/;", "export const ROOT_RE = /^[A-Za-z][A-Za-z0-9.]{0,9}$/;"]], "sorted unique uppercase"],
  ["corr-clipped", [["(!correlation || (v >= -1 && v <= 1))", "true"]], "refused, not clipped"],
  ["greek-absolute", [["rel[n] = relative(series[n]);", "rel[n] = series[n];"]], "divided by its largest"],
  ["greek-group-wrong-field", [["if (c === null) { bad(\"net_call_premium\"); continue; }", "if (c === null) { bad(\"timestamp\"); continue; }"]], "names that field"],
  ["greek-early-kept", [["if (openMs !== null && at < openMs) { early++; continue; }", ""]], "before the open are left out"],
  ["structure-confirmed", [["state: \"candidate\",", "state: \"confirmed\","]], "labelled a candidate"],
  ["structure-searched-matched", [["searched: list.length,", "searched: out.length,"]], "packages searched are counted"],
  ["lit-top-40", [["litMarket: 200,", "litMarket: 40,"]], "keeps every print read"],
  ["lit-no-floor", [["if (floor !== null && prem.cents < floor) { below++; continue; }", ""]], "under the floor is left out"],
  ["first-aggressive-no-clause", [[" && FLOWLAB_LIMITS.firstAggressiveShareDen * q.va >= cumVol", ""]], "10% clause"],
];

for (const [id, transforms, expect] of PLANTS) {
  const mod = await loadMutated("shared/flows-flowlab.js", transforms);
  const problems = battery(mod);
  ok(problems.length > 0, "PLANTED BUILD " + id + " must fail the battery");
  ok(problems.some((p) => p.includes(expect)), "PLANTED BUILD " + id + " fails its named check (" + expect + "): " + problems.slice(0, 3).join(" | "));
}

{
  const sentences = [];
  for (const [k, v] of Object.entries(COPY.STATES)) sentences.push([k, v]);
  for (const s of COPY.SENTENCES) sentences.push(["copy", s]);
  for (const [, s] of sentences) {
    const text = COPY.fill(s, { date: "2026-10-23", TRT: "21:30", T: "SYX101", n: 3, what: "rows", status: 503, pct: "72%", step: "0.50", w: "0.50" });
    eq(lintText(text), [], "copy lint: " + text);
    eq(tooLong(text, 14), null, "copy within 14 words: " + text);
    ok(!/vendor|unusual whales|tape/i.test(text), "copy names no provider and no tape: " + text);
  }
  for (const f of ["shared/flows-flowlab.js", "shared/flows-flowlab-copy.js", "tests/gen-flowlab-fixtures.py"]) {
    ok(!/\btape\b/i.test(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/shared\/flows-tape-stats\.js|flows-tape-stats|tape-stats/g, "")), f + " holds the word tape nowhere");
  }
  eq(Object.keys(COPY.STATES).sort(), ["candidate", "choose-ticker", "choose-ticker-codes", "closed", "earlier", "failed", "feed_limited", "few-prints", "kept", "lean-undecided", "loading", "min-volume", "net-undecided",
    "network", "no-expiry-in-rows", "no-oi", "no-unit", "not-optionable", "not-session", "off", "plan", "quiet", "rate_limited", "reading-groups", "status_4xx", "status_5xx", "throttled", "timeout", "too_large", "unconfigured", "unparsable", "unshaped"].sort(), "the states of the spec and of each read class");
  for (const code of Object.keys(COPY.STATES)) ok(COPY.STATE_CHIPS[code] && COPY.STATE_MAP[code], "state " + code + " has a chip and a module state");
  for (const cls of BUILD.READ_CLASSES) ok(COPY.STATES[COPY.CLASS_STATES[cls]], "read class " + cls + " has a sentence");
  for (const why of REAL.REASONS.filter((r) => r !== "unshaped")) ok(COPY.STATES[COPY.WHY_STATES[why]], "reason " + why + " has a sentence");
  for (const code of Object.values(BUILD.HARD_CODES)) ok(code === "chain_upstream" || COPY.STATES[COPY.ERROR_STATES[code]], "error " + code + " has a sentence");
  eq(COPY.fill(COPY.STATES.status_5xx, { status: 503 }), "The feed answered with an error, status 503.", "the 5xx sentence names its status");
  eq(COPY.fill(COPY.STATES.status_4xx, { status: 400 }), "The feed refused this request, status 400.", "the 4xx sentence names its status");
  eq(COPY.TABS.map((t) => t.label), ["Screen", "Strikes", "Greeks", "Ladders", "Routing", "Lit prints", "Groups", "Relations"], "the eight tabs");
  eq(COPY.DRILL_TABS.map((t) => t.label), ["Prints", "Minutes", "Profile", "Alerts", "Structure", "Routing"], "the six drill tabs");
}

{
  const { UA_BANNED_CLAIMS } = await import("../shared/flows-unusual.js");
  const claims = (copy) => [...JSON.stringify(copy.drillCopy()).matchAll(new RegExp(UA_BANNED_CLAIMS.source, "ig"))].map((m) => m[0]);
  eq(claims(COPY), [], "the drill copy, which the Unusual, ticker and Moves pages carry, names no word the Unusual page refuses to claim");
  const planted = await loadMutated("shared/flows-flowlab-copy.js", [["\"Choose a ticker to read its codes.\"", "\"Choose a ticker to read its trade codes.\""]]);
  ok(claims(planted).length > 0, "planted build: a drill sentence that names a trade is caught");
  const dated = (copy) => [...JSON.stringify(copy.drillCopy()).matchAll(/\b(today|this session|the day's|the day\u2019s)\b/ig)].map((m) => m[0]);
  eq(dated(COPY), [], "and it dates nothing those pages count: no today, this session or the day's");
  const plantedDated = await loadMutated("shared/flows-flowlab-copy.js", [["the newer read is not in", "today's read is not in"]]);
  ok(dated(plantedDated).length > 0, "planted build: a drill sentence that says today is caught");
}

{
  const title = COPY.LABELS.litMarket;
  const usd = (v) => "$" + (v >= 1e6 ? v / 1e6 + "M" : v / 1e3 + "K");
  ok(title.includes(usd(BUILD.LIT_MIN_PREMIUM)) && COPY.NOTES.litMarket.includes(usd(BUILD.LIT_MIN_PREMIUM)), "the lit title and note name the premium floor the read asks for (" + title + ")");
  ok(/newest/.test(COPY.NOTES.litMarket) && /ranked by premium/.test(COPY.NOTES.litMarket), "the lit note says the read is the newest prints, ranked here by premium");
  ok(BUILD.LIT_LIMIT === REAL.FLOWLAB_LIMITS.litMarket, "the lit list keeps as many prints as the read asks for");
  const shell = async (mod) => mod.flowlabBody(() => "");
  const html = await shell({ flowlabBody });
  ok(html.includes(">" + title.replace(/\$/g, "$") + "</h2>") && !/Largest lit prints/.test(html), "the module title is the read's own");
  const planted = await loadMutated("shared/flows-page-flowlab.js", [["mod(\"flLitMarket\", LABELS.litMarket", "mod(\"flLitMarket\", \"Largest lit prints\""]]);
  const wrong = await shell(planted);
  ok(!(wrong.includes(">" + title + "</h2>") && !/Largest lit prints/.test(wrong)), "PLANTED BUILD lit-title-largest fails the title check");
}

{
  const prov = FX.provenance;
  const sha = async (rel) => (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
  eq(prov.generatorSha256, await sha("tests/gen-flowlab-fixtures.py"), "the fixture file was written by the generator as committed");
  eq(prov.specSha256, await sha("docs/uw-openapi.yaml"), "and from the committed spec");
  eq(prov.shapesSha256, await sha("scripts/flows-probe-shapes.json"), "and the committed shape manifest");
  ok(/not observed on the wire/.test(prov.source), "the source says the bodies are not observed");
  ok(/not vendor data/.test(prov.nature), "and that they are not vendor data");
  const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
  const assumed = Object.entries(FX.entries).filter(([, e]) => e.shape === "assumed").map(([k]) => k).sort();
  eq(assumed, ["analytics-sliding", "analytics-window"], "the two analytics bodies are assumed shapes");
  ok(/FLOWS_FLOWLAB\s*=\s*"on"/.test(wrangler) && /FLOWS_FLOWLAB_ANALYTICS\s*=\s*"on"/.test(wrangler),
    "the page switch and the analytics switch ship on for every member: while a shape is assumed, an answer that differs is withheld as unshaped and a refusal is stored as not on this plan, each said in words");
  ok(/FLOWS_FLOWLAB_ANALYTICS: \$\{\{ vars\.FLOWS_FLOWLAB_ANALYTICS \|\| 'on' \}\}/.test(fs.readFileSync(new URL("../.github/workflows/flows-pipeline.yml", import.meta.url), "utf8")),
    "and the nightly that reads it runs it on unless the repository variable says otherwise");
  for (const [world, bodies] of Object.entries(FX.worlds)) for (const key of Object.keys(bodies)) ok(!/SPY/.test(JSON.stringify(bodies[key])) || key.startsWith("analytics") || world === "plan", world + "/" + key + " names SPY only in analytics");
}

console.log(`flows-flowlab: ${checks} checks`);

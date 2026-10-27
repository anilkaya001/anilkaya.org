import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { holdsAndPlants } from "./lib/ff-a-kit.mjs";
import { COPY_BANNED, TEMPLATES, HEALTH_RULES, base32Lower, absentLine } from "../shared/ff-contract.js";
import { FORECAST_ALT, MODAL_ALT, guardText } from "../shared/flows-ask.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures-ff-contract.json", import.meta.url), "utf8"));
const sha = (b) => createHash("sha256").update(b).digest();
const t = (iso) => Date.parse(iso);

const refBase32 = (bytes) => {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const pad = (5 - ((bytes.length * 8) % 5)) % 5;
  n <<= BigInt(pad);
  const groups = (bytes.length * 8 + pad) / 5;
  let out = "";
  for (let i = groups - 1; i >= 0; i--) out += "abcdefghijklmnopqrstuvwxyz234567"[Number((n >> BigInt(5 * i)) & 31n)];
  return out;
};

const lexicon = new RegExp("\\b(?:" + FORECAST_ALT + "|" + MODAL_ALT + ")\\b", "i");
const bannedWord = (s, w) => new RegExp("(^|[^a-z])" + w + "([^a-z]|$)", "i").test(s);

function idVectors(M, R) {
  const I = M.ids;
  const hexOf = (b) => Buffer.from(b).toString("hex");
  const known = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ];
  for (const [text, want] of known) R.eq(I.sha256Hex(text), want, "NIST vector " + text.slice(0, 12));
  if (R.heavy) R.eq(I.sha256Hex("a".repeat(1000000)), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "NIST one million a");
  for (let n = 0; n <= 300; n++) {
    const b = randomBytes(n);
    R.eq(hexOf(I.sha256(b)), sha(b).toString("hex"), "sha256 against node:crypto at length " + n);
  }
  for (const text of ["é€😀", "ünïcödé wire", "\u0000\u0001", "日本語のティッカー"]) {
    R.eq(I.sha256Hex(text), sha(Buffer.from(text, "utf8")).toString("hex"), "utf-8 text " + text);
  }
  R.eq(hexOf(I.sha256(new Uint8Array([0xff, 0x00, 0x80]))), sha(Buffer.from([0xff, 0x00, 0x80])).toString("hex"), "bytes in");
  for (const edge of [55, 56, 63, 64, 65, 119, 120, 121, 127, 128]) {
    const b = Buffer.alloc(edge, 0x61);
    R.eq(I.sha256Hex(b), sha(b).toString("hex"), "padding edge " + edge);
  }
  R.eq(base32Lower(sha("abc")).slice(0, 20), "xj4bnp4pahh6uqkbidpf", "base32 of sha256(abc)");
  R.eq(refBase32(sha("abc")).slice(0, 20), "xj4bnp4pahh6uqkbidpf", "reference base32");
  const idv = fixtures.ids;
  for (const k of idv.keys) {
    const key = I.keyFor({ layer: k.layer, subject: k.subject, session: k.session, clauseHash: k.clauseHash, revision: k.revision });
    R.eq(key, k.key, "dedupe key " + k.key);
    const wire = k.layer === "house" ? (k.subject.startsWith("s:") ? "h-t08" : "h-t05") : idv.memberWire;
    R.eq(I.hitId(wire, key), k.hitId, "hit id " + k.hitId);
    R.eq(refBase32(sha(wire + "|" + key)).slice(0, 20), k.hitId, "reference hit id " + k.hitId);
  }
  R.eq(I.keyFor({ layer: "house", subject: "n:SYA101", session: "2026-03-09", clauseHash: "0123456789" }), "n:SYA101:2026-03-09", "a house key never carries a clause hash");
  R.eq(I.clauseHash(idv.clauses), idv.clauseHash, "clause hash");
  R.eq(I.clauseHash(idv.reversed), idv.clauseHash, "clause order does not move the clause hash");
  R.eq(I.astHash(idv.bodyDerived), idv.astHash, "ast hash");
  R.ok(I.hitId("w-abcdefghij234567", "n:AAA:2026-03-09:0123456789") !== I.hitId("w-abcdefghij234567", "n:BBB:2026-03-09:0123456789"), "different keys, different ids");
  R.ok(/^[a-z2-7]{20}$/.test(I.hitId("h-t01", "u:2026-03-09")), "a hit id is twenty base32 characters");
  const w = I.memberWireId(Uint8Array.from({ length: 10 }, (_, i) => i * 25));
  R.ok(/^w-[a-z2-7]{16}$/.test(w), "a member wire id has the table's shape: " + w);
  R.ok(I.WIRE_ID_RE.test(w) && I.WIRE_ID_RE.test("h-t07a") && !I.WIRE_ID_RE.test("w-short"), "wire id grammar");
  let threw = false;
  try {
    I.memberWireId(new Uint8Array(9));
  } catch {
    threw = true;
  }
  R.ok(threw, "nine bytes are not a wire id");
  R.ok(new Set(Array.from({ length: 50 }, () => I.memberWireId())).size === 50, "random wire ids are distinct");
}

async function asyncVectors(M, R) {
  const I = M.ids;
  for (const text of ["abc", "é€😀", ""]) {
    const subtle = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    R.eq(Buffer.from(await I.sha256Async(text)).toString("hex"), Buffer.from(subtle).toString("hex"), "the async digest equals subtle: " + text);
  }
}

function sessionVectors(M, R) {
  const S = M.session;
  for (const v of fixtures.labels) R.eq(S.sessionLabel(v.day, t(v.asOf)), v.label, "session label " + v.label);
  R.eq(S.sessionLabel("2026-03-09", t("2026-03-09T13:42:59Z")), "open+12m", "a label floors to the minute");
  R.eq(S.sessionLabel("2026-03-09", t("2026-03-09T20:00:30Z")), "close", "the close lasts its minute");
  R.eq(S.sessionLabel("2026-03-09", t("2026-03-09T20:01:00Z")), "post-close", "the minute after is post-close");
  R.eq(S.sessionLabel("2026-03-09", t("2026-03-09T13:30:00Z")), "open+0m", "the open minute");
  R.eq(S.sessionLabel("2026-03-06", t("2026-03-06T14:42:00Z")), "open+12m", "winter open+12m");
  R.eq(S.sessionLabel("2026-11-27", t("2026-11-27T18:00:00Z")), "close", "early close is the close");
  R.eq(S.sessionLabel("2026-03-07", t("2026-03-07T15:00:00Z")), null, "a weekend has no labels");
  R.eq(S.sessionLabel("2026-03-09", NaN), null, "no instant, no label");
  R.eq(S.timeLine("2026-03-09", t("2026-03-09T13:42:00Z")).text, "16:42 TRT · open+12m", "the time line");
  R.eq(S.timeLine("2026-03-06", t("2026-03-06T14:42:00Z")).text, "17:42 TRT · open+12m", "the same minute after the open in winter reads an hour later");
  R.eq(S.timeLine("2026-03-06", t("2026-03-07T00:00:00Z")).text, "03:00 TRT · post-close", "after 21:00 UTC is post-close");
  R.eq(S.timeLine("2026-03-06", t("2026-03-06T21:00:00Z")).text, "00:00 TRT · close", "winter close is midnight TRT");
  const winter = S.marketPhase(t("2026-03-06T14:00:00Z"));
  const summer = S.marketPhase(t("2026-03-09T14:00:00Z"));
  R.eq([winter, summer], ["closed", "open"], "H7 17:00 TRT is closed on 2026-03-06 and open on 2026-03-09");
  const healthy = { liveAgeS: 120, nightlyLate: 0, error: false };
  R.eq(S.healthState({ phase: winter, ...healthy }), "resting", "H7 the mark rests at 17:00 TRT in winter");
  R.eq(S.healthState({ phase: summer, ...healthy }), "live", "H7 the mark is live at 17:00 TRT in summer");
  for (const v of fixtures.health) R.eq(S.healthState(v, HEALTH_RULES), v.want, "health " + JSON.stringify(v));
  R.eq(S.healthState({ phase: "open", liveAgeS: 600, nightlyLate: 0, error: false }), "live", "600 s is the last live second");
  R.eq(S.healthState({ phase: "open", liveAgeS: 601, nightlyLate: 0, error: false }), "degraded", "601 s is degraded");
  R.eq(S.healthState({ phase: "open", liveAgeS: 900, nightlyLate: 0, error: false }), "degraded", "900 s is the last degraded second");
  R.eq(S.healthState({ phase: "open", liveAgeS: 901, nightlyLate: 0, error: false }), "down", "901 s is down");
  R.eq(S.healthState({ phase: "open", liveAgeS: 10, nightlyLate: 0, error: true }), "degraded", "an error is degraded");
  R.eq(S.healthState({ phase: "weekend", liveAgeS: 10, nightlyLate: 0, error: false }), "unknown", "an unknown phase is unknown");
  R.eq(S.healthState({ phase: "open", liveAgeS: NaN, nightlyLate: 0, error: false }), "unknown", "no heartbeat age while open is unknown");
  R.eq(S.healthState({ phase: "closed", liveAgeS: null, nightlyLate: NaN, error: false }), "unknown", "no nightly state is unknown");
  const days = ["2026-03-06", "2026-03-09", "2026-03-10", "2026-04-02", "2026-04-06", "2026-11-25", "2026-11-27", "2026-11-30"];
  R.eq(S.sessionsBetween("2026-03-06", "2026-03-09"), 1, "Friday to Monday is one session");
  R.eq(S.sessionsBetween("2026-03-09", "2026-03-06"), -1, "and back is minus one");
  R.eq(S.sessionsBetween("2026-03-09", "2026-03-09"), 0, "the same day is zero");
  R.eq(S.sessionsBetween("2026-04-02", "2026-04-06"), 1, "Good Friday is not a session");
  R.eq(S.sessionsBetween("2026-11-25", "2026-11-30"), 2, "Thanksgiving is not a session, the Friday is");
  R.eq(S.addSessions("2026-04-02", 1), "2026-04-06", "one session after Holy Thursday is Monday");
  R.eq(S.addSessions("2026-03-09", 5), "2026-03-16", "five sessions is a week");
  R.eq(S.addSessions("2026-03-09", -1), "2026-03-06", "one back");
  R.eq(S.addSessions("2026-03-09", 0), "2026-03-09", "zero is the day itself");
  R.eq(S.addSessions("2026-11-25", 1), "2026-11-27", "Thanksgiving is skipped");
  R.eq(S.isSession("2026-04-03"), false, "Good Friday is not a session");
  R.eq(S.isSession("2026-03-07"), false, "Saturday is not a session");
  R.eq(S.isSession("2026-03-09"), true, "Monday is a session");
  R.eq(S.prevSession("2026-03-09"), "2026-03-06", "previous session");
  R.eq(S.nextSession("2026-03-06"), "2026-03-09", "next session");
  for (const d of days) R.eq(S.addSessions(d, 3), S.addSessions(S.addSessions(d, 1), 2), "addSessions composes from " + d);
  R.eq(S.priorSessions("2026-03-09", 3), ["2026-03-06", "2026-03-05", "2026-03-04"], "prior sessions newest first");
  R.eq(S.lateSessions("2026-03-09", "2026-03-06"), 1, "one session late");
  R.eq(S.lateSessions("2026-03-09", "2026-03-05"), 2, "two sessions late");
  R.eq(S.lateSessions("2026-03-09", "2026-03-09"), 0, "on time");
  R.eq(S.lateSessions("2026-03-09", null), null, "no record, no lateness");
  R.eq(S.sessionOf(t("2026-03-09T13:42:00Z")), "2026-03-09", "midday belongs to its session");
  R.eq(S.sessionOf(t("2026-03-09T22:00:00Z")), "2026-03-09", "after hours belongs to the same session");
  R.eq(S.sessionOf(t("2026-03-10T07:00:00Z")), "2026-03-09", "before 04:00 ET belongs to the last session");
  R.eq(S.sessionOf(t("2026-03-08T15:00:00Z")), "2026-03-06", "a Sunday belongs to Friday");
  const nightlyS = S.firstCheck("nightly", t("2026-03-09T13:42:00Z"));
  R.eq([nightlyS.session, nightlyS.trt, nightlyS.label, nightlyS.at], ["2026-03-09", "00:30 TRT", "scheduled", t("2026-03-09T21:30:00Z")], "nightly first check under summer time");
  const nightlyW = S.firstCheck("nightly", t("2026-03-05T13:42:00Z"));
  R.eq([nightlyW.trt, nightlyW.at], ["01:30 TRT", t("2026-03-05T22:30:00Z")], "nightly first check under winter time");
  const nightlyLate = S.firstCheck("nightly", t("2026-03-09T22:00:00Z"));
  R.eq([nightlyLate.session, nightlyLate.at], ["2026-03-10", t("2026-03-10T21:30:00Z")], "after 17:30 ET the next night is meant");
  R.eq(S.firstCheck("nightly", t("2026-03-06T23:00:00Z")).session, "2026-03-09", "a Friday evening waits for Monday");
  const live = S.firstCheck("live", t("2026-03-09T13:42:00Z"));
  R.eq([live.trt, live.session], ["16:45 TRT", "2026-03-09"], "live first check on the next five minutes");
  R.eq(S.firstCheck("live", t("2026-03-09T13:00:00Z")).at, t("2026-03-09T13:35:00Z"), "never before 09:35 ET");
  R.eq(S.firstCheck("live", t("2026-03-09T21:42:00Z")).session, "2026-03-10", "after the close, tomorrow");
  R.eq(S.firstCheck("live", t("2026-03-06T23:00:00Z")).session, "2026-03-09", "Friday evening waits for Monday");
  R.eq(S.firstCheck("live", t("2026-03-06T23:00:00Z")).at, t("2026-03-09T13:35:00Z"), "Monday's first live check is 09:35 ET, 16:35 TRT");
  R.eq(S.firstCheck("live", t("2026-03-09T13:42:00Z"), { periodMin: 15 }).at, t("2026-03-09T13:45:00Z"), "a fifteen-minute loop");
  R.eq(S.firstCheck("rail", t("2026-03-09T13:42:00Z")), null, "the rail has no first check");
  R.eq(S.effectiveSession("nightly", t("2026-03-09T13:42:00Z")), "2026-03-09", "a wire armed in the afternoon starts tonight");
  R.eq(S.effectiveSession("live", t("2026-03-09T21:42:00Z")), "2026-03-10", "a live wire armed after the close starts tomorrow");
  R.eq(S.nightlyDeadline("2026-03-09"), t("2026-03-10T00:30:00Z"), "20:30 ET in summer is 00:30Z");
  R.eq(S.nightlyDeadline("2026-03-06"), t("2026-03-07T01:30:00Z"), "20:30 ET in winter is 01:30Z");
  R.eq(S.nightlyFinal("2026-03-06"), t("2026-03-09T13:30:00Z"), "final at the next open");
  R.eq(S.nightlyAsOf("2026-03-09"), t("2026-03-09T20:00:00Z"), "a nightly is as of the close");
  R.eq(S.nightlyAsOf("2026-11-27"), t("2026-11-27T18:00:00Z"), "an early close is as of 13:00 ET");
  R.eq(S.expectedLooks("2026-03-09", t("2026-03-09T13:34:00Z")), 0, "no ticks before 09:35");
  R.eq(S.expectedLooks("2026-03-09", t("2026-03-09T13:35:00Z")), 1, "the first tick");
  R.eq(S.expectedLooks("2026-03-09", t("2026-03-09T14:00:00Z")), 6, "six ticks by 10:00 ET");
  R.eq(S.expectedLooks("2026-03-09", t("2026-03-09T23:00:00Z")), 78, "78 five-minute ticks from 09:35 to the close");
  const rng = (() => { let a = 7; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; })();
  const two = "2-" + "dig" + "it";
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: two, day: two, hour: two, minute: two });
  let compared = 0;
  for (let i = 0; i < 4000; i++) {
    const ms = t("2026-01-02T00:00:00Z") + Math.floor(rng() * 365 * 86400000);
    const p = Object.fromEntries(fmt.formatToParts(ms).map((x) => [x.type, x.value]));
    const etDay = p.year + "-" + p.month + "-" + p.day;
    if (etDay === "2026-11-27" || etDay === "2026-12-24") continue;
    const minutes = (Number(p.hour) % 24) * 60 + Number(p.minute);
    const expected = S.isSession(etDay) && minutes >= 570 && minutes < 960 ? "open" : "closed";
    R.eq(S.marketPhase(ms), expected, "the phase against the Intl clock at " + new Date(ms).toISOString());
    compared++;
  }
  R.ok(compared > 3900, "the phase was compared with the Intl clock on many instants");
}

function sentenceVectors(M, R) {
  const N = M.sentence;
  const V = [
    [999950, "usd", "$1.00M"], [1240000, "usd", "$1.24M"], [500000, "usd", "$500K"], [-1500000, "usd", "−$1.50M"], [50000, "usd", "$50.0K"],
    [3.1, "sigma", "3.10σ"], [-2.5, "sigma", "−2.50σ"], [3, "sigma", "3.00σ"], [1.2, "vol_pt", "1.2 pts"], [4.55, "pct", "4.6%"],
    [87, "pctile", "87th"], [1, "pctile", "1st"], [2, "pctile", "2nd"], [3, "pctile", "3rd"], [11, "pctile", "11th"], [12, "pctile", "12th"],
    [13, "pctile", "13th"], [21, "pctile", "21st"], [101, "pctile", "101st"], [111, "pctile", "111th"], [0.855, "ratio", "0.86"], [1.5, "ratio", "1.50"],
    [1, "sessions", "1 session"], [10, "sessions", "10 sessions"], [1, "days", "1 day"], [21, "days", "21 days"], [1, "bool", "yes"], [0, "bool", "no"],
    [12345, "contracts", "12,345"], [5, "contracts", "5"],
  ];
  for (const [v, u, want] of V) R.eq(N.formatValue(v, u), want, `formatValue(${v}, ${u})`);
  for (const u of ["usd", "contracts", "sigma", "vol_pt", "pct", "pctile", "ratio", "sessions", "days", "bool"]) {
    R.eq(N.formatValue(null, u), "—", "an absent " + u + " is an em dash");
    R.eq(N.formatValue(NaN, u), "—", "NaN " + u + " is an em dash");
  }
  R.eq(N.clauseText("earn.confirmed", "==", 1), "report date confirmed", "a bool clause reads as its label");
  R.eq(N.clauseText("earn.confirmed", "==", 0), "not report date confirmed", "a false bool clause");
  R.eq(N.clauseText("flow.net_premium.z20", ">=", 3), "net premium z ≥ 3.00σ", "an anomaly clause");
  R.eq(N.clauseText("contract.dte", "<=", 21), "days to expiry ≤ 21 days", "a days clause");
  R.eq(N.clauseText("nope", ">=", 1), null, "an unknown metric has no text");
  const universe = { kind: "universe" };
  R.eq(N.scopeText(universe), "on any name in the universe", "universe scope");
  R.eq(N.scopeText({ kind: "sector", sector: "Energy" }), "on any name in the Energy sector", "sector scope");
  R.eq(N.scopeText({ kind: "names", symbols: ["SYA101", "SYB202"] }), "on SYA101, SYB202", "names scope");
  R.eq(N.scopeText({ kind: "names", symbols: ["SYA101", "SYB202", "SYC303", "SYD404", "SYE505"] }), "on SYA101, SYB202, SYC303 and 2 more names", "long names scope");
  R.eq(N.scopeText(universe, "s"), "on any sector in the universe", "sector subject");
  R.eq(N.scopeText({ kind: "sector", sector: "Energy" }, "s"), "in the Energy sector", "one sector");
  R.eq(N.scopeText(universe, "c"), "on any flagged option window in the universe", "window subject");
  const lintTexts = [];
  for (const tpl of TEMPLATES) {
    if (!tpl.ast) continue;
    const bodies = tpl.variants ? tpl.variants.map((v) => ({ ...tpl.ast, all: v.clauses })) : [tpl.ast];
    for (const b of bodies) {
      for (const sk of ["n", "s", "c"]) lintTexts.push(N.wireSentence(b, sk), N.titleOf(b, sk));
      R.ok(N.wireSentence(b, "n").length <= 280, "a wire sentence fits 280 characters: " + tpl.id);
      R.ok(N.titleOf(b, "n").length <= 80, "a title fits 80 characters: " + tpl.id);
    }
  }
  const long = { ...TEMPLATES[0].ast, all: Array.from({ length: 8 }, (_, i) => ({ m: i % 2 ? "earn.sessions" : "flow.net_premium.z20", op: i % 2 ? "<=" : ">=", x: i % 2 ? 10 : 3 })), scope: { kind: "names", symbols: ["SYA101", "SYB202"] }, persist: 3 };
  R.ok(N.wireSentence(long, "n").length <= 280, "an eight clause sentence is cut to 280");
  lintTexts.push(N.wireSentence({ ...TEMPLATES[2].ast, persist: 3 }, "c"), N.wireSentence({ ...TEMPLATES[0].ast, persist: 2, cooldown: { unit: "session", n: 1 } }, "n"));
  lintTexts.push(N.wireSentence({ ...TEMPLATES[0].ast, persist: 2, cooldown: { unit: "session", n: 20 }, scope: { kind: "sector", sector: "Utilities" } }, "n"));
  lintTexts.push(N.unknownText("warming", "baseline 11/20 sessions"), N.baselineText(11), N.receiptText({ status: "not_evaluated", reason: "run_late" }));
  lintTexts.push(N.receiptText({ status: "evaluated", namesEvaluated: 840, namesAbsent: 10, reason: "record_truncated" }), N.receiptText({ status: "evaluated", namesEvaluated: 1, namesAbsent: 0, reason: null }));
  for (const text of lintTexts) {
    R.ok(!lexicon.test(guardText(text)), "no forecast or modal word in: " + text);
    for (const w of COPY_BANNED) R.ok(!bannedWord(text, w), `the banned word ${w} is absent from: ${text}`);
    R.eq(N.bannedIn(text), [], "bannedIn agrees");
    R.ok(!/\bTRT\b/.test(text) || /\d{2}:\d{2} TRT/.test(text), "TRT only follows a clock time");
  }
  R.eq(N.bannedIn("this wire will fire and the order is bullish"), ["order", "bullish", "will"], "bannedIn finds the words");
  R.eq(N.unknownText("warming", "baseline 11/20 sessions"), "— warming: baseline 11/20 sessions", "H3 the warming line");
  R.eq(N.baselineText(11), "— warming: baseline 11/20 sessions", "the baseline line");
  R.eq(N.unknownText("stale"), absentLine("stale"), "an unknown line is the contract's");
  R.eq(N.receiptText({ status: "not_evaluated", reason: "run_late" }), "— not evaluated: run late", "a missed run is never 'no hit'");
  R.eq(N.receiptText({ status: "evaluated", namesEvaluated: 848, namesAbsent: 2, reason: null }), "848 names evaluated, 2 without data", "an evaluated receipt");
  R.eq(N.receiptText({ status: "evaluated", namesEvaluated: 1, namesAbsent: 0, reason: null }), "1 name evaluated", "singular");
  R.eq(N.verbFor({ subject: "window", op: ">=" }, 1), "appeared", "a flagged window appeared");
  R.eq(N.verbFor({ subject: "ticker", op: ">=" }, 1), "crossed above", "crossed above");
  R.eq(N.verbFor({ subject: "ticker", op: "<=" }, 1), "crossed below", "crossed below");
  R.eq(N.verbFor({ subject: "ticker", op: "==" }, 1), "entered", "entered");
  R.eq(N.verbFor({ subject: "ticker", op: ">=" }, 2), "reached", "reached after persistence");
  const ev = (over) => ({
    v: 1, wire: "w-aaaaaaaaaaaaaaaa", version: 1, layer: "member", subject: "n:SYA101", symbol: "SYA101", session: "2026-03-09", asOf: t("2026-03-09T13:42:00Z"),
    firedAt: t("2026-03-09T13:42:12Z"), persist: 1, wireSentence: "When net premium z ≥ 3.00σ.", lead: 0,
    clauses: [{ m: "flow.net_premium.z20", label: "net premium z", unit: "sigma", subject: "ticker", op: ">=", x: 3, value: 3.42, ok: true }], ...over,
  });
  const a = N.renderHit(ev({}));
  R.eq(a.sentence, "SYA101 net premium z crossed above 3.42σ (≥ 3.00σ) · 16:42 TRT · open+12m", "the hit sentence");
  R.eq([a.clock, a.label, a.latencyS, a.session], ["16:42 TRT", "open+12m", 12, "2026-03-09"], "clock, label and the latency apart");
  R.eq(a.rows[0], { m: "flow.net_premium.z20", label: "net premium z", value: "3.42σ", op: "≥", threshold: "3.00σ", ok: true, floored: false, baseline: null }, "the clause table row");
  const old = N.renderHit(ev({ wireSentence: "When net premium z ≥ 3.00σ.", clauses: [{ m: "flow.net_premium.z20", label: "net premium z", unit: "sigma", subject: "ticker", op: ">=", x: 3, value: 3.42, ok: true }] }));
  const adjusted = N.renderHit(ev({ version: 2, wireSentence: "When net premium z ≥ 4.00σ.", clauses: [{ m: "flow.net_premium.z20", label: "net premium z", unit: "sigma", subject: "ticker", op: ">=", x: 4, value: 4.1, ok: true }] }));
  R.ok(old.sentence.includes("(≥ 3.00σ)") && old.wireSentence.includes("3.00σ"), "H12 an old hit renders the threshold it fired on");
  R.ok(adjusted.sentence.includes("(≥ 4.00σ)") && adjusted.wireSentence.includes("4.00σ"), "H12 the adjusted wire renders its own");
  const win = N.renderHit(ev({ subject: "c:SYA101:SYA101260918C00100000", occ: "SYA101260918C00100000", clauses: [{ m: "contract.premium", label: "window premium", unit: "usd", subject: "window", op: ">=", x: 1000000, value: 1240000, ok: true }] }));
  R.eq(win.sentence, "SYA101 SYA101260918C00100000 window premium appeared $1.24M (≥ $1.00M) · flagged by the data vendor · 16:42 TRT · open+12m", "a flagged window hit");
  const floored = N.renderHit(ev({ clauses: [{ m: "flow.net_premium.z20", label: "net premium z", unit: "sigma", subject: "ticker", op: ">=", x: 3, value: 50, ok: true, floored: true, n: 20, window: 20 }] }));
  R.eq([floored.rows[0].floored, floored.rows[0].baseline], [true, "20/20 sessions"], "H2 the table says the denominator was floored");
  const none = N.renderHit(ev({ firedAt: undefined }));
  R.eq(none.latencyS, null, "no fired time, no latency");
  R.ok(!/\b0\.00%|\bNaN\b|undefined|null/.test([a.sentence, ...a.rows.flatMap((r) => [r.value, r.threshold])].join(" ")), "H13 no zero or NaN stands in for an absent figure");
}

async function battery(M, R) {
  idVectors(M, R);
  await asyncVectors(M, R);
  sessionVectors(M, R);
  sentenceVectors(M, R);
}

const S = "ff-session";
const D = "ff-sentence";
const I = "ff-ids";
const plants = [
  { name: "the open hard-coded at 16:30 TRT", target: S, transforms: [["return p && p.phase === \"rth\" ? \"open\" : \"closed\";", "const h = new Date(ms + 3 * 3600000);\n  const m = h.getUTCHours() * 60 + h.getUTCMinutes();\n  return m >= 990 && m < 1380 ? \"open\" : \"closed\";"]] },
  { name: "a label rounded to the nearest minute", target: S, transforms: [["const m = Math.floor((ms - b.open.ms) / MINUTE);", "const m = Math.round((ms - b.open.ms) / MINUTE);"]] },
  { name: "a close that lasts no minute", target: S, transforms: [["if (ms >= b.close.ms + MINUTE) return \"post-close\";\n  if (ms >= b.close.ms) return \"close\";", "if (ms > b.close.ms) return \"post-close\";\n  if (ms >= b.close.ms) return \"close\";"]] },
  { name: "a live heartbeat allowed three cadences", target: S, transforms: [["liveAgeS > rules.liveMaxAgeFactor * rules.liveCadenceS", "liveAgeS > 3 * rules.liveCadenceS"]] },
  { name: "an error that is not degraded", target: S, transforms: [["nightlyLate >= rules.nightlyDegradedLateSessions || error === true ||", "nightlyLate >= rules.nightlyDegradedLateSessions ||"]] },
  { name: "a missing nightly state read as healthy", target: S, transforms: [["if (!Number.isFinite(nightlyLate) || (open && !Number.isFinite(liveAgeS))) return \"unknown\";", "if (open && !Number.isFinite(liveAgeS)) return \"unknown\";"]] },
  { name: "sessions counted from the day itself", target: S, transforms: [["let d = from;\n  let n = 0;", "let d = from;\n  let n = 1;"]] },
  { name: "holidays treated as sessions", target: S, transforms: [["import {\n  easternDay, easternInstant, isTradingDay,", "import {\n  isWeekdayDay, easternDay, easternInstant, isTradingDay,"], ["export const isSession = (day) => typeof day === \"string\" && DAY_RE.test(day) && isTradingDay(day, null);", "export const isSession = (day) => typeof day === \"string\" && DAY_RE.test(day) && isWeekdayDay(day);"]] },
  { name: "the nightly first check fixed at 21:30 UTC", target: S, transforms: [["return today ? { day: today, at: easternInstant(today, minutes) } : null;", "return today ? { day: today, at: Date.parse(today + \"T21:30:00Z\") } : null;"]] },
  { name: "a nightly first check in the past", target: S, transforms: [["isTradingDay(day, null) && ms < easternInstant(day, minutes) ? day", "isTradingDay(day, null) ? day"]] },
  { name: "a live check before 09:35", target: S, transforms: [["const at = Math.ceil(Math.max(cursor, lo) / period) * period;", "const at = Math.ceil(cursor / period) * period;"]] },
  { name: "a nightly as of the open", target: S, transforms: [["export const nightlyAsOf = (session) => (isSession(session) ? sessionClose(session, null) : NaN);", "export const nightlyAsOf = (session) => (isSession(session) ? sessionOpen(session) : NaN);"]] },
  { name: "a deadline at 20:30 UTC", target: S, transforms: [["export const nightlyDeadline = (session) => (isDay(session) ? easternInstant(session, NIGHTLY_DEADLINE_MIN) : NaN);", "export const nightlyDeadline = (session) => (isDay(session) ? Date.parse(session + \"T20:30:00Z\") : NaN);"]] },
  { name: "lateness counted from the wrong end", target: S, transforms: [["if (lastOk >= expected) return 0;\n  return sessionsBetween(lastOk, expected);", "if (lastOk >= expected) return 0;\n  return sessionsBetween(lastOk, expected) - 1;"]] },
  { name: "a time line with the label first", target: S, transforms: [["text: sessionLabelText(clock(asOf, false), label)", "text: label + \" · \" + clock(asOf)"]] },
  { name: "a sha256 with the wrong length word", target: I, transforms: [["view.setUint32(padded.length - 4, (len * 8) >>> 0, false);", "view.setUint32(padded.length - 4, (len * 8 + 8) >>> 0, false);"]] },
  { name: "a sha256 padded one block short", target: I, transforms: [["const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);", "const padded = new Uint8Array(((len + 8 + 63) >> 6) << 6);"]] },
  { name: "text hashed as latin-1", target: I, transforms: [["export const utf8 = (text) => new TextEncoder().encode(text);", "export const utf8 = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 255);"]] },
  { name: "the hit id taken from 15 characters", target: I, transforms: [[".slice(0, ID_RULES.hitIdLength);", ".slice(0, 15);"]] },
  { name: "the evaluator in the dedupe key", target: I, transforms: [["return dedupeKey({ layer, subject, session, clauseHash: layer === \"member\" ? ch : null, revision });", "return dedupeKey({ layer, subject, session, clauseHash: layer === \"member\" ? ch : null, revision }) + \":nightly\";"]] },
  { name: "a house key that carries the clause hash", target: I, transforms: [["clauseHash: layer === \"member\" ? ch : null", "clauseHash: ch"]] },
  { name: "a clause hash of the unsorted clauses", target: I, transforms: [["export const clauseHash = (clauses) => sha256Hex(clauseCanon(clauses)).slice(0, ID_RULES.clauseHashLength);", "export const clauseHash = (clauses) => sha256Hex(JSON.stringify(clauses)).slice(0, ID_RULES.clauseHashLength);"]] },
  { name: "a wire id from nine bytes", target: I, transforms: [["if (!(bytes instanceof Uint8Array) || bytes.length !== 10) throw new TypeError(\"memberWireId: ten bytes\");", "if (!(bytes instanceof Uint8Array)) throw new TypeError(\"memberWireId: ten bytes\");"]] },
  { name: "money rounded by a fixed million", target: D, transforms: [["case \"usd\": return formatScaled(v, compactDp, \"$\");", "case \"usd\": return \"$\" + (Math.abs(v) / 1e6).toFixed(2) + \"M\";"]] },
  { name: "an ordinal that says 11st", target: D, transforms: [["if (t >= 11 && t <= 13) return n + \"th\";", ""]] },
  { name: "a sigma without its unit", target: D, transforms: [["case \"sigma\": return formatFixed(v, { dp: 2, suffix: \"σ\" });", "case \"sigma\": return formatFixed(v, { dp: 2 });"]] },
  { name: "no singular", target: D, transforms: [["const plural = (n, one, many) => n + \" \" + (n === 1 ? one : many);", "const plural = (n, one, many) => n + \" \" + many;"]] },
  { name: "a wire sentence in the future tense", target: D, transforms: [["const tail = \", checked \" +", "const tail = \", it will be checked \" +"]] },
  { name: "a hit sentence without its clock", target: D, transforms: [["const when = t ? t.text : (clock(e.asOf) || ABSENT_MARK);", "const when = t ? t.label : \"\";"]] },
  { name: "a window that crossed above", target: D, transforms: [["if (clause.subject === \"window\") return \"appeared\";", ""]] },
  { name: "a directional verb", target: D, transforms: [["return clause.op === \">=\" ? \"crossed above\" : \"crossed below\";", "return clause.op === \">=\" ? \"turned bullish\" : \"turned bearish\";"]] },
  { name: "an absent figure shown as zero", target: D, transforms: [["if (typeof v !== \"number\" || !Number.isFinite(v)) return ABSENT_MARK;", "if (typeof v !== \"number\" || !Number.isFinite(v)) return \"0\";"]] },
  { name: "a hit that renders the registry's current threshold", target: D, transforms: [["\" (\" + (OP_TEXT[lead.op] || lead.op) + \" \" + formatValue(lead.x, lead.unit) + \")\"", "\" (\" + (OP_TEXT[lead.op] || lead.op) + \" \" + formatValue(metricById(lead.m).range[1], lead.unit) + \")\""]] },
  { name: "a missing run shown as no hit", target: D, transforms: [["return ABSENT_MARK + \" not evaluated: \" + String(r.reason).replace(/_/g, \" \");", "return \"no hits\";"]] },
];

const out = await holdsAndPlants("ff-a-core", battery, plants);
console.log(`ff-a-core: ${out.checks} checks passed`);

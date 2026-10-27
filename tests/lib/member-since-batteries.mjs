import { ok, eq } from "./member-batteries.mjs";
import * as X from "./member-export-world.mjs";

export const NOW = Date.parse("2026-10-24T06:41:00.000Z");
export const PREV = Date.parse("2026-10-22T14:00:00.000Z");
export const ISO = (ms) => new Date(ms).toISOString();
export const TRACK_AT = "2026-10-23T21:30:00.000Z";

const MINUS = "−";
const DASH = "—";

export const SINCE_UNIVERSE = [
  { t: "SYA001", cols: { sig: 0.02, chg: 0.0617, ed: 30 } },
  { t: "SYA002", cols: { sig: 0.02, chg: 0.0618, ed: null } },
  { t: "SYA003", cols: { sig: 0.02, chg: -0.0582, ed: null } },
  { t: "SYA004", cols: { sig: 0.02, chg: 0.1, ed: 5 } },
  { t: "SYA005", cols: { sig: 0, chg: 0.5, ed: null } },
  { t: "SYA006", cols: { sig: 0.02, chg: null, ed: null } },
  { t: "SYA007", cols: { sig: 0.02, chg: -1, ed: null } },
  { t: "SYA008", cols: { sig: 0.02, chg: 0.2, ed: 22 } },
  { t: "SYA009", cols: { sig: 0.02, chg: 0.2, ed: 21 } },
  { t: "SYA010", cols: { sig: 0.02, chg: 0.2, ed: 0 } },
  { t: "SYA011", cols: { sig: 0.02, chg: -0.0581, ed: 1 } },
  { t: "SYA012", cols: { sig: 0.02, chg: 0.001, ed: 1 } },
  { t: "SYA013", cols: { sig: 0.02, chg: 0.2, ed: -1 } },
  { t: "SYA014", cols: { sig: 0.02, chg: 0.001, ed: 2 } },
];

export const SINCE_EVENTS = [
  { t: "SYE001", d: "2026-11-19" },
  { t: "SYE002", d: "2026-11-20" },
  { t: "SYE003", d: "2026-11-23" },
  { t: "SYE004", d: "2026-11-24" },
  { t: "SYE005", d: null },
  { t: "SYE006", d: "2026-10-22" },
  { t: "SYA010", d: "2026-10-23" },
  { t: "SYA011", d: "2026-10-26" },
];

export function trackPayload(extra = {}) {
  const s = (d) => ({ d });
  return {
    v: 1, generatedAt: TRACK_AT, sessionDate: X.SESSION, deadBand: 10,
    sessions: [s("2026-10-20"), s("2026-10-21"), s("2026-10-22"), s("2026-10-23")],
    names: [
      { t: "SYB001", s: [0, 5, 20, 30] },
      { t: "SYB002", s: [0, 40, -5, -35] },
      { t: "SYB003", s: [0, 50, 20, 4] },
      { t: "SYB004", s: [0, 50, 55, 60] },
      { t: "SYB005", s: [null, null, 5, 20] },
      { t: "SYB006", s: [0, 5, 5, null] },
      { t: "SYB007", s: [0, 10, 10, 11] },
      { t: "SYB008", s: [0, 11, 11, 10] },
      { t: "SYB009", s: [0, -50, -30, -20] },
      { t: "SYB010", s: [0, -3, -3, -40] },
      { t: "SYB011", s: [0, 30, 30, -30] },
    ],
    ...extra,
  };
}

export function alertsPayload(prev, extra = {}) {
  const w = (t, prem, ask, bid, firstAt, flags = {}) => ({ ...X.win(t, prem, ask, bid, flags), ...(firstAt === undefined ? {} : { firstAt }) });
  const rows = [
    w("SYF001", 1000000, 700000, 100000, ISO(prev + 1)),
    w("SYF001", 500000, 100000, 100000, ISO(prev)),
    w("SYF001", 1500000, 1000000, 200000, "not a time"),
    w("SYF002", 300000, null, null, ISO(prev + 60000)),
    w("SYF003", 900000, 500000, 100000, ISO(prev - 1000)),
    w("SYF003", 800000, 500000, 100000, ISO(prev - 5)),
    w("SYF004", 620000, 400000, 100000, undefined),
    w("SYF005", 1000000, 100000, 800000, ISO(prev + 5000)),
    w("SYF006", 1000000, 400000, 400000, ISO(prev + 6000)),
  ];
  return X.flowPayload(rows, extra);
}

export const worldOf = (prev = PREV, over = {}) => ({
  universe: X.columnStore(SINCE_UNIVERSE),
  track: trackPayload(),
  events: X.eventsPayload(SINCE_EVENTS.map((r) => ({ ...r, sdte: null }))),
  alerts: alertsPayload(prev),
  ...over,
});

const byId = (m, id) => m.groups.find((g) => g.id === id);
const totalOf = (m, id) => { const g = byId(m, id); return g ? g.total : 0; };
const lineText = (g) => g.lines.map((l) => l.t + " | " + l.kind + " | " + l.rest);

export function usdBattery(S) {
  eq([S.usd(25000000), S.usd(30000000), S.usd(100000), S.usd(99999), S.usd(99950), S.usd(99949)], ["$250K", "$300K", "$1K", "$1K", "$1K", "$999"], "dollars under a million are whole thousands from 999.50 up, and never 1000 dollars");
  eq([S.usd(99949999), S.usd(99950000), S.usd(100000000), S.usd(123456789)], ["$999K", "$1.0M", "$1.0M", "$1.2M"], "999,499.99 dollars is 999K and 999,500 is 1.0M, never 1000K");
  eq([S.usd(99949999999), S.usd(99950000000), S.usd(100000000000), S.usd(250000000000)], ["$999.5M", "$1.0B", "$1.0B", "$2.5B"], "999.5M and above is billions, never 1000.0M");
  eq([S.usd(0), S.usd(50), S.usd(99), S.usd(100)], ["$0", "$1", "$1", "$1"], "dollars under a thousand are whole dollars");
}

export function sinceBattery(S) {
  eq(S.SINCE_LIMITS, { moveZ: 3, shown: 5, keep: 1000 }, "the limits");
  const w = worldOf();
  const m = S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w });
  eq([m.v, m.state, m.lastVisitMs, m.session, m.base, m.missed], [1, "some", PREV, "2026-10-23", "2026-10-21", 2], "the model: some, last visit, session, base and nights missed");
  eq(m.status, "Last visit 2026-10-22 17:00 TRT. Latest nightly 2026-10-24 00:10 TRT.", "the status line is written in TRT");
  eq(m.note, "2 nightly updates since then. Windows and moves cover 2026-10-23 only.", "two nights missed says so");
  eq(m.groups.map((g) => g.id), ["flow", "moves", "board", "entering", "soon"], "groups in the fixed order, and none left out");

  const flow = byId(m, "flow");
  eq(lineText(flow), [
    "SYF001 | flow | 2 windows · $2.5M · buyers lean",
    "SYF005 | flow | 1 window · $1.0M · sellers lean",
    "SYF006 | flow | 1 window · $1.0M · lean undetermined",
    "SYF004 | flow | 1 window · $620K · buyers lean",
    "SYF002 | flow | 1 window · $300K · lean " + DASH + " no premium has a stated side",
  ], "flow: windows first seen after the last visit, by premium and then ticker, one reading of lean each; a window first seen at the visit instant is old; an unreadable time falls back to the payload's; SYF003 has nothing new");
  eq([flow.summary, flow.total, flow.windows, flow.more, flow.error], ["6 windows across 5 names.", 5, 6, 0, false], "flow: the summary counts windows and names");
  const thin = S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, alerts: { ...w.alerts, rows: w.alerts.rows.filter((r) => r.t === "SYF004").map((r) => ({ ...r, prem: 120000, askPrem: 60000, bidPrem: 30000 })) } });
  eq(lineText(byId(thin, "flow")), ["SYF004 | flow | 1 window · $120K · lean " + DASH + " sided premium under 250k USD"], "flow: a lean that cannot be read says why, in the registry's own words");
  const noReadAt = { ...w.alerts, readAt: ISO(PREV - 1000), generatedAt: ISO(PREV + 1000), rows: w.alerts.rows.filter((r) => r.t === "SYF004") };
  eq(totalOf(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, alerts: noReadAt }), "flow"), 0, "flow: a window with no first-seen time takes the payload's read time, which wins over its generation time");
  const viaRecord = { ...noReadAt, readAt: undefined, record: { date: X.SESSION, shed: 0, lastReadAt: ISO(PREV + 1000) } };
  eq(totalOf(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, alerts: viaRecord }), "flow"), 1, "flow: then the record's last read, then the generation time");
  const live = { ...noReadAt, readAt: ISO(PREV + 1000) };
  eq(totalOf(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, alerts: live }), "flow"), 1, "flow: and a read after the visit makes them new");

  const moves = byId(m, "moves");
  eq(lineText(moves), [
    "SYA008 | move | 9.12 typical moves",
    "SYA009 | move | 9.12 typical moves · near a report",
    "SYA010 | move | 9.12 typical moves · near a report",
    "SYA013 | move | 9.12 typical moves",
    "SYA004 | move | 4.77 typical moves · near a report",
    "SYA002 | move | 3.00 typical moves",
    "SYA003 | move | " + MINUS + "3.00 typical moves",
  ], "moves: |z| of 3 or more after rounding to two places (2.9936 is out, 2.9983 is in), ties by ticker, a fall with the true minus, the report horizon inclusive at 21 and exclusive at 22, and a report already past is not near");
  eq(moves.summary, "7 names moved 3 or more typical daily moves.", "moves: the summary");

  const board = byId(m, "board");
  eq(lineText(board), [
    "SYB010 | cleared | joined the bearish board",
    "SYB001 | cleared | joined the bullish board",
    "SYB007 | cleared | joined the bullish board",
    "SYB002 | flipped | flipped from bullish to bearish",
    "SYB011 | flipped | flipped from bullish to bearish",
    "SYB008 | faded | fell out of the bullish board",
    "SYB003 | faded | fell out of the bullish board",
  ], "board: crossings of the dead band between the session at the last visit and the latest, cleared then flipped then faded, strongest first; at the band is inside it; a name with no score at either end is left out, not reported as joined or faded");
  eq([board.summary, board.since], ["7 names crossed the board line since 2026-10-21.", "2026-10-21"], "board: the summary names the session compared");

  const entering = byId(m, "entering");
  eq(lineText(entering), ["SYE002 | entering | reports in 20 sessions · 2026-11-20", "SYE003 | entering | reports in 21 sessions · 2026-11-23"], "entering: dates that were beyond 21 sessions at the last visit and are within 21 now; 22 is outside, 19 was inside already");
  eq(entering.summary, "2 names now report within 21 sessions.", "entering: the summary");

  const soon = byId(m, "soon");
  eq(lineText(soon), [
    "SYA010 | soon | 2026-10-23 · timing " + DASH + " not published",
    "SYA011 | soon | 2026-10-26 · timing " + DASH + " not published",
    "SYA012 | soon | " + DASH + " · timing " + DASH + " not published",
  ], "soon: names with a report this session or the next, a missing date a dash, and the timing said to be unpublished");
  eq(soon.summary, "Before-open or after-close timing is not published yet.", "soon: the note");

  const first = S.sinceModel({ now: NOW, prevSeenMs: null, ...w });
  eq([first.state, first.status, first.groups, first.lastVisitMs], ["first", S.SINCE_COPY.first, [], null], "no previous visit: the first-visit state and no groups");
  for (const bad of [0, -5, NOW + 1, 1.5, "1790000000000", NaN]) {
    eq(S.sinceModel({ now: NOW, prevSeenMs: bad, ...w }).state, "first", "a previous visit of " + String(bad) + " is not believed");
  }
  eq(S.sinceModel({ now: NOW, prevSeenMs: NOW, ...w }).state, "none", "a previous visit at this very instant is believed");

  const after = Date.parse("2026-10-24T05:00:00.000Z");
  const none = S.sinceModel({ now: NOW, prevSeenMs: after, ...worldOf(after) });
  eq([none.state, none.groups, none.status], ["none", [], "No new nightly data since your last visit at 08:00 TRT."], "nothing newer than the visit: none, with the visit's TRT time");
  const late = Date.parse("2026-10-23T21:50:00.000Z");
  const next = S.sinceModel({ now: Date.parse("2026-10-25T06:41:00.000Z"), prevSeenMs: late, ...worldOf(late) });
  eq(next.status, "No new nightly data since your last visit on 2026-10-24 at 00:50 TRT.", "and on another TRT day it names the date");
  const equalTime = S.sinceModel({ now: NOW, prevSeenMs: Date.parse("2026-10-23T21:45:00.000Z"), ...worldOf(Date.parse("2026-10-23T21:45:00.000Z")), universe: X.columnStore(SINCE_UNIVERSE), track: null, events: null });
  eq(equalTime.state, "none", "data stamped exactly at the visit instant is not new");
  const oneAfter = Date.parse("2026-10-23T21:09:59.999Z");
  eq(S.sinceModel({ now: NOW, prevSeenMs: oneAfter, universe: X.columnStore(SINCE_UNIVERSE), track: null, events: null, alerts: null }).state, "some", "data stamped one millisecond after the visit is new");

  const quietUniverse = X.columnStore([{ t: "SYA001", cols: { sig: 0.02, chg: 0.01, ed: 30 } }, { t: "SYA002", cols: { sig: 0.02, chg: -0.02, ed: null } }]);
  const calm = trackPayload({ names: [{ t: "SYB004", s: [0, 50, 55, 60] }] });
  const stale = alertsPayload(PREV - 3600000);
  const quiet = S.sinceModel({ now: NOW, prevSeenMs: PREV, universe: quietUniverse, track: calm, events: X.eventsPayload([{ t: "SYE001", d: "2026-11-19" }]), alerts: { ...stale, readAt: ISO(PREV - 60000), generatedAt: ISO(PREV - 60000), rows: stale.rows.map((r) => ({ ...r, firstAt: ISO(PREV - 3600000) })) } });
  eq([quiet.state, quiet.groups, quiet.quiet], ["quiet", [], S.SINCE_COPY.quiet], "new nightly data but nothing past a threshold: quiet, with the sentence that says so");

  const gone = S.sinceModel({ now: NOW, prevSeenMs: PREV, universe: w.universe, track: null, events: null, alerts: null });
  eq(gone.groups.map((g) => [g.id, g.error]).sort(), [["board", true], ["entering", true], ["flow", true], ["moves", false], ["soon", false]], "a source that did not load is named in its own group, the others are unaffected");
  eq(byId(gone, "board").summary, "Board changes: the score track did not load.", "the failure sentence");
  eq(gone.state, "some", "and a failed group does not hide the others");
  const nothing = S.sinceModel({ now: NOW, prevSeenMs: PREV, universe: null, track: null, events: null, alerts: null });
  eq([nothing.state, nothing.status, nothing.groups], ["unavailable", S.SINCE_COPY.unavailable, []], "no source at all is unavailable, not none");
  eq(S.sinceModel({ now: NOW, prevSeenMs: null, universe: null, track: null, events: null, alerts: null }).state, "first", "and the first visit does not depend on data");

  const wide = Date.parse("2026-09-10T14:00:00.000Z");
  const longAway = S.sinceModel({ now: NOW, prevSeenMs: wide, ...worldOf(wide) });
  eq(lineText(byId(longAway, "entering")), [
    "SYA010 | entering | reports in 0 sessions · 2026-10-23",
    "SYA011 | entering | reports in 1 session · 2026-10-26",
    "SYE001 | entering | reports in 19 sessions · 2026-11-19",
    "SYE002 | entering | reports in 20 sessions · 2026-11-20",
    "SYE003 | entering | reports in 21 sessions · 2026-11-23",
  ], "after a long absence every date now inside 21 sessions of the latest one is new to the window, whether it is today or three weeks out, and one session is singular");
  ok(longAway.missed > 21 && longAway.note.startsWith(longAway.missed + " nightly updates since then."), "and the note counts the nights");

  const friday = Date.parse("2026-10-23T14:00:00.000Z");
  const oneNight = S.sinceModel({ now: NOW, prevSeenMs: friday, ...worldOf(friday) });
  eq([oneNight.base, oneNight.missed, oneNight.note], ["2026-10-22", 1, null], "one night since the visit adds no note");

  const mid = Date.parse("2026-10-23T21:20:00.000Z");
  const partial = S.sinceModel({ now: NOW, prevSeenMs: mid, ...worldOf(mid) });
  eq(partial.groups.map((g) => g.id), ["flow", "board", "entering"], "when the universe is older than the visit, moves and soon are not drawn from it, and the groups fed by newer data still are");
  eq(lineText(byId(partial, "board")), [
    "SYB010 | cleared | joined the bearish board",
    "SYB002 | cleared | joined the bearish board",
    "SYB005 | cleared | joined the bullish board",
    "SYB007 | cleared | joined the bullish board",
    "SYB011 | flipped | flipped from bullish to bearish",
    "SYB008 | faded | fell out of the bullish board",
    "SYB003 | faded | fell out of the bullish board",
  ], "and the board is compared against the session at that visit: the 22nd, not the 21st");
  eq(lineText(byId(partial, "entering")), ["SYE003 | entering | reports in 21 sessions \u00b7 2026-11-23"], "and so is the report window");

  const track1 = trackPayload({ sessions: [{ d: "2026-10-23" }], names: [{ t: "SYB001", s: [30] }] });
  const noHist = byId(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, track: track1 }), "board");
  eq([noHist.error, noHist.summary, noHist.lines], [true, "Score history does not reach your last visit.", []], "a track that begins after the session at the last visit says so, and compares nothing");
  const trackOld = trackPayload({ sessions: [{ d: "2026-10-22" }, { d: "2026-10-23" }], names: [{ t: "SYB001", s: [5, 30] }] });
  eq(byId(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, track: trackOld }), "board").summary, S.SINCE_COPY.noHistory, "also when it holds two sessions, both after it");
  const sameDay = trackPayload({ sessions: [{ d: "2026-10-21" }], names: [{ t: "SYB001", s: [30] }] });
  eq(byId(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, track: sameDay }), "board"), undefined, "a track that ends at the visit's own session has nothing new and is left out");
  const nightly = Date.parse("2026-10-22T23:00:00.000Z");
  const twoAm = S.sinceModel({ now: NOW, prevSeenMs: nightly, ...worldOf(nightly) });
  eq([twoAm.base, twoAm.state], ["2026-10-21", "some"], "a visit at 02:00 TRT on the 23rd belongs to the US session before the 22nd's nightly");
  const fiveAm = Date.parse("2026-10-23T02:00:00.000Z");
  eq(S.sinceModel({ now: NOW, prevSeenMs: fiveAm, ...worldOf(fiveAm) }).base, "2026-10-22", "and one at 05:00 TRT, after the 22nd's nightly has landed, belongs to the 22nd");
  const trackBand = trackPayload({ deadBand: -1 });
  eq(byId(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, track: trackBand }), "board").error, true, "a track with a negative band is unreadable");

  const names = (n) => X.columnStore(Array.from({ length: n }, (_, i) => ({ t: "SYM" + String(1000 + i), cols: { sig: 0.02, chg: 0.2, ed: null } })));
  const some = byId(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, universe: names(45) }), "moves");
  eq([some.total, some.lines.length, some.more], [45, 45, 0], "every line of a group is sent, so the page can find a member's own names whatever their rank");
  const edge = byId(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, universe: names(1000) }), "moves");
  eq([edge.total, edge.lines.length, edge.more], [1000, 1000, 0], "up to a thousand");
  const big = byId(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, universe: names(1001) }), "moves");
  eq([big.total, big.lines.length, big.more, big.lines[0].t, big.lines[999].t], [1001, 1000, 1, "SYM1000", "SYM1999"], "and the thousand-and-first is counted, not sent");
  ok(JSON.stringify(big).length < 100000, "a group of a thousand lines stays under 100 KB");
  eq([big.names.length, big.names[0], big.names[1000], some.names, edge.names], [1001, "SYM1000", "SYM2000", undefined, undefined], "a group cut at a thousand lines still names every ticker in it, and a group that fits sends no list");
  eq(m.groups.map((g) => [g.id, g.place, g.href]), [
    ["flow", "the Unusual page", "/flows/unusual/"], ["moves", "the Moves page", "/flows/moves/"], ["board", "the Bullish and Bearish pages", "/flows/long/"],
    ["entering", "the Events page", "/flows/events/"], ["soon", "the Events page", "/flows/events/"],
  ], "every group says where the rest of it lives");
  eq(gone.groups.find((g) => g.id === "board").place, "the Bullish and Bearish pages", "and so does a group that failed");

  const hostile = X.columnStore([{ t: "SYA001", cols: { sig: 0.02, chg: 0.2, ed: null } }]);
  hostile.t = ["<img src=x onerror=alert(1)>"];
  eq(byId(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, universe: hostile }), "moves"), undefined, "a name that is not a ticker is never printed, and leaves no group");
  ok(!JSON.stringify(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w, universe: hostile })).includes("<img"), "anywhere in the answer");

  const readOnly = JSON.stringify(w);
  S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w });
  eq(JSON.stringify(w), readOnly, "the model never writes to the payloads it reads");
  const repeat = JSON.stringify(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w }));
  eq(JSON.stringify(S.sinceModel({ now: NOW, prevSeenMs: PREV, ...w })), repeat, "and gives the same answer twice");
  ok(!/\btape\b|unsided/i.test(JSON.stringify(S.SINCE_COPY)) && !/\btape\b|unsided/i.test(repeat), "the words the product retired are not in the copy");
}

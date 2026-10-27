import { loadMutated } from "./truth/mutants.mjs";
import { T, ok, killed } from "./lib/member-batteries.mjs";
import { usdBattery, sinceBattery } from "./lib/member-since-batteries.mjs";
import { sinceRouteBattery } from "./lib/member-route-batteries.mjs";
import { SINCE_ROUTE_MUTANTS } from "./lib/member-route-mutants.mjs";

const quiet = console.error;
console.error = () => {};

const MOD = {
  since: await import("../shared/flows-since.js"),
  crypto: await import("../shared/flows-member-crypto.js"),
  state: await import("../shared/flows-member-state.js"),
  store: await import("../server/member-store.js"),
  route: await import("../server/routes/flows-me.js"),
};

usdBattery(MOD.since);
sinceBattery(MOD.since);
await sinceRouteBattery(MOD);

const SINCE_MUTANTS = [
  ["the move threshold read on the unrounded value", [["Math.abs(round2(z.z)) < SINCE_LIMITS.moveZ", "Math.abs(z.z) < SINCE_LIMITS.moveZ"]]],
  ["the move threshold exclusive", [["Math.abs(round2(z.z)) < SINCE_LIMITS.moveZ", "Math.abs(round2(z.z)) <= SINCE_LIMITS.moveZ"]]],
  ["the report horizon exclusive", [["ed[i] <= HORIZON_SESSIONS", "ed[i] < HORIZON_SESSIONS"]]],
  ["a report already past counted as near", [["ed[i] >= 0 && ", ""]]],
  ["a window first seen at the visit instant counted", [["return first > prev;", "return first >= prev;"]]],
  ["a window without a time taken as old", [["return payloadAt !== null && payloadAt > prev;", "return false;"]]],
  ["the generation time ahead of the read time", [["const payloadAt = instantOf(alerts.readAt) ?? instantOf(isObj(alerts.record) ? alerts.record.lastReadAt : null) ?? instantOf(alerts.generatedAt);", "const payloadAt = instantOf(alerts.generatedAt) ?? instantOf(alerts.readAt);"]]],
  ["flow names in ticker order", [["rows.sort((a, b) => b.T - a.T || byCode(a.t, b.t));", "rows.sort((a, b) => byCode(a.t, b.t));"]]],
  ["buyers and sellers swapped in the lean words", [['if (read.side === "buyers") return "buyers lean";', 'if (read.side === "buyers") return "sellers lean";']]],
  ["the dead band exclusive on the earlier side", [["const wasIn = Math.abs(then) <= band;", "const wasIn = Math.abs(then) < band;"]]],
  ["the dead band exclusive on the later side", [["const isIn = Math.abs(now) <= band;", "const isIn = Math.abs(now) < band;"]]],
  ["a name with no earlier score reported as joined", [["if (now === null || then === null) continue;", "if (now === null) continue;"]]],
  ["a track that starts after the visit compared as empty", [["return { ...failed(\"board\"), summary: SINCE_COPY.noHistory };", "return group(\"board\", SINCE_COPY.titles.board, \"\", [], 0);"]]],
  ["a cut group without its names", [["...(total > SINCE_LIMITS.keep ? { names: [...new Set(lines.map((l) => l.t))] } : {}),", ""]]],
  ["every group sending the Moves page", [["...SINCE_PLACES[id], ...extra,", "...SINCE_PLACES.moves, ...extra,"]]],
  ["the board compared with the session before the latest", [["sessions[i] <= base) {", "sessions[i] <= sessions[last]) {"]]],
  ["the entering window open at 21 sessions", [["before > HORIZON_SESSIONS &&", "before >= HORIZON_SESSIONS &&"]]],
  ["the entering window closed at 21 sessions", [["until <= HORIZON_SESSIONS) rows.push", "until < HORIZON_SESSIONS) rows.push"]]],
  ["reporting soon taking two sessions", [["(ed[i] === 0 || ed[i] === 1)", "(ed[i] >= 0 && ed[i] <= 2)"]]],
  ["data stamped at the visit instant counted as new", [["const newer = (x) => x !== null && x > prev;", "const newer = (x) => x !== null && x >= prev;"]]],
  ["a visit in the future believed", [[" && prevSeenMs <= now ? prevSeenMs : null", " ? prevSeenMs : null"]]],
  ["a fractional visit believed", [["Number.isSafeInteger(prevSeenMs) && ", "Number.isFinite(prevSeenMs) && "]]],
  ["a visit at zero believed", [["prevSeenMs > 0", "prevSeenMs >= 0"]]],
  ["a note for a single night", [["missed > 1 ? plural(missed", "missed > 0 ? plural(missed"]]],
  ["the base taken from now", [["const base = expectedNightlySession(prev, clock);", "const base = expectedNightlySession(now, clock);"]]],
  ["no unavailable state", [['if (![universe, track, events, alerts].some(isObj)) return { ...out, state: "unavailable", status: SINCE_COPY.unavailable };', ""]]],
  ["failed groups hidden", [["const live = groups.filter((g) => g.total > 0 || g.error);", "const live = groups.filter((g) => g.total > 0);"]]],
  ["every line kept", [["lines: lines.slice(0, SINCE_LIMITS.keep)", "lines: lines"]]],
  ["the overflow not counted", [["more: Math.max(0, total - SINCE_LIMITS.keep)", "more: 0"]]],
  ["moves drawn from an older universe", [['groups.push(universeNew ? movesGroup(universe) : group("moves", SINCE_COPY.titles.moves, "", [], 0));', "groups.push(movesGroup(universe));"]]],
  ["reporting soon drawn from an older universe", [['groups.push(universeNew ? soonGroup(universe, events) : group("soon", SINCE_COPY.titles.soon, "", [], 0));', "groups.push(soonGroup(universe, events));"]]],
  ["an ascii hyphen for the minus", [['const MINUS = "−";', 'const MINUS = "-";']]],
  ["a name echoed without the ticker grammar", [["const t = tickerOf(universe.t[i]);\n    if (t === null) continue;\n    const z", "const t = universe.t[i];\n    const z"]]],
  ["thousands rounded up to 1000", [['if (d >= 999.5) return "$" + Math.round(d / 1e3) + "K";', 'if (d >= 1000) return "$" + Math.round(d / 1e3) + "K";']]],
  ["millions starting at one million", [["if (d >= 999500) return", "if (d >= 1e6) return"]]],
  ["billions starting at one billion", [["if (d >= 999500000) return", "if (d >= 1e9) return"]]],
  ["the visit written without its day", [['return same ? "at " + stamp(prev).slice(11) : "on "', 'return false ? "at " + stamp(prev).slice(11) : "on "']]],
];

for (const [label, transforms] of SINCE_MUTANTS) {
  ok(await killed(async () => {
    const mutated = await loadMutated("shared/flows-since.js", transforms);
    usdBattery(mutated);
    sinceBattery(mutated);
  }), "PLANTED " + label + " fails the since battery");
}

for (const [, label, transforms] of SINCE_ROUTE_MUTANTS) {
  const modules = { ...MOD, route: await loadMutated("server/routes/flows-me.js", transforms) };
  ok(await killed(() => sinceRouteBattery(modules)), "PLANTED " + label + " fails the Since route battery");
}

console.error = quiet;
console.log("flows-member-since: " + T.checks + " checks");

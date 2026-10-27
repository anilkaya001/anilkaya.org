import { loadMutated } from "./truth/mutants.mjs";
import { T, ok, cryptoBattery, stateBattery, routeBattery } from "./lib/member-batteries.mjs";

const quiet = console.error;
console.error = () => {};

const MOD = {
  crypto: await import("../shared/flows-member-crypto.js"),
  state: await import("../shared/flows-member-state.js"),
  store: await import("../server/member-store.js"),
  route: await import("../server/routes/flows-me.js"),
};

await cryptoBattery(MOD.crypto);
stateBattery(MOD.state);
await routeBattery(MOD);

const CRYPTO_MUTANTS = [
  ["the member id leaves the key derivation", [["enc.encode(KEY_INFO + memberId)", "enc.encode(KEY_INFO)"]]],
  ["the member id leaves the aad", [['AAD_PREFIX + memberId + "|" + version', 'AAD_PREFIX + "|" + version']]],
  ["a 128-bit key", [['{ name: "AES-GCM", length: 256 }', '{ name: "AES-GCM", length: 128 }']]],
  ["a zero iv", [["crypto.getRandomValues(new Uint8Array(IV_BYTES))", "new Uint8Array(IV_BYTES)"]]],
  ["a secret measured in characters", [["enc.encode(secret).length >= MIN_SECRET_BYTES", "secret.length >= MIN_SECRET_BYTES"]]],
  ["any one-byte secret accepted", [["enc.encode(secret).length >= MIN_SECRET_BYTES", "enc.encode(secret).length >= 1"]]],
  ["no padding", [["out.set(body, 0);\n  return out;", "return body;"]]],
  ["an unsorted list accepted on open", [["canon.some((n, i) => n !== list[i])", "false"]]],
  ["another salt", [['"flows-member-state/v1/salt"', '"flows-member-state/v1/salty"']]],
  ["a little-endian key id", [["getUint32(0, false)", "getUint32(0, true)"]]],
  ["duplicates and order kept on seal", [["const list = [...new Set(names)].sort();", "const list = [...names];"]]],
];

for (const [label, transforms] of CRYPTO_MUTANTS) {
  let killed = false;
  try { await cryptoBattery(await loadMutated("shared/flows-member-crypto.js", transforms)); } catch { killed = true; }
  ok(killed, "PLANTED " + label + " fails the crypto battery");
}

const STATE_MUTANTS = [
  ["names upper-cased before the format test", [["!RAW_RE.test(text)", "!RAW_RE.test(text.toUpperCase())"]]],
  ["no limit on distinct names", [["names.length > MEMBER_LIMITS.watchlistMax", "names.length > Infinity"]]],
  ["the universe check dropped", [["known instanceof Set && !known.has(name)", "false"]]],
  ["the reserved-name check dropped", [["isFixtureTicker(name) && !fixtureHost", "false"]]],
  ["a weak etag accepted", [['/^"w(0|', '/^(?:W\\/)?"w(0|']]],
  ["30 minutes exclusive", [["const fresh = gap >= limits.idleVisitMs;", "const fresh = gap > limits.idleVisitMs;"]]],
  ["a backwards clock written", [["!(gap >= limits.seenStepMs)", "!(Math.abs(gap) >= limits.seenStepMs)"]]],
  ["prev set to now", [["prevSeenMs: fresh ? seen : prev }", "prevSeenMs: fresh ? now : prev }"]]],
  ["the simple return", [["Math.log1p(chg) / sig", "chg / sig"]]],
  ["a zero scale divided", [["if (!(sig > 0)) return", "if (sig < 0) return"]]],
  ["a loose switch", [['mode === "on" || mode === "owner" ? mode : "off"', 'mode.startsWith("on") ? "on" : mode === "owner" ? mode : "off"']]],
  ["all rejected names shown", [["rejected.slice(0, MEMBER_LIMITS.rejectedShown)", "rejected"]]],
];

for (const [label, transforms] of STATE_MUTANTS) {
  let killed = false;
  try { stateBattery(await loadMutated("shared/flows-member-state.js", transforms)); } catch { killed = true; }
  ok(killed, "PLANTED " + label + " fails the state battery");
}

const ROUTE_MUTANTS = [
  ["route", "the same-origin check dropped", [["requireSameOrigin(request);", ""]]],
  ["route", "every route on the read limiter", [["memberAllowed(env[limiter], session)", "memberAllowed(env.MEMBER_STATE_READ, session)"]]],
  ["route", "a missing If-Match read as w0", [['if (precondition.state === "missing") throw HttpError.of("precondition_required");', ""], ["const expected = precondition.version;", "const expected = precondition.version ?? 0;"]]],
  ["route", "an invalid If-Match let through", [['if (precondition.state === "invalid") throw HttpError.of("invalid_precondition");', ""]]],
  ["route", "the list sealed under the old version", [["seal(env.MEMBER_STATE_KEY, id, expected + 1, checked.names)", "seal(env.MEMBER_STATE_KEY, id, expected, checked.names)"]]],
  ["route", "the previous key ignored", [["[env.MEMBER_STATE_KEY, env.MEMBER_STATE_KEY_PREV]", "[env.MEMBER_STATE_KEY]"]]],
  ["route", "a decryption failure thrown", [["unreadable = true;\n      logFailure", "throw new Error('x');\n      logFailure"]]],
  ["route", "the stored columns in the body", [["const base = { member: id, version, maxNames: MEMBER_LIMITS.watchlistMax };", "const base = { member: id, version, maxNames: MEMBER_LIMITS.watchlistMax, ...row };"]]],
  ["route", "owner mode open to members", [['if (mode === "owner" && !isOwner(env, id)) throw HttpError.of("forbidden");', ""]]],
  ["route", "a departed name refused beside a new one", [["const known = new Set([...universe, ...(Array.isArray(kept) ? kept : [])]);", "const known = universe;"]]],
  ["route", "an unreadable universe called a store fault", [['HttpError.of("universe_unreadable", undefined, { "Retry-After": "30" })', 'HttpError.of("store_unreadable")']]],
  ["route", "the universe check dropped when a list is stored", [["const known = new Set([...universe, ...(Array.isArray(kept) ? kept : [])]);", "const known = null;"]]],
  ["route", "a list stored without a key", [['if (toServer && !secretUsable(env.MEMBER_STATE_KEY)) throw HttpError.of("member_state_unavailable");', ""]]],
  ["route", "a missing key not noticed on read", [["if (!secretUsable(env.MEMBER_STATE_KEY)) {\n      return", "if (false) {\n      return"]]],
  ["route", "a write accepted with neither origin header", [['if (write && request.headers.get("Origin") === null && request.headers.get("Sec-Fetch-Site") === null) throw HttpError.of("forbidden", "Same-origin request required");', ""]]],
  ["store", "the version not compared", [['"WHERE member_state.wl_ver = ?5"', '"WHERE 1"']]],
  ["store", "a PUT creating a row from nothing", [["WHERE ?5 = 0 OR EXISTS (SELECT 1 FROM member_state WHERE member_id = ?1) ", ""]]],
  ["store", "every PUT a success", [["return { ok: changes(written) === 1, row: shapeRow(rowsOf(read)[0] || null) };", "return { ok: true, row: shapeRow(rowsOf(read)[0] || null) };"]]],
  ["store", "the version not advanced", [["expected, expected + 1, deviceOnly ? 1 : 0, now", "expected, expected, deviceOnly ? 1 : 0, now"]]],
  ["store", "a ping every time", [['"WHERE member_state.seen_ms IS NULL OR ?2 - member_state.seen_ms >= 60000"', '"WHERE member_state.seen_ms IS NULL OR ?2 - member_state.seen_ms >= 0"']]],
  ["store", "30 minutes exclusive", [["?2 - member_state.seen_ms >= 1800000 THEN member_state.seen_ms ELSE", "?2 - member_state.seen_ms > 1800000 THEN member_state.seen_ms ELSE"]]],
  ["store", "prev set to now", [["THEN member_state.seen_ms ELSE member_state.prev_seen_ms END", "THEN ?2 ELSE member_state.prev_seen_ms END"]]],
  ["store", "a backwards clock written", [['"WHERE member_state.seen_ms IS NULL OR ?2 - member_state.seen_ms >= 60000"', '"WHERE member_state.seen_ms IS NULL OR abs(?2 - member_state.seen_ms) >= 60000"']]],
  ["store", "a PUT clearing the visit", [['updated_ms = excluded.updated_ms " +', 'updated_ms = excluded.updated_ms, seen_ms = NULL, visit_ms = NULL, prev_seen_ms = NULL " +']]],
  ["store", "a visit moving the list version", [['seen_ms = ?2, updated_ms = ?2 "', 'seen_ms = ?2, wl_ver = member_state.wl_ver + 1, updated_ms = ?2 "']]],
  ["store", "a delete of every member", [['"WHERE member_id = ?1 AND (wl_kid IS NOT NULL OR wl_ct IS NOT NULL', '"WHERE (member_id = ?1 OR 1) AND (wl_kid IS NOT NULL OR wl_ct IS NOT NULL']]],
  ["store", "a delete that removes the row and with it the count", [['const DELETE_SQL =\n  "UPDATE member_state SET wl_kid = NULL, wl_iv = NULL, wl_ct = NULL, device_only = 0, seen_ms = NULL, visit_ms = NULL, prev_seen_ms = NULL, wl_ver = wl_ver + 1, updated_ms = ?2 " +\n  "WHERE member_id = ?1 AND', 'const DELETE_SQL =\n  "DELETE FROM member_state WHERE member_id = ?1 AND ?2 > 0 AND']]],
  ["store", "a delete that leaves the version where it was", [["wl_ver = wl_ver + 1, updated_ms = ?2 ", "wl_ver = wl_ver, updated_ms = ?2 "]]],
  ["store", "a delete that leaves the visit clock", [["seen_ms = NULL, visit_ms = NULL, prev_seen_ms = NULL, wl_ver = wl_ver + 1", "wl_ver = wl_ver + 1"]]],
  ["store", "a delete that moves the version again when there is nothing to delete", [["WHERE member_id = ?1 AND (wl_kid IS NOT NULL OR wl_ct IS NOT NULL OR device_only = 1 OR seen_ms IS NOT NULL OR visit_ms IS NOT NULL OR prev_seen_ms IS NOT NULL)", "WHERE member_id = ?1"]]],
  ["store", "the visit step exclusive at a minute", [['"WHERE member_state.seen_ms IS NULL OR ?2 - member_state.seen_ms >= 60000"', '"WHERE member_state.seen_ms IS NULL OR ?2 - member_state.seen_ms > 60000"']]],
  ["store", "the visit start exclusive at 30 minutes", [["OR ?2 - member_state.seen_ms >= 1800000 THEN ?2 ELSE", "OR ?2 - member_state.seen_ms > 1800000 THEN ?2 ELSE"]]],
  ["store", "a sealed value bound as bytes", [['for (const value of [iv, ct]) if (value !== null && typeof value !== "string") throw new TypeError("a sealed value is bound as text, never as bytes");', ""]]],
  ["route", "an unreadable list replaced without consent", [["if (view.unreadable && replaceUnreadable !== true) throw", "if (false) throw"]]],
  ["route", "any truthy flag taken as consent", [["replaceUnreadable !== true) throw stored", "!replaceUnreadable) throw stored"], ['if (replaceUnreadable !== undefined && typeof replaceUnreadable !== "boolean") throw HttpError.of("invalid_watchlist");', ""]]],
  ["route", "the flag not checked for its type", [['if (replaceUnreadable !== undefined && typeof replaceUnreadable !== "boolean") throw HttpError.of("invalid_watchlist");', ""]]],
  ["route", "consent asked before the version is compared", [["throw stored !== null && stored.version === expected ? HttpError.of(\"unreadable_row\") : stale(stored);", "throw HttpError.of(\"unreadable_row\");"]]],
  ["route", "the switch to device-only dropping an unreadable list", [["const view = await stateView(env, stored, id);\n    if (view.unreadable && replaceUnreadable !== true)", "const view = await stateView(env, stored, id);\n    if (toServer && view.unreadable && replaceUnreadable !== true)"]]],
  ["route", "a failed open logged without its reason", [['code: "unreadable", reason }', 'code: "unreadable" }']]],
  ["route", "an unknown key id logged as a failed open", [['reason = "unknown_kid";', 'reason = "open_failed";']]],
  ["store", "a delete that also clears the export record", [["d.prepare(EXPORT_KEPT_SQL).bind(memberId)", 'd.prepare("DELETE FROM member_export WHERE member_id = ?1").bind(memberId)']]],
  ["store", "the sweep creating the member tables", [["return await sweep(env.DB, now, secrets);", "return await sweep(await db(env), now, secrets);"]]],
  ["store", "every sweep failure swallowed", [["if (/no such table/i.test(String(error && error.message))) return none;\n        throw error;", "return none;"]]],
  ["store", "a missing table thrown at the schedule", [["if (/no such table/i.test(String(error && error.message))) return none;", ""]]],
];

for (const [kind, label, transforms] of ROUTE_MUTANTS) {
  const modules = { ...MOD };
  if (kind === "route") modules.route = await loadMutated("server/routes/flows-me.js", transforms);
  else modules.store = await loadMutated("server/member-store.js", transforms);
  let killed = null;
  try { await routeBattery(modules); } catch (error) { killed = error.message.split("\n")[0]; }
  ok(killed !== null, "PLANTED " + label + " fails the route battery");
}

console.error = quiet;
console.log("flows-member-state: " + T.checks + " checks");

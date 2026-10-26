import { readFileSync } from "node:fs";
import { fakeD1 } from "./d1-fake.mjs";
import { SQL } from "../../server/ff-store.js";
import { flowsFfRows } from "../../server/routes/flows-ff.js";

const root = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

const FILES = ["server/ff-store.js", "server/ff-health.js", "server/ff-preview.js", "server/ff-records.js", "server/ff-digest.js", "server/ff-export.js", "server/routes/flows-ff.js"];

const MEMBER_TABLES = ["ff_mute", "ff_note", "ff_hit_mark", "ff_house_off", "ff_member", "ff_wire_symbol"];
const NUMERIC = /^(before|after|scan|limit|readSeq|houseReadSeq|now|version|next|expect|verCap|verFloor|armedMax|universeMax|liveMax|softCap|chk\w+|newMilli|defaultB|wireCap|memberCap|monotoneDays|force|firedAt|asOf|cnt|looks\w*|names\w+|hits\w*|late|evaluatedAt|cutoff|fenceToken|token|runCap|attemptsMax|leaseUntil|firings|sessions|placeboN|confirmN|clear|setMark|setFeedback|max|rowsRead|rowsWritten|wires|unknown|expWeek)$/;

const OR_IGNORE = new Set(["symbolsFirst", "symbolsAdd", "houseLeave", "muteAdd"]);
const SMALL_SCANS = new Map([
  ["switches", "ff_switches holds one row per drill and is read with LIMIT 64"],
  ["runsPrune", "ff_run holds three rows a day for fourteen days"],
]);
const TEMP_SORT = new Set(["wireList", "symbolWires", "houseList", "hitsMarked"]);

const bindsOf = (st) => st.names.map((n, i) => (NUMERIC.test(n) ? 5 : "x" + i));

export async function sqlRegistry(c, build) {
  void build;
  const f = fakeD1();
  const entries = Object.entries(SQL);
  c.ok(entries.length >= 70, "registry: the store keeps its statements in one table", entries.length);
  for (const [name, st] of entries) {
    c.ok(["member", "house", "system"].includes(st.scope), "registry: " + name + " declares a scope", st.scope);
    c.eq(new Set(st.names).size, st.names.length, "registry: " + name + " names each parameter once");
    const text = st.text;
    const literalFree = text.replace(/'[^']*'/g, "''");
    const used = new Set([...literalFree.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
    for (const i of used) c.ok(i >= 1 && i <= st.names.length, "registry: " + name + " uses only declared placeholders", i);
    st.names.forEach((n, i) => c.ok(used.has(i + 1), "registry: " + name + " uses its parameter " + n, n));
    c.ok(!/[:@$][A-Za-z_]\w*/.test(literalFree.replace(/\$\{[^}]*\}/g, "")), "registry: " + name + " has no named parameter, D1 binds by position", "");
    c.ok(!/undefined|\[object|NaN/.test(text), "registry: " + name + " carries no interpolation accident");
    c.ok(!/INSERT\s+OR\s+REPLACE|REPLACE\s+INTO/i.test(text), "registry: " + name + " never replaces a row");
    if (/INSERT\s+OR\s+IGNORE/i.test(text)) c.ok(OR_IGNORE.has(name), "registry: " + name + " is an allowed insert-or-ignore", name);
    c.ok(!/DROP\s|ALTER\s|CREATE\s|PRAGMA/i.test(text), "registry: " + name + " is plain data manipulation");
    let plan;
    try {
      plan = f.db.prepare("EXPLAIN QUERY PLAN " + text).all(...bindsOf(st));
    } catch (e) {
      c.ok(false, "registry: " + name + " prepares against the real schema", e.message);
      continue;
    }
    for (const p of plan) {
      const scan = /^SCAN (ff_\w+)/.exec(p.detail);
      if (scan) c.ok(SMALL_SCANS.has(name), "plans: " + name + " does not scan " + scan[1], p.detail);
      if (/USE TEMP B-TREE FOR ORDER BY/.test(p.detail)) c.ok(TEMP_SORT.has(name), "plans: " + name + " sorts through an index", p.detail);
    }
    const memberIndex = st.names.indexOf("member") + 1;
    if (st.scope === "member") {
      c.ok(memberIndex > 0, "scope: " + name + " is member-scoped and takes the member");
      c.ok(used.has(memberIndex), "scope: " + name + " uses the member placeholder");
    }
    if (st.scope === "system") c.ok(!st.names.includes("member"), "scope: " + name + " is system-scoped and takes no member");
    if (st.scope === "house") {
      c.ok(/layer = 'house'|stream = 'house'|member_id IS NULL/.test(text), "scope: " + name + " is house-scoped and names the house", "");
    }
    if (memberIndex > 0) {
      const M = "\\?" + memberIndex + "\\b";
      for (const t of MEMBER_TABLES) {
        const uses = new RegExp("(?:FROM|JOIN|INTO|UPDATE)\\s+" + t + "\\b").test(text);
        if (!uses) continue;
        const keyed = new RegExp("(?:\\b\\w+\\.)?member_id\\s*=\\s*" + M + "|SELECT\\s+" + M + "\\s*,").test(text);
        c.ok(keyed, "isolation: " + name + " touches " + t + " only under the member predicate", "");
      }
      if (/(?:FROM|JOIN)\s+\(?\s*(?:SELECT \* FROM )?ff_hit\b|FROM ff_hit\b/.test(text) && !/ff_run|INSERT INTO ff_hit/.test(text)) {
        const keyed = new RegExp("(?:\\b\\w+\\.)?stream\\s*=\\s*(?:" + M + "|'house')|stream = " + M + "|wire_id = w\\.id").test(text);
        c.ok(keyed, "isolation: " + name + " reads ff_hit by a named stream", "");
      }
      if (/(?:FROM|JOIN)\s+ff_wire\b/.test(text) && !/ff_wire_version|ff_wire_symbol/.test(text.split(/FROM|JOIN/).filter((s) => /^\s*ff_wire\b/.test(s)).join(""))) {
        const keyed = new RegExp("member_id\\s*(?:=|IS)\\s*(?:" + M + "|NULL)|layer\\s*=\\s*'house'").test(text);
        c.ok(keyed, "isolation: " + name + " reads ff_wire under the member or the house layer", "");
      }
    }
  }
  const seen = entries.map(([, s]) => s.text);
  c.eq(new Set(seen).size, seen.length, "registry: no two statements share a text, so the dynamic isolation test can name every one");
}

export async function routeTable(c, build) {
  void build;
  const doc = read("docs/ff/contract.md");
  const table = [...doc.matchAll(/^\| `(\/api\/ff\/[a-z]+)` \| ([A-Z, ]+) \| (\w+) \|/gm)].map((m) => ({ path: m[1], methods: m[2].split(",").map((x) => x.trim()), auth: m[3] }));
  c.eq(table.length, 14, "routes: the contract lists fourteen routes");
  const rows = flowsFfRows({ store: {}, flowsStore: {}, core: {}, readClock: null });
  c.eq(rows.length, 14, "routes: the family has fourteen rows");
  c.eq(new Set(rows.map((r) => r.id)).size, 14, "routes: row ids are unique");
  c.ok(rows.every((r) => /^ff-[a-z]+$/.test(r.id)), "routes: row ids are namespaced");
  for (const want of table) {
    const row = rows.find((r) => r.path === want.path);
    c.ok(Boolean(row), "routes: " + want.path + " has a row", "");
    if (!row) continue;
    c.eq([...row.methods].sort(), [...want.methods].sort(), "routes: " + want.path + " takes the contract's methods");
    c.eq(row.auth, want.auth === "none" ? "none" : "flows", "routes: " + want.path + " has the contract's auth");
    c.eq(typeof row.handler, "function", "routes: " + want.path + " has a handler");
  }
  c.eq(rows.filter((r) => r.auth === "none").map((r) => r.path), ["/api/ff/run"], "routes: only the runner door is open to a bearer and not a session");
}

export async function sourceRules(c, build) {
  void build;
  for (const f of FILES) {
    const src = read(f);
    c.ok(!/Date\.now\(\)|new Date\(\)|Math\.random\(|crypto\.randomUUID|performance\.now|getRandomValues/.test(src.replace(/crypto\.subtle/g, "")), "clock: " + f + " reads no clock and no randomness, the caller injects them");
    c.ok(!/from "\.\.\/\.\.\/worker\.js"|from "\.\.\/worker\.js"|cloudflare:/.test(src), "imports: " + f + " does not import the Worker or the platform");
    c.ok(!/localStorage|document\.|window\./.test(src), "imports: " + f + " is server code");
    c.ok(!/console\.(log|warn|error)/.test(src), "logging: " + f + " logs through logFailure alone");
    c.ok(!/\bTODO\b|\bFIXME\b|\bXXX\b/.test(src), "hygiene: " + f + " carries no unfinished marker");
  }
  const route = read("server/routes/flows-ff.js");
  const headers = new Set([...route.matchAll(/headers\.get\("([^"]+)"\)/g)].map((m) => m[1]));
  c.eq([...headers].sort(), ["Idempotency-Key", "If-None-Match"],"request: the route family reads two request headers and no identity header");
  const params = new Set([...route.matchAll(/searchParams\.get\("([^"]+)"\)/g)].map((m) => m[1]));
  c.eq([...params].sort(), ["cursor", "d", "from", "id", "limit", "session", "state", "status", "to", "version", "week", "wire"].sort(), "request: the query carries ids, filters and cursors and never a member");
  c.ok(!/searchParams\.get\(\s*[^"\s]/.test(route), "request: every query name is a literal");
  c.ok(!/request\.cf|X-Forwarded|CF-Connecting|headers\.get\("Cookie"\)/i.test(route), "request: no ambient identity is read");
  const memberUses = [...route.matchAll(/memberId\(/g)].length;
  c.eq(memberUses, 1, "request: the member id is derived from the session in one place");
  c.ok(/const member = memberId\(session\)/.test(route), "request: and only from the session");
  const store = read("server/ff-store.js");
  c.ok(/export function assertMember/.test(store), "store: every method asserts its member");
  const assertCount = [...store.matchAll(/^\s+assertMember\(id\);$/gm)].length;
  const memberMethods = [...store.matchAll(/async (\w+)\(env, id[,)]/g)].map((m) => m[1]);
  c.eq(assertCount, memberMethods.length, "store: every method that takes a member id asserts it (" + assertCount + " of " + memberMethods.length + ")");
  c.ok(memberMethods.length >= 25, "store: the member methods are counted", memberMethods.length);
  for (const f of FILES) {
    const src = read(f);
    c.ok(!/(^|[^:"'\\])\/\/[^\n]*/.test(src.split("\n").filter((l) => !/["'`\/][^"'`]*\/\/|https?:\/\//.test(l)).join("\n")), "comments: " + f + " carries no line comment");
    c.ok(!/\/\*/.test(src.replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, "")), "comments: " + f + " carries no block comment");
  }
}

export async function compiledGate(c, build) {
  const { validateCompiled, namesOf } = build().storeModule;
  const good = {
    ok: true,
    symbols: ["SYA101"],
    version: {
      template: "custom", cadence: "nightly", scope_kind: "names", control: "fact", exp_week: null, clause_hash: "0123456789abcdef".slice(0, 10), ast_hash: "a".repeat(64),
      ast_json: JSON.stringify({ v: 1, cadence: "nightly", scope: { kind: "names", symbols: ["SYA101"] }, all: [{ m: "earn.sessions", op: "<=", x: 3 }], persist: 1 }), sentence: "When x", registry_version: 1,
    },
  };
  c.eq(validateCompiled(good), [], "compiled: a well-formed record passes");
  const bad = (patch, code) => {
    const rec = JSON.parse(JSON.stringify(good));
    patch(rec);
    const got = validateCompiled(rec);
    c.ok(got.includes(code), "compiled: " + code + " is caught", got);
  };
  bad((r) => { r.version.template = "T99"; }, "template");
  bad((r) => { r.version.cadence = "rail"; }, "cadence");
  bad((r) => { r.version.scope_kind = "watchlist"; }, "scope_kind");
  bad((r) => { r.version.control = "sr"; }, "control");
  bad((r) => { r.version.control = "bh"; r.version.exp_week = null; }, "exp_week");
  bad((r) => { r.version.control = "bh"; r.version.exp_week = 0.0004; }, "exp_week");
  bad((r) => { r.version.exp_week = 0.5; }, "exp_week");
  bad((r) => { r.version.clause_hash = "xyz"; }, "clause_hash");
  bad((r) => { r.version.clause_hash = "ABCDEF0123"; }, "clause_hash");
  bad((r) => { r.version.ast_hash = "a".repeat(63); }, "ast_hash");
  bad((r) => { r.version.ast_json = "x".repeat(4097); }, "ast_json");
  bad((r) => { r.version.ast_json = "[1]"; }, "ast_json");
  bad((r) => { const b = JSON.parse(r.version.ast_json); b.cadence = "live"; r.version.ast_json = JSON.stringify(b); }, "ast_cadence");
  bad((r) => { const b = JSON.parse(r.version.ast_json); b.scope = { kind: "universe" }; r.version.ast_json = JSON.stringify(b); }, "ast_scope");
  bad((r) => { const b = JSON.parse(r.version.ast_json); b.control = "fact"; r.version.ast_json = JSON.stringify(b); }, "ast_control");
  bad((r) => { r.version.sentence = ""; }, "sentence");
  bad((r) => { r.version.sentence = "x".repeat(281); }, "sentence");
  bad((r) => { r.version.registry_version = 0; }, "registry_version");
  bad((r) => { r.symbols = ["SYA101", "SYA101"]; }, "symbols");
  bad((r) => { r.symbols = ["bad symbol"]; }, "symbols");
  bad((r) => { r.symbols = Array.from({ length: 26 }, (_, i) => "SY" + String.fromCharCode(65 + (i % 26)) + "AAA"); }, "symbols");
  bad((r) => { r.symbols = []; }, "symbols_scope");
  bad((r) => { r.symbols = ["SYB201"]; }, "symbols_ast");
  bad((r) => { r.version.scope_kind = "universe"; const b = JSON.parse(r.version.ast_json); b.scope = { kind: "universe" }; r.version.ast_json = JSON.stringify(b); }, "symbols_scope");
  c.eq(validateCompiled(null), ["not_object"], "compiled: null is not an object");
  c.eq(validateCompiled({}), ["no_version"], "compiled: no version");
  c.eq(namesOf("not json"), [], "compiled: unreadable AST has no names");
  c.eq(namesOf(JSON.stringify({ scope: { kind: "names", symbols: ["SYA101", 5, "SYA102"] } })), ["SYA101", "SYA102"], "compiled: names are strings only");
}

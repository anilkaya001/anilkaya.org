import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SIDE = /\bat (?:the )?(?:ask|bid)\b/i;
const BADGE = /["'`>]NOW["'`<]/;

const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g;
const TAPE = /\btapes?\b/i;

const RR_NAMED = /risk reversal/i;
const RR_SIGNED = /risk reversal[^"'`]{0,80}\bput\b/i;
export const unsignedRiskReversal = (text) => (String(text).match(LITERAL) || []).filter((lit) => RR_NAMED.test(lit) && !RR_SIGNED.test(lit));

const NET_SIDE_FIELD = /\bnet(?:Positive|Negative)\b/;
const NET_SIDE_LABEL = /\bnet (?:call|put) premium\b/i;

const RULES = Object.freeze([
  { id: "side", re: SIDE, scope: "all", why: "the vendor's term is ask side and bid side; a fill price is not carried by the field" },
  { id: "now", re: BADGE, scope: "browser", why: "NOW is retired as a name for the Screen" },
  { id: "netsplit", test: (line, next) => NET_SIDE_FIELD.test(line) && (line.match(LITERAL) || []).concat(NET_SIDE_FIELD.test(line) ? (next || "").match(LITERAL) || [] : []).some((lit) => NET_SIDE_LABEL.test(lit)), scope: "browser", why: "netPositive and netNegative are sums of each name's calls less puts over the names leaning each way, not call premium and not put premium" },
  { id: "tape", test: (line) => (line.match(LITERAL) || []).some((lit) => TAPE.test(lit) && (/\s/.test(lit) || /^.(?:Tapes?|TAPES?|tapes)\W?.$/.test(lit))), scope: "all", why: "the word is not used in reader-facing or model-visible text; identifiers without a space are not text" },
]);

export function lintText(text, kind) {
  const hits = [];
  const lines = String(text).split("\n");
  for (const rule of RULES) {
    if (rule.scope === "browser" && kind !== "browser") continue;
    for (let i = 0; i < lines.length; i++) {
      if (rule.test) {
        if (rule.test(lines[i], lines[i + 1])) hits.push({ rule: rule.id, line: i + 1, text: lines[i].trim().slice(0, 80) });
        continue;
      }
      const m = rule.re.exec(lines[i]);
      if (m) hits.push({ rule: rule.id, line: i + 1, text: lines[i].trim().slice(Math.max(0, m.index - 30), m.index + 50) });
    }
  }
  return hits;
}

const walk = (dir, exts, out = []) => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel, exts, out); continue; }
    if (exts.includes(path.extname(e.name))) out.push(rel);
  }
  return out;
};

const browserFiles = [
  ...walk("assets/js", [".js"]), ...walk("assets/css", [".css"]),
  ...walk("lab", [".html"]),
  ...fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")),
  "index.html",
].filter((f, i, a) => a.indexOf(f) === i);
const serverFiles = [...walk("shared", [".js"]), ...walk("server", [".js"]), ...walk("scripts", [".mjs", ".js", ".json"]), "worker.js"];

{
  eq(lintText('label: "Calls at ask"', "browser").length, 1, "a planted 'Calls at ask' is found");
  eq(lintText('"Share at the ask"', "browser").length, 1, "a planted 'at the ask' is found");
  eq(lintText("sold At The Bid", "server").length, 1, "a planted 'At The Bid' is found in server text too");
  eq(lintText('const x = "Not at ask"', "server")[0].rule, "side", "and is named as the side rule");
  eq(lintText('<span class="b">NOW</span>', "browser")[0].rule, "now", "a planted NOW badge is found in a browser file");
  eq(lintText("const SHOUT = new Set([\"BUY\", \"NOW\"])", "server").length, 0, "and the Worker's shouted-word guard list is not a reader-facing badge");
  eq(lintText("Premium is what the bid pays today", "browser").length, 0, "'what the bid' is not 'at the bid'");
  eq(lintText('label: "Against the tape"', "browser")[0].rule, "tape", "a planted 'Against the tape' label is found");
  eq(lintText("`The news tape holds ${n}`", "server")[0].rule, "tape", "a planted template string is found in server text");
  eq(lintText('title: "Tapes"', "browser").length, 1, "a planted plural is found");
  eq(lintText('title: "Tape"', "browser").length, 1, "a planted one-word module title is found");
  eq(lintText("note: 'the tape\\'s floor'", "server").length, 1, "a planted possessive is found");
  eq(lintText('"TAPE closed"', "server").length, 1, "and any case");
  eq(lintText('const k = "tape", u = "/api/flows/tape", x = "X-Tape", g = "m-tape"; STATE.tape = tapeSub("live")', "browser").length, 0, "identifiers pass");
  eq(lintText("Calls · ask side, Puts · bid side, Unsided", "browser").length, 0, "the vendor's terms pass");
  eq(lintText("sold into the bid", "browser").length, 0, "and so does a sale into the bid");
  eq(unsignedRiskReversal('"risk reversal " + volPts(rr) + " vol points."').length, 1, "a planted risk reversal with no sign convention is found");
  eq(unsignedRiskReversal('"risk reversal (put minus call) " + volPts(rr)').length, 0, "and the stated convention passes");
  eq(unsignedRiskReversal('"25 and 10 delta risk reversals (put volatility minus call volatility)"').length, 0, "so does a spelled-out one");
  eq(unsignedRiskReversal('xSt(X.skew, "risk-reversal history")').length, 0, "and a hyphenated identifier-like phrase");
  eq(lintText('row("By dollars", usd(premium.netPositive) + " of net call premium against " +\n usd(premium.netNegative) + " of net put premium.")', "browser")[0].rule, "netsplit", "a planted 'net call premium' label on netPositive is found");
  eq(lintText('["Net put premium", usd(premium.netNegative)],', "browser")[0].rule, "netsplit", "a planted 'Net put premium' label on netNegative is found");
  eq(lintText('words: usd(pos) + " net call premium against " + usd(neg)', "browser").length, 0, "a sentence about the tide's own net call premium passes");
  eq(lintText('usd(premium.netPositive) + " of net premium in names leaning bullish"', "browser").length, 0, "the corrected label passes");
}

{
  ok(browserFiles.length > 40 && serverFiles.length > 80, `the lint reads ${browserFiles.length} browser files and ${serverFiles.length} server files`);
  ok(browserFiles.includes(path.join("assets/js", "flows-net.js")) && browserFiles.includes(path.join("assets/css", "flows-net.css")) && serverFiles.includes(path.join("shared", "flows-dossier.js")),
    "and includes the network, its stylesheet and the dossier");
  const found = [];
  for (const f of browserFiles) for (const h of lintText(fs.readFileSync(path.join(ROOT, f), "utf8"), "browser")) found.push(`${f}:${h.line} [${h.rule}] ${h.text}`);
  for (const f of serverFiles) for (const h of lintText(fs.readFileSync(path.join(ROOT, f), "utf8"), "server")) found.push(`${f}:${h.line} [${h.rule}] ${h.text}`);
  eq(found.join("\n"), "", "no reader-facing or model-visible string says 'tape', 'at ask', 'at the ask', 'at bid' or 'at the bid', and no browser file badges the Screen NOW; the allowlist is empty");
}

{
  const bare = [];
  for (const f of ["assets/js/flows-ticker-glance.js", "assets/js/flows-ticker-surface.js", "assets/js/flows-ticker.js"]) {
    for (const lit of unsignedRiskReversal(fs.readFileSync(path.join(ROOT, f), "utf8"))) bare.push(`${f}: ${lit.slice(0, 90)}`);
  }
  eq(bare.join("\n"), "", "every reader-facing mention of a risk reversal on the ticker page states that it is the put volatility minus the call volatility");
}

{
  const net = fs.readFileSync(path.join(ROOT, "assets/js/flows-net.js"), "utf8");
  for (const label of ["Calls \\u00b7 ask side", "Puts \\u00b7 bid side", "Puts \\u00b7 ask side", "Calls \\u00b7 bid side", "Unsided"]) {
    ok(net.includes(`"${label}"`), `the network names a side "${label}"`);
  }
  ok(!/Unattributed/.test(net), "and 'Unattributed' is retired for 'Unsided'");
  ok(/fill above the midpoint/.test(net) && /does not document the alert field/.test(net) && /Lean is a convention/.test(net),
    "the network's legend defines the vendor's ask side as a fill above the midpoint, says the alert field is undocumented and calls the lean a convention");
}

console.log(`✓ flows-copy-lint: ${checks} assertions — no 'at ask' or 'at bid' wording in any browser, Worker, pipeline or model-visible string with an empty allowlist, no NOW badge for the Screen in a browser file, a planted string of each rule caught, and the network's side names and legend sentence in the vendor's terms`);

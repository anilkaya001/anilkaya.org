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

const SOURCE_WORD = /(?<![\w./@:$\\-])[Vv]endor(?:'s|s'|s)?(?![\w/@(-]|\.\w)|\bunusual\s*whales\b/i;
export const sourceProse = (lit) => SOURCE_WORD.test(lit) && (/\s/.test(lit) || /^.Vendor/.test(lit));
const KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "await", "yield"]);
export function templateTexts(src) {
  const out = [];
  const stack = [];
  const n = src.length;
  let i = 0, last = "", word = "";
  const regexHere = () => last === "" || (last === "w" ? KEYWORDS.has(word) : !/^[)\]}0s]$/.test(last));
  const template = (k) => {
    let start = k;
    while (k < n) {
      if (src[k] === "\\") { k += 2; continue; }
      if (src[k] === "`") { out.push(src.slice(start, k)); return k + 1; }
      if (src[k] === "$" && src[k + 1] === "{") { out.push(src.slice(start, k)); stack.push("t"); last = "{"; return k + 2; }
      k++;
    }
    return n;
  };
  while (i < n) {
    const c = src[i];
    if (c === "}" && stack[stack.length - 1] === "t") { stack.pop(); i = template(i + 1); last = "s"; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; } i = j + 1; last = "s"; continue; }
    if (c === "`") { i = template(i + 1); last = "s"; continue; }
    if (c === "/" && regexHere()) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== "\n") { if (src[j] === "\\") { j += 2; continue; } if (src[j] === "[") cls = true; else if (src[j] === "]") cls = false; else if (src[j] === "/" && !cls) break; j++; }
      if (src[j] === "/") { j++; while (j < n && /[a-z]/i.test(src[j])) j++; i = j; last = "s"; continue; }
    }
    if (c === "{") { stack.push("b"); last = "{"; i++; continue; }
    if (c === "}") { if (stack[stack.length - 1] === "b") stack.pop(); last = "}"; i++; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; word = src.slice(i, j); last = "w"; i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[\w.]/.test(src[j])) j++; last = "0"; i = j; continue; }
    if (/\s/.test(c)) { i++; continue; }
    last = c; i++;
  }
  return out;
}
export const sourceTemplates = (text) => templateTexts(String(text)).filter((t) => sourceProse(t));

const NET_SIDE_FIELD = /\bnet(?:Positive|Negative)\b/;
const NET_SIDE_LABEL = /\bnet (?:call|put) premium\b/i;

const RULES = Object.freeze([
  { id: "side", re: SIDE, scope: "all", why: "the feed's term is ask side and bid side; a fill price is not carried by the field" },
  { id: "now", re: BADGE, scope: "browser", why: "NOW is retired as a name for the Screen" },
  { id: "netsplit", test: (line, next) => NET_SIDE_FIELD.test(line) && (line.match(LITERAL) || []).concat(NET_SIDE_FIELD.test(line) ? (next || "").match(LITERAL) || [] : []).some((lit) => NET_SIDE_LABEL.test(lit)), scope: "browser", why: "netPositive and netNegative are sums of each name's calls less puts over the names leaning each way, not call premium and not put premium" },
  { id: "source", test: (line) => (line.match(LITERAL) || []).some(sourceProse), scope: "all", why: "the data source is named the feed or the source, never by its trade or its company name" },
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
  eq(lintText("Calls · ask side, Puts · bid side, Side not stated", "browser").length, 0, "the feed's terms pass");
  eq(lintText("sold into the bid", "browser").length, 0, "and so does a sale into the bid");
  eq(unsignedRiskReversal('"risk reversal " + volPts(rr) + " vol points."').length, 1, "a planted risk reversal with no sign convention is found");
  eq(unsignedRiskReversal('"risk reversal (put minus call) " + volPts(rr)').length, 0, "and the stated convention passes");
  eq(unsignedRiskReversal('"25 and 10 delta risk reversals (put volatility minus call volatility)"').length, 0, "so does a spelled-out one");
  eq(unsignedRiskReversal('xSt(X.skew, "risk-reversal history")').length, 0, "and a hyphenated identifier-like phrase");
  eq(lintText('row("By dollars", usd(premium.netPositive) + " of net call premium against " +\n usd(premium.netNegative) + " of net put premium.")', "browser")[0].rule, "netsplit", "a planted 'net call premium' label on netPositive is found");
  eq(lintText('["Net put premium", usd(premium.netNegative)],', "browser")[0].rule, "netsplit", "a planted 'Net put premium' label on netNegative is found");
  eq(lintText('words: usd(pos) + " net call premium against " + usd(neg)', "browser").length, 0, "a sentence about the tide's own net call premium passes");
  eq(lintText('usd(premium.netPositive) + " of net premium in names leaning bullish"', "browser").length, 0, "the corrected label passes");
  const venWord = ["ven", "dor"].join("");
  eq(lintText(`title: "The ${venWord}'s count was not read"`, "browser")[0].rule, "source", "a planted sentence naming the data source by its trade is found");
  eq(lintText(`label: "V${venWord.slice(1)} calls"`, "browser")[0].rule, "source", "a planted one-label capitalised name is found");
  eq(lintText(`const clause = "on the ${venWord}s' convention"`, "server")[0].rule, "source", "and a plural possessive in a model-visible clause");
  eq(lintText(`note: "read from Unusual Whales"`, "server")[0].rule, "source", "and the company name");
  eq(lintText(`const k = "${venWord}", r = "${venWord}-lag", u = "https://${venWord}.test", f = "flows-${venWord}-ops.js"; x.${venWord}At = env.UW_${venWord.toUpperCase()}`, "server").length, 0, "identifiers, reason codes, hosts and file names pass");
  eq(lintText('const base = "https://api.unusualwhales.com"', "server").length, 0, "and the production origin, which is an address and not copy");
  eq(lintText('title: "The feed\'s count was not read"', "browser").length, 0, "the replacement wording passes");
  eq(lintText(`"Figures are window totals from the ${venWord}."`, "browser")[0].rule, "source", "a planted name at the end of a sentence is found");
  eq(sourceTemplates("const page = `<p>\n  As the " + venWord + " reports it.</p>`").length, 1, "a planted multi-line template naming the source is found");
  eq(sourceTemplates("const page = `<p>\n  As the feed reports it, ${x." + venWord + "} " + venWord + "At</p>`").length, 0, "and a multi-line template with the replacement wording, an expression and an identifier passes");
  eq(sourceTemplates("const re = /[`']/g; const t = `\n the " + venWord + " says`").length, 1, "a backtick inside a regular expression does not hide a later template");
}

{
  ok(browserFiles.length > 40 && serverFiles.length > 80, `the lint reads ${browserFiles.length} browser files and ${serverFiles.length} server files`);
  ok(browserFiles.includes(path.join("assets/js", "flows-net.js")) && browserFiles.includes(path.join("assets/css", "flows-net.css")) && serverFiles.includes(path.join("shared", "flows-dossier.js")),
    "and includes the network, its stylesheet and the dossier");
  const found = [];
  for (const f of browserFiles) for (const h of lintText(fs.readFileSync(path.join(ROOT, f), "utf8"), "browser")) found.push(`${f}:${h.line} [${h.rule}] ${h.text}`);
  for (const f of serverFiles) for (const h of lintText(fs.readFileSync(path.join(ROOT, f), "utf8"), "server")) {
    if (h.rule === "source" && f.startsWith(path.join("scripts", "research"))) continue;
    found.push(`${f}:${h.line} [${h.rule}] ${h.text}`);
  }
  eq(found.join("\n"), "", "no reader-facing or model-visible string says 'tape', 'at ask', 'at the ask', 'at bid' or 'at the bid' or names the data source by its trade or its company, and no browser file badges the Screen NOW; the allowlist is empty");
  const multi = [];
  for (const f of [...browserFiles, ...serverFiles]) {
    if (!/\.m?js$/.test(f)) continue;
    for (const t of sourceTemplates(fs.readFileSync(path.join(ROOT, f), "utf8"))) multi.push(`${f}: ${t.slice(0, 90)}`);
  }
  eq(multi.join("\n"), "", "no multi-line template, a page's HTML among them, names the data source by its trade or its company");
}

{
  const pages = await import(new URL("../shared/flows-pages.js", import.meta.url));
  const SOURCE_TEXT = /\bvendors?\b|\bvendor's|\bunusual\s*whales\b/i;
  const visible = (html) => String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\s(?:src|href|data-src|data-css|id|class|data-[a-z-]+)="[^"]*"/gi, " ");
  const seen = [];
  let rendered = 0;
  for (const [name, fn] of Object.entries(pages.FLOWS_PAGES)) {
    if (typeof fn !== "function") continue;
    for (const args of [{ username: "tester", ticker: "AAPL" }, { username: "tester", ticker: "AAPL", owner: true, scenes: true, xcheck: true, voldesk: true, live: true, net: true, funds: true }]) {
      let html;
      try { html = fn(args); } catch { continue; }
      rendered++;
      const m = SOURCE_TEXT.exec(visible(html));
      if (m) seen.push(`${name}: ${visible(html).slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, " ")}`);
    }
  }
  ok(rendered >= 30, `every page function renders, as a member and as an owner with every optional module on (${rendered} renders)`);
  eq(seen.join("\n"), "", "NO RENDERED PAGE NAMES THE DATA SOURCE BY ITS TRADE OR ITS COMPANY: text, titles, labels and placeholders say the feed");
  const venWord = ["ven", "dor"].join("");
  ok(SOURCE_TEXT.test(visible(`<div title="As the ${venWord} reports it">x</div>`)), "PLANTED WRONG BUILD FAILS: a title attribute naming the source is caught");
  ok(SOURCE_TEXT.test(visible(`<p>Read from the ${venWord}'s calendar.</p>`)), "PLANTED WRONG BUILD FAILS: page text naming the source is caught");
  ok(!SOURCE_TEXT.test(visible(`<script src="/assets/js/flows-${venWord}x.js"></script><p class="${venWord}-note">As the feed reports it.</p>`)), "and a script address or a class name is not copy");
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
  for (const label of ["Calls \\u00b7 ask side", "Puts \\u00b7 bid side", "Puts \\u00b7 ask side", "Calls \\u00b7 bid side"]) {
    ok(net.includes(`"${label}"`), `the network names a side "${label}"`);
  }
  ok(!/Unattributed/i.test(net) && !/\bun[\s-]?sided\b/i.test(net), "and neither 'Unattributed' nor 'Unsided' names a peer bucket in the network");
  const BANNED = /\bun[\s\u2010-\u2015-]?sided\b|\bunattributed\b/i;
  const SURFACES = ["assets/js/flows-net.js", "assets/js/flows-net-map.js", "assets/js/flows-market-river.js", "assets/js/flows-market-floor.js", "assets/js/flows-now.js", "assets/js/flows-ticker-network.js", "assets/js/flows-overview.js", "assets/js/flows-unusual.js", "shared/flows-flow-net.js", "shared/flows-glossary.js"];
  for (const f of SURFACES) {
    const hit = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").filter((line) => BANNED.test(line) && !/excluded\.unattributed|unattributed:/.test(line));
    eq(hit.length, 0, `${f} prints no unsided or unattributed bucket (${hit[0] ? hit[0].trim().slice(0, 80) : ""})`);
  }
  eq(BANNED.test("Unsided"), true, "a planted Unsided label is caught");
  eq(BANNED.test("Side not stated"), false, "and the replacement passes");
  ok(/fill above the midpoint/.test(net) && /does not document the alert field/.test(net) && /Lean is a convention/.test(net),
    "the network's legend defines the feed's ask side as a fill above the midpoint, says the alert field is undocumented and calls the lean a convention");
}

console.log(`✓ flows-copy-lint: ${checks} assertions — no 'at ask' or 'at bid' wording in any browser, Worker, pipeline or model-visible string with an empty allowlist, no NOW badge for the Screen in a browser file, no string, multi-line template or rendered page that names the data source by its trade or its company, a planted string of each rule caught, and the network's side names and legend sentence in the feed's terms`);

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../shared/flows-pages.js";
import { FLOWS_NAV } from "../shared/flows-pages.js";
import { GLOSSARY, GLOSSARY_PAGES } from "../shared/flows-glossary.js";
import { workerSource } from "./lib/source-scan.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const worker = (await import("../worker.js")).default;
const ASSETS = { fetch: async () => new Response("asset", { status: 200 }) };
const ctx = { waitUntil() {} };
const call = (route, init = {}, env = {}) =>
  worker.fetch(new Request("https://anilkaya.org" + route, init), { ASSETS, ...env }, ctx);

const driftOf = (entries, read) => {
  const found = [];
  for (const g of entries) {
    const text = read(g.file);
    for (const line of g.lines) if (!text.includes(line)) found.push(`${g.key}: ${line.slice(0, 60)}`);
  }
  return found;
};
const readRepo = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

for (const [route, name] of [["/flows/about/", "about"], ["/flows/glossary/", "glossary"]]) {
  const res = await call(route);
  eq(res.status, 200, `${name} answers a signed-out reader with the page, not the sign-in form`);
  const html = await res.text();
  ok((res.headers.get("Content-Type") || "").startsWith("text/html"), `${name} is HTML`);
  eq(res.headers.get("Cache-Control"), "no-store", `${name} goes through the finaliser: /flows/ responses are no-store`);
  eq(res.headers.get("X-Frame-Options"), "DENY", `${name} carries the security headers`);
  ok(/default-src/.test(res.headers.get("Content-Security-Policy") || ""), `${name} carries the HTML CSP`);
  ok(!res.headers.has("Set-Cookie"), `${name} sets no cookie`);
  ok(/<meta name="robots" content="noindex, nofollow">/.test(html), `${name} is noindexed like every Flows page`);
  eq((html.match(/<h1[\s>]/g) || []).length, 1, `${name} has exactly one h1`);
  ok(!/Sign in<\/h1>|name="password"/.test(html), `${name} is not the sign-in form`);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].split("?")[0]);
  eq(scripts.join(","), "/assets/js/nav.js", `${name} ships the site navigation script and nothing else`);
  ok(!/<script(?![^>]*src=)/.test(html), `${name} has no inline script`);
  ok(!/innerHTML|data-info|fetch\(/.test(html), `${name} makes no request and opens no popover`);
  const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1].split("?")[0]);
  eq(sheets.join(","), "/assets/css/base.css,/assets/css/flows.css,/assets/css/flows-public.css", `${name} links the shared sheets and its own`);
  for (const href of [...html.matchAll(/(?:href|src)="(\/[^"#]*)/g)].map((m) => m[1].split("?")[0])) {
    if (href.startsWith("/assets/")) ok(fs.existsSync(path.join(ROOT, href)), `${name} links ${href} and it exists`);
  }
  const head = await call(route, { method: "HEAD" });
  eq(head.status, 200, `${name} answers HEAD`);
  const post = await call(route, { method: "POST" });
  eq(post.status, 405, `${name} refuses POST`);
  const bare = await call(route.replace(/\/$/, ""), { redirect: "manual" });
  eq(bare.status, 308, `${name} without the slash redirects permanently`);
  eq(bare.headers.get("Location"), "https://anilkaya.org" + route, `${name} redirect lands on the canonical path`);
  const off = await call(route, {}, { FLOWS_FRONT_DOOR: "off" });
  eq(off.status, 404, `${name} is a 404 when FLOWS_FRONT_DOOR is off`);
  const odd = await call(route, {}, { FLOWS_FRONT_DOOR: "maybe" });
  eq(odd.status, 200, `${name} treats any value but off as on`);
}

{
  const html = await (await call("/flows/about/")).text();
  for (const needle of ["Not investment advice", "withheld", "assigned credential"]) {
    ok(html.includes(needle), `the about page says: ${needle}`);
  }
  ok(!/\b(returns?|outperform|beat the market|guarantee|profit)\b/i.test(html),
     "and makes no performance claim");
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of ["/flows/login/", "/flows/glossary/", "/"]) ok(links.includes(href), `the about page links ${href}`);
}

{
  const html = await (await call("/flows/about/")).text();
  const NEEDLE = {
    overview: "<strong>Home.</strong>", watch: "(the Watchlist)", long: "<strong>Boards.</strong>", short: "<strong>Boards.</strong>",
    market: "<strong>Market.</strong>", moves: "<strong>Moves.</strong>", unusual: "<strong>Unusual.</strong>", events: "<strong>Events.</strong>",
    political: "<strong>Political.</strong>", strategy: "<strong>Strategy, Premium desk and Ask.</strong>", desk: "<strong>Strategy, Premium desk and Ask.</strong>",
  };
  const members = FLOWS_NAV.filter((g) => !g.only).flatMap((g) => g.items.map((i) => i.key)).sort();
  eq(Object.keys(NEEDLE).sort().join(","), members.join(","), "the about page's table names every page the members' sidebar links, so a new page cannot ship unlisted");
  const unlisted = (page) => Object.entries(NEEDLE).filter(([, needle]) => !page.includes(needle)).map(([key]) => key);
  eq(unlisted(html).join(","), "", "the about page describes every page the members' sidebar links");
  ok(unlisted(html.replace(/<li><strong>Moves\.<\/strong>.*?<\/li>/, "")).join(",") === "moves", "PLANTED WRONG BUILD caught: an about page that forgot Moves is named");
  ok(unlisted(html.replace(/<li><strong>Events\.<\/strong>.*?<\/li>/, "").replace(/<li><strong>Political\.<\/strong>.*?<\/li>/, "")).join(",") === "events,political", "and one that forgot two pages names both");
  const keys = html.slice(html.indexOf('id="aKeys"'), html.indexOf('id="aKeep"'));
  ok(/<kbd>Ctrl<\/kbd> <kbd>K<\/kbd>/.test(keys) && /<kbd>\?<\/kbd>/.test(keys) && /<kbd>Esc<\/kbd>/.test(keys), "the about page's keyboard section names Ctrl K, ? and Esc");
  const pages = readRepo("shared/flows-pages.js");
  ok(pages.includes('aria-keyshortcuts="Meta+K Control+K"') && pages.includes('aria-keyshortcuts="?"'), "and the shell really declares those two shortcuts, so the section cannot describe keys nothing answers");
  const ui = readRepo("assets/js/flows-ui.js");
  ok(/\(e\.metaKey \|\| e\.ctrlKey\)[^\n]*"k"/.test(ui) && /e\.key === "Escape"/.test(ui), "the kernel binds Ctrl or Command K and Escape");
}

{
  const login = await (await call("/flows/login/")).text();
  ok(login.includes('href="/flows/about/"'), "the sign-in page links to the about page");
  ok(login.includes('href="/flows/glossary/"'), "and to the glossary");
  const gate = await (await call("/flows/")).text();
  ok(gate.includes('href="/flows/about/"'), "the sign-in form served in place of a members' page links to it too");
  for (const name of ["overviewPage", "marketPage", "tickerPage", "deskPage"]) {
    const side = PAGES[name]({ username: "tester", ticker: "AAPL" });
    ok(side.includes('aria-label="About Flows"') && side.includes('href="/flows/about/"') && side.includes('href="/flows/glossary/"'),
       `${name}'s sidebar footer links the about page and the glossary`);
  }
  eq((await call("/flows/market/")).status, 200, "a members' route still answers a signed-out reader with the sign-in form");
  ok((await (await call("/flows/market/")).text()).includes('name="password"'), "and does not leak the page");
}

{
  const html = await (await call("/flows/glossary/")).text();
  const terms = [...html.matchAll(/<h2 id="[a-z0-9-]+-t">([^<]+)<\/h2>/g)].map((m) => m[1].replace(/&#39;/g, "'"));
  eq(terms.length, GLOSSARY.length, "the glossary prints every entry, each term a heading a screen reader can jump between");
  eq((html.match(/<h2[ >]/g) || []).length, GLOSSARY.length, "and no other second-level heading");
  ok(!/<dt[ >]/.test(html), "no term is left as a definition-list label that heading navigation cannot reach");
  eq(terms.join("|"), [...GLOSSARY].map((g) => g.term).sort((a, b) => a.localeCompare(b)).join("|"), "in alphabetical order");
  eq(new Set(GLOSSARY.map((g) => g.key)).size, GLOSSARY.length, "keys are unique");
  eq(new Set(GLOSSARY.map((g) => g.term)).size, GLOSSARY.length, "terms are unique");
  for (const g of GLOSSARY) {
    ok(/^[a-z0-9-]+$/.test(g.key) && html.includes(`id="${g.key}"`) && html.includes(`aria-labelledby="${g.key}-t"`), `${g.key} is an anchor labelled by its heading`);
    ok(g.lines.length > 0 && g.lines.every((l) => typeof l === "string" && l.trim()), `${g.key} has text`);
    ok(g.href === null ? !html.includes(`href="/flows/ticker/"`) : html.includes(`href="${g.href}"`), `${g.key} names the page it appears on` + (g.href === null ? ", without a link to a page that needs a name" : ""));
    ok(GLOSSARY_PAGES.includes(g.page), `${g.key}'s page is one the lede names`);
  }
  const lede = (html.match(/<p class="fx-doc-lede">([^<]+)<\/p>/) || [])[1] || "";
  for (const p of GLOSSARY_PAGES) ok(lede.replace(/&#39;/g, "'").includes(p), `the lede names ${p}, and claims no page it does not cover`);
  ok(!/each page/.test(lede), "the lede does not claim every page");
  const covered = new Set(GLOSSARY.map((g) => g.href).filter(Boolean));
  for (const href of ["/flows/market/", "/flows/political/", "/flows/moves/", "/flows/unusual/", "/flows/long/", "/flows/", "/flows/events/"]) ok(covered.has(href), `the glossary holds the information-button lines of ${href}`);
  ok(!/<(?:img|iframe|style)|<script(?![^>]*src=)/i.test(html), "no markup of that kind reaches the page");
  ok(html.includes("expected P&amp;L") && !html.includes("expected P&L"), "ampersands in the strings are escaped");
  ok(html.includes("members&#39; own variances"), "and so are apostrophes");
}

{
  eq(driftOf(GLOSSARY, readRepo).join("; "), "",
     "every glossary line is the exact string the information button on its page opens, so the two cannot drift");
  const mutated = GLOSSARY.map((g, i) => (i === 0 ? { ...g, lines: [g.lines[0] + " (edited)"] } : g));
  eq(driftOf(mutated, readRepo).length, 1, "and an edited line is caught, naming the entry");
  const moved = GLOSSARY.map((g, i) => (i === 0 ? { ...g, file: "assets/js/flows-board.js" } : g));
  ok(driftOf(moved, readRepo).length > 0, "so is an entry whose source moved to a file that does not hold the string");
  for (const g of GLOSSARY) ok(fs.existsSync(path.join(ROOT, g.file)), `${g.key} cites ${g.file} and it exists`);
}

{
  const src = workerSource();
  ok(/FLOWS_FRONT_DOOR/.test(src), "the Worker reads the front-door switch");
  const toml = readRepo("wrangler.toml");
  ok(/^FLOWS_FRONT_DOOR\s*=\s*"on"/m.test(toml), "and wrangler.toml states it on");
  ok(!/(?:^|[^\w])(\/\/|\/\*)/.test(readRepo("shared/flows-glossary.js").replace(/https?:\/\//g, "")), "the glossary module carries no comments");
}

{
  const stamped = (generatedAt) => PAGES.overviewPage({ username: "t", summary: { text: "Bullish premium. Rest of it.", generatedAt } });
  const time = (html) => /<time datetime="([^"]*)">([^<]*)<\/time>/.exec(html);
  const summer = time(stamped("2026-10-12T13:31:00.000Z"));
  eq(summer[2], "2026-10-12 16:31 TRT", "the Neuron's written time is printed in TRT with the zone named, not as UTC");
  const winter = time(stamped("2026-11-02T22:05:00Z"));
  eq(winter[2], "2026-11-03 01:05 TRT", "and its date follows the TRT day across midnight");
  eq(time(stamped("2026-10-12"))[2], "", "a date-only stamp has no clock to print");
  ok(!/ UTC</.test(stamped("2026-10-12T13:31:00.000Z")), "no UTC label is left on the Home page");
}

console.log(`✓ flows-public: ${checks} assertions — the front door and the glossary answer a signed-out reader as static, noindexed, headered pages, move to a 404 behind one switch, name only strings the pages themselves show, and link in from the sign-in form`);

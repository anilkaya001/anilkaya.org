import fs from "node:fs";
import path from "node:path";
import { loadMutated, ROOT } from "./truth/mutants.mjs";
import * as PAGES from "../shared/flows-pages.js";
import * as SHELL from "../shared/flows-member-shell.js";
import * as ROUTE from "../server/routes/flows-pages.js";
import { T, ok, eq, killed } from "./lib/member-batteries.mjs";
import { STORAGE_TEXT, STORAGE_MUTANTS, mutateText, storageBattery } from "./lib/member-client-batteries.mjs";
import { nullGuardBattery, nullAppends } from "./lib/member-null-guard.mjs";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const count = (text, needle) => text.split(needle).length - 1;
const FRESH = '<button type="button" class="ui-fresh" id="fxFresh"';

const PAGE_OF = {
  overview: PAGES.overviewPage, long: (o) => PAGES.sidePage({ ...o, side: "long" }), short: (o) => PAGES.sidePage({ ...o, side: "short" }), watch: PAGES.watchPage,
  market: PAGES.marketPage, network: PAGES.networkPage, now: PAGES.nowPage, desk: PAGES.deskPage, strategy: PAGES.strategyPage, ticker: PAGES.tickerPage,
  moves: PAGES.movesPage, unusual: PAGES.unusualPage, ledger: PAGES.ledgerPage, events: PAGES.eventsPage, political: PAGES.politicalPage,
};
const htmlOf = (slug) => String(PAGE_OF[slug]({ username: "tester" }));

function shellBattery(S) {
  eq([...S.MEMBER_SLUGS].sort(), Object.keys(PAGE_OF).sort(), "the allowlist is exactly the fifteen member pages");
  for (const slug of S.MEMBER_SLUGS) {
    const raw = htmlOf(slug);
    eq(S.memberShell(raw, { slug, on: false }), raw, slug + ": with the switch off the page is the same string");
    eq(S.memberShell(raw, { slug }), raw, slug + ": with no options the page is the same string");
    eq(S.memberShell(raw, { slug, on: "on" }), raw, slug + ": only the boolean true switches it on");
    const on = S.memberShell(raw, { slug, on: true, exportOpen: false });
    eq(count(on, S.MEMBER_ROOT), 1, slug + ": one member root");
    eq(count(on, 'data-member-open="since"'), 1, slug + ": one Since button in the toolbar");
    eq(count(on, 'data-member-open="list"'), slug === "watch" ? 2 : 1, slug + ": the list button in the toolbar" + (slug === "watch" ? " and the board header" : ""));
    ok(on.indexOf('data-member-open="since"') < on.indexOf(FRESH), slug + ": the buttons stand before the freshness pill");
    eq(count(on, FRESH), 1, slug + ": the pill anchor is still there once");
    ok(on.endsWith("</body></html>") || on.trimEnd().endsWith("</html>"), slug + ": the document still ends the way it did");
    eq(S.memberShell(on, { slug, on: true, exportOpen: false }), on, slug + ": applying it twice is applying it once");
    eq(S.memberShell(on, { slug, on: true, exportOpen: true }), on, slug + ": and a second wrap with exports asked for adds nothing");
    eq(count(on, "data-export=\"0\""), 1, slug + ": the root says there is no export menu");
    eq(count(on, 'data-exports="0"'), 1, slug + ": and, with no word about the switch, that exports are not on");
    eq(count(S.memberShell(raw, { slug, on: true, exportsOn: true }), 'data-exports="1"'), 1, slug + ": the root says exports are on when the switch is");
    eq(count(S.memberShell(raw, { slug, on: true, exportsOn: "yes" }), 'data-exports="0"'), 1, slug + ": and only the boolean true says so");
    ok(!on.includes("data-member-export"), slug + ": and none is drawn");
    eq([count(on, 'data-defer="member"'), count(on, 'data-defer="member-ui"'), count(on, 'data-defer="member-store"')], [1, 1, 1], slug + ": three groups of one file each: the module, the dialogs and the store");
    eq(count(on, "flows-export.js"), count(raw, "flows-export.js"), slug + ": and no export script is added when there is no menu");
    const tagOf = (group) => (on.match(new RegExp('<i hidden data-defer="' + group + '"[^>]*>')) || [""])[0];
    ok(tagOf("member").includes('data-src="/assets/js/flows-member.js?v=' + PAGES.ASSET_VERSION + '"') && !tagOf("member").includes("data-css"), slug + ": the module group carries the module and no sheet");
    ok(tagOf("member-ui").includes('data-src="/assets/js/flows-member-ui.js?v=' + PAGES.ASSET_VERSION + '"') && tagOf("member-ui").includes('data-css="/assets/css/flows-member.css?v=' + PAGES.ASSET_VERSION + '"'), slug + ": the dialogs group carries the dialogs and the sheet with the asset version");
    ok(tagOf("member-store").includes('data-src="/assets/js/storage.js?v=' + PAGES.ASSET_VERSION + '"') && !tagOf("member-store").includes("data-css"), slug + ": the store group carries storage.js alone");
    ok(on.includes('<script src="/assets/js/flows-member-boot.js?v=' + PAGES.ASSET_VERSION + '" defer></script>'), slug + ": the boot is the only eager script");
    const added = on.length - raw.length;
    ok(added > 0 && added < 2400, slug + ": the markup grows by " + added + " B");
    for (const tag of on.match(/<[^>]*\bdata-member-open=[^>]*>/g)) ok(/\sdata-member(?=[\s>=])/.test(tag) && /aria-haspopup="dialog"/.test(tag), slug + ": " + tag.slice(0, 60) + " carries data-member and names a dialog");
    const withStore = S.memberShell(raw.replace("</body>", () => '<script src="/assets/js/storage.js?v=1" defer></script></body>'), { slug, on: true });
    eq([count(withStore, 'data-defer="member-store"'), count(withStore, "/assets/js/storage.js")], [0, 1], slug + ": a page that already loads storage.js declares no second copy");
    const hasDollar = raw.replace("</body>", () => "<!--$&$1$'--></body>");
    const marked = S.memberShell(hasDollar, { slug, on: true });
    eq(count(marked, "<!--$&$1$'-->"), 1, slug + ": a dollar pattern in the page is copied once and never read as a replacement");
  }
  for (const slug of ["status", "ask", "login", "about", "glossary", "", "OVERVIEW", "constructor", "__proto__"]) {
    const raw = "<html><body>" + FRESH + "></button></body></html>";
    eq(S.memberShell(raw, { slug, on: true }), raw, "the slug " + JSON.stringify(slug) + " is not a member page");
  }
  const lean = htmlOf("moves");
  eq(S.memberShell(lean.replace(FRESH, FRESH.replace("fxFresh", "other")), { slug: "moves", on: true }), lean.replace(FRESH, FRESH.replace("fxFresh", "other")), "a page without its pill anchor is left alone");
  eq(S.memberShell(lean.replace(FRESH, FRESH + FRESH), { slug: "moves", on: true }), lean.replace(FRESH, FRESH + FRESH), "a page with the pill anchor twice is left alone");
  eq(S.memberShell(lean.replace("</body>", "</body></body>"), { slug: "moves", on: true }), lean.replace("</body>", "</body></body>"), "a page with two body ends is left alone");
  eq(S.memberShell(lean.replace(FRESH, ""), { slug: "moves", on: true }), lean.replace(FRESH, ""), "and so is one with no pill at all");
  eq(S.memberShell(42, { slug: "moves", on: true }), 42, "a value that is not a string is returned as it came");

  for (const slug of ["moves", "unusual"]) {
    const on = S.memberShell(htmlOf(slug), { slug, on: true, exportOpen: true });
    eq(count(on, "data-member-export"), 1, slug + ": one export menu");
    eq(count(on, 'data-export="1"'), 1, slug + ": and the root says so");
    ok(on.includes('<summary class="ui-exp-b">Export</summary>') && on.includes('role="group" aria-label="Export"'), slug + ": a closed menu with its name and a loading line");
    ok(on.indexOf("flows-export.js") > 0 && on.indexOf("flows-export.js") < on.indexOf("flows-member.js"), slug + ": flows-export.js loads before the module, in its group, only with a menu");
    eq([count(on, 'data-defer="member"'), count(on, 'data-defer="member-ui"'), count(on, 'data-defer="member-store"')], [2, 1, 1], slug + ": two files in the module group");
    eq(S.memberShell(on, { slug, on: true, exportOpen: true }), on, slug + ": twice is once");
  }
  for (const slug of ["events", "political"]) {
    const on = S.memberShell(htmlOf(slug), { slug, on: true, exportOpen: false });
    ok(!on.includes("data-member-export") && !on.includes("flows-export.js"), slug + ": held pages draw no export menu and load no export script");
  }
  for (const slug of ["overview", "watch", "ticker", "market", "desk", "long"]) {
    const on = S.memberShell(htmlOf(slug), { slug, on: true, exportOpen: true });
    ok(!on.includes("data-member-export") && !on.includes('data-export="1"'), slug + ": a page with no export anchor draws no menu however it is asked");
  }
  const ticker = S.memberShell(htmlOf("ticker"), { slug: "ticker", on: true });
  ok(ticker.indexOf('<h1 class="ft-t" id="ftHeroT" data-fx-title></h1><span class="fm-star-slot" data-member></span>') > 0, "the ticker's star slot stands right after its title, in the server HTML");
  eq(count(ticker, "fm-star-slot"), 1, "once");
  ok(!htmlOf("moves").includes("fm-star-slot") && !S.memberShell(htmlOf("moves"), { slug: "moves", on: true }).includes("fm-star-slot"), "and no other page has one");
  const watch = S.memberShell(htmlOf("watch"), { slug: "watch", on: true });
  ok(watch.includes('<h2 class="ui-mod-t" id="bdModT">Near the edge</h2><span class="ui-mod-sp"></span><button type="button" class="fm-act" data-member data-member-open="list" aria-haspopup="dialog">'), "the Watch page's action sits in its module header");
}

function optionsBattery(R) {
  const f = R.memberOptions;
  const rows = [];
  for (const state of ["on", "owner", "off", undefined, "", "ON", " on ", "yes", "owner,on"]) {
    for (const owner of [true, false]) {
      const o = f({ FLOWS_MEMBER_STATE: state, FLOWS_EXPORTS: "on" }, owner, "moves");
      const word = String(state ?? "").trim().toLowerCase();
      const want = word === "on" || (word === "owner" && owner === true);
      rows.push([state, owner, o.on, want]);
      eq(o.on, want, "FLOWS_MEMBER_STATE=" + JSON.stringify(state) + " for owner=" + owner + " is " + want);
    }
  }
  for (const exp of ["on", "owner", "off", undefined, "", "yes", "ON"]) {
    for (const owner of [true, false]) {
      for (const slug of ["moves", "unusual", "events", "political", "overview", "watch", "ticker", "market"]) {
        const o = f({ FLOWS_MEMBER_STATE: "on", FLOWS_EXPORTS: exp }, owner, slug);
        const word = String(exp ?? "").trim().toLowerCase();
        const want = (word === "on" || (word === "owner" && owner === true)) && (slug === "moves" || slug === "unusual");
        eq(o.exportOpen, want, "FLOWS_EXPORTS=" + JSON.stringify(exp) + " owner=" + owner + " " + slug + " export slot is " + want);
        const sw = word === "on" || (word === "owner" && owner === true);
        eq(o.exportsOn, sw, "FLOWS_EXPORTS=" + JSON.stringify(exp) + " owner=" + owner + " " + slug + " the switch itself is " + sw + " on any page");
        eq(o.slug, slug, "and the slug is passed through");
      }
    }
  }
  eq(f(undefined, false, "moves"), { slug: "moves", on: false, exportOpen: false, exportsOn: false }, "no environment at all is off");
  eq(f({ FLOWS_MEMBER_STATE: "on" }, false, "moves").exportOpen, false, "an unset exports switch is off");
}

const PRIVACY_TOKENS = [
  [/\binnerText\b/, "innerText"], [/\bouterHTML\b/, "outerHTML"], [/\bXMLSerializer\b/, "XMLSerializer"], [/\bgetSelection\b/, "getSelection"],
  [/\bdocument\.title\b/, "document.title"], [/\bcloneNode\b/, "cloneNode"], [/\bdocument\.(body|documentElement)\.(textContent|innerHTML)\b/, "a whole-document text read"],
  [/\bdata-member\b/, "a data-member selector"], [/#fxMember\b/, "the member root"], [/\bfm-[a-z-]+\b/, "a member class"], [/\bflowsWatchlist\b/, "the stored list"],
  [/\/api\/me\//, "a member route"], [/\bIEWTStorage\b/, "the storage module"], [/\bhtml2canvas\b|\btoDataURL\b|\bcaptureStream\b/, "a page capture"],
];
const MODEL_FACING = ["assets/js/flows-ask.js", "assets/js/flows-oracle.js", "assets/js/flows-oracle-core.js", "assets/js/flows-oracle-boot.js", "assets/js/flows-nn-orb.js"];

function privacyScan(files) {
  const hits = [];
  for (const [rel, text] of files) for (const [re, name] of PRIVACY_TOKENS) if (re.test(text)) hits.push(rel + " reads " + name);
  return hits;
}

function privacyBattery() {
  const files = MODEL_FACING.map((rel) => [rel, read(rel)]);
  eq(privacyScan(files), [], "no model-facing client reads the page, the selection, the title, the member's list or a member route");
  for (const [, name] of PRIVACY_TOKENS) {
    const probes = {
      innerText: "x.innerText", outerHTML: "x.outerHTML", XMLSerializer: "new XMLSerializer()", getSelection: "window.getSelection()", "document.title": "document.title",
      cloneNode: "n.cloneNode(true)", "a whole-document text read": "document.body.textContent", "a data-member selector": 'q("[data-member]")', "the member root": 'byId("fxMember"); q("#fxMember")',
      "a member class": 'q(".fm-star")', "the stored list": "s.flowsWatchlist(m)", "a member route": 'fetch("/api/me/state")', "the storage module": "window.IEWTStorage.x()", "a page capture": "canvas.toDataURL()",
    };
    ok(privacyScan([["probe.js", probes[name]]]).length > 0, "the scan catches " + name);
  }
  eq(privacyScan([["probe.js", 'status.textContent = "x"; el.innerHTML = "<b>"; q("#askDock")']]), [], "and writes to its own nodes are not flagged");
}

function styleBattery(member, shared) {
  ok(!/\(pointer: coarse\)/.test(member), "the member sheet asks about any pointer and never only the primary one");
  ok(/@media \(any-pointer: coarse\) \{ \.fm-lines \.fm-t, \.fm-lines li, \.fm-cols summary \{ min-height: 44px; \} \}/.test(member), "its rows and disclosures grow for any coarse pointer");
  ok(/@media \(any-pointer: coarse\) \{ \.fm-act \{ min-height: 44px; \} \}/.test(shared), "the Watch action grows for any coarse pointer");
  ok(/@media \(any-pointer: coarse\) \{ \.ui-exp\[data-member\] \.ui-exp-b, \.ui-exp\[data-member\] \.ui-exp-i \{ min-height: 44px; \} \}/.test(shared), "and so do the Export button and items of a member menu");
  ok(/@media \(pointer: coarse\) \{ \.ui-exp-i \{ min-height: 44px; \} \}/.test(shared), "while the shared export rule is what it was");
}

const STYLE_MUTANTS = [
  ["the rows on the primary pointer only", "member", [["@media (any-pointer: coarse) { .fm-lines .fm-t,", "@media (pointer: coarse) { .fm-lines .fm-t,"]]],
  ["the Watch action on the primary pointer only", "shared", [["@media (any-pointer: coarse) { .fm-act {", "@media (pointer: coarse) { .fm-act {"]]],
  ["the member menu on the primary pointer only", "shared", [["@media (any-pointer: coarse) { .ui-exp[data-member] .ui-exp-b,", "@media (pointer: coarse) { .ui-exp[data-member] .ui-exp-b,"]]],
  ["the shared export rule widened", "shared", [["@media (pointer: coarse) { .ui-exp-i { min-height: 44px; } }", "@media (any-pointer: coarse) { .ui-exp-i { min-height: 44px; } }"]]],
];

const SHELL_MUTANTS = [
  ["the idempotence guard dropped", [[" || html.includes(MEMBER_ROOT)", ""]]],
  ["every slug allowed", [[" || !SLUGS.has(slug)", ""]]],
  ["a string read as on", [["on !== true", "on !== true && on !== 'on'"]]],
  ["the switch ignored", [["typeof html !== \"string\" || on !== true", "typeof html !== \"string\""]]],
  ["the pill anchor not counted", [["!once(html, FRESH) || ", ""]]],
  ["the body end not counted", [["|| !once(html, \"</body>\")", ""]]],
  ["the first button without data-member", [['class="fx-search fx-mem" data-member data-member-open="since"', 'class="fx-search fx-mem" data-member-open="since"']]],
  ["the second button without data-member", [['class="fx-search fx-mem" data-member data-member-open="list"', 'class="fx-search fx-mem" data-member-open="list"']]],
  ["the star slot missing from the server HTML", [['if (slug === "ticker" && once(out, HERO)) out = after(out, HERO, STAR_SLOT);', ""]]],
  ["the Watch action missing", [['if (slug === "watch" && once(out, WATCH)) out = after(out, WATCH, WATCH_ACTION);', ""]]],
  ["an export menu for every asked page", [["Object.hasOwn(EXPORT_ANCHORS, slug) && once(out, EXPORT_ANCHORS[slug])", "(Object.hasOwn(EXPORT_ANCHORS, slug) ? once(out, EXPORT_ANCHORS[slug]) : true)"]]],
  ["the export menu drawn when not asked for", [["exportOpen === true && ", ""]]],
  ["the export script always loaded", [['...(exports && !out.includes("/assets/js/flows-export.js") ? [v("/assets/js/flows-export.js")] : [])', '...[v("/assets/js/flows-export.js")]']]],
  ["the root saying exports are open when they are not", [['data-export="${exports ? "1" : "0"}"', 'data-export="1"']]],
  ["the store in the module group", [['group("member-store", [v("/assets/js/storage.js")])', 'group("member", [v("/assets/js/storage.js")])']]],
  ["the dialogs in the module group", [['group("member-ui", [v("/assets/js/flows-member-ui.js")], v("/assets/css/flows-member.css"))', 'group("member", [v("/assets/js/flows-member-ui.js")], v("/assets/css/flows-member.css"))']]],
  ["the sheet on no file", [['group("member-ui", [v("/assets/js/flows-member-ui.js")], v("/assets/css/flows-member.css"))', 'group("member-ui", [v("/assets/js/flows-member-ui.js")])']]],
  ["the sheet on the module group", [['group("member", [...(exports && !out.includes("/assets/js/flows-export.js") ? [v("/assets/js/flows-export.js")] : []), v("/assets/js/flows-member.js")])', 'group("member", [...(exports && !out.includes("/assets/js/flows-export.js") ? [v("/assets/js/flows-export.js")] : []), v("/assets/js/flows-member.js")], v("/assets/css/flows-member.css"))']]],
  ["the export script after the module", [['[...(exports && !out.includes("/assets/js/flows-export.js") ? [v("/assets/js/flows-export.js")] : []), v("/assets/js/flows-member.js")]', '[v("/assets/js/flows-member.js"), ...(exports && !out.includes("/assets/js/flows-export.js") ? [v("/assets/js/flows-export.js")] : [])]']]],
  ["the store loaded although the page has it", [['...(out.includes("/assets/js/storage.js") ? [] : [group("member-store", [v("/assets/js/storage.js")])])', 'group("member-store", [v("/assets/js/storage.js")])']]],
  ["the boot not deferred", [["flows-member-boot.js\")}\" defer></script>", "flows-member-boot.js\")}\"></script>"]]],
  ["the buttons after the pill", [["let out = before(html, FRESH, BAR);", "let out = after(html, FRESH, BAR);"]]],
  ["the exports flag always on", [['data-exports="${exportsOn === true ? "1" : "0"}"', 'data-exports="1"']]],
  ["the exports flag read from the menu", [['data-exports="${exportsOn === true ? "1" : "0"}"', 'data-exports="${exports ? "1" : "0"}"']]],
  ["a string read as the exports switch", [['exportsOn === true ? "1" : "0"', 'exportsOn ? "1" : "0"']]],
];

const NULL_MUTANTS = [
  [["assets/js/flows-export.js", "an export list that can hold null"], [["        note && note.textContent ? note : null].filter(Boolean));", "        note && note.textContent ? note : null]);"]]],
  [["assets/js/flows-member-ui.js", "a delete area that can hold null"], [["r.retry ? button(\"Try again\", () => confirmAsk()) : null].filter(Boolean));", "r.retry ? button(\"Try again\", () => confirmAsk()) : null]);"]]],
];

const ROUTE_MUTANTS = [
  ["owner mode open to every member (state)", [['state === "on" || (state === "owner" && owner === true)', 'state === "on" || state === "owner"']]],
  ["owner mode open to every member (exports)", [['exports === "on" || (exports === "owner" && owner === true)', 'exports === "on" || exports === "owner"']]],
  ["held pages open", [[" && pageHold(slug) === null", ""]]],
  ["every page exportable", [["EXPORT_PAGES.includes(slug) && ", ""]]],
  ["exports open whatever the switch says", [["const exportsOn = exports === \"on\" || (exports === \"owner\" && owner === true);", "const exportsOn = true;"]]],
  ["the state switch ignored", [['on: state === "on" || (state === "owner" && owner === true),', "on: true,"]]],
  ["the exports switch tied to the page", [["    exportsOn,\n  };", "    exportsOn: exportsOn && EXPORT_PAGES.includes(slug),\n  };"]]],
];

const CLIENT_FILES = ["assets/js/flows-member.js", "assets/js/flows-member-ui.js", "assets/js/flows-export.js", "assets/js/flows-member-boot.js"].map((rel) => [rel, read(rel)]);

shellBattery(SHELL);
optionsBattery(ROUTE);
privacyBattery();
storageBattery();
nullGuardBattery(CLIENT_FILES);
const MEMBER_CSS_TEXT = read("assets/css/flows-member.css");
const SHARED_CSS_TEXT = read("assets/css/flows.css");
styleBattery(MEMBER_CSS_TEXT, SHARED_CSS_TEXT);
ok(read("assets/js/lab-suite.bundle.js").includes(STORAGE_TEXT.trim()), "the lab bundle holds the committed storage.js, byte for byte");

for (const [label, transforms] of SHELL_MUTANTS) {
  const mutated = await loadMutated("shared/flows-member-shell.js", transforms);
  ok(await killed(() => shellBattery(mutated)), "PLANTED " + label + " fails the shell battery");
}
for (const [label, transforms] of STORAGE_MUTANTS) {
  ok(await killed(() => storageBattery(mutateText(STORAGE_TEXT, transforms, label))), "PLANTED " + label + " fails the storage battery");
}
for (const [label, which, transforms] of STYLE_MUTANTS) {
  const member = which === "member" ? mutateText(MEMBER_CSS_TEXT, transforms, label) : MEMBER_CSS_TEXT;
  const shared = which === "shared" ? mutateText(SHARED_CSS_TEXT, transforms, label) : SHARED_CSS_TEXT;
  ok(await killed(() => styleBattery(member, shared)), "PLANTED " + label + " fails the style battery");
}
for (const [label, transforms] of NULL_MUTANTS) {
  const [rel, text] = CLIENT_FILES.find(([r]) => r === label[0]);
  ok(await killed(() => nullGuardBattery([[rel, mutateText(text, transforms, label[1])]])), "PLANTED " + label[1] + " fails the null scan");
}
for (const [label, transforms] of ROUTE_MUTANTS) {
  const mutated = await loadMutated("server/routes/flows-pages.js", transforms);
  ok(await killed(() => optionsBattery(mutated)), "PLANTED " + label + " fails the options battery");
}
for (const [name, probe] of [["innerText", "x.innerText"], ["a member route", 'fetch("/api/me/since")'], ["a selection read", "getSelection().toString()"]]) {
  const real = MODEL_FACING.map((rel) => [rel, read(rel)]);
  ok(await killed(() => eq(privacyScan([...real, ["flows-ask.js", read("assets/js/flows-ask.js") + "\n" + probe]]), [], "x")), "PLANTED " + name + " in the Ask client fails the privacy scan");
}

console.log("flows-member-shell: " + T.checks + " checks");

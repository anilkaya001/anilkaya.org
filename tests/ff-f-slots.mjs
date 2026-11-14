import { createRouter } from "../server/router.js";
import { flowsPageRows } from "../server/routes/flows-pages.js";
import { FLOWS_PAGES, ffSlots as realSlots } from "../shared/flows-pages.js";
import { loadMutated } from "./truth/mutants.mjs";

const FF_ON = { FF_MODE: "shadow", FF_ROUTE_FIRE: "on", FF_ROUTE_INBOX: "on", FF_ROUTE_WIRES: "on" };
const MARKUP_MAX = 900;
const count = (s, n) => s.split(n).length - 1;
const MARK = 'data-ff-slot="mark"';
const PANEL = 'data-ff-slot="name-panel"';

function battery(ffSlots, P) {
  const fails = [];
  let checks = 0;
  const ok = (c, m) => { checks++; if (!c) fails.push(m); };
  const home = P.overviewPage({ username: "x" });
  const ticker = P.tickerPage({ username: "x" });
  const fire = P.firePage({ username: "x" });
  ok(ffSlots(home, { mark: false, panel: true, slug: "overview" }) === home, "with the Wires route closed the page is untouched");
  const h = ffSlots(home, { mark: true, panel: true, slug: "overview" });
  ok(count(h, MARK) === 1 && count(h, PANEL) === 0, "the mark slot once, and no name panel off the ticker page");
  const foot = h.slice(h.indexOf('<div class="fx-side-f">'), h.indexOf('<div class="fx-who">'));
  ok(foot.includes(MARK), "the mark sits in the sidebar footer, before the member's name");
  ok(count(h, "/assets/js/flows-ff-mark.js?v=") === 1 && count(h, "/assets/js/flows-ff-name-panel.js") === 0, "one mark script and no panel script");
  ok(count(h, 'data-defer="ff-kit" data-src="/assets/js/flows-ff-kernel.js?v=') === 1 && count(h, 'data-defer="ff-kit" data-src="/assets/js/flows-ff-client.js?v=') === 1, "the kit is a deferred group where the page does not load it");
  ok(h.length - home.length > 0 && h.length - home.length <= MARKUP_MAX, "the mark adds " + (h.length - home.length) + " B of markup, at most " + MARKUP_MAX);
  const f = ffSlots(fire, { mark: true, panel: true, slug: "fire" });
  ok(count(f, 'data-defer="ff-kit"') === 0 && count(f, "/assets/js/flows-ff-kernel.js?v=") === 1, "a page that loads the kit eagerly gets no second copy");
  const t = ffSlots(ticker, { mark: true, panel: true, slug: "ticker" });
  ok(count(t, PANEL) === 1 && t.includes('<span class="ft-flags" id="ftHeroFlags"></span><span class="ffx-np-slot" data-ff-slot="name-panel"></span>'), "the name panel sits in the ticker's title row, after its flags");
  ok(count(t, "/assets/js/flows-ff-name-panel.js?v=") === 1, "with its script");
  const tNoInbox = ffSlots(ticker, { mark: true, panel: false, slug: "ticker" });
  ok(count(tNoInbox, MARK) === 1 && count(tNoInbox, PANEL) === 0 && !tNoInbox.includes("flows-ff-name-panel.js"), "with the Inbox route closed the ticker gets the mark and no panel");
  ok(ffSlots(t, { mark: true, panel: true, slug: "ticker" }) === t, "inserting twice changes nothing");
  ok(ffSlots("<html><body></body></html>", { mark: true, panel: true, slug: "ticker" }) === "<html><body></body></html>", "a page without the sidebar anchor is untouched");
  return { fails, checks };
}

const real = battery(realSlots, FLOWS_PAGES);
const route = { fails: [], checks: 0 };
{
  const ok = (c, m) => { route.checks++; if (!c) route.fails.push(m); };
  const deps = { currentFlowsUser: async () => ({ username: "member" }), readFlowsSummary: async () => null, isOwner: () => false };
  const router = createRouter(flowsPageRows(deps));
  const draw = (path, env) => router.find(path).handler({ request: new Request("https://anilkaya.org" + path), env, url: new URL("https://anilkaya.org" + path), ctx: {} }).then((r) => r.text());
  const on = await draw("/flows/ticker/", FF_ON);
  ok(count(on, MARK) === 1 && count(on, PANEL) === 1, "route: with the switches on a ticker page carries the mark and the name panel");
  const noWires = await draw("/flows/ticker/", { ...FF_ON, FF_ROUTE_WIRES: "off" });
  ok(count(noWires, MARK) === 0 && count(noWires, PANEL) === 0 && !noWires.includes("flows-ff-mark.js"), "route: Wires off removes both");
  const noInbox = await draw("/flows/ticker/", { ...FF_ON, FF_ROUTE_INBOX: "off" });
  ok(count(noInbox, MARK) === 1 && count(noInbox, PANEL) === 0, "route: Inbox off keeps the mark and drops the panel, whose read needs both");
  const off = await draw("/flows/long/", { ...FF_ON, FF_MODE: "off" });
  ok(count(off, MARK) === 0, "route: FF_MODE off shows no mark");
  const wires = await draw("/flows/wires/", FF_ON);
  ok(wires.includes('id="ffxWires"') && count(wires, MARK) === 1, "route: the Wires page carries its own mark");
}

const PLANTS = [
  ["the mark ignores the Wires switch", [["const wantMark = mark === true && ffOnce(html, FF_MARK_ANCHOR)", "const wantMark = ffOnce(html, FF_MARK_ANCHOR)"]]],
  ["the panel ignores the Inbox switch", [["const wantPanel = wantMark && panel === true && slug === \"ticker\"", "const wantPanel = wantMark && slug === \"ticker\""]]],
  ["the kit is loaded a second time", [[".filter((f) => !out.includes(f + \"?v=\"))", ""]]],
  ["inserting twice doubles the slots", [["if (typeof html !== \"string\" || html.includes('data-ff-slot=\"mark\"') || html.includes('data-ff-slot=\"name-panel\"')) return html;", "if (typeof html !== \"string\") return html;"]]],
  ["the mark lands outside the footer", [["const FF_MARK_ANCHOR = '\\n    <div class=\"fx-who\">';", "const FF_MARK_ANCHOR = '\\n  </nav>\\n  <div class=\"fx-side-f\">';"]]],
];

let exit = 0;
const all = [...real.fails, ...route.fails];
for (const f of all) console.log("FAIL " + f);
console.log(`ff-f-slots: ${real.checks + route.checks - all.length} of ${real.checks + route.checks} checks hold`);
if (all.length) exit = 1;
else {
  const survived = [];
  let salt = 0;
  for (const [name, transforms] of PLANTS) {
    const mod = await loadMutated("shared/flows-pages.js", transforms, { salt: ++salt });
    let r;
    try { r = battery(mod.ffSlots, mod.FLOWS_PAGES); } catch { r = { fails: ["threw"] }; }
    if (!r.fails.length) survived.push(name);
  }
  for (const s of survived) console.log("SURVIVED " + s);
  console.log(`ff-f-slots: ${PLANTS.length - survived.length} of ${PLANTS.length} planted wrong builds fail`);
  if (survived.length) exit = 1;
}
process.exit(exit);

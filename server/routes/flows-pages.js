import { HttpError, redirect } from "../http.js";
import { FLOWS_PAGES, ownerNav, macroNav, oracleShell } from "../../shared/flows-pages.js";
import { memberShell } from "../../shared/flows-member-shell.js";
import { modeOf } from "../../shared/flows-member-state.js";
import { EXPORT_PAGES, pageHold } from "../../shared/flows-export-build.js";
import { ledgerLiveOn } from "../../shared/flows-ledger-live.js";
import { flowlabMode } from "../../shared/flows-flowlab.js";
import { flowlabShell } from "../../shared/flows-flowlab-shell.js";
import { floorFundsMode } from "../../shared/flows-floor-funds.js";

const floorFundsOn = (env, owner) => {
  const mode = floorFundsMode(env);
  return mode === "on" || (mode === "owner" && owner === true);
};

const homeNet = (env, owner) => {
  const mode = String(env && env.FLOWS_HOME_NET || "").trim().toLowerCase();
  return mode === "on" || (mode === "owner" && owner === true);
};

const oracleMode = (env, owner) => {
  const mode = String(env && env.FLOWS_ORACLE || "").trim().toLowerCase();
  if (mode === "on") return "on";
  return mode === "owner" && owner === true ? "on" : "off";
};

export const memberOptions = (env, owner, slug) => {
  const state = modeOf(env && env.FLOWS_MEMBER_STATE);
  const exports = modeOf(env && env.FLOWS_EXPORTS);
  const exportsOn = exports === "on" || (exports === "owner" && owner === true);
  return {
    slug,
    on: state === "on" || (state === "owner" && owner === true),
    exportOpen: exportsOn && EXPORT_PAGES.includes(slug) && pageHold(slug) === null,
    exportsOn,
  };
};

const PAGES = Object.freeze([
  { slug: "", from: "overview", summary: true, render: (username, summary, owner, scenes, env) => FLOWS_PAGES.overviewPage({ username, summary, net: homeNet(env, owner) }) },
  { slug: "long", from: "long", render: (username) => FLOWS_PAGES.sidePage({ username, side: "long" }) },
  { slug: "short", from: "short", render: (username) => FLOWS_PAGES.sidePage({ username, side: "short" }) },
  { slug: "watch", from: "watch", render: (username) => FLOWS_PAGES.watchPage({ username }) },
  { slug: "market", render: (username, summary, owner, scenes, env) => FLOWS_PAGES.marketPage({ username, owner, scenes, funds: floorFundsOn(env, owner) }) },
  { slug: "network", render: (username) => FLOWS_PAGES.networkPage({ username }) },
  { slug: "now", render: (username) => FLOWS_PAGES.nowPage({ username }) },
  { slug: "desk", render: (username) => FLOWS_PAGES.deskPage({ username }) },
  { slug: "strategy", render: (username) => FLOWS_PAGES.strategyPage({ username }) },
  { slug: "ticker", render: (username, summary, owner, scenes, env, gates) => FLOWS_PAGES.tickerPage({ username, scenes, privateLens: gates.macroOn(env, owner) }) },
  { slug: "moves", gate: "FLOWS_MOVES", render: (username) => FLOWS_PAGES.movesPage({ username }) },
  { slug: "flowlab", flowlab: true, render: (username) => FLOWS_PAGES.flowlabPage({ username }) },
  { slug: "unusual", render: (username, summary, owner) => FLOWS_PAGES.unusualPage({ username, owner }) },
  { slug: "ledger", gate: "FLOWS_LEDGER", render: (username, summary, owner, scenes, env) => FLOWS_PAGES.ledgerPage({ username, live: ledgerLiveOn(env, owner) }) },
  { slug: "macro", open: "macro", render: (username, summary, owner, scenes, env, gates) => FLOWS_PAGES.macroPage({ username, live: gates.macroLiveOn(env, owner) }) },
  { slug: "events", render: (username, summary, owner, scenes, env, gates) => FLOWS_PAGES.eventsPage({ username, odds: gates.macroOn(env, owner) }) },
  { slug: "political", render: (username) => FLOWS_PAGES.politicalPage({ username }) },
  { slug: "status", ownerOnly: true, render: (username) => FLOWS_PAGES.statusPage({ username }) },
]);

const PUBLIC_PAGES = Object.freeze([
  { slug: "about", render: () => FLOWS_PAGES.aboutPage() },
  { slug: "glossary", render: () => FLOWS_PAGES.glossaryPage() },
]);

export const FLOWS_PAGE_SLUGS = Object.freeze(PAGES.map((page) => page.slug));

export const FLOWS_PUBLIC_SLUGS = Object.freeze(PUBLIC_PAGES.map((page) => page.slug));

export const FLOWS_GONE_SLUGS = Object.freeze(["ask", "track", "history"]);


const GET_HEAD = ["GET", "HEAD"];

const html = (body) => new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

const slashed = (slug) => "/flows/" + (slug === "" ? "" : slug + "/");

export function flowsPageRows(deps) {
  const { currentFlowsUser, readFlowsSummary, isOwner, scenesOn = () => false, macroOn = () => false, macroLiveOn = () => false } = deps;
  const rows = [];

  rows.push({
    id: "flows.pages.root",
    path: "/flows",
    methods: GET_HEAD,
    auth: "none",
    handler: ({ url }) => redirect(new URL("/flows/", url).toString(), 308),
  });

  rows.push({
    id: "flows.pages.login",
    path: "/flows/login/",
    methods: GET_HEAD,
    auth: "none",
    handler: () => html(FLOWS_PAGES.loginPage()),
  });

  for (const page of PAGES) {
    const path = slashed(page.slug);
    rows.push({
      id: "flows.pages." + (page.slug === "" ? "overview" : page.slug),
      path,
      methods: GET_HEAD,
      auth: "none",
      handler: async ({ request, env, url }) => {
        if (page.from !== undefined && url.searchParams.has("t")) {
          const wanted = (url.searchParams.get("t") || "").trim();
          if (wanted) {
            return redirect(new URL(
              "/flows/ticker/?t=" + encodeURIComponent(wanted) +
              "&s=signal&from=" + page.from, url).toString(), 302);
          }
        }
        const session = await currentFlowsUser(request, env);
        if (session && page.gate) {
          const mode = String(env[page.gate] || "owner").trim().toLowerCase();
          if (mode === "off" || (mode !== "on" && !isOwner(env, session.username))) throw HttpError.of("not_found");
        }
        if (session && page.open === "macro" && !macroOn(env, isOwner(env, session.username))) throw HttpError.of("not_found");
        const summary = session && page.summary ? await readFlowsSummary(env, "board") : null;
        if (!session) return html(FLOWS_PAGES.loginPage());
        const owner = isOwner(env, session.username);
        if (page.ownerOnly && !owner) throw HttpError.of("not_found");
        const slug = page.slug || "overview";
        const labOn = flowlabMode(env, owner) === "on";
        if (page.flowlab && !labOn) throw HttpError.of("not_found");
        const shown = memberShell(oracleShell(flowlabShell(page.render(session.username, summary, owner, scenesOn(env, session.username), env, { macroOn, macroLiveOn }), slug, labOn), oracleMode(env, owner), slug), memberOptions(env, owner, slug));
        const rendered = macroOn(env, owner) ? macroNav(shown) : shown;
        return html(owner ? ownerNav(rendered) : rendered);
      },
    });
    if (page.slug !== "") {
      rows.push({
        id: "flows.pages." + page.slug + ".bare",
        path: "/flows/" + page.slug,
        methods: GET_HEAD,
        auth: "none",
        handler: ({ url }) => redirect(new URL(path, url).toString(), 308),
      });
    }
  }

  for (const page of PUBLIC_PAGES) {
    const path = slashed(page.slug);
    rows.push({
      id: "flows.pages." + page.slug,
      path,
      methods: GET_HEAD,
      auth: "none",
      handler: ({ env }) => {
        if (String(env.FLOWS_FRONT_DOOR || "on").trim().toLowerCase() === "off") throw HttpError.of("not_found");
        return html(page.render());
      },
    });
    rows.push({
      id: "flows.pages." + page.slug + ".bare",
      path: "/flows/" + page.slug,
      methods: GET_HEAD,
      auth: "none",
      handler: ({ url }) => redirect(new URL(path, url).toString(), 308),
    });
  }

  for (const slug of FLOWS_GONE_SLUGS) {
    for (const path of [slashed(slug), "/flows/" + slug]) {
      rows.push({
        id: "flows.pages.gone." + slug + (path.endsWith("/") ? "" : ".bare"),
        path,
        methods: GET_HEAD,
        auth: "none",
        handler: ({ url }) => redirect(new URL("/flows/", url).toString(), 308),
      });
    }
  }

  return rows;
}

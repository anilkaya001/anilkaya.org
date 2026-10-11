import { HttpError, redirect } from "../http.js";
import { FLOWS_PAGES } from "../../shared/flows-pages.js";

const homeNet = (env, owner) => owner === true && String(env && env.FLOWS_HOME_NET || "").trim().toLowerCase() === "owner";

const PAGES = Object.freeze([
  { slug: "", from: "overview", summary: true, render: (username, summary, owner, scenes, env) => FLOWS_PAGES.overviewPage({ username, summary, net: homeNet(env, owner) }) },
  { slug: "long", from: "long", render: (username) => FLOWS_PAGES.sidePage({ username, side: "long" }) },
  { slug: "short", from: "short", render: (username) => FLOWS_PAGES.sidePage({ username, side: "short" }) },
  { slug: "watch", from: "watch", render: (username) => FLOWS_PAGES.watchPage({ username }) },
  { slug: "market", render: (username, summary, owner, scenes) => FLOWS_PAGES.marketPage({ username, owner, scenes }) },
  { slug: "history", render: (username) => FLOWS_PAGES.historyPage({ username }) },
  { slug: "desk", render: (username) => FLOWS_PAGES.deskPage({ username }) },
  { slug: "strategy", render: (username) => FLOWS_PAGES.strategyPage({ username }) },
  { slug: "ask", render: (username) => FLOWS_PAGES.askPage({ username }) },
  { slug: "ticker", render: (username, summary, owner, scenes) => FLOWS_PAGES.tickerPage({ username, scenes }) },
  { slug: "moves", gate: "FLOWS_MOVES", render: (username) => FLOWS_PAGES.movesPage({ username }) },
  { slug: "unusual", render: (username, summary, owner) => FLOWS_PAGES.unusualPage({ username, owner }) },
  { slug: "events", render: (username) => FLOWS_PAGES.eventsPage({ username }) },
  { slug: "track", render: (username) => FLOWS_PAGES.trackPage({ username }) },
  { slug: "political", render: (username) => FLOWS_PAGES.politicalPage({ username }) },
  { slug: "status", ownerOnly: true, render: (username) => FLOWS_PAGES.statusPage({ username }) },
]);

const PUBLIC_PAGES = Object.freeze([
  { slug: "about", render: () => FLOWS_PAGES.aboutPage() },
  { slug: "glossary", render: () => FLOWS_PAGES.glossaryPage() },
]);

export const FLOWS_PAGE_SLUGS = Object.freeze(PAGES.map((page) => page.slug));

export const FLOWS_PUBLIC_SLUGS = Object.freeze(PUBLIC_PAGES.map((page) => page.slug));

const scenesOn = (env) => String(env.FLOWS_SCENES || "off").trim().toLowerCase() === "owner";

const GET_HEAD = ["GET", "HEAD"];

const html = (body) => new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

const slashed = (slug) => "/flows/" + (slug === "" ? "" : slug + "/");

export function flowsPageRows(deps) {
  const { currentFlowsUser, readFlowsSummary, isOwner, scenesOn = () => false } = deps;
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
        const summary = session && page.summary ? await readFlowsSummary(env, "board") : null;
        if (!session) return html(FLOWS_PAGES.loginPage());
        const owner = isOwner(env, session.username);
        if (page.ownerOnly && !owner) throw HttpError.of("not_found");
        return html(page.render(session.username, summary, owner, scenesOn(env, session.username), env));
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

  return rows;
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIND_RANK = { control: 0, text: 1, graphic: 2 };
const STATE_ORDER = ["rest", "pill", "badge", "toast", "undo", "restore"];
const PAGE_ORDER = ["overview", "long", "short", "watch", "market", "network", "now", "moves", "unusual", "flowlab", "ledger", "events", "political", "strategy", "desk", "ticker", "status", "fire"];
const PAGE_NAME = { overview: "Home", long: "Bullish board", short: "Bearish board", watch: "Watchlist", market: "Market", network: "Network", now: "Now", moves: "Moves", unusual: "Unusual", flowlab: "Flow Lab", ledger: "Ledger", events: "Events", political: "Political", strategy: "Strategy", desk: "Premium desk", ticker: "Ticker", status: "Status", fire: "Fire" };
const NEED = { desktop: 76, phone: 68 };

const esc = (t) => String(t === null || t === undefined ? "" : t).replace(/\|/g, "\\|").replace(/\n/g, " ");
const stateBase = (s) => s.replace(/^dock:/, "");
const sortStates = (list) => [...new Set(list)].sort((a, b) => (a.startsWith("dock:") - b.startsWith("dock:")) || STATE_ORDER.indexOf(stateBase(a)) - STATE_ORDER.indexOf(stateBase(b)));
const pageRank = (p) => { const i = PAGE_ORDER.indexOf(p); return i < 0 ? 99 : i; };
const sizeRank = (inv, s) => inv.meta.sizes.indexOf(s);

export function flatten(inv) {
  const rows = [];
  for (const job of inv.jobs) {
    for (const run of job.runs || []) {
      for (const [state, s] of Object.entries(run.sample.states || {})) {
        for (const h of s.hits) {
          rows.push({ page: job.page, size: job.size, phone: job.phone, view: run.view, pos: run.pos, dock: !!run.dock, dockModal: !!run.dockModal, state, ...h });
        }
      }
    }
  }
  return rows;
}

const serious = (r) => r.layer === "under" && !r.inControl;

export function merged(inv) {
  const out = new Map();
  for (const r of flatten(inv)) {
    if (!serious(r)) continue;
    const key = [r.page, r.size, r.dock ? "dock" : "", r.kind, r.sel, r.label].join("\u0001");
    let m = out.get(key);
    if (!m) {
      m = { page: r.page, size: r.size, dock: r.dock, dockModal: r.dockModal, kind: r.kind, sub: r.sub, label: r.label, sel: r.sel, byState: {}, byPart: {}, parts: [], states: [], views: [], scrolls: [], covered: "", coveredArea: 0, chrome: r.chrome, dimmed: r.dimmed, phone: r.phone };
      out.set(key, m);
    }
    const sk = r.state + "\u0001" + r.view + "\u0001" + r.pos;
    m.byState[sk] = (m.byState[sk] || 0) + r.area;
    m.byPart[r.part] = Math.max(m.byPart[r.part] || 0, r.area);
    if (r.covered && r.area > m.coveredArea) { m.covered = r.covered; m.coveredArea = r.area; }
    m.parts.push(r.part);
    m.states.push(r.state);
    m.views.push(r.view);
    m.scrolls.push(r.pos);
    m.dimmed = m.dimmed || r.dimmed;
  }
  const list = [...out.values()].map((m) => {
    let area = 0, worst = null;
    const stateArea = {};
    for (const [k, a] of Object.entries(m.byState)) {
      const st = k.split("\u0001")[0];
      stateArea[st] = Math.max(stateArea[st] || 0, a);
      if (a > area) { area = a; worst = st; }
    }
    const parts = [...new Set(m.parts)].sort((a, b) => ["orb", "badge", "pill", "toast", "undo", "restore"].indexOf(a) - ["orb", "badge", "pill", "toast", "undo", "restore"].indexOf(b));
    return { ...m, area, worst, stateArea, parts, part: parts.join(" + ") + (m.dock ? " (dock open)" : ""), states: sortStates(m.states), views: [...new Set(m.views)], scrolls: [...new Set(m.scrolls)] };
  });
  list.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.area - a.area || pageRank(a.page) - pageRank(b.page));
  return list;
}

const viewText = (views) => {
  const v = views.filter((x) => x !== "default");
  return views.includes("default") ? (v.length ? "default + " + v.join(", ") : "") : v.join(", ");
};

const inertNote = (m) => (!m.dimmed ? "" : m.dock && m.dockModal ? " (inert: behind the modal Ask dock)" : " (inert, still drawn)");

export function itemFor(m) {
  const where = viewText(m.views);
  const scroll = m.scrolls.includes("end") && !m.scrolls.includes("top") ? " (scrolled to the end)" : "";
  const label = (m.kind === "text" && m.covered && m.covered !== m.label ? `${m.label} [covered: ${m.covered}]` : m.label) || m.sel;
  const states = m.states.length > 1 ? m.states.join(", ") + "; worst " + m.worst : m.states.join(", ");
  return {
    page: (PAGE_NAME[m.page] || m.page) + (where ? " [" + where + "]" : "") + scroll,
    size: m.size,
    state: states,
    part: m.part,
    kind: m.kind,
    label: (m.sub && m.kind !== "text" ? m.sub + ": " : "") + label + inertNote(m) + " · " + m.sel,
    area: m.area,
  };
}

function cornerTable(inv) {
  const sizes = inv.meta.sizes;
  const lines = ["| Page | " + sizes.join(" | ") + " |", "|---|" + sizes.map(() => "---").join("|") + "|"];
  const pages = [...new Set(inv.jobs.map((j) => j.page))].sort((a, b) => pageRank(a) - pageRank(b));
  for (const p of pages) {
    const cells = sizes.map((s) => {
      const job = inv.jobs.find((j) => j.page === p && j.size === s);
      if (!job) return "";
      const run = (job.runs || []).find((r) => r.view === "default" && r.pos === "top" && !r.dock);
      if (!run) return job.errors && job.errors.length ? "error" : "";
      const c = run.corner;
      const need = job.phone ? NEED.phone : NEED.desktop;
      const fs = c.freeSquare ? Math.round(c.freeSquare.s) : null;
      const nd = c.nearest ? Math.round(c.nearest.d) : null;
      const flag = fs !== null && fs < need ? " ✗" : "";
      const scrolls = run.scrollInfo && run.scrollInfo.y ? " (scrolls)" : "";
      const vp = job.phone && c.viewport ? ` · viewport ${Math.round(c.viewport.s)} / ${Math.round(c.viewport.d)}` : "";
      return fs === null ? "free (none in " + Math.round(c.regionW) + "×" + Math.round(c.regionH) + ")" + scrolls : `${fs} / ${nd}${flag}${vp}${scrolls}`;
    });
    lines.push(`| ${PAGE_NAME[p] || p} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

export function cornerText(inv) {
  const pages = [...new Set(inv.jobs.map((j) => j.page))].sort((a, b) => pageRank(a) - pageRank(b));
  const parts = [];
  for (const p of pages) {
    const cells = inv.meta.sizes.map((s) => {
      const job = inv.jobs.find((j) => j.page === p && j.size === s);
      const run = job && (job.runs || []).find((r) => r.view === "default" && r.pos === "top" && !r.dock);
      if (!run) return s + " ?";
      const c = run.corner;
      const vp = job.phone && c.viewport ? " (viewport " + Math.round(c.viewport.s) + "/" + Math.round(c.viewport.d) + ")" : "";
      return s + " " + (c.freeSquare ? Math.round(c.freeSquare.s) : "free") + "/" + (c.nearest ? Math.round(c.nearest.d) : "free") + vp;
    });
    parts.push((PAGE_NAME[p] || p) + ": " + cells.join(", "));
  }
  return "free square side / nearest content distance in px from the content corner (the viewport's bottom-right corner on a desktop, the top of the tab bar on a phone, where the viewport's own corner follows in brackets), default view; the orb needs 76 on a desktop and 68 on a phone: " + parts.join("; ");
}

function stateTable(inv, list, state, { limit = 60 } = {}) {
  const all = list.filter((m) => m.states.includes(state)).map((m) => ({ m, a: m.stateArea[state] || 0 }))
    .sort((x, y) => KIND_RANK[x.m.kind] - KIND_RANK[y.m.kind] || y.a - x.a || pageRank(x.m.page) - pageRank(y.m.page));
  const rows = all.slice(0, limit);
  if (!rows.length) return "_Nothing is covered in this state._";
  const lines = ["| Page | View | Size | Kind | What is covered | Area px² in this state |", "|---|---|---|---|---|---:|"];
  for (const { m, a } of rows) {
    const it = itemFor(m);
    lines.push(`| ${esc(PAGE_NAME[m.page] || m.page)} | ${esc(viewText(m.views) || "default")} | ${m.size} | ${m.kind} | ${esc(it.label)} | ${a} |`);
  }
  if (all.length > limit) lines.push(`| | | | | ${all.length - limit} more in inventory.json | |`);
  return lines.join("\n");
}

function countMatrix(inv, list, pick) {
  const sizes = inv.meta.sizes;
  const pages = [...new Set(inv.jobs.map((j) => j.page))].sort((a, b) => pageRank(a) - pageRank(b));
  const lines = ["| Page | " + sizes.join(" | ") + " |", "|---|" + sizes.map(() => "---").join("|") + "|"];
  for (const p of pages) {
    const cells = sizes.map((s) => {
      const job = inv.jobs.find((j) => j.page === p && j.size === s);
      if (!job) return "";
      const rows = list.filter((m) => m.page === p && m.size === s && pick(m));
      if (!rows.length) return "·";
      const c = rows.filter((m) => m.kind === "control").length, t = rows.filter((m) => m.kind === "text").length, g = rows.filter((m) => m.kind === "graphic").length;
      return [c ? c + "c" : "", t ? t + "t" : "", g ? g + "g" : ""].filter(Boolean).join(" ");
    });
    lines.push(`| ${PAGE_NAME[p] || p} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function shown(inv) {
  const ok = inv.jobs.filter((j) => j.check && j.check.ok).length, all = inv.jobs.filter((j) => j.check).length;
  const gl = inv.jobs.filter((j) => j.parts && (j.parts.rest || []).some((p) => p.part === "orb" && p.webgl)).length;
  return `The hooked states match the real path (open the sheet, press Hidden, wait 10 s, press the restore button) on ${ok} of ${all} page and size pairs, and the WebGL orb mounted inside the CSS orb's box on ${gl} of ${inv.jobs.length}.`;
}

function partsTable(inv) {
  const lines = ["| Size | State | Parts (x, y, w × h, corner radius) |", "|---|---|---|"];
  const seen = new Set();
  for (const s of inv.meta.sizes) {
    const job = inv.jobs.find((j) => j.size === s && j.parts);
    if (!job) continue;
    for (const [st, ps] of Object.entries(job.parts)) {
      const k = s + st;
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push(`| ${s} | ${st} | ${ps.map((p) => `${p.part} ${p.x}, ${p.y}, ${p.w} × ${p.h}, r ${p.radius}${p.text ? " “" + esc(p.text) + "”" : ""}`).join("; ") || "nothing drawn"} |`);
    }
  }
  return lines.join("\n");
}

function dockTable(inv) {
  const lines = ["| Page | Size | Dock | Orb moved to | Free square / nearest (px, from the dock's left edge) | Covered at rest | Covered by the pill |", "|---|---|---|---|---|---|---|"];
  const jobs = inv.jobs.filter((j) => (j.runs || []).some((r) => r.dock)).sort((a, b) => pageRank(a.page) - pageRank(b.page) || sizeRank(inv, a.size) - sizeRank(inv, b.size));
  for (const job of jobs) {
    const run = job.runs.find((r) => r.dock);
    const orb = (run.dockParts && run.dockParts["dock:rest"] || []).find((p) => p.part === "orb");
    const c = run.corner;
    const list = (st) => (run.sample.states[st] ? run.sample.states[st].hits.filter(serious).map((h) => h.kind + " “" + esc(h.label).slice(0, 40) + "” " + h.area) : []).slice(0, 4).join("; ") || "—";
    lines.push(`| ${PAGE_NAME[job.page] || job.page} | ${job.size} | ${run.dockModal ? "modal (page inert)" : "beside the page"} | ${orb ? orb.x + ", " + orb.y : "hidden"} | ${c.freeSquare ? Math.round(c.freeSquare.s) : "free"} / ${c.nearest ? Math.round(c.nearest.d) : "free"} | ${list("dock:rest")} | ${list("dock:pill")} |`);
  }
  return lines.join("\n");
}

function checkTable(inv) {
  const bad = inv.jobs.filter((j) => j.check && !j.check.ok);
  const ok = inv.jobs.filter((j) => j.check && j.check.ok).length;
  const lines = [`The real path (open the sheet, press Hidden, wait 10.1 s on the page clock, press the restore button) was run once per page and size and compared with the hooked states: ${ok} of ${inv.jobs.filter((j) => j.check).length} matched to 0.6 px.`];
  for (const j of bad) lines.push(`- ${PAGE_NAME[j.page] || j.page} ${j.size}: ${j.check.error ? "error " + esc(j.check.error) : "undo " + (j.check.undo && j.check.undo.match) + ", restore " + (j.check.restore && j.check.restore.match)}`);
  return lines.join("\n");
}

function reachText(inv) {
  const fl = new Map();
  for (const j of inv.jobs) if (j.reach) fl.set(j.page, (fl.get(j.page) || false) || j.reach.flStream);
  const yes = [...fl].filter(([, v]) => v).map(([p]) => PAGE_NAME[p] || p);
  const no = [...fl].filter(([, v]) => !v).map(([p]) => PAGE_NAME[p] || p);
  return `The pill, the count badge and the phone toast come only from a live flow message, which reaches the Neuron on pages that subscribe it to the flow topic of the real-time rail (${yes.join(", ")}), or from a signal record on the ticker page. On ${no.join(", ")} the Neuron is not subscribed, so those three states cannot occur there today; they are measured anyway because a later change could subscribe them.`;
}

export function writeReport(inv, out) {
  const list = merged(inv);
  const items = list.slice(0, 120).map(itemFor);
  const counts = { controls: 0, text: 0, graphics: 0 };
  for (const m of list) counts[m.kind === "control" ? "controls" : m.kind === "text" ? "text" : "graphics"]++;
  const affected = new Set(list.map((m) => m.page));
  const atRest = list.filter((m) => m.states.includes("rest"));
  const restPages = new Set(atRest.map((m) => m.page));
  const views = inv.jobs.reduce((n, j) => n + (j.runs || []).length, 0);
  const errs = inv.jobs.filter((j) => (j.errors || []).length);
  const cmd = path.join(HERE, "survey.mjs");
  const md = [];
  md.push("# Neuron corner survey");
  md.push("");
  md.push("Run it (from any directory; the checkout needs `tests/node_modules`, linked from another checkout is fine):");
  md.push("");
  md.push("```bash");
  md.push(`# the whole survey (about 15 to 25 minutes; two pages at a time on one Chromium)`);
  md.push(`PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/pw node ${cmd} --repo <checkout>`);
  md.push(`# one page after a fix, folded into this inventory (same page and size replaced), with corner crops`);
  md.push(`PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/pw node ${cmd} --repo <checkout> --only '^market$' --merge ${path.join(out, "inventory.json")} --shots <dir>`);
  md.push(`# rewrite this file, or print the ranked list and counts as JSON`);
  md.push(`node ${cmd} --summarize ${path.join(out, "inventory.json")}`);
  md.push(`node ${path.join(HERE, "report.mjs")} ${path.join(out, "inventory.json")} --json`);
  md.push("```");
  md.push("");
  md.push("`--help` lists every option (`--sizes`, `--views default`, `--no-dock`, `--no-scroll`, `--no-check`, `--jobs`, `--step`, `--as owner`, `--env main`, `--emit-dir`, `--shots-views all`). The checkout needs `tests/node_modules` (a symlink to another checkout's is fine); nothing in it is modified. `in-page.js` is the in-browser measurer and `strategy-world.mjs` the stubbed feed behind the Strategy page.");
  md.push("");
  md.push(`This run: ${inv.meta.generatedAt}, commit \`${inv.meta.commit}\`, ${inv.jobs.length} page and size pairs, ${views} measured views, ${inv.meta.elapsedS} s. The full inventory is \`${path.join(out, "inventory.json")}\` (every page, size, view, scroll position, state, part box and covered element with its area).`);
  const shots = path.join(out, "shots");
  if (fs.existsSync(shots)) md.push(`Corner crops of the default view (the bottom-right 760 × 420 px at most, JPEG) are in \`${shots}\`: \`<page>-<size>-<state>.jpg\` for rest, pill or toast, undo and restore, and \`<page>-<size>-dock-<state>.jpg\` with the Ask dock open; ${fs.readdirSync(shots).length} files.`);
  md.push("");
  md.push("## Findings");
  md.push("");
  md.push(`- Distinct covered items (merged across states, views and scroll positions; text and icons inside a covered control counted once, as the control): **${counts.controls} controls, ${counts.text} text runs, ${counts.graphics} graphics**, on **${affected.size} of ${new Set(inv.jobs.map((j) => j.page)).size} pages**.`);
  md.push(`- The orb at rest alone covers content on ${restPages.size} pages: ${[...restPages].sort((a, b) => pageRank(a) - pageRank(b)).map((p) => (PAGE_NAME[p] || p) + " (" + [...new Set(atRest.filter((m) => m.page === p).map((m) => m.size))].sort((a, b) => sizeRank(inv, a) - sizeRank(inv, b)).join(", ") + ")").join("; ") || "none"}.`);
  for (const st of ["pill", "toast", "undo", "restore"]) {
    const ps = new Set(list.filter((m) => m.states.includes(st)).map((m) => m.page));
    md.push(`- ${st === "pill" ? "The signal pill (desktop, measured at its 300 px cap)" : st === "toast" ? "The phone toast" : st === "undo" ? "The 10 s “Neuron hidden · Undo” chip" : "The collapsed restore button"} covers content on ${ps.size} pages: ${[...ps].sort((a, b) => pageRank(a) - pageRank(b)).map((p) => PAGE_NAME[p] || p).join(", ") || "none"}.`);
  }
  const dockPages = new Set(list.filter((m) => m.dock).map((m) => m.page));
  const shifts = new Set();
  for (const j of inv.jobs) {
    const run = (j.runs || []).find((r) => r.dock && r.dockParts);
    const a = j.parts && (j.parts.rest || []).find((p) => p.part === "orb");
    const b = run && (run.dockParts["dock:rest"] || []).find((p) => p.part === "orb");
    if (a && b) shifts.add(j.size + " " + Math.round(a.x - b.x) + " px");
  }
  md.push(`- With the Ask dock open (768 px and wider) the orb moves left onto the page (${[...shifts].sort().join(", ") || "not measured"}) and covers content on ${dockPages.size} pages: ${[...dockPages].sort((a, b) => pageRank(a) - pageRank(b)).map((p) => PAGE_NAME[p] || p).join(", ") || "none"}.`);
  const rows = flatten(inv);
  const over = rows.filter((r) => r.layer === "over").length;
  const chrome = rows.filter((r) => r.layer === "under" && r.chrome).length;
  const inert = list.filter((m) => m.dimmed);
  md.push(`- Nothing is drawn over the Neuron (${over} sample hits above its layer) and no chrome is covered (${chrome} hits on the top bar, tab bar, sidebar or dock). ${inert.length} covered items are inert: ${[...new Set(inert.map((m) => (m.dock ? "behind the modal Ask dock at " : "Home's Glance tiles at ") + m.size))].join(", ")}.`);
  md.push(`- ${shown(inv)}`);
  if (errs.length) md.push(`- Errors during the run: ${errs.map((j) => (PAGE_NAME[j.page] || j.page) + " " + j.size + ": " + esc(j.errors.slice(0, 2).join(" | ")).slice(0, 160)).join("; ")}.`);
  else md.push("- No page error, no mount failure, no sample point that lost the probe.");
  md.push("");
  md.push("## Covered items by page and size");
  md.push("");
  md.push("Counts of distinct covered items in any view of the page (c controls, t text runs, g graphics; · nothing covered; empty: not measured).");
  md.push("");
  for (const [title, pick] of [
    ["The orb at rest", (m) => m.states.includes("rest") && !m.dock],
    ["The pill and badge (desktop) or the toast and badge (phone)", (m) => (m.states.includes("pill") || m.states.includes("toast")) && !m.dock],
    ["The 10 s Undo chip or the restore button", (m) => (m.states.includes("undo") || m.states.includes("restore")) && !m.dock],
    ["Any state with the Ask dock open", (m) => m.dock],
  ]) {
    md.push("**" + title + "**");
    md.push("");
    md.push(countMatrix(inv, list, pick));
    md.push("");
  }
  md.push("## Free corner by page and size");
  md.push("");
  const tab = [...new Set(inv.jobs.filter((j) => j.phone).map((j) => { const r = (j.runs || []).find((x) => !x.dock); return r ? j.size + " " + Math.round(Number(j.size.split("x")[1]) - r.corner.cy) + " px" : null; }).filter(Boolean))];
  md.push(`Each cell is the side of the largest square anchored at the content corner that holds no content, then the distance to the nearest content, both in CSS px, default view, page scrolled to the top (\`corner\` in each run of the inventory has both, the point and the element). The content corner is the viewport's bottom-right corner on a desktop and the top of the tab bar on a phone (the tab bar is ${[...new Set(tab.map((t) => t.split(" ")[1]))].join(" or ")} px tall at ${tab.map((t) => t.split(" ")[0]).join(" and ")}; phone cells add the same two figures measured from the viewport's own corner). A free square says nothing about the pill, which reaches 324 × 76 px from the corner on a desktop; the state tables measure it directly. The orb needs ${NEED.desktop} px on a desktop (24 px gap plus 52 px) and ${NEED.phone} px on a phone (16 px gap plus 52 px, 12 px above the tab bar); ✗ marks a corner smaller than that. Content means a control, a text run or a graphic (canvas pixels, SVG marks, an image, a painted leaf box such as a meter bar); chrome (top bar, tab bar, sidebar, dock) is not content here.`);
  md.push("");
  md.push(cornerTable(inv));
  md.push("");
  md.push("## The Neuron's parts");
  md.push("");
  md.push("Boxes in viewport px, read from the module's own elements after it painted each state (one representative page per size; the parts are fixed to the viewport, so every page shares them).");
  md.push("");
  md.push(partsTable(inv));
  md.push("");
  md.push(reachText(inv));
  md.push("");
  for (const [st, title, limit] of [["rest", "The orb at rest", 90], ["pill", "The signal pill and badge (desktop)", 40], ["badge", "The count badge (Count preference)", 20], ["toast", "The phone toast", 40], ["undo", "Hidden: the 10 s Undo chip", 40], ["restore", "Hidden: the restore button after the chip collapses", 30]]) {
    md.push(`## ${title}`);
    md.push("");
    md.push(stateTable(inv, list.filter((m) => !m.dock), st, { limit }));
    md.push("");
  }
  md.push("## The Ask dock open");
  md.push("");
  md.push(dockTable(inv));
  md.push("");
  md.push("## Ranked list (most serious first: controls, then text, then graphics, larger areas first)");
  md.push("");
  md.push("One row per covered element of a page at a size (the same element in several views or states is one row). Area is the element's covered area in its worst state, summed over the parts that cover it there; States lists every state that covers it, then the worst; the What column ends with the element's selector.");
  md.push("");
  md.push("| # | Page [views] | Size | States | Part | Kind | What | Area px² |");
  md.push("|---:|---|---|---|---|---|---|---:|");
  items.forEach((it, i) => md.push(`| ${i + 1} | ${esc(it.page)} | ${it.size} | ${esc(it.state)} | ${esc(it.part)} | ${it.kind} | ${esc(it.label)} | ${it.area} |`));
  md.push("");
  md.push("## Check of the hooked states");
  md.push("");
  md.push(checkTable(inv));
  md.push("");
  md.push("## How it measures");
  md.push("");
  md.push("- **Pages.** Every member page row of `server/routes/flows-pages.js` is rendered by calling that row's own handler, so each page is `memberShell(oracleShell(flowlabShell(page)))` exactly as served, with `ownerNav` for the owner. The switches come from `wrangler.toml` [vars] with `FLOWS_ORACLE=on`" + (inv.meta.envMode === "main" ? "." : " and the switches PR #286 opens to every member (`FLOWS_LEDGER`, `FLOWS_LEDGER_LIVE`, `FLOWS_FLOWLAB`, `FLOWS_FLOWLAB_ANALYTICS`, `FLOWS_EXPORTS` = on).") + ` The viewer is a ${inv.meta.viewer}; Status is rendered for the owner. ${inv.pages.filter((p) => p.note).map((p) => (PAGE_NAME[p.id] || p.id) + ": " + p.note + ".").join(" ")}`);
  md.push("- **Data.** Served from `page.route` with no server and no feed call: the pipeline's dry-run emit (`tests/lib/nightly-emit.mjs`) answers the Flows routes the way `tests/flows-layout-sweep.mjs` does, the emitted `oracle-*` records answer `/api/flows/oracle`, the Ledger reads `tests/lib/sfc-render-world.mjs` (its live book is answered 404, so the live layer stands down to the server ledger), Flow Lab reads `tests/lib/flowlab-world.mjs`, Status reads `tests/lib/status-world.mjs`, Fire reads `tests/lib/ff-d-world.mjs`, the desk reads a chain built with `tests/desk-fixtures.mjs`. The rail (`/api/rt/*`) answers `rt_off` and member state (`/api/me/*`) answers 404. The page clock is pinned: " + Object.entries(inv.meta.clock).map(([k, v]) => k + " " + v).join(", ") + ". Motion is reduced and transitions are switched off.");
  md.push(`- **Sizes.** ${inv.meta.sizes.join(", ")}; under 768 px wide the context has touch and a coarse pointer.`);
  md.push("- **Views.** The default view, then every page-level tab and sub-tab (Home's pager, Market's views and its phone module switch, Unusual and Events tabs, Flow Lab views and its phone module switch, Ledger, Moves and Political phone panels, the desk tabs, Status tabs and its phone card switch, Fire's panels), and for a page that scrolls, the same view scrolled to the end. The Ask dock is opened on the default view at 768 px and wider.");
  md.push(`- **States.** \`assets/js/flows-oracle.js\` is served with one added line that exposes its state object and paint functions (\`window.__orcHook\`); the states are then set through the module's own \`paint()\`: rest (no message, preference on), pill (one synthetic live message, “GOOGL · flow in one expiry”, preference on; the pill is widened to its ${inv.meta.pillWidth} px cap, which a ticker page's call headline reaches), badge (the same message, preference Count), toast (phones only: \`showToast\`), undo (preference off with the 10 s window open) and restore (preference off, window closed). The sheet is out of scope.`);
  md.push(`- **Coverage.** The union of all parts is sampled on a ${inv.meta.step} px grid, only at points inside a part's rounded shape (circle for the orb, stadium for the pill, chip and badge). At each point \`document.elementsFromPoint\` is read with every element made hit-testable and the Neuron replaced by a transparent probe in its own stacking context, so the stack says what lies under the Neuron (\`under\`) and what is drawn over it (\`over\`); clipped, hidden and \`visibility: hidden\` content never appears. A control is \`a[href]\`, \`button\`, \`input\`, \`select\`, \`textarea\`, \`summary\`, a button, tab, link, switch, checkbox or option role, or \`tabindex\` ≥ 0. Text is every non-space text node whose \`Range\` client rects contain the point while its box is in the stack. A graphic is a canvas (only where its own pixels have alpha above 8 when the canvas can be read), the marks of one SVG drawing (hit only where painted), an image, or a leaf element with a painted background or border. Each point stands for ${inv.meta.step * inv.meta.step} px² and belongs to the topmost part (badge, orb, pill, toast, chip). Text and icons inside a covered control are kept in the inventory with \`inControl\` and left out of the counts and the ranking.`);
  md.push("- **Not measured.** The signal state's 22 px glow around the orb, the orb's focus ring (2 px at 3 px offset) and the sheet. Pages render from fixtures, so a row count or a label length in production can put different content in the corner; the inventory names the selector of every covered element so a builder can find it on the real page. A live message's headline makes the pill 200 to 292 px wide; the ranking uses the 300 px cap.");
  md.push("");
  fs.writeFileSync(path.join(out, "summary.md"), md.join("\n"));
  return { list, items, counts, pagesAffected: affected.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--")) || path.join(HERE, "inventory.json");
  const inv = JSON.parse(fs.readFileSync(file, "utf8"));
  const r = writeReport(inv, path.dirname(path.resolve(file)));
  if (args.includes("--json")) {
    const states = new Set();
    for (const j of inv.jobs) for (const run of j.runs || []) for (const st of Object.keys(run.sample.states || {})) states.add(st);
    console.log(JSON.stringify({
      counts: { ...r.counts, pagesAffected: r.pagesAffected },
      overlaps: r.items,
      pages: [...new Set(inv.jobs.map((j) => j.page))].sort((a, b) => pageRank(a) - pageRank(b)),
      sizes: inv.meta.sizes,
      states: sortStates([...states]),
      cornerMargins: cornerText(inv),
    }, null, 1));
  } else {
    console.log(JSON.stringify({ counts: r.counts, pagesAffected: r.pagesAffected, items: r.items.length }));
  }
}

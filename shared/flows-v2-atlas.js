const GROUPS = [
  {
    id: "now", title: "Now", detail: "Market direction, unusual activity and the current session.",
    links: [["Market overview", "/flows/"], ["Flagged now", "/flows/now/"]],
  },
  {
    id: "flow", title: "Flow", detail: "Follow unusual options activity and relationships between names.",
    links: [["Unusual activity", "/flows/unusual/"], ["Flow network", "/flows/network/"], ["Flow Lab", "/flows/flowlab/", "hasFlowLab"]],
  },
  {
    id: "screener", title: "Screener", detail: "Find names of interest and return to your watchlist.",
    links: [["Bullish board", "/flows/long/"], ["Bearish board", "/flows/short/"], ["Watchlist", "/flows/watch/"], ["Moves", "/flows/moves/", "hasMoves"]],
  },
  {
    id: "name", title: "Name", detail: "Open the price, flow, exposure and volatility views for a listing.",
    links: [["Find a name", "/flows/ticker/"], ["NVDA dossier", "/flows/ticker/?t=NVDA"], ["Price response", "/flows/ticker/?t=NVDA&chart=response", "hasResearch"]],
  },
  {
    id: "structure", title: "Structure", detail: "See how activity and exposure are distributed across the market.",
    links: [["Market", "/flows/market/"], ["Rotation", "/flows/rotation/", "hasRotation"], ["Ledger", "/flows/ledger/", "hasLedger"]],
  },
  {
    id: "calendar", title: "Calendar", detail: "Review upcoming events and past earnings moves.",
    links: [["Events", "/flows/events/"]],
  },
  {
    id: "money", title: "Money", detail: "Follow filings, holdings and reported transactions.",
    links: [["Positioning", "/flows/positioning/", "hasPositioning"], ["Political trades", "/flows/political/"]],
  },
  {
    id: "macro", title: "Macro", detail: "Follow rates, currencies and other cross-asset readings.",
    links: [["Macro", "/flows/macro/", "hasMacro"]],
  },
  {
    id: "desk", title: "Desk", detail: "Research option structures and review premium opportunities.",
    links: [["Strategy", "/flows/strategy/"], ["Premium desk", "/flows/desk/"]],
  },
  {
    id: "wires", title: "Wires", detail: "Follow standing alerts and their history.",
    links: [["Fire", "/flows/fire/", "hasFire"], ["Wires", "/flows/wires/", "hasWires"], ["Inbox", "/flows/inbox/", "hasInbox"], ["Digest", "/flows/digest/", "hasInbox"]],
  },
  {
    id: "neuron", title: "Neuron", detail: "Read the market summary alongside the underlying activity.",
    links: [["Market reading", "/flows/#hmVerdict"]],
  },
  {
    id: "status", title: "Status", detail: "Check feed coverage, freshness, capacity and latency.",
    links: [["Operations", "/flows/status/", "owner"]],
  },
];

const linkMarkup = ([label, href]) => `
        <li><a href="${href.replaceAll("&", "&amp;")}">${label}<span aria-hidden="true">›</span></a></li>`;

function groupMarkup({ id, title, detail, links }) {
  return `
    <li class="fv2-destination">
      <h2 id="fv2-destination-${id}">${title}</h2>
      <p>${detail}</p>
      <ul class="fv2-destination-links" aria-labelledby="fv2-destination-${id}">${links.map(linkMarkup).join("")}
      </ul>
    </li>`;
}

export function flowsV2AtlasBody(access = {}) {
  const available = GROUPS.map((group) => ({
    ...group,
    links: group.links.filter(([, , permission]) => !permission || access[permission] === true),
  })).filter(({ links }) => links.length);

  return `
<section class="fv2-atlas" aria-labelledby="fv2-atlas-title">
  <header class="fv2-atlas-head" data-fx-hero>
    <h1 id="fv2-atlas-title" data-fx-title>All pages</h1>
  </header>
  <nav aria-label="Flows destinations">
    <ul class="fv2-destinations">${available.map(groupMarkup).join("")}
    </ul>
  </nav>
</section>`;
}

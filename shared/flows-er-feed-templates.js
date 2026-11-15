import { templateById } from "./ff-contract.js";

export const FEED_TEMPLATES = Object.freeze([
  { id: "F01", title: "Trading halt on a name", type: "trading_state", target: "trading_state", fields: ["state", "reason"], closest: null, view: "halts", differs: "Flows has no halt quantity a wire can test; the Halts view shows them." },
  { id: "F02", title: "Earnings report", type: "earnings", target: null, fields: [], closest: "T07", view: null, differs: "The feed alerts on the report itself; T07 tests the implied move against past report moves." },
  { id: "F03", title: "Economic release", type: "economic_release", target: null, fields: [], closest: null, view: "macro", differs: "Flows lists releases on the Macro view; no wire tests them." },
  { id: "F04", title: "FDA date", type: "fda", target: null, fields: [], closest: null, view: "fda", differs: "Flows lists dates on the FDA view; no wire tests them." },
  { id: "F05", title: "Large flagged window", type: "flow_alerts", target: "flow_alert", fields: ["total_premium", "volume_oi_ratio", "dte"], closest: "T03", view: null, differs: "T03 also asks for out of the money by 10 per cent and 21 days or less." },
  { id: "F06", title: "Open-interest change before the open", type: "chain_oi_change", target: "option_contract", fields: ["oi_change"], closest: "T02", view: null, differs: "T02 confirms the opening on the next night's open interest." },
].map((t) => Object.freeze({ ...t, fields: Object.freeze([...t.fields]) })));

export const FEED_STATES = Object.freeze(["ready", "plan", "unlisted", "unread", "unstated"]);

export function feedTemplateRows(feed) {
  const read = feed && typeof feed === "object" && Array.isArray(feed.types);
  const types = read ? feed.types : [];
  const targets = read && feed.grammar && Array.isArray(feed.grammar.targets) ? feed.grammar.targets : [];
  return FEED_TEMPLATES.map((t) => {
    const entry = types.find((x) => x && x.id === t.type) || null;
    let state = "unread";
    if (read) state = !entry ? "unlisted" : entry.can === true ? "ready" : entry.can === false ? "plan" : "unstated";
    let fields = [];
    let fieldsWhy = null;
    if (t.fields.length) {
      const tg = targets.find((x) => x && x.id === t.target);
      const have = tg && Array.isArray(tg.fields) ? new Set(tg.fields.map((f) => (Array.isArray(f) ? f[0] : f))) : null;
      if (have && t.fields.every((f) => have.has(f))) fields = t.fields.slice();
      else { fields = null; fieldsWhy = "not in the feed's grammar"; }
    }
    const closest = t.closest && (templateById(t.closest) || {}).ast ? t.closest : null;
    return {
      id: t.id, title: t.title, type: t.type, state,
      perDay: entry && Number.isSafeInteger(entry.perDay) ? entry.perDay : null,
      fields, fieldsWhy, closest, view: t.view, differs: t.differs,
    };
  });
}

import { unwrap } from "./flows-vendor-core.js";
import { fixtureNameIn } from "./flows-fixture-names.js";
import { sanitizeText } from "./flows-dossier.js";
import { num, int, dateOf } from "./flows-macro.js";

export const PM_CAP_DEFAULT = 150;
export const PM_CAP_MAX = 400;
export const PM_NAMES_CAP = 30;
export const PM_REFRESH_S = 30 * 86400;
export const PM_MAX_S = 60 * 86400;
export const PM_PLAN_SLEEP_SESSIONS = 7;
export const PM_TOP_KEEP = 40;
export const PM_COMPANY_FRESH_S = 60 * 86400;
export const PM_DETAIL_FRESH_S = 14 * 86400;
export const PM_CAP_BYTES = 64 * 1024;
export const PM_SECTION_BYTES = 1536;
export const PM_VERSION = 1;

const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings|group|class [a-z])\b\.?/g;

export function normalizeName(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/&/g, " and ");
  for (let i = 0; i < 3; i++) s = s.replace(SUFFIX, " ");
  s = s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

export function queryOf(cardX) {
  const parts = cardX && cardX.dx && cardX.dx.parts ? cardX.dx.parts : {};
  const info = parts.info && parts.info.x && typeof parts.info.x.name === "string" ? parts.info.x.name : null;
  const prof = parts.profile && parts.profile.x && typeof parts.profile.x.name === "string" ? parts.profile.x.name : null;
  const norm = normalizeName(info || prof || "");
  if (norm.length < 4) return { query: null, why: "short" };
  return { query: norm };
}

export function pmCap(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return PM_CAP_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return PM_CAP_DEFAULT;
  return Math.min(Math.floor(n), PM_CAP_MAX);
}

export function statusFiling(http) {
  if (http === 429) return "limited";
  if ([401, 402, 403, 404, 422].includes(http)) return "plan";
  return "failed";
}

const clean = (v, cap) => {
  const s = sanitizeText(v, { cap });
  return s && typeof s.text === "string" && s.text ? s.text : null;
};

export function investorMatch(searchRaw, query) {
  const body = unwrap(searchRaw);
  const list = body && Array.isArray(body.investors) ? body.investors : [];
  const hits = list.filter((i) => i && normalizeName(i.name) === query);
  const names = new Set(hits.map((h) => normalizeName(h.name) + "|" + String(h.name)));
  if (!hits.length) return { match: null, why: "none" };
  if (names.size > 1) return { match: null, why: "ambiguous" };
  return { match: { name: clean(hits[0].name, 80), companyCount: int(hits[0].company_count) }, why: null };
}

export function companiesOf(investorRaw) {
  const body = unwrap(investorRaw);
  const list = body && Array.isArray(body.companies) ? body.companies : [];
  return list.map((c) => [typeof c.npm_ticker === "string" ? c.npm_ticker : null, clean(c.name, 60), clean(c.sector, 40)]).filter((c) => c[0] && c[1]).slice(0, 8);
}

export function pmCardSection({ at, session, match, companies, why }) {
  const sec = { at, rv: PM_VERSION, session };
  if (match) sec.match = { name: match.name, companyCount: match.companyCount, companies: companies || [] };
  else { sec.match = null; sec.why = why || "none"; }
  return sec;
}

export function pmSectionState(section, now) {
  if (!section || typeof section !== "object" || typeof section.at !== "number" || section.rv !== PM_VERSION) return "missing";
  const age = (now - section.at) / 1000;
  if (age <= PM_REFRESH_S) return "fresh";
  if (age <= PM_MAX_S) return "stale";
  return "expired";
}

export function companyList(raw) {
  const body = unwrap(raw);
  const list = Array.isArray(body) ? body : [];
  return list.map((c) => ({
    npm: c && typeof c.npm_ticker === "string" ? c.npm_ticker : null,
    name: c ? clean(c.name, 60) : null,
    sector: c ? clean(c.sector, 40) : null,
    sub: c && Array.isArray(c.sub_sectors) ? c.sub_sectors.map((s) => clean(s, 40)).filter(Boolean).slice(0, 3) : [],
  })).filter((c) => c.npm && c.name);
}

export function reduceCompany(raw) {
  const d = unwrap(raw);
  if (!d || typeof d !== "object") return { ok: false, why: "shape" };
  const lp = d.latest_price && typeof d.latest_price === "object" ? d.latest_price : null;
  return {
    ok: true,
    totalFunding: num(d.total_funding),
    investorCount: int(d.investor_count),
    price: lp ? num(lp.price) : null,
    priceDate: lp ? dateOf(lp.date) : null,
  };
}

export function reduceFunding(raw) {
  const d = unwrap(raw);
  const rows = (Array.isArray(d) ? d : []).map((r) => ({ date: dateOf(r && r.investment_date), round: r ? clean(r.financing_round, 40) : null, amount: r ? num(r.investment_amount) : null })).filter((r) => r.date);
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows.length ? [rows[0].date, rows[0].round, rows[0].amount] : null;
}

export function reducePricing(raw) {
  const d = unwrap(raw);
  const pts = (Array.isArray(d) ? d : []).map((r) => [dateOf(r && r.date), num(r && r.price)]).filter((r) => r[0] && r[1] !== null).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!pts.length) return { price: null, priceDate: null, chg1y: null, gap: true };
  const last = pts[pts.length - 1];
  const target = Date.parse(last[0] + "T00:00:00Z") - 365 * 864e5;
  let best = null;
  for (const p of pts) {
    const dist = Math.abs(Date.parse(p[0] + "T00:00:00Z") - target);
    if (best === null || dist < best.dist) best = { dist, p };
  }
  const ok = best && best.dist <= 30 * 864e5 && best.p[1] !== 0 && best.p !== last;
  return { price: last[1], priceDate: last[0], chg1y: ok ? last[1] / best.p[1] - 1 : null, ...(ok ? {} : { gap: true }) };
}

export function leadersOf(raw) {
  const d = unwrap(raw);
  return (Array.isArray(d) ? d : []).filter((r) => r && typeof r.title === "string" && r.title.trim()).length;
}

export function topEntry(company, detail) {
  const c = detail.company || { ok: false };
  return [
    company.npm, company.name,
    c.ok ? c.totalFunding : null, c.ok ? c.investorCount : null,
    detail.pricing ? detail.pricing.price : c.ok ? c.price : null,
    detail.pricing ? detail.pricing.priceDate : c.ok ? c.priceDate : null,
    detail.pricing ? detail.pricing.chg1y : null,
    detail.lastRound || null,
    detail.leaders === undefined ? null : detail.leaders,
    company.sub,
  ];
}

export function sectorOrder(sectors) {
  return [...new Set((Array.isArray(sectors) ? sectors : []).filter((s) => typeof s === "string" && s))].sort();
}

export function nextSector(order, prev) {
  if (!order.length) return null;
  const done = prev && prev.sectors ? prev.sectors : {};
  let oldest = null;
  for (const s of order) {
    const e = done[s];
    if (!e || !e.complete) return s;
    if (oldest === null || e.complete < done[oldest].complete) oldest = s;
  }
  return oldest;
}

export function sectorEntry({ status, listed, cursor, profiled, complete, top }) {
  const sorted = (top || []).slice().sort((a, b) => (b[2] === null ? -1 : a[2] === null ? 1 : b[2] - a[2])).slice(0, PM_TOP_KEEP);
  return { status, listed, cursor, profiled, complete: complete || null, top: sorted };
}

export function buildPm({ session, generatedAt, sectors, investors, calls, plan }, { test = false } = {}) {
  const payload = {
    v: PM_VERSION, session, generatedAt, ...(test ? { fixture: true } : {}),
    sectors: sectors || {},
    investors: investors || { asOf: null, n: 0, top: [] },
    basis: { calls: calls || 0, plan: !!plan },
  };
  const bad = fixtureNameIn(JSON.stringify(payload));
  if (bad && !test) throw new Error("fixture name " + bad);
  return payload;
}

export function investorsTop(raw, asOf) {
  const d = unwrap(raw);
  const rows = (Array.isArray(d) ? d : []).map((r) => [clean(r && r.name, 60), int(r && r.company_count)]).filter((r) => r[0] && r[1] !== null).sort((a, b) => b[1] - a[1]).slice(0, 300);
  return { asOf, n: rows.length, top: rows };
}

export function fitPm(payload, cap = PM_CAP_BYTES) {
  const p = JSON.parse(JSON.stringify(payload));
  const size = () => new TextEncoder().encode(JSON.stringify(p)).length;
  const shed = [];
  while (size() > cap && p.investors.top.length > 50) { p.investors.top = p.investors.top.slice(0, Math.floor(p.investors.top.length / 2)); shed.push("investors"); }
  for (const keep of [20, 10]) {
    if (size() <= cap) break;
    for (const s of Object.values(p.sectors)) s.top = s.top.slice(0, keep);
    shed.push("top" + keep);
  }
  return { payload: p, shed, bytes: size(), fits: size() <= cap };
}

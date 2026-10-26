export const SECTOR_NAMES = Object.freeze([
  "Technology", "Tech", "Healthcare", "Health care", "Financial Services", "Financials", "Consumer Cyclical", "Cyclicals",
  "Consumer Defensive", "Defensives", "Staples", "Industrials", "Energy", "Basic Materials", "Materials", "Real Estate", "Utilities",
  "Communication Services", "Comms", "Index & ETF", "No sector",
]);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

const SECTOR = `(?<![\\w-])(?:${[...SECTOR_NAMES].sort((a, b) => b.length - a.length).map(esc).join("|")})(?![\\w-])`;
const MONEY = "(?:\\b(?:money|premiums?|cash|flows?|capital|dollars)\\b|\\$\\s?\\d[\\d.,]*[KMBkmb]?)";
const MOVE = "(?:mov(?:e|es|ed|ing)|rotat(?:e|es|ed|ing)|left|leav(?:e|es|ing)|exit(?:s|ed|ing)?|shift(?:s|ed|ing)?|flow(?:s|ed|ing)?|pour(?:s|ed|ing)?|migrat(?:e|es|ed|ing)|switch(?:es|ed|ing)?|fled|flee(?:s|ing)?|went|headed)";
const DIR = "(?:from|into|onto|to|out\\s+of|away\\s+from|towards?|in\\s+to)";
const EXIT = "(?:left|leaves|leaving|exit(?:s|ed|ing)?|fled|abandon(?:s|ed|ing)?|enter(?:s|ed|ing)?)";
const GAP = "(?:\\s+[\\w$.,%'-]+){0,3}?";

const RX = {
  moveTo: new RegExp(`\\b${MOVE}\\b${GAP}\\s+${DIR}\\s+(?:the\\s+)?${SECTOR}`, "i"),
  exit: new RegExp(`\\b${EXIT}\\s+(?:the\\s+)?${SECTOR}`, "i"),
  fronted: new RegExp(`\\b${DIR}\\s+(?:the\\s+)?${SECTOR}[^.;]{0,40}?\\b${MOVE}\\b`, "i"),
  moneyDir: new RegExp(`${MONEY}(?:\\s+[\\w$.,%'-]+){0,2}?\\s+(?:from|into|out\\s+of|away\\s+from)\\s+(?:the\\s+)?${SECTOR}`, "i"),
  inOut: new RegExp(`${SECTOR}[^;]*\\b(?:in|out)-?flows?\\b|\\b(?:in|out)-?flows?\\b[^;]*${SECTOR}`, "i"),
  flowish: new RegExp(`${MONEY}|\\b(?:in|out)-?flows?\\b|\\b(?:funds?|investors?|traders?|buyers?|sellers?|initiators?|providers?)\\b`, "i"),
  leave: /\b(?:left|leaves|leaving)\b/i,
  spatial: /\b(?:on|to|at|from|in)\s+the\s+(?:far\s+)?left\b|\b(?:top|bottom|upper|lower|far)[\s-]+left\b|\bleft[\s-]+(?:hand|columns?|side|axis|edge|panel|pane|rail|margin|cells?|arrow|aligned|align|click|of)\b/gi,
  tape: /\btapes?\b/i,
  headerCase: /\b[A-Z]\w*(?:-[A-Z]\w*)+\b/g,
  unsided: /\bun[\s‐‑–-]?sided\b/i,
  modal: /\b(?:will|would|should|shall|expects?|expected|expecting|expectations?|likely|unlikely|could|might|predicts?|predicted|predicting|predictions?|forecasts?|forecasted|forecasting|signals?\s+that|suggests?\s+that)\b|(?<!\d\s)\bmay\b(?!\s+\d)/i,
  negForecast: /\b(?:no|not\s+an?|never\s+an?)\s+(?:forecasts?|predictions?)\b/gi,
  tickers: /\b[A-Z][A-Z0-9.]{1,5}\b/g,
};

const first = (re, s) => {
  const m = re.exec(s);
  return m ? m[0] : null;
};

const strip = (s) => s.replace(/`[^`]*`/g, " ").replace(/\S*[/\\_]\S*/g, " ").replace(/\b[\w-]+\.(?:m?js|json|css|html?|ts)\b/g, " ");

export const tape = (s) => first(RX.tape, strip(s).replace(RX.headerCase, " "));

export const unsided = (s) => first(RX.unsided, strip(s));

export const sectorTransfer = (s) => {
  const t = strip(s);
  const io = first(RX.inOut, t);
  if (io) return io;
  if (!RX.flowish.test(t)) return null;
  return first(RX.moveTo, t) ?? first(RX.exit, t) ?? first(RX.fronted, t) ?? first(RX.moneyDir, t);
};

export const flowLeaving = (s) => {
  const t = strip(s).replace(RX.spatial, " ");
  return RX.flowish.test(t) ? first(RX.leave, t) : null;
};

export const tooLong = (s, max = 14) => {
  const n = s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return n > max ? `${n} words` : null;
};

export const modal = (s) => first(RX.modal, strip(s).replace(RX.tickers, " ").replace(RX.negForecast, " "));

export const RULES = Object.freeze({ tape, unsided, sectorTransfer, flowLeaving, tooLong, modal });

export const lintSentence = (s, rules = RULES) => Object.entries(rules).flatMap(([rule, f]) => {
  const match = f(s);
  return match ? [{ rule, match }] : [];
});

export const splitSentences = (text) => String(text).split(/\n+|(?<=[.!?])\s+(?=["'([]?[A-Z$\d—])/).map((s) => s.trim()).filter(Boolean);

export const lintText = (text, rules = RULES) => splitSentences(text).flatMap((sentence) => lintSentence(sentence, rules).map((hit) => ({ sentence, ...hit })));

const ATTRS = /\s(?:title|alt|aria-label|aria-description|placeholder)\s*=\s*"([^"]*)"/gi;

export const htmlToText = (html) => {
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|code|pre|kbd|samp|template|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const attrs = [...clean.matchAll(ATTRS)].map((m) => m[1]);
  const body = clean
    .replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|li|h[1-6]|td|th|dt|dd|div|section|article|caption|figcaption|label|button|option|summary|tr|title|legend)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return [body, ...attrs].join("\n")
    .replace(/&nbsp;/g, " ").replace(/&mdash;/g, "—").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
};

export const stringLeaves = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) stringLeaves(v, out);
  return out;
};

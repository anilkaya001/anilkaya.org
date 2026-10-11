import { STATE_LINES, STATE_WORD, structuresForState } from "./flows-neuron.js";
import { BUCKET_LINES } from "./flows-quant-structures.js";
import { sessionsBetween } from "./flows-cross.js";

export const SCREEN_VERSION = 1;
export const SCREEN_WHY = "no chain read for this name";
export const SCREEN_LIMITS = "No option chain was read for this name, so no strike, expiry, price, chance of profit or payoff estimate is shown.";
export const SCREEN_SOFT = "a soft tilt, not a signal for one name";

export const SCREEN_LINES = Object.freeze({
  TRADING_DAYS: 252,
  GAMMA_MATERIAL_ADV: 0.01,
  EVENT_WINDOW_SESSIONS: 21,
  TILT_DECISIVE: STATE_LINES.AGGRESSOR_SHARE,
  VRP_RELATIVE: STATE_LINES.VRP_RELATIVE,
  IVP_HIGH: BUCKET_LINES.IV_HIGH * 100,
  IVP_LOW: BUCKET_LINES.IV_LOW * 100,
  TERM_BACK: BUCKET_LINES.TERM_BACK,
  TERM_CONTANGO: BUCKET_LINES.TERM_CONTANGO,
  EXPIRED_SESSIONS: 2,
});

const IVP_LABEL = "Vendor 1-year IV percentile (tenor not documented)";

export const SCREEN_INPUTS = Object.freeze([
  ["gexAdv", "Dealer book gamma"], ["iv30", "30-day implied volatility"], ["dex", "Dealer delta"], ["vanna", "Dealer vanna"],
  ["charm", "Dealer charm"], ["vrp", "Implied against realised volatility"], ["ivp", IVP_LABEL],
  ["ts", "Term slope"], ["im5", "Priced move, 5 days"], ["im30", "Priced move, 30 days"], ["ed", "Next earnings report"],
  ["tilt", "Option flow tilt"], ["dDelta", "Directional delta flow"], ["si", "Short interest"],
]);

const MINUS = "−";
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const has = (u, k) => Object.prototype.hasOwnProperty.call(u, k);

function signed(v, d) {
  const s = Math.abs(v).toFixed(d);
  return (Number(s) === 0 ? "" : v < 0 ? MINUS : "+") + s;
}

function plain(v, d) {
  const s = Math.abs(v).toFixed(d);
  return (Number(s) !== 0 && v < 0 ? MINUS : "") + s;
}

function list(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " or " + items[items.length - 1];
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;

function ordinal(n) {
  const k = Math.round(n);
  const tail = k % 100;
  return k + (tail >= 11 && tail <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10 < 4 ? k % 10 : 0]);
}

export function screenReading(input) {
  const src = input && typeof input === "object" ? input : {};
  const u = src.u && typeof src.u === "object" ? src.u : {};
  const pct = src.pct && typeof src.pct === "object" ? src.pct : {};
  const ticker = typeof src.ticker === "string" && src.ticker ? src.ticker : "this name";
  const L = SCREEN_LINES;
  const sessionDate = typeof src.sessionDate === "string" ? src.sessionDate : null;
  const expected = typeof src.expectedSession === "string" ? src.expectedSession : null;
  const behind = num(src.behind) !== null ? src.behind
    : sessionDate && expected && sessionDate < expected ? sessionsBetween(sessionDate, expected) : 0;
  const v = (k) => num(u[k]);

  const facts = [];
  const withheld = [];
  const conflicts = [];
  const notes = [];
  const withhold = (key, label, reason) => { withheld.push({ key, label, reason }); };
  const absent = (k) => (has(u, k) ? "the vendor's screener row carried no value for it" : "the column is not in tonight's universe payload");
  const push = (f) => { facts.push({ ...f, display: f.text + " " + f.unit }); };

  const g = v("gexAdv"), iv30 = v("iv30");
  const sigma = iv30 !== null && iv30 > 0 ? iv30 / Math.sqrt(L.TRADING_DAYS) : null;
  const move = sigma === null ? null : sigma * 100;
  const hedge = g !== null && move !== null ? Math.abs(g) * move : null;
  let gamma = null;
  if (g === null) withhold("gexAdv", "Dealer book gamma", absent("gexAdv"));
  else if (hedge === null) withhold("gexAdv", "Dealer book gamma", "there is no implied volatility to size a typical day's hedging against");
  else gamma = hedge < L.GAMMA_MATERIAL_ADV ? "flat" : g > 0 ? "long" : "short";
  if (g !== null && hedge !== null) {
    push({
      key: "gamma", group: "positioning", label: "Dealer book gamma", value: r4(g * 100),
      text: signed(g * 100, 2) + "%", unit: "of average daily dollar volume for each 1% move in the stock", grade: 1,
      note: "The vendor's open-interest gamma in dollars per 1% move, on its convention that dealers hold every call long and every put short. That is a convention and not an observed position." +
        (num(pct.gexAdv) !== null ? " The " + ordinal(pct.gexAdv) + " percentile of the screened names, where the 100th is the most long gamma." : ""),
    });
    push({
      key: "hedge", group: "positioning", label: "Hedging for a typical day", value: r4(hedge * 100),
      text: plain(hedge * 100, 1) + "%", unit: "of average daily dollar volume for one implied daily move of " + plain(move, 1) + "%", grade: 1,
      note: gamma === "flat"
        ? "Under " + Math.round(L.GAMMA_MATERIAL_ADV * 100) + "% of a day's dollar volume, so the sign of the gamma is not read as a state."
        : "Dealer hedging for one implied daily move at " + plain(move, 1) + "%, the size that decides whether the gamma sign is worth reading; the line is " +
          Math.round(L.GAMMA_MATERIAL_ADV * 100) + "% of a day's dollar volume.",
    });
  }

  const dex = v("dex");
  if (dex === null) withhold("dex", "Dealer delta", absent("dex"));
  else {
    push({
      key: "dex", group: "positioning", label: "Dealer delta", value: r4(dex),
      text: signed(dex, 2), unit: "times average daily dollar volume, as the vendor's dollars per 1% move", grade: 1,
      note: "The vendor documents no sign convention for this field. On the gamma convention it is positive by construction and measures the size of the hedge book, not which way dealers lean, so no direction is read from it.",
    });
  }

  const vanna = v("vanna");
  if (vanna === null) withhold("vanna", "Dealer vanna", absent("vanna"));
  else {
    push({
      key: "vanna", group: "positioning", label: "Dealer vanna", value: r4(vanna * 100),
      text: signed(vanna * 100, 2) + "%", unit: "of average daily dollar volume, as the vendor's dollars per 1% move", grade: 1,
      note: "The vendor documents no sign convention for the put leg of this field, so which way it moves dealer hedges when implied volatility changes is not read. Shown as the vendor's number and not used.",
    });
  }

  const charm = v("charm");
  if (charm === null) withhold("charm", "Dealer charm", absent("charm"));
  else {
    push({
      key: "charm", group: "positioning", label: "Dealer charm", value: charm === 0 ? "zero" : charm > 0 ? "positive" : "negative",
      text: charm === 0 ? "zero" : charm > 0 ? "positive" : "negative", unit: "in the vendor's sign, size not shown", grade: 0,
      note: "The vendor documents no unit for this field, and on its own sample row it is larger than the delta it acts on, so it is not a per-day change. Only its sign is shown, for the record, and nothing is read from it.",
    });
  }

  const ed = v("ed");
  const eventInside = ed !== null && ed >= 0 && ed <= L.EVENT_WINDOW_SESSIONS;
  if (ed === null) withhold("ed", "Next earnings report", absent("ed"));
  else {
    push({
      key: "event", group: "event", label: "Next earnings report", value: ed,
      text: String(ed), unit: ed === 1 ? "session away" : "sessions away", grade: 1,
      note: eventInside
        ? "Inside the " + L.EVENT_WINDOW_SESSIONS + " sessions that a 30-day implied volatility spans, so the report is priced into it."
        : "Beyond the " + L.EVENT_WINDOW_SESSIONS + " sessions that a 30-day implied volatility spans.",
    });
  }

  const vrp = v("vrp");
  const rv = vrp !== null && iv30 !== null ? (v("rv20") !== null ? v("rv20") : iv30 - vrp) : null;
  let premium = null;
  if (vrp === null || iv30 === null || !(rv > 0)) withhold("vrp", "Implied against realised volatility", vrp === null ? absent("vrp") : "there is no positive realised volatility to compare it with");
  else {
    const rel = vrp / rv;
    const reading = eventInside ? null : rel >= L.VRP_RELATIVE ? "rich" : rel <= -L.VRP_RELATIVE ? "cheap" : "fair";
    premium = reading;
    push({
      key: "premium", group: "premium", label: "Implied against realised volatility", value: r4(rel * 100),
      text: signed(rel * 100, 0) + "%", unit: "of realised volatility (implied " + plain(iv30 * 100, 1) + "% against realised " + plain(rv * 100, 1) + "%)",
      grade: eventInside ? 0 : 1,
      note: eventInside
        ? "An earnings report " + ed + " sessions away sits inside the 30-day implied volatility and not inside the realised volatility behind it, so the gap is shown and not read as rich or cheap."
        : "The line is ±" + Math.round(L.VRP_RELATIVE * 100) + "% of realised, the card's own. It is " + SCREEN_SOFT + ", because 21 sessions of realised volatility are noisier than that band.",
    });
  }

  const ivp = v("ivp");
  if (ivp === null) withhold("ivp", IVP_LABEL, absent("ivp"));
  else {
    push({
      key: "ivp", group: "premium", label: IVP_LABEL, value: r4(ivp),
      text: ordinal(ivp), unit: "percentile, as the vendor reports it, over a window the field name gives as one year, on an implied-volatility tenor no document held for it states", grade: 1,
      note: "The vendor's own percentile, a percentile and not the range-based IV rank. The field name says one year; no document held for it says which expiry's implied volatility it ranks, so it is not read as the 30-day figure.",
    });
  }
  const ts = v("ts");
  if (ts === null) withhold("ts", "Term slope", absent("ts"));
  else {
    const word = ts > L.TERM_BACK ? "the front is bid" : ts < L.TERM_CONTANGO ? "the back is bid" : "the curve is flat";
    push({
      key: "term", group: "premium", label: "Term slope", value: r4(ts * 100),
      text: signed(ts * 100, 1) + "%", unit: "(30-day implied volatility over 90-day, minus 1)", grade: 1,
      note: "Between " + MINUS + Math.round(-L.TERM_CONTANGO * 100) + "% and +" + Math.round(L.TERM_BACK * 100) + "% the curve reads flat; here " + word + ".",
    });
  }
  const im5 = v("im5"), im30 = v("im30");
  if (im5 === null) withhold("im5", "Priced move, 5 days", absent("im5"));
  else {
    push({
      key: "move5", group: "premium", label: "Priced move, 5 days", value: r4(im5 * 100),
      text: "±" + plain(im5 * 100, 1) + "%", unit: "of price over 5 days, as the options market prices it", grade: 1,
      note: "The vendor's implied move for the horizon as a fraction of price; a price and not a measure of what the stock does.",
    });
  }
  if (im30 === null) withhold("im30", "Priced move, 30 days", absent("im30"));
  else {
    push({
      key: "move30", group: "premium", label: "Priced move, 30 days", value: r4(im30 * 100),
      text: "±" + plain(im30 * 100, 1) + "%", unit: "of price over 30 days, as the options market prices it", grade: 1,
      note: "The vendor's implied move for the horizon as a fraction of price; a price and not a measure of what the stock does.",
    });
  }

  const tilt = v("tilt"), dDelta = v("dDelta");
  if (tilt === null) withhold("tilt", "Option flow tilt", absent("tilt"));
  else {
    push({
      key: "tilt", group: "flow", label: "Option flow tilt", value: r4(tilt * 100),
      text: signed(tilt * 100, 0) + "%", unit: "of gross option premium (net call premium minus net put premium)", grade: 1,
      note: "The session's tape at the screener's read, not a standing position. The line for a tilt is ±" + Math.round(L.TILT_DECISIVE * 100) + "%, the share of gross that the card's aggressor ladder also uses.",
    });
  }
  if (dDelta === null) withhold("dDelta", "Directional delta flow", absent("dDelta"));
  else {
    push({
      key: "delta", group: "flow", label: "Directional delta flow", value: r4(dDelta * 100),
      text: signed(dDelta * 100, 2) + "%", unit: "of average daily share volume (delta bought at the ask less sold at the bid)", grade: 1,
      note: "The session's directionalized delta in shares, signed so that buying calls or selling puts is positive. Today's tape and not a standing position.",
    });
  }
  const si = v("si");
  if (si === null) withhold("si", "Short interest", absent("si"));
  else {
    push({
      key: "short", group: "context", label: "Short interest", value: r4(si * 100),
      text: plain(si * 100, 1) + "%", unit: "of float, the vendor's short_int" + (num(pct.si) !== null ? " (the " + ordinal(pct.si) + " percentile of the screened names)" : ""), grade: 1,
      note: "Reported twice a month; context and never a vote.",
    });
  }

  let lean = null;
  const tiltDecisive = tilt !== null && Math.abs(tilt) >= L.TILT_DECISIVE;
  if (tiltDecisive) {
    const side = Math.sign(tilt);
    if (dDelta === null || dDelta === 0 || Math.sign(dDelta) === side) lean = side > 0 ? "bullish" : "bearish";
    else notes.push("the option premium tilt and the directional delta flow point opposite ways, so the flow casts no vote");
  }

  let state = "undetermined";
  if (gamma === "long") state = "pinned";
  else if (gamma === "short") state = "amplifying";
  else if (premium === "rich") state = "premium-rich";
  else if (premium === "cheap") state = "premium-cheap";
  if (state === "undetermined") {
    notes.push(gamma === "flat"
      ? "the book's gamma is too small for its sign to be read"
      : "the book's gamma is not in the screener row");
    notes.push(premium === null ? "the premium axis is not readable" : "the premium is fair");
  }

  if (premium === "rich" && ivp !== null && ivp <= L.IVP_LOW) {
    conflicts.push("options read rich to realised volatility while sitting at the " + ordinal(ivp) + " percentile of their own past year");
  }
  if (premium === "cheap" && ivp !== null && ivp >= L.IVP_HIGH) {
    conflicts.push("options read cheap to realised volatility while sitting at the " + ordinal(ivp) + " percentile of their own past year");
  }

  const direction = state === "amplifying" ? lean : null;
  const table = structuresForState(state, direction, premium || "fair");
  const preferred = table.preferred.filter((x) => x !== "no position");
  const avoid = table.avoid.slice();

  const gammaTxt = gamma === "long" ? "dealers long gamma" : gamma === "short" ? "dealers short gamma" : null;
  const premiumTxt = premium === "rich" ? "options rich" : premium === "cheap" ? "options cheap" : premium === "fair" ? "options fairly priced" : null;
  const flowTxt = state === "amplifying" ? (lean ? "flow leaning " + lean : "flow undecided") : null;
  const setting = [gammaTxt, premiumTxt, flowTxt].filter(Boolean).join(", ");

  let noIdeaReason = null;
  let noIdeaCode = null;
  if (behind >= L.EXPIRED_SESSIONS) {
    noIdeaCode = "expired.sessions";
    noIdeaReason = "The screener row describes " + sessionDate + ", " + behind + " sessions before the last close" + (expected ? " (" + expected + ")" : "") + ", so no idea is offered from it.";
  } else if (state === "undetermined") {
    noIdeaCode = facts.length ? "state.undetermined" : "screen.no-inputs";
    noIdeaReason = "Nothing in the screener row implies a state: " + notes.join(", and ") + ".";
  } else if (eventInside) {
    noIdeaCode = "event.window";
    noIdeaReason = "An earnings report " + ed + " sessions away sits inside the " + L.EVENT_WINDOW_SESSIONS + " sessions any structure spans and inside the implied volatility itself, and a screener row cannot say how it is priced, so no structure family is named.";
  } else if (conflicts.length) {
    noIdeaCode = "premium.conflict";
    noIdeaReason = "The readings disagree: " + conflicts.join("; ") + ". No position is the reading until they agree.";
  } else if (!preferred.length) {
    noIdeaCode = "table.no-side";
    noIdeaReason = "With " + setting + ", none of the structure families this screen knows rests on a side, so no position is the reading.";
  }
  const offered = noIdeaReason === null;
  const families = offered ? preferred : [];
  const confidence = state === "undetermined" || !offered ? 0 : 1;

  const expiredHead = behind >= L.EXPIRED_SESSIONS;
  const stale = behind === 1;
  if (stale) notes.push("the row describes " + sessionDate + " and " + expected + " has closed since, so it is a session old");
  const first = expiredHead
    ? "Expired screener read: the row is " + behind + " sessions old."
    : setting ? "Screener read: " + setting + "." : "Screener read: no state can be read for " + ticker + ".";
  const second = offered
    ? "Structure families it leans toward: " + list(families) + ". Away from: " + (avoid.length ? list(avoid) : "none in particular") + ". That is " + SCREEN_SOFT + "."
    : "No position. " + noIdeaReason;
  const summary = [first, second, SCREEN_LIMITS].join(" ");

  const idea = offered
    ? { kind: "family", structure: families[0], structures: families.slice(), avoid,
        direction: state === "amplifying" && lean ? lean : "neutral",
        text: "Leans toward " + list(families) + ": " + SCREEN_SOFT + ". " + SCREEN_LIMITS }
    : { kind: "none", structure: "no position", structures: [], avoid: [], direction: "neutral", text: noIdeaReason };

  const status = facts.length ? "ok" : "unavailable";
  if (!facts.length) {
    notes.push("the screener row carries none of the inputs this reading is built on");
  }

  return {
    version: SCREEN_VERSION, tier: expiredHead ? "expired" : "screen", status, ticker, sector: typeof src.sector === "string" ? src.sector : null,
    sessionDate, behind, stale,
    state, stateWord: STATE_WORD[state], confidence, gamma, premium, lean,
    facts, withheld, conflicts, notes,
    families, avoid: offered ? avoid : [], idea, noIdeaReason, noIdeaCode,
    summary, priced: false, why: SCREEN_WHY, limits: SCREEN_LIMITS,
  };
}

export function screenTexts(reading) {
  const r = reading && typeof reading === "object" ? reading : {};
  const out = [];
  const add = (t) => { if (typeof t === "string" && t) out.push(t); };
  add(r.summary); add(r.noIdeaReason); add(r.why);
  if (r.idea) add(r.idea.text);
  for (const f of r.facts || []) { add(f.label); add(f.display); add(f.note); }
  for (const w of r.withheld || []) { add(w.label); add(w.reason); }
  for (const c of r.conflicts || []) add(c);
  for (const n of r.notes || []) add(n);
  return out;
}

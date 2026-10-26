export const MODEL_IMPLIED = "Model-implied, not a quote and not advice. Based on the engine's fitted prices and its own probabilities, under the stated assumptions. No track record yet.";

export const CONVICTION_WORDS = Object.freeze(["No view", "Faint", "Leaning", "Clear"]);

export const LEANS = Object.freeze(["up", "down", "mixed", "none"]);

export const STANCE_LINES = Object.freeze({
  up: Object.freeze([
    "No view on direction for this name.",
    "A faint upward lean in the engine's readings.",
    "The engine's readings lean up.",
    "The engine's readings clearly lean up.",
  ]),
  down: Object.freeze([
    "No view on direction for this name.",
    "A faint downward lean in the engine's readings.",
    "The engine's readings lean down.",
    "The engine's readings clearly lean down.",
  ]),
  mixed: Object.freeze([
    "The readings disagree, so there is no view.",
    "The readings disagree; the engine sees only a faint lean.",
    "Two readings disagree, so the view stays modest.",
    "Two readings disagree, so the view stays modest.",
  ]),
  none: Object.freeze([
    "No view on direction for this name.",
    "No view on direction for this name.",
    "No view on direction for this name.",
    "No view on direction for this name.",
  ]),
});

const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

const MINUS = "−";
const DASH = "—";

const SIGN_PREFIX = Object.freeze({ "-1": MINUS, "0": "", "1": "" });

const SIDE_WORD = Object.freeze({ C: "call", P: "put" });

const VERDICT_DIR = Object.freeze({ cheap: "under", rich: "over" });

const ACTION_OF = Object.freeze({ cheap: "pay", rich: "collect" });

const LOSS_WORD = Object.freeze({
  bounded: (usd) => "The loss is capped at " + usd + ".",
  unbounded: () => "The loss can grow past what the position collects.",
});

const LEAN_WORDS = Object.freeze({ "-1": "bearish", "0": "mixed", "1": "bullish" });

const finite = (n) => typeof n === "number" && Number.isFinite(n);

export function usd(n, digits = 0) {
  if (!finite(n)) return DASH;
  const a = Math.abs(n);
  const body = a.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return SIGN_PREFIX[Math.sign(n)] + "$" + body;
}

export function usdShort(n) {
  if (!finite(n)) return DASH;
  const a = Math.abs(n);
  const tiers = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, tag] of tiers) {
    if (a >= size) {
      const v = a / size;
      return SIGN_PREFIX[Math.sign(n)] + "$" + (v >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, "") + tag;
    }
  }
  return usd(n, 0);
}

export function pct(fraction, digits = 0) {
  if (!finite(fraction)) return DASH;
  return (fraction * 100).toFixed(digits);
}

export function volPoints(fraction) {
  if (!finite(fraction)) return DASH;
  return (Math.abs(fraction) * 100).toFixed(1);
}

export function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return DASH;
  return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]);
}

export function strikeLabel(k) {
  if (!finite(k)) return DASH;
  return String(Number.isInteger(k) ? k : Number(k.toFixed(2)));
}

export function leanWord(value) {
  return LEAN_WORDS[Math.sign(value)] || LEAN_WORDS["0"];
}

export function callSay(call) {
  const word = SIDE_WORD[call.side] || "option";
  const strike = strikeLabel(call.strike);
  const head = "The " + strike + " " + word + " for " + dayLabel(call.expiry) + " looks " + call.verdict + ".";
  const why = "The market prices it at " + pct(call.marketIv, 1) + " vol; the model's fair level is " + pct(call.fairIv, 1) +
    ". That is " + volPoints(call.edgeVol) + " vol points " + VERDICT_DIR[call.verdict] + ", worth about " + usd(Math.abs(call.edgeUsd)) + " a contract.";
  const action = call.action || ACTION_OF[call.verdict];
  let gain;
  if (action === "pay") {
    gain = "Held to expiry the model puts the average result at " + usd(call.ev) + " a contract, with a " + pct(call.pop) +
      "% chance of a profit. Break-even is " + usd(call.breakeven, 2) + ".";
  } else {
    const loss = call.maxLoss === null || call.maxLoss === undefined ? LOSS_WORD.unbounded() : LOSS_WORD.bounded(usd(Math.abs(call.maxLoss)));
    gain = "Selling it collects about " + usd(call.mid, 2) + ". The model's average result is " + usd(call.ev) +
      " a contract, and the chance of keeping the credit is " + pct(call.pop) + "%. " + loss;
  }
  return { head, why, gain };
}

export const CONVENTION = "by the site's convention, calls on the ask side and puts on the bid side count as bullish";

const mins = (n) => String(Math.max(1, Math.round(n)));

export function liveSay(m) {
  const f = m.f || {};
  const T = m.ticker;
  const tail = f.event ? " With a report " + f.event + " sessions away." : "";
  switch (m.kind) {
    case "surge":
      return T + " has " + usdShort(f.premium) + " of flagged options flow across " + f.n + " windows in the last " + mins(f.minutes) +
        " minutes. The bar for this name is " + usdShort(f.bar) + "." + tail;
    case "repeat":
      return "Flow keeps returning to the " + strikeLabel(f.strike) + " " + (SIDE_WORD[f.side] || "option") + " for " + dayLabel(f.expiry) + ": " +
        f.n + " flagged windows in " + mins(f.minutes) + " minutes, " + usdShort(f.premium) + " in all." + tail;
    case "flip":
      return T + " flow has turned " + leanWord(f.now) + ", " + pct(Math.abs(f.now)) + "% of sided premium, after a " + leanWord(f.before) +
        " read earlier in the session. " + "Lean is " + CONVENTION + ".";
    case "cluster":
      return "Most of " + T + "'s flow is landing in the " + dayLabel(f.expiry) + " expiry: " + pct(f.share) + "% of " + usdShort(f.premium) + ".";
    case "sweeps":
      return T + " has " + f.n + " fast, multi-exchange windows in " + mins(f.minutes) + " minutes, mostly on the ask side. " + usdShort(f.premium) + ".";
    case "size":
      return T + " has one window of " + f.size.toLocaleString("en-US") + " contracts in the " + strikeLabel(f.strike) + " " + (SIDE_WORD[f.side] || "option") +
        " for " + dayLabel(f.expiry) + ", " + usdShort(f.premium) + ". That is " + f.k.toFixed(1) + "× the name's usual large window." + tail;
    case "sector":
      return f.n + " names in " + f.sector + " are all seeing heavy options flow together: " + f.names.join(", ") + ".";
    default:
      return "";
  }
}

export const BUILDING_LINES = Object.freeze({
  "no-card": "No priced view for this name yet.",
  unbuilt: "The Neuron has not written a view of this name yet.",
  screen: "Only a thin reading exists for this name, so there are no priced calls.",
  grade: "The engine's grade for this name is too low for a priced call.",
  "no-engine": "The options engine did not price this name tonight.",
  "event.window": "A report falls inside the window, so no priced call is shown.",
  "premium.conflict": "Premium and flow disagree, so no priced call is shown.",
  expired: "The last priced read is two or more sessions old, so only facts remain.",
  behind1: "The last priced read is one session old.",
  disagree: "The readings disagree.",
  "thin-norm": "Too little history to compare today's flow against.",
  ok: "Nothing stands out.",
});

export function calmLine(ticker) {
  return "Nothing stands out for " + ticker + ". Options are priced about where the model prices them.";
}

export const CALL_VERBS = Object.freeze(ACTION_OF);

export const INFO_SENTENCES = Object.freeze([
  "Slow money, read nightly from public filings the feed collects.",
  "13F filings report holdings at a quarter's end, up to 45 days later.",
  "Rotation compares each filer's book weights between the last two quarter ends.",
  "Weights move with prices as well as trades; this is the book, not the buying.",
  "Breadth counts positions raised against positions cut, by sector.",
  "Insider figures count insiders per day, so one insider can count twice.",
  "The feed states no unit for insider dollars, so none are shown.",
  "Failures to deliver are published about two weeks after settlement.",
  "Short-sale volume is not short interest; market makers' hedges count as short sales.",
  "Dates are US exchange dates; times are Türkiye time.",
  "Nothing here is advice or a forecast.",
]);

export const LAYER_SENTENCES = Object.freeze({
  late: "Filed after the 45-day limit.",
  lag: "Lag counted in exchange sessions from the trade.",
  flags: "Flags are the feed's; the page does not judge them.",
  since: "Measured from the trade date, which no reader knew until the filing.",
  money: "Company money, not the filers on this page.",
});

export const WHY = Object.freeze({
  failed: "The feed did not answer tonight.",
  plan: "The site's data plan does not include this.",
  budget: "Tonight's read budget ran out before this.",
  unit: "The feed states no unit for this figure.",
  unread: "Not read yet; names are read in rotation.",
  stale: "From an older session.",
  absent: "No filing names this stock.",
  calendar: "Outside the session calendar.",
});

export const STATE_SENTENCES = Object.freeze({
  loading: "Loading the positioning read.",
  pending: "The first positioning read lands after tonight's run.",
  quietRotation: "No filer had both quarters on file to compare.",
  quietFilings: "No filing is on record in the window.",
  quietInsiders: "No insider rows came back for any sector.",
  quietShort: "No failure to deliver or short volume row came back.",
});

export const FOOTERS = Object.freeze({
  rotation: "Weights move with prices as well as trades; this is the book, not the buying.",
  shortVolume: "Short-sale volume is not short interest; a market maker's hedge is a short sale.",
  ftd: "Failures to deliver are published with a lag of about two weeks.",
});

export const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

export const ALL_SENTENCES = Object.freeze([
  ...INFO_SENTENCES, ...Object.values(LAYER_SENTENCES), ...Object.values(WHY), ...Object.values(STATE_SENTENCES), ...Object.values(FOOTERS),
]);

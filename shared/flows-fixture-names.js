export const FIXTURE_TICKER_RE = /^(?:SY[A-Z]\d{3}|GONE\d)$/;

export const FIXTURE_TOKEN_RE = /"(SY[A-Z]\d{3}|GONE\d)"/;

export const FIXTURE_HOSTS = Object.freeze(["127.0.0.1", "localhost"]);

export const FIXTURE_REFUSALS = Object.freeze({
  fixture_ticker: Object.freeze([422, "Fixture ticker names are never stored"]),
  fixture_payload: Object.freeze([422, "Fixture payloads are never stored"]),
});

export const isFixtureTicker = (ticker) => typeof ticker === "string" && FIXTURE_TICKER_RE.test(ticker);

export function fixtureNameIn(text) {
  const found = FIXTURE_TOKEN_RE.exec(typeof text === "string" ? text : String(text ?? ""));
  return found ? found[1] : null;
}

export function fixtureHost(host) {
  const name = String(host ?? "").toLowerCase();
  return FIXTURE_HOSTS.includes(name) || /\.test$/.test(name);
}

export function fixtureMarked(text) {
  if (typeof text !== "string" || !/^\s*\{/.test(text) || !/"fixture"\s*:\s*true/.test(text)) return false;
  try {
    const body = JSON.parse(text);
    return !!body && typeof body === "object" && !Array.isArray(body) && body.fixture === true;
  } catch {
    return false;
  }
}

export function fixtureRefusal(key, text) {
  const tail = /^(?:card|card-x|hist):(.+)$/.exec(String(key ?? ""));
  if (tail && isFixtureTicker(tail[1])) return { code: "fixture_ticker", name: tail[1] };
  const name = fixtureNameIn(text);
  if (name) return { code: "fixture_ticker", name };
  if (fixtureMarked(text)) return { code: "fixture_payload", name: null };
  return null;
}

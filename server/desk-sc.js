export const SC_PAGE_SIZE = 500;
export const SC_MAX_PAGES = 24;
export const SC_PAGES_DEFAULT = 12;
export const SC_WAVE = 4;
export const SC_CHAIN_TTL_MS = 60000;
export const SC_CHAIN_KEEP = 2;

const REFUSED = Symbol("refused");

export async function gatherPages({ first, page, unwrap, refused, maxPages = SC_MAX_PAGES, wave = SC_WAVE, size = SC_PAGE_SIZE }) {
  const rows = unwrap(first).slice();
  let pages = 1, failed = 0, budget = false;
  let more = rows.length >= size;
  while (more && pages < maxPages) {
    const n = Math.min(wave, maxPages - pages);
    const base = pages;
    const got = await Promise.all(Array.from({ length: n }, (_, i) => page(base + 1 + i).then(unwrap, (e) => (refused(e) ? REFUSED : null))));
    more = true;
    for (const part of got) {
      pages++;
      if (part === REFUSED) { budget = true; more = false; continue; }
      if (part === null) { failed++; more = false; continue; }
      for (const r of part) rows.push(r);
      if (part.length < size) more = false;
    }
  }
  return { rows, pages, failed, budget, truncated: more && pages >= maxPages };
}

export function chainCacheGet(map, key, now) {
  const hit = map.get(key);
  if (!hit) return null;
  if (now - hit.at >= SC_CHAIN_TTL_MS) { map.delete(key); return null; }
  return hit;
}

export function chainCachePut(map, key, value, now) {
  map.delete(key);
  map.set(key, { ...value, at: now });
  while (map.size > SC_CHAIN_KEEP) map.delete(map.keys().next().value);
}

export function singleFlight(flights, key, run) {
  const held = flights.get(key);
  if (held) return held;
  const promise = Promise.resolve().then(run).finally(() => { if (flights.get(key) === promise) flights.delete(key); });
  flights.set(key, promise);
  return promise;
}

/** Bounded reads of UW's zero-based option-contract pages.
 * Completeness is established by a short terminal page, never by row count.
 * Duplicate or malformed pages fail closed because a changing snapshot or an
 * ignored page parameter cannot establish exhaustive coverage.
 */
export async function readChainPages(first, fetchPage, {
  pageSize = 500, maxPages = 8, allowNext = () => true,
} = {}) {
  const rows = [], seen = new Set();
  let pages = 0, duplicates = 0, invalid = 0, reason = "page-budget";
  let page = first;
  while (true) {
    if (!Array.isArray(page)) { reason = "invalid-response"; break; }
    pages++;
    let added = 0;
    for (const row of page) {
      const id = row?.option_symbol;
      if (typeof id !== "string" || !id) { invalid++; continue; }
      if (seen.has(id)) { duplicates++; continue; }
      seen.add(id); rows.push(row); added++;
    }
    if (invalid || duplicates) { reason = invalid ? "invalid-row" : "overlapping-pages"; break; }
    if (page.length < pageSize) { reason = "exhausted"; break; }
    if (!added) { reason = "no-progress"; break; }
    if (pages >= maxPages) break;
    if (!allowNext()) { reason = "run-budget-or-deadline"; break; }
    try { page = await fetchPage(pages); }
    catch { reason = "request-failed"; break; }
  }
  return { rows, coverage: { complete: reason === "exhausted", reason,
    pages, uniqueRows: rows.length, duplicates, invalid, pageSize, maxPages } };
}

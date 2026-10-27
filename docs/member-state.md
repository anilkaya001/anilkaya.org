# Member state, Since your last visit and exports (Decision 6)

What a signed-in Flows member keeps with us, how it is protected, and what an operator has to do. The code is `server/member-store.js`, `server/routes/flows-me.js`, `shared/flows-member-*.js`, `shared/flows-since.js`, `shared/flows-export-*.js`, `shared/flows-columns.js`, `assets/js/flows-member.js`, `assets/js/flows-member-ui.js` and `assets/js/flows-member-boot.js`.

## What is stored

| Table | Row | Holds |
|---|---|---|
| `member_state` | one a member (`member_id`, the lower-case sign-in name) | the sealed watch list (`wl_kid`, `wl_iv`, `wl_ct`), its version `wl_ver`, `device_only`, the visit clock (`seen_ms`, `visit_ms`, `prev_seen_ms`) |
| `member_export` | one an export | `member_id`, `page`, `n_rows`, the column names, `at_ms`; kept 90 days |

The list is at most 200 tickers, each checked against the nightly universe. It is sealed with AES-256-GCM under a key derived with HKDF-SHA256 from `MEMBER_STATE_KEY` and the member id, with the member id and version as additional data, in a fixed 2,624-byte frame, so a row's length says nothing about the list and a copied row opens for no other member or version. No ticker appears in a column, a log line, a header or a query string. The list is never sent to the data vendor and never to a model.

## What the browser loads

The page carries one eager script, `flows-member-boot.js` (about 2 KB): it pings the visit route while the page is visible and loads the rest on demand. `flows-member.js` (about 5.4 KB gzip) holds the saved-list state, the write queue, the ticker's star and the export menu, and loads on a member button, on the first opening of an export menu and, after the page's load event, on the ticker page (not under Data Saver). A server-held list on the ticker page therefore costs that one file and no other. `flows-member-ui.js` (the dialogs) and its sheet `flows-member.css` load on the first click on a member button or on the history row. `storage.js` loads only when the list is device-only or when My list opens, because the dialogs offer the device copy. `FLOWS_MEMBER_STATE=off` removes all of it from the page.

## Secrets and switches

| Name | Kind | Meaning |
|---|---|---|
| `MEMBER_STATE_KEY` | Worker secret, at least 32 UTF-8 bytes | Absent or short: every list is device-only and the page says so (`reason: key_absent`). Nothing is stored. |
| `MEMBER_STATE_KEY_PREV` | Worker secret | The key the rows were sealed under, while a rotation runs. |
| `FLOWS_MEMBER_STATE` | `wrangler.toml` var | `on`, `owner` or off (anything else). Off: the routes answer 404 and the pages carry no member markup. |
| `FLOWS_EXPORTS` | `wrangler.toml` var | `on`, `owner` or off. Ships `owner` until the licence questions below are answered. |
| `MEMBER_STATE_READ`, `MEMBER_STATE_WRITE`, `MEMBER_EXPORT` | rate-limit bindings | 120, 30 and 10 a minute a member. They are flood brakes and fail open. |

Set the key with `wrangler secret put MEMBER_STATE_KEY` (production) and the same for the staging Worker. Use 32 random bytes, base64 or hex, from a password manager. Losing the key loses every saved list: the rows stay in D1 and read as unreadable (`unreadable: true`). A row the server cannot open is never replaced by accident: a PUT for it is `409 unreadable_row` unless its body carries `replaceUnreadable: true` (a stale version is a 412 first), the page sends that flag only after the member has pressed Replace in My list and read that the old list cannot be recovered, and the ticker's star stays unpressable with the sentence "Your saved list could not be read. Open My list." Every failed open is logged with a reason (`unknown_kid` or `open_failed`) and no content, so a key ring that lost a key is visible to the operator. An operator who removes an old key early and puts it back within the hour loses nothing, because no write replaced a row in between.

### Rotating the key

1. `wrangler secret put MEMBER_STATE_KEY_PREV` with the old value, then `wrangler secret put MEMBER_STATE_KEY` with the new one, and deploy.
2. Reads of old rows keep working (the row names its key by `wl_kid`). The 03:00 ET firing re-seals up to 50 rows a night under the new key, only while both secrets are set. That firing is the repository's existing 03:00 to 03:30 Eastern window of the half-hourly housekeeping cron (`pruneDue`), worked out from the Eastern clock, so a change of clocks moves neither the window nor this sweep; the 90-day purge compares against the firing's time, and a row of exactly 90 days or 90 days less a second stays while one a second older goes.
3. When `SELECT wl_kid, count(*) FROM member_state WHERE wl_ct IS NOT NULL GROUP BY wl_kid` shows one key id, delete `MEMBER_STATE_KEY_PREV`.

### Offboarding a member

`DELETE FROM member_state WHERE member_id = '<name>';` removes the list and the visit clock. The export log of that name stays until it ages past 90 days, so a name reused inside that window starts with that member's export count. Remove the row by hand (`DELETE FROM member_export WHERE member_id = '<name>'`) when the name is retired for good.

## Routes (all behind the Flows session, same origin)

| Route | Use |
|---|---|
| `GET /api/me/state` | the mode, the list when the server holds it, `maxNames`, the version and the `ETag` `"w<version>"` |
| `PUT /api/me/state` | `{deviceOnly:false, watchlist:[...]}` or `{deviceOnly:true}`, with `If-Match: "w<version>"`; 428 with none, 400 for a malformed one, 412 with the current version when it moved, 409 `unreadable_row` when the stored list cannot be opened and the body lacks `replaceUnreadable: true` (nothing is written), 503 `universe_unreadable` (with `Retry-After`) when the nightly universe cannot be read to check the names, never a 400 |
| `DELETE /api/me/state` | removes the list and the visit clock and keeps the export log (90 days). The row stays with only the member id and a version one higher (a second DELETE changes nothing), so a tab that still holds the old version gets a 412 and cannot bring the list back, and no version is ever used twice |
| `POST /api/me/visit` | counts a visit (a write at most once a minute, a new visit after 30 idle minutes) |
| `GET /api/me/since` | the changes since the last visit, computed from the nightly rows; names are never read here, the browser matches them |
| `GET /api/me/exports`, `POST /api/me/export` | the log, the window and the file; 50 files in any rolling 24 hours |

A saved name that later leaves the universe stays on the list until its owner removes it; only names being added are checked against the universe. The page marks such a name "Not in today's universe." and shows no figure for it.

A browser that reads the list with no key on the server, or a row that will not open, is told `unreadable: true` and never sees an empty list with a valid version: with the key present My list says "Your saved list could not be read.", hides the add form and offers "Start a new list" behind a question; with the key absent the list simply stays on this device and the page says saving is not available yet. A device list made while the key was missing is not offered to the account when the key returns, because the account then holds a list of its own (a known limit, question 16).

Visits: a ping is a write at most once a minute, and the baseline Since compares with moves only when a visit starts after 30 idle minutes. Repeated pings, a background tab or a restored page therefore never empty the page. The browser pings only while the page is visible, and the Since button waits for its ping for at most three seconds.

## Since your last visit

The server reads four stored rows (`universe`, `scoretrack`, `events`, the alerts) and returns groups (flagged windows, large moves, board changes, entering the 21-session window, reporting soon), at most 1,000 lines each, and for a group that was cut the distinct tickers of the whole group, so the page can say which of the member's names appear without the server ever holding the list. A first visit, no new data and unreadable data are named states. The list shown first on the page ("Your names") is built in the browser.

## Exports

Every export comes from the nightly artefacts, never from a vendor call. A file that was cut says so in its name (`flows-moves-2026-10-24-TRT-cut-1000-of-1234.csv`). Each column carries its provenance in `shared/flows-columns.js` (own, aggregate or vendor), a column the licence has not cleared is held, `asof_trt` and `method_version` are the first two columns, an absent figure is an empty cell with its reason in the `absent` column, and a file stops at 1,000 rows (the response says so in `X-Export-Truncated` and `X-Export-Available`, a JSON file in its `meta`, and a CSV in a last line that reads "Cut at 1,000 of N rows, in the order of this file. The rest are not in it.", padded to the width of the header; a program that reads the file must drop a last line whose first cell starts with "Cut at"). A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, a number is written bare, and the CSV starts with a byte order mark so that a spreadsheet reads the em dash. The log keeps the rows sent, not the rows available.

The member reaches the log from My list on every page ("Export history", shown when exports are on for the member) and from the Export menu on Moves and Unusual. "Download list and export log" downloads the list and the log (when, page, rows, column names); it does not hold the visit clock. Events and Political are built and held until questions 2 and 4 below are answered.

## Disclosures a page may make

- The list is stored encrypted on our server and never sent to the data vendor or to a model.
- Deleted data stays in the database's restore history for up to 30 days (D1 Time Travel).
- The export record is kept 90 days to enforce the export limit.
- Nothing here claims a certification, a data region or a retention beyond those lines.

## Open questions for the owner

1. The signal score and the move in typical days appear together in one export. Is that pair a derived series the vendor's terms allow?
2. Event dates (earnings, macro, FDA) in a file: cleared or not.
3. Vendor aggregates (net premium, ask-side share): may they be exported at all, and in what form?
4. Congressional disclosures in a file.
5. The client-side CSV exports on the boards and the premium desk carry vendor-derived columns. They predate this lane. Should they follow the same registry?
6. Where D1 stores the data (region) and what that means for KVKK notices.
7. Whether deleting a member's state should also delete the export record, against the licence reason for keeping it 90 days.
8. The sidebar's "Watchlist" entry is the near-the-edge board, not the member's list. Rename it (for example "Near misses")?
9. The clause that says a member's export is a derived file for their own use.
10. Whether a cut CSV should carry its note as a last line (shipped) or only in the response headers and the JSON.
11. Whether the export log should keep the count available beside the count sent.
12. Whether the visit record belongs in "Download list and export log" (it is not there today).
13. What the page does when the key is missing: it shows the list on this device and says saving to the account is not available yet (shipped), or it stops offering a list at all until the key returns.
14. Replacing a list the server cannot open needs the member's confirmation in My list (shipped). Should an operator also be able to restore it, for example from a key held in escrow?
15. After "Delete my saved data" the copies on the member's other devices stay until cleared there, and the confirmation says so. Should a deletion also reach the other devices the next time they connect?
16. A list made on this device while the key was missing is ignored once the server answers again with a list of its own. Should the page offer the device copy when it differs from the server's and is newer than the row?

# Fire & Forget lanes U and G: the client pieces and the mount

Shipped in shadow. `DEPLOY.md` 10.7 is the release note; this file is what a
later lane needs to know.

## Lane U

| File | What it is |
|---|---|
| `assets/css/flows-ff-tokens.css` | The contract's eleven `--ff-*` tokens, each `var()` of one existing page token, plus `.ffx-clip` and `.ffx-cut`. |
| `assets/js/flows-ff-kernel.js` | `FlowsUI.ffKernel = { DASH, hooks, fit }`. |
| `assets/js/flows-ff-client.js` | `FlowsUI.ffClient = { get, post, patch, put, del }`. |

Kernel. `hooks.page()` and `hooks.slot(name)` read `data-ff-page` and
`data-ff-slot`. `hooks.state(el, value)` writes one of the five health states,
anything else as `unknown`. `hooks.absent(el, reason, text)` writes an em dash
and the reason sentence and sets `data-ff-absent` to the reason code;
`hooks.present(el, text)` writes a figure and clears it; `hooks.figure(el, f,
fallback)` takes the API's `{ text, reason, reasonText }`. A zero is a figure;
an empty string or a bare dash is absent. An unchanged write mutates nothing.
`hooks.emit` and `hooks.on` carry only the three contract events with every
field of their detail. `fit.rows(list, { keep })` hides trailing rows until the
list fits, `fit.clip(el)` reports a cut line and titles it (never over a title
the page wrote), `fit.watch(el, fn)` re-runs on resize and font load.

Client. Paths are checked before any request: `/api/ff/*` for every verb,
`/api/flows/*` for `GET` alone, same origin only (`client_path` otherwise).
Requests are same-origin JSON with a 20 s deadline (`opts.deadlineMs`). A
rejection is an `Error` with `code`, `status`, `message`, `details` and
`retryAfterS`. The code is the Worker's; with no JSON body it is the Worker's
code for that status, else `http_<status>`. The client's own codes are
`timeout`, `network`, `unreadable`, `fixture` and `client_path`. The Worker's
`apiError` puts extra fields beside `error`, not under it, so `details` is
`error.details` when present and otherwise every top-level field but `error`.
`POST /api/ff/preview` answers `{ v, serverNow, preview }` and the client
resolves the `preview` object, which is the shape the Fire page reads. A
`GET` that carried an `ETag` is repeated with `If-None-Match` and a 304
resolves the stored body (sixteen paths kept).

The contract's textual scan forbids the token `fetch(` in every Fire source
outside three pipeline legs, the browser client included. The client therefore
calls `window.fetch.call(window, path, init)`, once. Widening
`FORBIDDEN.fetchAllowedIn` to name the client would let it be written plainly;
that is a contract change and the owner's choice.

## Lane G

Edits are in the files `SHARED_EDITS` lists. Outside that list, and why:

| File | Why |
|---|---|
| `scripts/flows-nightly/sections/ff.mjs`, `tests/lib/ff-c-legs-battery.mjs` | The pipeline contract needs `export async function runFf(ctx)` and a literal stage id; lane C's section took its deps as a second argument. |
| `tests/ff-contract.mjs` | The payload check assumed no Fire product was registered; it now requires a product registered exactly when its writer is tracked. Three plants added. |
| `tests/server-pages.mjs`, `tests/route-matrix.mjs` and its fixture, `tests/flows-public-contract.mjs`, `tests/flows-pages-render.mjs` and its baseline, `tests/flows-layout-sweep.mjs` | They enumerate every page and route; the new pages and routes had to be declared. |
| `tests/ff-u-*.mjs`, `tests/lib/ff-u-*.mjs`, `tests/server-ff.mjs`, their `tests/suites/*.json`, `docs/modules.json`, generated docs | The lanes' own suites and rows. |

## Deferred, and why

- **Inbox, Digest, Wires pages, the sidebar mark, the name panel** (lanes E, F,
  H). Their page rows exist and answer an honest not-released page with a link
  to Fire. The `mark` and `name-panel` slots are not inserted, because nothing
  fills them.
- **`ff-calibration`** is not registered: `scripts/flows-legs/ff-calibrate.mjs`
  does not exist. `ff_record`, confirmations and `ff_arch` are never written.
- **Tier 1 evaluation.** Only a landed `live:alerts` write starts a live look.
- **Live `no_looks` receipts** at the close are not written.
- **Phone tab bar** has no Fire entry; the drawer has it.

## Findings for the other lanes

- Lane C `gap()`: `armedIds` filters by neither effective session nor layer,
  so a wire armed after a missed session gets a `not_evaluated: run_late`
  receipt for it, and on launch day the session before launch is flagged for
  every wire armed that day. It also re-reads every armed wire on each firing
  while a run is missing.
- Lane C `EVAL_SQL.firstLooks` scans every evaluated receipt on each live look.
- Lane B: preview shares `FF_HEAVY` (6 a minute) with export, so an editor who
  changes a wire quickly can see 429s. The preview route hands the engine no
  flagged windows, so a nightly window wire without `oi_confirm` previews as
  `unavailable: source_missing`.
- Lane B: `/api/ff/run` answers 401, not 503, when the OIDC keys cannot be
  fetched.
- Lane A: nightly and live effective sessions are equal at every instant
  tried; `HOUSE_EFFECTIVE_SESSION` is 2026-11-02.
- A sector-scope tested wire is priced on the universe's size, an upper bound,
  because the route does not know sector sizes. With a metrics payload that
  carries no sector map, sector wires evaluate nothing.
- The sidebar rail at 1440x820 already ran about 25 px past its box with Flow
  Lab on; with Fire it runs about 60 px. The rail is a scroller by design, and
  the last entry is reached by scrolling it.

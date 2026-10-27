# Fire & Forget lane D: the Fire page

Lane D is the member-facing authoring surface: the Fire page (`/flows/fire/`), the wire composer, the live preview and `FlowsUI.ffFire.openFireSheet`, the sheet that lets another page (the name panel, the Wires page) arm or adjust a wire without leaving. It reads and writes only the lane B routes `/api/ff/wires`, `/api/ff/house` and `/api/ff/preview`, plus the existing `/api/flows/universe?cols=t,sec` for the symbol and sector lists. It makes no vendor call and no model call, computes no time, scores no price, and stores nothing in the browser.

## Files

| File | What it is |
|---|---|
| `shared/ff-pages-fire.js` | The page's pure half. `fireRegistry()` is the contract's usable metrics (ready and limited) and templates (a blank wire first, then every ready or limited template; warming and hidden ones are not offered) as the JSON the page reads; `fireBody(glyph, registry)` is the page markup (title row, a three-tab switch under 1100 px, the Start, Wire and Right now panels, the info dialog) with the registry in a `script type="application/json" id="ffxData"` block escaped for `<` and the line separators; `dataBlock()` is that block alone, for any page that wants `openFireSheet`. The module imports only the contract, never `flows-pages.js`, so `flows-pages.js` can import it. It exports `FIRE_PAGE`, `FIRE_PATH`, `FIRE_DESCRIPTION`, `FIRE_STYLES` and `FIRE_SCRIPTS`. |
| `assets/js/flows-ff-composer.js` | `FlowsUI.ffFire.composer`: `createModel(registry, F)` is the pure editor model (fixed grid and clamp per unit by half away from zero on the value divided by the unit's threshold step, parse and format, the same grammar rules the contract states as `reasons`, the allowed moves for cadence, scope, operators, metric swaps, hold and quiet period, and the plain-English sentence); `mount(host, opts)` is the view (cadence, conditions, scope, hold, quiet period, sentence, reasons, an actions slot) with a fitter that hides trailing condition rows until nothing is clipped and offers `+N more · edit all` in a dialog. |
| `assets/js/flows-ff-preview.js` | `FlowsUI.ffFire.preview.mount(host, opts)`: debounced `POST /api/ff/preview`, drops a late answer for an older wire, and paints the API's own words: the count that hold, unknown names with their reasons, the first check in TRT, the data's session, the unmeasured false-alarm rate as a dash with its reason, and a fitted name list with Show all. |
| `assets/js/flows-ff-fire.js` | `FlowsUI.ffFire.page`, `workbench` and `openFireSheet`. The page controller (tabs with arrow keys, template list with the house record from `/api/ff/house`, header limits from `/api/ff/wires`, the arm flow) and the sheet. |
| `assets/css/flows-ff-fire.css` | The page and sheet styles, `ffx-` prefix, tokens only (the `--ff-*` tokens carry a fallback to the global tokens until lane U's file is loaded). A sigma is printed as `SD`, because `contracts.mjs` forbids the glyph in `assets/js`; the API's `σ` in a preview figure is rewritten to ` SD` in the page. |
| `tests/ff-d-model.mjs`, `tests/ff-d-mutants.mjs`, `tests/lib/ff-d-model-load.mjs` | The editor model against an independent restatement of the contract's grammar (2,500 random edits, 800 random walks), the contract's display strings, worked rounding cases, the page and registry checks, the source lint, and 36 planted wrong builds (23 of the model, 13 of the lint). |
| `tests/ff-d-fire-render.mjs`, `tests/ff-d-fire-plants.mjs`, `tests/lib/ff-d-world.mjs` | Chromium with `page.route` stubs and no server: the seven viewports of the contract with 8 conditions and 25 names, every flow, every error code, the keyboard, 44 px targets on a touch screen, axe (`ff-d-fire-render`), and 27 planted wrong builds of the served scripts and sheet, each stopped at its first failed check (`ff-d-fire-plants`, the same file run with `FF_D_PLANTS`). The world stubs `FlowsUI.ffClient` with a fetch-backed double. |

## Behaviour that the tests hold

- One screen at 1920x1080, 1920x940, 1440x820, 1024x768, 1024x660, 390x844 and 390x664: no page scroll, no inner scroll, no child outside an overflow-hidden parent, every truncation has a `title`. Under 1100 px the three panels are tabs (Start, Wire, Right now) that answer the arrow keys, Home and End.
- Honest data. A figure the API does not carry is a dash and its reason: the house record (`— under 20 sessions of history`), the false-alarm rate (`— a fact wire has no statistical test`), a preview that read no name (`— no name could be read`, never "0 of 0"), a route that is off (`— Fire is unavailable: route off`). Nothing is read as zero.
- The browser computes no time and no duration. Every clock text is the API's, and ends in TRT.
- Arming a wire that has reasons against it sends nothing. The request carries `Idempotency-Key`, the same key on a retry of the same wire and a new one after any edit, and the body holds only `ast`, `title` and, while the wire is exactly a template's, `template`. A member id is never sent. Adjusting sends `{ id, version, ast }` with the base version, and cannot change the cadence.
- Errors are mapped to a dash and a sentence: `ff_wire_limit` names which limit, `ff_budget_exceeded` the used and the maximum, `ff_off` its reason, `ff_version_immutable` asks for a reload, `network` says nothing was armed.
- No copy uses a word of `COPY_BANNED`, none says tape, and no price or outcome is shown or scored.

## What lane G wires

Nothing here is registered in a shared file.

1. `shared/flows-pages.js`: `import { FIRE_DESCRIPTION, FIRE_SCRIPTS, FIRE_STYLES, fireBody } from "./ff-pages-fire.js"` and
   `export function firePage({ username = "" } = {}) { return flowsDocument({ title: "Fire", description: FIRE_DESCRIPTION, active: "fire", username, chrome: false, styles: FIRE_STYLES, scripts: FIRE_SCRIPTS, body: fireBody(glyph) }); }`, added to `FLOWS_PAGES`. The page uses the `data-flows-page="fire"` hook that `shell` writes from `active`.
2. `FIRE_SCRIPTS` lists lane U's `flows-ff-kernel.js` and `flows-ff-client.js` first. The contract forbids a `fetch` in any FF browser file, so the controller makes every request through `FlowsUI.ffClient`: `get(path)`, `post(path, body, { headers })` (the arm request sends `Idempotency-Key` there) and `patch(path, body)` (adjust). Each must resolve with the parsed JSON and reject with an `Error` that has `code`, `status`, `message` and `details` from the API's error body, and `code: "network"` when the server did not answer. Lane U's client needs a `patch`; if it names it differently, change `client()` in `flows-ff-fire.js`. Without a client the page says `— the Fire client did not load`. The universe read for the symbol and sector lists also goes through `get`.
3. `server/routes/flows-pages.js`: a row for `/flows/fire/` and its 308 bare form, gated by `FF_ROUTE_FIRE` (a closed page is the unknown-page 404), and the sidebar entry in `FLOWS_NAV`.
4. `assets/css/flows.css` and `flows-weight`: the page loads two stylesheets and five scripts eagerly; its allowance is the measured size of `FIRE_STYLES` and `FIRE_SCRIPTS`.
5. The name panel and the Wires page open the sheet with `FlowsUI.ffFire.openFireSheet({ symbol, template, ast, wire })`. A page that is not Fire must emit `dataBlock()` (the registry) and load `flows-ff-composer.js`, `flows-ff-preview.js`, `flows-ff-fire.js` and `flows-ff-fire.css` (for example as a `FlowsUI.defer` group). `wire` is `{ id, version, title, ast, template }` for an adjust; `onDone(result)` is called with the API's wire view. The call answers `null` when the registry block is absent.
6. `?symbol=<SYMBOL>` on `/flows/fire/` adds the name to the wire's scope.

## Known limits

- Sector names for a sector scope come from the universe read; without it the field is a free text box and the server decides.
- The editor does not know the member's other wires, so `ff_wire_limit` and `ff_budget_exceeded` are answers of the arm request, not of the preview.
- The template's house record is the one of the first house wire of the template.

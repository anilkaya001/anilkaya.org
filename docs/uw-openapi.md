# docs/uw-openapi.yaml: provenance and refresh

`docs/uw-openapi.yaml` is the vendor's OpenAPI document for the Unusual Whales API, kept in the repository so that every field the code reads can be checked against a documented name and so that the dossier's test fixtures are built to the vendor's documented types.

## The file today

| | |
|---|---|
| Committed | 2026-09-05, commit `9c49af3` |
| `info.version` | `1.0` |
| Newest changelog entry | `2026.08.30` |
| Size | 217 paths, 218 operations |
| sha256 | `c8686b3ff855cb5720900c23e17e7f49ff6c61df32835d977e60c85f340b76d7` |
| Source address | not recorded when the file was committed |

The file is stale. The programme's comparison against the vendor's live documentation on 2026-10-05 found 20 operations that exist only in the live documentation (among them the five that production calls without a committed contract: `/api/market/daily-report`, `/api/stock/{ticker}/interpolated-iv/distribution`, `/api/stock/{ticker}/volatility/term-structure/distribution`, `/api/stock/{ticker}/volatility/option-sentiment` and `/api/volatility/option-sentiment/top`) and 8 operations whose parameters changed. `scripts/flows-probe-list.json` names the live-only operations in `liveOnly`, so the probe contract stays true until the file is refreshed.

## Refreshing it

Open item: the refresh below has not been done. The builder of P1-38 had no vendor access (the documentation host answers 403 from the sandbox), so `docs/uw-openapi.yaml` is still the 2026-08-30 copy and the row is not fully closed until steps 1 to 6 are run by someone who can reach the document; the one `specSha256` move in step 5 is its closing commit.

1. Obtain the vendor's current OpenAPI document. Its address is owner decision OD-20 and has not been supplied; until it is, take it from the vendor's documentation tool.
2. Copy the old file aside, write the new one over `docs/uw-openapi.yaml`, and record the address, the date and the new `info.version` in the table above.
3. Run `node scripts/uw-spec-diff.mjs <old file> docs/uw-openapi.yaml`. The report lists added and removed operations, parameters added, removed or flipped between required and optional, new deprecations, changed plan sentences and new changelog entries. Read it before anything else. `--check` exits 1 when the two differ, which is the form a weekly drift step runs once the address exists.
4. Run the weekly probe with `--shapes scripts/flows-probe-shapes.json` so the observed wire shape follows the new documentation, then remove `liveOnly` entries from `scripts/flows-probe-list.json` for operations the file now documents.
5. Run `python3 tests/gen-dossier-fixtures.py`. It builds the dossier fixtures from the spec's types and the manifest's names and exits 1 where the two disagree: a name the fixtures emit that the wire did not carry, a rename the spec now documents, an unseen name the spec no longer lists. One regeneration moves `specSha256` and `shapesSha256` in `tests/fixtures-dossier-vendor.json`.
6. Run `npm run test:flows-probe` and `npm run test:flows-dossier` from `tests/`.

## The catalog and the refresh workflow

`node scripts/gen-feed-catalog.mjs` turns this file into `shared/flows-feed-catalog.js`, the committed catalog of every operation and socket channel the feed's document describes (218 operations and 30 channels today), and `shared/flows-feed-client.js` builds requests and reads answers through it; `--check` exits 1 when the catalog is not what this file generates, and `--coverage` prints which operations and channels production reads. Step 1 above now has a tool: the workflow `feed-spec-refresh`, started by hand, has `scripts/feed-spec-refresh.mjs` download the document, by default from the documentation page this file links to and otherwise from the address typed into the run, and `with_key` lets it ask once more with the feed key when the feed's own origin refuses an anonymous request. It refuses anything that is not a whole document of at least 200 paths, writes the `uw-spec-diff` comparison to the run's summary, and pushes the new file alone to the branch `claude/feed-spec-refresh`; it never touches `main` and opens no pull request. It has only been run against a local stand-in server (`tests/flows-feed-spec-refresh.mjs`), so whether the documentation page links to the document, and whether that needs the key, is not known until someone runs it. After it has pushed, the rest is by hand on that branch: record the address, the date, `info.version` and the sha256 in the table above; run `node scripts/gen-feed-catalog.mjs`, `node tests/gen-feed-fixtures.mjs` and `python3 tests/gen-feed-catalog-oracle.py` (it needs PyYAML) and read their diffs; then steps 4 to 6 above and `node flows-feed-catalog.mjs` from `tests/`, whose pinned lists (the names production reads that the document lacks, the wrappers the wire uses, the registry entries the document does not describe) say what the new document changed.

## What may and may not be committed

No vendor value belongs in a committed file, an Actions log, an issue or an artifact. The probe prints names, JSON types, nullability and counts of documented enum tokens, and `scripts/flows-probe-shapes.json` holds those and nothing else. Fixtures are synthetic: a fixture's `source` field may say which generator wrote it and may not say that its rows are verbatim vendor rows or came from a live probe. `tests/flows-probe-contract.mjs` fails on those words in any new fixture and pins the four older fixtures that still carry them until they are regenerated.

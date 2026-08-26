# Cloudflare deployment and rollback runbook

This repository targets a Cloudflare Worker named `anilkaya` with Static
Assets, D1 database binding `DB` (`iewt`), and Google OAuth. Repository state
does not prove the current Workers Builds configuration, secrets, routes,
custom domains, remote D1 schema, or staging state; verify those in the target
account before deploying.

## 1. Verify the exact source revision

Work from a clean commit, not an uncommitted directory:

```bash
git status --short --branch
git rev-parse HEAD
```

Record the SHA in the release/change log. Do not deploy if unrelated or
unreviewed files are present.

## 2. Install the pinned toolchain and run every gate

Node.js 22 or newer is required by the committed test toolchain.

```bash
# Regeneration must be a no-op for the committed authoring sources.
node scripts/generate-course-payloads.mjs
test -z "$(git status --short -- assets/data/courses)"

cd tests
npm ci
npx playwright install chromium
npm test
cd ..

./tests/node_modules/.bin/wrangler deploy \
  --dry-run \
  --outdir /tmp/anilkaya-worker-dry-run
```

The tests run authoring/generated-payload contracts, owner-scoped storage and
reset contracts, the actual local Worker/asset router with D1, and Playwright
across every course stage plus the academy dashboard. The dry-run validates
`wrangler.toml`, bundles `worker.js`, and checks bindings without uploading.

## 3. Verify D1 deliberately

The checked-in schema defines `users`, `progress`, `stats`, and the reset
barrier table `learning_sync`:

```bash
# Disposable/local verification
./tests/node_modules/.bin/wrangler d1 execute iewt \
  --local --file schema.sql

# Remote inspection (authenticated, read-only query). This returns every
# column's position, type, nullability, default, and primary-key ordinal.
./tests/node_modules/.bin/wrangler d1 execute iewt \
  --remote --command \
  "SELECT 'users' AS table_name,cid,name,type,\"notnull\",dflt_value,pk FROM pragma_table_info('users') UNION ALL SELECT 'progress',cid,name,type,\"notnull\",dflt_value,pk FROM pragma_table_info('progress') UNION ALL SELECT 'stats',cid,name,type,\"notnull\",dflt_value,pk FROM pragma_table_info('stats') UNION ALL SELECT 'learning_sync',cid,name,type,\"notnull\",dflt_value,pk FROM pragma_table_info('learning_sync') ORDER BY table_name,cid"
```

Compare the result with `schema.sql`, including column order/type, `NOT NULL`,
defaults, and primary-key ordinals. The required keys are `users.id` = 1,
`progress.user_id` = 1 plus `progress.model_id` = 2, and `stats.user_id` = 1;
`learning_sync.user_id` is also 1. All other `pk` values are 0. A
table-name-only check is insufficient.

Only if the remote inspection proves a whole table is absent, apply the
idempotent schema intentionally:

```bash
./tests/node_modules/.bin/wrangler d1 execute iewt \
  --remote --file schema.sql
```

Remote D1 writes are production mutations. Capture an export/backup according
to the account's retention policy before non-idempotent future migrations. If
an existing table's columns or keys differ, `CREATE TABLE IF NOT EXISTS` cannot
repair it; stop and author a reviewed migration instead.

This release adds `learning_sync`. Apply the idempotent schema before deployment
when operational access is available. For existing git-integrated deployments,
the Worker also creates this exact table on the first authenticated learning
request, so code rollout does not depend on a separate dashboard migration.
`DELETE /api/progress` uses prepared statements in one D1 `DB.batch()`
transaction to increment the verified user's generation, delete progress, and
reset only that user's points, streak, and last activity. The Worker regression
suite verifies first-use provisioning, stale-write rejection, readback, and
cross-user isolation; do not split this batch into non-transactional writes.

## 4. Verify bindings and secrets

`wrangler.toml` must resolve:

- Worker name: `anilkaya`
- Static binding: `ASSETS`
- D1 binding: `DB` → database `iewt`
- `run_worker_first = true`
- `html_handling = "auto-trailing-slash"`

Required secret bindings:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
SESSION_SECRET
```

Use Cloudflare secret bindings, not committed values:

```bash
./tests/node_modules/.bin/wrangler secret list
./tests/node_modules/.bin/wrangler secret put GOOGLE_CLIENT_ID
./tests/node_modules/.bin/wrangler secret put GOOGLE_CLIENT_SECRET
./tests/node_modules/.bin/wrangler secret put SESSION_SECRET
```

The Google OAuth client must contain the exact production callback:

```text
https://anilkaya.org/auth/callback
```

Add any preview/staging callback separately; never reuse an unverified URL.

## 5. Choose one deployment owner

Do not run two independent production pipelines.

### Recommended: CI-gated deployment

Deploy only after the GitHub `regression` job succeeds for the exact SHA. If
deployment is moved into GitHub Actions, use a least-privilege Cloudflare token
and make the deploy job depend on the test job.

### Cloudflare Workers Builds

If Workers Builds remains the deployment owner, verify in the dashboard:

- repository and production branch;
- root directory;
- pinned install/build commands that execute the committed tests;
- deploy command using the committed Wrangler version;
- preview/staging behavior;
- failure behavior (a failed test must prevent deploy).

An external Worker build can otherwise race GitHub Actions. Repository CI being
green does not by itself prove that Workers Builds waited for it.

For an intentional authenticated manual release after all gates:

```bash
./tests/node_modules/.bin/wrangler deploy --strict
```

`--strict` prevents silently overwriting conflicting remote changes. Record the
resulting version/deployment identifier.

## 6. Verify routes and dashboard response rules

The apex custom domain should route to Worker `anilkaya`. As observed on
2026-07-12, `www.anilkaya.org` still used GitHub Pages to redirect to the apex.
Keep `CNAME` until `www` is explicitly attached to the Worker and its redirect
is verified.

Before this repair, live response headers differed from `worker.js`, consistent
with a dashboard Transform Rule. Inspect **Rules → Transform Rules → Modify
Response Header** and remove or align any rule that overrides CSP,
`X-Frame-Options`, COOP, or cache policy.

## 7. Production smoke tests

Run these against the deployed SHA before declaring success.

### API and security contract

```bash
curl -fsS -D /tmp/api.headers https://anilkaya.org/api/me \
  -o /tmp/api.json
python3 -m json.tool /tmp/api.json
grep -i '^cache-control: no-store' /tmp/api.headers
grep -i '^x-frame-options: DENY' /tmp/api.headers
grep -i '^cross-origin-opener-policy: same-origin' /tmp/api.headers
```

Signed-out `/api/me` must be `200` JSON with `user: null`. Protected endpoints
must return structured JSON 401, not HTML or plain text.

Logout must remain POST-only. This signed-out probe must return JSON 405 with
`Allow: POST`; it must not clear state or redirect:

```bash
curl -sS -D /tmp/logout.headers https://anilkaya.org/auth/logout \
  -o /tmp/logout.json
python3 -m json.tool /tmp/logout.json
grep -i '^allow: POST' /tmp/logout.headers
```

Authenticated progress/stats mutations and logout are bound to the exact
verified account with `X-IEWT-Owner`; progress/stats PUTs additionally carry
the last server-issued `X-IEWT-Generation`. Conflicting `Origin` or
`Sec-Fetch-Site` metadata is rejected, and the Worker grants no cross-origin
browser access. Do not attempt a production mutation smoke test with copied
session cookies; verify these paths through the signed-in UI and the local
Worker regression suite.

### Canonical course metadata

```bash
curl -fsSI 'https://anilkaya.org/lab/course?m=ols'
curl -fsS 'https://anilkaya.org/lab/ordinary-least-squares/' \
  -o /tmp/course.html
grep -F '<title>Ordinary Least Squares — Econometrics Lab</title>' /tmp/course.html
grep -F 'https://anilkaya.org/lab/ordinary-least-squares/' /tmp/course.html
grep -F '<h1>Ordinary Least Squares</h1>' /tmp/course.html
grep -F 'id="courseStructuredData"' /tmp/course.html
```

The legacy URL must return 308 to the clean course path. Repeat metadata and
crawlable-outline checks for all seven course paths when SEO code changes.

### Cache and encoding invariant

```bash
ASSET_VERSION="$(tr -d '[:space:]' < assets/version.txt)"
case "$ASSET_VERSION" in (*[!0-9]*|'') echo "invalid assets/version.txt" >&2; exit 1;; esac

curl --compressed --fail --silent --show-error \
  -D /tmp/css.headers \
  "https://anilkaya.org/assets/css/base.css?v=${ASSET_VERSION}" \
  -o /tmp/base.css
cmp /tmp/base.css assets/css/base.css
grep -i '^cache-control: public, max-age=31536000, immutable' /tmp/css.headers

curl -fsSI https://anilkaya.org/ | grep -i '^cache-control: no-cache'
```

Any byte mismatch or decoding error is a release blocker. Do not “fix” it by
rebuilding an asset response from a plain init dictionary; the finalizer must
retain `new Response(response.body, response)`.

### Domain behavior

```bash
curl -fsSI https://anilkaya.org/
curl -fsSI https://www.anilkaya.org/
```

Confirm the intended apex and `www` ownership rather than assuming DNS or Pages
state from repository files.

## 8. Manual functional checks

1. Open `/lab/` signed out. Verify the dashboard, four learning paths,
   search/level/status filters, static course links, and responsive layout.
2. Add anonymous progress, use **Reset progress**, and verify lessons, points,
   and streak clear while the course guide width remains unchanged.
3. Sign in with Google and confirm the callback returns to the Lab with the
   correct account and never exposes another local account's progress.
4. Complete one read, code, interactive, and authored-question stage. In the
   network panel, confirm the course page fetched only its selected
   `/assets/data/courses/<topic>.json` payload, not the combined curricula.
5. Reload and verify no duplicate points. Open another browser/device, sign in,
   and confirm progress unions rather than replacing either device's completed
   stages.
6. Use the signed-in reset. Confirm the UI cannot be dismissed while the
   request is pending, waits for server success, and leaves both local and
   remote progress/stats empty afterward while another test account is
   unchanged. A simulated or real server failure must leave local data intact.
7. Sign out through the UI and confirm it issues the owner-bound POST before
   switching to the anonymous scope; a direct GET must not sign the user out.
8. Verify a broken streak can reset on a newer date. Capture the generation
   before reset and confirm a delayed PUT using it receives `409 reset_required`
   and cannot restore progress or streak state.
9. Inspect D1 rows for the test account; do not expose email/session values in
   logs or screenshots.

## 9. Rollback

List versions and roll back to the last verified version:

```bash
./tests/node_modules/.bin/wrangler versions list
./tests/node_modules/.bin/wrangler rollback <VERIFIED_VERSION_ID>
```

After rollback, rerun the API, course metadata, cache, encoding, auth, and D1
smoke tests. A code rollback does not automatically undo D1 data migrations or
dashboard Transform Rules; treat those as separate rollback items.

---

## 10. Flows section (credential-gated options-flow board)

The Flows section is deliberately isolated from the learning platform. It has
its own cookie, its own audience claim, its own D1 tables, and its own secrets.
Nothing about it can grant access to `/api/*`, and nothing about the Google
OAuth path can grant access to `/flows/`.

### 10.1 Apply the schema

```bash
./tests/node_modules/.bin/wrangler d1 execute iewt --remote --file=./migrations/0005_flows.sql
```

`d1 execute --file` is used deliberately rather than `d1 migrations apply`,
even though `migrations_dir` is configured. `migrations apply` runs everything
the bookkeeping table does not already record as applied, and the earlier
migrations on this database were applied out of band — so it would attempt to
re-run them. Every statement in `0005_flows.sql` is `CREATE TABLE IF NOT
EXISTS`, which makes applying it by hand idempotent and safe to repeat.

The consequence is that D1's migration bookkeeping stays out of date, and
anyone who later runs `migrations apply` will hit that. `worker.js` compensates
with `ensureFlowsTables()`, which creates both tables on first use and swallows
the error if it cannot — because a Worker that refuses every request over a
missing table is worse than one that reports an empty board.

Confirm both tables exist before deploying the Worker, or every board request
falls back to the "pending" empty state and every failed login silently skips
throttling:

```bash
./tests/node_modules/.bin/wrangler d1 execute iewt --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'flows_%';"
```

### 10.2 Set the four secrets

`SESSION_SECRET` is already set and is shared with the learning session — the
audience claim, not the secret, is what separates the two.

Four secrets are needed, and **one of them must be set in two places with the
same value**: `FLOWS_INGEST_TOKEN` authenticates the pipeline to the Worker, so
the Worker needs it as a secret and GitHub Actions needs it as a repository
secret. If the two differ, every publish returns 401, the job exits non-zero,
and the board silently keeps yesterday's data.

```bash
# 1. Generate the three values. All three are printed ONCE; keep the terminal
#    open until they are pasted, because none can be recovered afterwards.
PEPPER=$(openssl rand -base64 48)
INGEST_TOKEN=$(openssl rand -hex 32)

# 2. Choose the shared password. `read -s` keeps it off the screen and, because
#    it is not a command argument, out of shell history and out of `ps`.
read -rsp 'Flows password for all 11 accounts: ' SHARED_PASSWORD; echo

# 3. Derive the per-user hash map. The generator reads BOTH values from stdin,
#    never from argv, for the same reason.
printf '%s\n%s\n' "$SHARED_PASSWORD" "$PEPPER" \
  | node scripts/generate-flows-credentials.mjs

# 4. Print the pepper and the ingest token so they can be pasted below.
printf 'FLOWS_PEPPER:       %s\nFLOWS_INGEST_TOKEN: %s\n' "$PEPPER" "$INGEST_TOKEN"
```

Now set them. Each command prompts for the value; paste the matching line from
above, and paste the JSON the generator printed for `FLOWS_CREDENTIALS`.

```bash
./tests/node_modules/.bin/wrangler secret put FLOWS_PEPPER
./tests/node_modules/.bin/wrangler secret put FLOWS_CREDENTIALS
./tests/node_modules/.bin/wrangler secret put FLOWS_INGEST_TOKEN
```

**Adding a secret does not deploy it.** The dashboard stores it as a new Worker
version and leaves that version undeployed, so the running Worker keeps serving
the previous one and every route behaves exactly as if the secret were never
set — `/flows/login` answers `503 "Sign-in is not configured"` and
`/api/flows/ingest` answers the same. Nothing in the UI flags this. After adding
all three, go to **Deployments** and promote the new version to 100%, or run
`wrangler deploy`.

Two checks that distinguish "deployed" from "stored but dormant", both from any
terminal and neither revealing a value:

```bash
# 401, not 503, means FLOWS_INGEST_TOKEN is live on the running Worker.
curl -s https://anilkaya.org/api/flows/ingest

# The login form rendering is not evidence; submitting it is. A 503 here means
# FLOWS_PEPPER or FLOWS_CREDENTIALS is stored but not deployed.
```

Then clear the variables from the live shell, since three of them are still in
memory:

```bash
unset PEPPER INGEST_TOKEN SHARED_PASSWORD
```

**The repository is public.** None of these values may ever be committed,
echoed into CI logs, or pasted into an issue.

#### `FLOWS_SESSION_EPOCH` is a plain var, not a secret

It is not sensitive — it is a counter whose only job is to invalidate
outstanding sessions — and `sessionEpoch()` reads it from `env` like any other
binding. Setting it with `wrangler secret put` also works, because secrets and
vars arrive on the same `env` object, but the runbook and the code should agree
on one place. Put it in `wrangler.toml` under `[vars]`:

```toml
[vars]
FLOWS_SESSION_EPOCH = "1"
```

Leaving it unset is safe: it defaults to `"1"`, which is a valid stable epoch
rather than an undefined-versus-undefined comparison that would accept
anything.

### Rotating and revoking

These are two different operations and only one of them signs anyone out.

| Goal | Action | Effect on live sessions |
|---|---|---|
| Change the password | Regenerate `FLOWS_CREDENTIALS` with the same pepper | **None** — everyone stays signed in |
| Revoke every session | Increment `FLOWS_SESSION_EPOCH` in `[vars]` and redeploy | All sessions invalid immediately |

Rotating `FLOWS_PEPPER` does **not** sign anyone out. The pepper is used for
credential derivation only and never touches session verification, so an
already-issued token keeps working for its full 14-day life. Changing the
password without bumping the epoch means a departing user's existing cookie
still opens the board for up to two weeks — bump the epoch as well.

### 10.2b Deploy

Sections 10.1 and 10.2 change the database and the secret store; neither
reaches the running Worker until it is deployed. If Workers Builds owns
deployment (section 5), pushing to the default branch is enough and the build
must be observed to succeed before continuing. Otherwise:

```bash
./tests/node_modules/.bin/wrangler deploy
```

### 10.3 Verify the gate before announcing it

```bash
BASE=https://anilkaya.org

# The login page is public and noindex; the board is not reachable without a session.
curl -s "$BASE/flows/" | grep -c 'name="robots" content="noindex'      # expect 1
curl -s "$BASE/flows/" | grep -c 'flowsBody'                            # expect 0

# The JSON surface refuses anonymous callers with the project error envelope.
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/flows/board"        # expect 401
# -I sends HEAD, which this GET-only route answers 405 — use -D- with -o
# /dev/null to read headers from a real GET.
curl -s -D- -o /dev/null "$BASE/api/flows/board" | grep -i '^cache-control'   # expect no-store

# Gated documents must not be storable by a shared cache.
curl -s -D- -o /dev/null "$BASE/flows/" | grep -i '^cache-control'      # expect no-store

# THE BYPASS CHECKS. The gated HTML lives in shared/flows-pages.js and `flows/`
# is in .assetsignore, so there is no file in the bundle for a mangled path to
# reach. Each of these must fail to return board markup.
for p in '/%66lows/index.html' '//flows/index.html' '/FLOWS/index.html' '/flows/index.html'; do
  printf '%s -> %s\n' "$p" "$(curl -s "$BASE$p" | grep -c 'flowsBody')"   # expect 0 for each
done

# Sign-in is POST-only.
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/flows/login"            # expect 405
```

### 10.4 Confirm the learning platform is unaffected

The audience claim is new. Sessions issued before it exists carry no `aud` at
all and are still accepted, so **no signed-in learner is logged out** by this
deployment. Verify with a real signed-in browser session:

```bash
curl -s -H "Cookie: session=<existing token>" "$BASE/api/me"   # expect the user, not null
```

If this returns `null` for a session that worked before the deploy, stop and
roll back — the legacy allowance in `isLearnAudience()` has regressed.

### 10.4b What the store holds, and what prunes it

`flows_payload` is a keyed blob store. Every key it accepts:

| Key | Written | Read by | Lifetime |
|---|---|---|---|
| `board:long`, `board:short` | each run, then again after the chain leg | `/api/flows/board?side=` | overwritten daily |
| `board:watch` | each run | `/api/flows/board?side=watch` | overwritten daily |
| `board:<side>:YYYY-MM-DD` | each run, then again after the chain leg | the pipeline's scorer | 126 days, then swept |
| `record` | each run (the scorer, step 7c') | `/api/flows/record` | overwritten |
| `card:<TICKER>` | each run, best effort | `/api/flows/card?t=` | overwritten |
| `meta` | each run | diagnostics | overwritten |

THE DATED BOARDS ARE WHY A TRACK RECORD EXISTS AT ALL. Until they did, every
morning's `board:long` overwrote the previous one, so by the time any forward
return existed there was no surviving record of what had been claimed — which
is how this product asserted a hit rate in its own footer for months while
being structurally incapable of measuring one.

Retention is 126 calendar days (~90 trading sessions, nine times the 10-session
forecast horizon). Steady state is about 180 rows and +2 row writes per run,
against a 100,000/day budget **shared with the live learning app**.

The prune is a `DELETE` on the ingest route, and that route accepts DELETE for
**dated boards only**. That is a blast-radius limit rather than a privilege
one: the same bearer can already overwrite the live board, but a sweep with an
off-by-one in its date arithmetic that could name `board:long` would take the
section down in a way that reads as "the pipeline has never run". A miss
answers 404 and is an ordinary empty day — the sweep names a fixed skirt of
dates past the edge so a month of downtime self-heals, and in steady state
almost every name it tries was never written.

Eighty overlapping cohorts give a standard error near 5.6 points on a hit rate
around one half. A 51–52% claim is therefore **not separable from a coin** at
any window this free tier can hold. The archive makes the claim measurable; it
does not ratify it, and the track-record page says so.

**THE SCORER READS THE ARCHIVE BACK, AND THAT READ HAS A BUDGET.** Step 7c'
walks the retention window newest-first and `GET`s each dated key through the
ingest route: at steady state ~180 sequential reads per run (126 calendar days
× 5/7 weekdays × 2 sides), once daily, against the same 100,000/day row budget
shared with the learning app. It is worker reads only — no vendor call — so it
sits outside the 30-minute deadline calculus, and it runs after today's boards,
archive, watch list and movers are all committed, so a failure inside it can
cost only the record.

If that read count ever becomes the binding constraint, the escape hatch is
additive and needs no schema change: cache each session's already-scored row
inside the `record` blob itself and fetch only the dates not yet scored, which
turns the steady state into ~2 reads per run.

### 10.5 The data pipeline

Compute runs in GitHub Actions, never on Cloudflare: the Workers free plan
allows 10 ms of CPU per invocation including cron, and the daily job makes
hundreds of Unusual Whales calls. The Worker only verifies a cookie and hands
back a stored string.

#### 10.5a Which names the board sees, and why that is a correctness surface

On 2026-08-26 the live board published **eleven names**. Every stage that
produced that number was defensible on its own:

```
 264 screened -> 205 eligible -> 190 past the earnings gate
->  60 enriched ->  23 clear the liquidity floor ->  11 published
```

Two stages were the cause, and neither was the board size.

**The screener cap.** `/api/screener/stocks` returns at most ~50 rows and
accepts no `limit`, `page` or `offset`. The band ladder IS the pagination, so
its length is the ceiling on how much of the market can be seen at all — six
bands capped the entire investable universe at 300 names before one filter ran.
Worse, the first band (`$1-3B`, a 3x span) was saturated at 50 on every run, so
the small-cap end was truncated **silently**: the log prints what each band
returned, and a truncated band returns exactly the same 50 as a complete one.
It is now a generated geometric ladder of 32 bands at ratio 1.3, with equal
ratio rather than equal width because listed companies are roughly log-uniform
in market cap — equal ratio spreads the cap's pressure evenly instead of
saturating the bottom and wasting the top. **Bands that return a full page are
now counted and reported as `CAP`**; that line is the only evidence of
truncation there has ever been.

**The enrichment pool, which is the subtler one.** Enrichment costs five calls
a name, so the pool was 60 — thirty per side of a rough composite of the very
screener columns family F is built from. That is a selection on the
measurement. The score is a residual against the cross-sectional spread of the
pool it is computed over; when the pool IS the tails of that signal, the spread
is the selection's rather than the market's, and every z-score on the board
inherits it. A pool chosen for extreme tilt makes tilt look ordinary.

The pool is now a **stated universe**: the largest `UNIVERSE.enrichCount` (100)
names in the gated screen, plus any Nasdaq-100 member the screen returned.
Market cap is the selection axis because it is on the screener row already, is
stable session to session, and — the property that does the work — **is
independent of the option flow being scored**, so selecting on it cannot bias
the cross-section.

Nasdaq-100 membership is a dated repository constant (`NDX_AS_OF`), not a
measurement: no endpoint on this key returns index membership. It is used
**additively** — it guarantees inclusion and never excludes — so the failure
mode of letting the list rot is a slightly different hundred names at the cost
of five calls, never a wrong reading. Guarantee-first with a cap would let a
stale list push real large caps off the board, which is the one way a dated
constant could produce a wrong number; `tests/flows-universe-contract.mjs`
asserts the order.

**The board widened for free; the expensive legs did not.** The board is built
from data already fetched, so publishing 93 rows instead of 11 costs nothing. A
chain is one call a name and a card is two, so those legs are capped at
`DEEP_NAMES` (50) and ranked by |score| **across both sides** — neutrality has
no side, and taking the head of each board would spend the same calls on a +4
long while skipping a −40 short. Rows that got the deep treatment carry `dp`,
and the renderer will not advertise a card for a row without it.

Three consequences that are easy to get wrong and are each pinned by a test:

- **Every row carries the four chain columns, declared `null`.** They used to
  be appended by the re-publish, which skipped rows with no chain — harmless
  while every board row was deep. At 93 rows, 43 would ship without their last
  four keys, and **the board table binds columns positionally**.
- **A board written before `deep` existed keeps every card clickable.** Assets
  deploy when `main` moves; the pipeline runs the next morning. A renderer that
  read "no `dp`" as "no card" would dark the entire card reader for a day. The
  test is on the *payload* (`deep` is a published count), not on the row.
- **The record partitions on `SELECTION_EPOCH`.** The pool changed, so the same
  score integer means something different on either side of that date.
  `scoreSessions` reports the two populations separately rather than averaging
  them into one hit rate. It does **not** bump `BOARD_SCHEMA_VERSION` — that
  would zero 126 days of retained archive to say a sentence that fits in a
  footnote.

**The dead band moved 20 -> 1.** Twenty was calibrated against a pool of sixty
tilt-extremes, where a score of 20 was ordinary. Against a stated size cohort
it swallows the middle of the market: on the first dry run of the expanded
pool, **71 of 100 names fell inside it**. Widening the universe and keeping the
band would have answered "show me more names" by measuring more names and
showing the same few. One rather than zero, so a score of exactly 0 — a real
outcome — has an unambiguous home on the watch board.

The call count is derived, not estimated:

```
  1  screener call, x6 market-cap bands (the endpoint caps at ~50 rows
     and takes no page or offset, so the universe is walked by band) =  6
     -- which puts the LIVE universe at <=300 names, not the 420 the
     dry-run fixture carries. Anything sized against 420 is sized
     against a fixture.
+ 3  dating probe (AAPL, dated and undated, plus candles)            =  3
+ 1  SPY candles, to resolve the session date                        =  1
+ 5  per enriched name x 2 sides x enrichPerSide (30)                = 300
+ 3  per board name (max-pain, congress, gamma surface)
        x boardSize (25) x 2                                         = 150
+ 11 sector ETF candles, one per SPDR sector (XLB XLC XLE XLF XLI XLK
     XLP XLRE XLU XLV XLY), for the sector momentum panel          =  11
+ 50 option chains, one per board name (25 x 2 sides), for the
     implied volatility surface, the skew and term scalars, the
     day's most-traded contracts and the aggressor ladder        =  50
+ 2  reads of the live board, for hysteresis (Worker, not vendor)
                                                                     = 521, plus retries
```

THE CHAIN LEG IS THE LAST VENDOR SPEND AND THE FIRST THING DROPPED. It runs
after both boards, the dated archive, the watch list, the movers band, the
record and the sector panel are all committed, so a slow morning costs the
reader four card panels and a gappy history column rather than a session.
Two guards, not one: the leg refuses to start past the 30-minute deadline, and
it stops partway if it comes within six minutes of it, because a run that
spends its last four minutes on chains and then publishes no cards has traded
a panel for a page.

It does NOT pass `maybe_otm_only`. The premium desk does, because it is pricing
a sale; this leg is measuring a surface, and the at-the-money contract — the
single most load-bearing input in the grid, since every skew cell in a column
is measured against it — is exactly what that filter removes.

**THAT DECISION HAS A PRICE AND THE PRICE IS PAID EXPLICITLY.** Without the
filter the vendor returns a put AND a call at every strike, which ties on every
field the downstream tiebreaks compare — so the surface flipped on vendor row
order and the skew published a confident zero. `preferOutOfTheMoney` in
`shared/flows-chain.js` resolves each strike to one contract before anything
measures: the put below spot, the call above, freshness at the money. What it
resolved is published as `strikeCollisions` rather than applied silently.

**A TRUNCATED CHAIN PUBLISHES NO SCALARS.** Every relation begins "on the
nearest expiry" and "the nearest listed strike", and the endpoint documents no
ordering parameter — so a chain that filled the 500-row page is an arbitrary
subset in which "nearest" cannot be identified. The panels still publish, with
their coverage stated; `skew`, `term` and `atmIv` are withheld with that reason,
because they go onto a board row and into an archive where nothing carries the
caveat.

**AND ON THE FIRST LIVE MORNING THAT REFUSAL FIRED ON TEN NAMES OF ELEVEN.**
It was designed as the edge case for the largest names; it is the common case.
Only PCG, small enough to fit one page, produced a skew and an at-the-money
level. The leg is currently spending a call per name to publish scalars for
one name in eleven — the panels are unaffected, and no renderer draws them yet,
so nothing a reader sees is wrong; the history simply is not accumulating.

Resolving it turns on one fact this repository does not have: whether
`/option-contracts` accepts a filter narrowing the response to a single expiry.
If it does, asking for the nearest expiry by name identifies "nearest" by
construction at one call. If it does not, the fallback is `page`, which the
premium desk already uses on this endpoint, at several calls a name. The vendor's
documentation has been wrong about this API five times, so the pipeline does not
guess: it spends ONE call per run, on the first name that truncates, and prints
what came back. **Read `chain probe (TICKER, expiry=…)` in the Actions log.** It
reports one of three verdicts, and they are deliberately not collapsible:

| Log line | Meaning | Next step |
|---|---|---|
| `FILTER WORKS` | only the requested expiry came back, under the cap | drop the truncation refusal for scalars read off it |
| `FILTER WORKS but this single expiry still fills the page` | narrowing helped, the strike set is still a subset | narrow further before trusting "nearest listed strike" |
| `FILTER IGNORED` | several expiries came back for a single-expiry request | fall back to `page` pagination |
| `returned NOTHING` | accepted and empty | neither of the above — do not read it as either |

**THE SCALARS ARE ARCHIVED BUT NOT POOLED.** Each is read at that name's own
nearest listed expiry past a floor — eight days out on SPY, ninety on a thin
name — so they are excluded from the cross-sectional IC table for the reason
`boardRow` already states about `im`. `skewDays` rides the row so the tenor is
recoverable. A name against its own history is like-for-like, and that
percentile is what they exist for.

The boards are then RE-PUBLISHED with `skew`, `term` and `atmIv` merged onto
their rows, dated key first and live second, per side. The second write exists
because the fields cannot be there the first time: boards must publish before
fifty calls are spent, but the scalars have to reach the DATED row or their
history never accumulates. At final state the two copies are byte-identical.

VENDOR CALLS ONLY. Two legs read the Worker's own store rather than the
vendor: the 2 hysteresis reads above, and the track-record scorer's ~180
archive reads (§10.4b). Neither touches the Unusual Whales quota or the
rate limiter, and neither is counted in the 521. The re-publish adds 4 more
Worker writes (2 sides x dated + live). The truncation probe adds at most 1.

### 10.5b The rate limiter, and the number to watch

Unusual Whales documents no rate limit anywhere — not in the OpenAPI spec, not
in the docs — so the limiter discovers it. The last line of every run is the
measurement:

```
done in 178.2s — 408 API calls, 0 retries, 43 rate-limited,
achieved 2.29 req/s (final inter-call delay 60ms, learned floor 240ms)
```

**`learned floor` is the finding, not `final inter-call delay`.** The delay is
wherever the last decay left it; the floor is what the run concluded about this
key's tier. If it settles at the same value across several mornings, that value
belongs in `RATE.startDelayMs` — at which point the run stops paying for the
same discovery every day.

The controller is AIMD: ×2 on a 429 and ×0.9 on a clean response, with the
floor rising 1.5× per 429 and never falling within a run. A 5xx or a transport
failure backs off but teaches the floor NOTHING — a server error is not a rate
limit, and 5xx storms are when the run can least afford a permanent slowdown.

The floor's ceiling (750 ms) is deliberately far below the per-call backoff
ceiling (5 s). One call may sleep five seconds; every call may not, because
`CALL_BUDGET × 5s` is 79 minutes against the 36-minute deadline — a run that
publishes nothing at all, which is strictly worse than being rate-limited.
`rateFloorSurvivesBudget()` asserts the relation and the contract test holds it
from both sides, so raising the ceiling without raising the deadline fails the
build rather than the morning.

> This is a fix, not a description of how it always worked. Until 2026-08-26
> the 429 branch carried the comment "raise the floor permanently" over code
> that raised only the current delay, while the decay clamped to an immutable
> 60 ms — so six clean responses undid every lesson. The live run that morning
> made 408 calls, was rate-limited on 43 of them, and finished at exactly
> 60 ms: a controller that observed 43 refusals and concluded nothing. Each 429
> also consumes one of four retry attempts, so a sustained regime does not just
> waste calls, it fails names.

THE SECTOR LEG IS ELEVEN CALLS BECAUSE IT IS ONE PER SECTOR. That is the
whole reason a top-down layer is affordable here: every other reading on this
site costs one call per NAME, so a single extra leg on the board costs fifty.
They are issued SEQUENTIALLY rather than as a Promise.all — eleven concurrent
calls all sleep the same delay and then arrive together, which is precisely
the burst shape that earns a 429 and permanently raises the floor for the rest
of the run. They are spent after the boards and the watch list commit and
before the cards, and skipped entirely past the 30-minute deadline: a stale
sector panel with a visibly older timestamp beats overwriting a good one with
eleven nulls.

The day's movers cost NOTHING. The screener rows the pipeline already fetches
carry close, prev_close, relative_volume and both premium legs for the whole
eligible universe, and until now the pipeline read them for twenty-five board
rows and discarded the rest.

This figure was 403 until the gamma-surface leg landed and 471 until the chain leg did, and this runbook still
said "2 per board name" for weeks after it became 3 — an understatement of up
to 50 calls in the one number the rate-limit sizing depends on. The last live
run made 367 calls in 122s with 36 rate-limited.

THE BINDING CONSTRAINT IS NOT A QUOTA. The vendor documents no rate limit
anywhere, so the limiter is adaptive: 120 ms between calls, doubling on any 429
and decaying back by 10% on clean responses, with a floor that a 429
permanently raises. That is what makes the call count matter — at the 5 s
ceiling the 30-minute card deadline allows only ~360 calls, fewer than a
healthy run makes, and the boards publish before the cards precisely so that a
degraded run loses the decorative half rather than the product.

Earlier revisions of this runbook claimed 600–800, which is well above
the real figure. That matters because it is the number the rate-limit sizing
below is done against: an operator reading "301 API calls" in the log against a
runbook promising 600–800 would reasonably conclude the job had silently
dropped half its work.

Repository secrets required (Settings → Secrets and variables → Actions):

| Secret | Required | Purpose |
|---|---|---|
| `UW_API_KEY` | yes | Unusual Whales API bearer token |
| `FLOWS_INGEST_TOKEN` | yes | Bearer token authenticating the POST. Must be **byte-identical** to the Worker secret of the same name. |
| `FLOWS_INGEST_URL` | no | Overrides the ingest endpoint. Defaults to `https://anilkaya.org/api/flows/ingest`; set it only for a staging Worker. |

The URL is not a secret — the bearer token is what protects the route — and
requiring it added a step whose failure mode looks like success: the pipeline
runs, every publish 401s or redirects, and the board silently keeps yesterday's
data. It now defaults to production.

A run missing either required secret names **all** of them at once and exits
before spending a single API call.

GitHub is deliberately given **no Cloudflare API token**: Cloudflare's `KV: Edit`
and `D1: Edit` permissions are account-scoped, so a CI credential could reach the
live `iewt` learning database. The pipeline posts to the Worker instead.

Two failure modes to watch:

- **Scheduled workflows are disabled after 60 days** of repository inactivity.
  This is the most likely way the board silently goes stale. Check the Actions
  tab if `generatedAt` stops advancing.
- **Unusual Whales publishes no rate limits.** The pipeline discovers the real
  limit empirically with adaptive backoff and logs the achieved rate. Read that
  number after the first few runs and size the universe against it.

A run that cannot complete its enrichment publishes **nothing** and exits
non-zero, by design: a partially ingested day must never quietly produce a
ranking that looks complete.

### 10.5c The deadline, and why it is 36 minutes

`DEADLINE_MS` was 30 minutes until 2026-08-26 and it was BINDING — on the
wrong leg, which is why nothing looked wrong.

The 18:04 run finished the whole pipeline in 1502 s (25.0 min), five minutes
inside a 30-minute budget. But the chain leg's own cut-off is
`DEADLINE_MS − CHAIN_RESERVE_MS` = 24 minutes, and enrichment alone had spent
22.4 of them:

```
chains: stopping after 34 names — within 6min of the deadline and the cards still need it
chains: 34 built, 0 failed, 16 skipped for the deadline; 33 levelled, 27 with a skew reading
```

Sixteen names lost their chain panels and the board's skew reading fell from
46 of 50 to 27. **A constant produced that regression**, not the vendor.

The two levers are not equivalent. Cutting `UNIVERSE.enrichCount` buys the
time back by shrinking the board, which is the opposite of what the board is
for. Raising the budget costs wall-clock on a runner that is idle anyway. At
36 minutes the chain leg runs until minute 30 and 9 minutes of headroom remain
under the runner's 45-minute kill — more slack than the entire chain leg
consumes.

**The cost centre is enrichment, not this constant.** 128 names at ~7.4 calls
each are 950 of the run's 1022 attempts, and the limiter is already saturated
against them: 170 of those came back 429 while the learned floor sat pinned at
its 750 ms ceiling for the whole run. The controller asked to go slower and the
ceiling refused. **Do not raise that ceiling on intuition** — a 429 costs a
`Retry-After` wait, so a higher floor trades a certain per-call tax against an
uncertain saving, and no run has ever been instrumented to say which is
larger. Measure the 429 wait first.

If enrichment keeps growing, the next thing to bind will be `DEADLINE_MS`
again, and the line to watch is the one naming skipped names:

```
chains: N built, M failed, K skipped for the deadline
```

`K > 0` on a normal morning means the budget is binding again.

### 10.5d The unusual-activity feed, and the two refusals it is built on

`/flows/unusual/` costs **zero vendor calls**. Every contract row is built
inside `buildChainPanels`, from the option chain the pipeline already buys for
each board name; the name panel is built from screener rows already in memory.

It is built there rather than by the caller for three reasons, each a
correctness requirement:

- `conv.divisor`, the implied-volatility convention decided once from that
  chain's own median, is a local and is not on the returned object;
- `rows` is ROOT-FILTERED, and the notional bracket multiplies by
  `SHARES_PER_CONTRACT` — legal only after an adjusted series (an `AAPL1`
  beside an `AAPL`, deliverable on something other than 100 shares) is gone;
- `truncated` marks a chain the vendor returned a full page for, and it has to
  ride per row because the feed mixes names.

**Two refusals govern everything the page may say.**

1. **The unit.** `/option-contracts` returns a contract AGGREGATE — one row per
   listed strike with a volume total. No size, no timestamp, no execution
   price, no sweep flag. So the page may never say print, trade, block, sweep,
   order, bought, sold or paid. `tests/flows-worker-contract.mjs` greps the
   served markup for those words; the page controller's own suite greps the
   rendered DOM.

2. **The date, and this is the load-bearing one.** The endpoint accepts no date
   parameter and returns no as-of stamp, and the pipeline runs at 05:15
   America/New_York — **four and a quarter hours before the opening bell**, so
   at read time today has not happened. The counter's span is unobserved. The
   payload publishes `readAt` and an explicit `volumeAsOf: null` with the
   reason beside it, and the page may never say "today", "this session" or
   "the day's". Attaching `sessionDate` to the counter would make a free
   parameter out of the page's most important quantity.

   `sessionDate` is legal in exactly one place — `dte` — and is published as
   `dteAnchor: "sessionDate"` so a reader can see the horizon is measured from
   the last completed session rather than from the counter's unknown date.

**Two diagnostics ride along, and both are written not to overclaim.**

`oi basis:` reports whether any contract's open-interest change exceeded its
own volume. Open interest cannot move further across one settlement than the
volume traded between them, so finding one FALSIFIES the pair and the counter
being aligned in time. **Finding none proves nothing** — it is equally
consistent with an intraday denominator, an aligned pair, and a quiet stretch —
and the zero branch says INCONCLUSIVE in those words.

`flow-alerts:` is one bounded call per run whose entire output is a log line.
The pipeline has asserted in two places for months that the per-trade
flow-alerts endpoint is unreachable on this key, with no status code behind it.
The probe records what it actually answers. It deliberately does **not** use
`uw()` — `uw()` coerces an unrecognised body to `[]`, so a vendor envelope this
repo has never seen would read as a refusal — and it does **not** retry, which
makes 429 one of the ten outcomes. A 429 is reported as THROTTLED and
explicitly not as a refusal: writing "refused" because the probe was throttled
would give a months-old assertion false provenance, which is worse than having
none.

Watch for, on the first live run:

```
flow-alerts: REACHABLE — ...      → the assertion is WRONG; the per-trade feed is buildable
flow-alerts: 401/403 ...          → the assertion is right and finally has evidence
flow-alerts: 429 ...              → still unanswered; do not touch the assertion
flow-alerts: 404 ...              → the PATH is a guess; try /api/stock/{t}/flow-alerts
```

### 10.5e The events calendar, and the two clocks that do not share an origin

`/flows/events/` costs **zero vendor calls** — the second such surface after
the movers band. Every field is a screener field the run already holds:
`screenerTilt()` is computed for every eligible name and then thrown away for
all but the enriched, and `next_earnings_date` is read once to filter and
never published.

**The page exists for one column.** The earnings gate removes every name
reporting inside `EARNINGS_GATE_DAYS` before the composite is built, and it is
right to: the score is a PREDICTIVE ranking, and a name with a scheduled
binary event is not being priced by the process that ranking models. But those
names are, by construction, the most event-exposed in the universe — 40 of 420
in the dry run — and until this page existed they reached the reader as a
single integer in a log line. `st: "gated"` says the board was FORBIDDEN from
holding an opinion, which is a different fact from the board having found
nothing.

#### THE TWO CLOCKS — the thing to get right

`sessionDate` and the earnings gate **do not share an origin**, and mixing
them draws a window that is silently one to three days early.

| Quantity | Origin | Why |
|---|---|---|
| every **price** (`px`) | `sessionDate` | the last COMPLETED session |
| every **day count** (`sdte`, day 0, the gate band) | `gateOrigin` | `easternNow().date` — the run's own Eastern date, which is what `daysToEarnings(row, Date.now())` counted from |

`resolveSessionDate()` returns the last session that has closed; at 05:15
America/New_York that is always the previous trading day — yesterday on a
normal morning, **Friday on a Monday**. In the dry-run payload the two are
`2026-08-24` and `2026-08-26`, two days apart.

A page that counted `sdte` from `sessionDate` would classify every name
against a gate that never ran — and, worse, **a fixture built the same way
would agree with it perfectly**. Both dates are published, and which quantity
uses which is stated in the payload's own prose.

`EARNINGS_GATE_DAYS` is now a named export for the same reason. It was a bare
`12` inside the gate's own filter, which was fine while the gate was the only
thing that knew it; two surfaces reading one rule, one by literal and one by
reference, is how they come to disagree about names sitting exactly on the
boundary.

#### What is refused, and what is published instead

- **The announce time** (before open / after close) is not on the screener.
  The endpoints that carry it are scoped to a single date, so covering a
  21-day window costs **44 calls** — a 12% increase on the run for one column.
  `announce.status` is `"unavailable"` with the reason published, and every
  `when` is `null`. A column populated for the first fortnight and blank after
  invites the wrong inference about everything in the blank half.
- **Sessions are counted as weekdays, holidays not removed**, and the payload
  says so. This desk holds no holiday calendar and inventing one would be a
  free parameter; a count right to within about one session a quarter is
  honest, one that assumes an unpublished calendar is not.
- **The priced move is a price, not a forecast.** `horizonMove` scales the
  name's 30-day implied volatility by the square root of sessions — no rate,
  no dividend, no distribution. It is what the option market is CHARGING for
  the stretch before the report.
- **The vendor's own implied move is quoted to a different horizon** and is
  published beside it without being reconciled into it. An average of two
  numbers quoted to two horizons is quoted to neither.
- **Realized volatility is enriched-only**, so most rows withhold it. The
  count that carry one is published beside the column rather than left to be
  inferred from the em dashes.

The log line to read:

```
events: 60 of 62 names reporting within 21 days, of 420 screened
  (358 carry no earnings date); 40 of them the board was gated out of,
  57 with a priced move, 2 with realized vol
```

`60 of 62` bounded by the row cap is ordinary. **`0 of 0` with a large
`universe` is not** — it would mean `next_earnings_date` stopped arriving on
the screener, and the page would render an empty calendar rather than an
error.

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
| `board:long`, `board:short` | each run | `/api/flows/board?side=` | overwritten daily |
| `board:watch` | each run | `/api/flows/board?side=watch` | overwritten daily |
| `board:<side>:YYYY-MM-DD` | each run | the pipeline's scorer | 126 days, then swept |
| `record` | each run, once scoring is possible | `/api/flows/record` | overwritten |
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

### 10.5 The data pipeline

Compute runs in GitHub Actions, never on Cloudflare: the Workers free plan
allows 10 ms of CPU per invocation including cron, and the daily job makes
hundreds of Unusual Whales calls. The Worker only verifies a cookie and hands
back a stored string.

The call count is derived, not estimated:

```
  1  screener call, x6 market-cap bands (the endpoint caps at ~50 rows
     and takes no page or offset, so the universe is walked by band) =  6
+ 3  dating probe (AAPL, dated and undated, plus candles)            =  3
+ 1  SPY candles, to resolve the session date                        =  1
+ 5  per enriched name x 2 sides x enrichPerSide (30)                = 300
+ 3  per board name (max-pain, congress, gamma surface)
        x boardSize (25) x 2                                         = 150
+ 2  reads of the live board, for hysteresis (Worker, not vendor)
                                                                     = 460, plus retries
```

This figure was 403 until the gamma-surface leg landed, and this runbook still
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

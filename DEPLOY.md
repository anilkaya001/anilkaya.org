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

Confirm both tables exist before deploying the Worker, or every board request
falls back to the "pending" empty state and every failed login silently skips
throttling:

```bash
./tests/node_modules/.bin/wrangler d1 execute iewt --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'flows_%';"
```

### 10.2 Set the three secrets

`SESSION_SECRET` is already set and is shared with the learning session — the
audience claim, not the secret, is what separates the two.

```bash
# A high-entropy pepper. Generate it once; never commit it, never reuse it
# elsewhere. Folded into every password before derivation, so a leaked
# credential map cannot be attacked offline without it.
openssl rand -base64 48 | ./tests/node_modules/.bin/wrangler secret put FLOWS_PEPPER

# The per-user hash map. Generate locally with the same pepper:
node scripts/generate-flows-credentials.mjs
# then paste its single-line JSON output into:
./tests/node_modules/.bin/wrangler secret put FLOWS_CREDENTIALS
```

**The repository is public.** Neither the pepper nor the credential map may ever
be committed, echoed into CI logs, or pasted into an issue. `generate-flows-credentials.mjs`
writes nothing to disk for exactly this reason.

Rotating the shared password means regenerating `FLOWS_CREDENTIALS` with the
same pepper and re-putting the secret. Every existing session survives, because
sessions are signed tokens rather than password material — force a sign-out by
rotating `FLOWS_PEPPER` as well, which invalidates nothing but stops the old
password working.

### 10.3 Verify the gate before announcing it

```bash
BASE=https://anilkaya.org

# The login page is public and noindex; the board is not reachable without a session.
curl -s "$BASE/flows/" | grep -c 'name="robots" content="noindex'      # expect 1
curl -s "$BASE/flows/" | grep -c 'flowsBody'                            # expect 0

# The JSON surface refuses anonymous callers with the project error envelope.
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/flows/board"        # expect 401
curl -sI "$BASE/api/flows/board" | grep -i '^cache-control'             # expect no-store

# Gated documents must not be storable by a shared cache.
curl -sI "$BASE/flows/" | grep -i '^cache-control'                      # expect no-store

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

### 10.5 The data pipeline

Compute runs in GitHub Actions, never on Cloudflare: the Workers free plan
allows 10 ms of CPU per invocation including cron, and the daily job is 600–800
Unusual Whales calls. The Worker only verifies a cookie and hands back a stored
string.

Repository secrets required (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|---|---|
| `UW_API_KEY` | Unusual Whales API bearer token |
| `FLOWS_INGEST_URL` | The Worker ingest endpoint the pipeline POSTs to |
| `FLOWS_INGEST_TOKEN` | Bearer token authenticating that POST |

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

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

Node.js 22.13 or newer is required by the committed test toolchain.

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
- Durable Object binding: `PULSE` → class `Pulse`, declared by migration `v1`
  (`new_sqlite_classes`); see section 10.5n before the first deploy that carries it
- `run_worker_first = ["/*", "!/assets/*"]`
- `html_handling = "auto-trailing-slash"`
- a root `_headers` file, uploaded with the static bundle and never served,
  carrying the asset-first `/assets/*` policy

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
FONTS_VERSION="$(tr -d '[:space:]' < assets/fonts-version.txt)"
case "$FONTS_VERSION" in (*[!0-9]*|'') echo "invalid assets/fonts-version.txt" >&2; exit 1;; esac

curl --compressed --fail --silent --show-error \
  -D /tmp/css.headers \
  "https://anilkaya.org/assets/css/base.css?v=${ASSET_VERSION}" \
  -o /tmp/base.css
cmp /tmp/base.css assets/css/base.css
grep -i '^cache-control: public, max-age=31536000, immutable' /tmp/css.headers

curl -fsSI https://anilkaya.org/ | grep -i '^cache-control: no-cache'

curl -fsSI "https://anilkaya.org/assets/fonts/Inter-latin.woff2?v=${FONTS_VERSION}" \
  | grep -i '^cache-control: public, max-age=31536000, immutable'
curl -fsSI https://anilkaya.org/assets/fonts-version.txt | grep -i '^cache-control: public, max-age=3600'
```

The woff2 URLs carry `assets/fonts-version.txt`, not `assets/version.txt`
("Asset versioning" in AGENTS.md): an asset bump must leave the font URLs
unchanged, or every returning visitor downloads the fonts again for nothing.
A blanket `?v=` rewrite, or a merge that brings one in, moves them anyway;
before deploying, `grep -rn 'woff2?v=' --include=*.html --include=*.css .`
must show only the fonts token, and `tests/contracts.mjs` must pass and
report sixteen font references at it.

The versioned stylesheet is served asset-first by the edge, without invoking
`worker.js`; its headers come from the root `_headers` file. Check that the
policy reached production, and that no dashboard rule added a CSP to it:

```bash
grep -i '^x-frame-options: DENY' /tmp/css.headers
grep -i '^x-content-type-options: nosniff' /tmp/css.headers
grep -i '^strict-transport-security: max-age=31536000' /tmp/css.headers
! grep -qi '^content-security-policy' /tmp/css.headers
```

The asset layer matches by path, so `/assets/css/base.css` without `?v=`
reports the same immutable policy, and a request for a file that does not
exist under `/assets/` is answered by the asset layer's `404.html` with its
path's policy and no CSP, which under `/assets/css|js|fonts/*` is an
immutable 404 (§9 says why the first deploy after a rollback bumps the
version). Only the responses `worker.js` still serves
(`/`, `/robots.txt`, `/sitemap.xml`, the Worker's 404 page) distinguish
versioned from unversioned URLs and successful from failed status.

Any byte mismatch or decoding error is a release blocker. Do not “fix” it by
rebuilding an asset response from a plain init dictionary; for the responses
`worker.js` still serves, the finalizer must retain
`new Response(response.body, response)`.

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

The first forward deploy after any rollback must increment `assets/version.txt`
(and every CSS/JS `?v=` reference, as in "Asset versioning" in AGENTS.md)
before it ships, even when no browser asset changed; when the rolled-back
version lacked a font the newer HTML asked for, it must also raise
`assets/fonts-version.txt` (and every woff2 `?v=`), because the font URLs
carry that token and an asset bump alone leaves the stored font 404 in place. `/assets/*` is asset-first, and the
asset layer answers a file the rolled-back version does not ship with its
`404.html` under the path's `_headers` policy: for `/assets/css|js|fonts/*`
that is `Cache-Control: public, max-age=31536000, immutable` (measured on the
pinned wrangler dev, 2026-09-28: `/assets/js/definitely-missing.js?v=229`
→ 404, `text/html`, immutable; `tests/worker-regression.mjs` pins it). A tab
still holding the newer HTML that requests such a file stores that 404 for a
year at that exact URL, and a roll-forward that keeps the same `?v=` never
repairs that browser; the bump changes every URL, so the stored 404 is never
asked for again.

---

## 10. Flows section (credential-gated options-flow board)

The Flows section is deliberately isolated from the learning platform. It has
its own cookie, its own audience claim, its own D1 tables, and its own secrets.
Nothing about it can grant access to `/api/*`, and nothing about the Google
OAuth path can grant access to `/flows/`.

### 10.0 Owner actions, in priority order

Everything else runs on its own. These five need a person, once; each says what
it unlocks and what tells you it has lapsed.

1. **`GITHUB_DISPATCH_TOKEN` — makes the Worker the clock.** Create a
   fine-grained personal access token at GitHub → Settings → Developer settings
   → Fine-grained tokens: resource owner `anilkaya001`, repository access *Only
   select repositories* → `anilkaya001/anilkaya.org`, repository permission
   **Actions: Read and write** (Metadata: Read is added by itself), and the
   longest expiry offered. Then:

   ```bash
   ./tests/node_modules/.bin/wrangler secret put GITHUB_DISPATCH_TOKEN
   ```

   It unlocks the Worker's five-minute cron as the dispatcher: Tier 2 at
   :01/:16/:31/:46 through the session, one re-dispatch after 45 minutes of
   stall, and the nightly at 17:15 ET (again at 18:15 ET if it has not
   landed). Without it Tier 2 depends on GitHub's scheduled starters, which
   delivered 6 runs for 63 slots from 2026-09-23 to 09-25, none before
   17:50 UTC (section 10.5i sizes the starters by that), and the nightly on its
   own crons (section 10.5h). Home's Metals and Leaders modules do not wait for
   it: the Worker's focus cron writes `live:focus` itself through the session
   (section 10.5i). Put the expiry in a calendar; when it
   lapses the nightly turns red with
   `HEALTH: GitHub refused the Worker's dispatch (refused:401): renew GITHUB_DISPATCH_TOKEN`.
   Any other 4xx refusal turns it red too, with its own remedy: `refused:403`
   (the token lacks Actions write), `refused:404` (the token cannot see this
   repository) and `refused:422` (a bad ref or inputs). Removing the token
   instead of renewing it records `no-token` and clears the alert. With no
   token at all the nightly stays green: every due dispatch records
   `no-token`, nothing reaches GitHub, and the gate prints only the note
   `dispatch: the Worker has no GITHUB_DISPATCH_TOKEN, so the Tier 2 loop chains itself and dispatches the nightly with its own job token, GitHub's schedules being the backup; a supported mode, not a failure (DEPLOY.md 10.0 item 1 and 10.5k)`.

   Setting the token is still the best fix: the Worker's cron is the one clock
   in the system that does not depend on GitHub's queue, and it dispatches
   whether or not a live loop is alive. Without it, section 10.5k is the path
   that needs no secret: the Tier 2 loop stays up between sessions, chains
   itself through the night and the weekend, dispatches the nightly at 17:30 ET
   with its own `GITHUB_TOKEN`, and opens a GitHub Issue when Tier 1 or the
   nightly lapses. Set both and they cooperate: whichever dispatches first
   wins, and the second dispatch is the nightly's one-minute same-session
   refresh (the `flows-pipeline` concurrency group queues it, the gate finds
   the session archived). Runs started by a job's `GITHUB_TOKEN` have
   `github-actions[bot]` as their actor, and GitHub emails the actor of a failed
   run, so a bot's failure has no inbox to reach; that is why the loop has its
   own alert channel, and a token you create makes the actor you.
2. **`UW_API_KEY` in both places.** The same Unusual Whales key is a GitHub
   repository secret (the nightly, Tier 2 and the weekly probe) and a Worker
   secret (Tier 1, the tape, the quote, the chain and the strategy engine):

   ```bash
   ./tests/node_modules/.bin/wrangler secret put UW_API_KEY
   ```

   A rotation updates both. A Worker without it turns the nightly red with
   `HEALTH: Tier 1's last tick failed with error:no-key`.
3. **A WAF skip rule for the ingest route.** Cloudflare's edge sometimes
   answers GitHub runners with a 403 on `/api/flows/ingest` (eleven on
   2026-09-24 and seventeen on 09-26, all absorbed by retries). Security →
   WAF → Custom rules → Create rule, expression
   `(http.request.uri.path eq "/api/flows/ingest")`, action **Skip**: all
   remaining custom rules, rate limiting rules and managed rules, and under
   *More components to skip* Security Level and Browser Integrity Check; place
   it first. Bot Fight Mode cannot be skipped on the Free plan: if challenges
   go on with the rule in place, turn it off (Security → Settings → Bot
   traffic).

   The nightly reads each 403 itself, so the blocker is named without Security
   Events. Every retry line carries the kind and the Ray ID
   (`read roster: HTTP 403 (challenge, cf-ray 8c…-IAD) — waiting 1000ms…`),
   and the run's last `edge:` line counts them by kind, with up to three Ray
   IDs each:
   `edge: 17 ingest answer(s) of HTTP 403 [challenge 15 (cf-ray …); block 1020 2 (cf-ray …)], 12.0 s of retry budget spent`.
   The kinds come from the answer alone: `challenge` (a `cf-mitigated:
   challenge` header or a challenge page, from Bot Fight Mode, a WAF rule or
   Security Level), `block NNNN` (a Cloudflare error code: 1020 a WAF custom
   rule, 1010 Browser Integrity Check, 1005 to 1009 an IP Access rule),
   `block` (another `cf-mitigated` value), and `unmarked` (neither; with no
   `cf-ray` it never reached Cloudflare). The Worker's own JSON 403 (a
   credential-scope or one-writer refusal) is not the edge: it is listed
   after `not counted:`, never retried and never counted. The other answers
   the pipeline retries (429, 408, 5xx, and a request with no usable answer)
   are tallied by status with their Ray IDs too, and listed at the end of the
   same line after `other retried answers:`. The gate reads the tally after
   its own three reads, so the count, the kinds and the budget in the line
   are one moment's figures. At 24 edge 403s, or 60 s of retry budget, before
   the 90 s budget runs out, the gate turns the run red with one line per
   kind naming its remedy: the Skip rule for a challenge, a 1020 or a 1010,
   Bot Fight Mode off for challenges that outlive the rule, the IP Access rule
   for 1005 to 1009, and the Ray ID to look up in Security → Events for
   anything else. The Worker never answers the ingest route with 429 or 408,
   so a 429 with a `cf-ray` is named as a Cloudflare rate limiting rule (the
   Skip rule covers it) and a 408 as the edge's timeout or a Cloudflare rule.
   An answer whose body carries Cloudflare error 1027 is the Workers Free
   plan's 100,000 requests a day running out, which no rule lifts (it resets
   at 00:00 UTC; item 5 removes it). A 5xx is the Worker or D1 failing (error
   1101: the Worker threw; 1102: it ran over its CPU or memory limit), a
   request with no answer is the network or a Worker that never answered, and
   any of them without a `cf-ray` never passed through Cloudflare at all.
4. **The Google OAuth client.** Google deletes OAuth clients left unused for
   about six months, and Lab sign-in is rare. Sign in to the Lab at
   `https://anilkaya.org/lab/` when the nightly asks; the client must keep the
   callback `https://anilkaya.org/auth/callback`.

   The nightly keeps the count. Under the pipeline's credential (never the
   live one, and never `/api/flows/now`) the ingest `clock` key carries
   `labActiveAt`: the newest instant the Lab's Google sign-in is known to have
   been used. It is the latest of `users.created_at` (a first sign-in),
   `users.signed_in_at` (every sign-in, stamped by the OAuth callback) and
   `stats.updated_at` or `progress.updated_at` less 30 days, because a
   signed-in write proves a sign-in no more than one session (30 days)
   earlier. A missing table or column counts as nothing; a database with no
   Lab user answers `null`. Under 120 days every nightly prints only
   `lab: the Lab's Google OAuth client was used within the last 120 days; nothing to do`,
   with no date and no age: this repository is public, so are its Actions
   logs, and `labActiveAt` is the newest activity of any Lab learner. From
   120 days it prints a `WARNING:` line with the day and the age, which
   GitHub also shows as an annotation on the run, names the day the gate
   turns red, and leaves the run green. From 150 days it turns the run red,
   which emails the owner:
   `HEALTH: the latest Google sign-in to the Lab on record is …, 150 days ago. Sign in to the Lab at https://anilkaya.org/lab/ — Google deletes an OAuth client unused for about six months; keep the callback https://anilkaya.org/auth/callback registered. Google deletes it about ….`
   One sign-in clears it the next night. From 180 days the line also says how
   to replace a deleted client: create a Web application OAuth client (Google
   Cloud console → APIs & Services → Credentials) with that callback, then
   `wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

   `users.signed_in_at` comes from `migrations/0013_users_signed_in_at.sql`.
   Applying it is optional: the first sign-in after the deploy adds the
   column itself, and until then the count reads the other three sources.
   It is a single `ALTER TABLE ... ADD COLUMN`, so it is not re-runnable:
   after the first post-deploy sign-in it fails on the duplicate column and
   changes nothing. Check with
   `wrangler d1 execute iewt --remote --command "PRAGMA table_info(users)"`
   before applying it.
5. **Optional: Workers Paid ($5/month).** It removes the 100,000
   requests-a-day cliff (HTML, the APIs and the heartbeat still pass through
   the Worker; `/assets/*` is served asset-first and no longer counts, so the
   cliff would still take the Lab and the landing page down with Flows, only
   later) and the 10 ms CPU cap, which is what forces Tier 2 onto GitHub
   Actions and is why the board summary refresh has a Worker cron of its own
   (`15,45 * * * *`, section 10.5i): four of the five crons the Free plan
   allows an account are registered. No code change is needed to switch.

Nothing routine is left: a weekly keepalive keeps GitHub from disabling the
scheduled workflows after 60 days without a commit, a weekly strict probe turns
red on vendor drift, a weekly regression run catches a fixture the calendar
overtakes, and the nightly ends with a health gate that turns the run red,
which emails the owner, whenever the live layer failed that session, the edge
refused or throttled the ingest route past its threshold (item 3), or the
Lab's Google sign-in has been idle for 150 days (item 4).

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

Four secrets are needed here, plus `UW_API_KEY` on the Worker and the
`GITHUB_DISPATCH_TOKEN` of section 10.0 (the live workflow itself authenticates
with GitHub OIDC), and **two of them must be set in two places with the same
value**: `UW_API_KEY` (section 10.0) and `FLOWS_INGEST_TOKEN`
authenticates the pipeline to the Worker, so
the Worker needs it as a secret and GitHub Actions needs it as a repository
secret. If the two differ, every publish returns 401, the job exits non-zero,
and the board silently keeps yesterday's data.

The normal flow is **mint mode**: one command mints a distinct crypto-random
password per member plus a fresh pepper, derives the hash map, and prints
everything ONCE. Passwords and the pepper never touch disk, argv, or shell
history; `--out` also saves the hash map (never a password) as the members file
that section 10.2a starts from.

```bash
# 1. Mint the whole set: per-user passwords, a fresh pepper, and the
#    FLOWS_CREDENTIALS JSON. Printed ONCE; keep the terminal open until both
#    secrets are pasted below, because none of it can be recovered afterwards.
#    FIRST TIME ONLY: without --from it mints the legacy roster and creates
#    members.json. It refuses to run once members.json exists, because that
#    file is the only copy of the member list.
node scripts/generate-flows-credentials.mjs --mint --out members.json

#    EVERY LATER RE-MINT (rotating every password): --from mints each member
#    the file lists, keeping end dates and epochs, and writes it back.
node scripts/generate-flows-credentials.mjs --mint --from members.json --out members.json

# 2. The ingest token is separate (it authenticates the pipeline, not people).
INGEST_TOKEN=$(openssl rand -hex 32); printf 'FLOWS_INGEST_TOKEN: %s\n' "$INGEST_TOKEN"
```

Now set them. Each command prompts for the value; paste the matching block the
mint printed (pepper and JSON are each on their own labeled line).

```bash
./tests/node_modules/.bin/wrangler secret put FLOWS_PEPPER
./tests/node_modules/.bin/wrangler secret put FLOWS_CREDENTIALS
./tests/node_modules/.bin/wrangler secret put FLOWS_INGEST_TOKEN
```

Hand each person their password **out-of-band** — never through a chat, a
ticket, or an email thread. **A credential that has touched any of those is
burned**, whether or not it still works: re-mint the entire set, and bump
`FLOWS_SESSION_EPOCH` (below) so cookies minted under the burned set die too.

Legacy shared-password mode still exists (`printf '%s\n%s\n' "$PASSWORD"
"$PEPPER" | node scripts/generate-flows-credentials.mjs`), but per-user
passwords are the default for a reason: with a shared password, one person's
leak rotates everybody.

**`wrangler secret put` deploys; the dashboard does not.** The CLI creates a
new Worker version carrying the secret and deploys it at once (Cloudflare's
Secrets page says so), so no code deploy follows it. A secret added in the
dashboard is stored as a new version that waits for its **Deploy** button; until
then the running Worker behaves exactly as if the secret were never set —
`/flows/login` answers `503 "Sign-in is not configured"` and
`/api/flows/ingest` answers the same, and nothing in the UI flags it. If the
CLI refuses because the latest version is not the deployed one (gradual
deployments), use `wrangler versions secret put` and then
`wrangler versions deploy`.

Two checks that distinguish "deployed" from "stored but dormant", both from any
terminal and neither revealing a value:

```bash
# 401, not 503, means FLOWS_INGEST_TOKEN is live on the running Worker.
curl -s https://anilkaya.org/api/flows/ingest

# The login form rendering is not evidence; submitting it is. A 503 here means
# FLOWS_PEPPER or FLOWS_CREDENTIALS is stored but not deployed.
```

Then clear the one shell variable still in memory, and close the terminal that
showed the mint output:

```bash
unset INGEST_TOKEN
```

**The repository is public.** None of these values may ever be committed,
echoed into CI logs, or pasted into an issue.

### 10.2a Members: add, renew, end, revoke — one command, no deploy

The members are the keys of `FLOWS_CREDENTIALS`. Adding, renewing, ending or
revoking a subscriber is one `wrangler secret put FLOWS_CREDENTIALS`: no code
change and no deploy, and nobody else is signed out.

A key is a sign-in name, `^[a-z0-9_.-]{3,32}$`. Its value is either the hash
string the mint prints, or an object:

```json
{ "alice": { "hash": "<from the script>", "until": "2026-12-31", "epoch": 1 } }
```

- `until` is the **last Eastern calendar day** of access, inclusive. From the
  next New York midnight the member can no longer sign in, and a live session
  stops at its next request. A lapsed subscription therefore ends by itself.
- `epoch` (a whole number, default 0) revokes one person: raise it and that
  member's live sessions end at their next request while everyone else stays
  signed in. `FLOWS_SESSION_EPOCH` still signs everyone out.
- An old plain-string value keeps working unchanged (no end date, epoch 0).
- An entry the Worker cannot read (a bad name, an impossible date, a
  non-integer epoch, no hash) is ignored on its own: that one person cannot sign
  in, and everyone else is unaffected.
- A secret that is missing or not JSON at all (one bad hand edit, such as a
  trailing comma) fails closed: sign-in answers 503 and **every live session is
  refused** until the secret is fixed. It never falls back to a built-in list,
  because a fallback would quietly re-admit members whose access had ended or
  been revoked. The script only ever writes JSON the Worker reads, so install
  its output rather than editing the secret by hand. `FLOWS_USERNAMES` in
  `shared/flows-auth.js` no longer grants anything: it only chooses which names
  keep a throttle counter of their own, and can be emptied once every member is
  in the secret.
- Removing a key is revocation: that member's live session ends at its next
  request.
- Failures stay uniform: an ended, revoked, unknown or mistyped sign-in all
  get the same 401 page. The throttle keeps a bucket per address for every
  name outside the legacy roster, so a lockout cannot reveal whether a name is
  a member. Guessed names never key a row: every name outside the legacy
  roster shares one counter per address (an IPv6 address counts as its /64),
  and each failure also deletes the counters older than the 15-minute window,
  so `flows_login_failures` holds at most one window of failing addresses.

Cloudflare never shows a secret's value again, so keep the current JSON as a
private `members.json` (outside this public repository, and apart from the
pepper; it holds peppered hashes, never passwords). The script edits it and
prints the one install command:

```bash
# Add a subscriber through 2026-12-31. Stdin: the pepper (the FLOWS_PEPPER value).
node scripts/generate-flows-credentials.mjs --add alice --until 2026-12-31 --from members.json --out members.json
./tests/node_modules/.bin/wrangler secret put FLOWS_CREDENTIALS < members.json

# Renew, end, or lift an end date (no pepper needed):
node scripts/generate-flows-credentials.mjs --set alice --until 2027-06-30 --from members.json --out members.json
node scripts/generate-flows-credentials.mjs --set alice --until never --from members.json --out members.json

# Revoke one person's sessions, keeping the password (or give it a new
# password with --add alice again, plus --epoch N to end the old sessions):
node scripts/generate-flows-credentials.mjs --set alice --epoch next --from members.json --out members.json

# Drop a member entirely:
node scripts/generate-flows-credentials.mjs --remove alice --from members.json --out members.json
```

Each run prints the new password (for `--add`) on the terminal once, lists
members whose end date has passed, and refuses a map over Cloudflare's 5 KB
secret limit (about 80 plain entries, or about 50 in the object form; remove
ended members to reclaim room). Without `--out`, the new JSON is the only thing
on stdout, so it can be piped straight into `wrangler secret put`.

Verify from any terminal, without revealing anything: sign in as the member
(303 and a `flows_session` cookie), or, for an ended or revoked member, confirm
the sign-in page comes back with 401.

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
| Change passwords | Re-mint (`--mint --from members.json`) and set `FLOWS_PEPPER` + `FLOWS_CREDENTIALS` | **None** — everyone stays signed in |
| Change one password | `--add NAME` again, then `wrangler secret put FLOWS_CREDENTIALS` | **None**, unless `--epoch` is raised too |
| Revoke one person | `--set NAME --epoch next` (or `--remove NAME`), then `wrangler secret put FLOWS_CREDENTIALS` | That member only, at their next request |
| End a subscription on a date | `--set NAME --until YYYY-MM-DD`, then `wrangler secret put FLOWS_CREDENTIALS` | That member only, from the next Eastern day |
| Revoke every session | Increment `FLOWS_SESSION_EPOCH` in `[vars]` and redeploy | All sessions invalid immediately |

Rotating `FLOWS_PEPPER` does **not** sign anyone out. The pepper is used for
credential derivation only and never touches session verification, so an
already-issued token keeps working for its full 14-day life. Changing the
password without bumping an epoch means a departing user's existing cookie
still opens the board for up to two weeks — raise that member's `epoch` (or
remove them) as well.

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
| `card:<TICKER>` | each run, best effort | `/api/flows/card?t=` | overwritten; retired after 3 sessions unrebuilt |
| `card-x:<TICKER>`, `hist:<TICKER>` | each run (vol, flow, ownership and earnings legs) | `/api/flows/card-x?t=`, `/api/flows/hist?t=` | overwritten; retired after 3 sessions unrebuilt |
| `focus` | each run | `/api/flows/focus` (the home page's metals, Mag 7 and NDX 10) | overwritten daily |
| `roster` | each run, after every per-ticker key | `/api/flows/roster` (search, "Open instead", absent-card classification) | overwritten daily; also the retire ledger |
| `meta` | each run | diagnostics | overwritten |

THE DATED BOARDS ARE WHY A TRACK RECORD EXISTS AT ALL. Until they did, every
morning's `board:long` overwrote the previous one, so by the time any forward
return existed there was no surviving record of what had been claimed — which
is how this product asserted a hit rate in its own footer for months while
being structurally incapable of measuring one.

Retention is 126 calendar days (~90 trading sessions, nine times the 10-session
forecast horizon). Steady state is about 270 rows and +3 row writes per run
(`scores:<date>` alongside the two dated boards; it said 180 and +2 until the
`scores:` key joined the archive and the multiplication was not re-run),
against a 100,000/day budget **shared with the live learning app**.

The prune is a `DELETE` on the ingest route, and that route accepts DELETE for
**dated boards, and — for the nightly token only — `card:`, `card-x:` and
`hist:` keys**. The live token deletes nothing, and no token can delete a
view key such as `board:long`, `universe`, `focus` or `roster`. That is a
blast-radius limit rather than a privilege one: the same bearer can already overwrite the live board, but a sweep with an
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
ingest route: at steady state ~270 sequential reads per run (126 calendar days
× 5/7 weekdays × 3 keys — `scores`, `long` and `short`), once daily, against
the same 100,000/day row budget
shared with the learning app. It is worker reads only — no vendor call — so it
sits outside the 30-minute deadline calculus, and it runs after today's boards,
archive, watch list and movers are all committed, so a failure inside it can
cost only the record.

If that read count ever becomes the binding constraint, the escape hatch is
additive and needs no schema change: cache each session's already-scored row
inside the `record` blob itself and fetch only the dates not yet scored, which
turns the steady state into ~2 reads per run.

**PER-TICKER KEYS ARE RETIRED, NOT LEFT TO AGE IN PLACE.** Until 2026-09-25 a
card was overwritten only when its ticker was built again, so a name that left
coverage (an acquisition, an index change, a market-cap move) kept serving its
last dossier — on 2026-09-25, 110 of 262 cards were stale, back to 2026-08-24,
each showing an old price as its headline. The nightly now retires every
`card:`, `card-x:` and `hist:` key that is **more than three NYSE sessions
old** (`RETIRE_AFTER_SESSIONS`, holidays excluded) **and was not rebuilt by
the run**. Index, fund and focus dossiers are exempt: they are rebuilt every
night by design, and on the night one fails a dated dossier is better than
none.

The run cannot list the store, so the `roster` key doubles as the ledger:
besides `depth` and `session` for every card it published, it carries `x`
(the tickers whose `card-x` and `hist` landed) and `held` (older keys it knows
exist and has not yet retired, with their session). The next run reads it,
retires what has aged out, and carries the rest. A roster with no `held`
(the first run after this change, or one that shed its ledger to fit its
32 KB cap) triggers a one-time probe of every screened, guaranteed, fund and
index ticker through the metadata form described below; the per-key reads of
`card:` and `card-x:` (and `hist:` wherever either exists) remain as the
fallback for an older Worker. If the prior roster cannot be read at all,
nothing is retired that night. A refused DELETE keeps its key in `held` for
the next run.

The probe asks for dates, not cards. `GET /api/flows/ingest?keys=<comma
list>` (the nightly token only, GET only, at most 96 keys, each held to the
single-key allowlist, `live:*` refused) answers
`{ keys: { "<key>": { present, sessionDate, generatedAt, updatedAt, bytes } } }`
from one prepared statement over `length(payload)` and two `json_extract`s,
with a stored row whose payload says `status: "pending"` reported `present:
false`, exactly as the pipeline reads the single-key answer. The nightly builds
the list from every candidate's `card:`, `card-x:` and `hist:` keys at once,
sends it in chunks of 96, and applies the same rule to the answers (hist counts
only where a card or card-x is present or landed), so the ledger it builds is
the one the per-key path built. Measured against the 2026-09-24 production
snapshot with 733 candidate names and nothing landed (a full rebuild): the
per-key bootstrap made 1,747 requests and downloaded 21,797,292 bytes to learn
601 dates; the metadata form made 23 requests of 130,512 bytes in all, each one
D1 statement, and built the identical 601-key ledger. If the form answers
anything but 200 — an older Worker's 400 `invalid_key` — the run falls back
to the per-key reads; a 400 `too_many_keys` falls back the same way but is
named in the log as the cap mismatch it is, and
`tests/flows-pipeline-contract.mjs` holds the pipeline's chunk within the
Worker's `INGEST_META_KEYS_MAX`. The log line names the path either way, with
the bytes left undownloaded. The 2,400 cap charges a name's `card:` and
`card-x:` keys only; its `hist:` rides in the same request uncharged, so the
metadata path reaches 1,200 names in full (the per-key reads, which charged
every key including the hist they fetched, reached 800 to 1,200 depending on
how many were carded, and charging all three kinds would have held the form
to 800). The failure limit and the deadline count keys asked. `bytes` is
`length(payload)` of the stored text — characters, as the POST answer's
`bytes` counts them.

The roster is read twice: once as the run starts and again at the retire
step. Only the nightly writes it, so when the late read fails the early copy
is used and the night still retires. Only when both fail does the night
retire nothing and write `ledger: "unread"`.

The ledger is trusted only when it is whole and current. The probe runs
whenever the prior roster's `ledger` is anything but `carried` or `bootstrap`
(`bootstrap-partial`, `dropped`, `unread` — the roster written on a night that
could not read its own prior has an empty `held`, so every older key would
otherwise be forgotten for good), and whenever its `sessionDate` is more than
one NYSE session before tonight's (a night whose roster write failed after its
cards landed, or a run killed between the two, leaves an older roster behind,
and the cards of the lost night are in no ledger). The probe has its own
20-second retry budget, separate from the 90 seconds the meta and brief
publishes rely on, and stops after 25 failed reads; either way it marks the
ledger `bootstrap-partial` so the next night probes again. A roster write that
fails after the deletes logs how many keys were removed.

What the probe cannot see is a key that only a LOST ledger knew and whose
ticker is in none of tonight's candidates (the harvest of about 830 names, the
guarantee, the funds, the indices and the Nasdaq-100 constant): a name that
left the screen entirely in the same few nights its ledger was lost. On
2026-09-29 eleven such rows were in the store (card PRU, SYK, CNQ, COO, CB and
TD, card-x CB, LEVI and TD, hist CB and TD; PRU 35 days old and in that day's
universe), served forever because the ledger, once `carried`, never probes
again, and a reader typing `/flows/ticker/?t=PRU` got the 2026-08-25 dossier
under a Stale chip.

The nightly now asks the store what it holds. `GET /api/flows/ingest?list=card,card-x,hist`
(nightly credential only) answers every non-pending row of those three prefixes
with its session, generation instant and write time and never its payload,
from the primary key's three prefix ranges (about 580 rows read, no scan, cut
at 2,000 with `truncated`). `retireAndRoster` unions every listed key the
ledger and tonight's landed set do not name into `known` before it ages the
ledger, so anything more than three sessions old is retired the same night and
anything younger is held from then on: the ledger repairs itself every night and
no orphan can outlive one. A listing that fails changes nothing (the ledger is
used as it stands, with one log line), and a night whose prior roster could not
be read still retires nothing. The eleven rows go the first night after this
deploys; the owner's fallback, if a Worker older than the listing is answering,
is `DELETE FROM flows_payload WHERE id IN ('card:PRU', ...)` through
`wrangler d1 execute`, eleven row writes.

### 10.4c The D1 free-tier budget: rows written and rows read

The Workers Free plan gives one D1 database two daily row caps, both reset at
00:00 UTC and both shared by everything on the account: **100,000 rows
written** and **5,000,000 rows read**. Only the write cap was ever modelled
(section 10.4b prices the archive, the cards and the scorer against it). The
read cap is the one that was found exceeded: on 2026-09-29 an audit `SELECT`
at about 21:36 UTC failed with error 7500. Who spent it (the audit's own
thousands of queries are the leading suspect, unproven) and whether the
Worker's own reads and writes were refused that evening are unverified until
`live:alerts.record.reads` is read for continuity across it and the D1
dashboard's rows read by hour is read, which only the owner can do.

What the ledger adds is written down so the write budget stays a sum: each
weekday the Tier 1 tick writes two ledger rows (its stamp and its outcome, on
about 108 firings, of which about 80 are due), the focus tick one (about 80),
each Tier 2 heartbeat one (about 85) and the nightly one, in all about 350
row writes a day against 100,000, on the batches those writers already
issue. The Tier 1 tick's read batch now selects the twelve live rows'
ages (12 rows read where it read 1), about 1,200 more rows read a day.

A quota error is answered by the Worker as `503 store_quota` with
`Retry-After` to 00:00 UTC (section 10.5h), so the gate and the nightly can
tell it from a Worker or a network fault.

**Reads are guarded in rows, not only in trips.** `tests/flows-reads-contract.mjs`
fits its fake D1 with `EXPLAIN QUERY PLAN`: an index search costs the rows it
returns, a scan costs the whole table, and a `json_each` over a payload costs
the elements of that array (D1 was seen to count them: a first audit `SELECT`
over the universe's names reported 666 rows read). Every read route has a
ceiling against a table of 1,216 rows, and a route the Worker declares that has
none fails the suite: the thirteen home reads together cost 23
rows, so the cap holds about 217,000 cold home loads a day; a lite card or an
absent name reads the universe's name list and its sector column (1,466 rows,
an upper bound because SQLite stops at the first match) and, with the tape's
admission check (673, the same bound), is the costliest page, about 2,300 cold
ticker pages a day. The model is an upper
bound and only ever a ceiling; the number that matters is the D1 dashboard's
rows read by hour, which only the owner can see.

**When the store cannot be read, a reader gets the last good copy.** The
Worker keeps each nightly Flows key it serves (`board`, `market`, `events`,
`scoretrack`, `meta`, `flowalerts`, `pulse`, `political`, `unusual`, `movers`,
`sectors`, `sector-premium`, `universe`, `regime`, `ideas`, `focus`, `roster`,
`news`, `record`, and a card, card-x or hist by ticker) in `caches.default`
under an internal URL, once per ten minutes per isolate, for 24 hours, and only
a response served from a stored row (`X-Payload-Updated`) is kept, never a
pending answer. When D1 answers an error (the 7500 quota above, or any other
fault) the Worker returns that copy with `X-Fresh-State: stale`,
`X-Fresh-Reason: store` and `X-Fresh-Last-Good` naming the instant it was
kept, where it used to return a bare 503 `store_unreadable`. The body is the
stored row, so its own `sessionDate` and `generatedAt` still say what day it
describes; a copy older than 24 hours, a key never kept, the live keys
(`/lk`, `/now`) and the brief (its age label is computed at serve time) are the
503 they were, and a request without a session is the 401 it always was. It
costs no D1 rows, one Cache API write per key per ten minutes per isolate and
no CPU worth naming on the path that serves a stored row; the alternative is
Workers Paid.

**What the last good copy does not promise.** `caches.default` is local to the
data centre that wrote it and is neither replicated nor pinned: the copy exists
only where that key was served within the last 24 hours and can be evicted
earlier, so a data centre that did not serve the key still answers the bare
503. It softens a quota day for the colo the owner and most readers use; it is
not a guarantee. The behaviour is proven on local workerd and a Cache API
fake, and is **unverified on the production edge**: nothing in a healthy day
shows the stamp, and the store cannot be made unreadable on purpose in
production, so the first real quota or D1 outage is the check (read
`X-Fresh-Last-Good` on the response). The Cache API does nothing on a
`workers.dev` hostname, so a preview there proves nothing either way.

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
now split and read again**: a full page is cut at the geometric midpoint of
its band and both halves re-queried, at most two levels deep, and only a leaf
still full after that is reported as `CAP` and counted in
`meta.schedule.screenerTruncatedBands`.

**The enrichment pool, which is the subtler one.** Enrichment costs five calls
a name, so the pool was 60 — thirty per side of a rough composite of the very
screener columns family F is built from. That is a selection on the
measurement. The score is a residual against the cross-sectional spread of the
pool it is computed over; when the pool IS the tails of that signal, the spread
is the selection's rather than the market's, and every z-score on the board
inherits it. A pool chosen for extreme tilt makes tilt look ordinary.

The pool is now a **stated universe**: the largest `UNIVERSE.enrichCount` (100)
names in the gated screen, plus every guaranteed name (Nasdaq-100 members, the
Mag 7 and the focus miners) the screen returned.
Market cap is the selection axis because it is on the screener row already, is
stable session to session, and — the property that does the work — **is
independent of the option flow being scored**, so selecting on it cannot bias
the cross-section.

Nasdaq-100 membership is **read every night** from the vendor's QQQ holdings
(`/api/etfs/QQQ/holdings`, the stock rows with a positive weight), one call
before selection that the regime leg then reuses for its implied correlation
instead of reading it again. The repository constant (`NDX_AS_OF`, `NDX_100`)
is only the fallback: when the read fails or lists fewer than 90 weighted
stocks, the constant is unioned with whatever the read returned and the run
says so in its log and in `meta.warnings`; `meta.warnings` also says when the
constant is more than 400 days old. The log names the drift between the two
every night (members the constant lacks, and constant entries no longer
held). Membership is used **additively** — it guarantees inclusion and never
excludes — so the failure mode is a slightly different hundred names at the
cost of five calls, never a wrong reading; `tests/flows-universe-contract.mjs`
asserts the order.

**Guaranteed names missing from the harvest are read by ticker.** The harvest
asks the vendor for `min_marketcap` 1e9, so a guaranteed name whose vendor cap
is wrong (TECK read 505 million on 2026-09-24) or an index member the harvest
did not return is fetched with one `/api/screener/stocks?ticker=A,B,…` call.
Focus names (the Mag 7, the NDX 10 and the miners) then skip ONLY the
market-cap floor in `eligible()`; price, option volume and open interest
still apply. Funds never enter this path: GDX's vendor market cap reads 52.

**Coverage is chosen before the earnings gate; the gate applies to the score.**
Until 2026-09-25 only names that passed the 12-day gate were enriched, so a
name approaching earnings kept whatever card it last had for up to twelve days
(MU showed 978.50 against a 1,076.60 close four sessions before its report).
The scored pool is unchanged — the largest hundred of the GATED screen plus the
guarantee — but every name the same rule would pick from the UNGATED screen is
now enriched too, and carded for the session with `score: null` and
`gate: {earnings, dte}`. It is never scored and never on a board. A gated name
that is not a focus name is enriched only when its screener row's 30-day
average volume times its close reaches 80% of the $50M card floor: below that
the candle median would refuse the card anyway, and the five enrichment calls
would buy nothing. A row with no average volume is enriched rather than
skipped on a guess.

**Focus names are built deep whatever their rank.** The Mag 7, the NDX 10 and
the six focus miners (`shared/flows-focus.js`) get the full deep treatment —
chain, surface, dark pool, OI, term, IV rank, the flow and vol legs, earnings
and the options engine — in ADDITION to the fifty `DEEP_NAMES`. Their card
depth is `focus` unless they are among the fifty, in which case it is `board`;
a focus name that sits on a board carries `dp` like any deep row. The NDX 10
is the ten largest distinct companies by QQQ weight (GOOG collapses onto
GOOGL), falling back to the members ranked by market cap and naming the
fallback in its `source`.

**Funds are dossiers, not coverage.** GLD, IAU, SLV, CPER, COPX, GDX, GDXJ,
SIL and SILJ are built through the index-dossier path (13 calls each) with
depth `fund`, and the vol leg reads them like an index (cone, term, skew, IV
rank), outside the stock cross-section's percentiles. The vendor has no
earnings or insiders for ETFs, so those modules are hidden for funds exactly
as for SPY.

**The `focus` key** is one `/api/screener/stocks?ticker=` call for every focus
ticker and fund: the metal groups, the Mag 7 and the NDX 10 with their source,
one row per ticker in the live strip's field names and units, up to 22 closes
where the run already holds candles, and the tickers the vendor did not
return. It is capped at 24 KB and sheds closes, never rows. When the read
fails, or does not return a ticker, the row is filled from what the run
already holds — the harvest's own screener row for a stock, the market leg's
or a second by-ticker read's row for a fund — and the payload's `backfill`
names those tickers, when they were read and why. Only a ticker no read holds
is `missing`, and only a payload with no row at all publishes `unavailable`
(with the groups still listed). Fund dossiers take their spot row from the
same chain, so one failed call cannot skip all nine: a fund absent from the
focus read is read again by ticker, one call, only on the night it is needed.

`shared/flows-focus.js` is a leaf: the focus constants (`FOCUS_METALS`,
`MAG7`, `FOCUS_FUNDS`, `FOCUS_MINERS`) and the pure functions that need nothing
else (`ndx10`, `ndxMembership`, `focusTickers`, `focusGroups`, `focusCloses`).
It imports nothing, so any module can read it without an import cycle. It also
holds the one strip planner, `focusStripNames` with its `FOCUS_STRIP_FALLBACK`
roster, which the Actions strip (`scripts/flows-legs/live.mjs`) and the
Worker's focus tick (`shared/flows-live-worker.js`) both call, so the two ask
for the same names in the same order. The payload builder needs the strip
fields from `shared/flows-live.js`, so it lives in the pipeline's legs,
`scripts/flows-legs/focus.mjs` (`focusRow`, `buildFocusPayload`); the
universe contract asserts both.

**The Ask indexes every deep name.** Sixty-odd deep cards at about 2 KB of
facts each do not fit the brief's 120 KB beside its 18 KB of market facts, so
before any name is dropped the brief LEANS the weakest board names to their
core readings (standing, gamma and move; `CARD_CORE_FACTS` in
`shared/flows-ask.js`), weakest first and focus names last. The log names the
leaned names. A name is shed whole only if every name's core readings cannot
fit, which the pipeline contract proves does not happen for the largest deep
set the focus era can produce (73 names modelled).

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

The call count is modelled per leg from the 2026-09-24 nightly (3,071 calls
in 692 s, 4.44 calls/s) and `callModel()` in `scripts/flows-pipeline.mjs`
reproduces that run from its own shape to within four calls (3,075):

```
setup (session, dating, harvest) + coverage (holdings, missing members)   10
enrichment        5 per enriched name
market legs       49 fixed + short/insider batches + 2 per deep name
                  + 1 earnings history per deep or window name
sector TRIX       11
chains            1.4 per deep name (pages and single-expiry reads)
card reads        7 per deep name
vol               8 per deep, 2 per cross-section, 10 per dossier, 4 radar
flow              12.2 per deep, 3 per cross-section, 12 alert pages
dossiers          13 per index or fund dossier
focus             1
misc              67 (pulse, political, news, alerts, congress, treasury)
```

The focus-era shape (about 165 enriched, 63 deep, 100 cross-section, 12
dossiers, 86 earnings names) models to about 3,780 calls, 14 minutes at the
measured rate. `CALL_BUDGET` is the model at a nominal shape with headroom
(180 enriched, 72 deep, 110 cross-section, 12 dossiers, 95 earnings: 4,191),
and the end of every run prints `calls: modelled N for this run's shape`. The
`BUDGET:` warning prints only when the run spends more than 10% over the model
for its OWN shape, so it means a real overrun (retries, paging, a vendor
change), not a stale constant.

THE CHAIN LEG IS THE LAST VENDOR SPEND AND THE FIRST THING DROPPED. It runs
after both boards, the dated archive, the watch list, the movers band, the
record and the sector panel are all committed, so a slow run costs the
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
vendor: the 2 hysteresis reads above, and the track-record scorer's ~270
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

The floor's ceiling (400 ms) is deliberately far below the per-call backoff
ceiling (5 s). One call may sleep five seconds; every call may not, because
`CALL_BUDGET × 5s` is about 350 minutes against the 36-minute deadline — a run
that publishes nothing at all, which is strictly worse than being rate-limited.
It was 750 ms until 2026-09-25, when the budget was regenerated from measured
legs (1,613 → 4,191): at 750 ms that budget needs 52 minutes, so the relation
below had silently stopped holding once the real run passed 2,400 calls. At
400 ms it needs 27.9 minutes against the 30 the chain reserve leaves. The
evidence for lowering it is the 2026-09-24 nightly's own floor verdict: "1 of
3071 calls refused (0.0%), backoff 0.2s against 256.3s of queueing (0% as
large). The floor is CONSERVATIVE — refusals are under 5%", with the learned
floor never above 150 ms, so 400 ms is still more than two and a half times
the highest floor the vendor has ever asked for. The ceiling caps only what
the delay decays back to between refusals: a refused call still backs off to
the 5-second per-call ceiling (the pipeline contract asserts both). If a
future verdict reads "roughly where the vendor wants it" at 400 ms, cut calls
before raising it.
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
| `UW_API_KEY` | yes | Unusual Whales API bearer token. The Worker holds the same key as a secret (section 10.0); rotate both. |
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
  The `keepalive` job of `flows-pipeline.yml` prevents it: on the Monday
  firings it calls `PUT /repos/<repo>/actions/workflows/<file>/enable` for every
  scheduled workflow with the job's own `GITHUB_TOKEN` (`actions: write` on
  that job alone), logs each HTTP status, and turns red if one is not 204.
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
   parameter and returns no as-of stamp. The pipeline runs after the close
   (§10.5h), so the counter it reads is normally the session just closed — but
   nothing on the wire says so, and a delayed or manual run reads whatever the
   vendor holds at that minute. The counter's span is unobserved. The
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
| every **day count** (`sdte`, day 0, the gate band) | `gateOrigin` | `nextWeekday(sessionDate)` — the first session after the one priced, which is what the earnings gate counts from |

`resolveSessionDate()` returns the last session that has closed; after the
close that is the same day, and `gateOrigin` is the next weekday — **Monday on
a Friday**. The gate used to count from the run's wall-clock date, which was
the next session only because the run fired the next morning; once the run
moved after the close that anchor would have been a session early. In the
dry-run payload the two are `2026-08-24` and `2026-08-25`.

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
- **Sessions are NYSE trading days**, and the payload says so. This desk's
  `sdte` (`sessionsToEarnings` in `shared/flows-events.js`) and its gate origin
  (`nextTradingDay` from the pipeline) count on the computed NYSE calendar
  (`isTradingDay` in `shared/flows-freshness.js`): weekends and scheduled
  holidays are not sessions, early closes are. The market leg's earnings window
  (`windowTickersOf`, through `sessionsBetween` in `shared/flows-cross.js`)
  counts the same way. Only a closure the exchange did not schedule can make a
  count one session long, until the day has passed.
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

### 10.5f The score track, and what a gap must never mean

Two keys, both zero vendor calls.

**`scores:YYYY-MM-DD`** — one session's whole scored pool, written once
beside the dated boards. The boards archive a ranking's two tails; this key
keeps the distribution, `{t, s}` per name and nothing else. Written under the
same immutability contract as the dated boards (a re-run writes identical
bytes — the rows are sorted by ticker for exactly that), swept by the same
prune (which now names three keys a day, so the bound is 90 named deletes a
run), and deletable through the same narrowed DELETE gate.

**`scoretrack`** — the pooled trace, REBUILT from the archive every run
rather than incrementally updated, so it can never drift from the keys it is
a view of. The archive walk that already feeds the track record reads the
scores key alongside the two board sides (three paced reads per weekday, same
User-Agent, same retry accounting). Sessions older than the dated scores key
are reconstructed from the archived boards and published as `source:
"boards"` — genuinely sparser, and the payload says so rather than letting a
thin column read as a quiet market.

The honesty this surface carries above every other: **a gap is not a zero.**
A null in a series means the name was not scored that session — out of the
screener, under the liquidity floor, inside the earnings gate, or not
enriched. Zero is a score the pipeline assigns. The first version of the
shared module turned `score: null` into `0` via `Number(null) === 0`, and the
suite's first run caught it because its fixture places a real zero adjacent
to a gap on purpose. Keep it that way: any fixture for this surface must
contain a zero, or the collapse becomes unobservable again.

The log lines to read:

```
scores: 131 name(s) archived for 2026-08-28
scoretrack: 214 name(s) over 42 session(s) (39 full, 3 board-only)
```

`scores:` missing with a dated session is the writer failing; `scoretrack`
with a large `board-only` count long after this shipped means the dated
scores keys are not being found — check the archive read counters on the
record line first, since both legs share the same walk.

### 10.5g The market pulse, the intraday cron, and the wave-B probes

Seven market-wide vendor feeds pooled under one `pulse` key — tide, total
options volume, OI change, top net impact, insider filing aggregates, recent
dark pool prints, and market seasonality — at a cost of seven calls a run.
Shapes follow `docs/uw-openapi.yaml` (the vendor's own spec, checked in
2026-08-31) but are read defensively, because the spec marks half the
OI-change fields "ToBeDone" and documentation has been wrong five times in
this repository. Each feed fails alone: a vendor error becomes
`{status:"unavailable", reason}` on that feed only.

**The intraday layer is section 10.5i.** The Worker no longer rewrites `pulse`,
`flowalerts` or `brief` during the session: each key has one writer, and the live
tide and the session's alert union are overlaid onto the nightly rows when a page
reads them. `refreshed: "nightly" | "intraday"` plus `readAt` on the served payload
still says which read a page is showing.

The log lines to read on a pipeline run:

```
pulse: 7 of 7 feeds ok — tide:ok:78 totals:ok:20 ...
probe /api/darkpool/AAPL: ok — 5 row(s), first-row keys: ...
```

A `pulse <feed>: NOTE returned rows but none shaped` line is the spec being
wrong the sixth time — the dumped first-row keys are the fix. The six `probe`
lines scout wave B (per-stock dark pool, OI change, short volume, IV rank,
vol term structure, per-ticker flow alerts): their observed shapes land in
`meta.probes`, and the sections they scout must be built from THOSE dumps,
not from the spec. Wave B has landed and the probes are retired; the last one,
`/api/shorts/AAPL/volume-and-ratio`, returned zero rows on every run and is gone.

### 10.5h The schedule, and the session each run reads

Since 2026-09-29 the Tier 2 loop dispatches this workflow at 17:30 ET with its
own job token (section 10.5k), and the crons below are the backup: a cron firing
that arrives after the loop's run is the same-session refresh described under
"The same-session gate".

The workflow has four crons. `30 21 * * 1-5` and `30 22 * * 1-5` are the
primaries: 17:30 Eastern under EDT and under EST respectively. The gate step
admits each only in its own zone, keyed on the cron string that fired rather
than on the wall time, so a firing GitHub delivers hours late still runs once,
and the other zone's primary exits in its first step. `17 1 * * 2-6` and
`47 3 * * 2-6` are backups (21:17 and 23:47 EDT, 20:17 and 22:47 EST): if the
primary was dropped, a backup ranks the session; if it landed, the same-session
gate makes the backup a refresh of about a minute. The primary stays at 17:30,
not at the close, on purpose: the vendor's post-close rows need the time.
`tests/flows-pipeline-contract.mjs` walks every weekday from 2026 to 2030,
through every DST switch, and proves exactly one admitted cron lands between
17:15 and 18:00 ET and every other admitted firing after 20:00 ET; it also runs
the gate script under bash for each cron and zone. The workflow used to fire at
05:15 Eastern, and GitHub delivered that firing 4.5 to 6.6 hours late every
weekday from 2026-08-27 on: every run read the session in progress and
published it under the previous session's date. A post-close firing delayed by
as much as twelve hours still lands before the next open, so lateness no longer
changes which tape is read.

Four guards sit behind the schedule, all in `scripts/flows-pipeline.mjs`:

- **The intraday refusal.** After `resolveSessionDate()`, a run whose Eastern
  clock is inside 09:30–16:00 on a weekday throws before any read. The
  `allow_intraday` dispatch input (`FLOWS_ALLOW_INTRADAY=1`) overrides it and
  the log says what that publishes.
- **The same-session gate.** The gate reads all three of the session's archive
  keys (`scores`, `board:long` and `board:short` at `<sessionDate>`). If they
  are archived, the run is a second run against one session: it refreshes only
  `pulse`, `sector:premium` and `news` and leaves boards, scores, score track,
  record, brief, cards and meta as the store holds them. If some are held and
  others absent, an earlier run ranked the session and lost part of its
  archive: the gate skips the ranked leg the same way, names the missing keys
  and exits non-zero, because the dated keys are immutable and a plain rerun
  would put a second ranking live beside the kept part of the first. The
  `republish_session` input (`FLOWS_REPUBLISH_SESSION=1`) instead deletes the
  session's three archive keys through the ingest DELETE and rewrites them with
  everything else — even when `scores:<sessionDate>` is absent or unreadable,
  because a dated board left by a run whose scores write was lost would
  otherwise refuse the rewrite. The two boards go first and `scores` last, each
  retried on a transient refusal, and the first key the store still refuses
  stops the retire before anything ranked is written, so a half-finished
  retire leaves the session reading as partly archived and a later plain run
  skips it rather than splitting it. A market holiday
  lands here too: SPY has no bar for the day, so the session resolves to the one
  already archived. The ticker page names a card that an earlier run of the
  board's own session left behind (its `generatedAt` is older than the meta's)
  in its stale banner.
- **The candle cut.** Every daily series is cut at `sessionDate` before any
  feature reads it (`sessionCandles`), because the vendor does not honour
  `end_date`: on 2026-09-21 all 166 cards carried a partial 2026-09-22 bar.
  `verifyDating` now reports whether `end_date` was honoured instead of
  deciding with it. Card and board prices are the session's daily close; the
  screener's last price travels as `card.readPx` with its read time.
- **The archive check.** Store reads retry on 0/403/408/429/5xx within the
  run's retry budget, board memory falls back to the newest archived
  `board:<side>:<date>` when the live key is unreadable or is this session's
  own, and the end of every run re-reads the session's three archive keys and
  writes any that are missing. `ARCHIVE LOST` in the log is the one line that
  means the record has no copy of a published session, and it makes the run
  exit non-zero after everything else is published, so the workflow turns red.
  The line after it is the whole repair, with its deadline:
  `REPAIR (before 09:30 ET on <next weekday>; ...): GitHub → Actions →
  flows-pipeline → Run workflow → tick republish_session → Run workflow` (or
  `gh workflow run flows-pipeline.yml -f republish_session=true`). It works only
  until the next weekday's open: from 09:30 ET the pipeline refuses an
  in-progress session, and after that close it ranks the new session, so the
  lost one stays lost. A plain re-dispatch finds the session partly archived
  and skips it. `ARCHIVE INCOMPLETE` from the same-session gate prints the same
  repair line.
- **The health gate.** The last thing a nightly run does is
  `scripts/flows-legs/health.mjs`. On the evening of the session it ranked it
  reads, through the ingest route and with the run's usual retries (so one
  random edge 403 is not a failure), the Worker's `clock` (day, verdict, Tier 1
  telemetry, last dispatch outcome), `live:market`, `live:focus` and
  `live:heartbeat`, and prints one `HEALTH:` line per failure: a clock that
  never rolled to the session, a holiday verdict on a day the vendor printed,
  `tier1_why` `error:<...>` (`error:no-key` names the missing Worker secret), a
  last tick before the close, `live:market` last written before 15:50 ET (12:50
  on an early close), `live:focus` never written (the line names
  `3-58/5 13-21 * * MON-FRI`, the trigger to register) or last written before
  15:50 ET, no Tier 2 pass for the session, a last pass that answered no
  vendor call or finished more than 30 minutes before the close, any 4xx
  dispatch refusal from GitHub, and, on every run whatever the session, 24 or
  more edge 403s on the ingest route or 60 s of retry budget spent (counted by
  kind, each with its remedy; the Worker's own JSON 403s are kept apart and
  never counted; section 10.0 item 3) and a Lab Google sign-in 150 or more
  days old (section 10.0 item 4). From 120 days that age is a `WARNING:`
  line and a GitHub annotation, which leaves the run green. Any failure makes
  the run exit non-zero after everything is published, and a red scheduled
  run emails the owner. A missing `GITHUB_DISPATCH_TOKEN` is a note, never a
  failure. `FLOWS_LIVE_MODE = "off"` is a deliberate rollback, not a failure.
- **The gate judges the whole day, from the session ledger.** Until the
  ledger the gate saw four single cells (the clock, `live:market`,
  `live:focus`, `live:heartbeat`) and tested only that each was written
  recently, so a Tier 1 that was dead from 10:00 to 15:00 ET and written again
  at 15:50 passed, a Tier 2 that began at 14:01 ET on 25 September passed with
  31 of about 84 passes, and a nightly that never ran raised nothing, because
  the gate is that nightly's last step. `flows_ledger` (`migrations/0015_flows_ledger.sql`,
  one row per Eastern day, thirty kept, pruned by the 03:00 ET housekeeping
  firing) records the day as it happens, at no extra D1 round trip: the Tier 1
  tick's first statement becomes a batch of the clock stamp and the ledger's
  tick row (ticks, the longest gap between ticks), the write batch carries the
  outcome (ok or failed, the longest gap between successful writes, and the
  worst key the Worker saw past its stale line, read from the live rows the
  same tick already selected), the focus tick's write batch carries its ok,
  partial and failed counts and its write gap, every Tier 2 heartbeat write
  carries the pass (count, first and last instant, longest gap, vendor calls
  and failures), and the nightly's `meta` write stamps the session's landing.
  A statement the ledger adds is dropped, with one warning, if the table cannot
  be written: the tick, the write and the heartbeat never depend on it. The
  nightly token's read of the ingest `clock` key returns it as `ledger`
  (`{ retainDays, days: [...] }`, newest first; the live credential's every-pass
  read does not carry it). The gate turns red on any Tier 1, focus or Tier 2
  interval longer than that class's stale line (25 min for the Worker's, 45 min
  for the Actions class, read from `FRESH_CLASSES`, so the line the gate draws
  is the line the reader's pill draws), naming the interval; on a session with
  no Tier 2 pass; on a nightly that never landed for the previous trading
  session (checked from the next session's run, since no run means no gate on
  the night itself; it is skipped when that session is the ledger's oldest day,
  which may predate the ledger); and, from the run's own facts, on cards that
  failed or were skipped past the deadline and on a roster shorter than the
  names planned a card (a dry run evaluates these run facts too, prints them
  as `run facts:` and exits red on a failure, and the pipeline contract holds
  the plan handed to the gate equal to the plan the run prints, so a healthy
  night can neither trip the roster check nor hide a missing name from it). It warns, without failing, on Tier 2 coverage under 70%
  of the passes a five-minute loop makes and on a key lapse the Worker saw at
  its own five-minute check; the first evening of the ledger downgrades the
  gaps to warnings, since the session may have begun before the Worker that
  keeps it was deployed. Because the ledger describes the session and not
  today's rows, a nightly that starts after midnight ET is still judged for
  gaps, landings and cards, where it used to skip every live check. What it
  cannot do is speak on a night with no run: that is the Actions-clock witness
  (section 10.0 item 1 sets the token that lets the Worker start the nightly
  itself).

- **Ingest 5xx bursts have their own red line, and a spent D1 quota is named.**
  The gate used to speak about 5xx answers only after 24 edge 403s or 60 s of
  retry budget, so five 503s the retries absorbed scrolled past in a green run.
  Five or more HTTP 5xx answers on the ingest route in one run (`HEALTH.burst5xx`)
  now turn the run red with the answers' Ray IDs. A D1 error that says the
  account's free-tier daily quota is spent (error 7500, "exceeded D1's free tier
  daily row read limit") is answered by the Worker as its own `503 store_quota`
  with `Retry-After` set to the seconds until 00:00 UTC, where it was an
  anonymous 500; the gate counts those answers apart and names the cap (100,000
  rows written or 5,000,000 rows read a day; section 10.4c). The nightly's write
  loop waits such an answer out instead of retrying it into a cap that lasts
  until midnight: when the reset is within twenty minutes of the run's first
  quota answer it sleeps to the reset plus thirty seconds, defers every other
  writer with it and spends none of its retries or of its 90 s retry budget;
  a reset farther away fails at once as before. D1's counter need not clear at
  exactly 00:00:00 UTC, and an answer that arrives after midnight carries a
  `Retry-After` of a day, so a run that has already waited once steps every
  60 s while the clock reads within ten minutes after 00:00 UTC, inside the
  same twenty-minute bound, instead of giving up on the day-long value. That is cheap and safe because a
  publish is an idempotent upsert (the dated archive is insert-if-absent), the
  wait is bounded per run and Actions minutes on a public repository are free;
  it cannot outlive a nightly that starts hours before the reset, which stays
  red and republishable until 09:30 ET the next weekday.

Feeds read without a date (`news`, `pulse`, `flowalerts`, `sector:premium`)
carry `readDay`, the Eastern day of their own `readAt`, beside `sessionDate`;
the Worker's intraday refresh stamps the same field when it rewrites
`flowalerts` and `pulse`. The post-close run is the last writer of
`flowalerts` for the session (the Worker's refresh window closes at 16:15 ET),
so it merges its read into the stored record when that record's date is the
run's session, exactly as the Worker's refresh does, instead of replacing the
day's union with one read. It writes nothing over that record when its own read
shaped no rows, when the stored feed cannot be read, or when the record belongs
to a later session (a republish of an earlier one); it publishes a single read
only when the store holds no record for the session.

### 10.5i The live layer: the Worker clock, three tiers, one writer per key

The design lives in code: `shared/flows-freshness.js` (phases,
states, thresholds), `shared/flows-live.js` (builders and the key registry),
`shared/flows-live-worker.js` (the Worker side) and `scripts/flows-legs/live.mjs`
(the Actions side). The data contract for pages is the key registry plus the
`X-Fresh-*` headers; `assets/js/flows-fresh.js` is the one client helper.

- **The clock is the Worker cron.** `1-59/5 13-21 * * MON-FRI` runs Tier 1 (two
  vendor calls into `live:market`: the five-minute market tide and the sector-ETF
  snapshot) from the open to ten minutes past the close,
  dispatches the Actions run at :01/:16/:31/:46, and re-dispatches once when
  `live:breadth` is 45 minutes old. Every dispatch needs `GITHUB_DISPATCH_TOKEN`
  (section 10.0); without it Tier 1 still runs and the dispatches are no-ops.
  The stall is logged (`live layer stalled`, with `canDispatch`) whether or not
  the token is set. Every dispatch outcome is kept in
  `flows_clock.dispatch_why` (`sent`, `refused:<status>`, `unreachable` or
  `no-token`). The weekday field is written by name because Cloudflare counts
  weekdays from 1 = Sunday to 7 = Saturday: the numeric `1-5` this trigger
  carried until 2026-09-26 fired Sunday to Thursday, so Tier 1 never ticked on
  Friday 2026-09-25. `tests/flows-live-contract.mjs` refuses a numeric weekday
  in any Worker cron. GitHub Actions schedules use standard cron, where `1-5`
  is Monday to Friday, so the workflow files keep their numbers.
  `*/30 * * * *` refreshes the landing page's market snapshot,
  dispatches the nightly at or after 17:15 ET (once more after 18:15 ET if meta
  is still behind), and prunes `flows_tape` rows not
  served for a week. It logs `nightly missing` from 21:00 ET (close + 300
  minutes) when meta is still behind: the scheduled nightly lands about 20:00
  ET, so the old close + 180 fired falsely every weekday evening. The snapshot
  is refreshed on every firing inside the refresh window, without reading the
  stored row first, and, outside it, when the stored one is older than 25
  minutes: under the cron's own cadence, so a
  snapshot the cron wrote is due again at its next firing. Until 2026-09-27 the
  cron waited for 45 minutes of age, the same threshold `/api/markets` used, so
  outside market hours the snapshot was stale for about 15 of every 60 minutes
  and every landing-page visit in that window fetched eight Yahoo quotes
  inline, two hosts and a 5 s timeout each, before answering (production at
  19:46 UTC that day: updated 18:46, age 60 minutes). `/api/markets` now serves
  the stored snapshot at once whenever one exists and refreshes a stale one in
  `ctx.waitUntil`, single-flight per isolate; only a database with no snapshot
  fetches inline. The payload's own `updatedAt` is the instant its quotes were
  fetched, and a failed refresh re-dates the row without touching it, so old
  quotes are never re-stamped as new.
- **The board summary is its own firing.** `15,45 * * * *`, the fourth Worker
  cron, runs `refreshFlowsSummary` and nothing else, on the quarter hours
  between the housekeeping firings. It shared the housekeeping firing until
  2026-09-27: refreshing the summary parses the 118 KB brief, and a harness in
  the thread CPU clock over the production mirror (the brief, `live:alerts`
  and `live:market` as of 2026-09-25, D1 as an in-process SQLite whose own CPU
  is subtracted, twenty fresh processes each) put that firing's first run at
  14.5 ms mean (11.4 to 19.2) against the Free plan's 10 ms cap. When the cap
  struck, the market refresh and the nightly dispatch, whose D1 writes were
  queued behind the summary's parse in the same invocation, died with it. Split,
  the housekeeping firing's first run measures 7.6 ms mean (3.7 to 10.4) and the
  summary's 10.5 ms mean (8.7 to 12.8); warm, 2.9 ms and 1.4 ms. A summary
  firing the cap kills loses only that refresh, which its own stamp logic
  retries at the next quarter hour. The summary's own due logic is unchanged,
  but a firing with nothing to do no longer fetches the payload: it reads the
  stamp's four inputs (the brief row's `updated_at`, the two live rows' stamps,
  the prior summary and the clock) in one D1 batch and reaches for the 118 KB
  payload only when the stamp says work is due. With the D1 client's JSON
  round trip modelled in the same harness, that firing's first run fell from
  7.5 ms mean (5.5 to 10.2) to 5.4 ms (3.7 to 8.2) and its warm run from
  3.1 ms to 0.9 ms: the 118 KB row's deserialisation, 48 times a day, was the
  firing's whole cost. Every completed summary firing then stamps
  `flows_clock.summary_at` with its scheduled instant, after
  `refreshFlowsSummary` resolves and never inside it, so a firing the cap
  kills leaves the stamp where it was. The nightly health gate reads it
  through the ingest clock key (`summaryAt`) and fails with `HEALTH: the
  summary cron has never completed a firing (is 15,45 * * * * registered?
  wrangler triggers deploy)` while it is null, or names the last completed
  firing once it is more than 75 minutes old, two firings lost in a row on
  the 30-minute cadence; `migrations/0014_flows_clock_summary.sql` adds the
  column and the Worker's first-use path adds it to a table that lacks it.
  The housekeeping firing carries no safety net for a missing summary cron on
  purpose: one that stamped `summary_at` would hide the gate's signal, and one
  that did not would re-couple the summary's parse to the housekeeping firing
  for as long as the cron was missing, the coupling the split removed.
- **The focus modules run on the Worker's own clock.** `3-58/5 13-21 * * MON-FRI`,
  the third Worker cron, fires at minutes ending in 3 and 8, between Tier 1's,
  and writes `live:focus` for Home's Metals and Leaders modules. It is due
  exactly when Tier 1 is due on a trading day, from the open to ten minutes past
  the close (13:10 ET on an early close), and never on a weekend, a computed
  holiday (not even in Tier 1's 09:45 probe window) or a day the tape closed.
  Each tick reads `flows_clock` and the groups of the nightly `focus` key in one
  D1 batch (`json_extract`, so the payload's rows and closes never reach the
  isolate), plans the names with the same `focusStripNames`
  (`shared/flows-focus.js`) the Actions strip uses (lead first, once each, 40 at
  most; before the nightly key exists, the 22-name roster), and makes one vendor
  call: `/api/screener/stocks?ticker=…&limit=500`, the Actions strip's read with
  the same parameters. Rows come from `stripValues`, so a `live:focus` row is
  exactly a `live:strips` row, in the `live:strips` envelope under its own key:
  the session is today's Eastern day, `fresh.readAt` is the cron's scheduled
  instant and the writer is `worker@focus`. The key is on the market clock
  (cadence 300 s, live for 11 minutes, fresh for 25) with a 16 KB cap; 22 names
  are about 4.9 KB and 40 about 8.1 KB. The Worker is its only writer: the
  ingest refuses it from the Actions credential (`wrong_writer`) and from the
  nightly token (`nightly_token_scope`). A failed, empty, previous-session or
  unpriced read, or one over the cap, writes nothing, so the held row keeps its
  own read time and no value is ever written as zero; the tick logs one
  `live:focus not written` line with the reason. So does a partial read: one
  that leaves unpriced a name this tick asked for and the held row of the same
  session priced, while that row is still live (11 minutes). The same D1 batch
  lists the held row's priced names in SQL (`json_each`), so the held rows
  never reach the isolate. Home takes a source for a module only when it has a
  row for every name, so without this a transient 3-of-22 answer would drop
  both modules from Live until the next complete tick. A name the held row
  priced but this tick no longer asks for does not count, so when the nightly
  `focus` key lands mid-session and the roster changes, a complete read of the
  new roster is written at once. Once the held row is past its live window a
  partial read is written: a name the vendor stops returning holds the key
  back for two ticks at most, never for the rest of the session. `/api/flows/lk?k=focus` serves
  the key and `/api/flows/now?k=focus` reports it to the Home heartbeat, which
  re-reads it when its `updatedAt` moves. Home takes, name by name, the newer of
  the `live:strips` and `live:focus` rows whose session is at least the
  nightly's, and the module pill reads `Live · h:mm` from the row it shows;
  otherwise the nightly row and its date chip stand, as before.
  `tests/flows-live-contract.mjs` times the tick in child processes on the
  thread CPU clock over a production-size vendor body (22 screener rows carrying
  all 202 fields the probe recorded on the live screener row, 151,971 bytes of
  JSON): 3 to 4 ms for the first tick of a cold process (lazy compilation and
  the body's `JSON.parse` included; the contract holds it under 6 ms) and about
  1 ms warm, against the 10 ms cap.
- **Why the focus modules left GitHub Actions.** On Friday 2026-09-25 GitHub
  delivered three of the eight `flows-live` schedule slots the workflow then
  carried (`31 13,14` and `3 15-20` UTC), the first at 18:01 UTC against a
  13:30 UTC open, and from Wednesday to Friday every scheduled run started
  between 17:50 and 23:12 UTC. Only `GITHUB_DISPATCH_TOKEN` (section 10.0) lets
  the Worker start Tier 2 itself, and it is not set, so `live:strips` covered
  the afternoon at best and the focus modules showed the previous night's rows
  through the morning. `live:focus` needs neither the token nor Actions, only
  the Worker's `UW_API_KEY`, which Tier 1 already needs. Tier 2 still refreshes
  `live:strips` whenever it runs, and the page takes whichever read is newer.
- **A live change is always against a dated close, and every live price says how old its quote is.**
  On 2026-09-29 the vendor's `prev_close` was null on 59 of 122 strip rows and 11 of the 22
  focus rows (the same eleven names on every read, from both writers, after the close as
  well as during it), so those rows had no change and `live:movers` ranked 62 of 119
  names. `priorCloseBase` (`shared/flows-live.js`) reads the base from what the writers
  already hold: the last element of each name's `closes` in the nightly `focus` payload,
  then the `px` of the nightly boards. The Actions leg has both payloads in hand; the
  Worker's focus tick takes the last close of each name from D1 in the statement that
  already read the groups (`FOCUS_NIGHTLY_SQL`, `json_group_object` over `$.closes` with
  `$[#-1]`, about 300 bytes back), so the base costs no round trip. A payload is used
  only when its `sessionDate` is the trading day before the live session, by the same
  calendar the clocks use (weekends, computed holidays and the days the tape closed), so
  a nightly that missed a session is a base for nothing. It is dropped wholesale when the
  vendor's own `prev_close` differs from it by more than 0.05% on more than one in ten of
  five or more names that carry both (57 of 57 agreed on 2026-09-29). The vendor's own
  `prev_close` is never replaced. What was filled is stated in the payload:
  `prevFill: { date, n, from: { "focus": k, "board:long": k, ... }, agree: [agreed, checked],
  tickers }`, or `declined: "disagrees"`. SPY, QQQ and IWM have no nightly close to
  read and keep a null change where the vendor gives none. `live:movers` ranks every
  name that has a base and counts the rest as `unranked`. The boards' live overlay
  (`takeLive`) takes the live row's change or shows a dash; it no longer keeps the
  nightly change beside a live price.
  The nightly `focus` payload now prices each name at the session close it already
  carries (`px` is the last of `closes`, `prev` the one before, `chg` their ratio), not
  at the screener's post-close print, so Home shows the boards' number for the same
  name; `basis.read` lists any name still on the read price.
  Every strip row ends in `qa`: the vendor's `quote_time` (epoch milliseconds or
  seconds, or an ISO string) as whole seconds behind the read, null when absent or
  more than a minute after it. `fresh.vendorAt` is the newest quote time, held to the
  read instant. A row the vendor still dates before the session, in a strip that is
  otherwise the session's, is held out: listed in `off` (`{ n, dates }`, at most 20
  names) and in `missing`, and, when the read asked for that name, present in `rows` as
  an all-null row (143 bytes) so a module that asks for it still finds a live row for
  every name and keeps its other names live while the reader prints a dash for that
  one (an absent row would make the overview discard the whole payload for the module
  and fall back to the previous session's numbers for all of it); `returned` counts
  only rows with data. A strip that is mostly the previous session's stays `prior`. The Actions leg adds `lag: { n, p50, p90, max }` to
  `live:strips`, keeps the same three numbers per 15-minute column in
  `live:strips:series.lag`, and writes the spread and the fill into the heartbeat's
  `run.quoteLag`, `run.prevFill` and notes (`quote lag: ...`, `day change: ...`).
  The ticker quote card built from a screener row outside the universe carries the same
  `qa`, measured to the moment the card was built, so a row served from the verdict
  cache reads its real age and a null means only that the vendor sent no stamp.
  `live:gex` names carry `lagS` and the key a `vendorAt`; a per-name tape leg carries
  `lagS`. Measured on the same input: `live:strips` for 122 names 22,478 to 24,122
  bytes of 65,536 (759 for `qa` and the spread, 885 for the filled values and their
  label), `live:focus` for 22 names 4,836 to 5,497 of 16,384, the series +456 over a
  session and `live:gex` about +12 bytes a name (the ahead count and the held-out row
  above add 64 bytes to a strip, 143 for each held-out name the read asked for, and 187 to
  the series at 26 columns; measured on synthetic 22 and 122-row reads, before and after
  the held-out row, and no change in `shapeStrips` time: 45 and 229 microseconds either
  way). The focus tick's first run in a cold
  isolate costs 0.2 to 0.3 ms more CPU and a warm one less (`stripValues` now fills a
  flat array instead of a keyed object: 167 to 95 µs for 22 production-size rows),
  against the 10 ms cap.
  **The frozen-feed detector is not built.** It needs the lag distribution first, and
  nothing stored it: what the first sessions must answer is the size of `qa` for a
  liquid name in the regular session (a stamp that is the last trade reads minutes
  behind on a quiet name, a batch snapshot reads seconds), how it behaves before 09:30
  and after 16:00, and whether a quote time ever runs ahead of the read. `qa` cannot
  answer the last one, since a stamp within a minute after the read is stored as 0 and
  one further ahead as null, the same as no stamp; so `shapeStrips` also counts the
  rows whose stamp parses and lies more than that minute after the read:
  `ahead: { n, maxS }` in `live:strips` and `live:focus` (25 bytes), `lag.ahead` per
  15-minute column in the series (about 190 bytes over a session), `run.quoteAhead`
  in the heartbeat, a clause of the leg's `quote lag` note, and a clause of the
  nightly gate's note (`rows stamped ahead of the read in N column(s), most M in one`,
  or `no row stamped ahead of the read`). The run
  record and the job log carry it from the next session; `live:strips:series.lag`
  keeps the day's 15-minute spread until the series resets at the next session's
  first read, so something must copy it out before then (the nightly, or the health
  gate). The rule to test against that history is an aggregate one, never per name: in the regular session,
  the median `qa` (or the newest `vendorAt`) more than about ten minutes behind the
  read for two passes running counts the read as unanswered, through the same
  `answered: false` path a failed vendor call already takes, and the Worker's focus
  tick skips its write.
- **The landing ticker measures against the previous session.** `parseIndexQuote`
  (`shared/markets.js`) pairs each bar's timestamp with its close before it drops
  nulls, dates a bar by the exchange's own calendar (`meta.gmtoffset`), and takes as the
  base the last close dated before the quote's own day (`regularMarketTime`). With
  `range=5d`, Yahoo's `chartPreviousClose` is the close before the first bar, five
  sessions back: on 2026-09-29 the S&P 500 showed -1.27% against a true -0.26%, and
  BIST -7.25%. It is no longer read. Without timestamps the second-to-last close is
  used when the last is the quote's own; otherwise `previousClose`; otherwise the
  change is null and the strip prints a dash. Each quote keeps `asOf`, `asOfDay`,
  `prevClose` and `prevDay`. The strip prints each quote's own İstanbul time (a close
  from an earlier day reads `Close Fri`, or `Close Sep 25` past a week) and no single
  fetch-time stamp; a quote stored before this change lacks `asOfDay` and prints a
  dash, so the snapshot cannot show the old percentage in the up to 30 minutes before
  the next firing replaces it.
  Whether a quote reads as a close comes from the exchange's own session, not from how
  far the quote lags the fetch. `parseIndexQuote` keeps `meta.currentTradingPeriod.regular.end`
  as `sessionEnd` (milliseconds) only when that instant falls on the quote's own
  exchange-local day, so a response whose trading period is the next session's says
  nothing and the quote carries `null`. With a `sessionEnd`, the strip reads a quote as a
  close when it was struck no earlier than five minutes before it: the S&P 500 stamped
  20:38 UTC for a 20:00 UTC end is the close, a market that closed forty minutes ago is
  a close although the fetch came five minutes after it, and a live session whose feed
  runs forty minutes behind is a quote at its own time, never a close. A mid-session
  print that no later snapshot replaced keeps its own time and is not promoted to a
  close. Without a `sessionEnd` (a snapshot stored before this, or a response that
  lacks the block) the old reading applies: a close when the quote is more than 25
  minutes behind the fetch or an hour behind the viewer's clock. The field is
  expected in Yahoo's chart `meta` (an undocumented API), but no response could be read
  from this sandbox (Yahoo is blocked here), so the first production snapshot after the deploy must be
  read for `sessionEnd` on each of the eight quotes: a `null` on any of them is the
  fallback at work and says the block is absent or names another day for that market.
- **Tier 1 fits the Workers Free CPU cap.** Until 2026-09-24 Tier 1 also read the
  0DTE net flow and the SPY and QQQ ETF tides: three 390-row one-minute feeds,
  about 200 KB of JSON a tick. Once the session's rows filled in, a tick needed
  about 10 ms of CPU and the Free plan's 10 ms cap killed it before its D1 write,
  silently: `live:market` was written once at 09:31 and never again that day.
  Those feeds now come from Tier 2 (`live:breadth.dte.zero` and
  `live:breadth.etf.{SPY,QQQ,IWM,DIA}`); `live:market` carries the tide, the
  sector ETFs and `last.tideNet` only. `tests/flows-live-contract.mjs` times the
  tick over full-session bodies in child processes on the thread CPU clock: about
  5 ms for the first tick of a cold process (lazy compilation included) and under
  1 ms warm, against about 10 ms and 3.4 ms for the old five-feed tick on the same
  machine.
- **Tier 1 reports itself in D1.** Every tick first stamps `flows_clock.tier1_at`
  alone, then, when it did Tier 1 work, records how it ended in `tier1_why`
  (`written`, `no-feed-answered`, `over-cap`, `holiday`, `off` or
  `error:<short>`) and, when it wrote `live:market`, `tier1_ok_at`. A tick with
  nothing due (before the open, after close + 10) leaves `tier1_why` alone, so
  an `error:no-key` from the last working tick is still there when the nightly's
  health gate reads it at 17:30 ET. `/api/flows/now` returns the three as
  `tier1`; its `clock` carries only the day, the two verdicts and `closedDays`,
  and the Tier 1 telemetry and `dispatchWhy` ride on the ingest `clock` key,
  behind the pipeline's credential. A tick killed by the CPU cap reads as
  `tier1_at` moving while `tier1_why` and `tier1_ok_at` stay on the last tick
  that finished:

  ```bash
  ./tests/node_modules/.bin/wrangler d1 execute iewt --remote --command \
    "SELECT datetime(tier1_at/1000,'unixepoch') AS began, datetime(tier1_ok_at/1000,'unixepoch') AS wrote, tier1_why FROM flows_clock"
  ```
- **One market calendar, with the tape as the last word for today.** Scheduled
  holidays and 13:00 early closes are computed (`nyseHolidays` and
  `nyseEarlyCloses` in `shared/flows-quant-time.js`: the exchange's rules,
  observed-day shifts included; early closes are the day after Thanksgiving and
  3 July and 24 December when they fall Monday to Thursday). `isTradingDay` in
  `shared/flows-freshness.js` is the one test every consumer uses: today's tape
  verdict when `flows_clock` is for that day and `trading` is 0 or 1, else a
  weekday that is not a computed holiday and not in `flows_clock.closed_days`.
  The freshness clock, the nightly's expected session, the AI brief's age, the
  options engine's expiry close, the variation horizon and the cross-section
  session counts all read it, so the session after a holiday is never called
  stale and a same-day expiry on an early close has three hours left at 10:00
  ET, not six. When the NYSE changes its rules,
  `tests/flows-freshness-contract.mjs` holds the published schedule to compare
  against.
- **Anything unscheduled is read from the tape, and a closed verdict takes two
  probes.** From 09:45 ET a tick at which both Tier 1 feeds still carry the same
  earlier session (the market tide by its date, the sector-ETF snapshot by the
  weekday after its `prev_date`) is a closed probe; one lagging feed, or two
  that disagree on which earlier session they carry, is no verdict. A first
  closed probe is provisional: it is stamped in `flows_clock.closed_probe_at`
  and `trading` stays NULL. The day is closed (`trading = 0`) only when a second
  probe at least 15 minutes after the first agrees, and only then does the day
  join `flows_clock.closed_days` (a JSON array of at most 20 ISO days, newest
  last, carried across days and served as `clock.closedDays`). Any feed that
  carries today sets `trading = 1` at once. A closed day the calendar lists as
  trading is re-probed every third tick (:01, :16, :31, :46, two calls each)
  until 15:45 ET (`VERDICT.unscheduledUntilMin`; it was 11:00 ET, which made a
  vendor that lagged past 11:00 a lost day, called "Closed" and not "stale" until
  the nightly noticed), and a computed holiday until 11:00 ET
  (`VERDICT.provisionalUntilMin`), where the calendar and the tape already
  agree. A re-probe that sees today reopens the day, takes it out of
  `closed_days` and writes `live:market`. The Tier 2 loop reads a closed day
  before that deadline as a wait, not an exit: it skips its passes and re-reads
  the clock every slot, so a day the re-probe reopens gets its passes back
  without waiting for a GitHub starter; from 15:45 ET a closed day ends the
  loop. A real unscheduled closure costs 29 probes (the seven ticks that make the
  verdict and 22 quarter-hourly re-probes), 58 vendor calls where it cost 20, and,
  when the loop's 340-minute budget runs out first, one chained run that keeps
  waiting.
  `tests/flows-verdict-contract.mjs` sweeps a vendor that recovers at every
  five-minute mark from 09:31 to 15:55 and holds that Tier 1 reopens the day
  within one re-probe of it. On 2026-09-24 a single
  probe that saw a lagging vendor at 09:45 could have closed a trading day for
  good; `tests/flows-live-contract.mjs` threads a lagging vendor at 09:46 and
  today's data at 09:51 through the clock row and ends with `trading = 1`. A
  computed holiday is checked once: Tier 1 reads the tape in the 09:45 to 09:55
  ET probe window of a weekday holiday, and a tape that shows the day trading
  records `trading = 1`, so the day becomes a session and the live layer and the
  nightly dispatch run; a tape still on the previous session records `trading =
  0` at that first probe, since it agrees with the calendar and there is nothing
  for a second probe to overturn, and every later tick skips the day. The day
  does not join `closed_days`, which holds only closures the calendar did not
  know. A wrong or outdated
  holiday rule therefore costs the first quarter hour, never the session. A tide
  stuck at or before 13:05 ET for 30 minutes after 13:30 marks an unscheduled
  early close (`flows_clock.early_close = 1`), and the mark is provisional like
  the closed verdict: on a day the calendar does not list as an early close Tier 1
  keeps ticking to 16:10 ET (`inferredEarlyClose`), the phase clock still reads
  13:00 as the close while the mark stands, and the first read that shows a tide
  bar later than 13:05 ET takes the mark back and writes `live:market` in the
  same tick. The Tier 2 loop waits, without passes, from 13:25 to 16:25 ET on
  such a day and passes again from the first slot after the mark goes. Until
  2026-09-30 the mark was final for the day: a tide that answered 200 with rows
  frozen for half an hour after 13:05 closed the whole live layer, and every pill
  read "closed, session final", until the next morning's roll; no test drove a
  stalled tide into the mark or out of it. The migration is `migrations/0012_flows_clock_verdict.sql`; the
  Worker's first-use path adds the three columns to a table that lacks them.
- **A nightly session is due at 21:00 ET on every session, early closes
  included**, because the run is scheduled by wall clock: the pipeline cron and
  the Worker's 17:15 ET dispatch do not move when the market shuts at 13:00.
  The 2026-09-23 and 09-24 runs started at 23:48 and 23:56 UTC and wrote
  `meta` at 00:08 UTC, 20:08 ET, so the old three-hour grace called every
  weekday evening stale for an hour. `/api/flows/now` returns the server's
  `expected` nightly session, and the page pill dates itself by it; the pill's
  own weekday fallback uses the same 21:00 ET, and asks the server before it
  ever shows a stale it computed alone.
- **An undecided day is a trading day.** The 09:31 tick rolls `flows_clock` to
  the new day with `trading` NULL until the 09:45 probe decides it. Only an
  explicit `0` closes a day. A NULL once read as closed (`Number(null)` is `0`),
  so every tick after 09:31 skipped as a holiday, the probe never ran, and on
  2026-09-24 `live:market` was written once, at 09:31, and never again.
- **Buckets are sampled at their last row with values.** The vendor pre-fills a
  one-minute feed with a null row for every minute of the day not yet traded, so
  a five-minute bucket keeps its last row that carries a value, not its last row.
- **Tier 2** is `node scripts/flows-pipeline.mjs --live`, run by
  `.github/workflows/flows-live.yml`: sector tides, the SPY, QQQ, IWM and DIA ETF
  tides, both net-flow expiry series, one screener call for every board name, the
  incremental alert union, spot gamma by rotation, the tape, movers and news —
  37 to 41 calls a pass (the budget is 48) at a 333 ms floor, `live:*` keys only.
  The one screener call reads the three index ETFs, then every focus ticker
  (the groups of the nightly `focus` payload, which the live role may read;
  before that key exists, the `shared/flows-focus.js` roster: the three metal
  groups, the Mag 7, the metal funds and the miners), then the board names,
  160 names at most. The Worker's focus tick makes the same call for the focus
  names alone every five minutes (above), so Home never waits for Tier 2. A full session of `live:strips:series` for 160 names at
  production magnitudes is about 100 KB, so its cap is 112 KB; `live:strips`
  stays at 64 KB (about 29 KB for 160 names).
- **Tier 2 sustains itself through the session, with no new secret.** The
  workflow is one long job (`timeout-minutes: 355`, under GitHub's six-hour cap)
  that runs with `FLOWS_LIVE_LOOP=1`: a pass at once, then a pass on every
  five-minute slot until the session window closes (25 minutes after the close)
  or its 340-minute budget is spent. If the session is still open when the budget
  ends, the run re-dispatches its own workflow with the job's `GITHUB_TOKEN`
  (`permissions: actions: write`; `workflow_dispatch` is the documented exception
  to that token's no-recursion rule), origin `chain`, on `main`, and exits. The
  `flows-live` concurrency group keeps it to one loop. With `FLOWS_LIVE_KEEP=1`
  (the workflow sets it) the loop does not exit at the close, the night or the
  weekend either: it keeps ticking, chains at every budget, and dispatches the
  nightly; section 10.5k.
- **The GitHub schedule is only starters, sized by what GitHub delivered.** With
  the loop kept alive (section 10.5k) they are the backup that restarts a chain
  that broke; the sizing below is what that backup can be trusted for. From
  2026-09-23 to 09-25 GitHub created 6 scheduled `flows-live` runs for 63 slots:
  18:59 and 22:13 UTC on Wednesday (one cron line), 17:50 on Thursday (one line),
  18:01, 19:12 and 23:12 on Friday (two lines). None came before 17:50 UTC, so no
  morning had Tier 2. The runs cannot be tied to their slots: each line held
  several, and the job did not log which fired. Two readings fit them. Per line,
  it is 2 runs from 1 line, 1 from 1 and 3 from 2; the nightly's gate, which does
  log its cron, saw its only line then, the one-slot `30 21 * * 1-5`, run on all
  three days, at 23:48, 23:56 and 23:59 UTC, 2 h 19 to 2 h 29 late. Per slot, it
  is 6 of 63, about one in ten. Three days do not settle which, so the schedule
  serves both: every starter is a line of one slot, and the lines are half an
  hour apart, 32 in all, at :17 and :47 of every hour from `17 5 * * 1-5` to
  `47 20 * * 1-5`. The arithmetic assumes any delay from on time to five hours.
  Without `FLOWS_LIVE_KEEP` (the loop this section describes, and the one
  `FLOWS_LIVE_LOOP=1` alone still gives), a run that starts up to 240 minutes
  before 09:31 ET sleeps until then, and one that starts earlier exits at once. 09:31 ET is 13:31 UTC under EDT and 14:31
  UTC under EST, so the wait window is 09:31 to 13:31 UTC or 10:31 to 14:31 UTC.
  On time, the 09:47 to 13:17 starters land in it under EDT and 10:47 to 14:17
  under EST, eight each; three hours late, 06:47 to 10:17 and 07:47 to 11:17,
  eight; five hours late, 05:17 to 08:17 (seven, 05:17 being the first line)
  and 05:47 to 09:17 (eight). So for every delay from 0 to 5 h at least seven
  starters land in the 240-minute window before 09:31 ET. The first to start
  waits, and the concurrency group keeps only the newest of the rest pending,
  cancelling the others, so seven landings are seven chances at one waiter, not
  seven waiters. Read per slot, at 6 in 63, seven give about an even chance of a
  pre-open waiter (1 - (57/63)^7 = 0.50), where the four of an hourly schedule
  gave one in three (0.33); read per line, every day has one.
  `tests/flows-live-contract.mjs` counts the landings minute by minute on EDT
  and EST days, runs the loop from every slot at eight delays, and passes each
  of those days through a model of the concurrency group: exactly one run
  waits, it passes at 09:31, and the day's pre-open sleep adds up to at most 240
  minutes. From 13:17 the same lines restart a loop that died or never started.
  Every starter fires 17 minutes past a :00 or :30 mark, away from the top of
  the hour, where GitHub documents the load peaks that delay and drop schedules.
  With `FLOWS_LIVE_KEEP=1`, which production sets, none of the wait arithmetic
  applies: a starter that lands while a loop runs is the single pending run of the
  `flows-live` group, and the hop the running loop dispatches at its 340-minute
  budget replaces it (a newer pending run cancels the older), so the starters
  never run while the chain holds. A starter that lands when no loop runs, the
  chain having broken, starts a full loop at once, with no pre-open sleep and no
  early exit. `tests/flows-starts-contract.mjs` models that group over nine days
  at delivery lags from none to eight hours: one cron-started run in all, every
  hop 30 seconds after the last; a hop that fails on a weekday is followed at
  once by the starter pending behind it (eleven lines land in any 340 minutes),
  and one that fails on a Saturday by the first starter of Monday. The model
  delivers every line; GitHub has delivered between one in ten and six in ten, so
  that is the best case the backup can offer, not a promise, and it is why a
  failed hop opens the `chain` issue at once instead of trusting the backup.
- **Each run logs how late GitHub delivered it.** The first step logs the cron
  that fired and reads the run's own `created_at` from the Actions API with the
  job's token (`gh api repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID`),
  because the step's clock also counts the time a run queued for the
  concurrency group: on 2026-09-25 run 36178225980 was created at 19:12:12 UTC
  and reached its steps at 20:25:32, when the 18:01 loop ended. The delay is
  taken from `created_at` and the queue is logged on its own: `GitHub created
  this run at 11:28:40 UTC, 251 min after its 07:17 UTC slot; this step ran 0 min
  after that, the time the run queued for the flows-live concurrency group and a
  runner.` When the API does not answer, the step says so and succeeds. A run
  cancelled while pending, replaced by a newer starter or by a chain, never
  reaches a step and never logs; its `created_at` is only in the Actions API
  (`GET /repos/{owner}/{repo}/actions/workflows/flows-live.yml/runs?event=schedule`).
  Together they measure the delay the schedule assumes, and which reading of
  the first three days holds.
- **Without `FLOWS_LIVE_KEEP`, worst-case idle is 240 minutes of waiting a day.** Runs share one concurrency
  group, so only one runs at a time, and every waiting run waits for the same
  09:31: however many starters land, the pre-open wait a day adds up to at most
  `preOpenWaitMs`, 240 minutes. A run that waited that long still passes from
  09:31 for 99 minutes before it chains (the test keeps at least 60), and the
  chained run reaches 16:25 without a second chain (100 plus 340 minutes cover
  the 414 from 09:31 to 16:25; the test keeps that sum at least 414). Beyond
  that, a starter that runs outside the window costs under a minute of runner,
  one clock read from the Worker and no vendor call, so the 32 lines add under
  32 minutes a day, and one cancelled while pending costs nothing. On a day
  Tier 1 closes provisionally from the tape the loop also waits, without passes,
  until 15:45 ET at the latest (and from 13:25 to 16:25 ET on an unscheduled
  early close Tier 1 has inferred). Weekends and computed NYSE holidays never
  wait.
  The repository is public, so hosted-runner minutes are not billed. A starter
  that queued behind a running loop starts when the loop ends: inside 16:25 its
  one pass skips on the heartbeat and it exits at the next slot, and after that
  it exits at once without a pass. The first pass of a run still skips when a
  heartbeat landed under eight minutes ago, and the loop's later passes do not,
  so a chained run that starts within eight minutes of the last pass skips once
  and takes the next slot, none doubled or lost. A single pass runs when
  `FLOWS_LIVE_LOOP` is unset or `FLOWS_LIVE_FORCE=1`. Dry run: `--live --dry-run`.
  Under `FLOWS_LIVE_KEEP=1` the accounting changes: a starter that runs while
  no loop holds the group costs a whole 340-minute loop rather than under a
  minute, weekends and holidays chain too (with a clock read every 15 minutes and
  no pass), there is no pre-open wait (the loop is already ticking, and wakes at
  09:31 sharp), and the runner-minutes are the price of removing the lottery;
  section 10.5k has the cost and the switch that returns to the numbers above.
- **The loop keeps the Worker's clock.** Before its first pass and around every
  later one it reads `clock: { day, trading, earlyClose }` with a GET of the
  ingest key `clock` under its live credential (`/api/flows/now` carries the same
  view for signed-in pages). Once Tier 1 has marked the day closed from the tape
  (from 09:46 ET) the loop makes no further pass and, without
  `FLOWS_LIVE_KEEP`, never chains (with it, the loop keeps its 15-minute clock
  ticks and its chain); a scheduled holiday never starts one. A scheduled early close ends the window at 13:25 ET
  from the calendar. An unscheduled one Tier 1 marks only after 13:30, so the
  loop makes no pass after that verdict, about 13:35 to 13:40, but waits for the
  mark to be taken back until 16:25 instead of leaving. A failed clock read keeps the last verdict; with none, the
  computed NYSE calendar applies. A pass that throws is logged and recorded as errored
  and the loop carries on to the next slot. Each pass starts with a fresh 90 s
  publish/read retry budget, as each separate run had. The job exits non-zero
  only when every pass answered no vendor call or landed no key (or threw), or
  when the chain dispatch was refused with the session still open; one over-cap
  key in a pass that landed the rest stays green. The checkout keeps no
  credential (`persist-credentials: false`); only the chain dispatch holds the
  job token, through `env`.
- **Tier 3** is on demand: `/api/flows/tape?t=` (a D1 stale-while-revalidate cache
  with a 20-second single-flight lease, one leg per refresh in session) and the quote on
  `/api/flows/live?t=` (5 s in session, 30 s pre/post, 6 h closed), both behind
  the `UW_ONDEMAND` rate-limit binding. A tape is final only when its read
  covers the last close (the classifier's own test: read at or after the close
  less one cadence); outside the session a row that does not is refreshed, the
  older leg on each view, so a complete row is final after at most two views
  and three vendor calls, and the ticker page asks again five seconds after an
  answer the server calls stale. A name outside the roster and the universe is a quote card
  built from one screener read: that row is cached 15 minutes in session and,
  outside it, only while it covers the close (the known/unknown verdict keeps
  its 12 hours), and the card carries the row's own read time and the
  breadth-class `X-Fresh-*` headers. `/api/flows/news` serves `live:news` in
  place of the nightly row while it is newer than that row, under its own
  freshness headers, as pulse and the flow alerts are served.
- **What the pill judges.** It is the worst case over the sources that carry a
  server verdict: every key a heartbeat reads, and on the home page every
  region the loader reads except an overlay response (`X-Live-Overlay`), whose
  age belongs to its heartbeat key. `live:alerts` is written only when a pass
  finds a new alert, so on a quiet afternoon its own stale line passes with the
  live layer healthy; registering the flow-alerts response read once at load
  turned the home page Stale about 45 minutes into every session. Sources that
  register only a session date are judged by the newest date among them, so
  they can never turn the pill stale on their own; the popover names the older
  ones ("2 of 5 payloads are older: Regime Sep 22, Events Sep 15"). The board's
  live dots and their next poll are timed against the server's clock
  (`X-Server-Now`), not the browser's.

Out-of-band steps before the first deploy of this layer:

1. Apply the tables (idempotent; the Worker also creates them on first use):
   `./tests/node_modules/.bin/wrangler d1 execute iewt --remote --file=./migrations/0010_flows_live.sql`
   The Tier 1 telemetry columns come from `migrations/0011_flows_clock_tier1.sql`
   (three `ALTER TABLE ... ADD COLUMN`, so not re-runnable: a second run fails on
   the duplicate column and changes nothing), the verdict columns from
   `migrations/0012_flows_clock_verdict.sql` and the summary firing's stamp,
   `summary_at`, from `migrations/0014_flows_clock_summary.sql`. The Worker's
   first-use path adds any of the seven the production table lacks and
   tolerates a duplicate column, so the table upgrades itself on the first
   request after deploy. The session ledger's table, `flows_ledger`, comes
   from `migrations/0015_flows_ledger.sql` (`CREATE TABLE IF NOT EXISTS`, so
   re-runnable) and is created by the same first-use path.
2. Nothing to mint. The live workflow holds no shared secret: it runs with
   `permissions: id-token: write`, asks the runner for a GitHub OIDC token with
   the audience `https://anilkaya.org/api/flows/ingest#live`, and the Worker
   verifies it against GitHub's published keys (`shared/flows-oidc.js`). The
   token earns the live role only when it names this repository by name and
   numeric id, `.github/workflows/flows-live.yml` on `refs/heads/main`, a
   `schedule` or `workflow_dispatch` event and a GitHub-hosted runner, and it
   expires about five minutes after it is minted. The live role can write
   `live:*` keys only, read the boards and meta it plans from, and delete
   nothing, while the nightly token cannot write a live key. The workflow has
   no `FLOWS_INGEST_TOKEN` in its environment on purpose, and every action in
   the job is pinned to a commit SHA, because `id-token: write` lets any step
   mint the credential.

   The Worker still honours a static `FLOWS_LIVE_TOKEN` when one is set. That
   is for a local `--live` run against a local Worker: put it in `.dev.vars`,
   export the same value, and point the pipeline at the local route with
   `FLOWS_INGEST_URL=http://127.0.0.1:8787/api/flows/ingest` (the default is
   production). Never set it on the production Worker, where it would be a
   second, long-lived live credential beside OIDC. If an earlier revision of
   this step had you set it, delete both copies:
   `./tests/node_modules/.bin/wrangler secret delete FLOWS_LIVE_TOKEN` and the
   repository secret of the same name.

   `GITHUB_OIDC_JWKS` points the Worker at a stub key set in the Worker
   contract suite. The Worker accepts it only for GitHub's own
   `https://token.actions.githubusercontent.com/` or a loopback `http` stub;
   production leaves it unset. A key-set outage answers 503, which the
   pipeline retries, and every refusal is logged with its reason and the
   token's non-secret claims.
3. `GITHUB_DISPATCH_TOKEN` and the Worker's `UW_API_KEY`: section 10.0, items 1
   and 2.
4. After deploy, confirm all four crons are registered (`wrangler triggers` or
   the dashboard: Tier 1, the focus tick, `*/30 * * * *` and `15,45 * * * *`)
   and read `live:market` on `/api/flows/lk?k=market` at 09:36 ET
   and `live:focus` on `/api/flows/lk?k=focus` at 09:38 ET.
   The tick instants in D1 prove it without dashboard access: `flows_live.read_at`
   for `live:market` is the Tier 1 cron's scheduled time, and only
   `1-59/5 13-21 * * MON-FRI` produces minutes ending in 1 or 6; for
   `live:focus` it is the focus cron's, and only `3-58/5 13-21 * * MON-FRI`
   produces minutes ending in 3 or 8:

   ```bash
   ./tests/node_modules/.bin/wrangler d1 execute iewt --remote --command \
     "SELECT id, datetime(read_at/1000,'unixepoch') AS read, writer FROM flows_live WHERE source = 'worker'"
   ```

   On 2026-09-23 the
   first Workers Builds deploy of this layer ran under the old `*/15 * * * *`
   trigger; by that evening `live:market` was stamped 19:56 and 20:06 UTC, so a
   later production deploy (`npx wrangler deploy`) had registered both crons.
   If a deploy ever leaves stale triggers again, register them with
   `./tests/node_modules/.bin/wrangler triggers deploy` or under the Worker's
   Settings → Triggers. Until then the handler routes an unknown trigger by
   instant rather than by string (`cronJob` in `shared/flows-live-worker.js`):
   the half hour is housekeeping's and the quarter hour the summary's on any
   day; inside the 13–21 UTC weekday window it runs the focus tick at minutes
   ending in 3 or 8 and Tier 1 at every other minute, and outside it every
   other minute is housekeeping's, so no job ever runs at another's minutes.
   What a stale set actually runs follows from its minutes. The three strings
   registered before the summary cron match exactly, so Tier 1, the focus tick
   and housekeeping run and the summary never does: housekeeping no longer
   carries it. Under the older `*/15 * * * *` every firing lands on the hour,
   the half hour or a quarter hour, so it runs housekeeping and the summary and
   never Tier 1 or the focus tick. Each of the four runs only once its own cron
   is registered, and the nightly health gate says which is missing that
   evening: `HEALTH: Tier 1 never ticked on <date>` for Tier 1, `HEALTH:
   live:focus has never been written (is 3-58/5 13-21 * * MON-FRI registered?
   wrangler triggers deploy)` for the focus tick, and `HEALTH: the summary cron
   has never completed a firing (is 15,45 * * * * registered? wrangler triggers
   deploy)` for the summary, read from `flows_clock.summary_at` through the
   ingest clock key. Home shows the nightly rows, or `live:strips` when a
   Tier 2 run lands, until the focus cron is registered, and
   `tests/flows-live-contract.mjs` proves that no firing of either stale set
   reaches the focus tick and that the gate names each missing cron.

`FLOWS_LIVE_MODE = "off"` in `[vars]` is the instant rollback: no Tier 1 read, no
focus read and no dispatch; pages fall back to the nightly rows.

### 10.5j The weekly monitors

- **The vendor probe** (`.github/workflows/flows-probe.yml`) runs every Sunday at
  14:23 UTC in `--strict` mode (`FLOWS_PROBE_STRICT=1`), about 140 calls. It
  fails when an operation answers anything but 2xx, except the refusals listed
  under `gated` in `scripts/flows-probe-list.json` (the VIX term structure's
  403 without the volatility add-on, and politician holders' enterprise-only
  422), and when a field listed under `reads` (the fields the code reads) did
  not arrive. An expected refusal that starts answering is noted as a plan
  change. A dispatched run is informational unless `strict` is ticked.
- **The socket probe** (`.github/workflows/flows-ws-probe.yml`, dispatch only)
  answers the question the real-time rail turns on: whether the vendor key may
  open `wss://api.unusualwhales.com/socket` and join which channels. It makes a
  handshake with the token in the query, as a bearer header and with an Origin,
  joins each channel the rail would use on its own connection, holds up to four
  connections at once and joins up to 60 `price:<T>` channels on one. Each
  record prints status, acknowledgements, message counts, the time to the first
  frame and the median and 95th-percentile lag against the frame's own stamp,
  and only the key names of a payload, never its values (the repository's logs
  are public), and the token is redacted from every line. Run it off hours to
  learn the entitlement and in the regular session to learn lag and rates
  (`seconds` and `only` are inputs). `tests/flows-ws-probe-contract.mjs` proves
  it against a fake vendor that speaks the protocol by hand.
- **The regression suite** (`regression.yml`) also runs every Monday at 06:17
  UTC, so a fixture date that the real clock overtakes fails within a week,
  not on the next unrelated push.

### 10.5k Starts that do not wait for GitHub's schedule, and the witness that says when they fail

**Why.** GitHub delivered the nightly's `30 21` cron 139 to 216 minutes late on
the four nights measured and its backups 342 and 382 minutes late; it delivered
the first Tier 2 starter of a morning 3.8 to 8.5 hours behind its slot. The
Worker could start both itself (item 1 of section 10.0), but the token is the
owner's to create, and until it exists `flows_clock.dispatch_why` reads
`no-token` and every start is a lottery ticket. The path below needs no secret.

**What runs.** `.github/workflows/flows-live.yml` sets `FLOWS_LIVE_KEEP=1`, which
turns the session loop of section 10.5i into a loop that is never done:

| Wall clock (ET) | The loop does |
|---|---|
| Overnight, weekends, holidays | A tick every 15 minutes: one read of the Worker's clock through the OIDC ingest door, nothing else. It wakes at 09:31 sharp on the next session's morning rather than on the quarter hour. |
| 09:31 to 16:25 on a session | A Tier 2 pass on every five-minute slot, as before, and a tick after each. From the open to ten minutes past the close the tick also reads `live:market` and `live:focus`. |
| 16:25 to 17:30 | Ticks every 15 minutes. |
| 17:30 | `POST /repos/<repo>/actions/workflows/flows-pipeline.yml/dispatches` with `{ "ref": "main", "inputs": { "origin": "live-loop" } }` and the job's own `GITHUB_TOKEN`, when `meta` still holds the last session. A refused dispatch is tried again on the next slot, three times in all. |
| From 17:30 until `meta` lands | Ticks every five minutes, each reading `meta`. At 18:15, if the first dispatch was sent and `meta` is still behind, one more dispatch (30 minutes after the first at the earliest). Never a third. A refusal that is permanent (HTTP 401, 403, 404, 422: the token, the grant or the file) is capped at four calls in all. A refusal that is transient (HTTP 5xx, 429, 408 or no answer at all) is retried every 30 minutes from 18:15 until 20:30 ET, at most six more calls, so a GitHub outage of two hours still ends in a landed nightly before 21:00. The same cap applies to the repeat after a send. |
| 21:00 | The nightly check of the witness (below). |
| Every 340 minutes | The run re-dispatches `flows-live.yml` (origin `chain`, retried after 15 and 45 seconds if refused) and exits. The `timeout-minutes: 355` leaves 15 minutes of slack. |
| A pass that settles no vendor or ingest call for 90 seconds, a pass still running after 10 minutes, or a watch tick still running after 2 | The loop abandons it, re-dispatches `flows-live.yml` the same way (retried after 15 and 45 seconds), raises the witness's `chain` issue (for a hung tick only when the dispatch was refused; the report is itself held to 2 minutes), logs `live loop: pass N settled no vendor or ingest call for 90 s` (or `did not finish within 600 s`) and, at that moment, how many vendor requests had timed out in it, and exits non-zero: the run turns red and the concurrency group frees for the successor. A pass that stopped altogether costs about 4 minutes from its last settled call instead of 355. A slow or partly stalled vendor does not trip this: every vendor call settles inside its two 20 second tries, so a pass whose market-tide calls all time out still runs to the end and publishes the strips, alerts, news and the heartbeat the vendor did answer (measured: 228 seconds with 17 of 38 calls stalled). Only a pass in which nearly every call times out comes near the 10 minute ceiling, which, with the hand-over and the report, still ends inside the 15 minutes `timeout-minutes: 355` leaves after the 340 minute budget. The 90 seconds is about three times the longest a running pass goes without a settled call (a 20 second try after up to 5 seconds of controller spacing); a 429 or store-quota wait is announced to the idle clock and does not count. In the `live loop:` line, `settled no vendor or ingest call` points at something without a deadline (an ingest request, the credential request, the runner) and is a defect to fix; `did not finish within 600 s` with a timed-out count near the pass's call count is a vendor stall, and nothing in the repository needs changing for that. When the dispatch was refused, nothing restarts the loop until a GitHub starter arrives, hours late: the Worker's watchdog re-dispatches only with `GITHUB_DISPATCH_TOKEN`, which it does not hold, so restart it by hand (`gh workflow run flows-live.yml`). |

The `flows-pipeline.yml` gate proceeds for any event that is not a schedule
("Dispatched by: live-loop"), so the workflow needed no change beyond the
description of its `origin` input. The nightly then lands about 17:45 ET instead
of the 20:00 to 21:20 ET the crons produced. The late cron firing that GitHub
delivers hours afterwards finds the session archived and is the one-minute
refresh of `pulse`, `sector:premium` and `news`. 17:30 ET is the cron's own
nominal time and the earliest start measured (the 2026-09-23 manual dispatch at
17:36 ET landed at 17:47); the Worker's 17:15 ET dispatch, if the token is ever
set, goes first and this one becomes a refresh. One duplicate is possible and
harmless: a run that hands over between the dispatch and the landing dispatches
again, and the `flows-pipeline` concurrency group queues the second behind the
first.

**GitHub token semantics this rests on.** A run started by `GITHUB_TOKEN` does
not trigger other workflows, with two documented exceptions: `workflow_dispatch`
and `repository_dispatch`. The chain has proved the exception in this
repository: runs 36457410543 and 36601841007 of `flows-live` are
`workflow_dispatch` runs whose actor is `github-actions[bot]`. Dispatching the
other workflow is the same call with `actions: write`, which the live workflow
already holds. What the token gains: `issues: write`, for the witness. Every
action in the job is still pinned to a commit SHA, and the workflow still holds
no secret beyond the vendor key and the ingest URL.

**Cost.** Hosted-runner minutes are not billed on a public repository, so the
chain costs nothing in money and one runner all the time: five hops a day, seven
days a week. That is the price of removing the morning lottery, and it is a
choice you can revoke: delete the `FLOWS_LIVE_KEEP` line from the workflow and
the loop is the session-only loop of section 10.5i again, with the 32 cron lines
as its only starters. It is also the part most exposed to GitHub's terms: a
standing runner that idles through nights and weekends is not what Actions is
meant for, and GitHub may throttle or disable Actions for a repository whose
usage it judges abusive. The idle ticks (a clock read every 15 minutes) are the
smallest share of the hours, but they are the share a reviewer would point to; the
fallback is that one deleted line, and the witness names a broken chain the day it
breaks. Measured on the fake Worker (`tests/flows-starts-contract.mjs`
runs it), a weekday costs the Worker 404 ingest reads on top of the passes' own
writes (158 clock, 81 `live:market`, 81 `live:focus`, 75 `live:breadth`, 9 `meta`),
0.40% of the Free plan's 100,000 requests a day (329 before the Tier 2 check,
whose 75 reads run from 10:15 to 16:25 ET), and GitHub 10 calls (an open-issue
listing and a chain dispatch per run, and the nightly); a weekend day costs 105
reads (the clock every quarter hour) and 9 GitHub calls. Before this section, a
weekday cost about 170 clock reads and a weekend day none. The Worker's CPU per
request is unchanged: no Worker file changed, and the new reads are the ingest GETs
the passes already make, each one D1 row.

**The witness.** Every tick evaluates, from the same reads, what a reader would
see, and tells the owner when it is wrong. Five checks:

| Id | Breach | Confirmed after | Cleared after |
|---|---|---|---|
| `tier1` | From the open to ten minutes past the close, Tier 1's last tick, `live:market` or `live:focus` is more than 25 minutes old (the readers' stale line for the market class; a key not yet written today counts from the open). On a tick whose clock read failed, Tier 1's last tick is not judged (the kept clock's stamp is as old as its read), only the two keys. A Worker with `FLOWS_LIVE_MODE = "off"` is skipped. | Two consecutive ticks (about ten minutes) | Three consecutive ticks on which every one of the three has been written today and is inside the line |
| `tier2` | From 45 minutes after the open to 25 minutes past the close, `live:breadth` is more than 45 minutes old (the readers' stale line for the breadth class, and the line the Worker's own `liveStalled` watchdog draws, which the tests hold equal minute by minute). The loop is the writer, so this catches passes that run and publish nothing. | Two consecutive ticks | Three consecutive healthy ticks |
| `nightly` | At or after 21:00 ET (close plus the five-hour grace) `meta.sessionDate` is older than `expectedNightlySession`, so a missed Friday stays a breach through the weekend | The first tick when `meta` is readable and stale; two consecutive ticks when the store answered `pending` (the Worker answers `pending` for a missing row and for a failed D1 read alike, so one such answer proves nothing) | `meta` holds the expected session or a later one |
| `chain` | The run reached its budget and could not dispatch its successor after three tries; or a pass was abandoned (no vendor or ingest call settled for 90 seconds, or still running after 10 minutes; whatever the dispatch answered), or a watch tick outran its 2-minute deadline and the dispatch was refused. Its title is "The live loop stopped: a pass hung or its successor could not be started" | At once | The next loop's first tick (a successor whose first pass hangs too never ticks, so the issue stays open while the stall lasts) |
| `probe` | Three consecutive ticks read nothing through the ingest route (403, 5xx, no answer): the clock read and every key read failed, each after its retry | Three ticks | Three consecutive ticks that read something |

A failed read is never a verdict: a 403 or a timeout is `inconclusive`, changes
nothing, and only feeds `probe`; the one answer that can mean either (`pending`)
needs to repeat. A challenged read (a 403 that is not the Worker refusing the
credential, a 408, a 429, a 5xx, a timeout or no answer), the loop's clock read
included, is tried again once, one second later, inside its 10 second deadline:
each attempt has 4.5 seconds. A clock that was not read this tick is used only on
its own Eastern day and without its Tier 1 stamp, which is as old as the last read
that answered, so on such a tick `tier1` is judged on `live:market` and
`live:focus` alone. Each breach opens one GitHub Issue titled
`[flows-witness:<id>] ...`, whose body mentions `@anilkaya001` (a mention
notifies you under GitHub's default notification settings, watching or not), states the numbers and the
repair, and links the run. A persisting breach adds one reminder comment per six
hours. Recovery is declared only after the check has been healthy for the number
of ticks in the last column (about 15 minutes for the live checks), and adds a
recovery comment and closes the issue. A check that breaches again within six hours of the close it
got in the same run reopens that issue with a new comment instead of opening a
new one, so an intermittent feed (30 minutes down in every hour) is one thread
rather than one issue per outage; across a hop the memory is lost and the
first re-breach opens a new issue. A loop only adopts an open issue that
`github-actions[bot]` wrote (the repository is public, and anyone can open one
titled `[flows-witness:nightly] ...`); a loop that finds an issue a previous run
left open adopts it instead of opening a second, closes any further open issue for the same check as a
duplicate of the newest, and closes them all on recovery. An open whose answer never
arrives (GitHub made the issue, the 15-second deadline fired first) is not
retried blind: the retry lists the open issues first and adopts what it finds. The run
itself also turns red when it confirmed a lapse, its chain failed, or a pass or watch tick was abandoned, and every
confirmed breach writes a `::error` annotation on the run's page, so a repository
whose Issues cannot be written still gets a red run and an explanation. To prove the
channel without waiting for a fault, dispatch the live workflow with `drill`
ticked (`gh workflow run flows-live.yml -f drill=true`): it opens one issue,
comments, closes it and does nothing else, in a concurrency group of its own so
it does not queue behind the loop; it turns red if any step fails.

What the witness cannot see: its own death. A loop that stops and is not
restarted leaves no one to say so, and the Worker cannot notify anyone without
the token. The pieces that still speak in that case are the readers' Stale pill,
the Worker's `live layer stalled` log line, the nightly health gate (`HEALTH: the
last live pass ... so Tier 2 stopped before the close`, red on the cron-started
run that carries the owner as its actor) and the 32 starters, which restart a
loop within a few hours. Tier 2 vendor loss reaches the witness only as
`live:breadth` going 45 minutes old (the `tier2` check); the run also turns red
when every pass answered nothing, as before.

**The storage-level probe.** The OIDC live credential reads `clock`, any `live:*`
key and `board:long`, `board:short`, `board:watch`, `meta` and `focus`, one key
per request. The witness is that probe: it recomputes each verdict from the
stored row (the readers' 25-minute and 45-minute lines, `expectedNightlySession`)
rather than trusting `X-Fresh-State`, reads the Worker's own telemetry from the
clock, and treats an unreadable answer as no answer. It reads four rows and the
clock: `live:market` and `live:focus` (Tier 1), `live:breadth` (Tier 2, the key
the Worker's own watchdog reads) and `meta` (the nightly). It is deliberately
limited to those. It does not read the other Tier 2 keys, so a pass that lands
`live:breadth` but not `live:gex` goes unseen here (readers see that key's own
Stale pill); it does not read `board:long`, `board:short`, `focus` or the roster
against `meta.sessionDate`, so a `meta` that landed beside boards from an earlier
session goes unseen here; and it does not see the roster's cards or the archive
(the `keys=` route is the nightly token's). Completeness of the nightly, per-name
`sessionDate` and the archive stay with the nightly's health gate. Adding any of
them is one more read in the same tick and one more entry in `WITNESS_CHECKS`; the
cost, at one read per five-minute tick, is 75 requests a day (0.075% of the Free
plan). A `ledger` object, when the Worker's clock carries one, is parsed into the
witness's view and is not yet used: nothing reads it, and it reaches no issue text.

**The public-header probe: designed, blocked.** A probe that reads the site as a
reader does would catch what no storage read can: a Cloudflare Transform Rule
overwriting `Cache-Control` or the CSP, an HTML page whose `?v=` does not match
`/assets/version.txt`, a landing snapshot whose `payload.updatedAt` is stale
while its row is not. The design, ready to build: a pure `evaluate(input, asOf)`
in `shared/` plus a thin transport in `scripts/`, run every 30 minutes from the
loop's tick, checking that `GET /` answers 200 with `Cache-Control: no-cache` and
a CSP; that every `?v=N` in it equals `/assets/version.txt` (and the fonts against
`/assets/fonts-version.txt`); that one stylesheet and one script carry the seven
`_headers` security headers and the one-year immutable policy; that
`/api/markets` has `payload.updatedAt` (never the row's age, which a failed Yahoo
refresh bumps) inside 45 minutes in the 09:15 to 16:15 window and 26 hours
outside it; and that `/api/flows/now` answers a JSON 401 to a stranger. It is
blocked by two facts, not by effort. First, every `/api/flows/*` read needs a
Flows session, so the freshness headers as a reader sees them cannot be read
anonymously: it needs either a Flows member credential kept as an Actions secret
(a read-only member in `FLOWS_CREDENTIALS`) or a public route that returns the
per-key states without payloads, which is a Worker change. Second, Cloudflare
challenges GitHub's runners on paths the ingest skip rule does not cover (Bot
Fight Mode cannot be skipped on the Free plan), so an anonymous probe from a
runner can be served a challenge page and would need the same retry-and-inconclusive
treatment before it could be trusted; the sandbox cannot reach the site to
measure how often. Until then the header smoke test of section 7 stays manual.

**The vendor client's deadline.** `uw()` used to have none, and Node waits 300
seconds for a stalled response (measured 300.9 s on 2026-09-29), five tries per
call. In `--live` mode each try now has a 20 second deadline
(`AbortSignal.timeout`), a timed-out try is retried once, and the pass log names
how many requests timed out. `FLOWS_UW_TIMEOUT_MS` (100 to 60000) overrides the
20 seconds, which the tests use. The nightly's client is unchanged, and so are
the ingest writes, which still carry no deadline of their own. The loop's own
clock read, made before every tick, has the same 10 second deadline as each of
the watch's reads, and spends it the same way: a first attempt of at most 4.5
seconds, then, if it was challenged, one second's wait and a second attempt of at
most 4.5 seconds. A stalled ingest connection costs one tick, where Node's
default would have held the loop, and with it the witness's cadence, for its
300 second headers timeout.

**What only a real run can prove.** None of this could be executed on GitHub
from the sandbox; the fakes exercise every branch, and these are the facts they
cannot. Check them after the first deploy:

1. `gh workflow run flows-live.yml -f drill=true` ends green, and the issue it
   opened and closed appears in the repository's Issues with your mention.
   (Proves `issues: write`, that Issues are enabled, that the mention notifies.)
2. On the next session's evening, the live run's log has `starts: dispatch of
   flows-pipeline.yml (first) at 17:30 ET — sent (HTTP 204)`, a `flows-pipeline`
   run with event `workflow_dispatch` and actor `github-actions[bot]` follows,
   its gate step says `Dispatched by: live-loop`, and `meta` lands about 17:45 ET
   (`starts: the ... nightly has landed`). The cron firings that arrive later log
   `session gate: archived` and finish in about a minute.
3. Each live run ends with `re-dispatched: sent (204)` and the next run appears
   within a minute; over a weekend the runs show no passes. If a hop ever fails,
   a `[flows-witness:chain]` issue opens and the next starter closes it.
4. To watch the weekend nightly dispatch without a session,
   `gh workflow run flows-pipeline.yml -f origin=live-loop` on a Saturday is a
   same-session refresh.
5. No `[flows-witness:...]` issue is open after a healthy week. One that opens
   for a lapse Tier 1 really had is the witness working; one that opens without
   a lapse is a false positive to report with the run's log.
6. The drill's issue shows `github-actions[bot]` as its author. The witness
   adopts and closes only issues with that login, so a different one would make
   every hop blind to the issues its predecessor opened.
7. A `[flows-witness:tier2]` issue that opens on a day the readers saw
   `live:breadth` as Live is a false positive: compare its `readAt` with the
   issue's numbers. The check draws the same line as the Worker's watchdog, so
   the watchdog's `live layer stalled` log line should appear beside a true one.
8. The reopen path (`PATCH state: open, state_reason: reopened`) and the
   duplicate close (`state_reason: not_planned`) are accepted by the API. Both
   are new and the drill does not reach them; the first flap of a real week does.
9. A transient dispatch failure cannot be summoned on demand. What the tests
   prove is the cadence given the answer; the answer itself (503, 429, no reply)
   is GitHub's.

### 10.5l The per-name dossier: what each packet reads, what it costs, how to look

`GET /api/flows/dossier?t=<ticker>` (behind the Flows session; AGENTS.md has the
packet contract) assembles twelve packets for any name. It adds one table,
`flows_dossier_cache`, and no secret, no cron and no workflow. Apply the table
before the first read the way 10.1 describes; `ensureFlowsTables()` creates it on
first use as well, so a database that has not had `migrations/0016_flows_dossier_cache.sql`
applied still answers.

```bash
./tests/node_modules/.bin/wrangler d1 execute iewt --remote --file=./migrations/0016_flows_dossier_cache.sql
```

**What each packet reads.** Nothing here is a new nightly write.

| Packet | From | Vendor route (when the nightly or live layer does not hold it) |
|---|---|---|
| identity | the universe row (name, sector, market cap, rank) | `/api/stock/{t}/info`, `/api/companies/{t}/profile` |
| price | `card:T` closes, the live strip, the tape, the quote path | `stock-state` through the existing quote path, only when the live strip is older than its line |
| options | `card:T` and `card-x:T` engine, `universe`, the Neuron tier | none |
| events | the `events` row and macro calendar | none |
| earnings | `card-x:T` earnings, the universe's earnings columns | `/api/earnings/{t}` only when `card-x` holds none; `/api/companies/{t}/earnings-estimates` |
| news | `live:news`, nightly `news` | `/api/news/headlines?ticker={t}&limit=12` |
| analysts | none | `/api/screener/analysts?ticker={t}&limit=30` |
| fundamentals | none | `/api/stock/{t}/financials`, `/api/stock/{t}/fundamental-breakdown` |
| positioning | `card-x:T` short and insider parts | `/api/institution/{t}/ownership?limit=25&order=value&order_direction=desc`; `/api/shorts/{t}/interest-float/v2` and `/api/insider/{t}/ticker-flow` only when `card-x` holds none |
| flow | `live:strips`, `live:alerts`, `flows_tape`, the card's dark pool | `/api/darkpool/{t}/price-levels` when the card holds none |
| peers | the universe's sector columns and tilt | none |
| macro | `regime`, `live:market` | none |

**Cost.** The D1 batch is 13 primary-key statements in one round trip and reads
about 16 rows cold and 19 warm (the tests hold it at 20 or fewer, and flat from a
handful of payloads to a 670-name universe with 1,500 cards). A carded name makes
eight vendor calls cold, a universe-only name nine with four queued for the next
read, and a warm name none. The cap is nine a read, 2.5 s a source, 3 s overall.
The refresh writes at most five `flows_dossier_cache` rows (one batch), so a name
costs about 5 of the 100,000 daily row writes per refresh and no more than one
refresh a day for the 24-hour kinds; the whole 670-name universe read once a day
would be about 3,400 writes. Reads cost 16 to 19 rows of the 5,000,000. The
vendor calls go through `uwFetch` and the `UW_ONDEMAND` limiter, the same
bucket the ticker page's quote uses, so a burst of dossier reads can starve the
quote for the window: when the limiter refuses, the packet is `pending` and the
next read tries again, nothing is cached from the refusal.

| Kind | Cached for | Where |
|---|---|---|
| identity, fundamentals, positioning | 24 h | `flows_dossier_cache` |
| earnings | 12 h | `flows_dossier_cache` |
| analysts | 6 h | `flows_dossier_cache` |
| news | 5 min | Cache API `https://flows-dossier.internal/news/<T>` |
| dark-pool levels | 60 s | Cache API `.../levels/<T>` |
| quote | 5 s | Cache API `.../quote/<T>` |
| the whole dossier, when complete | 30 s | Cache API `.../assembled/<T>` |

A plan refusal (the spec lists the profile and earnings-estimates routes as
Advanced-plan routes) is cached with its kind for the kind's TTL, so a refused route is not asked
again for a day. A kind stale past its TTL is served and refreshed in
`waitUntil` (stale-while-revalidate). The financials and fundamental-breakdown
bodies are parsed only under a 256 KiB ceiling; a larger body is withheld with
reason `large`, because parsing it can exceed the Worker's CPU limit.

**How to look.** The text the model sees, and why it is that size:

```bash
curl -s -H "Cookie: <flows session>" "https://anilkaya.org/api/flows/dossier?t=NVDA&render=1" -D - | head -40
curl -s -H "Cookie: <flows session>" "https://anilkaya.org/api/flows/dossier?t=NVDA" | jq '{tier, coverage: .dossier.coverage, tokens: .prompt.tokensEst, shed: .prompt.shed, trace}'
```

The response headers say what the read did: `X-Dossier-Vendor-Calls` (0 on a
warm or hot read), `X-Dossier-Pending` (sources left to a timeout), `X-Dossier-Tokens`,
`X-Dossier-Fingerprint`, and `X-Fresh-State` / `X-Fresh-Reason: store` when D1
could not be read. `trace.queued` lists what the budget left for the next read;
`trace.stale` the kinds being refreshed behind the response. What is cached for a
name:

```bash
./tests/node_modules/.bin/wrangler d1 execute iewt --remote \
  --command="SELECT kind, fetched_at, length(payload) AS bytes FROM flows_dossier_cache WHERE ticker = 'NVDA';"
```

**The weekly probe.** Every vendor path the dossier reads, and the response
fields it reads from each, is in `scripts/flows-probe-list.json` (`probes`, and
`reads` under the strict check), so a renamed field fails Sunday's run instead of
silently emptying a packet. `/api/companies/{t}/profile` and
`/api/companies/{t}/earnings-estimates` are listed under `gated` with the 403 a
plan without them answers; if either starts answering 200, the probe notes a plan change
and the packets begin to fill with no deploy. The fixtures the suites run on were
written from the spec (`docs/uw-openapi.yaml`), not from a live response: the
vendor was not reachable when this was built. The first strict probe run after
this deploys is the first time the reads are checked against live bytes; read its
output for each dossier route before relying on the profile scale, `si_float` or
the ownership `units` semantics.

**What is not proven here.** The Worker's CPU for a first request in a fresh
isolate was not measured in workerd. In Node, on the harness's fake D1, a warm
dossier read costs about 7 ms and one served from the 30-second copy 2 to 3 ms,
against 2 to 4 ms for the summary route on the same fake; the first request after
process start costs about 1.6 times the summary route's, which is JIT and module
work, not steady state. If a first request exceeds the Workers Free 10 ms CPU
limit, Cloudflare reports error 1102 on that invocation. The large vendor bodies
(financials, fundamental breakdown, ownership) are the first thing to move into
the nightly in that case; the text variant and the 30-second copy are what the
model protocol should read through.

### 10.5m The per-name reading: what it does, what a generation costs, how to look, how to turn it off

`GET /api/flows/summary?t=<ticker>` carries one more field, `read` (AGENTS.md "Flows
reading" has the exact shape): the name read as a stock from its dossier (10.5l), in
plain sentences each carrying the facts it rests on. It adds no table, no secret, no
cron and no workflow: the reading lives in `flows_neuron` under scope `read:<T>`, and
the only new setting is `FLOWS_READ_MODE` in `wrangler.toml` [vars].

**What happens on a request.** The Worker looks up `read:<T>` in parallel with the
Neuron's own batch. A model reading younger than 45 minutes (`AI_INTRADAY_REFRESH_MS`)
is served as it was written: one row read, no dossier assembled. Otherwise the dossier
is assembled (10.5l: the 30-second copy, or one primary-key batch), the 22 tag rules
are evaluated, and the **deterministic reading** is returned at once, with status
`generating` while a model call runs in `ctx.waitUntil`, or `fallback` when none will.
The ticker page polls the summary and swaps the model's wording in when it lands. A
stored reading whose dossier fingerprint (10.5l) and model signature still match is
served whatever its age; one whose dossier moved is regenerated, never sooner than the
floor.

**What a generation costs.** One call through `cappedAi`, as the Neuron and the Ask box
make theirs, so `FLOWS_AI_DAILY_CAP_NEURONS` (30,000) and `FLOWS_AI_DAILY_CAP_CALLS`
apply, with one difference: the reading stops at 75% of the neuron cap
(`READ_BUDGET_SHARE`, 22,500) so a day of readings cannot take the Neuron's and the Ask
box's quarter. Its usage is recorded in `flows_ai_usage*` where the cap reads it. Sizes are the
suite's estimate (3.7 characters a token) on the harness dossiers: the system prompt is
1,139 tokens, the rendered dossier at its 4,200-token budget with the tags about 4,100 to
4,900 more, so a full prompt is 5,500 to 6,000 tokens (5,995 for the earnings-week
momentum name) and a thin name's 2,200 to 2,700. A reply is about 650 tokens when it
fills every section and cannot exceed 1,300 (`READING_MAX_TOKENS`). At the primary
model's rates (`FLOWS_ASK_NEURONS = 5500,36400`, neurons per million tokens in and out):

| | in | out | neurons |
|---|---|---|---|
| momentum name, typical reply | 5,995 x 5,500 / 1e6 = 33.0 | 650 x 36,400 / 1e6 = 23.7 | 57 |
| momentum name, longest reply | 33.0 | 1,300 x 36,400 / 1e6 = 47.3 | 81 |
| thin name (no card), typical | 2,729 x 5,500 / 1e6 = 15.0 | 23.7 | 39 |
| momentum name on the fallback model (`26668,204805`), typical | 159.9 | 133.1 | 293 |

So a day's 22,500 reading neurons buy about 395 typical readings on the primary model,
280 of the longest, or 75 if every one fell to the fallback; the free 10,000-neuron
allowance alone about 175. A name is read at most once in 45 minutes and only when its dossier
moved, so a name open all session costs at most nine readings, about 510 neurons. The
neuron cost of each reading is stored with it and printed on the page beside the model's
name. D1 writes per generation: four statements (the claim, the result and the two usage
upserts), at most eight rows with their indexes, of the 100,000 a day; reads 3 rows on a hit and 18 on a miss (30 with the
background generation's own reads of the day's spend), checked by
`tests/flows-reads-contract.mjs`. Measured Worker CPU in Node for the reading's own code
on the momentum dossier: tags 0.1 ms, fallback and shape 0.2 ms, prompt 0.5 ms, vet 1.7
ms; the dossier's assembly (10.5l) is the larger part of a miss.

**What 'fallback' means.** The reader is looking at the deterministic reading and no model
wording is coming for this dossier. `read.why` says which: `off` (the kill switch),
`no-model` (no `AI` binding or no `FLOWS_ASK_MODEL`), `store` (the claim could not be
written, so no call was made), or `cooldown` (an earlier attempt for this name failed: the
provenance names the reason). Cooldowns: a reply the vet refused, that was not JSON or that ran past 7,000
characters, 20 minutes; the daily budget or the free allowance spent, 30; no capacity, 5; a model that
left the plan, 60; an empty or length-cut answer, 60. Five requests in a cooldown are one
model call. The deterministic reading is a complete reading: tags, drivers, tensions,
unknowns and watch items, every sentence cited, built by templates over the same facts and
checked by the same rules as a model's wording. It is not a degraded error state.

**How to look.**

```bash
curl -s -H "Cookie: <flows session>" "https://anilkaya.org/api/flows/dossier?t=NVDA&render=1" | head -80
curl -s -H "Cookie: <flows session>" "https://anilkaya.org/api/flows/summary?t=NVDA" | jq '.read | {status, why, generated, label, neurons, held, retryAfterS, tags: [.tags[].code], refused, provenance}'
./tests/node_modules/.bin/wrangler d1 execute iewt --remote \
  --command="SELECT scope, guard, llm, model, generated_at, length(ideas) AS bytes FROM flows_neuron WHERE scope LIKE 'read:%' ORDER BY generated_at DESC LIMIT 20;"
```

The first is the dossier text the model is shown, with the stable ids a cite must use; the
page's link "What the model saw" opens the same. `guard` in the table is `NULL` for a clean
reading, `read:trimmed:N` when N parts were left out, `read:refused`, `read:unparsable`,
`unreachable:*` (the Neuron's own vocabulary: `budget`, `allowance`, `capacity`, `plan`,
`empty`, `length`) for an attempt that produced none, and `generating` while one is in
flight. A refused attempt keeps its `refused` list (section, reason, detail) in `ideas`.
After the first live day, count `read:refused` against clean rows: that is the refusal
rate, and the reasons say which rule a real model trips most (`invented`, `quote`,
`entity`, `unattributed`, `dealer-sign` are the likely ones).

**How to turn it off.** `FLOWS_READ_MODE = "off"` in `wrangler.toml` [vars] and deploy. The
summary field then carries the deterministic reading with `why: "off"`, no `read:` row is
read and no model is called for it; the Neuron's own reading is untouched. Anything but
`off` (including unset) is on, and the shipped value is `"on"`. The dashboard's variable
list is overwritten by a deploy, so change the file. The Ask box's dossier facts need no
switch: they cost no model call of their own, and a question with no ticker costs nothing.

**What is not proven here.** That a live model keeps to the prompt: every suite replays
scripted replies, so the refusal rate and the model's habit of copying a description are
unknown until the first day of readings. The thresholds of the 22 tags are reasoned
(each in the commit that set it) and not tuned against outcomes. The neuron figures use
an estimate of tokens, not the model's tokenizer; the stored cost is from the usage the
binding reports, and `FLOWS_ASK_NEURONS` must be the model's real rates for it to mean
anything. The dossier route and the reading share the 3 s vendor deadline, so a name seen
for the first time answers `generating` with no sections when its dossier takes longer
than 1.5 seconds to assemble, and fills in on the next poll.

### 10.5n The real-time rail: one Durable Object, demand-driven REST polling, hibernating WebSockets

**Why.** The stored live keys are minutes behind the vendor (Tier 1 every five
minutes, Tier 2 every fifteen), the quote card is 5 s and the tape 60 s on
demand, and every reader pays for its own poll. `Pulse` holds one polling loop
for everyone: a connected viewer sees prices and flow alerts about 5 s behind
the vendor, the market tide and sector ETFs about 10 s, dealer gamma about
10 to 15 s a name, and news about 30 s, each frame carrying its honest age.
Tier 1, Tier 2 and the nightly are unchanged and are the fallback; the rail
adds no `live:*` key and writes nothing to D1.

**What runs.** One class, `Pulse` (SQLite-backed, migration `v1`), bound as
`PULSE` and exported from `worker.js`. There is one named instance, `pulse:1`,
placed with `FLOWS_RT_HINT` (`enam`; honoured once, on the first `get()`). It
polls only while a socket is connected or a `/api/rt/snap` request is less than
60 s old, and only between 04:00 and 20:00 ET on a trading day, driven by its
own alarm every second. No viewer, no vendor call, and only the topics a viewer
names are polled: a socket's `k`, or a `/api/rt/snap` topic for 60 s after the
request. Per minute, for each topic someone is watching: px 12 calls, fl 12, mk
12 (two calls every 10 s), nw 2, and gx 4 per focus ticker (one name every 15
s, at most three names, only for sockets that ask gx with a focus ticker; no
page does today). The home page (px, mk, nw) costs about 26 calls a minute, a
board, the ticker, the market or the unusual page about 12, against the rail's
own budget of 240 (`FLOWS_RT_CALLS_PER_MIN`). The budget is
separate from the `UW_ONDEMAND` limiter, which the rail never touches.

**Kill switches (vars in `wrangler.toml`, no secret).**

| Var | Values | Effect |
|---|---|---|
| `FLOWS_RT_MODE` | `on`; anything else, or unset, is off | Off: all three routes answer JSON 404 `rt_off`, even to an anonymous caller, and every open socket is closed with 4011 and a `bye` frame. A missing `PULSE` binding is the same. |
| `FLOWS_RT_AUDIENCE` | `members`; anything else is `owner` | Owner: only the names in `FLOWS_RT_USERS` may open a socket or read `/api/rt/snap`. Members: any signed-in Flows member. |
| `FLOWS_RT_USERS` | comma-separated member names, default `anilkaya` | Flows has no owner concept; this is it. Empty admits nobody. `/api/rt/status` is owner-only under either audience. |
| `FLOWS_RT_HINT` | a Cloudflare location hint | Where the object is first created. |
| `FLOWS_RT_CALLS_PER_MIN`, `FLOWS_RT_USER_CAP` | 10 to 1200, 1 to 10 | The vendor-call budget (240) and sockets per user (3). |

Turning the rail off is a one-line deploy (`FLOWS_RT_MODE = "off"`), or a dashboard
edit of the var; the next deploy of the Worker also restarts the object and
drops every socket, and clients reconnect with jitter. Deploy outside 04:00 to
20:00 ET on trading days when you can.

**Reading `/api/rt/status`** (owner session, JSON): `running`, the epoch `ep`,
`session`, `phase`; `upstream` (`kind: "rest"`, whether the key is present,
whether the base URL is redirected, the 429 pause); `sockets` by user;
`roster` (names, focus tickers, the gamma rotation, the last D1 read and its
error); `calls.minuteTotal` against 240; and per topic: `sq`, rows held,
`lastFrameAgeMs`, `lastError` with its code and instant, `lagMs` (hub receive
time minus the vendor's newest timestamp in the frame, p50, p95, max over the
last 256 frames), `rowLagMs` for px (the same, per updated quote), `calls`
in the last minute and hour, and the `fresh` entry the next frame would carry.
`degraded` is non-null while a topic is down.

**What to watch.**

1. `topics.px.rowLagMs.p95` in the regular session. The rail's promise is a
   frame at most about 5 s behind the vendor; if the vendor's own quote stamps
   run 30 s behind, every px frame is `fresh` with reason `vendor-lag`, and that
   is the vendor, not the rail. This is the number the old design could not
   see; it is the first thing to read on the first Monday.
2. `topics.<k>.fresh.reason`: `vendor-unstamped` on px means the screener sent
   no `quote_time` and no frame can claim live.
3. `calls.minuteTotal` stays near 100; a value at 240 means the budget is
   refusing polls and `degraded.reason` is `budget`.
4. `degraded.reason`: `vendor-throttled` (a 429; the pause honours `Retry-After`
   and is jittered), `http_5xx`, `timeout`, `network`, `parse`, `no-key`.
5. Workers Logs: the rail logs only unexpected failures (`rt tick failed`,
   `rt message failed`, `rt roster read failed`, once a minute at most).
6. Cost: with a viewer connected the object is awake for the session, 16 h x
   0.128 GB is about 7,400 GB-s a day, under the 400,000 GB-s a month included;
   alarms and polls are about 60,000 requests a day, and outgoing WebSocket
   messages are free. With nobody connected it costs nothing.

**The wire.** The envelope, the five topics, the control frames, the close codes
and the 256-byte client messages are frozen in `shared/flows-rt.js` and
summarised in AGENTS.md "Real-time rail". Two behaviours to know: every topic
has its own sequence counter (a shared one fabricates gaps), and a client must
treat `ctl.bye` as final and close its own end, reading the code from the frame:
in the local runtime a server-initiated close of a socket that has never sent a
message is acknowledged on the wire but never surfaces as a `close` event in the
client.

**The seam, and the two upgrades it is built for.**

- **A separate Worker.** The class talks to nothing but its own `ctx`, `env` and
  the request the main Worker forwards, and `worker.js` reaches it with
  `env.PULSE.get(env.PULSE.idFromName("pulse:1"))`. To move it: create a Worker
  (for example `anilkaya-rt`) whose entrypoint is `export { Pulse } from
  "./shared/flows-rt-hub.js"`, with its own `[[migrations]] new_sqlite_classes`,
  the `DB` binding (read-only by convention: it reads `flows_payload` and
  `flows_clock`), the `UW_API_KEY` secret and the same vars, no routes and
  `workers_dev = false`; then add `script_name = "anilkaya-rt"` to the binding
  in `wrangler.toml` and remove the class export and migration from the main
  Worker (the migration order matters; see Cloudflare's "transfer a class"
  procedure). The point is that a site deploy would no longer restart the object.
  Nothing in `shared/flows-rt*.js` changes.
- **A WebSocket upstream.** The hub talks to its upstream only through
  `start(plan, handlers)`, `stop()`, `tick(now)`, `paused(now)` and `state()`; it
  receives neutral frames `{ k, readAt, items, vendorAt, meta, full, answered }`
  in the wire's own row shapes and merges, sequences, ages and broadcasts them.
  Every REST detail (paths, the `newer_than` cursor, the gamma rotation, the 4 s
  deadline, the 429 pause) lives in `createRestUpstream`. `RT_UPSTREAM` in
  `shared/flows-rt.js` is the one table that maps a topic to its REST request and
  to the vendor socket channels it would join: px to `price:<T>` (and
  `stock_screener` later), fl to `flow-alerts`, gx to `gex:<T>`, mk to
  `market_tide` and `net_flow:<T>`, nw to `news`. A socket upstream is a second
  factory passed to `RtHub`; `tests/flows-rt-contract.mjs` drives the hub with a
  push-style fake to prove no REST assumption is left in it. It is not
  implemented, and the shapes of the vendor's frames and their lag are unmeasured
  until a regular session has been read.

**Verification, and what is unproven.**

1. `FLOWS_TEST_SANDBOX=1 node tests/flows-rt-server.mjs` runs the rail in real
   workerd with persisted Durable Object storage (raw workerd with in-memory
   storage crashes when an alarm fires) against a fake vendor on loopback.
2. `./tests/node_modules/.bin/wrangler deploy --dry-run` validates the binding and
   the migration. The first real deploy applies migration `v1`.
3. After the first deploy, as the owner: `curl -s -b <cookie> .../api/rt/status`
   returns `running: false` with nobody connected, and a socket opened from the
   browser console (`new WebSocket("wss://anilkaya.org/api/rt/ws")`) receives a
   `hello` and then frames within a second. Confirm the 101 carries the seven
   security headers and that the dashboard's Transform Rules did not rewrite them.
4. Not proven anywhere in this repository: the live vendor's response to a 5 s
   screener cadence, the real quote-time lag, the production latency of the
   edge-to-object hop and the hibernation behaviour under a real idle period.
   The harness has measured the hub's own overhead only.

#### The browser half: what the client does on each rung

`assets/js/flows-rt.js` (`FlowsUI.rt`, no new global) is loaded by the boards, the
home page, the market page, the unusual page and the ticker. It assumes no
cadence, only the envelope in `shared/flows-rt.js`, so a vendor socket upstream
replaces the REST one with no client change.

| Rung | When | What the page does | Label |
|---|---|---|---|
| Socket | `hello` received | One `wss://<host>/api/rt/ws?k=<topics>&f=<focus>` per tab, topics refcounted across the page's handles. Snapshots replace a topic's state, deltas apply only at `sq + 1` in the same `ep`. A gap sends `{"t":"rs","k":...}` (retried every 2.6 s, past the server's 2 s floor) and holds the topic until its snapshot; a new `ep` discards the topic's state; `{"t":"p","sq":{...}}` goes out every 30 s. Silence for 16 s (100 s once a `closed` frame has said the market is shut) drops the socket. | `Socket` |
| Poll | the socket failed, or `bye` said 4001, 4003, 4009, 4011 or 4012, or the upgrade never answered in 10 s | `GET /api/rt/snap?k=...` every 5 s, each answer a set of snapshots applied the same way. The socket is probed again after about 1, 2, 4 and 8 s, then once a minute; a `hello` ends the polling. A `closed` frame stops the polling until the open it names (never sooner than 30 s). | `Polling 5 s` |
| Heartbeat | three snapshots in a row failed (network, 5xx, 429) | Only the pages' existing 20 to 60 s heartbeats and REST reads feed the page; the client keeps probing on its backoff. | `Heartbeat` |
| Off | the snapshot answered 400, 401, 403 or 404 (not signed in, outside `FLOWS_RT_AUDIENCE`, `FLOWS_RT_MODE` off, route absent) | Nothing is asked again until the page is reloaded; the page behaves as it did before the rail. A 403 or 404 is also kept in `sessionStorage` (`flows:rt:off`) for ten minutes, so the other Flows pages of that tab do not probe. | none |

The heartbeats and the REST reads run on every rung, unchanged. While frames are
arriving a board ignores the polled `lk?k=strips` read (it still asks every 60 s)
and the home page ignores the polled strips, and both pages append the streamed
tide points to the polled series instead of replacing it, so an older polled read
cannot overwrite a newer streamed one; after 20 s without a px frame the polled
read takes the page back. A tab hidden for 30 s closes its socket and clears every
timer; becoming visible reopens it at once.

Freshness stays honest. Each frame, at most once a second per topic, registers an
`rt:<topic>` entry built from the frame's own `fresh` and the hub's `at`, so a
quote the vendor stamped 40 s ago is `fresh`, never live, and the pill is told
"Live" (a price-read time) only by a px frame whose state is `live`. When the
transport leaves the socket every `rt:*` entry is dropped, so a socket that died
cannot leave the pill stale and the REST classes speak again.

**Seeing the transport.** The freshness pill's tooltip and accessible name end in
the feed (for example `Live · Socket`), and its popover has a `Feed` row. In the console,
`FlowsUI.rt.transport()` is `socket`, `poll`, `heartbeat` or `off`;
`FlowsUI.rt.status()` lists the closed and degraded state and, per topic, the
sequence, whether it is synced or resyncing and the row count;
`FlowsUI.rt.measure()` counts frames, bytes, gaps, duplicates, orphans, resync
requests, socket opens, polls, timers and listeners held, and the time spent in
the receive path (`ms`, `maxMs`, and `kinds` as `[frames, bytes, ms]` per frame
type).

**When it sticks on Polling.**

1. `FlowsUI.rt.measure().opens` rising about once a minute means the socket is
   being refused. Network, then WS, in the browser's developer tools shows the
   upgrade's HTTP status, which the page's script cannot see: 403 is the
   audience or the origin check, 404 `rt_off` the kill switch (the snapshot
   would then say `off`, not `poll`), 426 a proxy that stripped `Upgrade`.
2. A `ctl.bye` with code 4009 means the account already holds three sockets;
   close other tabs, or read `sockets.byUser` in `/api/rt/status`.
3. A Content-Security-Policy violation on `wss:` means `connect-src` lost
   `wss://anilkaya.org`; the policy comes from `worker.js`, so compare the live
   header with the repository after any dashboard Transform Rule change.
4. The zone setting Network, WebSockets must be on.
5. 4012 means the hub holds its 200 sockets.

With the rail off, the first page load of a tab costs one refused upgrade and one
404 snapshot, and the browser console prints two error lines for them; that is
the whole price of finding out.

Polling is a working rung, not a fault: it carries the same frames every 5 s.
It costs more bytes than the socket because each answer is a whole snapshot.

**Measured** (`RT_ONLY=measure node tests/flows-rt-client.mjs`, real clock, the
real hub over a bridged socket against the fake vendor, 157 names, a vendor
that moves every row on every poll, so the worst case for deltas; sandbox CPU):

| | Result |
|---|---|
| Receive path for one px frame (32,042 B, 157 rows: parse, merge, queue, register) | 0.8 to 1.0 ms mean; fl, gx, mk and nw frames 0.2 ms |
| Board listener in the animation frame, all 157 rows changing | about 9 ms mean, 15 to 18 ms worst; 270 DOM mutation records, no row rebuilt |
| Bytes a minute on the socket, board (px only) | 384 KB |
| Bytes a minute on the socket, all five topics | 433 KB: px 12 x 32.0 KB, fl 12 x 1.75 KB, gx 60 x 0.39 KB, mk 6 x 0.46 KB, nw 2 x 0.79 KB |
| Bytes a minute on the poll rung | px alone 388 KB; all five topics 1.6 MB (a whole snapshot is 134 KB, 81 KB of it fl) |
| Bytes a minute today, heartbeats and polled reads | `now` about 2 KB every 30 s, plus a 30 KB `lk?k=strips` body each time its stamp moves (every 5 to 15 minutes): under 10 KB a minute |

The socket therefore moves roughly forty times the bytes of today's heartbeats
when every quote changes on every poll. These are uncompressed JSON string
lengths; whether Cloudflare compresses the WebSocket frames (permessage-deflate)
or the snapshot answers is not measured here, and a quiet name changes no row.
If the bytes matter, the lever is on the server: fewer px names, or a slower px
cadence for the names no module on the page shows.

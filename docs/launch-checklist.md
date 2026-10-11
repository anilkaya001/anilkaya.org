# Launch checklist: the first paying member

Source: the go/no-go list of the programme plan (section 3.7). The first paying member is admitted only when every line below is true. `node scripts/launch-readiness.mjs` reads each line from config, routes and the recorded readbacks in this file and prints which are true; `tests/launch-readiness.mjs` holds the reader and fails the build if any paid surface exists while a line is false.

A paid surface is any of: `shared/plans.js`, a `subscriptions` or `billing_events` table in `schema.sql` or `migrations/`, a `/api/billing/` route in the Worker, or `FLOWS_BILLING_MODE` set to anything but `off`. Billing (P4-01) ships behind that switch, `off` or absent by default.

Classes shown to members: A, B, C, D

## Lines

1. OD-01 answered and the plan matches the caps in wrangler.toml.
2. OD-03a's written vendor answer covering every data class shown to members, and OD-37's price and tiers.
3. OD-06 counsel on ranked ideas; neutral forms live (P1-63).
4. Accounts, session v2, entitlements, audit, legal pages, deletion and export live (P2-24..P2-27).
5. Limiters live: Lab, login, member vendor, Ask, prefs writes (P0-10, P0-11, P0-13, P0-16, P3-35).
6. Deploy gate: test required on main (A-15) and staging in place (P2-33); the five audited promotions dropped by OD-02 (c).
7. Revocation closes sockets within one roster refresh (P1-35).
8. Status members view and alerts live (P1-25, P2-03).
9. A restore drill done in the quarter (OD-24).
10. Tier 2 off GitHub for any paid live data class (P2-08), or live classes excluded from the plan. (either part)

## Parts

Every part is a repository check the script runs against config, schema, routes and source, a readback that someone with the access records below, or a part dropped by an owner decision. Line 10 is true when either of its parts is; every other line needs all of its parts.

| Part | Line | Kind | Check |
|---|---|---|---|
| 1a | 1 | readback | A dated readback of the Workers plan from the Cloudflare invoice or plan page, as plan=paid or plan=free. |
| 1b | 1 | repo | FLOWS_AI_DAILY_CAP_NEURONS in wrangler.toml is the cap of the recorded plan: 30000 on paid, at most 9000 on free. |
| 2a | 2 | readback | The vendor's written answer, dated, as classes=A+B+C+D naming every data class the checklist lists as shown to members. |
| 2b | 2 | readback | The launch price and tiers, dated, as price=<amount> and tiers=<count>. |
| 3a | 3 | readback | Counsel's written answer on ranked ideas, dated, as counsel=ranked-ideas. |
| 3b | 3 | repo | No verdict word in VERDICT_WORD begins with an imperative verb. |
| 4a | 4 | repo | schema.sql and the migrations create the accounts and audit_log tables. |
| 4b | 4 | repo | The Worker serves /api/account (deletion), /api/account/export and /auth/refresh. |
| 4c | 4 | repo | The privacy, terms and disclaimer pages exist under legal/. |
| 4d | 4 | repo | shared/session.js carries the session v2 claims sub, role, plan, ent, sv, exp and rexp. |
| 5a | 5 | repo | wrangler.toml declares the LAB_WRITE, LOGIN_IP, LOGIN_NAME, MEMBER_VENDOR, AI_ASK and PREFS_WRITE limiters and the Worker reads each from env. |
| 6a | 6 | readback | A dated readback of the repository ruleset on main requiring the test check, as ruleset=test-required. |
| 6b | 6 | repo | regression.yml has the test job, and wrangler.staging.toml names a D1 database and a PULSE binding of its own. |
| 6c | 6 | dropped | Five audited promotions through a release branch (P1-01). Dropped 2026-10-10 17:45 UTC by OD-02 (c): main deploys on merge, and every merge waits for green CI. |
| 7a | 7 | readback | A dated readback that a revoked member's socket closes within one roster refresh, as revocation=closed-within-refresh, naming the suite that proves it. |
| 8a | 8 | readback | A dated readback of the members status view, as status=members-view, naming the suite that proves it. |
| 8b | 8 | readback | A dated readback that the alert channel delivered a test alert, as alerts=delivered. |
| 9a | 9 | readback | A restore drill from a private export or Time Travel, dated within the last 92 days, as drill=restore. |
| 10a | 10 | repo | wrangler.toml sets FLOWS_TIER2 to worker, so Tier 2 runs off GitHub. |
| 10b | 10 | readback | Or a dated readback that the plan excludes the live data classes, as live-classes=excluded. |

## Recorded readbacks

One row per observation, appended and never edited: the part, the UTC date, who read it, the evidence with the `key=value` tokens the part names, and, where the part asks for one, a registered suite from `tests/suites.json`. The newest valid row for a part counts. A row with an unknown date, a future date, a missing token, an unregistered suite or (part 9a) an age past 92 days is ignored and the part stays open. Do not record a readback you have not made: the vendor email, counsel, the ruleset and the restore drill stay open until the owner reports them.

| Part | Date (UTC) | By | Evidence | Suite |
|---|---|---|---|---|
| 1a | 2026-10-10 | owner | plan=paid; Cloudflare invoice dated 2026-09-30 (Workers Paid, period to 2026-10-29) and the Subscriptions screenshot showing Workers Paid active, attached by the owner in the 2026-10-10 08:36 UTC update | |

## Decisions that shape the lines

- OD-02 (c), 2026-10-10 17:45 UTC: main keeps deploying on merge and every merge is made only on green CI. The release branch, the promote job and the five audited promotions of the original line 6 are dropped (part 6c). The test required on main (6a) and staging (6b) stay.
- OD-34: the paid product is Flows only; the Lab stays free and is not a line here.
- Every switch defaults off: no readback above enables anything. Opening the paid surface is the owner's step after the script prints READY.

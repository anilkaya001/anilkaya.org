export const meta = {
  name: 'flowlab-reads-fix',
  description: 'Root-cause and fix the Flow Lab views that fail or read empty on production, with tests, PR, CI to green and merge',
  phases: [
    { title: 'Diagnose', detail: 'every Flow Lab read against the spec, the probe shapes and the production evidence' },
    { title: 'Challenge', detail: 'refute the causes and stress the fixes' },
    { title: 'Build', detail: 'worktree, fixes, tests with planted wrong builds, draft PR' },
    { title: 'Review', detail: 'correctness and reader lenses on the pushed diff' },
    { title: 'Ship', detail: 'apply verified findings, CI to green, squash-merge' },
  ],
}

const SP = '<scratchpad>'
const REPO = '<checkout>'
const WT = SP + '/flowlab-fix'
const BRANCH = 'claude/flowlab-reads'

const EVIDENCE = `
PRODUCTION EVIDENCE (read 2026-10-28 13:15 to 13:20 UTC by the owner's signed-in session; US market closed, last session 2026-10-27). Full response bodies: ${SP}/view/evidence/flowlab-bodies.json and ${SP}/view/flowlab-probe.json; screenshots ${SP}/view/flowlab-*.png (read them).
1. Strikes tab: GET /api/flows/flowlab/name?t=QQQ&view=strikes answers 502 {"error":{"code":"chain_upstream","message":"Market data provider returned an error"}}; AAPL the same. Both modules print "Unavailable. Reading the feed failed." server/flowlab.js reads strike-flow-intraday (/api/stock/{ticker}/flow-per-strike-intraday) with {date: session} and a 12 s deadline. whyOf files every error other than chain_timeout, chain_rate_limited and upstream 404, 401, 402, 403, 422 as "failed", and HARD_FAILURES throws "failed" as chain_upstream. So the 502 can be a feed 4xx or 5xx, a network failure, an unparsable body, or chain_too_large against MAX_BYTES 524288. One row per strike per minute for a whole session of QQQ or AAPL plausibly runs to many megabytes.
2. view=recent: 200 with 50 rows, every figure null except e, all "2026-10-28": {"e":"2026-10-28","callC":null,"putC":null,"callAskC":null,...,"netC":null}.
3. view=levels: 200, calls 2, x.reads = {"options":null,"stock":"failed"}, stockRead false, every bin's lit, off and offShare null. The Ladders tab prints "Stock levels: Unavailable." beside an empty right panel.
4. nightly?k=groups, k=corr and k=venues answer {"status":"pending"}. Groups prints "The nightly group read has not landed."; Relations is the same. The nightly has not run since Flow Lab shipped. The owner's standing goal is that nothing waits on a nightly: a view must not sit empty until a nightly lands.
Screen, Greeks, Routing (per name) and Lit prints read correctly.
`

const RULES = `
Standing rules from the owner (on top of AGENTS.md, which you already have):
- Never call the market data feed's API, never read UW_API_KEY, never use an MCP server named after the feed. Work only from the code, docs/uw-openapi.yaml, scripts/flows-probe-shapes.json, tests/fixtures-flowlab.json, tests/gen-flowlab-fixtures.py, tests/lib/flowlab-world.mjs and the production evidence. Fixtures are synthetic with the reserved invented tickers.
- Never write "vendor" or the feed company's name in served copy, PR titles, PR bodies or commit messages; say "the feed" or "the source". Code identifiers may stay.
- Every time shown in TRT. Pages one screen with no page scroll at 1920x1080, 1440x820, 1024x768 and 390x844. An absent value is an em dash with its reason, never a zero. Never the word "tape". No unsided premium as a peer bucket; a lean is an interval with its sided share.
- No comments in any source file; the reasoning goes in the commit message.
- Decide and record the reason; never leave the owner a decision.
- Budget: a member-facing feed read stays behind vendorGate and the per-call UW_ONDEMAND tokens; prefer one Cache API copy shared by every member (internalKey, edgeCache, serveCachedVendorRead single flight) over repeated feed calls; price any D1 statement in rows.
- Never touch ${REPO}'s working tree (it is on another branch someone else is using). Work only in your own worktree. Use absolute paths and git -C everywhere.
- Another agent is merging other pull requests into main at the same time. When main moves, merge origin/main into your branch (never rebase or force-push), take main's assets/version.txt and ?v= values on conflict, then run node scripts/bump-assets.mjs and node scripts/bump-assets.mjs --check, node scripts/gen-docs.mjs, node tests/lib/suite-registry.mjs --write.
`

const LESSONS = `
CI lessons this repository has already taught (check each before every push):
- math-format ratchet: no new toFixed, toPrecision, toLocaleString, Intl.NumberFormat or Math.round(x * 10 or 100) in assets/js; printed figures go through FlowsUI.F, geometry through a truncating helper; node tests/math-format.mjs --write-sites only after lowering.
- flows-weight: a route's deferred allowance is raised only through a named constant that carries its reason.
- flows-motion: a max-width media query must end in .99 when a min-width of the same value exists anywhere.
- flows-vendor-extras: every registry operation must be marked read or added in docs/vendor-coverage.md; flows-probe-contract and flows-floor-funds hold registry counts (100 today) that move with the registry.
- flows-status-render counts switches (19 today); a new [vars] switch moves it.
- New files need a docs/modules.json row, then node scripts/gen-docs.mjs; new suites need tests/suites/<name>.json with a command and a shard pin (node tests/lib/suite-registry.mjs --write, then node run-contract.mjs from tests/; node run.mjs --repin only if the balance breaks).
- Any change under assets/css, assets/js or assets/data needs node scripts/bump-assets.mjs then --check; fonts untouched.
- If the nightly's dry-run emit changes, regenerate the golden manifest with node tests/flows-pipeline-golden.mjs --write.
- Sandbox: PLAYWRIGHT_BROWSERS_PATH=<browsers> for Chromium suites; FLOWS_TEST_SANDBOX=1 for workerd suites; known sandbox-only reds (green in CI): flows-pages-render login at 320, flows-net-render fonts, flows-market-onescreen 1024 prints, flows-ticker flaky.
- Before a push: node scripts/prepush.mjs --base=origin/main from the worktree, plus every suite the change touches by name.
- Commit messages end with the two lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPrdwKQktqNrpNhW5WezLY
- A pull request body ends with:
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TPrdwKQktqNrpNhW5WezLY
- Any GitHub comment you post ends with a blank line, ---, and _Generated by [Claude Code](https://claude.ai/code)_ . Post comments only when necessary.
`

const DIAG_SCHEMA = {
  type: 'object',
  properties: {
    defects: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, view: { type: 'string' }, symptom: { type: 'string' }, rootCause: { type: 'string' }, evidence: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, fix: { type: 'string' }, feedCalls: { type: 'string' }, d1Rows: { type: 'string' }, tests: { type: 'string' },
    }, required: ['id', 'view', 'symptom', 'rootCause', 'evidence', 'confidence', 'fix', 'feedCalls', 'd1Rows', 'tests'] } },
    otherViews: { type: 'array', items: { type: 'object', properties: { view: { type: 'string' }, verdict: { type: 'string', enum: ['ok', 'defect', 'risk'] }, note: { type: 'string' } }, required: ['view', 'verdict', 'note'] } },
    instrumentation: { type: 'string' },
  },
  required: ['defects', 'otherViews', 'instrumentation'],
}

const diagnose = `You are diagnosing the Flow Lab page (/flows/flowlab/) on production. Read every file it uses: server/flowlab.js, server/routes/flows-flowlab.js, shared/flows-flowlab.js (reducers), shared/flows-flowlab-copy.js, shared/flows-page-flowlab.js, assets/js/flows-flowlab.js, assets/js/flows-drill.js, scripts/flows-legs/flowlab.mjs, scripts/flows-nightly/sections/flowlab.mjs, the registry entries in shared/flows-vendor-ops.js, uwFetch and its byte cap in the worker closure, the response schemas of each operation in docs/uw-openapi.yaml, the observed wire shapes in scripts/flows-probe-shapes.json, and the tests and fixtures. Read origin/main with git -C ${REPO} show origin/main:<path> or make a detached worktree of origin/main under ${SP}/flowlab-diag (remove it when done).
${EVIDENCE}
${RULES}
For defects 1 to 4, find the root cause with evidence (file:line, spec lines, wire shape keys) and a confidence. For 1, settle which failure class is most likely and whether a request that reads less exists: the spec's own parameters for flow-per-strike-intraday (read the filter parameter's documented values), the daily /api/stock/{ticker}/flow-per-strike, or a byte cap that is safe for a Worker's CPU and memory. For 2, compare the reducer's field names and types with the documented and observed shape of flow-recent; work out what one row of that endpoint really is. For 3, find why the stock half fails while the options half works. For 4, decide how each nightly-only view fills on demand with the market closed and open, shared by every member through one cached copy, within the gate and the per-call tokens, and what it says while it fills. Then audit every other Flow Lab read (screen presets, contract drill core, alert, structure, legs, greek, lit, venues, group, lit market and each nightly key) for the same classes: fields against the shape, size against the caps, parameters against the spec (required, enums, dates on a closed market), and whether the error a reader sees names the real reason. Propose one fix per defect with its feed calls per member read, its D1 rows and the tests (with planted wrong builds) that would hold it. Also propose instrumentation: the route should say which class a failure was (too large, refused by status class, unparsable, timeout, network), in a form safe to show, so the next production read separates the causes.`

const CH_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, agree: { type: 'boolean' }, alternative: { type: 'string' }, betterFix: { type: 'string' }, risks: { type: 'string' } }, required: ['id', 'agree', 'alternative', 'betterFix', 'risks'] } },
    additions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] } },
  },
  required: ['items', 'additions'],
}

const challengeLens = {
  cause: 'Lens: CAUSE. Try to refute each root cause by reading the same code and documents yourself. Where you refute one, give the alternative and the evidence. Say what a production read would have to show to separate the remaining hypotheses.',
  fix: 'Lens: FIX. Stress each proposed fix: feed calls per member read and per minute under load, the UW_ONDEMAND and MEMBER_VENDOR limits, Worker CPU and memory when parsing large bodies, Cache API sharing, the honest states a reader sees (pending, too large, refused, failed, closed market), one screen at the four sizes, no dependence on a nightly, and the existing repository patterns. Propose a better fix where one exists.',
}

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, pr: { type: 'integer' }, head: { type: 'string' }, summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    localChecks: { type: 'array', items: { type: 'object', properties: { suite: { type: 'string' }, result: { type: 'string' } }, required: ['suite', 'result'] } },
    notDone: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'pr', 'head', 'summary', 'decisions', 'localChecks', 'notDone'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' }, scenario: { type: 'string' }, fix: { type: 'string' }, severity: { type: 'string', enum: ['blocking', 'should-fix', 'minor'] } }, required: ['title', 'file', 'line', 'scenario', 'fix', 'severity'] } },
    checked: { type: 'string' },
  },
  required: ['findings', 'checked'],
}

const SHIP_SCHEMA = {
  type: 'object',
  properties: { merged: { type: 'boolean' }, pr: { type: 'integer' }, mergeSha: { type: 'string' }, fixesApplied: { type: 'array', items: { type: 'string' } }, ci: { type: 'string' }, notes: { type: 'string' } },
  required: ['merged', 'pr', 'mergeSha', 'fixesApplied', 'ci', 'notes'],
}

phase('Diagnose')
const diag = await agent(diagnose, { label: 'diagnose', phase: 'Diagnose', schema: DIAG_SCHEMA })
if (!diag) return { error: 'diagnosis did not return' }
log(`${diag.defects.length} defects diagnosed; other views: ${diag.otherViews.filter((v) => v.verdict !== 'ok').length} with a defect or risk`)

phase('Challenge')
const challenges = await parallel(Object.entries(challengeLens).map(([k, lens]) => () => agent(`You are challenging a diagnosis of the Flow Lab page's failing reads before anyone builds on it.\n${EVIDENCE}\n${RULES}\n${lens}\nDIAGNOSIS:\n${JSON.stringify(diag, null, 1)}`, { label: `challenge:${k}`, phase: 'Challenge', schema: CH_SCHEMA })))

phase('Build')
const build = await agent(`You are building the fix for the Flow Lab page's failing reads, end to end, with extreme care.
${EVIDENCE}
${RULES}
${LESSONS}
DIAGNOSIS:
${JSON.stringify(diag, null, 1)}
CHALLENGES (two lenses; where a challenger refutes a cause or offers a better fix, weigh it and decide, recording the reason in the commit message):
${JSON.stringify(challenges.filter(Boolean), null, 1)}
Steps:
1. git -C ${REPO} fetch -q origin; git -C ${REPO} worktree add ${WT} -b ${BRANCH} origin/main (if the directory exists from an earlier attempt, inspect it and continue rather than delete work). Symlink ${WT}/tests/node_modules to ${REPO}/tests/node_modules if it is missing.
2. Implement a fix for every defect you accept, the instrumentation so a failure names its class honestly to the reader and in the JSON body, and on-demand fills for the nightly-only views. Keep each change minimal and in the repository's idiom.
3. Tests: extend the existing Flow Lab suites (tests/flows-flowlab.mjs, tests/server-flowlab.mjs, tests/flows-flowlab-render.mjs, tests/flows-flowlab-onescreen.mjs, tests/flows-flowlab-nightly.mjs) with stubs only. For each fix add at least one planted wrong build (an exact-once string mutation of the production module loaded through the repository's mutant helpers, tests/truth/mutants.mjs) that the new checks must fail. Regenerate fixtures with their generator if a shape changes.
4. Docs: docs/modules.json rows for the Flow Lab entries if what they say changes, then node scripts/gen-docs.mjs; docs/vendor-coverage.md if registry use changes.
5. node scripts/bump-assets.mjs and --check if assets changed; node tests/lib/suite-registry.mjs --write; run every Flow Lab suite, server-flowlab, flows-weight, math-format, contracts, docs-contract, architecture, lib-contract, route-matrix, flows-reads-contract and node scripts/prepush.mjs --base=origin/main. All must pass (sandbox-only reds named in the lessons excepted, and say so).
6. Commit with a message that carries every decision and its reason, push with git -C ${WT} push -u origin ${BRANCH} (retry up to four times on a network error with 2, 4, 8, 16 s waits), and open a DRAFT pull request against main with the GitHub MCP tools (load them with ToolSearch, query "+github pull request"). Title in plain words, no feed name, no "vendor". Do not merge.
Return the branch, PR number, head sha, a summary, the decisions, the local check results and anything not done.`, { label: 'build', phase: 'Build', schema: BUILD_SCHEMA })
if (!build || !build.pr) return { diag, challenges, build, error: 'build did not open a PR' }
log(`PR #${build.pr} at ${build.head}`)

phase('Review')
const reviewBase = `You are reviewing pull request #${build.pr} on anilkaya001/anilkaya.org, branch ${BRANCH}, head ${build.head}, which fixes the Flow Lab page's failing reads.
${EVIDENCE}
${RULES}
Do not edit ${WT}. Make your own copy: git -C ${REPO} worktree add --detach ${SP}/flowlab-review-<lens> ${build.head} (fetch first), symlink tests/node_modules to ${REPO}/tests/node_modules, and remove the worktree when done. Report only real defects with file, line, a concrete failing scenario and the minimal fix.
BUILDER'S SUMMARY AND DECISIONS:
${JSON.stringify({ summary: build.summary, decisions: build.decisions, notDone: build.notDone }, null, 1)}`
const reviews = await parallel([
  () => agent(`${reviewBase}\nLens: CORRECTNESS. Read the whole diff against origin/main. Run the affected suites. Plant your own wrong builds of the changed production code (copy, mutate, run) and check the new tests catch each. Check error classification, byte caps, closed-market dates, cache keys and TTLs, gate and token accounting, and that no path calls the feed more often than stated.`, { label: 'review:correctness', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(`${reviewBase}\nLens: READER. Render /flows/flowlab/ with the repository's harness (tests/lib/flowlab-world.mjs, Chromium, PLAYWRIGHT_BROWSERS_PATH=<browsers>) at 1920x1080, 1440x820, 1024x768 and 390x844 for every tab, in each state: data, too large, refused, failed, pending fill, closed market. Take screenshots into ${SP}/flowlab-review-shots/ and look at them. Check the copy (no "vendor", no feed name, TRT times, an em dash with a reason for every absent figure), one screen with no page or inner scroll, nothing clipped, keyboard reachability and visible focus.`, { label: 'review:reader', phase: 'Review', schema: REVIEW_SCHEMA }),
])
const findings = reviews.filter(Boolean).flatMap((r) => r.findings)
log(`${findings.length} review findings`)

phase('Ship')
const ship = await agent(`You are shipping pull request #${build.pr} (branch ${BRANCH}, worktree ${WT}) that fixes the Flow Lab page's failing reads.
${EVIDENCE}
${RULES}
${LESSONS}
REVIEW FINDINGS (verify each yourself before acting; fix every real one, and record in the commit message why any is not acted on):
${JSON.stringify(findings, null, 1)}
Steps: fix the verified findings in ${WT}; rerun the affected suites and node scripts/prepush.mjs --base=origin/main; commit and push. Then drive CI to green: read the check runs for the head commit with the GitHub MCP tools (ToolSearch "+github"), wait between reads with short sleeps (at most 60 s each), read failing job logs, root-cause and fix real failures, never skip, disable or quarantine a test, re-run a job at most once and only for a failure you diagnosed as a flake that is not in this change. When main moves, merge origin/main as the rules say. When every check on the head is green and the PR is mergeable: mark it ready for review and squash-merge it with a title in plain words. Return whether it merged, the merge sha, the fixes applied, the CI story and notes.`, { label: 'ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { diag, challenges, build, findings, ship }

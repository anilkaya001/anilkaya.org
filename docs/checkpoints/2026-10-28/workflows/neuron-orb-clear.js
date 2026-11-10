export const meta = {
  name: 'neuron-orb-clear',
  description: 'Stop the Neuron orb, pill, restore button and toast from covering page content: survey, three designs, judges, build, review, ship',
  phases: [
    { title: 'Survey', detail: 'measure what every Neuron part covers on every member page, size and state' },
    { title: 'Design', detail: 'three independent approaches: dock in the chrome, reserve the corner, choose a free slot' },
    { title: 'Judge', detail: 'three lenses score the designs and pick one, with grafts' },
    { title: 'Build', detail: 'implement the winner with a sweep suite and planted builds, draft PR, CI green' },
    { title: 'Review', detail: 'independent review: coverage, accessibility, test quality' },
    { title: 'Finish', detail: 'fix verified findings, CI green, merge, production smoke' },
  ],
}

const SP = '<scratchpad>'

const CTX = `# Context from the main session (2026-10-28)
Repository anilkaya001/anilkaya.org. The main checkout is <checkout>: NEVER run git checkout, switch, reset or stash inside it (other work lives there). Make your own worktree with \`git -C <checkout> fetch -q origin main && git -C <checkout> worktree add --detach <dir> origin/main\` (rsync is not installed) and link <dir>/tests/node_modules to <checkout>/tests/node_modules when it is missing. Scratchpad: SP=${SP}.
Browsers: the pinned Playwright (1.61.1) finds Chromium with PLAYWRIGHT_BROWSERS_PATH=<browsers> (fallback /opt/pw-browsers). Workerd suites need FLOWS_TEST_SANDBOX=1. The machine has 4 CPUs and two other workflows are running suites: run at most two browser suites at a time. Never use a bare foreground sleep; wait on conditions.
Known sandbox-only reds that fail on main here too (CI is the judge): flows-pages-render (login at 320), flows-net-render (fonts), flows-market-onescreen (1024 prints), flows-surface-render (label count), flows-ticker (flaky). Reproduce a red on main before calling it sandbox-only.
Other work in flight that you must not touch: the build-everything run's branches (claude/open-to-members #286, claude/pkg-WP3..WP6 and their *-train branches, PR #288), the Flow Lab fix (claude/flowlab-reads). Never send messages to other agents.

# The defect
The Neuron (assets/js/flows-oracle.js, assets/css/flows-oracle.css, the shell root #fxOracle that oracleShell in shared/flows-pages.js adds; server/routes/flows-pages.js wraps every member page in it) is a 52 px glass orb fixed in the bottom-right corner (.orc { position: fixed; right: max(24px, var(--safe-r)); bottom: calc(24px + var(--safe-b)) }, and on narrow screens above the tab bar). It floats over the one-screen pages and covers whatever lies in that corner. Production evidence, signed-in screenshots you should look at with the Read tool:
- ${SP}/view/neuron-live/phone-390-1-start.png: 390x844 Home, the orb covers the right part of the Neuron tile's "Ask Neuron" button.
- ${SP}/view/neuron-live/desktop-1440-1-start.png: 1440x820 Home, look at what the orb covers (the Reporting tile's last row).
- ${SP}/view/neuron-live/desktop-1440-2-hidden-undo.png and phone-390-3-show-button.png: the Hidden state's Undo chip and restore button (PR #284, merged today) in the same corner.
Only the long and short boards are tested for this (tests/flows-oracle-home-render.mjs, "THE ORB COVERS NO FIGURE OF A VISIBLE BOARD ROW", fixed for the board alone in #229). Every other page is unchecked. FLOWS_ORACLE is owner on main and #286 turns it on for every member, so every member will see the defect.
The Neuron's parts in that corner: the orb (the CSS orb plus the WebGL physics orb of assets/js/flows-nn-orb.js), the signal pill that expands to the orb's left with a headline, the count badge, the restore button with its 10 second "Neuron hidden · Undo" chip (36 px, 44 px on coarse pointers; Undo collapses when focus leaves it), the phone toast (6 s), and the sheet (a dialog, over the page by design and out of scope). Related surfaces: the Ask dock (flows-dock.js), the bottom tab bar on phones, the Home pager.

# Owner rules that apply
Pages are one screen with no page scroll at 1920x1080, 1440x820, 1024x768 and 390x844. Nothing is clipped or covered. Honest data. Times in TRT only. Never the word "tape". Never name the data feed's company in any reader-facing text, commit or PR: say "the feed". Source files carry no comments. Agents and tests never call the data feed's API or read UW_API_KEY: fixtures and stubs only. Never leave the owner a decision: decide, implement, record the reason. Ship through a draft PR, CI green, squash-merge.`

const SURVEY = {
  type: 'object',
  properties: {
    harness: { type: 'string' },
    inventoryFile: { type: 'string' },
    pages: { type: 'array', items: { type: 'string' } },
    sizes: { type: 'array', items: { type: 'string' } },
    states: { type: 'array', items: { type: 'string' } },
    counts: { type: 'object', properties: { controls: { type: 'number' }, text: { type: 'number' }, graphics: { type: 'number' }, pagesAffected: { type: 'number' } }, required: ['controls', 'text', 'graphics', 'pagesAffected'] },
    overlaps: { type: 'array', items: { type: 'object', properties: { page: { type: 'string' }, size: { type: 'string' }, state: { type: 'string' }, part: { type: 'string' }, kind: { type: 'string' }, label: { type: 'string' }, area: { type: 'number' } }, required: ['page', 'size', 'state', 'part', 'kind', 'label'] } },
    cornerMargins: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['harness', 'inventoryFile', 'counts', 'overlaps', 'summary'],
}

const DESIGN = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    mechanism: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    overlapsResolved: { type: 'string' },
    notCleared: { type: 'string' },
    readerDesktop: { type: 'string' },
    readerPhone: { type: 'string' },
    identity: { type: 'string' },
    onescreen: { type: 'string' },
    accessibility: { type: 'string' },
    weight: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    testPlan: { type: 'string' },
    plantedBuilds: { type: 'array', items: { type: 'string' } },
    effort: { type: 'string' },
    prototypeEvidence: { type: 'string' },
  },
  required: ['approach', 'mechanism', 'filesTouched', 'overlapsResolved', 'notCleared', 'readerDesktop', 'readerPhone', 'risks', 'testPlan', 'plantedBuilds'],
}

const JUDGE = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: { approach: { type: 'string' }, score: { type: 'number' }, strengths: { type: 'string' }, weaknesses: { type: 'string' } }, required: ['approach', 'score', 'strengths', 'weaknesses'] } },
    winner: { type: 'string' },
    grafts: { type: 'array', items: { type: 'string' } },
    mustFix: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: ['scores', 'winner', 'grafts', 'mustFix', 'rationale'],
}

const BUILD = {
  type: 'object',
  properties: {
    pr: { type: 'number' },
    branch: { type: 'string' },
    headSha: { type: 'string' },
    worktree: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    suites: { type: 'array', items: { type: 'object', properties: { suite: { type: 'string' }, result: { type: 'string' } }, required: ['suite', 'result'] } },
    plantedBuilds: { type: 'array', items: { type: 'string' } },
    ciGreen: { type: 'boolean' },
    decisions: { type: 'array', items: { type: 'string' } },
    open: { type: 'array', items: { type: 'string' } },
  },
  required: ['pr', 'branch', 'headSha', 'worktree', 'filesChanged', 'suites', 'plantedBuilds', 'ciGreen', 'decisions', 'open'],
}

const REVIEW = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, scenario: { type: 'string' }, fix: { type: 'string' }, reproduced: { type: 'boolean' } }, required: ['title', 'severity', 'scenario', 'fix', 'reproduced'] } },
    verdict: { type: 'string' },
  },
  required: ['findings', 'verdict'],
}

const FINISH = {
  type: 'object',
  properties: {
    pr: { type: 'number' },
    merged: { type: 'boolean' },
    mergeSha: { type: 'string' },
    productionVersion: { type: 'string' },
    fixed: { type: 'array', items: { type: 'string' } },
    declined: { type: 'array', items: { type: 'string' } },
    smoke: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['pr', 'merged', 'fixed', 'declined', 'smoke', 'notes'],
}

const APPROACHES = [
  { key: 'chrome', text: 'Dock the Neuron in the page chrome. The orb becomes a control in the shell: in the top toolbar on wide screens (beside Search, Ask, Since your last visit, My list and the freshness pill) and in the top bar or the bottom tab bar on phones, so it never floats over content. The signal pill expands inside the chrome, the count badge sits on the docked orb, the phone toast drops from the bar without covering a control, and the restore button and its Undo chip take the same slot.' },
  { key: 'reserve', text: 'Keep the floating corner orb and make every page leave that corner free: one shared reservation (a custom property, or an inset the Neuron publishes from a ResizeObserver) that every one-screen stage, fitter and scrolling body honours, so no control, text or figure is ever laid out under the orb, the pill when it expands, the restore button, the Undo chip or the toast. The one-screen pages must still fit at the four sizes.' },
  { key: 'slot', text: 'Keep the orb floating but let it choose its place. At mount and on every layout change (resize, the Ask dock, a tab switch, data that re-lays a page, a late font) it tests a short ordered list of anchor positions along the viewport edges and takes the first where its box and the expanded pill cover no control, text or figure; it moves under the motion rules (CSS transform only, no movement under reduced motion), never while the reader is pointing at or focused on it. Define the fallback when no anchor is free.' },
]

const LENSES = [
  { key: 'reader', text: 'the reader and the owner\'s design goals: a hedge-fund-grade platform, one screen with nothing clipped or covered, the Neuron\'s identity and its always-on, breathing presence, what a member sees on a desktop and on a phone' },
  { key: 'engineering', text: 'engineering risk: blast radius across the one-screen contracts, fitters and their suites, the flows-weight budgets, the number of files and suites that move, merge conflicts with the PRs in flight (#286 turns the Neuron on for members, #288 and the other packages, the Flow Lab fix), and how hard the result is to keep correct as pages change' },
  { key: 'access', text: 'accessibility and robustness: WCAG 2.4.11 focus not obscured, 2.5.8 targets, keyboard order and focus return, screen-reader names, reduced motion, forced colours, the Ask dock opening, resizes, late fonts, pages that re-lay after data, and #284\'s Hidden, Undo and restore flow' },
]

const REVIEW_LENSES = [
  { key: 'coverage', text: 'regressions and coverage: every member page, every tab and module switch, every dock state and size (the Ask dock open, the sidebar collapsed, a late font, a resize, a page that re-lays after data, a long signal headline, the phone pager pages); the new sweep really detects each class of overlap and has no blind spot; no page lost its one-screen fit or moved a figure' },
  { key: 'access', text: 'accessibility, motion and identity: keyboard order and focus return, focus not obscured (WCAG 2.4.11) by any Neuron part, target sizes (2.5.8), accessible names and announcements, reduced motion, forced colours, the Hidden, Undo and restore flow from #284, and the orb\'s identity and states' },
  { key: 'tests', text: 'test quality: each planted build is a real defect and is caught by the check meant for it, the suite is deterministic under 4x CPU throttling and load (no fixed sleep standing in for a settled state), its timeout and shard pin are right, and the registry, docs, weight raise and PR text are honest' },
]

phase('Survey')
const survey = await agent(`${CTX}

# Your task: Survey (measurement only; edit nothing in the repository)
Build a measurement harness, a Node script with Playwright in ${SP}/orb-survey/, that renders every Flows member page with the Neuron mounted and records what the Neuron's corner parts cover.
- Pages: every page the shell serves to a signed-in member (FLOWS_PAGES and FLOWS_NAV in shared/flows-pages.js, the rows of server/routes/flows-pages.js): Home, Market (every #view= tab), Moves, Unusual (every tab), Ledger, Flow Lab (every tab), Events, Political, Desk, Strategy, the ticker (its default view and the phone layout), the long, short and watch boards, Ask, Now, Network, Status (owner) and Fire when it has a page. Wrap each page's HTML with PAGES.oracleShell(html, "on", slug) exactly as server/routes/flows-pages.js does, so the Neuron mounts.
- Data: serve the pages from page.route with no server: the pipeline's dry-run emit (tests/lib/nightly-emit.mjs, nightlyEmit()), tests/flows-layout-sweep.mjs (it already renders eighteen page specs from the dry emit at the four sizes: reuse its page table and routes), tests/lib/oracle-world.mjs and tests/lib/oracle-fixtures.mjs (the Neuron's routes, records that expand the pill), tests/lib/home-fixtures.mjs and tests/lib/market-fixtures.mjs. No production calls and no feed calls.
- Sizes: 1920x1080, 1440x820, 1024x768, 390x844 (touch and a coarse pointer) and 320x568.
- States, switched inside one page load where you can: the orb at rest; the signal pill expanded with a headline; the count badge; Hidden with the 10 second Undo chip; the restore button after the chip collapses; the phone toast.
- For each page, size and state record the boxes of the Neuron's visible parts (not the sheet) and every element outside #fxOracle that intersects them, classed as control (a[href], button, input, select, textarea, summary, [role=button|tab|link|switch|checkbox|option], [tabindex] >= 0), text (a non-space text run, measured with Range client rects) or graphic (canvas, svg marks). Record the page, size, state, the Neuron part, the kind, a short label (text or accessible name) and the intersection area in square px. Also record per page and size how far the nearest content sits from the viewport's bottom-right corner, and whether the page scrolls.
Write the full inventory as JSON to ${SP}/orb-survey/inventory.json and a readable summary to ${SP}/orb-survey/summary.md, and keep the harness runnable (document its command at the top of summary.md) because the designers and the builder will reuse it. Return at most 120 overlap items, the most serious first (controls, then text, then graphics, larger areas first). Remove your worktree and any temporary emit directory when done; keep ${SP}/orb-survey/.`, { label: 'survey', phase: 'Survey', schema: SURVEY })

if (!survey) return { error: 'the survey agent returned nothing' }
log(`Survey: ${survey.counts.controls} controls, ${survey.counts.text} text runs and ${survey.counts.graphics} graphics covered on ${survey.counts.pagesAffected} pages`)

const surveyBrief = JSON.stringify({ harness: survey.harness, inventoryFile: survey.inventoryFile, counts: survey.counts, cornerMargins: survey.cornerMargins, summary: survey.summary, top: survey.overlaps.slice(0, 60) })

phase('Design')
const designs = (await parallel(APPROACHES.map((a) => () => agent(`${CTX}

# The survey (read ${SP}/orb-survey/summary.md and inventory.json for the full detail)
${surveyBrief}

# Your task: Design, approach "${a.key}"
${a.text}
Read the code first: assets/js/flows-oracle.js, assets/css/flows-oracle.css, assets/css/flows-nn.css, assets/js/flows-nn-orb.js, shared/flows-pages.js (oracleShell, the shell and page markup), the one-screen layouts and fitters (assets/css/flows.css, flows-feeds.css, the Home bento and its fitter in flows-overview.js, the Market fitter in flows-market.js, assets/js/flows-feed-os.js, the Moves, Ledger and Flow Lab stages), flows-dock.js, docs/oracle.md, docs/flows-design-system.md and the Neuron suites (tests/flows-oracle-render.mjs, flows-oracle-home-render.mjs, flows-oracle-restore-render.mjs).
Design this approach concretely. Do not edit the repository. You may prototype in your own detached worktree and measure the prototype with the survey harness; delete the worktree when done.
The design must: leave no control, text run or figure of any page under any Neuron part at the five sizes and in every surveyed state; keep every one-screen page fitting with no page scroll; keep the Neuron's identity (the orb and its states, the breathing physics orb) and its always-on presence; keep #284's Hidden, Undo and restore behaviour; meet WCAG 2.4.11 and 2.5.8, keyboard order, reduced motion and forced colours; stay inside the flows-weight budgets or name the raise; come with a sweep suite over every page, size and state that fails on any overlap, and planted wrong builds that must fail.
Return the mechanism, the files touched, how each class of overlap in the survey is resolved, what you cannot clear and why, what a reader sees on a desktop and on a phone, identity, one-screen impact, accessibility, weight, risks, the test plan, the planted builds, the effort, and any prototype measurements.`, { label: `design:${a.key}`, phase: 'Design', schema: DESIGN })))).filter(Boolean)

if (!designs.length) return { error: 'no design came back', survey: survey.summary }
log(`Designs returned: ${designs.map((d) => d.approach).join(', ')}`)

const designBrief = JSON.stringify(designs)

phase('Judge')
const verdicts = (await parallel(LENSES.map((l) => () => agent(`${CTX}

# The survey
${surveyBrief}

# The designs (one per approach)
${designBrief}

# Your task: Judge through the lens of ${l.text}
Score every design from 1 to 10 through your lens, with its strengths and weaknesses, name the one you would ship, list the ideas from the other designs worth grafting onto it, and list the risks the builder must fix before the PR can merge. You may read the code and the survey inventory and run the harness, but edit nothing. Use the approach names exactly as the designs give them.`, { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE })))).filter(Boolean)

if (!verdicts.length) return { error: 'no judge came back', designs: designs.map((d) => d.approach) }

const totals = {}
for (const d of designs) totals[d.approach] = { sum: 0, n: 0, votes: 0 }
for (const v of verdicts) {
  for (const s of v.scores) { if (totals[s.approach]) { totals[s.approach].sum += s.score; totals[s.approach].n += 1 } }
  if (totals[v.winner]) totals[v.winner].votes += 1
}
const ranked = Object.entries(totals).map(([k, t]) => ({ approach: k, mean: t.n ? t.sum / t.n : 0, votes: t.votes })).sort((x, y) => y.mean - x.mean || y.votes - x.votes)
const winner = designs.find((d) => d.approach === ranked[0].approach) || designs[0]
const grafts = [...new Set(verdicts.flatMap((v) => v.grafts))]
const mustFix = [...new Set(verdicts.flatMap((v) => v.mustFix))]
log(`Ranking: ${ranked.map((r) => `${r.approach} ${r.mean.toFixed(1)} (${r.votes} votes)`).join(', ')}; building ${winner.approach}`)

phase('Build')
const build = await agent(`${CTX}

# The survey
${surveyBrief}

# The chosen design (ranked first by three judges: ${JSON.stringify(ranked)})
${JSON.stringify(winner)}

# Grafts from the judges
${JSON.stringify(grafts)}

# Risks the judges require fixed before merge
${JSON.stringify(mustFix)}

# The judges' rationales
${JSON.stringify(verdicts.map((v) => ({ winner: v.winner, rationale: v.rationale })))}

# Your task: Build it and open a draft PR
1. Worktree: \`git -C <checkout> fetch -q origin main && git -C <checkout> worktree add ${SP}/orb-clear -b claude/neuron-orb-clear origin/main\`; link tests/node_modules. Never touch the main checkout.
2. Implement the design with the grafts and the must-fix risks. No comments in source, colours only through tokens, motion in CSS only (transform and opacity, nothing under reduced motion), forced colours handled, no new global (add to FlowsUI if anything), no storage outside the existing cookies.
3. Add a sweep suite (tests/flows-orb-clear-render.mjs, or a name that fits), built from the survey harness at ${SP}/orb-survey/: every member page, the five sizes, every state; it fails on any control, text run or figure under any Neuron part, and on page scroll for the one-screen pages. Plant wrong builds of the served files (at least: the old fixed corner back; the mechanism removed on one page; the pill expanding over content; the restore button or the Undo chip over content; the phone toast over a control), each shown to change its file exactly once and each caught by the check meant for it. Register it with \`node tests/lib/suite-registry.mjs --write\`, pin it to the lightest shard, keep the 1.3x shard balance and run \`node run-contract.mjs\` from tests/.
4. Update every suite the change moves (flows-oracle-render, flows-oracle-home-render, flows-oracle-restore-render, flows-oracle-core if wording moves, flows-home-onescreen, flows-market-onescreen, flows-feeds-onescreen, flows-layout-sweep, flows-weight with a named raise if bytes grow, route-matrix if markup changes, any render suite that counts toolbar items). Never skip, disable or loosen a check to get green.
5. docs/modules.json rows for the Neuron and the new suite, then \`node scripts/gen-docs.mjs\`; \`node scripts/bump-assets.mjs\` then \`node scripts/bump-assets.mjs --check\`.
6. Run \`node scripts/prepush.mjs\` and every suite you touched; reproduce any red on main before calling it sandbox-only.
7. Commit with a message that records the decision and why the other approaches lost, ending with the two lines
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPrdwKQktqNrpNhW5WezLY
Push with \`git push -u origin claude/neuron-orb-clear\` (retry on network errors with 2, 4, 8 and 16 s waits). There is no gh CLI: load the GitHub MCP tools with ToolSearch, open a DRAFT PR against main (sections: What changed, Why this design, Tests, Weight; plain words for the owner; end the body with the line "🤖 Generated with [Claude Code](https://claude.com/claude-code)"), then call subscribe_pr_activity for it.
8. Wait for CI by polling the check runs on the head commit with curl to api.github.com at most once a minute, inside a single until-loop run in the background, never chained sleeps. Fix any red this PR causes and push. On a merge conflict or a moved main: merge origin/main (no rebase), take main's assets/version.txt, re-run bump-assets, gen-docs and the registry, re-run the affected suites, push.
Stop when CI is green on the PR head. Do NOT mark it ready and do NOT merge: an independent review comes next. Return the PR number, branch, head sha, worktree path, the files changed, the suites run with results, the planted builds, whether CI is green, the decisions taken and anything left open.`, { label: 'build', phase: 'Build', schema: BUILD })

if (!build) return { error: 'the build agent returned nothing', ranked, winner: winner.approach }
log(`Draft PR #${build.pr} at ${build.headSha}, CI green: ${build.ciGreen}`)

phase('Review')
const reviews = (await parallel(REVIEW_LENSES.map((l) => () => agent(`${CTX}

# What was built
${JSON.stringify(build)}

# The design it implements
${JSON.stringify(winner)}

# Your task: independent review, lens: ${l.text}
PR #${build.pr}, branch ${build.branch}, head ${build.headSha}. The builder's worktree ${build.worktree} is READ ONLY for you: never edit, commit, check out or run a writing command there. For experiments make your own detached worktree at the PR head (\`git -C <checkout> fetch -q origin ${build.branch} && git -C <checkout> worktree add --detach ${SP}/orb-review-${l.key} origin/${build.branch}\`) and remove it when done.
Find real defects only. Each needs a concrete failure scenario (page, size, state, steps), whether you reproduced it, and a proposed fix. Run what you need: the new sweep suite, the survey harness at ${SP}/orb-survey/, Chromium with CPU throttling for races. Severity: blocker (wrong behaviour a reader hits, a test that cannot fail, a contract broken), major, minor. No style points. Return the findings and a one-line verdict.`, { label: `review:${l.key}`, phase: 'Review', schema: REVIEW })))).filter(Boolean)

const findings = reviews.flatMap((r) => r.findings)
log(`Review: ${findings.length} findings (${findings.filter((f) => f.severity === 'blocker').length} blockers)`)

phase('Finish')
const finish = await agent(`${CTX}

# What was built
${JSON.stringify(build)}

# Review findings from three independent reviewers
${JSON.stringify(reviews)}

# Your task: finish and ship PR #${build.pr}
The worktree ${build.worktree} and branch ${build.branch} are yours now.
1. Verify every finding: trace the realistic path and reproduce it. Fix the real ones with tests (a planted wrong build when the finding is a class of defect); record for each of the others why it is not a defect.
2. Re-run the affected suites and \`node scripts/prepush.mjs\`; commit (end the message with the two trailer lines below) and push.
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPrdwKQktqNrpNhW5WezLY
3. Drive CI to green as before (one background until-loop polling at most once a minute; on a conflict or a moved main merge origin/main, take main's assets/version.txt, re-run bump-assets, gen-docs and the registry, re-run the affected suites, push). Fix every red this PR causes; a failure that is not this PR's is reproduced on main and named.
4. When the head is green and mergeable: update the PR body so it matches what ships, mark the PR ready, squash-merge it (GitHub MCP tools) with a title ending in the PR number and a message that records the decision, ending with the two trailer lines.
5. Wait for production (Workers Builds deploys main) to serve the new assets/version.txt (one background until-loop on https://anilkaya.org/assets/version.txt with a cache-busting query), then smoke it anonymously: /api/health answers 200 JSON; /flows/ answers the sign-in page with status 200 and the security headers; /assets/js/flows-oracle.js?v=<version> and the stylesheet serve the new code. Do not sign in: the main session verifies signed in.
6. Remove ${build.worktree} and your local branch after the merge.
Return the PR, whether it merged, the merge sha, the production version, the findings fixed and declined (with reasons), the smoke results and notes.`, { label: 'finish', phase: 'Finish', schema: FINISH })

return {
  survey: { counts: survey.counts, summary: survey.summary, inventoryFile: survey.inventoryFile },
  ranked,
  winner: winner.approach,
  grafts,
  mustFix,
  build,
  findings: findings.map((f) => ({ title: f.title, severity: f.severity, reproduced: f.reproduced })),
  finish,
}

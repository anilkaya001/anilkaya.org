export const meta = {
  name: 'coverage-census-and-pr284-review',
  description: 'Exact feed endpoint coverage counts by two independent methods with reconciliation, plus an adversarial review of PR #284',
  phases: [
    { title: 'Count', detail: 'registry method and call-site method, per branch' },
    { title: 'Reconcile', detail: 'adversarial reconciliation to exact numbers' },
    { title: 'Review', detail: 'three lenses over the PR #284 diff' },
    { title: 'Verify', detail: 'refute each review finding' },
  ],
}

const SP = '<scratchpad>'
const REPO = '<checkout>'

const RULES = `
Hard rules for this task:
- Read-only. Do not edit, commit, push, stash, checkout or reset anything in ${REPO} (its working tree is on another branch that someone else is using) or in any existing worktree. Read other branches with "git -C ${REPO} show <ref>:<path>" or "git -C ${REPO} grep <pattern> <ref> -- <paths>", or make your own throwaway worktree under ${SP}/census-<yourname> with "git -C ${REPO} worktree add --detach <dir> <ref>" and remove it with "git -C ${REPO} worktree remove --force <dir>" when done.
- Never call the market data feed's API, never read UW_API_KEY, never use any MCP server named after the feed. Everything here is static analysis of the repository.
- Branch refs (already fetched): main = origin/main; WP3 = origin/claude/pkg-WP3-volatility-structure; WP4 = origin/claude/pkg-WP4-institutional-positioning; WP5 = origin/claude/pkg-WP5-cross-asset-macro; WP6 = origin/claude/pkg-WP6-event-risk (the implemented branch; origin/claude/wp6-event-risk is only its design spec, ignore it unless it adds code). Run "git -C ${REPO} fetch -q origin" first.
- The spec is docs/uw-openapi.yaml on origin/main. The operation registry is shared/flows-vendor-ops.js (entries have id, path, optional op, liveOnly, limiter, maxBytes, reads). pathFor(id, params) and opById(id) read it.
`

const COUNT_SCHEMA = {
  type: 'object',
  properties: {
    method: { type: 'string' },
    specPaths: { type: 'integer' },
    specOperations: { type: 'integer' },
    nonGetOperations: { type: 'array', items: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, alsoHasGet: { type: 'boolean' }, whatItDoes: { type: 'string' } }, required: ['method', 'path', 'alsoHasGet', 'whatItDoes'] } },
    branches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          sha: { type: 'string' },
          registryEntries: { type: 'integer' },
          specPathsUsed: { type: 'integer' },
          specPathsUsedList: { type: 'array', items: { type: 'string' } },
          entriesNotInSpec: { type: 'array', items: { type: 'string' } },
          declaredButNeverCalled: { type: 'array', items: { type: 'string' } },
          calledOutsideRegistry: { type: 'array', items: { type: 'string' } },
          behindSwitchOff: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['name', 'sha', 'registryEntries', 'specPathsUsed', 'specPathsUsedList', 'entriesNotInSpec', 'declaredButNeverCalled', 'calledOutsideRegistry', 'behindSwitchOff', 'notes'],
      },
    },
    unionAfterTrain: { type: 'integer' },
    unionAfterTrainList: { type: 'array', items: { type: 'string' } },
    uncoveredAfterTrain: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['method', 'specPaths', 'specOperations', 'nonGetOperations', 'branches', 'unionAfterTrain', 'unionAfterTrainList', 'uncoveredAfterTrain', 'notes'],
}

const DEFINITIONS = `
Definitions (use exactly these):
- AVAILABLE: every path under "paths:" in docs/uw-openapi.yaml on origin/main, and separately every (method, path) operation.
- A spec path is USED on a branch when production code on that branch issues a request to it. Production code means: worker.js and its import closure, server/, shared/, the nightly (scripts/flows-pipeline.mjs, scripts/flows-nightly/**), the live and other legs under scripts/flows-legs/** EXCEPT fakes and fixtures (*-fake.mjs, fake-vendor.mjs, fixtures.mjs, live-day.mjs, live-world-fake.mjs, taint.mjs). NOT production: tests/**, scripts/flows-probe*.mjs and scripts/flows-ws-probe.mjs (diagnostic probes), scripts/research/**, scripts/eval-*.mjs, docs/**.
- Normalise path templates by replacing every {param} with {} before comparing a registry path (or its op field when present) to a spec path; a registry entry with liveOnly or with a path the spec does not list is "not in spec" and is reported apart, never counted toward the 217.
- behindSwitchOff: a used path whose only production call sites are reachable only when a wrangler.toml [vars] switch on that branch is off or owner-only for members (name the switch).
- unionAfterTrain: the union of USED spec paths over main, WP3, WP4, WP5 and WP6 (each package branch merged into main keeps its own calls).
`

const registryMethod = `You are counting how much of the market data feed's API this repository uses, by the REGISTRY method.
${RULES}
${DEFINITIONS}
Method: parse the spec yourself (write a small Python or Node script under ${SP}/census-registry/ that reads the YAML structurally; count paths and (method, path) operations; list every non-GET operation with whether its path also has a GET and one sentence on what it does from its description). For each branch, read shared/flows-vendor-ops.js at that ref, map each entry to a spec path, then for every entry find at least one production call site (pathFor("<id>"...), opById("<id>"), or a literal use of the entry's path) on that branch with git grep; an entry with no production call site goes to declaredButNeverCalled and its path is NOT used. Check wrangler.toml [vars] on each branch for switches that gate the callers. Report exact integers and the full lists. Put your scripts and raw outputs in ${SP}/census-registry/. Double-check the counts by running your script twice from scratch.`

const callsiteMethod = `You are counting how much of the market data feed's API this repository uses, by the CALL-SITE method, independently of the registry's own bookkeeping.
${RULES}
${DEFINITIONS}
Method: do not start from the registry list. For each branch, find every place production code sends a request to the feed: follow uwFetch (worker.js closure), the nightly's uw() client (scripts/flows-nightly/vendor.mjs), the rail's REST adapter and socket channels (shared/flows-rt*.js), the legs' clients, the dossier fan-out, the Flow Lab reads (server/flowlab.js), the extras leg, and any other fetch whose URL is built from vendorUrl/vendorBase/pathFor/opById. Resolve each call site to a concrete spec path (resolve pathFor ids through the registry only to turn an id into a path). Record entries the registry declares that no call site reaches (declaredButNeverCalled) and any feed path requested without going through the registry (calledOutsideRegistry). Report exact integers and the full lists. Put scripts and raw outputs in ${SP}/census-callsite/. Where a call site is conditional on a [vars] switch, record it in behindSwitchOff with the switch name.`

const reviewBase = `You are reviewing pull request #284 of anilkaya001/anilkaya.org ("Neuron: Hidden leaves an Undo and a restore button"), branch claude/neuron-restore, head 5ae3358, base origin/main b0b6e7c. A worktree of the branch is at ${SP}/neuron: READ ONLY, do not edit, stage, commit or run git commands that change it. If you want to run a planted mutation or a suite, copy the tree first with "rsync -a --exclude node_modules ${SP}/neuron/ ${SP}/review-<yourlens>/" and symlink tests/node_modules to ${REPO}/tests/node_modules there. Chromium suites need PLAYWRIGHT_BROWSERS_PATH=<browsers>. The diff: "git -C ${SP}/neuron diff b0b6e7c 5ae3358 -- assets/js/flows-oracle.js assets/css/flows-oracle.css tests/flows-oracle-render.mjs tests/flows-weight.mjs docs/modules.json" (the other files are the asset-version bump and generated docs).
Context: the Neuron (FlowsUI.oracle) is a corner orb with a sheet whose preference control offers Pill (on), Count (quiet), Hidden (off), stored in the first-party cookie fn_oracle (Path /flows), capped by the page's mode (readPref takes the minimum of the cookie and data-oracle; the server only ever renders data-oracle "on" today, but "quiet" is a supported value). The change: Hidden now hides only the orb and shows a restore button (ten-second Undo chip, then a small "Show the Neuron" button); restoring returns the mode saved in fn_oracle_prev; Alt+Shift+N uses the same path. A known item already queued by the author: setPref saves S.pref (the capped value) into fn_oracle_prev; it should save the raw cookie value when that is a valid non-off preference, so a capped page cannot overwrite the reader's choice. Report it only if you see more to it.
Report only real defects: a wrong result, a regression, an accessibility failure against WCAG 2.2 AA, a test that would pass on a broken build, or a CI risk. For each finding give file, line, a concrete failure scenario, and the minimal fix. No style opinions.`

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' }, scenario: { type: 'string' }, fix: { type: 'string' }, severity: { type: 'string', enum: ['blocking', 'should-fix', 'minor'] } },
        required: ['title', 'file', 'line', 'scenario', 'fix', 'severity'],
      },
    },
    checked: { type: 'string' },
  },
  required: ['findings', 'checked'],
}

const LENSES = [
  { key: 'state', prompt: 'Lens: state machine, cookies and timers. Walk setPref, restorePref, paintOrb, the keydown handler, mount, the sheet open and close, the toast and the live announcements, across: hiding from Pill, from Count, twice in a row, restoring inside and after the undo window, a reload while hidden, a second tab, the cookie missing or garbage, the page mode quiet, a hidden tab when the undo timer fires, and Alt+Shift+N with focus in an input.' },
  { key: 'a11y', prompt: 'Lens: accessibility and layout. Accessible names and their changes, focus movement and its visibility, the polite live region, target sizes on fine and coarse pointers, forced colours, reduced motion, the CSS cascade ([hidden] against display rules, specificity), z-order against the phone tab bar and the sheet, and whether any one-screen page at 1920x1080, 1440x820, 1024x768 or 390x844 can scroll or clip because of the new button. Render the page with the existing harness tests/lib/oracle-world.mjs if useful.' },
  { key: 'tests', prompt: 'Lens: test validity and CI risk. Does each new assertion in tests/flows-oracle-render.mjs fail on the planted build for the stated reason and not for an unrelated timeout? Would any other registered suite (flows-pages-render, flows-layout-sweep, flows-member-render, flows-glass-render, flows-weight, math-format, contracts, docs-contract, architecture, lib-contract, route-matrix, flows-oracle-home-render, flows-oracle-core) change result because of this diff? Check the asset bump and generated docs are consistent (node scripts/bump-assets.mjs --check, node scripts/gen-docs.mjs --check in your copy).' },
]

const reconcile = (a, b) => `Two independent counts of this repository's use of the market data feed's API disagree or agree; produce the exact final numbers.
${RULES}
${DEFINITIONS}
COUNT A (registry method):
${JSON.stringify(a)}
COUNT B (call-site method):
${JSON.stringify(b)}
For every number or list item on which A and B differ, re-derive it yourself from the code (git grep on the ref, read the call site) and decide; when still uncertain take the stricter reading (not used). Then report: available paths and operations; USED spec paths on main today; on each package branch; the union after the merge train; the uncovered list after the train with, for each path, the spec tag and a one-line reason it is not used yet; the non-GET operations and whether calling them would write anything to the account; and entries used but not in the spec. Give exact integers.`

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    specPaths: { type: 'integer' },
    specOperations: { type: 'integer' },
    nonGet: { type: 'array', items: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, writesToAccount: { type: 'boolean' }, alsoHasGet: { type: 'boolean' } }, required: ['method', 'path', 'writesToAccount', 'alsoHasGet'] } },
    mainUsed: { type: 'integer' },
    mainLiveForMembers: { type: 'integer' },
    perBranch: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, used: { type: 'integer' }, newVsMain: { type: 'integer' } }, required: ['name', 'used', 'newVsMain'] } },
    unionAfterTrain: { type: 'integer' },
    uncoveredAfterTrain: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, tag: { type: 'string' }, why: { type: 'string' } }, required: ['path', 'tag', 'why'] } },
    usedNotInSpec: { type: 'array', items: { type: 'string' } },
    declaredButNeverCalledMain: { type: 'array', items: { type: 'string' } },
    disagreementsResolved: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string' },
  },
  required: ['specPaths', 'specOperations', 'nonGet', 'mainUsed', 'mainLiveForMembers', 'perBranch', 'unionAfterTrain', 'uncoveredAfterTrain', 'usedNotInSpec', 'declaredButNeverCalledMain', 'disagreementsResolved', 'confidence'],
}

const census = (async () => {
  phase('Count')
  const [a, b] = await parallel([
    () => agent(registryMethod, { label: 'count:registry', phase: 'Count', schema: COUNT_SCHEMA }),
    () => agent(callsiteMethod, { label: 'count:call-sites', phase: 'Count', schema: COUNT_SCHEMA }),
  ])
  if (!a || !b) return { error: 'a counter did not return', a, b }
  log(`registry method: main ${a.branches.find((x) => x.name.toLowerCase().includes('main'))?.specPathsUsed}; call-site method: main ${b.branches.find((x) => x.name.toLowerCase().includes('main'))?.specPathsUsed}`)
  const final = await agent(reconcile(a, b), { label: 'reconcile', phase: 'Reconcile', schema: FINAL_SCHEMA })
  return { a, b, final }
})()

const review = (async () => {
  const lensResults = await parallel(LENSES.map((l) => () => agent(`${reviewBase}\n${l.prompt}`, { label: `review:${l.key}`, phase: 'Review', schema: REVIEW_SCHEMA })))
  const findings = lensResults.filter(Boolean).flatMap((r, i) => r.findings.map((f) => ({ ...f, lens: LENSES[i].key })))
  log(`${findings.length} review findings to verify`)
  if (!findings.length) return { findings: [], verified: [] }
  const verdict = await agent(`${reviewBase}\nYou are the adversarial verifier. For each finding below, try to REFUTE it by reading the code and, where it is cheap, by running it in your own copy. Default to refuted when the scenario cannot happen in this code. Keep a finding only when you can state the exact failing steps.\nFINDINGS:\n${JSON.stringify(findings, null, 1)}`, {
    label: 'verify', phase: 'Verify',
    schema: { type: 'object', properties: { verified: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, real: { type: 'boolean' }, why: { type: 'string' }, fix: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' } }, required: ['title', 'real', 'why', 'fix', 'file', 'line'] } } }, required: ['verified'] },
  })
  return { findings, verified: verdict ? verdict.verified : null }
})()

const [c, r] = await Promise.all([census, review])
return { census: c, review: r }

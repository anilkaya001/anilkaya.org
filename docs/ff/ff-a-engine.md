# Fire & Forget lane A: the engine

Lane A is the part of Fire & Forget that decides. Everything here is pure: a snapshot, the compiled wires and the stored state go in; hits, receipts and the next state come out. It reads no clock but the one in the snapshot, makes no vendor call and calls no model, so a night can be replayed byte for byte.

The contract (`docs/ff/contract.md`, `shared/ff-contract.js`) is the vocabulary. This note is what lanes B, C and G need to call the engine: the formats it takes and gives, the rules it applies, and what it leaves to them.

## Files

| File | What it is |
|---|---|
| `shared/ff-stats.js` | Quantisation to the displayed precision, the relaxed hysteresis band in twentieths of a step, the Student t5 tail, the robust z, Benjamini-Hochberg as integer keys, the exact expected hits a night and the weekly budget in cents, and the reserved intraday primitives (e-value, Shiryaev-Roberts, Poisson verdict). |
| `shared/ff-session.js` | The session calendar on the repository's NYSE calendar, the TRT session label, the four health states, the first-check and late rules, the nightly deadline. No hard-coded open. |
| `shared/ff-ids.js` | Synchronous SHA-256, `hitId`, `clauseHash`, `astHash`, `memberWireId`, `keyFor` (the dedupe key). |
| `shared/ff-grammar.js` | `validateBody`, `compileWire`, `prepareVersion`, the arming limits and the weekly budget. |
| `shared/ff-sentence.js` | The wire sentence, the title, the hit sentence and the evidence rows, all from the frozen record. |
| `shared/ff-house.js` | The nine house wires, pinned by AST hash. |
| `shared/ff-engine.js` | `evaluate`, `evaluateSafe`, `preview`, `replayDecision`, `checkEvidence`. |

## Calling the engine

```text
evaluate(snapshot, wires, { state, existingKeys, firstLook, capUsed, mode }) -> result
```

`wires` are `compileWire` results (or `compileHouse`). Everything else is read from the store by the caller and handed in:

| Option | What the caller passes |
|---|---|
| `state` | The `ff_state` rows of the wires being evaluated (array or Map). |
| `existingKeys` | A Set of `wire_id|dedupe_key` for the hits already stored in this session. It is the dedupe and, for a live wire, the quiet marker. |
| `firstLook` | A Map `wire_id@version` to the session of that version's first evaluated receipt. It decides whether a state wire is on its first look. |
| `capUsed` | `{ wire, member, global }`: the hits already written this session, by wire id, by member and in all. |
| `mode` | `shadow` marks every hit `held`. |

`evaluateSafe` never throws and answers `{ ok, result, error }`. `preview(snapshot, wire, { limit })` answers what a draft wire would do now without writing: `{ subjects, evaluated, unknown, reasons, wouldHit, rows }`, with the same false-discovery gate the run applies.

### The snapshot

The engine takes columns, not objects, so 850 names cost 850 array reads and not 850 allocations.

```text
{ v: 1, kind: "nightly" | "live", session, asOf, now, look, evaluator,
  sources: { <key>: { session, asOf, tier? } },
  symbols: [n], sector: [n],
  cols:    { <metric id>: [n values or null] },
  n:       { <metric id>: [n baseline counts] },
  floored: { <metric id>: [n of 0 or 1] },
  why:     { <metric id>: { <reason>: [indexes] } },
  windows: [{ symbol, occ, spanStart, cols: { <metric id>: value }, why? }],
  sectors: { names, cols, n, floored, why } | null,
  truncated: { <source key>: true } }
```

- `asOf` is the data's time: the session close for a nightly, the source's own stamp for a live tick. `now` is the evaluation time and becomes `fired_at`. `look` is the tick ordinal within a live session and 0 for a nightly.
- A metric whose column is absent is `missing`. A null in a present column is unknown, with the reason from `why` or `missing`. A value outside the registry's range is `out_of_range`; an anomaly metric whose `n` is under 15 is `warming`, whatever the leg shipped.
- Staleness is the engine's: a live source older than 1,800 s (Tier 1: 720 s) or from another session is `stale`; a nightly source more than 0 sessions behind (5 for the slow fields) is `stale`. A stale or missing source is unknown, never carried forward.
- The windows are the flagged option windows. Several windows of one contract are one subject, `c:<SYMBOL>:<OCC>`, and the strongest window is the evidence.

### The result

```text
{ hits:     [ff_hit rows without seq],
  capped:   [{ wire_id, subject }],
  receipts: [ff_receipt rows + mode, state_mismatch, duplicates],
  state:    { upserts: [ff_state rows], deletes: [{ wire_id, subject }] },
  errors:   [{ wire_id, error }],
  stats }
```

- `hits` come sorted by wire then subject. The store assigns `seq`. `evidence_json` is about 2 KiB for eight clauses and at most 4,096 bytes: past that the sources and the wire sentence are dropped, and a record that still does not fit costs its wire the night (`evaluator_error`, an entry in `errors`, no state moved) and never the run.
- A name whose symbol is not 1 to 10 of `A-Z 0-9 . -`, a contract id over 40 characters and a sector over 40 characters or holding `:` or `|` cannot be stored in the `ff_` tables. The engine treats the symbol as not carded, the contract as missing and the sector as none, so one bad row in the universe cannot fail a whole batch.
- A capped hit is counted in the receipt (`hits_capped`) and listed in `capped` with no id. It still moved its state, so the next night does not propose it again. The hit id and the evidence are built after the caps, for the hits that stay, so a loose live wire that matches 300 windows costs ten.
- A receipt with `mode: "replace"` (nightly) overwrites its row; one with `mode: "accumulate"` (live) adds `looks`, `hits` and `hits_capped` to the row. `state_mismatch` and `duplicates` are counts for the log, not columns.
- A wire that throws costs that wire only: a `not_evaluated` receipt with `evaluator_error`, and an entry in `errors`.

## What the engine decides

**Three values.** TRUE, FALSE, UNKNOWN. A clause that is FALSE makes the wire FALSE even if another is UNKNOWN. Unknown never becomes FALSE and never becomes zero: it freezes the count and the phase, and the receipt names the reason and the first five names, alphabetically.

**Displayed precision.** Every value is rounded half away from zero to its unit's step before it is compared (`3.0004` and `2.996` are both 3.00). The evidence stores the rounded value, so a hit replays from its own record.

**Edge.** A wire is an event edge if any clause is an event, a state edge only if all clauses are states. An event wire fires when it is TRUE on `persist` looks in a row. A state wire does not fire on its first look: it records that it has not yet seen the condition false, and fires on the first TRUE after a FALSE. The first look of a new version, or of a version whose row was left by other clauses, is a first look.

**Hysteresis.** Once firing, a wire leaves only when a clause is FALSE at its relaxed threshold (the registry's band, in twentieths of a step). A dip inside the band does not re-arm it.

**Quiet period.** `cool_until` is an absolute session date: the first session on which looks count again. It is stored in the row, so a calendar change cannot move it.

**Live.** A live pending row carries the tick ordinal `t` in `detector_json`; a tick offered twice counts once. A live hit leaves no row: its dedupe key, which holds the session, is the quiet period, and `existingKeys` is how the engine knows. A pending row from an earlier session restarts at the first tick of the new one.

**Identity.** The dedupe key is `<subject>:<session>`, plus `:<clause_hash>` for a member wire. The hit id is the first 20 base32 characters of SHA-256 over `wire_id|dedupe_key`. The evaluator is not in the key, so the nightly catch-up of a live house wire (T03) and the live pass write the same id and the second finds the first in `existingKeys`. A change of scope alone keeps the clause hash and does not re-fire; a change of a threshold is a new hash and can fire again the same session.

**False discoveries.** The z of an anomaly metric is a median/MAD z against the 20 prior sessions (`robustZ` in `ff-stats.js`, at least 15 of 20, in log space for ratios, with the metric's floor). The tail is Student t with five degrees of freedom. For each wire the engine takes the names with every anomaly clause known, gives each the largest tail over its anomaly clauses, and applies Benjamini-Hochberg at 0.05 inside the wire's scope. The facts filter after the gate, and a name whose anomaly is unknown is not in the family.

**Caps.** Ten hits per member wire and per nightly house wire, twenty per live house wire, 25 per member, 500 in all. They apply in rounds of rank within the wire, then the hit id, so no wire is starved by another.

## Numbers a lead should know

- With 850 names, a lone name at z = 3.0 is not rejected: BH needs p at most 0.05/850, about z = 7.5. The threshold in a wire matters when many names are anomalous together, and on a quiet night a universe anomaly wire rarely fires. That is the contract's design, and `T01` on 850 names is budgeted at 0.28 expected false alarms a week.
- The budget is `5 x` the exact expected hits a night under the global null, rounded up to cents (`expWeekCents`). The null treats names as independent and the tail as exactly t5. A night with clustered flow, where many names move together, will fire more than the budget says. It is a calibration on a quiet night, not a ceiling.

## What the engine leaves to others

- **Snapshot builders (lane C and the Worker).** The format above is the engine's; the `ff-metrics` payload element shapes must be reconciled with it.
- **State housekeeping (lane B).** State rows of names that left a scope, of retired wires and of older versions are not deleted by the engine. A name that enters a scope after the first look is treated as seen-false, so a state wire can fire at once on entering.
- **House launch (lane G).** `HOUSE_EFFECTIVE_SESSION` in `ff-house.js` is a placeholder (`2026-11-02`). The house wires are pinned by `astHash`; a changed body is `registry_conflict` and is not evaluated.
- **T04** is blocked as `metric_warming` and T09 and T10 have no body; the engine reports each without evaluating.

## Proof

| Suite | What it holds |
|---|---|
| `ff-a-stats` | The tail, the robust z, the quantiser, the band, BH and the budget against exact references, Monte Carlo and the contract's vectors, with 29 planted wrong builds. |
| `ff-a-core` | The session calendar and labels, H7 across the winter and summer open, the health table, the ids and the sentences, with 34 planted wrong builds. |
| `ff-a-grammar` | The validator, the compiler, the limits and the budget. |
| `ff-a-engine` | The contract's edge vectors, a nightly and a live differential against independent machines, H1 to H5 with the worked numbers, BH gating against a reference step-up, the three-valued table, staleness, receipts, caps, evidence replay, windows, first looks, reruns and unusable names, with 87 planted wrong builds. Under the real modules each scenario also writes its rows into the real `ff_` tables in SQLite, so a CHECK, a UNIQUE or a trigger refuses what the engine should not produce. |
| `ff-a-bench` | 3,000 wires over 850 names: an independent oracle on a sample of 130 wires, the same rows through the real tables, and a CPU ceiling held as a ratio to a reference kernel for a first night (about 70 times the kernel, ceiling 120), a second night with 85,000 state rows (about 35 times, ceiling 60) and a live tick of 300 wires over 400 windows (about 22 times, ceiling 55), with 9 planted wrong builds, three of them slow ones that must break a ceiling. The suite is tagged `timing`, so CI retries it once. |

A planted wrong build is a copy of a module with one exact-once text change, loaded through a data URL. Each suite fails every one of its own.

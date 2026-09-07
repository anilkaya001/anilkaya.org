/* =============================================================
   flows-archive.js — what a write to a dated archive key is allowed to do.

   THE GUARD WAS CORRECT AND ITS INPUT WAS NOT. worker.js refuses a write
   that would change what a past session said, and every sentence of that
   refusal is right. But it decided from `readFlowsPayload(env, key)` called
   with NO trace, and that function's own JSDoc names the hazard it was
   ignoring:

     "`trace`, when a caller passes one, is stamped `failed: true` on the two
      ways a read can return null WITHOUT the row being absent"

   So a D1 SELECT that threw looked exactly like a key that had never been
   written, the guard fell through, and the unconditional
   ON CONFLICT DO UPDATE below it REWROTE an archived board — the precise
   outcome the guard's own comment says the mechanism exists to prevent.

   This is the founding rule of this codebase — an absence and an unreadable
   are different claims and must never collapse — violated on the server, in
   the one place it calls something a record.

   WHY THE DECISION IS A PURE FUNCTION AND NOT AN `if` IN THE ROUTE. The
   dangerous branch is the one that cannot be reached from outside: no test
   holding an HTTP client can make a SELECT throw, so the branch that decides
   what to do when a read FAILS would have shipped unexercised however
   carefully it was written. Lifted out, all four states are ordinary
   arguments and the suite asserts every one of them — which is the same
   move shared/flows-freshness.js makes for the refresh window, and for the
   same reason.
   ============================================================= */

/**
 * The four states a dated-key write can meet, and what each one earns.
 *
 * @param {object} state
 * @param {boolean} state.readable — did the store ANSWER? False means the read
 *   did not complete (no binding, or a SELECT that threw). It does NOT mean
 *   the key is absent, and the whole point of this module is that the two
 *   cannot be spelled the same way.
 * @param {boolean} state.exists — a row is there, and the read said so.
 * @param {boolean} state.same — that row's payload is byte-identical to the
 *   one being written.
 * @returns {"write"|"unchanged"|"refuse_immutable"|"refuse_unreadable"}
 *
 * REFUSING AN UNREADABLE IS NOT THE CAUTIOUS OPTION, IT IS THE ONLY HONEST
 * ONE. The alternative — write anyway — is a coin flip between a harmless
 * first publish and the silent destruction of a session's record, decided by
 * a fact the process just admitted it does not have. The pipeline retries on
 * 5xx, so a refusal that says 503 costs a run one retry; the other branch
 * costs the product the thing its accuracy claims are computed from.
 */
export function archiveWriteAction({ readable, exists, same } = {}) {
  if (!readable) return "refuse_unreadable";
  if (!exists) return "write";
  return same ? "unchanged" : "refuse_immutable";
}

/**
 * The HTTP status and error code each refusal carries.
 *
 * SEPARATE CODES BECAUSE THEY ARE SEPARATE FACTS, and a caller that cannot
 * tell them apart will retry the wrong one. `archive_immutable` is 409 and
 * final: the day is written, and correcting it is the deliberate two-step
 * DELETE-then-write. `archive_unreadable` is 503 and transient: nothing was
 * decided, nothing was written, and the same request will succeed once the
 * store answers. A pipeline that saw one status for both would either give
 * up on a retryable failure or hammer a permanent one.
 */
export const ARCHIVE_REFUSALS = Object.freeze({
  refuse_immutable: Object.freeze({
    status: 409,
    code: "archive_immutable",
    message:
      "A dated archive key already holds a different payload. The dated boards are the " +
      "record this product's accuracy claims are computed from, so a write that would " +
      "change what a past session said is refused. Delete the key first if it genuinely " +
      "must be corrected.",
  }),
  refuse_unreadable: Object.freeze({
    status: 503,
    code: "archive_unreadable",
    message:
      "The dated archive key could not be READ, which is not the same as its being " +
      "absent, and this write is refused rather than guessed at: writing on an " +
      "unreadable record risks overwriting a past session's board. Nothing was stored. " +
      "Retry once the store answers.",
  }),
  refuse_raced: Object.freeze({
    status: 409,
    code: "archive_raced",
    message:
      "The dated archive key was absent when it was read and present when it was " +
      "written, so another writer reached it in between. Nothing was overwritten — the " +
      "insert declines a conflict rather than resolving one — and this run cannot claim " +
      "the archive holds what it published. Read the key to see which run won.",
  }),
});

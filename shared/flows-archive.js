export function archiveWriteAction({ readable, exists, same } = {}) {
  if (!readable) return "refuse_unreadable";
  if (!exists) return "write";
  return same ? "unchanged" : "refuse_immutable";
}

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

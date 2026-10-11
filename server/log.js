import { emitFailure, failureEntry, failureLine } from "../shared/flows-log.js";

export { failureEntry, failureLine };

export function logFailure(level, event, fields, error) {
  emitFailure(console, level, event, fields, error);
}

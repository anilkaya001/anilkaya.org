export const errorText = (error) => (error instanceof Error ? error.message : String(error));

const LEVELS = new Set(["warn", "error"]);
const RESERVED = new Set(["event", "message", "level", "route", "code", "error"]);

const codeOf = (error) => (error !== null && typeof error === "object" && typeof error.code === "string" ? error.code : null);

export function failureEntry(level, event, fields, error) {
  const extra = fields !== null && typeof fields === "object" ? fields : {};
  const given = error === undefined ? extra.error : error;
  const entry = {
    event: String(event),
    message: String(event),
    level: LEVELS.has(level) ? level : "error",
    route: typeof extra.route === "string" ? extra.route : typeof extra.path === "string" ? extra.path : null,
    code: typeof extra.code === "string" ? extra.code : codeOf(error),
  };
  for (const key of Object.keys(extra)) if (!RESERVED.has(key)) entry[key] = extra[key];
  entry.error = given === undefined || given === null ? null : errorText(given);
  return entry;
}

export function failureLine(level, event, fields, error) {
  try {
    return JSON.stringify(failureEntry(level, event, fields, error));
  } catch {
    return JSON.stringify({ event: String(event), message: String(event), level: LEVELS.has(level) ? level : "error",
      route: null, code: null, error: "log entry could not be serialised" });
  }
}

export function emitFailure(sink, level, event, fields, error) {
  const method = LEVELS.has(level) ? level : "error";
  try {
    sink[method](failureLine(method, event, fields, error));
  } catch {
    return undefined;
  }
  return undefined;
}

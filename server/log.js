import { errorText } from "./http.js";

export function logFailure(level, message, fields, error) {
  console[level](JSON.stringify({ message, ...fields, error: errorText(error) }));
}

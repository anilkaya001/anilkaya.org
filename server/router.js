import { HttpError, requireMethod } from "./http.js";

const AUTH = Object.freeze(["none", "flows"]);
const METHODS = Object.freeze(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

function checked(row, seen) {
  if (row === null || typeof row !== "object") throw new TypeError("router: a row is an object");
  const { id, path, methods, auth, handler } = row;
  if (typeof id !== "string" || id === "") throw new TypeError("router: a row has an id");
  if (typeof path !== "string" || !path.startsWith("/") || path.length < 2) throw new TypeError("router: " + id + " has an absolute path");
  if (!Array.isArray(methods) || methods.length === 0 || !methods.every((m) => METHODS.includes(m))) {
    throw new TypeError("router: " + id + " lists its methods");
  }
  if (!AUTH.includes(auth)) throw new TypeError("router: " + id + " names an auth gate");
  if (typeof handler !== "function") throw new TypeError("router: " + id + " has a handler");
  if (seen.paths.has(path)) throw new TypeError("router: " + path + " is declared twice");
  if (seen.ids.has(id)) throw new TypeError("router: id " + id + " is declared twice");
  seen.paths.add(path);
  seen.ids.add(id);
  return Object.freeze({ id, path, methods: Object.freeze([...methods]), auth, handler });
}

export function createRouter(...families) {
  const seen = { paths: new Set(), ids: new Set() };
  const table = new Map();
  for (const family of families) {
    for (const row of family) table.set(row.path, checked(row, seen));
  }
  const rows = Object.freeze([...table.values()]);

  async function handle(rc, gates) {
    const row = table.get(rc.url.pathname);
    if (row === undefined) return null;
    requireMethod(rc.request, row.methods);
    let session = null;
    if (row.auth === "flows") {
      session = await gates.flows(rc.request, rc.env);
      if (!session) throw HttpError.of("unauthorized", "Authentication required");
    }
    return row.handler({ ...rc, session });
  }

  return Object.freeze({ rows, find: (path) => table.get(path) || null, handle });
}

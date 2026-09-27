export const LAB_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export const SIGN_IN_SQL = "INSERT INTO users (id, email, name, created_at, signed_in_at) VALUES (?, ?, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, signed_in_at=excluded.signed_in_at";
export const LEGACY_SIGN_IN_SQL = "INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name";
export const SIGNED_IN_COLUMN_SQL = "ALTER TABLE users ADD COLUMN signed_in_at INTEGER";

const messageOf = (error) => (error instanceof Error ? error.message : String(error));

export async function recordSignIn(db, user, at) {
  const write = () => db.prepare(SIGN_IN_SQL).bind(user.sub, user.email, user.name, at, at).run();
  try {
    return await write();
  } catch (error) {
    if (!/\bsigned_in_at\b/.test(messageOf(error))) throw error;
  }
  await db.prepare(SIGNED_IN_COLUMN_SQL).run().catch(() => null);
  try {
    return await write();
  } catch {
    return db.prepare(LEGACY_SIGN_IN_SQL).bind(user.sub, user.email, user.name, at).run();
  }
}

export const LAB_ACTIVITY = Object.freeze([
  Object.freeze({ sql: "SELECT MAX(created_at) AS at FROM users", lagMs: 0 }),
  Object.freeze({ sql: "SELECT MAX(signed_in_at) AS at FROM users", lagMs: 0 }),
  Object.freeze({ sql: "SELECT MAX(updated_at) AS at FROM stats", lagMs: LAB_SESSION_MS }),
  Object.freeze({ sql: "SELECT MAX(updated_at) AS at FROM progress", lagMs: LAB_SESSION_MS }),
]);

export async function readLabActiveAt(db) {
  if (!db || typeof db.prepare !== "function") return null;
  const rows = await Promise.all(LAB_ACTIVITY.map(({ sql }) =>
    Promise.resolve().then(() => db.prepare(sql).first()).catch(() => null)));
  let best = 0;
  rows.forEach((row, i) => {
    const at = Number(row && row.at);
    if (Number.isFinite(at) && at > 0) best = Math.max(best, at - LAB_ACTIVITY[i].lagMs);
  });
  return best > 0 ? new Date(best).toISOString() : null;
}

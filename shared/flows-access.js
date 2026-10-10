export function memberId(session) {
  const name = session && typeof session.username === "string" ? session.username : "";
  return name === "" ? null : name;
}

export async function memberAllowed(limiter, session) {
  const key = memberId(session);
  if (key === null || !limiter || typeof limiter.limit !== "function") return true;
  try {
    const verdict = await limiter.limit({ key });
    return !(verdict && verdict.success === false);
  } catch {
    return true;
  }
}

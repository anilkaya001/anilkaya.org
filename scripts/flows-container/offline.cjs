"use strict";

// A caught upstream error can be recoverable in production. Any attempted fetch
// must still fail the fixture process even if that error is caught by the caller.
globalThis.fetch = async function offlineFetch() {
  process.exitCode = 1;
  throw new Error("The nightly fixture attempted an outbound fetch.");
};

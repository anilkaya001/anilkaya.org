"use strict";

globalThis.fetch = async function offlineFetch() {
  process.exitCode = 1;
  throw new Error("The nightly fixture attempted an outbound fetch.");
};

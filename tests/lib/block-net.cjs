const fs = require("node:fs");
const net = require("node:net");
const tls = require("node:tls");
const log = process.env.ER_NET_LOG;
const note = (what) => { try { fs.appendFileSync(log, what + "\n"); } catch {} };
const loopback = (host) => host === "127.0.0.1" || host === "localhost" || host === "::1" || /\.test$/.test(String(host || ""));
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!loopback(url.hostname)) { note("fetch " + url.origin); throw new Error("outbound fetch refused: " + url.origin); }
  return realFetch(input, init);
};
for (const [mod, name] of [[net, "connect"], [tls, "connect"]]) {
  const real = mod[name];
  mod[name] = function (...args) {
    const opts = typeof args[0] === "object" && args[0] !== null ? args[0] : { port: args[0], host: args[1] };
    if (!loopback(opts.host || "localhost") && opts.path === undefined) { note(name + " " + opts.host); throw new Error("outbound socket refused: " + opts.host); }
    return real.apply(this, args);
  };
}

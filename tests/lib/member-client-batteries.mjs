import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT } from "../truth/mutants.mjs";
import { ok, eq } from "./member-batteries.mjs";

export const STORAGE_TEXT = fs.readFileSync(path.join(ROOT, "assets/js/storage.js"), "utf8");

export function mutateText(text, transforms, label) {
  let out = text;
  for (const [from, to] of transforms) {
    const first = out.indexOf(from);
    if (first === -1 || first !== out.lastIndexOf(from)) throw new Error("mutant did not apply: " + label + ": " + from.slice(0, 70));
    out = out.slice(0, first) + to + out.slice(first + from.length);
  }
  return out;
}

export function harness(text = STORAGE_TEXT, mode = "ok") {
  const values = new Map();
  const windowListeners = new Map();
  const state = { mode, writes: 0 };
  const localStorage = {
    getItem(key) {
      if (state.mode === "blind") throw new Error("denied");
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      state.writes += 1;
      if (state.mode === "throw") throw new Error("quota");
      if (state.mode === "silent") return;
      values.set(key, String(value));
    },
    removeItem(key) {
      if (state.mode === "throw") throw new Error("denied");
      if (state.mode === "silent") return;
      values.delete(key);
    },
  };
  const window = {
    TOPIC_META: [],
    CURRICULUM: {},
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (windowListeners.has(type)) windowListeners.get(type).delete(listener);
    },
  };
  const document = { dispatchEvent() { return true; } };
  window.document = document;
  const sandbox = { window, document, localStorage, Event: class {}, CustomEvent: class {}, console, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(text, sandbox, { filename: "assets/js/storage.js" });
  const fire = (key) => { for (const l of [...(windowListeners.get("storage") || [])]) l({ key }); };
  return { S: window.IEWTStorage, values, state, fire, listeners: windowListeners, key: (member) => "iewt:flows-watchlist:v1:" + encodeURIComponent("user:" + member) };
}

const plain = (v) => JSON.parse(JSON.stringify(v));

export function storageBattery(text = STORAGE_TEXT) {
  const M = "member.alpha";
  const N = "member.beta";
  {
    const h = harness(text);
    eq(plain(h.S.flowsWatchlist(M)), { names: [], at: null }, "a member with no stored list reads an empty one");
    eq([h.values.size, h.state.writes], [0, 0], "and the read wrote nothing");
    eq(h.S.flowsWatchlistSaved(M), true, "an empty store with an empty list is saved: there is nothing to lose");
    h.S.setFlowsWatchlist(M, { names: ["syb002", " SYA001 ", "SYA001", "bad name", 7, "SYC003"] });
    eq(plain(h.S.flowsWatchlist(M)).names, ["SYA001", "SYB002", "SYC003"], "a stored list is trimmed, upper-cased, de-duplicated, validated and sorted");
    eq(h.S.flowsWatchlistSaved(M), true, "a write that reached the store is saved");
    eq(h.S.flowsWatchlistSaved(N), true, "another member's empty list is separate and saved");
    eq(plain(h.S.flowsWatchlist(N)).names, [], "and is empty");
    const stored = JSON.parse(h.values.get(h.key(M)));
    eq([stored.version, stored.owner, Object.keys(stored.value).sort()], [1, "user:" + M, ["at", "names"]], "the envelope carries its version, owner and the two fields");
    const other = JSON.parse(JSON.stringify(stored));
    other.value.at = 12345;
    h.values.set(h.key(M), JSON.stringify(other));
    eq(h.S.flowsWatchlistSaved(M), true, "another tab saving the same names with a new time is still the same list");
    other.value.names = ["SYA001"];
    h.values.set(h.key(M), JSON.stringify(other));
    eq(h.S.flowsWatchlistSaved(M), false, "another tab saving different names is not");
    h.S.clearFlowsWatchlist(M);
    eq([h.values.has(h.key(M)), h.S.flowsWatchlistSaved(M)], [false, true], "clearing removes the key and leaves nothing unsaved");
    eq(plain(h.S.flowsWatchlist(M)).names, [], "and the list is empty");
    let threw = false;
    try { h.S.flowsWatchlist(null); } catch { threw = true; }
    ok(threw, "an anonymous reader has no list: it is a TypeError, not an empty list under a shared key");
    h.S.setFlowsWatchlist(M, { names: Array.from({ length: 260 }, (_, i) => "SYA" + String(i).padStart(3, "0")) });
    eq(plain(h.S.flowsWatchlist(M)).names.length, 200, "a list is cut at 200 names");
    h.S.setFlowsWatchlist(M, { names: ["SYA001"], at: "x" });
    eq(plain(h.S.flowsWatchlist(M)).at, null, "a time that is not an integer is dropped");
  }
  {
    const h = harness(text, "silent");
    h.S.setFlowsWatchlist(M, { names: ["SYA001"] });
    eq(plain(h.S.flowsWatchlist(M)).names, ["SYA001"], "a store that ignores writes still gives the page its list from memory");
    eq(h.S.flowsWatchlistSaved(M), false, "and says the list is not saved");
    h.S.setFlowsWatchlist(N, { names: [] });
    eq(h.S.flowsWatchlistSaved(N), true, "an empty list on the same store has nothing to lose");
  }
  {
    const h = harness(text, "throw");
    h.S.setFlowsWatchlist(M, { names: ["SYA001"] });
    eq(plain(h.S.flowsWatchlist(M)).names, ["SYA001"], "a store that throws still gives the page its list from memory");
    eq(h.S.flowsWatchlistSaved(M), false, "and says the list is not saved");
    h.state.mode = "ok";
    h.S.setFlowsWatchlist(M, { names: ["SYA001"] });
    eq(h.S.flowsWatchlistSaved(M), true, "a later write that lands makes it saved");
  }
  {
    const h = harness(text, "blind");
    h.S.setFlowsWatchlist(M, { names: ["SYA001"] });
    eq(plain(h.S.flowsWatchlist(M)).names, ["SYA001"], "a store that cannot be read still gives the page its list from memory");
    eq(h.S.flowsWatchlistSaved(M), false, "and cannot say that it is saved");
  }
  {
    const h = harness(text);
    let calls = 0;
    const base = (h.listeners.get("storage") || new Set()).size;
    const off = h.S.onFlowsWatchlist(M, () => { calls += 1; });
    eq((h.listeners.get("storage") || new Set()).size, base + 1, "a listener is added for the member");
    h.fire(h.key(M));
    h.fire(h.key(N));
    h.fire(null);
    eq(calls, 2, "a storage event for the member's key, or for a clear of the store, calls the handler; another member's key does not");
    off();
    h.fire(h.key(M));
    eq([calls, (h.listeners.get("storage") || new Set()).size], [2, base], "the returned function removes the listener");
  }
}

export const STORAGE_MUTANTS = [
  ["the saved check comparing bytes", [["return held !== null && kept !== null && held.length === kept.length && held.every((name, i) => name === kept[i]);", "return localStorage.getItem(key) === (memory.get(key) ?? null);"]]],
  ["the saved check always true", [["return held !== null && kept !== null && held.length === kept.length && held.every((name, i) => name === kept[i]);", "return true;"]]],
  ["a throwing store called saved", [["try { stored = localStorage.getItem(key); } catch { return false; }", "try { stored = localStorage.getItem(key); } catch { return true; }"]]],
  ["a read that writes", [['if (kind !== "flowsWatchlist") writeScoped(kind, value, owner);', "writeScoped(kind, value, owner);"]]],
  ["an anonymous owner allowed", [['if (owner === ANONYMOUS) throw new TypeError("A watchlist belongs to a signed-in member");', ""]]],
  ["names not validated", [["if (!FLOWS_TICKER.test(name) || seen.has(name)) continue;", "if (seen.has(name)) continue;"]]],
  ["names not sorted", [["return { names: names.sort(), at:", "return { names, at:"]]],
  ["no cap on the list", [["      if (names.length === 200) break;\n", ""]]],
  ["every storage event handled", [["if (event.key === key || event.key === null) handler();", "handler();"]]],
  ["the listener never removed", [['return () => window.removeEventListener("storage", listener);', "return () => {};"]]],
];

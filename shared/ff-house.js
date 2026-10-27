import { TEMPLATES, canonicalJson } from "./ff-contract.js";
import { storedBody, compileWire, subjectKindOf, clauseHashOf } from "./ff-grammar.js";
import { wireSentence } from "./ff-sentence.js";
import { astHash } from "./ff-ids.js";
import { metricById } from "./ff-contract.js";

export const HOUSE_EFFECTIVE_SESSION = "2026-11-02";

export const HOUSE_VERSION = 1;

export const PINNED = Object.freeze({
  "h-t01": "8121696fe3ac8666bf1dd0427e85d1b8add85c059095d344c4a8ab12e3769d41",
  "h-t02": "f12cc330df495d4aaa921a98d02e5a5c550b9d285607b0ac01d98280da9973c7",
  "h-t03": "8cbac839ccbdbcc68b157ba511f87fd818b9ec445e001f346c529e9451447ced",
  "h-t04": "06b3464ac9a2c5c2636d9ea42b0e8c72c64a1e5fc66f541f8bf9708ce42bb307",
  "h-t05": "c4e87636b8c05760040192b724158ef4a789bd09b21775f68e6e32e1d3c98a25",
  "h-t06": "bd8f6377dc10169532b46a209578296c2fbdf895f273582839d53fac239c3f7c",
  "h-t07a": "7c353af306dccf39e002ba6417a9a0a37e16c9815a4bd51fb35cb86a89a00e8b",
  "h-t07b": "1fd4a006e2c4a3030b35fc03ae6b26511b364a391e51fd35355a9c2de7f908e8",
  "h-t08": "a25f4519635d2e785ab7afe5cbd973488ff271a0ee67b6cf304cd7f914f58ef8",
});

function entryOf(template, id, title, body) {
  const metrics = body.all.map((c) => metricById(c.m));
  const subjectKind = subjectKindOf(metrics);
  const stored = storedBody(body);
  return Object.freeze({
    id,
    version: HOUSE_VERSION,
    effectiveSession: HOUSE_EFFECTIVE_SESSION,
    template: template.id,
    title,
    sentence: wireSentence(body, subjectKind),
    body,
    subjectKind,
    catchup: template.catchup === true,
    astHash: PINNED[id],
    computedHash: astHash(stored),
  });
}

export const HOUSE_WIRES = Object.freeze(
  TEMPLATES.flatMap((t) => {
    if (t.ast === null) return [];
    if (t.variants) return t.variants.map((v) => entryOf(t, v.id, v.sentence, { ...t.ast, all: v.clauses }));
    return [entryOf(t, t.house[0], t.title, t.ast)];
  }),
);

export const houseById = (id) => HOUSE_WIRES.find((w) => w.id === id) || null;

export function compileHouse(entry, over = {}) {
  return compileWire({
    id: entry.id, layer: "house", version: entry.version, body: entry.body, title: entry.title, sentence: entry.sentence,
    catchup: entry.catchup, effectiveSession: entry.effectiveSession, pinned: entry.astHash, ...over,
  });
}

export function houseRows(entry, nowMs) {
  const stored = storedBody(entry.body);
  return {
    wire: {
      id: entry.id, layer: "house", member_id: null, title: entry.title.slice(0, 80), status: "armed", status_at: nowMs,
      current_version: entry.version, origin: null, created_at: nowMs,
    },
    version: {
      wire_id: entry.id, version: entry.version, template: entry.template, cadence: entry.body.cadence, scope_kind: entry.body.scope.kind,
      control: stored.d.control, exp_week: null, clause_hash: clauseHashOf(entry.body), ast_json: canonicalJson(stored), ast_hash: entry.computedHash,
      sentence: entry.sentence, registry_version: stored.d.rv, effective_session: entry.effectiveSession, created_at: nowMs,
    },
  };
}

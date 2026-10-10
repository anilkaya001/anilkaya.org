export const ISOLATION = Object.freeze({ fatal: "fatal", isolated: "isolated" });

export const WHY_CAP = 120;

export const HEALTH_LINES = 3;

export const HEALTH_LINE_CAP = 160;

const stage = (id, isolation, needs, publishes = []) =>
  Object.freeze({ id, isolation, needs: Object.freeze(needs), publishes: Object.freeze(publishes) });

export const STAGES = Object.freeze([
  stage("session", ISOLATION.fatal, []),
  stage("universe", ISOLATION.fatal, ["session"]),
  stage("enrich", ISOLATION.fatal, ["universe"]),
  stage("score", ISOLATION.fatal, ["enrich"]),
  stage("boards", ISOLATION.fatal, ["score"], ["board:long", "board:short"]),
  stage("watch", ISOLATION.isolated, ["boards"], ["board:watch"]),
  stage("scores", ISOLATION.isolated, ["boards"], ["scores:*"]),
  stage("market", ISOLATION.isolated, ["boards"], ["market"]),
  stage("movers", ISOLATION.isolated, ["boards"], ["movers"]),
  stage("market-legs", ISOLATION.isolated, ["boards"]),
  stage("market-universe", ISOLATION.isolated, ["market-legs"], ["universe"]),
  stage("market-regime", ISOLATION.isolated, ["market-legs"], ["regime"]),
  stage("events", ISOLATION.isolated, ["market-legs"], ["events"]),
  stage("record", ISOLATION.isolated, ["boards"], ["record"]),
  stage("scoretrack", ISOLATION.isolated, ["record"], ["scoretrack"]),
  stage("sector-trix", ISOLATION.isolated, ["boards"], ["sector:trix"]),
  stage("chains", ISOLATION.isolated, ["boards"], ["board:long", "board:short", "board:long:*", "board:short:*", "flowalerts", "movers", "unusual"]),
  stage("pulse", ISOLATION.fatal, ["chains"], ["pulse"]),
  stage("political", ISOLATION.isolated, ["pulse"], ["political"]),
  stage("sector-news", ISOLATION.fatal, ["political"], ["sector:premium", "news"]),
  stage("congress", ISOLATION.fatal, ["sector-news"]),
  stage("vol-leg", ISOLATION.isolated, ["congress"]),
  stage("cards", ISOLATION.fatal, ["vol-leg"], ["card:*"]),
  stage("ideas", ISOLATION.isolated, ["cards"], ["ideas"]),
  stage("cross-cards", ISOLATION.fatal, ["cards"], ["card:*"]),
  stage("vol-flow", ISOLATION.fatal, ["cross-cards"], ["card-x:*", "hist:*", "regime"]),
  stage("dossiers", ISOLATION.fatal, ["vol-flow"], ["card:*"]),
  stage("focus", ISOLATION.isolated, ["dossiers"], ["focus"]),
  stage("card-x", ISOLATION.fatal, ["dossiers"], ["card-x:*"]),
  stage("roster", ISOLATION.isolated, ["card-x"], ["roster"]),
  stage("archive-check", ISOLATION.fatal, ["roster"]),
  stage("neuron-ledger", ISOLATION.isolated, ["roster"]),
  stage("brief", ISOLATION.isolated, ["neuron-ledger"], ["brief"]),
  stage("live-dry", ISOLATION.fatal, ["brief"], ["live:*"]),
  stage("gate", ISOLATION.fatal, ["brief"]),
]);

export function declares(spec, key) {
  return spec.publishes.some((p) => (p.endsWith("*") ? key.startsWith(p.slice(0, -1)) : key === p));
}

const clip = (text, cap) => {
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > cap ? s.slice(0, cap - 1) + "…" : s;
};

export function createStageRunner({ table = STAGES, clock = () => Date.now(), calls = () => 0 } = {}) {
  const byId = new Map(table.map((s) => [s.id, s]));
  const done = new Map();
  const outside = [];
  let open = null;

  const begin = (spec) => ({ spec, at: clock(), calls: calls(), keys: 0, undeclared: [] });

  const close = (frame, status, why) => {
    const record = {
      id: frame.spec.id, status, ms: Math.max(0, Math.round(clock() - frame.at)),
      calls: Math.max(0, calls() - frame.calls), keys: frame.keys,
    };
    if (why) record.why = clip(why, WHY_CAP);
    if (frame.undeclared.length) record.undeclared = frame.undeclared.slice(0, 5);
    done.set(frame.spec.id, record);
  };

  const enter = (id, wanted) => {
    const spec = byId.get(id);
    if (!spec) throw new Error(`stage ${id} is not in the stage table`);
    if (wanted && spec.isolation !== wanted) throw new Error(`stage ${id} is ${spec.isolation}, not ${wanted}`);
    if (done.has(id) || (open && open.spec.id === id)) throw new Error(`stage ${id} ran twice`);
    for (const need of spec.needs) {
      if (!done.has(need)) throw new Error(`stage ${id} needs ${need}, which has not run`);
    }
    return spec;
  };

  const settle = () => {
    if (open) {
      close(open, "ok");
      open = null;
    }
  };

  return {
    step(id) {
      settle();
      const spec = enter(id, ISOLATION.fatal);
      open = begin(spec);
    },

    async run(id, work, onError) {
      settle();
      const spec = enter(id);
      const frame = begin(spec);
      open = frame;
      try {
        const out = await work();
        close(frame, "ok");
        return out;
      } catch (error) {
        close(frame, "failed", error && error.message ? error.message : String(error));
        if (spec.isolation === ISOLATION.fatal) throw error;
        if (onError) onError(error);
        return undefined;
      } finally {
        open = null;
      }
    },

    skip(id, why) {
      settle();
      const spec = enter(id);
      const record = { id: spec.id, status: "skipped", ms: 0, calls: 0, keys: 0 };
      if (why) record.why = clip(why, WHY_CAP);
      done.set(spec.id, record);
    },

    note(key) {
      if (!open) {
        outside.push(key);
        return;
      }
      open.keys++;
      if (!declares(open.spec, key)) open.undeclared.push(key);
    },

    finish() {
      settle();
      for (const spec of table) {
        if (!done.has(spec.id)) done.set(spec.id, { id: spec.id, status: "skipped", ms: 0, calls: 0, keys: 0 });
      }
    },

    records() {
      return table.map((s) => done.get(s.id)).filter(Boolean);
    },

    outside() {
      return outside.slice();
    },

    open() {
      return open ? open.spec.id : null;
    },
  };
}

export function healthRecord(health) {
  const failures = (health && health.failures) || [];
  const warnings = (health && health.warnings) || [];
  return {
    failures: failures.length,
    warnings: warnings.length,
    first: [...failures, ...warnings].slice(0, HEALTH_LINES).map((line) => clip(line, HEALTH_LINE_CAP)),
  };
}

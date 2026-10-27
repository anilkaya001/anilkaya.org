import { readFileSync } from "node:fs";
import { DRY_RUN, EMIT } from "../flags.mjs";
import { poolWidth, runPooled, uw } from "../vendor.mjs";
import { publish, publishedStore, readStored } from "../store.mjs";
import { stampNow } from "../../flows-legs/stamp.mjs";
import { num } from "../../../shared/flows-features.js";
import { chainFor, readPriorVa, runVolAudit, runVolDesk, carriedVa } from "../../flows-legs/voldesk.mjs";
import { makeVoldeskFake } from "../../flows-legs/voldesk-fake.mjs";
import {
  FUND_TICKERS, auditCap, auditSummary, buildStance, buildVoldesk, characterSection, siteDispersion, voldeskBuildOn,
} from "../../../shared/flows-voldesk.js";

export const VOLAUDIT_STAGE_ID = "vol-audit";

export const VOLDESK_STAGE_ID = "voldesk";

function probeShapes() {
  try {
    return JSON.parse(readFileSync(new URL("../../flows-probe-shapes.json", import.meta.url), "utf8"));
  } catch {
    return null;
  }
}

const test = () => Boolean(DRY_RUN || EMIT);

export async function runVolAuditStage(ctx, deps = {}) {
  const { stages, sessionDate, cardX } = ctx;
  const env = deps.env || process.env;
  if (!voldeskBuildOn(env)) {
    stages.skip(VOLAUDIT_STAGE_ID, "FLOWS_VOLDESK_BUILD is off");
    return;
  }
  const result = await stages.run(VOLAUDIT_STAGE_ID, async () => {
    const store = deps.store || publishedStore;
    const names = (ctx.cardTickers || []).filter((t) => store["card:" + t] && store["card:" + t].engine);
    const at = stampNow();
    const cardOf = (t) => store["card:" + t] || null;
    const rowsOf = ctx.quantRows || new Map();
    const short = ctx.chainShort || new Set();
    const chainOf = (t) => (rowsOf.has(t) ? chainFor(rowsOf.get(t), short.has(t)) : null);
    const carriers = [...new Set([...names, ...FUND_TICKERS, ...(cardX ? cardX.tickers() : [])])];
    const prior = await readPriorVa(carriers, { readPrior: (t) => (deps.read || readStored)("card-x:" + t), pool: runPooled, width: poolWidth(4).width });
    const feed = deps.uw || (test() ? makeVoldeskFake({ sessionDate, cardOf, chainOf }) : uw);
    const run = await runVolAudit({
      uw: feed, session: sessionDate, now: at, names, cardOf, chainOf, priorVa: prior.priors,
      liquidity: (t) => { const e = ctx.byTicker && ctx.byTicker.get(t); return e ? num(e.row && e.row.marketcap, 0) || 0 : 0; },
      deadline: ctx.deadline || null, pool: runPooled, width: poolWidth(3).width, cap: auditCap(env), log: (line) => console.log(line),
    });
    let carried = 0;
    for (const t of carriers) {
      const va = carriedVa(t, run.vas, prior.priors, sessionDate);
      if (!va || !cardX) continue;
      if (!run.vas.has(t)) carried++;
      cardX.add(t, "va", va);
    }
    const summary = { ...auditSummary(run.vas), calls: run.calls, shape: Object.fromEntries(Object.entries(run.ops).map(([id, o]) => [id, { n: o.n, bad: o.bad }])) };
    Object.assign(ctx, { volAudit: { vas: run.vas, stance: run.stance, ops: run.ops, summary, skipped: run.skipped, priorFailed: prior.failed.size } });
    stages.detail({ names: summary.names, compared: summary.compared, differs: summary.differs, carried });
    console.log(`  vol audit: ${summary.agree} agree, ${summary.differs} differ, ${summary.nc} not compared over ${summary.names} name(s); ${carried} earlier audit(s) carried` +
      (prior.failed.size ? `; ${prior.failed.size} prior card-x unread` : ""));
    return run;
  }, (error) => {
    console.warn(`  vol audit: ${error.message} — card-x publishes without a cross-check tonight`);
  });
  if (!result && !ctx.volAudit) Object.assign(ctx, { volAudit: null });
}

export async function runVoldeskStage(ctx, deps = {}) {
  const { stages, sessionDate } = ctx;
  const env = deps.env || process.env;
  if (!voldeskBuildOn(env)) {
    stages.skip(VOLDESK_STAGE_ID, "FLOWS_VOLDESK_BUILD is off");
    return;
  }
  await stages.run(VOLDESK_STAGE_ID, async () => {
    const store = deps.store || publishedStore;
    const read = deps.read || readStored;
    const generatedAt = stampNow();
    const priorRead = await read("voldesk");
    const prior = priorRead && !priorRead.failed && priorRead.payload && typeof priorRead.payload === "object" ? priorRead.payload : null;
    const stanceRead = await read("voldesk-stance");
    const ring = stanceRead && !stanceRead.failed && stanceRead.payload && Array.isArray(stanceRead.payload.ring) ? stanceRead.payload.ring : [];
    const cardOf = (t) => store["card:" + t] || null;
    const feed = deps.uw || (test() ? makeVoldeskFake({ sessionDate, cardOf, chainOf: () => null }) : uw);
    const desk = await runVolDesk({ uw: feed, session: sessionDate, shapes: probeShapes(), deadline: ctx.deadline || null, log: (line) => console.log(line) });
    let character = characterSection(desk.chars[0], desk.chars[1], prior && prior.session !== sessionDate && prior.character ? prior.character.prev : null);
    if (prior && prior.session === sessionDate && prior.character) {
      character = { ...character, movers: prior.character.movers, ...(prior.character.moversWhy ? { moversWhy: prior.character.moversWhy } : {}), prev: prior.character.prev };
    }
    const audit = ctx.volAudit ? ctx.volAudit.summary : { names: 0, compared: 0, agree: 0, differs: 0, nc: 0, worst: [], calls: 0 };
    const ops = { ...(ctx.volAudit ? ctx.volAudit.ops : {}) };
    for (const [id, o] of Object.entries(desk.ops)) ops[id] = o;
    const payload = buildVoldesk({
      term: { funds: desk.term, futures: desk.futures }, ivrv: desk.ivrv, matrix: desk.matrix,
      site: siteDispersion(store.dispersion || null), character, audit, ops,
    }, { session: sessionDate, generatedAt, test: test() });
    await publish("voldesk", payload);
    const stance = buildStance(ring, ctx.volAudit ? ctx.volAudit.stance : new Map(), { session: sessionDate, test: test() });
    await publish("voldesk-stance", stance);
    stages.detail({ marketCalls: desk.calls, audited: audit.names, ring: stance.ring.length });
    console.log(`  voldesk: published, futures ${desk.futures.status}, ${payload.character.movers === null ? "no movers yet" : payload.character.movers.length + " mover(s)"}, stance ring ${stance.ring.length} session(s)`);
  }, (error) => {
    console.warn(`  voldesk: ${error.message} — the Vol desk and the stance store keep their last payloads`);
  });
}

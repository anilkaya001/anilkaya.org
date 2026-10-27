import { DRY_RUN } from "../flags.mjs";
import { publish, publishedStore, readStored } from "../store.mjs";
import { poolWidth, runPooled, uw } from "../vendor.mjs";
import { stampNow } from "../../flows-legs/stamp.mjs";
import { buildMacro, fitMacro, addressFree } from "../../../shared/flows-macro.js";
import { macroBuildOn, runMacro } from "../../flows-legs/macro.mjs";
import { makeMacroFakeVendor } from "../../flows-legs/macro-fake.mjs";
import { pmCapOf, runPrivateNames, runPrivateSectors, sleepingUntil, wakeSession } from "../../flows-legs/private.mjs";
import { PM_NAMES_CAP, buildPm, fitPm } from "../../../shared/flows-private.js";

export const MACRO_STAGE_ID = "macro";
export const PM_NAMES_STAGE_ID = "pm-names";
export const PM_SECTORS_STAGE_ID = "pm-sectors";

export const PRIOR_READ_LIMIT = 120;

const calendarOf = (ctx) => {
  const events = publishedStore.events;
  const macro = events && events.macro;
  return macro && Array.isArray(macro.rows) ? macro.rows : [];
};

export async function runMacroStage(ctx) {
  const { stages, sessionDate, deadline } = ctx;
  if (!macroBuildOn()) {
    stages.skip(MACRO_STAGE_ID, "FLOWS_MACRO_BUILD is off");
    return;
  }
  ctx.macroMeta = { build: true, written: false, calls: 0, ops: {} };
  await stages.run(MACRO_STAGE_ID, async () => {
    const generatedAt = stampNow();
    const feed = DRY_RUN ? makeMacroFakeVendor({ sessionDate }) : uw;
    const run = await runMacro({
      uw: feed, session: sessionDate, generatedAt, calendar: calendarOf(ctx), deadline, pool: runPooled, width: poolWidth(2).width,
      log: (line) => console.log(line),
    });
    ctx.macroMeta = { build: true, written: false, calls: run.calls, ops: Object.fromEntries(Object.entries(run.tally).map(([op, t]) => [op, { n: t.n, bad: t.bad }])) };
    const built = buildMacro(run.input, { test: DRY_RUN });
    const fitted = fitMacro(built);
    if (!addressFree(fitted.payload)) {
      ctx.macroMeta.address = true;
      throw new Error("an address-shaped string is in the macro payload");
    }
    await publish("macro", fitted.payload);
    const odds = fitted.payload.odds;
    ctx.macroMeta = {
      ...ctx.macroMeta,
      written: true,
      odds: { matched: odds.counts.matched, thin: odds.counts.thin },
      pm: { calls: 0, names: 0, sectors: 0 },
      bytes: fitted.bytes,
      shed: fitted.shed.length,
    };
    stages.detail({ reads: run.calls, bytes: fitted.bytes, shed: fitted.shed.length });
  }, (error) => {
    if (error && error.fixtureLeak) throw error;
    console.warn(`  macro: ${error.message}`);
  });
}

export async function runPmNames(ctx) {
  const { stages, sessionDate, deadline, cardX, cardTickers } = ctx;
  if (!macroBuildOn()) {
    stages.skip(PM_NAMES_STAGE_ID, "FLOWS_MACRO_BUILD is off");
    return;
  }
  await stages.run(PM_NAMES_STAGE_ID, async () => {
    const cap = pmCapOf();
    const names = (cardTickers || []).slice(0, PRIOR_READ_LIMIT);
    const candidates = [];
    const prior = await readStored("pm");
    const sleeping = sleepingUntil(prior && prior.payload ? prior.payload : null, sessionDate);
    const read = async (t) => {
      const held = await readStored("card-x:" + t);
      const old = held && held.payload && typeof held.payload === "object" ? held.payload : null;
      const fresh = cardX && cardX.get ? cardX.get(t) : null;
      const dx = (fresh && fresh.dx) || (old && old.dx) || null;
      candidates.push({ ticker: t, cardX: { dx }, pm: old && old.pm ? old.pm : null });
    };
    await runPooled(names, read, { width: 4 });
    candidates.sort((a, b) => names.indexOf(a.ticker) - names.indexOf(b.ticker));
    const feed = DRY_RUN ? makeMacroFakeVendor({ sessionDate }) : uw;
    const run = await runPrivateNames({
      uw: feed, candidates, session: sessionDate, now: Date.parse(stampNow()), deadline, budget: Math.min(cap, PM_NAMES_CAP * 2), sleeping, log: (line) => console.log(line),
    });
    const sections = new Map(run.sections);
    for (const c of candidates) if (!sections.has(c.ticker) && c.pm) sections.set(c.ticker, c.pm);
    if (cardX && cardX.add) for (const [t, section] of sections) cardX.add(t, "pm", section);
    ctx.pmNames = sections;
    ctx.pmNamesRun = { calls: run.calls, plan: run.plan, asleep: run.asleep, names: run.sections.size, tally: run.tally };
    stages.detail({ reads: run.calls, names: run.sections.size, sleeping: run.asleep ? 1 : 0 });
  }, (error) => {
    if (error && error.fixtureLeak) throw error;
    console.warn(`  pm names: ${error.message}`);
  });
}

export async function runPmSectors(ctx) {
  const { stages, sessionDate, deadline, marketLegs } = ctx;
  if (!macroBuildOn()) {
    stages.skip(PM_SECTORS_STAGE_ID, "FLOWS_MACRO_BUILD is off");
    return;
  }
  await stages.run(PM_SECTORS_STAGE_ID, async () => {
    const cap = pmCapOf();
    const used = ctx.pmNamesRun ? ctx.pmNamesRun.calls : 0;
    const held = await readStored("pm");
    const prior = held && held.payload && typeof held.payload === "object" ? held.payload : null;
    const universe = marketLegs && marketLegs.universe ? marketLegs.universe : null;
    const sectors = universe && Array.isArray(universe.sectors) ? universe.sectors : [];
    const asleep = (ctx.pmNamesRun && ctx.pmNamesRun.asleep) || sleepingUntil(prior, sessionDate);
    const feed = DRY_RUN ? makeMacroFakeVendor({ sessionDate }) : uw;
    const run = asleep
      ? { sectors: prior ? prior.sectors : {}, investors: prior ? prior.investors : undefined, calls: 0, plan: false, sector: null }
      : await runPrivateSectors({ uw: feed, session: sessionDate, now: Date.parse(stampNow()), prior, sectors, cap, used, deadline, log: (line) => console.log(line) });
    const plan = run.plan || (ctx.pmNamesRun && ctx.pmNamesRun.plan) || false;
    const payload = buildPm({
      session: sessionDate, generatedAt: stampNow(), sectors: run.sectors, investors: run.investors,
      calls: used + run.calls, plan,
    }, { test: DRY_RUN });
    if (plan) payload.basis.sleepUntil = wakeSession(sessionDate);
    else if (asleep && prior && prior.basis && prior.basis.sleepUntil) payload.basis.sleepUntil = prior.basis.sleepUntil;
    const fitted = fitPm(payload);
    await publish("pm", fitted.payload);
    if (ctx.macroMeta) ctx.macroMeta.pm = { calls: used + run.calls, names: ctx.pmNamesRun ? ctx.pmNamesRun.names : 0, sectors: Object.keys(run.sectors).length };
    stages.detail({ reads: run.calls, bytes: fitted.bytes });
  }, (error) => {
    if (error && error.fixtureLeak) throw error;
    console.warn(`  pm sectors: ${error.message}`);
  });
}

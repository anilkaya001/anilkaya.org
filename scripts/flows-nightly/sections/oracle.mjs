import { rankTop } from "../../../shared/flows-oracle.js";
import { ORACLE_JOB, oracleBuildOn } from "../../flows-legs/oracle.mjs";
import { NORM_KEY, emptyNorm, foldNorm } from "../../flows-legs/oracle-norm.mjs";
import { stampNow } from "../../flows-legs/stamp.mjs";
import { publish, publishedStore, readStored } from "../store.mjs";

export const ORACLE_TOP_KEY = "oracle-top";
export const ORACLE_TOP_ROWS = 40;

export async function runOraclePrep(ctx) {
  ctx.stored = (key) => publishedStore[key];
  ctx.oracleNormNow = null;
  ctx.oracleNormFresh = false;
  if (!oracleBuildOn()) return;
  try {
    const read = await readStored(NORM_KEY);
    const readable = !(read && read.failed);
    const prior = readable && read.payload ? read.payload : emptyNorm();
    const alerts = publishedStore.flowalerts;
    const rows = alerts && Array.isArray(alerts.rows) ? alerts.rows : [];
    ctx.oracleNormNow = foldNorm(prior, rows, ctx.sessionDate);
    ctx.oracleNormFresh = readable;
  } catch (error) {
    console.warn(`  oracle norm: ${error.message} — no flow norm tonight`);
  }
}

const ORACLE_WRITES_IN_FLIGHT = 40;

export async function runOraclePublish(ctx) {
  const { stages, computed, sessionDate } = ctx;
  if (!oracleBuildOn()) {
    stages.skip("oracle-publish", "FLOWS_ORACLE_BUILD is off");
    return;
  }
  await stages.run("oracle-publish", async () => {
    const results = computed && computed.results ? computed.results.get(ORACLE_JOB.id) : null;
    const records = results ? [...results.values()] : [];
    let calls = 0, signals = 0, conflicts = 0, bytes = 0, shed = 0, failed = 0;
    let leak = null;
    const writes = [];
    for (const record of records) {
      const body = JSON.stringify(record);
      writes.push(Promise.resolve().then(() => publish("oracle:" + record.ticker, record)).then(() => {
        bytes += body.length;
        calls += record.calls.length;
        if (record.state === "signal") signals++;
        if (record.state === "conflict") conflicts++;
        if (record.shed) shed++;
      }, (error) => {
        if (error && error.fixtureLeak) { leak = leak || error; return; }
        failed++;
        console.warn(`  oracle ${record.ticker}: ${error.message}`);
      }));
      if (writes.length >= ORACLE_WRITES_IN_FLIGHT) {
        await Promise.all(writes.splice(0));
        if (leak) throw leak;
      }
    }
    await Promise.all(writes);
    if (leak) throw leak;
    const generatedAt = stampNow();
    if (records.length) {
      await publish("oracle-top", { v: 1, session: sessionDate, sessionDate, generatedAt, items: rankTop(records, { limit: ORACLE_TOP_ROWS }) });
    }
    if (ctx.oracleNormNow && ctx.oracleNormFresh) {
      await publish(NORM_KEY, { ...ctx.oracleNormNow, generatedAt });
    }
    stages.detail({ names: records.length, priced: calls, signals, conflicts, bytes, shed });
    console.log(`  oracle: ${records.length} record(s), ${calls} call(s), ${signals} signal(s), ${conflicts} conflict(s), ${bytes} bytes, ${failed} failed`);
  }, (error) => {
    console.warn(`  oracle: ${error.message} — yesterday's records stand`);
  });
}

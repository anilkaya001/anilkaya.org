export const COMPUTE_NAME_CPU_MS = 1000;

export const COMPUTE_JOBS = Object.freeze([]);

export function processCpuMs() {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

export async function computeNames({
  names, jobs, ctx = {}, cpu = processCpuMs, perNameMs = COMPUTE_NAME_CPU_MS, stop = () => false, turn = nextTurn,
}) {
  const out = {
    names: 0, jobs: jobs.length, over: [], failed: [], stopped: null, cpuMs: 0,
    results: new Map(jobs.map((job) => [job.id, new Map()])),
  };
  const started = cpu();
  const share = names.length * perNameMs;
  if (jobs.length) {
    for (const ticker of names) {
      if (stop()) {
        out.stopped = "deadline";
        break;
      }
      if (cpu() - started >= share) {
        out.stopped = "share";
        break;
      }
      const before = cpu();
      for (const job of jobs) {
        try {
          const value = await job.run(ticker, ctx);
          if (value !== undefined) out.results.get(job.id).set(ticker, value);
        } catch (error) {
          out.failed.push({ t: ticker, job: job.id, why: error && error.message ? error.message : String(error) });
        }
      }
      const spent = cpu() - before;
      if (spent > perNameMs) out.over.push({ t: ticker, ms: Math.round(spent) });
      out.names++;
      await turn();
    }
  }
  out.cpuMs = Math.round(cpu() - started);
  return out;
}

export async function runCompute(ctx) {
  const { stages, cardTickers, byTicker, deadline, computeWith } = ctx;
  const { jobs = COMPUTE_JOBS, cpu = processCpuMs, perNameMs = COMPUTE_NAME_CPU_MS } = computeWith || {};
  const computed = await stages.run("compute", async () => {
    const names = cardTickers.filter((t) => byTicker.has(t));
    const out = await computeNames({
      names, jobs, ctx, cpu, perNameMs, stop: () => Number.isFinite(deadline) && Date.now() > deadline,
    });
    stages.detail({
      names: out.names, jobs: out.jobs, over: out.over.length, failed: out.failed.length,
      ...(out.stopped ? { stopped: out.stopped } : {}),
    });
    console.log(`  compute: ${out.names} of ${names.length} deep name(s), ${out.jobs} job(s), ${out.cpuMs}ms CPU` +
      (out.stopped ? `, stopped at the ${out.stopped}` : ""));
    for (const o of out.over.slice(0, 5)) console.warn(`  compute: ${o.t} took ${o.ms}ms CPU, over the ${perNameMs}ms a name may spend`);
    for (const f of out.failed.slice(0, 5)) console.warn(`  compute: ${f.job} ${f.t}: ${f.why}`);
    return out;
  }, (error) => {
    console.warn(`  compute: ${error.message}`);
  });
  Object.assign(ctx, { computed: computed || null });
}

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const out = new URL("../assets/data/projects/", import.meta.url);
await mkdir(out, { recursive: true });
let seed = 20260715;
const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
const normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random());
const checksum = (text) => createHash("sha256").update(text).digest("hex");
const isoMonth = (startYear, startMonth, offset) => {
  const date = new Date(Date.UTC(startYear, startMonth - 1 + offset, 1));
  return date.toISOString().slice(0, 7) + "-01";
};
const isoDay = (start, offset) => { const date = new Date(`${start}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };

let cpi = 100, ip = 100, rate = 2.1;
const macro = ["date,cpi_index,industrial_production_index,federal_funds_rate"];
for (let t = 0; t < 180; t++) {
  const cycle = Math.sin(t / 15);
  cpi *= Math.exp(0.0019 + 0.0006 * cycle + normal() * 0.0009);
  ip += 0.06 + 0.32 * cycle + normal() * 0.38;
  rate = Math.max(0.05, 0.88 * rate + 0.18 + 0.16 * cycle + normal() * 0.10);
  macro.push(`${isoMonth(2010, 1, t)},${cpi.toFixed(4)},${ip.toFixed(4)},${rate.toFixed(4)}`);
}

let fx = 1.12, variance = 0.000025;
const fxRows = ["date,usd_per_eur"];
for (let t = 0, business = 0; business < 600; t++) {
  const date = new Date(`${isoDay("2023-01-02", t)}T00:00:00Z`);
  if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
  const shock = Math.sqrt(variance) * normal();
  fx *= Math.exp(-0.00004 + shock);
  variance = 0.000001 + 0.09 * shock ** 2 + 0.87 * variance;
  fxRows.push(`${date.toISOString().slice(0, 10)},${fx.toFixed(6)}`); business++;
}

const factors = ["date,mkt_rf,smb,hml,rf,portfolio_excess"];
for (let t = 0; t < 240; t++) {
  const mkt = 0.006 + normal() * 0.042, smb = 0.0015 + normal() * 0.025, hml = 0.002 + normal() * 0.027, rf = 0.0015 + normal() * 0.00045;
  const portfolio = 0.001 + 1.08 * mkt + 0.32 * smb - 0.18 * hml + normal() * 0.021;
  factors.push(`${isoMonth(2005, 1, t)},${mkt.toFixed(7)},${smb.toFixed(7)},${hml.toFixed(7)},${rf.toFixed(7)},${portfolio.toFixed(7)}`);
}

const datasets = [
  { id: "macro-forecasting-desk", file: "macro-synthetic-v1.csv", rows: macro, frequency: "monthly", transformations: ["deterministic synthetic log-level CPI", "synthetic industrial-production index", "synthetic annualized policy rate"], references: [
    { label: "FRED CPIAUCSL", url: "https://fred.stlouisfed.org/series/CPIAUCSL" },
    { label: "FRED INDPRO", url: "https://fred.stlouisfed.org/series/INDPRO" },
    { label: "FRED FEDFUNDS", url: "https://fred.stlouisfed.org/series/FEDFUNDS" },
  ] },
  { id: "fx-volatility-risk", file: "fx-synthetic-v1.csv", rows: fxRows, frequency: "business daily", transformations: ["deterministic synthetic USD per EUR levels", "GARCH-like conditional variance"], references: [{ label: "ECB USD/EUR reference-rate series", url: "https://data.ecb.europa.eu/data/datasets/EXR/EXR.D.USD.EUR.SP00.A" }] },
  { id: "factor-pricing-lab", file: "factors-synthetic-v1.csv", rows: factors, frequency: "monthly", transformations: ["deterministic synthetic decimal returns", "portfolio excess return constructed from three synthetic factors"], references: [{ label: "Kenneth French Data Library", url: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html" }] },
];

const provenance = [];
for (const dataset of datasets) {
  const text = dataset.rows.join("\n") + "\n";
  await writeFile(new URL(dataset.file, out), text);
  provenance.push({
    id: dataset.id, version: 1, file: `/assets/data/projects/${dataset.file}`, sha256: checksum(text),
    generatedAt: "2026-07-15", synthetic: true, sourceObservationReuse: false,
    reuseTerms: "CC0-1.0 for this generated synthetic snapshot; no external observations are redistributed.",
    frequency: dataset.frequency, rowCount: dataset.rows.length - 1, transformations: dataset.transformations,
    methodologyReferences: dataset.references.map((reference) => ({ ...reference, verifiedFromPlan: true })),
    note: "External observation reuse permission was not verified for this build, so the project uses a clearly identified deterministic synthetic dataset.",
  });
}
await writeFile(new URL("provenance.json", out), JSON.stringify({ schemaVersion: 1, datasets: provenance }, null, 2) + "\n");
console.log(`Generated ${provenance.length} synthetic project snapshots with SHA-256 provenance.`);

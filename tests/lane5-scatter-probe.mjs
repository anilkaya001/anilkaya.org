import { chromium } from "playwright";
const svg = (n) => {
  const marks = [];
  for (let i = 0; i < n; i++) {
    const x = 52 + (i * 37 % 560), y = 24 + (i * 53 % 348);
    marks.push(i % 2
      ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="pm-put"/>`
      : `<rect x="${(x-3.5).toFixed(1)}" y="${(y-3.5).toFixed(1)}" width="7" height="7" class="pm-call"/>`);
  }
  return `<svg viewBox="0 0 640 420" width="100%"><g>${marks.join("")}</g></svg>`;
};
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
await p.setContent(`<style>.pm-put{fill:#7ec}.pm-call{fill:none;stroke:#e97;stroke-width:1.5}</style><div id="host"></div>`);
for (const n of [60, 120, 480, 1200, 2400]) {
  const markup = svg(n);
  const t = await p.evaluate(async ([html]) => {
    const host = document.getElementById("host");
    const t0 = performance.now();
    host.innerHTML = html;
    host.getBoundingClientRect();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t1 = performance.now();
    return { ms: t1 - t0, nodes: host.querySelectorAll("*").length };
  }, [markup]);
  console.log(`n=${String(n).padStart(4)} svg ${(markup.length/1024).toFixed(1).padStart(6)}KB  nodes ${String(t.nodes).padStart(5)}  parse+layout+2raf ${t.ms.toFixed(1)}ms`);
}
await b.close();

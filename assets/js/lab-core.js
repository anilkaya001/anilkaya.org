/* =============================================================
   lab-core.js — the real compute engine + code editor.
   - Loads Pyodide + numpy/pandas/scipy/statsmodels/matplotlib.
   - makeCell(): an editable cell with Python syntax highlighting
     (overlay technique, no CDN) and Run.
   - run(): executes real Python, streams stdout, colours p-values
     green (<0.05) / red, and renders matplotlib figures beneath.
   Exposes window.Lab: { run, makeCell, ready, highlight, colorize }.
   ============================================================= */
(() => {
  "use strict";

  const PYODIDE_VERSION = "0.26.4";
  const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

  const PREAMBLE = `
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
# Match the website's typography (Computer Modern == Latin Modern's basis,
# bundled with matplotlib so it needs no download) and a clean, gridless look.
plt.rcParams.update({
    "figure.facecolor": "#0a0a08", "axes.facecolor": "#0a0a08",
    "savefig.facecolor": "#0a0a08", "savefig.edgecolor": "#0a0a08",
    "text.color": "#ece8d8", "axes.labelcolor": "#ece8d8",
    "axes.titlecolor": "#ece8d8", "xtick.color": "#b7b298",
    "ytick.color": "#b7b298", "axes.edgecolor": "#6f6b57",
    "axes.grid": False,                       # gridless backgrounds
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.linewidth": 0.8,
    "font.family": "serif",
    "font.serif": ["CMU Serif", "Latin Modern Roman", "cmr10", "DejaVu Serif"],
    "mathtext.fontset": "cm", "axes.unicode_minus": False,
    "axes.formatter.use_mathtext": True,     # silence cmr10+mathtext warning; nicer tick numerals
    "font.size": 12, "axes.titlesize": 13, "axes.labelsize": 12,
    "legend.fontsize": 10.5, "legend.frameon": False,
    "figure.dpi": 130, "figure.figsize": (7.0, 4.2),
    "lines.linewidth": 1.9, "lines.markersize": 5,
    "patch.linewidth": 0.8,
})
import io as _io, base64 as _b64
import numpy as np, pandas as pd
def _grab_figs():
    out = []
    for n in plt.get_fignums():
        f = plt.figure(n)
        b = _io.BytesIO()
        f.savefig(b, format="png", bbox_inches="tight", pad_inches=0.28)
        out.append(_b64.b64encode(b.getvalue()).decode("ascii"))
    plt.close("all")
    return out
`;

  let pyodide = null, booting = null;

  // ---- HTML escape + Python highlighter (no dependencies) -----
  const escHtml = (s) => s.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));

  const KW = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(" "));
  const BUILTIN = new Set("print range len int float str list dict set tuple bool sum abs min max round sorted enumerate zip map filter open super self np pd sm smf plt scipy stats".split(" "));

  function highlight(src) {
    let out = "", i = 0; const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === "#") { let j = i; while (j < n && src[j] !== "\n") j++; out += '<span class="tk-c">' + escHtml(src.slice(i, j)) + "</span>"; i = j; continue; }
      if (c === '"' || c === "'") {
        const triple = src.substr(i, 3) === c + c + c;
        const q = triple ? c + c + c : c;
        let j = i + q.length;
        while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src.substr(j, q.length) === q) { j += q.length; break; } j++; }
        out += '<span class="tk-s">' + escHtml(src.slice(i, j)) + "</span>"; i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
        let j = i + 1; while (j < n && /[0-9_.]/.test(src[j])) j++;
        if (/[eE]/.test(src[j] || "")) { j++; if (/[+\-]/.test(src[j] || "")) j++; while (j < n && /[0-9]/.test(src[j])) j++; }
        out += '<span class="tk-n">' + escHtml(src.slice(i, j)) + "</span>"; i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        const w = src.slice(i, j);
        const after = src[j] === "(" ? "fn" : "";
        if (KW.has(w)) out += '<span class="tk-k">' + w + "</span>";
        else if (BUILTIN.has(w)) out += '<span class="tk-b">' + w + "</span>";
        else if (after === "fn") out += '<span class="tk-f">' + w + "</span>";
        else out += escHtml(w);
        i = j; continue;
      }
      out += escHtml(c); i++;
    }
    return out;
  }

  // ---- Colour p-values green (<0.05) / red in console output ---
  function sig(v) { return parseFloat(v) < 0.05 ? "sig" : "insig"; }
  function colorize(text) {
    return escHtml(text).split("\n").map((line) => {
      // statsmodels coefficient row: label + 6 floats; the 4th is P>|t|
      const m = line.match(/^(\s*\S.*?\s+)(-?\d+\.\d+)(\s+)(-?\d+\.\d+)(\s+)(-?\d+\.\d+)(\s+)(\d+\.\d+)(\s+)(-?\d+\.\d+)(\s+)(-?\d+\.\d+)(\s*)$/);
      if (m) {
        const cls = sig(m[8]);
        const row = m[1] + m[2] + m[3] + m[4] + m[5] + m[6] + m[7] +
          '<span class="' + cls + '">' + m[8] + "</span>" + m[9] + m[10] + m[11] + m[12] + m[13];
        // wrap significant rows so FX.ignite can sweep them
        return cls === "sig" ? '<span class="sigrow">' + row + "</span>" : row;
      }
      return line
        .replace(/(Prob[^:]*:\s*)([0-9.]+(?:[eE][+-]?\d+)?)/g, (_, a, b) => a + '<span class="' + sig(b) + '">' + b + "</span>")
        .replace(/\b(p(?:[-\s]?value)?\s*[=:]\s*)([0-9.]+(?:[eE][+-]?\d+)?)/gi, (_, a, b) => a + '<span class="' + sig(b) + '">' + b + "</span>");
    }).join("\n");
  }

  // ---- Boot indicator -----------------------------------------
  function bootEl() {
    let b = document.getElementById("labBoot");
    if (!b) {
      b = document.createElement("div"); b.id = "labBoot"; b.className = "boot";
      b.innerHTML = '<span class="boot__spin"></span><span class="boot__txt"></span>';
      document.body.appendChild(b);
    }
    return b;
  }
  const boot = (m) => { const b = bootEl(); b.querySelector(".boot__txt").textContent = m; b.classList.add("show"); };
  const bootDone = () => bootEl().classList.remove("show");

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src)); document.head.appendChild(s); });
  }

  async function getPyodide() {
    if (pyodide) return pyodide;
    if (booting) return booting;
    booting = (async () => {
      try {
        boot("Loading the Python runtime…");
        if (!window.loadPyodide) await loadScript(CDN + "pyodide.js");
        const py = await window.loadPyodide({ indexURL: CDN });
        boot("Loading NumPy · pandas · SciPy · statsmodels…");
        await py.loadPackage(["numpy", "pandas", "scipy", "statsmodels", "matplotlib"]);
        boot("Warming up…");
        await py.runPythonAsync(PREAMBLE);
        pyodide = py; bootDone(); return py;
      } catch (e) { boot("Could not load the Python runtime — check your connection."); setTimeout(bootDone, 4000); booting = null; throw e; }
    })();
    return booting;
  }

  async function run(code, els) {
    const out = els.out, figs = els.figs;
    out.textContent = ""; if (figs) figs.innerHTML = "";
    const stream = document.createElement("span"); out.appendChild(stream);
    let buf = "";
    const write = (s) => { buf += s; stream.textContent = buf; out.scrollTop = out.scrollHeight; };

    let py;
    try { py = await getPyodide(); }
    catch { const er = document.createElement("span"); er.className = "err"; er.textContent = "The Python runtime failed to load. Please retry."; out.appendChild(er); return false; }

    py.setStdout({ batched: write }); py.setStderr({ batched: write });
    try {
      await py.runPythonAsync(code);
      stream.innerHTML = colorize(buf);                 // colour p-values once complete
      if (window.FX && window.FX.ignite) window.FX.ignite(stream);   // significant rows "resolve"
      if (figs) {
        const proxy = await py.runPythonAsync("_grab_figs()");
        const arr = proxy.toJs(); proxy.destroy();
        renderFigs(figs, arr);
      }
      return true;
    } catch (e) {
      stream.innerHTML = colorize(buf);
      if (window.FX && window.FX.ignite) window.FX.ignite(stream);
      const er = document.createElement("span"); er.className = "err"; er.textContent = (buf ? "\n" : "") + (e && e.message ? e.message : String(e)); out.appendChild(er);
      return false;
    } finally { py.setStdout(); py.setStderr(); }
  }

  // Render matplotlib PNGs: live (slider) figures crossfade so the
  // before/after delta is visible; first-arrival figures "develop".
  function renderFigs(figs, arr) {
    const mk = (b64) => { const img = document.createElement("img"); img.loading = "lazy"; img.alt = "Model output figure"; img.src = "data:image/png;base64," + b64; return img; };
    const live = figs.classList && figs.classList.contains("stage__figs--live");
    if (live && arr.length === 1 && window.FX && window.FX.swap) { window.FX.swap(figs, mk(arr[0])); return; }
    figs.innerHTML = "";
    arr.forEach((b64, k) => {
      const img = mk(b64); figs.appendChild(img);
      if (!live && window.FX && window.FX.reveal) {
        (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => window.FX.reveal(img, { stagger: k }));
      }
    });
  }

  // ---- Editable, highlighted, runnable code cell --------------
  function makeCell({ code = "", title = "python", onRun, figsEl = null } = {}) {
    const cell = document.createElement("div"); cell.className = "cell";
    const bar = document.createElement("div"); bar.className = "cell__bar";
    bar.innerHTML = '<span class="cell__dot"></span><span class="cell__title"></span>' +
      '<button class="cell__reset" type="button">Reset</button><button class="cell__run" type="button">▷ Run</button>';
    bar.querySelector(".cell__title").textContent = title;

    const initial = code.replace(/^\n/, "");
    const wrap = document.createElement("div"); wrap.className = "cell__editwrap";
    const pre = document.createElement("pre"); pre.className = "cell__hl"; pre.setAttribute("aria-hidden", "true");
    const editor = document.createElement("textarea"); editor.className = "cell__editor"; editor.spellcheck = false;
    editor.setAttribute("aria-label", "Python editor: " + title);
    editor.value = initial;
    editor.rows = Math.min(28, Math.max(3, initial.split("\n").length));
    const paint = () => { pre.innerHTML = highlight(editor.value) + "\n"; };
    editor.addEventListener("input", paint);
    editor.addEventListener("scroll", () => { pre.scrollTop = editor.scrollTop; pre.scrollLeft = editor.scrollLeft; });
    paint();
    wrap.append(pre, editor);

    const out = document.createElement("div"); out.className = "cell__out";
    // Figures can render into an external target (e.g. the left guide column)
    // so a tall code cell doesn't push the chart far down the page.
    const figs = figsEl || document.createElement("div");
    if (figsEl) { cell.append(bar, wrap, out); }
    else { figs.className = "cell__figs"; cell.append(bar, wrap, out, figs); }

    const runBtn = bar.querySelector(".cell__run");
    const resetBtn = bar.querySelector(".cell__reset");
    async function doRun() {
      if (runBtn.disabled) return;    // Ctrl+Enter bypasses the disabled button; guard re-entry
      runBtn.disabled = true; const label = runBtn.textContent; runBtn.textContent = "Running…";
      if (window.FX && window.FX.runState) window.FX.runState(runBtn, "busy");
      const ok = await run(editor.value, { out, figs });
      if (window.FX && window.FX.runState) window.FX.runState(runBtn, "done");
      runBtn.textContent = label; runBtn.disabled = false;
      if (ok) {
        if (window.FX && window.FX.landed) window.FX.landed((figs && figs.children && figs.children.length) ? figs : out);
        if (typeof onRun === "function") onRun(runBtn);
      }
    }
    runBtn.addEventListener("click", doRun);
    resetBtn.addEventListener("click", () => { editor.value = initial; paint(); out.textContent = ""; figs.innerHTML = ""; });
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); const s = editor.selectionStart, en = editor.selectionEnd; editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(en); editor.selectionStart = editor.selectionEnd = s + 4; paint(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doRun(); }
    });

    return { el: cell, run: doRun, getCode: () => editor.value };
  }

  window.Lab = { run, makeCell, ready: getPyodide, highlight, colorize, version: PYODIDE_VERSION };
})();

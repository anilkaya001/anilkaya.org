/* =============================================================
   lab-core.js — the real compute engine.
   Loads Pyodide (CPython on WebAssembly) + numpy/pandas/scipy/
   statsmodels/matplotlib IN THE BROWSER. Estimation is genuine
   statsmodels output, not an approximation, and costs nothing to
   serve because it runs on the visitor's machine.
   Exposes window.Lab: { run(code, els), makeCell(opts), ready() }.
   ============================================================= */
(() => {
  "use strict";

  const PYODIDE_VERSION = "0.26.4";
  const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

  const PREAMBLE = `
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
plt.rcParams.update({
    "figure.facecolor": "#0a0a08", "axes.facecolor": "#0a0a08",
    "savefig.facecolor": "#0a0a08", "savefig.edgecolor": "#0a0a08",
    "text.color": "#ece8d8", "axes.labelcolor": "#ece8d8",
    "axes.titlecolor": "#ece8d8", "xtick.color": "#b7b298",
    "ytick.color": "#b7b298", "axes.edgecolor": "#6f6b57",
    "grid.color": "#221f17", "axes.grid": True, "grid.alpha": 0.4,
    "font.size": 11, "figure.dpi": 120,
})
import io as _io, base64 as _b64
import numpy as np, pandas as pd
def _grab_figs():
    out = []
    for n in plt.get_fignums():
        f = plt.figure(n)
        b = _io.BytesIO()
        f.savefig(b, format="png", bbox_inches="tight")
        out.append(_b64.b64encode(b.getvalue()).decode("ascii"))
    plt.close("all")
    return out
`;

  let pyodide = null;
  let booting = null;

  // ---- Boot indicator -----------------------------------------
  function bootEl() {
    let b = document.getElementById("labBoot");
    if (!b) {
      b = document.createElement("div");
      b.id = "labBoot";
      b.className = "boot";
      b.innerHTML = '<span class="boot__spin"></span><span class="boot__txt"></span>';
      document.body.appendChild(b);
    }
    return b;
  }
  function boot(msg) {
    const b = bootEl();
    b.querySelector(".boot__txt").textContent = msg;
    b.classList.add("show");
  }
  function bootDone() { bootEl().classList.remove("show"); }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
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
        pyodide = py;
        bootDone();
        return py;
      } catch (e) {
        boot("Could not load the Python runtime — check your connection.");
        setTimeout(bootDone, 4000);
        booting = null;
        throw e;
      }
    })();
    return booting;
  }

  // ---- Run one block of Python --------------------------------
  async function run(code, els) {
    const out = els.out, figs = els.figs;
    out.textContent = ""; if (figs) figs.innerHTML = "";
    const stream = document.createElement("span");
    out.appendChild(stream);
    let buf = "";
    const write = (s) => { buf += s; stream.textContent = buf; out.scrollTop = out.scrollHeight; };

    let py;
    try {
      py = await getPyodide();
    } catch {
      const er = document.createElement("span");
      er.className = "err";
      er.textContent = "The Python runtime failed to load. Please retry.";
      out.appendChild(er);
      return false;
    }

    py.setStdout({ batched: write });
    py.setStderr({ batched: write });
    try {
      await py.runPythonAsync(code);
      if (figs) {
        const proxy = await py.runPythonAsync("_grab_figs()");
        const arr = proxy.toJs();
        proxy.destroy();
        for (const b64 of arr) {
          const img = document.createElement("img");
          img.loading = "lazy";
          img.alt = "Model output figure";
          img.src = "data:image/png;base64," + b64;
          figs.appendChild(img);
        }
      }
      return true;
    } catch (e) {
      const er = document.createElement("span");
      er.className = "err";
      er.textContent = (buf ? "\n" : "") + (e && e.message ? e.message : String(e));
      out.appendChild(er);
      return false;
    } finally {
      py.setStdout(); py.setStderr();
    }
  }

  // ---- Build an editable, runnable code cell ------------------
  function makeCell({ code = "", title = "python", onRun } = {}) {
    const cell = document.createElement("div");
    cell.className = "cell";

    const bar = document.createElement("div");
    bar.className = "cell__bar";
    bar.innerHTML =
      '<span class="cell__dot"></span><span class="cell__title"></span>' +
      '<button class="cell__reset" type="button">Reset</button>' +
      '<button class="cell__run" type="button">▷ Run</button>';
    bar.querySelector(".cell__title").textContent = title;

    const editor = document.createElement("textarea");
    editor.className = "cell__editor";
    editor.spellcheck = false;
    editor.setAttribute("aria-label", "Python editor: " + title);
    const initial = code.replace(/^\n/, "");
    editor.value = initial;
    editor.rows = Math.min(26, Math.max(3, initial.split("\n").length));

    const out = document.createElement("div");
    out.className = "cell__out";
    const figs = document.createElement("div");
    figs.className = "cell__figs";

    cell.append(bar, editor, out, figs);

    const runBtn = bar.querySelector(".cell__run");
    const resetBtn = bar.querySelector(".cell__reset");

    async function doRun() {
      runBtn.disabled = true;
      const label = runBtn.textContent;
      runBtn.textContent = "Running…";
      const ok = await run(editor.value, { out, figs });
      runBtn.textContent = label;
      runBtn.disabled = false;
      if (ok && typeof onRun === "function") onRun();
    }

    runBtn.addEventListener("click", doRun);
    resetBtn.addEventListener("click", () => { editor.value = initial; out.textContent = ""; figs.innerHTML = ""; });

    // Tab inserts spaces; Cmd/Ctrl+Enter runs.
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = editor.selectionStart, en = editor.selectionEnd;
        editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(en);
        editor.selectionStart = editor.selectionEnd = s + 4;
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        doRun();
      }
    });

    return { el: cell, run: doRun, getCode: () => editor.value };
  }

  window.Lab = { run, makeCell, ready: getPyodide, version: PYODIDE_VERSION };
})();

(() => {
  "use strict";

  const PYODIDE_VERSION = "0.26.4";
  const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

  const SETUP = {
    numpy: "import numpy as np",
    pandas: "import pandas as pd",
    matplotlib: `
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
plt.rcParams.update({
    "figure.facecolor": "#0a0a08", "axes.facecolor": "#0a0a08",
    "savefig.facecolor": "#0a0a08", "savefig.edgecolor": "#0a0a08",
    "text.color": "#ece8d8", "axes.labelcolor": "#ece8d8",
    "axes.titlecolor": "#ece8d8", "xtick.color": "#b7b298",
    "ytick.color": "#b7b298", "axes.edgecolor": "#6f6b57",
    "axes.grid": False,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.linewidth": 0.8,
    "font.family": "serif",
    "font.serif": ["CMU Serif", "Latin Modern Roman", "cmr10", "DejaVu Serif"],
    "mathtext.fontset": "cm", "axes.unicode_minus": False,
    "axes.formatter.use_mathtext": True,
    "font.size": 12, "axes.titlesize": 13, "axes.labelsize": 12,
    "legend.fontsize": 10.5, "legend.frameon": False,
    "figure.dpi": 130, "figure.figsize": (7.0, 4.2),
    "lines.linewidth": 1.9, "lines.markersize": 5,
    "patch.linewidth": 0.8,
})
import io as _io, base64 as _b64
def _grab_figs():
    out = []
    for n in plt.get_fignums():
        f = plt.figure(n)
        b = _io.BytesIO()
        f.savefig(b, format="png", bbox_inches="tight", pad_inches=0.28)
        out.append(_b64.b64encode(b.getvalue()).decode("ascii"))
    plt.close("all")
    return out
`,
  };
  const PACKAGES = ["numpy", "pandas", "scipy", "statsmodels", "patsy", "matplotlib"];
  const LABELS = { numpy: "NumPy", pandas: "pandas", scipy: "SciPy", statsmodels: "statsmodels", patsy: "patsy", matplotlib: "Matplotlib" };
  const MODULES = { numpy: "numpy", pandas: "pandas", scipy: "scipy", statsmodels: "statsmodels", patsy: "patsy", matplotlib: "matplotlib", mpl_toolkits: "matplotlib", pylab: "matplotlib" };
  const GLOBALS = { np: "numpy", pd: "pandas", plt: "matplotlib", matplotlib: "matplotlib" };

  function withDeps(want) {
    if (want.has("statsmodels")) { want.add("scipy"); want.add("pandas"); }
    return PACKAGES.filter((name) => want.has(name));
  }

  function packagesFor(code) {
    const want = new Set(["numpy"]);
    for (const m of code.replace(/#[^\n]*/g, "").matchAll(/(?:^|[;:])[ \t]*(?:import[ \t]+([^\n;]+)|from[ \t]+([A-Za-z_]\w*)[\w.]*[ \t]+import\b)/gm)) {
      for (const name of m[1] ? m[1].split(",").map((part) => part.trim().split(/[\s.]/)[0]) : [m[2]]) if (MODULES[name]) want.add(MODULES[name]);
    }
    for (const m of code.matchAll(/(?:^|[^\w.])(np|pd|plt|matplotlib)\./gm)) want.add(GLOBALS[m[1]]);
    return withDeps(want);
  }
  const label = (names) => names.map((name) => LABELS[name]).join(" · ");

  let pyodide = null, booting = null;
  const ready = new Set(), settingUp = new Map();

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

  function sig(v) { return parseFloat(v) < 0.05 ? "sig" : "insig"; }
  function colorize(text) {
    return escHtml(text).split("\n").map((line) => {

      const m = line.match(/^(\s*\S.*?\s+)(-?\d+\.\d+)(\s+)(-?\d+\.\d+)(\s+)(-?\d+\.\d+)(\s+)(\d+\.\d+)(\s+)(-?\d+\.\d+)(\s+)(-?\d+\.\d+)(\s*)$/);
      if (m) {
        const cls = sig(m[8]);
        const row = m[1] + m[2] + m[3] + m[4] + m[5] + m[6] + m[7] +
          '<span class="' + cls + '">' + m[8] + "</span>" + m[9] + m[10] + m[11] + m[12] + m[13];

        return cls === "sig" ? '<span class="sigrow">' + row + "</span>" : row;
      }
      return line
        .replace(/(Prob[^:]*:\s*)([0-9.]+(?:[eE][+-]?\d+)?)/g, (_, a, b) => a + '<span class="' + sig(b) + '">' + b + "</span>")
        .replace(/\b(p(?:[-\s]?value)?\s*[=:]\s*)([0-9.]+(?:[eE][+-]?\d+)?)/gi, (_, a, b) => a + '<span class="' + sig(b) + '">' + b + "</span>");
    }).join("\n");
  }

  function bootEl() {
    let b = document.getElementById("labBoot");
    if (!b) {
      b = document.createElement("div"); b.id = "labBoot"; b.className = "boot";
      b.setAttribute("role", "status");
      b.innerHTML = '<span class="boot__spin" aria-hidden="true"></span><span class="boot__txt"></span>';
      document.body.appendChild(b);
    }
    return b;
  }
  const boot = (m) => { const b = bootEl(); b.querySelector(".boot__txt").textContent = m; b.classList.add("show"); };
  const bootDone = () => { const b = document.getElementById("labBoot"); if (b) b.classList.remove("show"); };

  const loads = new Map();
  let running = 0;
  function show() {
    const last = Array.from(loads.values()).pop();
    if (last) boot(last);
    else if (running) boot("Running…");
    else bootDone();
  }
  function track() {
    const token = {};
    return {
      say(text) { loads.delete(token); loads.set(token, text); show(); },
      end() { loads.delete(token); },
    };
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src)); document.head.appendChild(s); });
  }

  async function getPyodide(packages = ["numpy"], t) {
    if (pyodide) return pyodide;
    const own = !t;
    if (own) t = track();
    t.say("Loading Python · " + label(packages) + "…");
    try {
      if (!booting) {
        booting = (async () => {
          try {
            if (!window.loadPyodide) await loadScript(CDN + "pyodide.js");
            pyodide = await window.loadPyodide({ indexURL: CDN, packages });
            return pyodide;
          } catch (e) { boot("Could not load the Python runtime — check your connection."); setTimeout(show, 4000); booting = null; throw e; }
        })();
      }
      return await booting;
    } finally {
      if (own) { t.end(); if (pyodide) show(); }
    }
  }

  function setUp(py, name) {
    if (!settingUp.has(name)) {
      settingUp.set(name, py.runPythonAsync(SETUP[name]).then(() => { ready.add(name); }, (e) => { settingUp.delete(name); throw e; }));
    }
    return settingUp.get(name);
  }

  async function prepare(py, packages, say) {
    const missing = packages.filter((name) => !(name in py.loadedPackages));
    if (missing.length) { say("Loading " + label(missing) + "…"); await py.loadPackage(missing); }
    const setup = packages.filter((name) => SETUP[name] && !ready.has(name));
    if (setup.length) say("Warming up " + label(setup) + "…");
    for (const name of setup) await setUp(py, name);
    return missing.length > 0 || setup.length > 0;
  }

  const unset = (name, py) => !(name in py.loadedPackages) || (SETUP[name] && !ready.has(name));

  function imported(py, code) {
    try {
      const finder = py.pyimport("pyodide.code");
      try {
        const found = finder.find_imports(code);
        try { return Array.from(found.toJs()); } finally { found.destroy(); }
      } finally { finder.destroy(); }
    } catch { return []; }
  }

  function neededBy(error, code, py) {
    const text = String((error && error.message) || error);
    const m = text.match(/No module named '([A-Za-z_]\w*)|Missing optional dependency '([A-Za-z_]\w*)'|\b(matplotlib) is required for plotting|NameError: name '(np|pd|plt|matplotlib)' is not defined/);
    const first = m && (MODULES[m[1] || m[2] || m[3]] || GLOBALS[m[4]]);
    if (!first || !unset(first, py)) return [];
    const want = new Set([first]);
    for (const name of imported(py, code)) if (MODULES[name]) want.add(MODULES[name]);
    return withDeps(want).filter((name) => unset(name, py));
  }

  async function run(code, els) {
    const out = els.out, figs = els.figs;
    out.textContent = ""; if (figs) figs.innerHTML = "";
    const stream = document.createElement("span"); out.appendChild(stream);
    let buf = "";
    const write = (s) => { buf += s; stream.textContent = buf; out.scrollTop = out.scrollHeight; };
    const fail = (text) => { const er = document.createElement("span"); er.className = "err"; er.textContent = text; out.appendChild(er); return false; };
    const packages = packagesFor(code);
    const t = track();
    let holding = false;
    const hold = () => { if (!holding) { holding = true; running++; } };

    let py, busy = false, failure = "";
    try { py = await getPyodide(packages, t); }
    catch { t.end(); return fail("The Python runtime failed to load. Please retry."); }
    try { busy = await prepare(py, packages, t.say); }
    catch { failure = "The Python packages failed to load. Please retry."; }
    if (busy) hold();
    t.end(); show();
    if (failure) return fail(failure);

    py.setStdout({ batched: write }); py.setStderr({ batched: write });
    try {
      try { await py.runPythonAsync(code); }
      catch (e) {
        const names = neededBy(e, code, py);
        if (!names.length) throw e;
        hold(); await prepare(py, names, t.say); t.end(); show();
        if (ready.has("matplotlib")) await py.runPythonAsync('__import__("matplotlib.pyplot").pyplot.close("all")');
        buf = ""; stream.textContent = "";
        await py.runPythonAsync(code);
      }
      stream.innerHTML = colorize(buf);
      if (window.FX && window.FX.ignite) window.FX.ignite(stream);
      if (figs && ready.has("matplotlib")) {
        const proxy = await py.runPythonAsync("_grab_figs()");
        const arr = proxy.toJs(); proxy.destroy();
        renderFigs(figs, arr);
      }
      return true;
    } catch (e) {
      stream.innerHTML = colorize(buf);
      if (window.FX && window.FX.ignite) window.FX.ignite(stream);
      return fail((buf ? "\n" : "") + (e && e.message ? e.message : String(e)));
    } finally { py.setStdout(); py.setStderr(); t.end(); if (holding) { running--; show(); } }
  }

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

  function makeCell({ code = "", title = "python", onRun, onResult, prepareCode, figsEl = null } = {}) {
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

    const figs = figsEl || document.createElement("div");
    if (figsEl) { cell.append(bar, wrap, out); }
    else { figs.className = "cell__figs"; cell.append(bar, wrap, out, figs); }

    const runBtn = bar.querySelector(".cell__run");
    const resetBtn = bar.querySelector(".cell__reset");
    async function doRun() {
      if (runBtn.disabled) return;
      const refocus = document.activeElement === runBtn;
      runBtn.disabled = true; const label = runBtn.textContent; runBtn.textContent = "Running…";
      if (window.FX && window.FX.runState) window.FX.runState(runBtn, "busy");
      const submitted = editor.value;
      const executable = typeof prepareCode === "function" ? prepareCode(submitted) : submitted;
      const ok = await run(executable, { out, figs });
      if (window.FX && window.FX.runState) window.FX.runState(runBtn, "done");
      runBtn.textContent = label; runBtn.disabled = false;
      if (refocus && document.activeElement === document.body) runBtn.focus();
      if (ok) {
        if (window.FX && window.FX.landed) window.FX.landed((figs && figs.children && figs.children.length) ? figs : out);
        if (typeof onRun === "function") onRun(runBtn);
      }
      if (typeof onResult === "function") onResult(ok, runBtn, out);
    }
    runBtn.addEventListener("click", doRun);
    resetBtn.addEventListener("click", () => { editor.value = initial; paint(); out.textContent = ""; figs.innerHTML = ""; });
    editor.addEventListener("keydown", (e) => {

      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const s = editor.selectionStart, en = editor.selectionEnd; editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(en); editor.selectionStart = editor.selectionEnd = s + 4; paint(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doRun(); }
    });

    return { el: cell, run: doRun, getCode: () => editor.value };
  }

  window.Lab = { run, makeCell, ready: getPyodide, packagesFor, highlight, colorize, version: PYODIDE_VERSION };
})();

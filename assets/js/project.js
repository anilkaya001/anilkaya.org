/* Guided/unguided capstone runner with local notebook and HTML export. */
(async () => {
  "use strict";
  const root = document.getElementById("projectApp"), id = document.body.dataset.projectId;
  const project = window.PROJECT_BY_ID?.[id];
  if (!root || !project) return;
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const state = window.IEWTStorage.projects();
  let record = state[id] || { mode: "guided", done: [] }, codeCell = null, provenance = null;
  try { const response = await fetch("/assets/data/projects/provenance.json", { headers: { Accept: "application/json" } }); const payload = await response.json(); provenance = payload.datasets.find((entry) => entry.id === id); } catch {}

  function download(name, type, content) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement("a");
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function notebook() {
    const code = codeCell?.getCode() || project.code;
    return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, academyProject: id, datasetSha256: provenance?.sha256 || null }, cells: [
      { cell_type: "markdown", metadata: {}, source: [`# ${project.title}\n`, `${project.subtitle}\n`, `Dataset: deterministic synthetic snapshot v1.\n`] },
      { cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: code.split(/(?<=\n)/) },
    ] }, null, 2);
  }
  function report() {
    const code = codeCell?.getCode() || project.code, output = codeCell?.el.querySelector(".cell__out")?.textContent || "Run the analysis to include local output.";
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(project.title) + '</title><style>body{font:16px/1.55 Georgia,serif;max-width:900px;margin:3rem auto;padding:0 1rem;color:#201c14}pre{overflow:auto;padding:1rem;background:#f3f0e8;border-radius:8px}small{color:#655}</style></head><body><h1>' + esc(project.title) + '</h1><p>' + esc(project.subtitle) + '</p><h2>Completed workflow</h2><ol>' + project.tasks.map((task) => '<li>' + esc(task.title) + (record.done.includes(task.id) ? ' ✓' : '') + '</li>').join("") + '</ol><h2>Code</h2><pre><code>' + esc(code) + '</code></pre><h2>Local output</h2><pre>' + esc(output) + '</pre><p><small>Dataset SHA-256: ' + esc(provenance?.sha256 || "unavailable") + '. Generated entirely in the browser; no code or output was stored in D1.</small></p></body></html>';
  }
  async function save() {
    if (window.Auth?.saveProject) await window.Auth.saveProject(id, record.mode, record.done);
    else { const all = window.IEWTStorage.projects(); all[id] = record; window.IEWTStorage.setProjects(all); }
  }
  function renderTasks() {
    const list = root.querySelector("#projectTasks");
    list.innerHTML = project.tasks.map((task, index) => '<li class="project-task' + (record.done.includes(task.id) ? " is-done" : "") + '"><label><input type="checkbox" value="' + task.id + '"' + (record.done.includes(task.id) ? " checked" : "") + '><span><b>' + String(index + 1).padStart(2, "0") + ' · ' + esc(task.title) + '</b>' + (record.mode === "guided" ? '<small>' + esc(task.detail) + '</small>' : "") + '</span></label></li>').join("");
    list.querySelectorAll("input").forEach((input) => input.addEventListener("change", async () => { record = { ...record, done: input.checked ? [...new Set([...record.done, input.value])] : record.done.filter((taskId) => taskId !== input.value) }; await save(); renderTasks(); renderStatus(); }));
  }
  function renderStatus() { const percent = Math.round(100 * record.done.length / project.tasks.length); root.querySelector("#projectProgress").value = record.done.length; root.querySelector("#projectProgressText").textContent = `${record.done.length} of ${project.tasks.length} tasks · ${percent}%`; }

  root.innerHTML = '<div class="project-workbench__bar"><div><p class="academy-kicker">Project mode</p><div class="project-mode" role="group" aria-label="Project mode"><button type="button" data-mode="guided">Guided</button><button type="button" data-mode="unguided">Unguided</button></div></div><div><p class="academy-kicker">Progress</p><progress id="projectProgress" max="' + project.tasks.length + '"></progress><span id="projectProgressText"></span></div><div class="project-export"><a class="btn btn--ghost" href="' + project.dataset + '" download>Dataset CSV</a><button class="btn btn--ghost" id="exportNotebook" type="button">Export .ipynb</button><button class="btn btn--gold" id="exportReport" type="button">Export HTML report</button></div></div><div class="project-workbench__grid"><section><h2>Research workflow</h2><ol class="project-tasks" id="projectTasks"></ol></section><section><h2>Local analysis notebook</h2><p class="project-local-note">Python loads only when you run this cell. Code and output stay in this browser and are never written to D1.</p><div id="projectCode"></div></section></div><aside class="project-provenance"><b>Dataset provenance</b><span>' + esc(provenance ? `${provenance.frequency}, ${provenance.rowCount} rows, deterministic synthetic snapshot v${provenance.version}` : "Provenance record unavailable") + '</span><code>' + esc(provenance?.sha256 || "") + '</code></aside>';
  codeCell = window.Lab.makeCell({ code: project.code, title: id + ".py" }); root.querySelector("#projectCode").append(codeCell.el);
  root.querySelectorAll("[data-mode]").forEach((button) => { button.classList.toggle("is-active", button.dataset.mode === record.mode); button.addEventListener("click", async () => { record = { ...record, mode: button.dataset.mode }; await save(); root.querySelectorAll("[data-mode]").forEach((node) => node.classList.toggle("is-active", node.dataset.mode === record.mode)); renderTasks(); }); });
  root.querySelector("#exportNotebook").addEventListener("click", () => download(`${id}.ipynb`, "application/x-ipynb+json", notebook()));
  root.querySelector("#exportReport").addEventListener("click", () => download(`${id}-report.html`, "text/html", report()));
  renderTasks(); renderStatus();
})();

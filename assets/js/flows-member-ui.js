(() => {
  "use strict";
  const U = window.FlowsUI;
  const kit = U && U.memberKit;
  if (!kit || kit.ui || kit.v !== 1) return;
  const { root, h, F, glyph, DASH, EXPORTS, grouped, plural, TEXT, model, S, listeners, changed, device, storeReady, bindStore, call, ensure, pull, universe, serial, change, restart, failure, adopt, save } = kit;
  const SHOWN = 5;
  const STEP = 50;
  const ORDER = ["flow", "moves", "board", "entering", "soon"];
  const CHIP = { flow: "new flow", moves: "large move", entering: "report ahead", soon: "report soon" };
  const BOARD = { cleared: "score cleared", flipped: "score flipped", faded: "score faded" };
  const PAGE_NAME = { moves: "Moves", unusual: "Unusual", events: "Events", political: "Political" };
  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const trt = (ms) => new Date(ms + 10800000);

  Object.assign(TEXT, {
    typeFirst: "Type a ticker first.",
    listed: (n) => n + " is already in My list.",
    added: (n) => n + " added.",
    removed: (n) => n + " removed.",
    updated: "Updated with changes from another tab or device.",
    noStore: "This browser is not keeping data for this site. Your list will be lost when this tab closes.",
    restartHint: "Start a new list to change where it is saved.",
    restartAsk: "Replace it with a new, empty list? The old list cannot be recovered after this.",
    restarted: "A new list is started.",
    offer: (n) => "This device holds " + plural(n, "name", "names") + ". Save them to your account?",
    deleteAsk: "Delete My list and your visit record from our server and this device? This cannot be undone.",
    deleteKeep: "Your export history stays 90 days for export limits.",
    deleteOther: "Copies of your list on other devices stay there until you clear them.",
    deleted: "Your saved data is deleted.",
    notDeleted: "Not deleted.",
    historyHead: "Exports are listed for 90 days.",
    historyNone: "No exports in the last 90 days.",
    historyFail: "Could not load your export history.",
    sinceFail: "Could not load changes.",
    empty: "Your list is empty. Star a ticker or add names in My list.",
  });

  Object.assign(model, {
    tokens: (text) => String(text == null ? "" : text).split(/[\s,;]+/).filter(Boolean),
    plan(text, list, known) {
      const out = { tokens: model.tokens(text), adds: [], invalid: [], uncovered: [], dup: [] };
      const seen = new Set(list);
      const skip = new Set();
      for (const raw of out.tokens) {
        const n = model.normalize(raw);
        if (!n.ok) { if (!skip.has(raw)) { skip.add(raw); out.invalid.push(raw.toUpperCase().slice(0, 12)); } continue; }
        if (seen.has(n.name)) { if (!skip.has(n.name)) { skip.add(n.name); out.dup.push(n.name); } continue; }
        if (known && !known.has(n.name)) { seen.add(n.name); out.uncovered.push(n.name); continue; }
        seen.add(n.name);
        out.adds.push(n.name);
      }
      return out;
    },
    sinceStamp(ms) {
      const d = trt(ms);
      return WEEKDAY[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTH[d.getUTCMonth()] + ", " + F.time(ms);
    },
    chipOf: (id, line) => (id === "board" ? (line ? BOARD[line.kind] || "board change" : "board change") : CHIP[id]),
    yours(groups, names) {
      const clean = groups.filter((g) => !g.error);
      const maps = clean.map((g) => new Map(g.lines.map((l) => [l.t, l])));
      const rows = [];
      for (const t of names) {
        const hits = [];
        clean.forEach((g, i) => {
          const line = maps[i].get(t) || null;
          if (line || (Array.isArray(g.names) && g.names.includes(t))) hits.push({ id: g.id, line, chip: model.chipOf(g.id, line) });
        });
        if (hits.length) rows.push({ t, hits });
      }
      const rank = (r) => ORDER.indexOf(r.hits[0].id);
      return rows.sort((a, b) => b.hits.length - a.hits.length || rank(a) - rank(b) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    },
    partial(groups) {
      const out = [];
      for (const g of groups) {
        if (g.error) out.push(g.title + " could not be checked for your names.");
        else if (g.more > 0 && !Array.isArray(g.names)) out.push("Only the first " + grouped(g.lines.length) + " " + g.title + " lines were checked for your names.");
      }
      return out;
    },
  });

  function toDevice(list) {
    return serial(async () => {
      if (!(await storeReady())) return { ok: false, text: TEXT.notSaved, retry: true };
      const names = Array.isArray(list) ? list.slice() : S.names.slice();
      const w = device.write(S.member, names);
      if (!w.ok) return { ok: false, text: TEXT.notSaved };
      if (!w.saved) { device.clear(S.member); return { ok: false, text: TEXT.noStore }; }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const r = await call("PUT", "/api/me/state", { body: { deviceOnly: true }, version: S.version });
        if (r.ok && r.json) { adopt(r.json); changed(); return { ok: true }; }
        if (r.status !== 412) { device.clear(S.member); return failure(r); }
        if (!(await pull())) break;
      }
      device.clear(S.member);
      return { ok: false, text: TEXT.conflict };
    });
  }

  function toServer(names) {
    return serial(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const r = await call("PUT", "/api/me/state", { body: { deviceOnly: false, watchlist: names }, version: S.version });
        if (r.ok && r.json) { adopt(r.json); device.clear(S.member); changed(); return { ok: true }; }
        if (r.status !== 412) return failure(r);
        if (!(await pull())) break;
      }
      return { ok: false, text: TEXT.conflict };
    });
  }

  function wipe() {
    return serial(async () => {
      if (!(await storeReady())) return { ok: false, text: TEXT.notDeleted, retry: true };
      const r = await call("DELETE", "/api/me/state");
      if (!r.ok) return r.status === 401 ? { ok: false, text: TEXT.ended } : { ok: false, text: TEXT.notDeleted, retry: true };
      device.clear(S.member);
      S.names = [];
      await pull();
      S.names = S.mode === "server" ? [] : device.read(S.member);
      changed();
      return { ok: true };
    });
  }

  let current = null;

  function back(opener) {
    const spots = [opener, document.querySelector("details[data-member-export] > summary"), document.querySelector("[data-member-open]")];
    for (const el of spots) {
      if (el && el.isConnected) {
        el.focus();
        if (document.activeElement === el) return;
      }
    }
  }

  function dialog(id, title, opener) {
    if (current) current.close();
    const live = h("p", { class: "visually-hidden", role: "status", "aria-live": "polite", "data-member": "" });
    const head = h("h2", { id: id + "T", tabindex: "-1", "data-member": "" }, title);
    const body = h("div", { class: "fm-b", "data-member": "" });
    const d = h("dialog", { class: "fm-dlg", id, "aria-labelledby": id + "T", "data-member": "" },
      h("header", { class: "fm-h" }, head, h("button", { type: "button", class: "fm-x", "aria-label": "Close", onclick: () => d.close() }, glyph("x"))),
      body, live);
    let down = null;
    let timer = 0;
    d.addEventListener("pointerdown", (e) => { down = e.target; });
    d.addEventListener("click", (e) => { if (down === d && e.target === d) d.close(); down = null; });
    d.addEventListener("close", () => {
      clearTimeout(timer);
      listeners.delete(d._repaint);
      d.remove();
      if (current === d) { current = null; back(opener); }
    });
    document.body.append(d);
    d.showModal();
    current = d;
    return {
      d, body, head,
      say(text) {
        live.textContent = "";
        clearTimeout(timer);
        timer = setTimeout(() => { live.textContent = text; }, 50);
      },
    };
  }

  const stylesheet = (() => {
    let done = null;
    return () => {
      if (done) return done;
      const holder = document.querySelector('i[data-defer="member-ui"][data-css]');
      const href = holder ? holder.getAttribute("data-css") : null;
      done = new Promise((ok) => {
        if (!href || document.querySelector('link[href="' + href + '"]')) return ok(true);
        const give = () => { clearTimeout(timer); link.remove(); done = null; ok(false); };
        const link = h("link", { rel: "stylesheet", href, onload: () => { clearTimeout(timer); ok(true); }, onerror: give });
        const timer = setTimeout(give, 8000);
        document.head.append(link);
      });
      return done;
    };
  })();

  const coarse = () => !!window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const nameLink = (name) => h("a", { href: "/flows/ticker/?t=" + encodeURIComponent(name), class: "fm-t" }, name);
  const button = (label, onclick, cls) => h("button", { type: "button", class: "fm-btn" + (cls ? " " + cls : ""), onclick }, label);

  async function openList(opener) {
    const ready = await ensure();
    if (ready && S.mode === "server" && S.names.length === 0) await storeReady();
    bindStore();
    const ui = dialog("fmList", "My list", opener);
    const { d, body, say, head } = ui;
    if (!ready) {
      body.append(h("p", { class: "fm-note" }, S.ended ? TEXT.ended : "We could not load your list."), ...(S.ended ? [] : [button("Try again", () => { d.close(); openList(opener); })]));
      head.focus();
      return;
    }
    universe();
    const count = h("p", { class: "fm-count" });
    const input = h("input", { id: "fmAdd", type: "text", class: "fm-in", autocapitalize: "characters", autocomplete: "off", autocorrect: "off", spellcheck: "false", maxlength: "4000", enterkeyhint: "done", "aria-describedby": "fmHint fmErr" });
    const err = h("div", { class: "fm-err", id: "fmErr" });
    const form = h("form", { class: "fm-add", novalidate: true },
      h("label", { for: "fmAdd", class: "fm-lab" }, "Add tickers"), input, h("button", { type: "submit", class: "fm-btn fm-go" }, "Add"));
    const hint = h("p", { class: "fm-note", id: "fmHint" }, "Separate tickers with spaces or commas.");
    const offer = h("div", { class: "fm-offer" });
    const store = h("p", { class: "fm-note fm-warn" }, TEXT.noStore);
    const fix = h("div", { class: "fm-offer fm-fix" });
    const list = h("ul", { class: "fm-list", role: "list", "aria-label": "Your names" });
    const copy = button("Copy names", () => copyNames(), "fm-quiet");
    const data = button("Download list and export log", () => downloadData(), "fm-quiet");
    const hist = EXPORTS ? button("Export history", () => { d.close(); openHistory(opener); }, "fm-quiet") : null;
    const sw = h("button", { type: "button", role: "switch", class: "fm-sw", id: "fmDev", "aria-describedby": "fmDevNote" },
      h("span", { class: "fm-sw-l" }, "Keep this list on this device only"), h("span", { class: "fm-sw-t", "aria-hidden": "true" }));
    const swNote = h("p", { class: "fm-note", id: "fmDevNote" });
    const disclose = h("ul", { class: "fm-disc", role: "list" });
    const del = h("div", { class: "fm-del" });

    const showError = (text, retry) => {
      err.replaceChildren(...(text ? [h("span", { id: "fmErrT" }, text), retry ? button("Try again", () => { showError(""); retry(); }, "fm-quiet") : null] : []).filter(Boolean));
      err.classList.remove("fm-info");
      input.setAttribute("aria-invalid", text ? "true" : "false");
      if (text) say(text);
    };

    const fixIdle = () => {
      fix.replaceChildren(h("p", { class: "fm-note fm-warn" }, TEXT.unreadable), h("div", { class: "fm-actions" }, button("Start a new list", () => fixAsk(), "fm-quiet")));
      fix.dataset.state = "idle";
    };
    const fixAsk = () => {
      const keep = button("Keep it for now", () => { fixIdle(); fix.querySelector("button").focus(); });
      const yes = button("Replace", async () => {
        yes.disabled = true;
        const r = await restart();
        if (!r.ok) { fixIdle(); showError(r.text); return; }
        showError("");
        paint();
        say(TEXT.restarted);
        input.focus();
      }, "fm-danger");
      fix.replaceChildren(h("p", { class: "fm-note fm-warn" }, TEXT.unreadable), h("p", { class: "fm-note" }, TEXT.restartAsk), h("div", { class: "fm-actions" }, yes, keep));
      fix.dataset.state = "ask";
      keep.focus();
    };

    const paint = () => {
      count.textContent = S.names.length ? S.names.length + " of " + S.max + " names" : "No names yet.";
      const keyAbsent = S.reason === "key_absent";
      const block = S.mode === "server" && S.unreadable;
      count.hidden = block;
      fix.hidden = !block;
      if (!block) fix.dataset.state = "";
      else if (fix.dataset.state !== "ask") fixIdle();
      form.hidden = block;
      hint.hidden = block;
      store.hidden = !(S.mode !== "server" && S.names.length > 0 && !device.saved(S.member));
      const held = S.mode === "server" && S.names.length === 0 && !S.unreadable ? device.read(S.member) : [];
      offer.hidden = held.length === 0;
      if (held.length) {
        offer.replaceChildren(h("p", { class: "fm-note" }, TEXT.offer(held.length)),
          h("div", { class: "fm-actions" },
            button("Save to my account", async () => {
              const r = await toServer(held);
              if (!r.ok) showError(r.text, r.retry ? () => offer.querySelector("button").click() : null); else say("Your list is saved to your account.");
              paint();
            }, "fm-go"),
            button("Keep on this device", async () => {
              const r = await toDevice(held);
              if (!r.ok) showError(r.text); else say("Your list stays on this device.");
              paint();
            })));
      }
      const known = S.universe;
      list.replaceChildren(...S.names.map((n, i) => h("li", { class: "fm-row" },
        nameLink(n),
        known && !known.has(n) ? h("span", { class: "fm-mut" }, "Not in today's universe.") : null,
        h("button", { type: "button", class: "fm-rm", "aria-label": "Remove " + n, onclick: () => remove(n, i) }, glyph("x")))));
      sw.setAttribute("aria-checked", String(S.mode !== "server"));
      sw.setAttribute("aria-disabled", String(keyAbsent || block));
      swNote.textContent = block ? TEXT.restartHint : keyAbsent ? TEXT.keyAbsent : S.mode === "server" ? "Your list is saved to your account." : "Your list is saved only in this browser.";
      disclose.replaceChildren(...(S.mode === "server"
        ? ["Your list is stored encrypted on our server.", "We never send your list to our data feed or any AI model.", "Deleted data stays in the database restore history for up to 30 days.", "Your export history is kept for 90 days for export limits."]
        : ["Your list is stored only in this browser on this device.", "Clearing this site's data in your browser deletes it."]).map((t) => h("li", null, t)));
      copy.disabled = S.names.length === 0;
    };

    async function remove(name, index) {
      const r = await change((l) => model.drop(l, name));
      if (!r.ok) {
        const text = r.text === TEXT.notSaved ? (S.names.includes(name) ? TEXT.starStill(name) : TEXT.starNot(name)) : r.text;
        showError(text, r.retry ? () => remove(name, index) : null);
        return;
      }
      showError("");
      paint();
      say(r.again ? TEXT.updated + " " + TEXT.removed(name) : TEXT.removed(name));
      const rows = list.querySelectorAll(".fm-rm");
      (rows[index] || rows[index - 1] || input).focus();
    }

    async function add(text) {
      const known = await universe();
      const plan = model.plan(text, S.names, known);
      if (!plan.tokens.length) { showError(TEXT.typeFirst); return; }
      const one = plan.tokens.length === 1;
      if (one && plan.invalid.length) { showError(TEXT.invalid(plan.invalid[0])); return; }
      if (one && plan.dup.length) { showError(TEXT.listed(plan.dup[0])); return; }
      if (one && plan.uncovered.length) { showError(TEXT.uncovered(plan.uncovered[0])); return; }
      if (plan.adds.length && !known && S.mode !== "server") { showError(TEXT.cannotCheck); return; }
      if (S.names.length + plan.adds.length > S.max) { showError(TEXT.full(S.max)); return; }
      const rest = [];
      if (plan.uncovered.length) rest.push("Not covered: " + plan.uncovered.join(", ") + ".");
      if (plan.invalid.length) rest.push("Not valid: " + plan.invalid.join(", ") + ".");
      if (plan.dup.length) rest.push("Already in My list: " + plan.dup.join(", ") + ".");
      if (!plan.adds.length) { showError(rest.join(" ")); return; }
      const r = await change((l) => model.union(l, plan.adds));
      if (!r.ok) { showError(r.text, r.retry ? () => add(text) : null); return; }
      showError("");
      input.value = "";
      paint();
      const head = one ? TEXT.added(plan.adds[0]) : "Added " + plural(plan.adds.length, "name", "names") + ".";
      const said = [r.again ? TEXT.updated : "", head, ...rest].filter(Boolean).join(" ");
      if (rest.length) {
        err.replaceChildren(h("span", null, [head, ...rest].join(" ")));
        err.classList.add("fm-info");
      }
      say(said);
      input.focus();
    }

    async function copyNames() {
      try {
        await navigator.clipboard.writeText(S.names.join(" "));
        say("Copied " + plural(S.names.length, "name", "names") + ".");
      } catch {
        say("Could not copy.");
      }
    }

    async function downloadData() {
      const [st, ex] = await Promise.all([call("GET", "/api/me/state"), call("GET", "/api/me/exports")]);
      if (!st.ok || !st.json) { say("Could not prepare your list."); return; }
      const now = ex.ok && ex.json ? ex.json.serverNow : Date.now();
      const payload = {
        exported_trt: F.stamp(now),
        member: st.json.member,
        my_list: { stored: S.mode === "server" ? "our server" : "this device", names: S.names.slice() },
        export_history: ex.ok && ex.json ? ex.json.exports.map((e) => ({ when_trt: F.stamp(e.atMs), page: e.page, rows: e.rows, columns: e.cols })) : null,
      };
      save("flows-my-list-" + F.trtDay(now) + ".json", "application/json", JSON.stringify(payload, null, 2) + "\n");
      say("Your list and export log are downloaded.");
    }

    form.addEventListener("submit", (e) => { e.preventDefault(); add(input.value); });
    input.addEventListener("input", () => { if (err.firstChild) showError(""); });
    sw.addEventListener("click", async () => {
      if (sw.getAttribute("aria-disabled") === "true") { say(swNote.textContent); return; }
      if (sw.getAttribute("aria-busy") === "true") return;
      sw.setAttribute("aria-busy", "true");
      const toLocal = S.mode === "server";
      const r = toLocal ? await toDevice() : await toServer(device.read(S.member));
      sw.removeAttribute("aria-busy");
      if (r.ok) say(toLocal ? "Your list stays on this device." : "Your list is saved to your account."); else showError(r.text, r.retry ? () => sw.click() : null);
      paint();
    });

    const idle = (said) => {
      const first = button("Delete my saved data", () => confirmAsk(), "fm-danger-o");
      del.replaceChildren(...(said ? [first, h("p", { class: "fm-note" }, said)] : [first]));
      del.dataset.state = "idle";
      return first;
    };
    const confirmAsk = () => {
      const keep = button("Cancel", () => idle().focus());
      const yes = button("Delete", async () => {
        yes.disabled = true;
        const r = await wipe();
        if (!r.ok) {
          del.replaceChildren(...[h("p", { class: "fm-note" }, r.text), r.retry ? button("Try again", () => confirmAsk()) : null].filter(Boolean));
          del.dataset.state = "idle";
          say(r.text);
          return;
        }
        paint();
        const f = idle(TEXT.deleted);
        say(TEXT.deleted);
        f.focus();
      }, "fm-danger");
      del.replaceChildren(h("p", { class: "fm-note" }, TEXT.deleteAsk), h("p", { class: "fm-note" }, TEXT.deleteKeep), h("p", { class: "fm-note" }, TEXT.deleteOther), h("div", { class: "fm-actions" }, yes, keep));
      del.dataset.state = "ask";
      keep.focus();
    };
    d.addEventListener("cancel", (e) => {
      if (del.dataset.state !== "ask") return;
      if (e.cancelable) e.preventDefault();
      idle().focus();
    });

    body.append(count, form, hint, err, offer, fix, store, list, h("div", { class: "fm-actions" }, copy, data, hist), sw, swNote, disclose, del);
    idle();
    paint();
    d._repaint = () => { if (d.isConnected) paint(); };
    listeners.add(d._repaint);
    universe().then(() => d.isConnected && paint());
    if (coarse() || form.hidden) head.focus(); else input.focus();
  }

  function lineList(all) {
    const ul = h("ul", { class: "fm-lines", role: "list" });
    let shown = 0;
    const more = h("button", { type: "button", class: "fm-link" });
    const draw = (upto) => {
      const first = shown;
      for (; shown < Math.min(all.length, upto); shown += 1) {
        const l = all[shown];
        ul.append(h("li", null, nameLink(l.t), l.rest ? h("span", { class: "fm-rest" }, l.rest) : null));
      }
      const left = all.length - shown;
      if (left <= 0) more.remove();
      else more.textContent = left <= STEP ? "Show the last " + left : "Show " + STEP + " more (" + grouped(left) + " left)";
      return first;
    };
    more.addEventListener("click", () => {
      const first = draw(shown + STEP);
      const link = ul.children[first] && ul.children[first].querySelector("a");
      if (link) link.focus();
    });
    draw(SHOWN);
    return h("div", { class: "fm-lw" }, ul, all.length > SHOWN ? more : null);
  }

  function paintSince(body, status, m, d, opener) {
    const edit = () => button("Edit my list", () => { d.close(); openList(opener); }, "fm-quiet");
    if (m.state === "first" || m.state === "none" || m.state === "unavailable") {
      status.textContent = m.status || "";
      body.replaceChildren(status, edit());
      return;
    }
    status.textContent = "Changes since " + model.sinceStamp(m.lastVisitMs) + ".";
    const kids = [status];
    if (m.note) kids.push(h("p", { class: "fm-note" }, m.note));
    const groups = Array.isArray(m.groups) ? m.groups : [];
    if (m.state === "quiet") kids.push(h("p", { class: "fm-note" }, m.quiet || ""));
    else {
      const names = S.names;
      const sec = h("section", { class: "fm-g", "aria-labelledby": "fmYours" }, h("h3", { id: "fmYours" }, "Your names"));
      if (!names.length) sec.append(h("p", { class: "fm-note" }, TEXT.empty));
      else {
        const rows = model.yours(groups, names);
        if (!rows.length) sec.append(h("p", { class: "fm-note" }, names.length === 1 ? "Your name is not in the lists below." : "None of your " + names.length + " names appear below."));
        else {
          sec.append(h("ul", { class: "fm-lines", role: "list" }, rows.slice(0, SHOWN).map((r) => {
            const first = r.hits.find((x) => x.line);
            const chips = r.hits.map((x, i) => [i ? h("span", { class: "visually-hidden" }, ", ") : null, h("span", { class: "fm-chip" }, x.chip)]);
            return h("li", null, nameLink(r.t), h("span", { class: "fm-rest" }, first ? first.line.rest : DASH + " detail not kept (list cut)"), h("span", { class: "fm-chips" }, chips));
          })));
          if (rows.length > SHOWN) sec.append(h("p", { class: "fm-note" }, plural(rows.length - SHOWN, "more of your names is", "more of your names are") + " in the lists below."));
        }
        for (const t of model.partial(groups)) sec.append(h("p", { class: "fm-note" }, t));
      }
      kids.push(sec);
    }
    for (const g of groups) {
      const sec = h("section", { class: "fm-g", "aria-labelledby": "fmG" + g.id }, h("h3", { id: "fmG" + g.id }, g.title));
      if (g.error) sec.append(h("p", { class: "fm-note" }, DASH + " " + g.summary));
      else {
        if (g.summary) sec.append(h("p", { class: "fm-note" }, g.summary));
        if (g.lines.length) sec.append(lineList(g.lines));
        if (g.more > 0) sec.append(h("p", { class: "fm-note" }, grouped(g.more) + " more on ", h("a", { href: g.href, class: "fm-pl" }, g.place), "."));
      }
      kids.push(sec);
    }
    kids.push(edit());
    body.replaceChildren(...kids);
  }

  async function openSince(opener) {
    const { d, body, head } = dialog("fmSince", "Since your last visit", opener);
    const status = h("p", { class: "fm-status", role: "status" }, "Loading.");
    body.append(status);
    head.focus();
    const load = async () => {
      const [, r] = await Promise.all([ensure(), call("GET", "/api/me/since")]);
      if (!d.isConnected) return;
      if (!r.ok || !r.json) {
        status.textContent = TEXT.sinceFail;
        body.replaceChildren(status, button("Try again", () => { body.replaceChildren(status); status.textContent = "Loading."; load(); }));
        return;
      }
      paintSince(body, status, r.json, d, opener);
    };
    load();
  }

  async function openHistory(opener) {
    const { d, body, head } = dialog("fmHist", "Export history", opener);
    const status = h("p", { class: "fm-status", role: "status" }, "Loading.");
    body.append(status);
    head.focus();
    const load = async () => {
      const r = await call("GET", "/api/me/exports");
      if (!d.isConnected) return;
      if (!r.ok || !r.json) {
        body.replaceChildren(h("p", { class: "fm-status", role: "status" }, TEXT.historyFail), button("Try again", () => { body.replaceChildren(status); status.textContent = "Loading."; load(); }));
        return;
      }
      const rows = r.json.exports;
      status.textContent = rows.length ? TEXT.historyHead : TEXT.historyNone;
      if (!rows.length) return;
      const table = h("table", { class: "fm-tab" },
        h("caption", { class: "visually-hidden" }, "Your exports, newest first"),
        h("thead", null, h("tr", null, ["When (TRT)", "Page", "Rows", "Columns"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, rows.map((e) => {
          const cols = Array.isArray(e.cols) ? e.cols.filter(Boolean) : [];
          return h("tr", null,
            h("td", null, (F.stamp(e.atMs) || DASH).replace(" TRT", "")), h("td", null, PAGE_NAME[e.page] || e.page),
            h("td", { class: "fm-n" }, grouped(e.rows)),
            h("td", null, cols.length ? h("details", { class: "fm-cols" }, h("summary", null, cols.length + " columns"), h("p", null, cols.join(", "))) : DASH + " not recorded"));
        })));
      body.append(h("div", { class: "fm-tw" }, table));
    };
    load();
  }

  async function open(kind, opener, cancelled) {
    if (!(await stylesheet())) { U.announce(TEXT.load); return null; }
    if (cancelled && cancelled()) return null;
    if (kind === "since") return openSince(opener);
    if (kind === "list") return openList(opener);
    if (kind === "history") return openHistory(opener);
    return null;
  }

  kit.ui = { open };
})();

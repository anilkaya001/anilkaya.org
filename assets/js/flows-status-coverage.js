(() => {
  "use strict";

  const UI = window.FlowsUI;
  const kit = UI && UI.statusKit;
  if (!kit) return;
  const { h, DASH, num, whole, trt, clockSec, ago, bytes, table, fill, unread, chip, mini, rest, line, okBody, whyOf, state } = kit;
  const $ = (id) => document.getElementById(id);

  const pctOf = (p) => (num(p) === null ? DASH : (p * 100 < 10 ? (p * 100).toFixed(1) : Math.round(p * 100)) + "%");

  function verdict(k, sessionDate) {
    if (!k.present) return chip("pending", "no row");
    if (!k.session) return chip("pending", "no session stamp");
    if (sessionDate && k.session < sessionDate) return chip("stale", "behind " + sessionDate);
    return chip("fresh", k.session);
  }

  function rotation(now) {
    const r = state().D.cover;
    const short = $("kDeep");
    const full = $("stDeep");
    const dash = (why) => {
      unread(short, "The deepening ledger", why);
      unread(full, "The deepening ledger", why);
    };
    if (!r || !r.ok) { dash(r ? r.reason : "no read yet"); return; }
    if (!r.body.coverage) { dash("the answer carried no coverage"); return; }
    const x = r.body.coverage.rotation;
    if (!x) { dash("the answer carried none"); return; }
    if (!x.present || !x.summary) { dash(x.why); return; }
    const share = num(x.carded) !== null && num(x.universe) ? x.carded / x.universe : null;
    const usedShare = num(x.dailySeen) !== null && num(x.dayLine) ? x.dailySeen / x.dayLine : null;
    const rows = [
      ["Names with a deep read", num(x.carded) === null ? DASH : whole(x.carded) + (num(x.universe) ? " of " + whole(x.universe) + " (" + pctOf(share) + ")" : " (" + DASH + " universe size not recorded)")],
      ["Oldest deep read", x.oldest || DASH + " no read on record"],
      ["Tonight, planned and read", num(x.planned) === null ? DASH + " not recorded" : whole(x.planned) + " planned, " + (num(x.read) === null ? DASH + " not recorded" : whole(x.read)) + " read"],
      ["Vendor calls, this run", num(x.calls) === null ? DASH + " not recorded" : whole(x.calls)],
      ["Vendor calls, the key today", num(x.dailySeen) === null ? DASH + " the vendor's counter was not read" : whole(x.dailySeen) + (num(x.dayLine) ? " of " + whole(x.dayLine) + " (" + pctOf(usedShare) + ")" : "")],
      ["Ledger session", x.session || DASH + " unstamped"],
    ];
    fill(short, mini("Deepening rotation", ["Measure", "Reading"], rows, "figures"),
      line("Names are read in turn: never read first, then the oldest read."));
    fill(full, table("Deepening rotation", ["Measure", "Reading"], rows, true),
      h("p", { class: "st-foot" }, "Written by the nightly into the deepen ledger. The day line is the plan's working line; the key's count includes every caller. Calls for this run are attempts including retries. A figure the ledger did not record is a dash, not zero."));
  }

  function coverage() {
    const r = state().D.cover;
    const meta = okBody("meta");
    const sessionDate = meta && meta.sessionDate ? String(meta.sessionDate) : null;
    const store = $("kStore");
    const full = $("stCover");
    const now = Date.now();
    if (!r || !r.ok) {
      unread(store, "The payload store", r ? r.reason : "no read yet");
      unread(full, "The payload store", r ? r.reason : "no read yet");
    } else if (!r.body.coverage) {
      unread(store, "The payload store", r.body.why === "store" ? "the store could not be read" : "the answer carried no coverage");
      unread(full, "The payload store", "the answer carried no coverage");
    } else {
      const c = r.body.coverage;
      const present = c.keys.filter((k) => k.present);
      const missing = c.keys.filter((k) => !k.present);
      const total = present.reduce((a, k) => a + (num(k.bytes) || 0), 0);
      const behind = present.filter((k) => k.session && sessionDate && k.session < sessionDate).length;
      const big = present.slice().sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
      fill(store,
        line(present.length + " of " + c.keys.length + " expected keys present · " + bytes(total) + " stored · " + behind + " behind the nightly session" + (sessionDate ? " " + sessionDate : "") +
          " · budget " + bytes(c.budgetBytes) + " a key"),
        big.length ? mini("Largest keys", ["Key", "Size", "Of budget", "Written"], big.map((k) => [k.key, bytes(k.bytes), pctOf(k.share), k.updatedAt ? trt(k.updatedAt, now) : DASH]), "keys") : line(DASH + " no key is stored"),
        missing.length ? line("Missing: " + missing.slice(0, 5).map((k) => k.key).join(", ") + (missing.length > 5 ? " and " + (missing.length - 5) + " more" : "")) : line("No expected key is missing."));
      fill(full,
        table("Every stored key", ["Key", "Session", "Size", "Of 100 KiB", "Written", "Age"], c.keys.map((k) => [k.key, verdict(k, sessionDate),
          k.present ? bytes(k.bytes) : DASH, k.present ? pctOf(k.share) : DASH, k.present && k.updatedAt ? trt(k.updatedAt, now) : DASH, k.present && k.updatedAt ? ago(k.updatedAt, now) : DASH]), true),
        h("p", { class: "st-foot" }, "Sizes are the stored JSON text. Only the declared nightly and shared keys are read, by primary key; the card rows are not counted here because counting them scans the table. A key with no session stamp is shown as such, not as fresh."));
    }
    const night = $("kNight");
    if (!meta) {
      unread(night, "The nightly record", whyOf("meta"));
    } else if (!meta.generatedAt) {
      unread(night, "The nightly record", "no run has been published yet");
    } else {
      const universe = num(meta.universe);
      const built = num(meta.cardsBuilt);
      const hl = meta.health || null;
      const share = universe && built !== null ? built / universe : null;
      const stages = Array.isArray(meta.stages) ? meta.stages : [];
      const failedStages = stages.filter((x) => x.status && x.status !== "ok" && x.status !== "done");
      fill(night,
        mini("Nightly coverage", ["Measure", "Reading"], [
          ["Names in the universe", whole(universe)],
          ["Cards built", built === null ? DASH : whole(built) + " (" + pctOf(share) + " of the universe)"],
          ["Cards failed or skipped", whole(meta.cardsFailed) + " failed, " + whole(meta.cardsSkipped) + " skipped"],
          ["Health gate", hl ? whole(hl.failures) + " failures, " + whole(hl.warnings) + " warnings" : DASH + " not in this record"],
          ["Stages not ok", stages.length ? String(failedStages.length) + " of " + stages.length : DASH + " no stage ledger"],
          ["Landed", trt(meta.generatedAt, now) + " · session " + (meta.sessionDate ? String(meta.sessionDate) : DASH)],
        ]),
        hl && Array.isArray(hl.first) && hl.first.length ? h("ul", { class: "st-lines" }, ...hl.first.slice(0, 2).map((t) => h("li", null, String(t)))) : null,
        line("Per-name coverage is the nightly's own count; this page reads no card rows."));
    }
    rotation(now);
    for (const [id, key] of [["kStore", "cover"], ["stCover", "cover"], ["kNight", "meta"], ["kDeep", "cover"], ["stDeep", "cover"]]) {
      const el = $(id + "Asof");
      const x = state().D[key];
      if (el) el.textContent = x && x.finished ? "read " + clockSec(x.finished) : "";
    }
  }

  kit.attach({ coverage });
})();

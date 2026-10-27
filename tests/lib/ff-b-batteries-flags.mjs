import { coreDouble } from "./ff-b-core.mjs";
import { alice, bob, astOf, seedHit, PREV_SESSION } from "./ff-b-world.mjs";

const rawOne = (api, sql, ...args) => {
  const r = api.world.f.db.prepare(sql).get(...args);
  return r === undefined ? undefined : { ...r };
};

const seeded = async (api) => {
  const made = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  const id = made.body.wire.id;
  const paused = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }) }, user: alice });
  const hit = seedHit(api.world.f, { stream: "alice.one", wire: id, symbol: "SYA101", key: "fl1" });
  return { id, spare: paused.body.wire.id, hitId: hit.hitId };
};

export async function routeFlags(c, build) {
  const api = build();
  const { id, spare, hitId } = await seeded(api);
  const off = (name) => ({ [name]: "off" });
  const refused = (r, route, label) => {
    c.eq([r.status, r.error && r.error.code, r.body && r.body.reason, r.body && r.body.route], [404, "ff_off", "route_off", route], label);
    c.eq(r.written, 0, label + " and writes nothing");
  };

  const wires = off("FF_ROUTE_WIRES");
  refused(await api.call("GET", "/api/ff/wires", { user: alice, env: wires }), "wires", "flags: the wires list is refused when its route is off");
  refused(await api.call("GET", "/api/ff/wires?id=" + id, { user: alice, env: wires }), "wires", "flags: so is one wire");
  refused(await api.call("GET", "/api/ff/house", { user: alice, env: wires }), "wires", "flags: and the house list");
  refused(await api.call("GET", "/api/ff/receipts?wire=" + id, { user: alice, env: wires }), "wires", "flags: and receipts");
  refused(await api.call("GET", "/api/ff/records?wire=" + id, { user: alice, env: wires }), "wires", "flags: and records");
  refused(await api.call("GET", "/api/ff/symbol?t=SYA101", { user: alice, env: wires }), "wires", "flags: and the name panel");
  refused(await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYC301"] } }) }, user: alice, env: wires }), "wires", "flags: and a new wire");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_wire").n, 2, "flags: no wire was made");

  const inbox = off("FF_ROUTE_INBOX");
  refused(await api.call("GET", "/api/ff/hits", { user: alice, env: inbox }), "inbox", "flags: the inbox is refused when its route is off");
  refused(await api.call("POST", "/api/ff/hits", { body: { id: hitId, mark: "pinned" }, user: alice, env: inbox }), "inbox", "flags: so is a mark");
  refused(await api.call("POST", "/api/ff/read", { body: { all: true }, user: alice, env: inbox }), "inbox", "flags: and a read");
  refused(await api.call("GET", "/api/ff/digest", { user: alice, env: inbox }), "inbox", "flags: and the digest");
  const panel = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: alice, env: inbox });
  c.eq([panel.status, panel.body.route], [404, "inbox"], "flags: the name panel needs the inbox too");

  const fire = off("FF_ROUTE_FIRE");
  refused(await api.call("POST", "/api/ff/preview", { body: { ast: astOf() }, user: alice, env: fire }), "fire", "flags: a preview is refused when fire is off");
  refused(await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYC301"] } }) }, user: alice, env: fire }), "fire", "flags: and a new wire");
  const adjust = await api.call("PATCH", "/api/ff/wires", { body: { id, version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYA101"] } }) }, user: alice, env: fire });
  c.eq([adjust.status, adjust.body.reason, adjust.body.route], [404, "route_off", "fire"], "flags: and an adjust, which arms a new version");
  const reducing = await api.call("PATCH", "/api/ff/wires", { body: { id: spare, status: "paused" }, user: alice, env: fire });
  c.eq(reducing.status, 200, "flags: pausing a wire is never blocked by a route switch");
  const restore = await api.call("PATCH", "/api/ff/wires", { body: { id: spare, status: "armed" }, user: alice, env: fire });
  c.eq([restore.status, restore.body.route], [404, "fire"], "flags: but restoring it is arming and is");
  const retire = await api.call("PATCH", "/api/ff/wires", { body: { id: spare, status: "retired" }, user: alice, env: { FF_ROUTE_WIRES: "off", FF_ROUTE_FIRE: "off", FF_ROUTE_INBOX: "off", FF_ROUTE_EXPORT: "off" } });
  c.eq(retire.status, 200, "flags: and retiring works with every route off, the way out is always open");
  const title = await api.call("PATCH", "/api/ff/wires", { body: { id, title: "Renamed" }, user: alice, env: fire });
  c.eq(title.status, 200, "flags: a rename needs no arming");
  const leave = await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: false }, user: alice, env: fire });
  c.ok(leave.status === 404 && leave.error.code === "ff_wire_not_found", "flags: leaving a house wire is not arming and reaches the store", leave.status);
  const follow = await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: true }, user: alice, env: fire });
  c.eq([follow.status, follow.body.route], [404, "fire"], "flags: following one is arming");
  const mute = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice, env: { FF_ROUTE_WIRES: "off", FF_ROUTE_INBOX: "off", FF_ROUTE_FIRE: "off" } });
  c.eq(mute.status, 200, "flags: a mute is a member's own preference and is never switched off by a route");

  refused(await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice, env: off("FF_ROUTE_EXPORT") }), "export", "flags: the export is refused when its route is off");
  const exportOk = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice, env: { FF_ROUTE_WIRES: "off", FF_ROUTE_INBOX: "off", FF_ROUTE_FIRE: "off" } });
  c.eq(exportOk.status, 200, "flags: and it needs nothing else");
  for (const odd of ["", "ON ", "yes", "true", "1", undefined]) {
    const r = await api.call("GET", "/api/ff/wires", { user: alice, env: { FF_ROUTE_WIRES: odd } });
    const want = typeof odd === "string" && odd.trim().toLowerCase() === "on" ? 200 : 404;
    c.eq(r.status, want, "flags: FF_ROUTE_WIRES " + JSON.stringify(odd) + " is " + (want === 200 ? "on" : "off"));
  }
  const masterOff = await api.call("PATCH", "/api/ff/wires", { body: { id: spare, status: "retired" }, user: alice, env: { FF_MODE: "off" } });
  c.eq([masterOff.status, masterOff.body.reason], [404, "mode_off"], "flags: the master switch closes even the way out, nothing is evaluated and nothing is edited");
  void bob;
}

export async function compileCodes(c, build) {
  const logged = [];
  const sink = { error: (line) => logged.push(String(line)), warn: (line) => logged.push(String(line)) };
  const realError = console.error;
  const realWarn = console.warn;
  console.error = sink.error;
  console.warn = sink.warn;
  try {
    await compileCodesInner(c, build);
  } finally {
    console.error = realError;
    console.warn = realWarn;
  }
  c.eq(logged.filter((l) => l.includes("ff compile refused with an unknown code")).length, 2, "compile: an unknown code is logged once each time");
  c.eq(logged.filter((l) => l.includes("ff compile returned a record the store refuses")).length, 4, "compile: a refused record is logged once each time");
  c.ok(logged.every((l) => !l.includes("alice.one") && !l.includes("SYA101")), "compile: and the log names no member and no ticker");
}

async function compileCodesInner(c, build) {
  const base = coreDouble();
  const wrap = (compile, extra = {}) => ({ ...base, compile, ...extra });
  const run = async (core, body = { ast: astOf() }) => {
    const api = build({ core });
    const r = await api.call("POST", "/api/ff/wires", { body, user: alice });
    return { r, wires: api.world.f.db.prepare("SELECT count(*) AS n FROM ff_wire").get().n };
  };

  const weird = await run(wrap(async () => ({ ok: false, code: "weird_code" })));
  c.eq([weird.r.status, weird.r.error.code, weird.wires], [500, "internal_error", 0], "compile: a code outside the frozen list is an internal error and not passed on");
  const nul = await run(wrap(async () => null));
  c.eq([nul.r.status, nul.wires], [500, 0], "compile: a null answer is an internal error");
  const known = await run(wrap(async () => ({ ok: false, code: "ff_metric_unavailable", detail: "x".repeat(500) })));
  c.eq([known.r.status, known.r.error.code], [409, "ff_metric_unavailable"], "compile: a frozen code passes through with its own status");
  c.eq(known.r.body.detail.length, 80, "compile: and its detail is cut to 80 characters");
  const real = await base.compile({ body: astOf(), universe: build().world.universe });
  const broken = (patch) => wrap(async () => {
    const copy = JSON.parse(JSON.stringify(real));
    patch(copy);
    return copy;
  });
  const cadence = await run(broken((x) => { const b = JSON.parse(x.version.ast_json); b.cadence = "live"; x.version.ast_json = JSON.stringify(b); }));
  c.eq([cadence.r.status, cadence.wires], [500, 0], "compile: a record whose AST disagrees with its cadence is refused before the store");
  const hash = await run(broken((x) => { x.version.ast_hash = "nope"; }));
  c.eq([hash.r.status, hash.wires], [500, 0], "compile: a record with a bad hash is refused");
  const symbols = await run(broken((x) => { x.symbols = ["SYB201"]; }));
  c.eq([symbols.r.status, symbols.wires], [500, 0], "compile: symbols that are not the AST's are refused");
  const bh = await run(broken((x) => { x.version.control = "bh"; x.version.exp_week = null; }));
  c.eq([bh.r.status, bh.wires], [500, 0], "compile: a family-controlled wire with no expected false alarms is refused");

  let bobId = null;
  let calls = 0;
  const colliding = {
    ...base,
    newWireId: () => {
      calls += 1;
      return calls === 2 ? bobId : base.newWireId();
    },
  };
  const clashed = build({ core: colliding });
  const created = await clashed.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }) }, user: bob });
  bobId = created.body.wire.id;
  const again = await clashed.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYC301"] } }) }, user: alice });
  c.eq(again.status, 201, "ids: an id that collides with another member's wire is retried with a fresh one");
  c.ok(again.body.wire.id !== bobId, "ids: and is a different wire", again.body.wire.id);
  c.eq(clashed.world.f.db.prepare("SELECT member_id FROM ff_wire WHERE id = ?").get(bobId).member_id, "bob.two", "ids: the other member's wire is untouched");
  c.eq(clashed.world.f.db.prepare("SELECT count(*) AS n FROM ff_wire").get().n, 2, "ids: two wires exist");
  c.eq(calls, 3, "ids: three ids were asked for, one lost to the clash");
}

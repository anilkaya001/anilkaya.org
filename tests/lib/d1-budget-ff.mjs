import { TEMPLATES, LIMITS } from "../../shared/ff-contract.js";

const house = TEMPLATES.flatMap((t) => t.house.map((id) => ({ id, cadence: t.cadence })));
const houseNightly = house.filter((w) => w.cadence === "nightly").length;
const houseLive = house.filter((w) => w.cadence === "live").length;

export const FF_ROUTE_CEILINGS = Object.freeze({
  healthCold: Object.freeze({ read: 6, written: 1, trips: 4 }),
  healthWarm: Object.freeze({ read: 3, written: 0, trips: 2 }),
  hitsFirst: Object.freeze({ read: 28, written: 0, trips: 3 }),
  hitsLarge: Object.freeze({ read: 64, written: 0, trips: 2 }),
  hitsNext: Object.freeze({ read: 28, written: 0, trips: 2 }),
  hitsMarked: Object.freeze({ read: 16, written: 0, trips: 2 }),
  hitDetail: Object.freeze({ read: 5, written: 0, trips: 2 }),
  read: Object.freeze({ read: 3, written: 1, trips: 1 }),
  mark: Object.freeze({ read: 1, written: 1, trips: 1 }),
  wiresList: Object.freeze({ read: 26, written: 0, trips: 1 }),
  wireDetail: Object.freeze({ read: 5, written: 0, trips: 1 }),
  houseList: Object.freeze({ read: 18, written: 0, trips: 1 }),
  houseDetail: Object.freeze({ read: 6, written: 0, trips: 3 }),
  digest: Object.freeze({ read: 540, written: 0, trips: 1 }),
  symbol: Object.freeze({ read: 6, written: 0, trips: 1 }),
  receipts: Object.freeze({ read: 2, written: 0, trips: 1 }),
  records: Object.freeze({ read: 7, written: 0, trips: 2 }),
  exportWindow: Object.freeze({ read: 470, written: 0, trips: 1 }),
  exportWorst: Object.freeze({ read: 2000, written: 0, trips: 1 }),
  preview: Object.freeze({ read: 2, written: 0, trips: 1 }),
  create: Object.freeze({ read: 10, written: 7, trips: 3 }),
  createWidest: Object.freeze({ read: 10, written: 27, trips: 4 }),
  adjust: Object.freeze({ read: 13, written: 4, trips: 4 }),
  retitle: Object.freeze({ read: 11, written: 1, trips: 3 }),
  pause: Object.freeze({ read: 11, written: 1, trips: 2 }),
  restore: Object.freeze({ read: 12, written: 1, trips: 3 }),
  mute: Object.freeze({ read: 1, written: 1, trips: 1 }),
  note: Object.freeze({ read: 1, written: 1, trips: 1 }),
  houseSet: Object.freeze({ read: 3, written: 1, trips: 1 }),
});

export const FF_BUDGET_PARAMS = Object.freeze({
  members: 12,
  wiresPerMember: 25,
  houseWires: house.length,
  houseNightly,
  houseLive,
  symbolsPerWire: 5,
  liveWireShare: 0.05,
  stateExceptions: 900,
  liveStateExceptions: 30,
  mutes: 50,
  houseOptOuts: 10,
  switches: 10,
  hitsNightlyHouse: houseNightly * LIMITS.hitsPerHouseWirePerSession.nightly,
  hitsNightlyMember: 70,
  hitsLiveHouse: houseLive * LIMITS.hitsPerHouseWirePerSession.live,
  hitsLiveMember: 38,
  confirmRowsPerNight: 30,
  pendingStateChurn: 50,
  liveTicks: 192,
  liveStateChangesPerTick: 0.5,
  healthPollsPerMemberDay: 240,
  healthReadsPerPoll: FF_ROUTE_CEILINGS.healthWarm.read,
  healthSharedReadsPerDay: 1920,
  inboxLoadsPerMemberDay: 30,
  inboxReadsPerLoad: FF_ROUTE_CEILINGS.hitsFirst.read + FF_ROUTE_CEILINGS.read.read + FF_ROUTE_CEILINGS.mark.read,
  wiresLoadsPerMemberDay: 15,
  wiresReadsPerLoad: FF_ROUTE_CEILINGS.wiresList.read + FF_ROUTE_CEILINGS.wireDetail.read,
  digestLoadsPerMemberDay: 3,
  digestReadsPerLoad: FF_ROUTE_CEILINGS.digest.read,
  previewsPerMemberDay: 20,
  previewReadsPerCall: FF_ROUTE_CEILINGS.preview.read,
  namePanelLoadsPerMemberDay: 40,
  namePanelReadsPerLoad: FF_ROUTE_CEILINGS.symbol.read,
  houseLoadsPerMemberDay: 10,
  houseReadsPerLoad: FF_ROUTE_CEILINGS.houseList.read + FF_ROUTE_CEILINGS.houseDetail.read,
  exportsPerMemberDay: 0.2,
  exportReadsPerCall: FF_ROUTE_CEILINGS.exportWorst.read,
  wireWritesPerDay: 30,
  smallWritesPerDay: 170,
  gapChecksPerDay: 48,
  runRowsPerDay: 3,
  archiveRowsPerSession: 28,
});

export const FF_ROW_COSTS = Object.freeze({
  hit: 5,
  receipt: 1,
  record: 1,
  state: 1,
  stateRowsPerHit: 3,
  confirm: 1,
  runWrite: 1,
  nightlyRun: 2,
  runPrune: 1,
  wireEdit: 10,
  archiveInsert: 2,
  archiveDelete: 2,
});

export const FF_TABLE_ROW_COSTS = Object.freeze({
  ff_wire: 2,
  ff_wire_version: 1,
  ff_wire_symbol: 1,
  ff_state: 1,
  ff_hit: 5,
  ff_hit_mark: 1,
  ff_note: 1,
  ff_house_off: 1,
  ff_mute: 1,
  ff_member: 1,
  ff_receipt: 1,
  ff_record: 1,
  ff_confirm: 1,
  ff_run: 1,
  ff_switches: 1,
  ff_arch: 2,
});

export function ffRows(p = FF_BUDGET_PARAMS, c = FF_ROW_COSTS) {
  const memberWires = p.members * p.wiresPerMember;
  const wires = memberWires + p.houseWires;
  const liveWires = Math.ceil(memberWires * p.liveWireShare) + p.houseLive;
  const hitsNightly = p.hitsNightlyHouse + p.hitsNightlyMember;
  const hitsLive = p.hitsLiveHouse + p.hitsLiveMember;
  const nightlyRead = 1 + 2 + 2 * wires + memberWires * p.symbolsPerWire + p.stateExceptions + p.members + p.mutes + p.houseOptOuts + p.switches;
  const nightlyWritten = hitsNightly * c.hit + wires * (c.receipt + c.record) + (hitsNightly * c.stateRowsPerHit + p.pendingStateChurn) * c.state +
    p.confirmRowsPerNight * c.confirm + c.nightlyRun;
  const tickRead = 1 + 2 * liveWires + liveWires * p.symbolsPerWire + p.liveStateExceptions + p.switches;
  const liveRead = Math.ceil(p.liveTicks * tickRead);
  const liveWritten = Math.ceil(p.liveTicks * (c.runWrite + p.liveStateChangesPerTick * c.state) + hitsLive * c.hit + liveWires * (c.receipt + c.record));
  const apiRead = p.healthSharedReadsPerDay + p.members * (
    p.healthPollsPerMemberDay * p.healthReadsPerPoll + p.exportsPerMemberDay * p.exportReadsPerCall +
    p.inboxLoadsPerMemberDay * p.inboxReadsPerLoad + p.wiresLoadsPerMemberDay * p.wiresReadsPerLoad +
    p.digestLoadsPerMemberDay * p.digestReadsPerLoad + p.previewsPerMemberDay * p.previewReadsPerCall +
    p.namePanelLoadsPerMemberDay * p.namePanelReadsPerLoad + p.houseLoadsPerMemberDay * p.houseReadsPerLoad
  );
  const apiWritten = p.wireWritesPerDay * c.wireEdit + p.smallWritesPerDay;
  const housekeepingRead = p.gapChecksPerDay * 2 + p.runRowsPerDay;
  const housekeepingWritten = p.runRowsPerDay * c.runPrune + p.archiveRowsPerSession * (c.archiveInsert + c.archiveDelete);
  return { nightly: [nightlyWritten, nightlyRead], live: [liveWritten, liveRead], api: [apiWritten, Math.ceil(apiRead)], housekeeping: [housekeepingWritten, housekeepingRead] };
}

const rows = ffRows();

export const FF_PLANNED = Object.freeze([
  Object.freeze({
    id: "ff.nightly", row: "FF lane B", written: rows.nightly[0], read: rows.nightly[1],
    source: "docs/ff/contract.md: one evaluation of the armed wires a night; a hit costs five rows (its key, two unique indexes, two plain indexes) and three state rows over its life, a receipt and a record one each; reads are the wire index, symbols, state exceptions (firing and cooling rows: 150 hits a night, each quiet for five sessions) and the cursors",
  }),
  Object.freeze({
    id: "ff.live", row: "FF lane B", written: rows.live[0], read: rows.live[1],
    source: "docs/ff/contract.md: 192 live ticks a weekday (108 Tier 1 firings, 84 Tier 2 passes); a tick upserts its session's one run row and reads the live wires and their state exceptions; a live hit stays quiet for the rest of the session through its dedupe key and writes no state row; one receipt and one record per live wire at the close",
  }),
  Object.freeze({
    id: "ff.api", row: "FF lane B", written: rows.api[0], read: rows.api[1],
    source: "docs/ff/contract.md and tests/ff-b-budget.mjs: twelve members; a health poll every 60 s for four visible hours at the three rows of the member's own part, with the shared run rows read once in thirty seconds (1,920 rows a day for everyone); thirty inbox loads, fifteen wires loads, three digests, twenty previews, forty name panels, ten house loads and one export in five days, each at the row ceiling `FF_ROUTE_CEILINGS` holds it to; thirty wire edits at ten rows",
  }),
  Object.freeze({
    id: "ff.housekeeping", row: "FF lane B", written: rows.housekeeping[0], read: rows.housekeeping[1],
    source: "docs/ff/contract.md: the half-hourly gap check reads two run rows; the 14-day prune deletes the day's three run rows; the intraday archive writes 28 rows a session at two rows each and prunes as many at two rows each",
  }),
]);

export const FF_BUDGET_PARAMS = Object.freeze({
  members: 12,
  wiresPerMember: 25,
  houseWires: 11,
  symbolsPerWire: 5,
  liveWireShare: 0.05,
  stateExceptions: 900,
  liveStateExceptions: 30,
  mutes: 50,
  houseOptOuts: 10,
  switches: 10,
  hitsPerNight: 150,
  confirmRowsPerNight: 30,
  liveTicks: 192,
  liveStateChangesPerTick: 3,
  liveHitsPerTick: 0.3,
  healthPollsPerMemberDay: 240,
  healthReadsPerPoll: 5,
  inboxLoadsPerMemberDay: 30,
  inboxReadsPerLoad: 60,
  wiresLoadsPerMemberDay: 15,
  wiresReadsPerLoad: 60,
  digestLoadsPerMemberDay: 3,
  digestReadsPerLoad: 150,
  previewsPerMemberDay: 20,
  previewReadsPerCall: 4,
  namePanelLoadsPerMemberDay: 40,
  namePanelReadsPerLoad: 8,
  houseLoadsPerMemberDay: 10,
  houseReadsPerLoad: 30,
  wireWritesPerDay: 30,
  gapChecksPerDay: 48,
  runRowsPerDay: 194,
  archiveRowsPerSession: 28,
});

export const FF_ROW_COSTS = Object.freeze({
  hit: 6,
  receipt: 2,
  record: 1,
  state: 1,
  confirm: 1,
  runInsertAndUpdate: 2,
  wireEditWrites: 11,
  runPrune: 2,
  archive: 2,
});

export function ffRows(p = FF_BUDGET_PARAMS, c = FF_ROW_COSTS) {
  const memberWires = p.members * p.wiresPerMember;
  const wires = memberWires + p.houseWires;
  const liveWires = Math.ceil(memberWires * p.liveWireShare) + 1;
  const nightlyRead = 1 + 2 + 2 * wires + memberWires * p.symbolsPerWire + p.stateExceptions + p.members + p.mutes + p.houseOptOuts + p.switches;
  const nightlyWritten = p.hitsPerNight * c.hit + wires * (c.receipt + c.record) + p.stateExceptions * c.state + 2 + p.confirmRowsPerNight * c.confirm;
  const tickRead = 1 + 2 * liveWires + liveWires * p.symbolsPerWire + p.liveStateExceptions + p.switches;
  const tickWritten = c.runInsertAndUpdate + p.liveStateChangesPerTick * c.state + p.liveHitsPerTick * c.hit;
  const liveRead = Math.ceil(p.liveTicks * tickRead);
  const liveWritten = Math.ceil(p.liveTicks * tickWritten + liveWires * (c.receipt + c.record));
  const apiRead = p.members * (
    p.healthPollsPerMemberDay * p.healthReadsPerPoll +
    p.inboxLoadsPerMemberDay * p.inboxReadsPerLoad + p.wiresLoadsPerMemberDay * p.wiresReadsPerLoad +
    p.digestLoadsPerMemberDay * p.digestReadsPerLoad + p.previewsPerMemberDay * p.previewReadsPerCall +
    p.namePanelLoadsPerMemberDay * p.namePanelReadsPerLoad + p.houseLoadsPerMemberDay * p.houseReadsPerLoad
  );
  const apiWritten = p.wireWritesPerDay * c.wireEditWrites + 170;
  const housekeepingRead = p.gapChecksPerDay * 2 + p.runRowsPerDay;
  const housekeepingWritten = p.runRowsPerDay * c.runPrune + p.archiveRowsPerSession * c.archive;
  return { nightly: [nightlyWritten, nightlyRead], live: [liveWritten, liveRead], api: [apiWritten, Math.ceil(apiRead)], housekeeping: [housekeepingWritten, housekeepingRead] };
}

const rows = ffRows();

export const FF_PLANNED = Object.freeze([
  Object.freeze({
    id: "ff.nightly", row: "FF lane B", written: rows.nightly[0], read: rows.nightly[1],
    source: "docs/ff/contract.md: one evaluation of 311 armed wires per night; hits cost 6 rows each (the row, its key and two unique indexes, two plain indexes), receipts 2, records 1; reads are the wire index, symbols, state exceptions (firing and cooling rows: 150 hits a night, each quiet for five sessions) and the cursors",
  }),
  Object.freeze({
    id: "ff.live", row: "FF lane B", written: rows.live[0], read: rows.live[1],
    source: "docs/ff/contract.md: 192 live ticks a weekday (108 Tier 1 firings, 84 Tier 2 passes); a tick reads the live wires and their state exceptions and writes its run row, three state changes and a third of a hit; one receipt and one record per live wire at the close",
  }),
  Object.freeze({
    id: "ff.api", row: "FF lane B", written: rows.api[0], read: rows.api[1],
    source: "docs/ff/contract.md: twelve members; a health poll every 60 s for four visible hours at five rows, thirty inbox loads, fifteen wires loads, three digests, twenty previews, forty name panels and ten house loads a day; thirty wire edits at eleven rows",
  }),
  Object.freeze({
    id: "ff.housekeeping", row: "FF lane B", written: rows.housekeeping[0], read: rows.housekeeping[1],
    source: "docs/ff/contract.md: the half-hourly gap check reads two run rows; the 14-day prune deletes the day's 194 run rows at two rows each; the intraday archive writes 28 rows a session at two rows each",
  }),
]);

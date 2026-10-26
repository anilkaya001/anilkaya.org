import { createLiveLedger, baseParity, ALL_SCOPE } from "./flows-ledger-live.js";
import { stripModel, createSamples, ageText, nextTickMs, trtClock, countFrame, textHash, RT_WINDOWS } from "./flows-ledger-strip.js";
import { parseScope } from "./flows-sfc-view.js";
import { moneyShort } from "./flows-sfc-display.js";

export const ledgerKit = Object.freeze({
  createLiveLedger, baseParity, ALL_SCOPE, parseScope, moneyShort,
  stripModel, createSamples, ageText, nextTickMs, trtClock, countFrame, textHash, RT_WINDOWS,
});

if (typeof window !== "undefined") window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ledgerKit }));

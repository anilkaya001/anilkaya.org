import { runSuite } from "./lib/ff-b-run.mjs";
import * as store from "./lib/ff-b-batteries-store.mjs";
import * as lint from "./lib/ff-b-batteries-lint.mjs";

await runSuite("ff-b-store", [store, lint]);

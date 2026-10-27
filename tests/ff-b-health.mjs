import { runSuite } from "./lib/ff-b-run.mjs";
import * as health from "./lib/ff-b-batteries-health.mjs";

await runSuite("ff-b-health", [health]);

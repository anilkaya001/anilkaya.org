import { runSuite } from "./lib/ff-b-run.mjs";
import * as wires from "./lib/ff-b-batteries-wires.mjs";
import * as isolation from "./lib/ff-b-batteries-isolation.mjs";
import * as inbox from "./lib/ff-b-batteries-inbox.mjs";
import * as reads from "./lib/ff-b-batteries-reads.mjs";
import * as gates from "./lib/ff-b-batteries-gates.mjs";
import * as flags from "./lib/ff-b-batteries-flags.mjs";

await runSuite("ff-b-routes", [wires, isolation, inbox, reads, gates, flags]);

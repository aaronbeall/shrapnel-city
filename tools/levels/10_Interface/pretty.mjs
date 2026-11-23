// Re-write JSON files (paths on the command line) with the source format's pretty printer, so
// files edited by symbols.py keep the layout the rest of source/ has.
import fs from 'node:fs';
import { pretty } from '../../flash-source/format.mjs';
for (const f of process.argv.slice(2)) fs.writeFileSync(f, pretty(JSON.parse(fs.readFileSync(f, 'utf8'))) + '\n');

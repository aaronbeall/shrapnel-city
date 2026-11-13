// Headless frame-time benchmark:
//   node tools/bench.mjs [scale=1] [only=heatray,bombs] [quality=low|medium|high] [stats=1] [json=1] [url=http://localhost:8123/]
// Needs the folder served (npm run serve) and Playwright's Chromium.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url)('playwright')); }

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const scale = +(args.scale || 1);
const url = (args.url || 'http://localhost:8123/') + '?bench' + (args.only ? '&only=' + args.only : '') + (args.stats ? '&stats' : '') + (args.quality ? '&quality=' + args.quality : '') + (args.cab ? '&cab' + (args.cab === 'naive' ? '=naive' : '') : '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: scale });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.benchResult, null, { timeout: 300000 });
const rows = await page.evaluate(() => window.benchResult);
if (args.json) console.log(JSON.stringify(rows));
else console.table(rows);
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();

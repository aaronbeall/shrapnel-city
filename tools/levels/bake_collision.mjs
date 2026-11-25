// Bake a level's collision.png from its collision.json outside the editor, with the editor's own
// code (src/editor/shapes.js), so the map is pixel for pixel what the editor's Bake collision
// makes. For level tools that write collision.json (such as tools/levels/04_Urban/layout.py).
//
//   node tools/levels/bake_collision.mjs 04_Urban [more levels...]
//
// Runs the bake in headless Chromium through Playwright (installed in the cloud sessions; on
// another machine: npm i -D playwright && npx playwright install chromium).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };

const folders = process.argv.slice(2);
if (!folders.length) { console.error('usage: node tools/levels/bake_collision.mjs <NN_name> [...]'); process.exit(1); }

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base + '/index.html').catch(() => {});

let failed = false;
for (const folder of folders) {
  const dir = path.join(ROOT, 'levels', folder);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'level.json'), 'utf8'));
  const { w, h } = settings.size || {};
  if (!w || !h) { console.error(`${folder}: level.json has no size`); failed = true; continue; }
  const b64 = await page.evaluate(async ({ folder, w, h }) => {
    const { ShapeStack, isPixels } = await import('/src/editor/shapes.js');
    const shapes = await (await fetch(`/levels/${folder}/collision.json?t=${Date.now()}`)).json();
    const st = new ShapeStack(w, h);
    for (const s of shapes) {
      if (!isPixels(s)) continue;
      const img = new Image();
      img.src = `/levels/${folder}/${s.pixels}?t=${Date.now()}`;
      await img.decode();
      st.setImage(s.pixels, img);
    }
    const data = st.bake(shapes);
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(data, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, { folder, w, h });
  fs.writeFileSync(path.join(dir, 'collision.png'), Buffer.from(b64, 'base64'));
  console.log(`baked levels/${folder}/collision.png (${w}x${h})`);
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);

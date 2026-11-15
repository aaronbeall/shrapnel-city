// Local server for editing levels: serves the game like `npm run serve`, and lets the
// in-game editor (?edit) save straight into levels/ and rebuild.
//   npm run edit            then open http://localhost:8123/?edit
//
// The editor saves with PUT /levels/<NN_name>/<file>. Only the level files listed in
// tools/levels/levels.mjs, in existing level folders, can be written. After a save the
// build runs, so a page reload picks the change up everywhere.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { FILES } from './levels.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = +(process.env.PORT || 8123);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/plain' };

let building = null, again = false;
function build() {
  if (building) { again = true; return building; }
  building = new Promise((resolve) => {
    const p = spawn('npm', ['run', 'build', '--silent'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => {
      console.log(code ? 'build FAILED:\n' + out : 'rebuilt');
      building = null;
      if (again) { again = false; build(); }
      resolve({ ok: code === 0, log: out.slice(-2000) });
    });
  });
  return building;
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url === '/__editor') return send(200, JSON.stringify({ writable: true }));
  if (req.method === 'PUT') {
    const m = /^\/levels\/(\d\d_[^/]+)\/([^/]+)$/.exec(url);
    if (!m || !FILES.includes(m[2]) || !fs.existsSync(path.join(ROOT, 'levels', m[1]))) return send(403, JSON.stringify({ error: 'not a level file: ' + url }));
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (m[2].endsWith('.json')) {
      try { JSON.parse(body.toString('utf8')); } catch (e) { return send(400, JSON.stringify({ error: e.message })); }
    } else if (body.readUInt32BE(0) !== 0x89504e47) return send(400, JSON.stringify({ error: 'not a PNG' }));
    fs.writeFileSync(path.join(ROOT, 'levels', m[1], m[2]), body);
    console.log('saved', `levels/${m[1]}/${m[2]}`);
    return send(200, JSON.stringify({ saved: `levels/${m[1]}/${m[2]}` }));
  }
  if (req.method === 'POST' && url === '/__build') return send(200, JSON.stringify(await build()));
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, '{}');
  let f = path.join(ROOT, url);
  if (!f.startsWith(ROOT)) return send(403, '{}');
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) return send(404, 'not found', 'text/plain');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f).pipe(res);
});
server.listen(PORT, '127.0.0.1', () => console.log(`level editor: http://localhost:${PORT}/?edit`));

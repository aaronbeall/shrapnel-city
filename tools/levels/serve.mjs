// Local server for editing levels: serves the game like `npm run serve`, and lets the
// in-game editor (?edit) save straight into levels/ and rebuild.
//   npm run edit            then open http://localhost:8123/?edit
//
// The editor saves with PUT /levels/<NN_name>/<file>. POST /__level {folder, create, files} writes
// several files of one level at once and rebuilds: New level (create: a new folder, numbered next)
// and Resize level use it. POST /__art {level, step, seed, only} runs an
// art pipeline step (tools/art/bake.py: place decor, bake the background) and then the build. Only the level files listed in
// tools/levels/levels.mjs (and collision-*.png pixel layers), in existing level folders, can be written. After a save the
// build runs, so a page reload picks the change up everywhere.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isLevelFile, FOLDER_RE } from './levels.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = +(process.env.PORT || 8123);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/plain' };

let building = null, again = false, lastBuild = null; // lastBuild: {ok, at} of the latest finished build
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
      lastBuild = { ok: code === 0, at: Date.now() };
      if (again) { again = false; build(); }
      resolve({ ok: code === 0, log: out.slice(-2000) });
    });
  });
  return building;
}

// The art pipeline is Python. Windows installs it as `python` (python3 there is a Store stub);
// PYTHON overrides.
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
let art = null; // the running art step: {level, step, started}
function run(cmd, args) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try { p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, out: e.message }); return; }
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => resolve({ code: -1, out: out + e.message }));
    p.on('close', (code) => resolve({ code, out }));
  });
}
async function runArt({ level, step, seed, only }) {
  if (art) return { ok: false, log: `already running ${art.step} on ${art.level}` };
  if (!/^\d\d_[^/\\]+$/.test(level || '') || !fs.existsSync(path.join(ROOT, 'levels', level))) return { ok: false, log: 'no such level: ' + level };
  if (!['place', 'bake', 'all'].includes(step)) return { ok: false, log: 'unknown step: ' + step };
  art = { level, step, started: Date.now() };
  try {
    const deps = await run(PYTHON, ['-c', 'import numpy, scipy, PIL']);
    if (deps.code !== 0) {
      return { ok: false, missing: true, log: deps.code === -1 ? `Python not found (tried "${PYTHON}"; set PYTHON to override).` : `The art pipeline needs numpy, scipy and Pillow:\n  ${PYTHON} -m pip install numpy scipy pillow\n\n${deps.out}` };
    }
    const args = ['tools/art/bake.py', level, step];
    if (Number.isInteger(seed)) args.push('--seed', String(seed));
    if (Array.isArray(only) && only.length && only.every((c) => /^[a-z0-9]+$/.test(c))) args.push('--only', only.join(','));
    const r = await run(PYTHON, args);
    console.log(`art ${step} ${level}: ${r.code ? 'FAILED' : 'ok'}\n${r.out.trim()}`);
    if (r.code) return { ok: false, log: r.out.slice(-3000) };
    const b = step === 'place' ? { ok: true, log: '' } : await build(); // decor.json alone changes no built asset
    return { ok: b.ok, log: (r.out + (b.ok ? '' : '\nbuild failed:\n' + b.log)).slice(-3000) };
  } finally { art = null; }
}

// files: {name: text | {base64}}; every name must be a level file. A new folder is written in
// full under a temporary name first, so a failed write never leaves a half level behind.
function writeLevel({ folder, create, files }) {
  if (typeof folder !== 'string' || !FOLDER_RE.test(folder)) return { ok: false, log: 'bad level folder name: ' + folder };
  if (!files || typeof files !== 'object' || !Object.keys(files).length) return { ok: false, log: 'no files' };
  const levelsDir = path.join(ROOT, 'levels'), dir = path.join(levelsDir, folder);
  const existing = fs.readdirSync(levelsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d\d_/.test(e.name)).map((e) => e.name);
  if (create) {
    if (existing.includes(folder) || existing.some((f) => f.slice(0, 2) === folder.slice(0, 2))) return { ok: false, log: `levels/${folder.slice(0, 2)}_… already exists` };
    if (+folder.slice(0, 2) !== existing.length) return { ok: false, log: `a new level must be number ${String(existing.length).padStart(2, '0')} (levels are numbered without gaps)` };
  } else if (!existing.includes(folder)) return { ok: false, log: 'no such level: ' + folder };
  const bodies = [];
  for (const [name, v] of Object.entries(files)) {
    if (!isLevelFile(name)) return { ok: false, log: 'not a level file: ' + name };
    const body = typeof v === 'string' ? Buffer.from(v, 'utf8') : v && typeof v.base64 === 'string' ? Buffer.from(v.base64, 'base64') : null;
    if (!body) return { ok: false, log: 'bad content for ' + name };
    if (name.endsWith('.json')) {
      try { JSON.parse(body.toString('utf8')); } catch (e) { return { ok: false, log: `${name}: ${e.message}` }; }
    } else if (body.length < 8 || body.readUInt32BE(0) !== 0x89504e47) return { ok: false, log: name + ' is not a PNG' };
    bodies.push([name, body]);
  }
  const target = create ? path.join(levelsDir, `.new-${folder}`) : dir;
  if (create) { fs.rmSync(target, { recursive: true, force: true }); fs.mkdirSync(target); }
  for (const [name, body] of bodies) fs.writeFileSync(path.join(target, name), body);
  if (create) fs.renameSync(target, dir);
  console.log(`${create ? 'created' : 'wrote'} levels/${folder}: ${bodies.map(([n]) => n).join(', ')}`);
  return { ok: true };
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  // the editor polls this for its server status badge
  if (url === '/__editor') return send(200, JSON.stringify({ writable: true, building: !!building, lastBuild, art }));
  if (req.method === 'PUT') {
    const m = /^\/levels\/(\d\d_[^/]+)\/([^/]+)$/.exec(url);
    if (!m || !isLevelFile(m[2]) || !fs.existsSync(path.join(ROOT, 'levels', m[1]))) return send(403, JSON.stringify({ error: 'not a level file: ' + url }));
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
  if (req.method === 'POST' && url === '/__level') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let opts;
    try { opts = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return send(400, JSON.stringify({ ok: false, log: e.message })); }
    const w = writeLevel(opts);
    if (!w.ok) return send(400, JSON.stringify(w));
    return send(200, JSON.stringify(await build()));
  }
  if (req.method === 'POST' && url === '/__build') return send(200, JSON.stringify(await build()));
  if (req.method === 'POST' && url === '/__art') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let opts;
    try { opts = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return send(400, JSON.stringify({ ok: false, log: e.message })); }
    return send(200, JSON.stringify(await runArt(opts)));
  }
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

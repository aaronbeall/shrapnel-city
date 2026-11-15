// Build the runtime data from the readable source:
//   source/movie.json, source/library/**, levels/**  ->  assets/swf.json, assets/symbols.json, assets/bitmaps/,
//                                                         assets/levels.json (the level data, for the editor)
//
// The level folders in levels/ are compiled into library symbols and screen_mc frames by
// tools/levels/levels.mjs before everything is decoded.
//
// Usage: node tools/flash-source/build.mjs           (write the assets)
//        node tools/flash-source/build.mjs --check   (compare with an existing build in assets/, write nothing)
//
// Character ids come from source/ids.json; a new library file gets the next free id.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToName, decodeChar, decodeTimeline, decodeScript, hexToRgba } from './format.mjs';
import { loadLevels, composeScreen } from '../levels/levels.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'source');
const ASSETS = path.join(ROOT, 'assets');
const check = process.argv.includes('--check');

// --- read the library ----------------------------------------------------------
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(json|png)$/.test(e.name)) files.push(f);
  }
})(path.join(SRC, 'library'));

const lib = new Map(); // name -> {file, ext}
for (const f of files) {
  const rel = path.relative(path.join(SRC, 'library'), f).split(path.sep).join('/');
  const ext = path.extname(rel);
  const name = pathToName(rel.slice(0, -ext.length));
  if (lib.has(name)) throw new Error(`two files for "${name}"`);
  lib.set(name, { file: f, ext });
}

// --- add the levels --------------------------------------------------------------
const levels = loadLevels(ROOT);
const addGenerated = (name, entry) => {
  if (lib.has(name)) throw new Error(`"${name}" comes from levels/ and must not also be in source/library`);
  lib.set(name, entry);
};
for (const [name, obj] of levels.symbols) addGenerated(name, { file: path.join(ROOT, 'levels'), obj, ext: '.json' });
for (const [name, file] of levels.bitmaps) addGenerated(name, { file, ext: '.png' });

const ids = JSON.parse(fs.readFileSync(path.join(SRC, 'ids.json'), 'utf8'));
const idOf = new Map();
let next = 1;
for (const [name, id] of Object.entries(ids)) { if (lib.has(name)) idOf.set(name, id); next = Math.max(next, id + 1); }
for (const name of [...lib.keys()].sort()) if (!idOf.has(name)) { idOf.set(name, next++); console.log(`new symbol "${name}" -> id ${idOf.get(name)}`); }
const id = (name) => {
  if (name === null) return 65535; // "no bitmap"
  const v = idOf.get(name);
  if (v === undefined) throw new Error(`unknown symbol "${name}"`);
  return v;
};

// --- decode ------------------------------------------------------------------
const chars = {};
const symbols = {};
const instances = {};
const bitmaps = []; // [id, source file]
let screenSource = null; // screen_mc.json before the levels are added

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function symbolEntry(name, s, labels, scripts) {
  return { labels, linkage: s.linkage ?? null, name, scripts, type: s.type };
}

for (const [name, { file, ext, obj }] of [...lib].sort((a, b) => id(a[0]) - id(b[0]))) {
  const cid = id(name);
  if (ext === '.png') {
    chars[cid] = { type: 'bitmap', src: `bitmaps/${cid}.png`, ...pngSize(file) };
    bitmaps.push([cid, file]);
    continue;
  }
  let o;
  try { o = obj ?? JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${path.relative(ROOT, file)}: ${e.message}`); }
  if (o.levels) { screenSource = o; o = composeScreen(o, levels.levels); }
  try {
    if (o.kind === 'sprite') {
      const t = decodeTimeline(o, id);
      chars[cid] = { frames: t.frames, labels: t.labels, scriptFrames: t.scriptFrames, type: 'sprite', frameCount: o.frames, ...(o.scale9 ? { scale9: o.scale9 } : {}) };
      // anonymous clips (no library symbol) can still carry frame scripts, e.g. the mission list
      if (o.symbol || Object.keys(t.scripts).length) symbols[cid] = symbolEntry(name, o.symbol || { type: 'movie clip' }, Object.fromEntries(Object.entries(t.labels).map(([l, f]) => [l, f + 1])), t.scripts);
      for (const [k, src] of Object.entries(t.instances)) instances[cid + ':' + k] = src;
    } else {
      chars[cid] = decodeChar(o, id);
      if (o.symbol) {
        const scripts = Object.fromEntries(Object.entries(o.symbol.scripts || {}).map(([f, v]) => [f, decodeScript(v)]));
        symbols[cid] = symbolEntry(name, o.symbol, o.symbol.labels || {}, scripts);
      }
    }
  } catch (e) { throw new Error(`${path.relative(ROOT, file)}: ${e.message}`); }
}

const movie = JSON.parse(fs.readFileSync(path.join(SRC, 'movie.json'), 'utf8'));
const main = decodeTimeline(movie, id);
symbols[0] = { labels: Object.fromEntries(Object.entries(main.labels).map(([l, f]) => [l, f + 1])), linkage: null, name: '__main__', scripts: main.scripts, type: 'movie clip' };
for (const [k, src] of Object.entries(main.instances)) instances['0:' + k] = src;

const exports = {};
for (const [cid, s] of Object.entries(symbols)) if (s.linkage) exports[s.linkage] = +cid;

const st = movie.stage;
const swf = {
  version: movie.version,
  stage: [st.x || 0, (st.x || 0) + st.width, st.y || 0, (st.y || 0) + st.height],
  frameRate: movie.frameRate,
  background: hexToRgba(movie.background),
  exports,
  root: { frames: main.frames, labels: main.labels, scriptFrames: main.scriptFrames },
  chars,
};
const sym = { symbols, instances };

// --- write or compare ------------------------------------------------------------
if (check) {
  const diffs = [];
  const cmp = (a, b, p) => {
    if (diffs.length > 20) return;
    if (a === b) return;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) { diffs.push(`${p}: ${JSON.stringify(a)?.slice(0, 80)} != ${JSON.stringify(b)?.slice(0, 80)}`); return; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) cmp(a[k], b[k], p + '.' + k);
  };
  cmp(swf, JSON.parse(fs.readFileSync(path.join(ASSETS, 'swf.json'), 'utf8')), 'swf');
  cmp(sym, JSON.parse(fs.readFileSync(path.join(ASSETS, 'symbols.json'), 'utf8')), 'symbols');
  for (const [cid, f] of bitmaps) {
    if (!fs.readFileSync(f).equals(fs.readFileSync(path.join(ASSETS, 'bitmaps', cid + '.png')))) diffs.push(`bitmap ${cid} differs`);
  }
  const extra = fs.readdirSync(path.join(ASSETS, 'bitmaps')).filter((f) => !bitmaps.some(([cid]) => f === cid + '.png'));
  if (extra.length) diffs.push('bitmaps not in source: ' + extra.join(', '));
  if (diffs.length) { console.log('DIFFERENT:\n' + diffs.join('\n')); process.exit(1); }
  console.log(`identical: ${Object.keys(chars).length} characters, ${Object.keys(symbols).length} symbols, ${Object.keys(instances).length} instance scripts, ${bitmaps.length} bitmaps`);
} else {
  fs.mkdirSync(ASSETS, { recursive: true });
  fs.writeFileSync(path.join(ASSETS, 'swf.json'), JSON.stringify(swf));
  fs.writeFileSync(path.join(ASSETS, 'symbols.json'), JSON.stringify(sym, null, 1));
  // the editor (src/editor/) recompiles levels in the browser from this
  fs.writeFileSync(path.join(ASSETS, 'levels.json'), JSON.stringify({ ids: Object.fromEntries(idOf), screen: screenSource, levels: levels.levels }));
  fs.rmSync(path.join(ASSETS, 'bitmaps'), { recursive: true, force: true });
  fs.mkdirSync(path.join(ASSETS, 'bitmaps'));
  for (const [cid, f] of bitmaps) fs.copyFileSync(f, path.join(ASSETS, 'bitmaps', cid + '.png'));
  console.log(`built assets/swf.json (${Object.keys(chars).length} characters), assets/symbols.json, ${bitmaps.length} bitmaps`);
}

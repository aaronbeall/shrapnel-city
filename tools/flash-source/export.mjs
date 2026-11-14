// One-time conversion: compiled runtime data (assets/swf.json, assets/symbols.json,
// assets/bitmaps/) -> readable per-symbol source files under source/.
//
// Usage: node tools/flash-source/export.mjs [outDir=source]
//
// Library symbols keep their FLA names. Characters that only exist inside one
// symbol (raw shapes, shape tweens, static text, bitmaps) are named after it,
// e.g. "enemy assets/enemy stinger/shape 1".
import fs from 'node:fs';
import path from 'node:path';
import { nameToPath, encodeChar, encodeTimeline, rgbaToHex, encodeScript, pretty } from './format.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.resolve(ROOT, process.argv[2] || 'source');
const swf = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/swf.json'), 'utf8'));
const sym = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/symbols.json'), 'utf8'));

const chars = swf.chars;
const MAIN = '_main timeline';
const LABEL = { shape: 'shape', morph: 'shape tween', text: 'text', edittext: 'text field', bitmap: 'bitmap', sprite: 'clip', button: 'button' };

// --- who references whom, in order of first reference ----------------------
function refsOf(c) {
  const out = [];
  const add = (id) => { if (id !== undefined && chars[id] && !out.includes(String(id))) out.push(String(id)); };
  for (const f of c.frames || []) for (const op of f) add(op.id);
  for (const r of c.records || []) { add(r.id); add(r.font); }
  if (c.font !== undefined) add(c.font);
  for (const f of c.fills || []) add(f.bitmap);
  for (const l of c.lines || []) if (l.fill) add(l.fill.bitmap);
  return out;
}
const parents = {};
const children = {};
const order = [...Object.keys(chars).sort((a, b) => a - b), '0'];
const charOf = (id) => (id === '0' ? swf.root : chars[id]);
for (const id of order) {
  children[id] = refsOf(charOf(id));
  for (const r of children[id]) (parents[r] ||= []).push(id);
}

// --- names -------------------------------------------------------------------
const names = {};
const used = new Set();
function nameOf(id) {
  if (names[id]) return names[id];
  let n;
  const c = charOf(id);
  if (id === '0') n = MAIN;
  else if (sym.symbols[id]) n = sym.symbols[id].name;
  else if (c.type === 'font') {
    n = 'fonts/' + c.fullName + (c.bold && !/bold/i.test(c.fullName) ? ' Bold' : '') + (c.italic && !/italic/i.test(c.fullName) ? ' Italic' : '');
  } else {
    const ps = parents[id] || [];
    if (ps.length === 1) {
      const p = ps[0];
      const label = LABEL[c.type];
      const same = children[p].filter((k) => !sym.symbols[k] && charOf(k).type === c.type && (parents[k] || []).length === 1);
      n = nameOf(p) + '/' + label + ' ' + (same.indexOf(id) + 1);
    } else n = '_shared/' + LABEL[c.type] + ' ' + id;
  }
  if (used.has(n)) throw new Error('duplicate name ' + n);
  used.add(n);
  return (names[id] = n);
}
for (const id of order) nameOf(id);
// 65535 is Flash's "no bitmap" placeholder in bitmap fills
const ref = (id) => { if (id === 65535) return null; const n = names[String(id)]; if (!n) throw new Error('unknown character ' + id); return n; };

// --- instance scripts grouped by parent ------------------------------------------
const inst = {};
for (const [key, src] of Object.entries(sym.instances)) {
  const [p, depth, frame] = key.split(':');
  (inst[p] ||= {})[depth + ':' + frame] = src;
}

// --- write -------------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, text) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

function libraryInfo(id) {
  const s = sym.symbols[id];
  if (!s) return undefined;
  const o = { type: s.type };
  if (s.linkage) o.linkage = s.linkage;
  return o;
}

let files = 0;
for (const id of Object.keys(chars).sort((a, b) => a - b)) {
  const c = chars[id];
  const rel = 'library/' + nameToPath(names[id]);
  if (c.type === 'bitmap') {
    if (c.src !== `bitmaps/${id}.png`) throw new Error('unexpected bitmap src ' + c.src);
    const f = path.join(OUT, rel + '.png');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'assets', c.src), f);
    files++;
    continue;
  }
  let o;
  const lib = libraryInfo(id);
  if (c.type === 'sprite') {
    const s = sym.symbols[id];
    const instances = inst[id] || {};
    o = { kind: 'sprite' };
    if (lib) o.symbol = lib;
    if (c.scale9) o.scale9 = c.scale9;
    if (c.frameCount !== c.frames.length) throw new Error('frameCount mismatch ' + id);
    Object.assign(o, encodeTimeline(c, s ? s.scripts : {}, instances, ref));
    if (s && Object.keys(s.labels).some((l) => s.labels[l] !== c.labels[l] + 1)) throw new Error('label mismatch ' + id);
    if (Object.keys(instances).length) throw new Error('unplaced instance scripts in ' + id + ': ' + Object.keys(instances));
    const extra = Object.keys(c).filter((k) => !['type', 'frames', 'labels', 'scriptFrames', 'frameCount', 'scale9'].includes(k));
    if (extra.length) throw new Error('unexpected sprite fields ' + extra);
  } else {
    o = encodeChar(c, ref);
    if (lib) {
      const s = sym.symbols[id];
      // the FLA mapping can attach a clip's frame scripts to a non-sprite character; keep them as they are
      if (Object.keys(s.labels).length) lib.labels = s.labels;
      if (Object.keys(s.scripts).length) lib.scripts = Object.fromEntries(Object.entries(s.scripts).map(([f, src]) => [f, encodeScript(src)]));
      o = { kind: o.kind, symbol: lib, ...o };
    }
  }
  write(rel + '.json', pretty(o) + '\n');
  files++;
}

// main timeline and movie settings
const main = sym.symbols['0'];
if (main.name !== '__main__' || main.linkage || main.type !== 'movie clip') throw new Error('unexpected main timeline entry');
const instances = inst['0'] || {};
const movie = {
  version: swf.version,
  stage: { width: swf.stage[1] - swf.stage[0], height: swf.stage[3] - swf.stage[2], ...(swf.stage[0] || swf.stage[2] ? { x: swf.stage[0], y: swf.stage[2] } : {}) },
  frameRate: swf.frameRate,
  background: rgbaToHex(swf.background),
  ...encodeTimeline(swf.root, main.scripts, instances, ref),
};
if (Object.keys(instances).length) throw new Error('unplaced main timeline instance scripts');
write('movie.json', pretty(movie) + '\n');

// exports must be exactly the symbols' linkage ids
const linkage = Object.fromEntries(Object.entries(sym.symbols).filter(([, s]) => s.linkage).map(([id, s]) => [s.linkage, +id]));
if (JSON.stringify(Object.entries(linkage).sort()) !== JSON.stringify(Object.entries(swf.exports).sort())) throw new Error('exports differ from linkage');

// stable character ids (the runtime and the compiled scripts refer to these)
write('ids.json', pretty(Object.fromEntries(order.filter((id) => id !== '0').sort((a, b) => a - b).map((id) => [names[id], +id]))) + '\n');
console.log(`wrote ${files} library files, movie.json and ids.json to ${path.relative(ROOT, OUT)}/`);


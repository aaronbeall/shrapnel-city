// Build the settings spec for every symbol the level editor can place: assets/props.json.
//
// A "setting" is a variable an instance can set in its "props" (its onClipEvent(load) code, which
// runs before the symbol's own frame-1 script). There is no hand-written list: the spec is read
// from the scripts themselves.
//   - defaults:  `if(x == undefined) x = <expr>;` (and `var x = x || <expr>;`) in the symbol's
//                frame-1 script and every class file it #includes. The first one to run wins.
//   - forced:    a plain `x = <expr>;` in the symbol's own script for a setting that a class
//                gives a default. Props can't change it (the symbol overwrites them).
//   - no default: names the compiled frame-1 script reads from the clip but never writes
//                (src/generated/scripts.js: `$v($c, "x")` with no `$c.x =`), such as a pickup's
//                `item`. Child clip names and names marked "ignore" are left out.
// tools/props/annotations.json adds what code can't say: a description, a group, a type,
// choices. Run after tools/as2js.mjs (npm run build does).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToName, decodeScript } from '../flash-source/format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AS_DIR = path.join(ROOT, 'as2');
const ASSETS = path.join(ROOT, 'assets');
const annotations = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/props/annotations.json'), 'utf8'));
const NOTES = annotations.settings;
const GROUPS = annotations.groups;

// library name -> source file
const libFile = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.json')) {
      const rel = path.relative(path.join(ROOT, 'source/library'), f).split(path.sep).join('/');
      libFile.set(pathToName(rel.slice(0, -5)), f);
    }
  }
})(path.join(ROOT, 'source/library'));

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');

// the frame-1 script as segments in run order: [{from: 'symbol' | class name, text}]
function segments(src, from, seen = []) {
  const out = [];
  let last = 0;
  for (const m of src.matchAll(/^[ \t]*#include\s+"([^"]+)"[^\n]*$/gm)) {
    out.push({ from, text: src.slice(last, m.index) });
    last = m.index + m[0].length;
    let file = path.join(AS_DIR, m[1].replace(/^as\//, ''));
    if (!fs.existsSync(file)) file = path.join(AS_DIR, path.basename(m[1]));
    if (!fs.existsSync(file) || seen.includes(file)) continue;
    const isFrame = file.includes(path.sep + 'frames' + path.sep);
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    out.push(...segments(text, isFrame ? from : path.basename(file, '.as'), [...seen, file]));
  }
  out.push({ from, text: src.slice(last) });
  return out;
}

// compiled frame-1 blocks of src/generated/scripts.js, by symbol name
const compiled = new Map();
{
  const js = fs.readFileSync(path.join(ROOT, 'src/generated/scripts.js'), 'utf8');
  const heads = [...js.matchAll(/^\/\/ \[(.+)\] frame (\d+)$/gm)];
  heads.forEach((h, i) => { if (h[2] === '1') compiled.set(h[1], js.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : js.length)); });
}

function literal(expr) {
  const s = expr.trim();
  if (s === 'true' || s === 'false') return { type: 'boolean', value: s === 'true' };
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return { type: 'number', value: Number(s) };
  if (/^0x[0-9a-f]+$/i.test(s)) return { type: 'number', value: parseInt(s, 16) };
  if (/^"[^"\\]*"$/.test(s)) return { type: 'string', value: s.slice(1, -1) };
  if (s === 'null') return { type: null, value: null };
  return null;
}

function specFor(name) {
  const file = libFile.get(name);
  if (!file) return null;
  const sym = JSON.parse(fs.readFileSync(file, 'utf8'));
  const f1 = (sym.timeline || []).find((e) => e.frame === 1 && e.script !== undefined);
  if (!f1) return null;
  const segs = segments(decodeScript(f1.script).replace(/\r\n?/g, '\n'), 'symbol').map((s) => ({ ...s, text: stripComments(s.text) }));
  const classes = [...new Set(segs.map((s) => s.from).filter((f) => f !== 'symbol'))];

  const settings = new Map(); // name -> setting
  const add = (n, info) => { if (!settings.has(n)) settings.set(n, { name: n, ...info }); };
  for (const s of segs) {
    for (const m of s.text.matchAll(/if\s*\(\s*(\w+)\s*==\s*undefined\s*\)\s*\1\s*=\s*([^;\n]+);/g)) add(m[1], { default: m[2].trim(), from: s.from });
    for (const m of s.text.matchAll(/var\s+(\w+)\s*=\s*\1\s*\|\|\s*([^;\n]+);/g)) add(m[1], { default: m[2].trim(), from: s.from });
  }
  // forced: plain assignments in the symbol's own code to a setting
  for (const s of segs.filter((x) => x.from === 'symbol')) {
    for (const m of s.text.matchAll(/^[ \t]*(\w+)\s*=\s*([^=;\n][^;\n]*);/gm)) {
      const st = settings.get(m[1]);
      if (st && st.from !== 'symbol') st.forced = m[2].trim();
      else if (!st && NOTES[m[1]] && !NOTES[m[1]].ignore) add(m[1], { default: m[2].trim(), from: 'symbol', forced: m[2].trim() });
    }
  }
  // read but never written: settings with no default
  const js = compiled.get(name) || '';
  const writes = new Set([...js.matchAll(/\$c\.(\w+) =[^=]/g)].map((m) => m[1]));
  const children = new Set();
  for (const e of sym.timeline || []) for (const c of e.changes || []) if (c.name) children.add(c.name);
  for (const m of js.matchAll(/\$v\(\$c, "(\w+)"\)/g)) {
    const n = m[1];
    if (settings.has(n) || writes.has(n) || children.has(n) || n.length < 2 || /_mc$|Txt$/.test(n) || (NOTES[n] && NOTES[n].ignore)) continue;
    const seg = segs.find((s) => new RegExp('\\b' + n + '\\b').test(s.text));
    add(n, { default: null, from: seg ? seg.from : 'symbol' });
  }
  // settings the scan can't see (written inside the class too, or called as functions): listed by class in the annotations
  for (const [n, note] of Object.entries(NOTES)) if (note.for && note.for.some((c) => classes.includes(c))) add(n, { default: null, from: classes.find((c) => note.for.includes(c)) });
  for (const n of Object.keys(NOTES)) if (NOTES[n].ignore) settings.delete(n);

  const list = [...settings.values()].map((st) => {
    const note = NOTES[st.name] || {};
    const lit = st.default == null ? null : literal(st.default);
    const out = { name: st.name, from: st.from, group: note.group || 'other' };
    if (st.default != null) out.default = st.default;
    if (lit) out.value = lit.value;
    out.type = note.type || (lit && lit.type) || 'json';
    if (st.forced !== undefined) out.forced = st.forced;
    for (const k of ['desc', 'choices', 'min', 'step']) if (note[k] !== undefined) out[k] = note[k];
    return out;
  });
  const order = Object.keys(GROUPS);
  const noted = Object.keys(NOTES), rank = (n) => (noted.includes(n) ? noted.indexOf(n) : noted.length);
  list.sort((a, b) => (order.indexOf(a.group) - order.indexOf(b.group)) || (rank(a.name) - rank(b.name)) || 0);
  return { classes, settings: list };
}

const levels = JSON.parse(fs.readFileSync(path.join(ASSETS, 'levels.json'), 'utf8'));
const symbols = {};
for (const names of Object.values(levels.palette)) for (const n of names) { const s = specFor(n); if (s) symbols[n] = s; }
fs.writeFileSync(path.join(ASSETS, 'props.json'), JSON.stringify({ groups: GROUPS, symbols }));
const counts = Object.values(symbols).map((s) => s.settings.length);
console.log(`built assets/props.json (${Object.keys(symbols).length} symbols, ${counts.reduce((a, b) => a + b, 0)} settings)`);

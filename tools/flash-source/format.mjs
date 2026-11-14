// Readable Flash source format: conversion between the runtime's compiled data
// (assets/swf.json + assets/symbols.json, numeric character ids) and the
// per-symbol files under source/ (library names, readable timelines).
//
// Every encode has an exact decode: tools/flash-source/build.mjs --check proves
// that building source/ reproduces the runtime data.

// ---------------------------------------------------------------------------
// file names: library names map to paths; characters that are not portable in
// file names (and leading/trailing spaces) are %-escaped.
export function nameToPath(name) {
  return name.split('/').map((part) => part
    .replace(/[%<>:"\\|?*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
    .replace(/^ +| +$/g, (s) => '%20'.repeat(s.length))).join('/');
}
export function pathToName(p) {
  return p.split('/').map((part) => part.replace(/%([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))).join('/');
}

// ---------------------------------------------------------------------------
// colours
const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');
export function rgbaToHex(c) {
  if (!Array.isArray(c) || c.length !== 4 || c.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return c;
  return '#' + c.slice(0, 3).map(hex2).join('') + (c[3] === 255 ? '' : hex2(c[3]));
}
export function hexToRgba(h) {
  if (typeof h !== 'string') return h;
  const v = h.slice(1);
  return [0, 2, 4, 6].map((i) => (i === 6 && v.length === 6 ? 255 : parseInt(v.slice(i, i + 2), 16)));
}

// ---------------------------------------------------------------------------
// path data: ["M", x, y, "L", x, y, "Q", cx, cy, x, y, "Z"] <-> "M x y L x y Q cx cy x y Z"
export function pathToString(d) { return d.map((t) => (typeof t === 'number' ? numStr(t) : t)).join(' '); }
export function stringToPath(s) {
  if (s === '') return [];
  return s.split(' ').map((t) => (/^[A-Za-z]$/.test(t) ? t : parseFloat(t)));
}
const numStr = (n) => (Object.is(n, -0) ? '-0' : String(n));

// ---------------------------------------------------------------------------
// transforms: [a, b, c, d, tx, ty] <-> {x, y, scale | scaleX/scaleY | matrix}
export function encodeMatrix(m, out) {
  const [a, b, c, d, tx, ty] = m;
  out.x = tx; out.y = ty;
  if (b === 0 && c === 0) {
    if (a === d) { if (a !== 1) out.scale = a; } else out.scale = [a, d];
  } else out.matrix = [a, b, c, d];
}
export function decodeMatrix(o) {
  if (o.x === undefined) return undefined;
  if (o.matrix) return [...o.matrix, o.x, o.y];
  const s = o.scale === undefined ? 1 : o.scale;
  const [a, d] = Array.isArray(s) ? s : [s, s];
  return [a, 0, 0, d, o.x, o.y];
}

// colour transform [rm, gm, bm, am, ra, ga, ba, aa] <-> {alpha} | {multiply, add}
export function encodeCx(cx) {
  const [rm, gm, bm, am, ra, ga, ba, aa] = cx;
  const zeroAdd = [ra, ga, ba, aa].every((v) => Object.is(v, 0));
  if (rm === 1 && gm === 1 && bm === 1 && zeroAdd) return am === 1 ? {} : { alpha: am };
  const o = {};
  if (!(rm === 1 && gm === 1 && bm === 1 && am === 1)) o.multiply = [rm, gm, bm, am];
  if (!zeroAdd) o.add = [ra, ga, ba, aa];
  return o;
}
export function decodeCx(o) {
  if (o.multiply || o.add) return [...(o.multiply || [1, 1, 1, 1]), ...(o.add || [0, 0, 0, 0])];
  return [1, 1, 1, o.alpha === undefined ? 1 : o.alpha, 0, 0, 0, 0];
}

// ---------------------------------------------------------------------------
// fills and line styles
const FILL_TYPES = { 0: 'solid', 16: 'linear gradient', 18: 'radial gradient', 19: 'focal gradient',
  64: 'bitmap', 65: 'clipped bitmap', 66: 'bitmap (unsmoothed)', 67: 'clipped bitmap (unsmoothed)' };
const FILL_CODES = Object.fromEntries(Object.entries(FILL_TYPES).map(([k, v]) => [v, +k]));

export function encodeFill(f, ref) {
  const o = { type: FILL_TYPES[f.t] ?? f.t };
  for (const [k, v] of Object.entries(f)) {
    if (k === 't') continue;
    if (k === 'c' || k === 'c1') o[k === 'c' ? 'color' : 'color1'] = rgbaToHex(v);
    else if (k === 'stops' || k === 'stops1') o[k] = v.map(([r, ...c]) => [r, rgbaToHex(c)]);
    else if (k === 'bitmap') o.bitmap = ref(v);
    else o[k] = v;
  }
  return o;
}
export function decodeFill(o, id) {
  const f = { t: typeof o.type === 'string' ? FILL_CODES[o.type] : o.type };
  for (const [k, v] of Object.entries(o)) {
    if (k === 'type') continue;
    if (k === 'color' || k === 'color1') f[k === 'color' ? 'c' : 'c1'] = hexToRgba(v);
    else if (k === 'stops' || k === 'stops1') f[k] = v.map(([r, c]) => [r, ...hexToRgba(c)]);
    else if (k === 'bitmap') f.bitmap = id(v);
    else f[k] = v;
  }
  return f;
}
export function encodeLine(l, ref) {
  const o = {};
  for (const [k, v] of Object.entries(l)) {
    if (k === 'c' || k === 'c1') o[k === 'c' ? 'color' : 'color1'] = rgbaToHex(v);
    else if (k === 'w' || k === 'w1') o[k === 'w' ? 'width' : 'width1'] = v;
    else if (k === 'fill') o.fill = encodeFill(v, ref);
    else o[k] = v;
  }
  return o;
}
export function decodeLine(o, id) {
  const l = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'color' || k === 'color1') l[k === 'color' ? 'c' : 'c1'] = hexToRgba(v);
    else if (k === 'width' || k === 'width1') l[k === 'width' ? 'w' : 'w1'] = v;
    else if (k === 'fill') l.fill = decodeFill(v, id);
    else l[k] = v;
  }
  return l;
}
function encodePathRec(p) {
  const o = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'f') o.fill = v; else if (k === 'l') o.line = v;
    else if (k === 'd' || k === 'd1') o[k] = pathToString(v);
    else o[k] = v;
  }
  return o;
}
function decodePathRec(o) {
  const p = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'fill') p.f = v; else if (k === 'line') p.l = v;
    else if (k === 'd' || k === 'd1') p[k] = stringToPath(v);
    else p[k] = v;
  }
  return p;
}

// ---------------------------------------------------------------------------
// scripts: a single line stays a string, several lines become an array of
// lines with leading tabs shown as 4 spaces (decode turns them back into tabs).
export function encodeScript(s) {
  if (!s.includes('\n')) return s.replace(/^\t+/, (t) => '    '.repeat(t.length));
  return s.split('\n').map((l) => l.replace(/^\t+/, (t) => '    '.repeat(t.length)));
}
export function decodeScript(v) {
  const lines = Array.isArray(v) ? v : [v];
  return lines.map((l) => l.replace(/^(?: {4})+/, (s) => '\t'.repeat(s.length / 4))).join('\n');
}

// ---------------------------------------------------------------------------
// timelines: per-frame lists of place / replace / update / remove changes
const BUTTON_STATES = ['up', 'over', 'down', 'hit'];

function encodeProps(op, o, ref) {
  for (const [k, v] of Object.entries(op)) {
    if (k === 'op' || k === 'new' || k === 'move' || k === 'id' || k === 'depth') continue;
    if (k === 'matrix') encodeMatrix(v, o);
    else if (k === 'cx') o.color = encodeCx(v);
    else if (k === 'filters') o.filters = v.map((f) => encodeFilter(f));
    else if (k === 'states') o.states = BUTTON_STATES.filter((s, i) => v & (1 << i));
    else o[k] = v;
  }
}
function decodeProps(o, op, id) {
  for (const [k, v] of Object.entries(o)) {
    if (['place', 'replace', 'update', 'remove', 'depth', 'symbol', 'script', 'x', 'y', 'scale', 'matrix'].includes(k)) continue;
    if (k === 'color') op.cx = decodeCx(v);
    else if (k === 'filters') op.filters = v.map((f) => decodeFilter(f));
    else if (k === 'states') op.states = v.reduce((m, s) => m | (1 << BUTTON_STATES.indexOf(s)), 0);
    else op[k] = v;
  }
  const m = decodeMatrix(o);
  if (m) op.matrix = m;
}
function encodeFilter(f) {
  const o = {};
  for (const [k, v] of Object.entries(f)) o[k] = (k === 'color' || k === 'shadow' || k === 'highlight') ? rgbaToHex(v) : v;
  return o;
}
function decodeFilter(o) {
  const f = {};
  for (const [k, v] of Object.entries(o)) f[k] = (k === 'color' || k === 'shadow' || k === 'highlight') ? hexToRgba(v) : v;
  return f;
}

// op: SWF PlaceObject/RemoveObject record; script: the instance's onClipEvent/on() source
export function encodeOp(op, ref, script) {
  if (op.op === 'remove') {
    const extra = Object.keys(op).filter((k) => k !== 'op' && k !== 'depth');
    if (extra.length) throw new Error('unexpected remove fields ' + extra);
    return { remove: op.depth };
  }
  let o;
  if (op.new && !op.move && op.id !== undefined) o = { place: ref(op.id), depth: op.depth };
  else if (op.new && op.move && op.id !== undefined) o = { replace: ref(op.id), depth: op.depth };
  else if (!op.new && op.move && op.id === undefined) o = { update: op.depth };
  else throw new Error('unexpected place flags ' + JSON.stringify(op));
  encodeProps(op, o, ref);
  if (script !== undefined) o.script = encodeScript(script);
  return o;
}
export function decodeOp(o, id) {
  if (o.remove !== undefined) return { op: 'remove', depth: o.remove };
  let op;
  if (o.place !== undefined) op = { op: 'place', depth: o.depth, id: id(o.place), new: true, move: false };
  else if (o.replace !== undefined) op = { op: 'place', depth: o.depth, id: id(o.replace), new: true, move: true };
  else if (o.update !== undefined) op = { op: 'place', depth: o.update, new: false, move: true };
  else throw new Error('unknown timeline change ' + JSON.stringify(o));
  decodeProps(o, op, id);
  return op;
}

// sprite/root timeline <-> {frames, timeline: [{frame, label, script, changes}]}
// swfLabels: {label: 0-based frame}; scripts: {1-based frame: source}; instances: {"depth:frame": source}
export function encodeTimeline(sp, scripts, instances, ref) {
  const byFrame = new Map();
  const at = (i) => { if (!byFrame.has(i)) byFrame.set(i, { frame: i + 1 }); return byFrame.get(i); };
  for (const [label, f] of Object.entries(sp.labels || {})) {
    const e = at(f);
    e.label = e.label === undefined ? label : [].concat(e.label, label);
  }
  for (const [f, src] of Object.entries(scripts || {})) at(+f - 1).script = encodeScript(src);
  sp.frames.forEach((ops, i) => {
    if (!ops.length) return;
    at(i).changes = ops.map((op) => {
      const key = op.depth + ':' + (i + 1);
      const s = op.op === 'place' && op.new ? instances[key] : undefined;
      if (s !== undefined) delete instances[key];
      return encodeOp(op, ref, s);
    });
  });
  const timeline = [...byFrame.keys()].sort((a, b) => a - b).map((i) => {
    const e = byFrame.get(i);
    return Object.fromEntries(['frame', 'label', 'script', 'changes'].filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
  });
  const o = { frames: sp.frames.length, timeline };
  const derived = Object.keys(scripts || {}).map((f) => +f - 1).sort((a, b) => a - b);
  if (JSON.stringify([...sp.scriptFrames].sort((a, b) => a - b)) !== JSON.stringify(derived)) o.swfScriptFrames = sp.scriptFrames;
  return o;
}
export function decodeTimeline(o, id) {
  const frames = Array.from({ length: o.frames }, () => []);
  const labels = {}, scripts = {}, instances = {};
  for (const e of o.timeline) {
    const i = e.frame - 1;
    if (e.label !== undefined) for (const l of [].concat(e.label)) labels[l] = i;
    if (e.script !== undefined) scripts[e.frame] = decodeScript(e.script);
    for (const c of e.changes || []) {
      frames[i].push(decodeOp(c, id));
      if (c.script !== undefined) instances[c.depth + ':' + e.frame] = decodeScript(c.script);
    }
  }
  const scriptFrames = o.swfScriptFrames || Object.keys(scripts).map((f) => +f - 1).sort((a, b) => a - b);
  return { frames, labels, scripts, instances, scriptFrames };
}

// ---------------------------------------------------------------------------
// characters
export function encodeChar(c, ref) {
  switch (c.type) {
    case 'shape': case 'morph': {
      const o = { kind: c.type === 'morph' ? 'shape tween' : 'shape' };
      for (const [k, v] of Object.entries(c)) {
        if (k === 'type') continue;
        if (k === 'fills') o.fills = v.map((f) => encodeFill(f, ref));
        else if (k === 'lines') o.lines = v.map((l) => encodeLine(l, ref));
        else if (k === 'paths') o.paths = v.map(encodePathRec);
        else o[k] = v;
      }
      return o;
    }
    case 'text': case 'edittext': {
      const o = { kind: c.type === 'text' ? 'static text' : 'text field' };
      for (const [k, v] of Object.entries(c)) {
        if (k === 'type') continue;
        if (k === 'records') o.records = v.map((r) => Object.fromEntries(Object.entries(r).map(([rk, rv]) =>
          [rk, rk === 'font' ? ref(rv) : rk === 'color' ? rgbaToHex(rv) : rv])));
        else if (k === 'font') o.font = ref(v);
        else if (k === 'color') o.color = rgbaToHex(v);
        else o[k] = v;
      }
      return o;
    }
    case 'font': {
      const o = { kind: 'font' };
      for (const [k, v] of Object.entries(c)) {
        if (k === 'type') continue;
        o[k] = k === 'glyphs' ? v.map(pathToString) : v;
      }
      return o;
    }
    case 'button': {
      const o = { kind: 'button' };
      for (const [k, v] of Object.entries(c)) {
        if (k === 'type') continue;
        if (k === 'records') o.records = v.map((r) => { const e = { symbol: ref(r.id), depth: r.depth }; encodeProps(r, e, ref); return e; });
        else o[k] = v;
      }
      return o;
    }
    default: throw new Error('encodeChar: unsupported type ' + c.type);
  }
}
export function decodeChar(o, id) {
  const kind = o.kind;
  switch (kind) {
    case 'shape': case 'shape tween': {
      const c = { type: kind === 'shape' ? 'shape' : 'morph' };
      for (const [k, v] of Object.entries(o)) {
        if (k === 'kind' || k === 'symbol') continue;
        if (k === 'fills') c.fills = v.map((f) => decodeFill(f, id));
        else if (k === 'lines') c.lines = v.map((l) => decodeLine(l, id));
        else if (k === 'paths') c.paths = v.map(decodePathRec);
        else c[k] = v;
      }
      return c;
    }
    case 'static text': case 'text field': {
      const c = { type: kind === 'static text' ? 'text' : 'edittext' };
      for (const [k, v] of Object.entries(o)) {
        if (k === 'kind' || k === 'symbol') continue;
        if (k === 'records') c.records = v.map((r) => Object.fromEntries(Object.entries(r).map(([rk, rv]) =>
          [rk, rk === 'font' ? id(rv) : rk === 'color' ? hexToRgba(rv) : rv])));
        else if (k === 'font') c.font = id(v);
        else if (k === 'color') c.color = hexToRgba(v);
        else c[k] = v;
      }
      return c;
    }
    case 'font': {
      const c = { type: 'font' };
      for (const [k, v] of Object.entries(o)) {
        if (k === 'kind' || k === 'symbol') continue;
        c[k] = k === 'glyphs' ? v.map(stringToPath) : v;
      }
      return c;
    }
    case 'button': {
      const c = { type: 'button' };
      for (const [k, v] of Object.entries(o)) {
        if (k === 'kind' || k === 'symbol') continue;
        if (k === 'records') c.records = v.map((e) => { const r = { id: id(e.symbol), depth: e.depth }; decodeProps(e, r, id); return r; });
        else c[k] = v;
      }
      return c;
    }
    default: throw new Error('decodeChar: unsupported kind ' + kind);
  }
}

// ---------------------------------------------------------------------------
// pretty printer: JSON with short arrays/objects kept on one line
export function pretty(v, indent = '', width = 110) {
  const flat = JSON.stringify(v);
  if (flat === undefined) return 'null';
  if (v === null || typeof v !== 'object') return flat;
  const allPrim = (Array.isArray(v) ? v : Object.values(v)).every((x) => x === null || typeof x !== 'object');
  if (indent.length + flat.length <= width || (Array.isArray(v) && allPrim && v.every((x) => typeof x === 'number'))) return spaced(v);
  const inner = indent + '  ';
  if (Array.isArray(v)) return '[\n' + v.map((x) => inner + pretty(x, inner, width)).join(',\n') + '\n' + indent + ']';
  return '{\n' + Object.entries(v).map(([k, x]) => inner + JSON.stringify(k) + ': ' + pretty(x, inner, width)).join(',\n') + '\n' + indent + '}';
}
// one-line JSON with a space after commas and colons
function spaced(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(spaced).join(', ') + ']';
  return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + spaced(x)).join(', ') + '}';
}

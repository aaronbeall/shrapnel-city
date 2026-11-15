// Compile the level folders in levels/ into the library symbols and screen_mc
// frames the game runs. Used by tools/flash-source/build.mjs.
//
// levels/NN_name/          named like the level's entry in the `levels` array in as2/functionsLevel.as
//   level.json             level settings (all optional): "fadeIn": false skips the fade-in when
//                          the level starts (the original Bridge has none)
//   collision.png          the collision map: black wall, #999999 impassable but shoot-over, white open
//   background.png         the baked level art, same size as the collision map
//   briefing.json          the briefing screen: {"changes": [timeline changes]}
//   boxes.json             [instance, ...] placed in boxes_mc
//   powerups.json          [instance, ...] placed in powerups_mc (pickups and message beacons)
//   enemies.json           [instance, ...] placed in enemies_mc
//   doors.json             [instance, ...] doors and gates, placed on screen_mc under the level
//   features.json          [instance, ...] everything else placed on screen_mc: entrance_mc,
//                          exit_mc, vision_mc, path nodes, triggers
//   decor.json             decor placements for the art bake (not read by the game)
//
// An instance is {"symbol": "<library name>", "x", "y", ...timeline instance properties,
// "props": {...}} where props become the instance's onClipEvent(load) variables, or
// "script" for instances whose load code is more than plain variables.
import fs from 'node:fs';
import path from 'node:path';

const LAYERS = ['boxes', 'powerups', 'enemies'];

// --- AS2 literals -------------------------------------------------------------------
export function asLiteral(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(asLiteral).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => k + ':' + asLiteral(x)).join(', ') + '}';
  throw new Error('props: unsupported value ' + JSON.stringify(v));
}

export function propsScript(props) {
  return ['onClipEvent (load) {', ...Object.entries(props).map(([k, v]) => `    ${k} = ${asLiteral(v)};`), '}'];
}

// instance -> timeline place change
function place(inst, depth, where) {
  const { symbol, props, script, ...rest } = inst;
  if (!symbol) throw new Error(`${where}: instance without "symbol"`);
  if (props && script) throw new Error(`${where}: an instance has either "props" or "script", not both`);
  const c = { place: symbol, depth, ...rest };
  if (props) { c.clipEvents = [1]; c.script = propsScript(props); }
  else if (script !== undefined) { c.clipEvents = [1]; c.script = script; }
  return c;
}

function readJSON(f, dflt) {
  if (!fs.existsSync(f)) { if (dflt !== undefined) return dflt; throw new Error(`missing ${f}`); }
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`${f}: ${e.message}`); }
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// a full-size bitmap as sprite > shape > bitmap, under the names the game's ids already use
function bitmapClip(base, file, out) {
  const { w, h } = pngSize(file);
  out.bitmaps.set(`${base}/shape 1/bitmap 1`, file);
  out.symbols.set(`${base}/shape 1`, {
    kind: 'shape',
    bounds: [0, w, 0, h],
    fills: [{ type: 'clipped bitmap (unsmoothed)', bitmap: `${base}/shape 1/bitmap 1`, m: [1, 0, 0, 1, 0, 0], repeat: false, smooth: false }],
    lines: [],
    paths: [{ fill: 0, d: `M ${w} ${h} L 0 ${h} L 0 0 L ${w} 0 L ${w} ${h} Z` }],
  });
  out.symbols.set(base, { kind: 'sprite', symbol: { type: 'movie clip' }, frames: 1, timeline: [{ frame: 1, changes: [{ place: `${base}/shape 1`, depth: 1, x: 0, y: 0 }] }] });
  return { w, h };
}

function container(name, list, where) {
  return { kind: 'sprite', symbol: { type: 'movie clip' }, frames: 1, timeline: [{ frame: 1, changes: list.map((inst, k) => place(inst, k + 1, `${where}[${k}]`)) }] };
}

// Read every level folder. Returns {levels, symbols: Map name -> source object, bitmaps: Map name -> png file}
export function loadLevels(root) {
  const dir = path.join(root, 'levels');
  const out = { levels: [], symbols: new Map(), bitmaps: new Map() };
  if (!fs.existsSync(dir)) return out;
  // the roster in as2/functionsLevel.as (commented-out entries don't count)
  const as = fs.readFileSync(path.join(root, 'as2/functionsLevel.as'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const roster = [...(/var levels = \[([\s\S]*?)\]/.exec(as)?.[1] ?? '').matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d\d_/.test(e.name)).map((e) => e.name).sort();
  folders.forEach((folder, i) => {
    if (+folder.slice(0, 2) !== i) throw new Error(`levels/${folder}: expected level number ${String(i).padStart(2, '0')} (levels must be numbered without gaps)`);
    if (roster[i] !== folder) throw new Error(`levels/${folder}: entry ${i} of the levels array in as2/functionsLevel.as is ${JSON.stringify(roster[i])}; the folder must have the same name`);
    const f = (n) => path.join(dir, folder, n);
    const where = (n) => `levels/${folder}/${n}`;
    const settings = readJSON(f('level.json'));
    const col = bitmapClip(`level assets/level${i}`, f('collision.png'), out);
    const bg = bitmapClip(`level assets/background${i}`, f('background.png'), out);
    if (bg.w !== col.w || Math.abs(bg.h - col.h) > 1) throw new Error(`${where('background.png')} is ${bg.w}x${bg.h} but collision.png is ${col.w}x${col.h}`);
    for (const layer of LAYERS) out.symbols.set(`level assets/${layer}${i}`, container(`${layer}${i}`, readJSON(f(layer + '.json'), []), where(layer + '.json')));
    out.levels.push({
      index: i, folder, settings,
      briefing: readJSON(f('briefing.json'), { changes: [] }).changes,
      doors: readJSON(f('doors.json'), []),
      features: readJSON(f('features.json'), []),
    });
  });
  return out;
}

// Depths on screen_mc for one level's game frame (all below the persistent templates at 2900+).
const DEPTH = { background: 3, doors: 10, level: 200, features: 210, boxes: 1000, powerups: 1001, enemies: 1002, fade: 3281 };

function gameChanges(L) {
  const i = L.index;
  const c = [{ place: `level assets/background${i}`, depth: DEPTH.background, x: 0, y: 0, name: 'background_mc' }];
  if (L.doors.length > DEPTH.level - DEPTH.doors) throw new Error(`levels/${L.folder}: too many doors`);
  L.doors.forEach((d, k) => c.push(place(d, DEPTH.doors + k, `levels/${L.folder}/doors.json[${k}]`)));
  c.push({ place: `level assets/level${i}`, depth: DEPTH.level, x: 0, y: 0, name: 'level_mc' });
  if (L.features.length > DEPTH.boxes - DEPTH.features) throw new Error(`levels/${L.folder}: too many features`);
  L.features.forEach((d, k) => c.push(place(d, DEPTH.features + k, `levels/${L.folder}/features.json[${k}]`)));
  for (const layer of LAYERS) c.push({ place: `level assets/${layer}${i}`, depth: DEPTH[layer], x: 0, y: 0, name: layer + '_mc' });
  return c;
}

// screen_mc.json holds only what persists across levels: frame 1 (player, blasts, ... plus the
// frame script) and frame 2 (projectile templates). Each level adds a briefing frame and a game frame.
export function composeScreen(screen, levels) {
  const base = new Map(screen.timeline.map((e) => [e.frame, e]));
  const timeline = [];
  let prev = []; // depths placed by the previous level frame
  const frame = (n, changes, script) => {
    const b = base.get(n) || {};
    const persistent = b.changes || [];
    const own = new Set(persistent.map((c) => c.depth));
    for (const c of changes) if (own.has(c.depth)) throw new Error(`screen_mc frame ${n}: depth ${c.depth} is used by a persistent clip`);
    const all = [...prev.map((d) => ({ remove: d })), ...[...persistent, ...changes].sort((a, b) => a.depth - b.depth)];
    const e = { frame: n };
    if (b.label !== undefined) e.label = b.label;
    const s = b.script ?? script;
    if (s !== undefined) e.script = s;
    e.changes = all;
    timeline.push(e);
    prev = changes.map((c) => c.depth);
  };
  for (const L of levels) {
    frame(L.index * 2 + 1, L.briefing.map((c) => ({ ...c })));
    const fade = L.settings.fadeIn === false ? [] : [{ place: 'graphic assets/fade in anim', depth: DEPTH.fade, x: 0, y: 0 }];
    frame(L.index * 2 + 2, [...gameChanges(L), ...fade], 'startLevel();');
  }
  const { levels: _, ...rest } = screen;
  return { ...rest, frames: Math.max(2, levels.length * 2), timeline };
}

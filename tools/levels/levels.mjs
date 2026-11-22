// Read the level folders in levels/ and compile them (tools/levels/compile.mjs) into the
// library symbols and screen_mc frames the game runs. Used by tools/flash-source/build.mjs.
//
// levels/NN_name/          named like the level's entry in the `levels` array in as2/functionsLevel.as
//   level.json             level settings (all optional): art {kit, seed} for the art pipeline
//   collision.png          the collision map: black wall, #999999 impassable but shoot-over, white open
//   collision.json         the shapes the editor bakes into collision.png, + collision-*.png pixel
//                          layers (editor only: the build and the art bake read just collision.png)
//   background.png         the baked level art, same size as the collision map
//   briefing.json          the briefing screen: {title, body, captions, graphics} (see levels/README.md)
//   boxes.json             [instance, ...] placed in boxes_mc
//   powerups.json          [instance, ...] placed in powerups_mc (pickups and message beacons)
//   enemies.json           [instance, ...] placed in enemies_mc
//   doors.json             [instance, ...] doors and gates, placed on screen_mc under the level
//   features.json          [instance, ...] everything else placed on screen_mc: entrance_mc,
//                          exit_mc (the build adds vision_mc itself)
//   pathNodes.json         [instance, ...] pathfinding nodes, placed on screen_mc after the features
//   vision.json            [zone, ...] vision zones, the clips inside vision_mc
//   decor.json             decor placements for the art bake (tools/art/bake.py; not read by the game)
//
// An instance is {"symbol": "<library name>", "x", "y", ...timeline instance properties,
// "props": {...}} where props become the instance's onClipEvent(load) variables, or
// "script" for instances whose load code is more than plain variables.
import fs from 'node:fs';
import path from 'node:path';
import { LAYERS, levelSymbols, composeScreen } from './compile.mjs';

export { composeScreen };

export const FILES = ['level.json', 'collision.png', 'collision.json', 'background.png', 'briefing.json', ...LAYERS.map((l) => l + '.json'), 'doors.json', 'features.json', 'pathNodes.json', 'vision.json', 'decor.json'];
// a file the editor may write into a level folder: one of FILES, or a collision pixel layer
export const isLevelFile = (name) => FILES.includes(name) || /^collision-[a-z0-9][a-z0-9-]*\.png$/.test(name);

function readJSON(f, dflt) {
  if (!fs.existsSync(f)) { if (dflt !== undefined) return dflt; throw new Error(`missing ${f}`); }
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`${f}: ${e.message}`); }
}

function pngSize(file) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// the level roster in as2/functionsLevel.as (commented-out entries don't count)
export function roster(root) {
  const as = fs.readFileSync(path.join(root, 'as2/functionsLevel.as'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...(/var levels = \[([\s\S]*?)\]/.exec(as)?.[1] ?? '').matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
}

// Read every level folder. Returns {levels, symbols: Map name -> source object, bitmaps: Map name -> png file}
export function loadLevels(root) {
  const dir = path.join(root, 'levels');
  const out = { levels: [], symbols: new Map(), bitmaps: new Map() };
  if (!fs.existsSync(dir)) return out;
  const names = roster(root);
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d\d_/.test(e.name)).map((e) => e.name).sort();
  folders.forEach((folder, i) => {
    if (+folder.slice(0, 2) !== i) throw new Error(`levels/${folder}: expected level number ${String(i).padStart(2, '0')} (levels must be numbered without gaps)`);
    if (names[i] !== folder) throw new Error(`levels/${folder}: entry ${i} of the levels array in as2/functionsLevel.as is ${JSON.stringify(names[i])}; the folder must have the same name`);
    const f = (n) => path.join(dir, folder, n);
    const L = {
      index: i, folder,
      settings: readJSON(f('level.json')),
      briefing: readJSON(f('briefing.json'), {}),
      doors: readJSON(f('doors.json'), []),
      features: readJSON(f('features.json'), []),
      pathNodes: readJSON(f('pathNodes.json'), []),
      vision: readJSON(f('vision.json'), []),
      decor: readJSON(f('decor.json'), []),
      collision: readJSON(f('collision.json'), null), // the shapes behind collision.png; the build only reads the PNG
      size: pngSize(f('collision.png')),
      backgroundSize: pngSize(f('background.png')),
    };
    for (const layer of LAYERS) L[layer] = readJSON(f(layer + '.json'), []);
    const { size: c, backgroundSize: b } = L;
    if (b.w !== c.w || Math.abs(b.h - c.h) > 1) throw new Error(`levels/${folder}/background.png is ${b.w}x${b.h} but collision.png is ${c.w}x${c.h}`);
    for (const [name, o] of levelSymbols(L)) out.symbols.set(name, o);
    out.bitmaps.set(`level assets/level${i}/shape 1/bitmap 1`, f('collision.png'));
    out.bitmaps.set(`level assets/background${i}/shape 1/bitmap 1`, f('background.png'));
    out.levels.push(L);
  });
  return out;
}

// New level and Resize level: both build a level's files in the browser and send them in one
// POST /__level to npm run edit (tools/levels/serve.mjs), which writes them and rebuilds.
// level.json "size" is the source of truth for a level's size; collision.png, its pixel layers
// and background.png follow it.

import { pretty } from '../../tools/flash-source/format.mjs';
import { briefingJSON } from '../../tools/levels/compile.mjs';

export const MIN_SIZE = 16, MAX_SIZE = 8192; // tools/levels/levels.mjs checks the same
export const BORDER = 16;        // a new level's wall border, px
const WALL_ART = '#2b2f2e';      // placeholder art: walls
const FLOOR_ART = '#626a67';     // placeholder art: floor (the game's own background colour)

export const validSize = (v) => Number.isInteger(v) && v >= MIN_SIZE && v <= MAX_SIZE;

function canvas(w, h, fill) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  if (fill) { const x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, w, h); }
  return c;
}

export async function pngBase64(c) {
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(s) };
}

export function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('could not load ' + url));
    img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  });
}

// a ring of wall `b` px wide around a w x h level, as an even-odd path
// level.json as written to disk: one setting per line
export const settingsJSON = (o) => !Object.keys(o).length ? '{}\n' : '{\n' + Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${pretty(v)}`).join(',\n') + '\n}\n';
const listJSON = (list) => '[\n' + list.map((x) => '  ' + pretty(x)).join(',\n') + '\n]\n';

const borderPath = (w, h, b) => `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z M ${b} ${b} L ${b} ${h - b} L ${w - b} ${h - b} L ${w - b} ${b} Z`;

// The files of a new, empty w x h level: open floor in a wall border (an editable shape), the
// entrance on the left and the exit on the right, placeholder art and a briefing to fill in.
export async function newLevelFiles(name, w, h) {
  const b = Math.min(BORDER, Math.floor(Math.min(w, h) / 4));
  const map = canvas(w, h, '#000');
  map.getContext('2d').fillStyle = '#fff';
  map.getContext('2d').fillRect(b, b, w - 2 * b, h - 2 * b);
  const art = canvas(w, h, WALL_ART);
  art.getContext('2d').fillStyle = FLOOR_ART;
  art.getContext('2d').fillRect(b, b, w - 2 * b, h - 2 * b);
  const base = canvas(w, h, '#fff');
  const collision = [
    { name: 'collision map', pixels: 'collision-base.png', locked: true },
    { name: 'border', mode: 'wall', d: borderPath(w, h, b) },
  ];
  const cy = Math.round(h / 2), inset = Math.min(b + 48, Math.floor(w / 4));
  const features = [
    { symbol: 'game objects/entrance_mc', x: inset, y: cy, name: 'entrance_mc' },
    { symbol: 'game objects/exit_mc', x: w - inset, y: cy, name: 'exit_mc' },
  ];
  const title = name.replace(/_/g, ' ').toUpperCase();
  return {
    'level.json': settingsJSON({ size: { w, h } }),
    'collision.json': listJSON(collision),
    'collision.png': await pngBase64(map),
    'collision-base.png': await pngBase64(base),
    'background.png': await pngBase64(art),
    'features.json': listJSON(features),
    'briefing.json': briefingJSON({ title, body: 'Mission briefing goes here.' }),
  };
}

// Where the old map sits in a resized one. anchor [ax, ay]: 0 keeps the left / top edge where it
// is, 1 the right / bottom, 0.5 centres; space is added or cut on the other side(s).
export function resizeOffset(from, to, [ax, ay]) {
  return { dx: Math.round((to.w - from.w) * ax), dy: Math.round((to.h - from.h) * ay) };
}

// an image redrawn at (dx, dy) on a w x h canvas: cropped where it falls outside, `pad` (a fill
// colour, or nothing for transparent) where it doesn't reach
export function shifted(img, w, h, dx, dy, pad) {
  const c = canvas(w, h, pad);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(img, dx, dy);
  return c;
}

export const PAD = { collision: '#000', art: WALL_ART }; // added space is wall

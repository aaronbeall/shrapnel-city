// Asset explorer: every weapon, enemy, object, item and effect in the game,
// drawn live by the port's own runtime and renderer. Timelines play without
// running the game's ActionScript, so each clip shows exactly what its
// frames contain. Click any card to open the inspector.
import { Runtime } from '../src/flash/runtime.js';
import { MovieClip, SimpleButton, TextField } from '../src/flash/display.js';
import { mul } from '../src/flash/geom.js';
import { decodeTimeline } from './flash-source/format.mjs';
import { container } from './levels/compile.mjs';

const params = new URLSearchParams(location.search);
const rt = new Runtime(document.createElement('canvas'), { base: '../assets/' });
const status = document.getElementById('status');
await rt.load((p) => { status.textContent = `loading art… ${Math.round(p * 100)}%`; });
const lib = rt.lib;
const R = rt.renderer;

// Large frame scripts and the projectile templates live in as2/ and are pulled
// in with #include; inline them here so the stats below can read them.
{
  const re = /^[ \t]*#include\s+"as\/((?:frames|shots)\/[^"]+)"[^\n]*$/gm;
  const texts = [...lib.symbols.values()].flatMap((s) => Object.values(s.scripts || {})).concat(Object.values(lib.instanceScripts));
  const paths = new Set(texts.flatMap((t) => [...t.matchAll(re)].map((m) => m[1])));
  const files = new Map(await Promise.all([...paths].map(async (p) => [p, await fetch('../as2/' + p.split('/').map(encodeURIComponent).join('/')).then((r) => r.text())])));
  const inline = (t) => t.replace(re, (m, p) => files.get(p) ?? m);
  for (const s of lib.symbols.values()) for (const f in s.scripts || {}) s.scripts[f] = inline(s.scripts[f]);
  for (const k in lib.instanceScripts) lib.instanceScripts[k] = inline(lib.instanceScripts[k]);
}
// assets/files.json (written by the build): every file in source/ and levels/ and the character it becomes
const fileIndex = await fetch('../assets/files.json').then((r) => (r.ok ? r.json() : null)).catch(() => null) || { files: [], levels: [] };
R.quality = 'high';
const DPR = Math.min(2, window.devicePixelRatio || 1);
const FPS = rt.frameRate || 31;

// ---------------------------------------------------------------- data
const sym = (id) => lib.symbols.get(id) || { name: 'char' + id, scripts: {}, labels: {} };
const shortName = (id) => sym(id).name.replace(/^.*\//, '');
const SCREEN = lib.idFor('screen_mc');
const screenDef = lib.get(SCREEN);
const scriptText = (id, f) => (sym(id).scripts || {})[f];

// screen_mc keeps one template clip per projectile / particle, named by its
// linkage-like instance name ("shot_mcPlasma"); the game duplicates those.
const templates = new Map();
for (let f = 1; f <= screenDef.frames.length; f++) {
  for (const [d, e] of lib.spriteState(screenDef, f)) {
    if (e.name && !templates.has(e.name)) templates.set(e.name, { ...e, depth: d, frame: f, parent: SCREEN });
  }
}

// `name = literal;` params set in a template's onClipEvent(load)
function instParams(linkage) {
  const t = templates.get(linkage);
  if (!t) return {};
  const src = lib.instanceScripts[`${SCREEN}:${t.depth}:${t.placed}`] || '';
  const out = {};
  for (const m of src.matchAll(/^\t?(\w+)\s*=\s*("[^"]*"|-?[\d.]+|true|false)\s*;/gm)) out[m[1]] = m[2].replace(/"/g, '');
  return out;
}

// weapon tables straight from the original player.as
const playerSrc = await fetch('../as2/player.as').then((r) => r.text());
function asArray(name) {
  const i = playerSrc.indexOf(name + ' = [');
  let j = playerSrc.indexOf('[', i), depth = 0, k = j;
  for (; k < playerSrc.length; k++) {
    if (playerSrc[k] === '[') depth++;
    else if (playerSrc[k] === ']' && --depth === 0) break;
  }
  return Function('return ' + playerSrc.slice(j, k + 1))();
}
const weapons1 = asArray('weapons1');
const weapons2 = asArray('weapons2');
weapons1.forEach((w, i) => { w.id = i; });
weapons2.forEach((w, i) => { w.id = i; });
const WEAPON_KEYS = {
  1: 'Machine', 2: 'Energy', 3: 'Kinetic', 4: 'Special', 5: 'Laser',
  6: 'Concussion bomb', 7: 'Propelled bomb', 8: 'Cluster bomb', 9: 'Missile', 0: 'Laser device',
};

// `if(x == undefined) x = value;` defaults in an enemy's frame 1 script
function defaults(id) {
  const s = scriptText(id, 1) || '';
  const out = {};
  for (const m of s.matchAll(/if\s*\(\s*(\w+)\s*==\s*undefined\s*\)\s*\1\s*=\s*([^;{\n]+);/g)) out[m[1]] = m[2].trim();
  const drop = /powerupDrop\s*=\s*\{[^}]*?item\s*:\s*"([^"]+)"[^}]*?(?:probability\s*:\s*([\d.]+))?[^}]*\}/s.exec(s);
  if (drop) out.drops = drop[1] + (drop[2] ? ` (${Math.round(drop[2] * 100)}%)` : '');
  const inc = /#include "as\/[^"]*?(\w+)\.as"/.exec(s);
  if (inc) out.script = inc[1] + '.as';
  return out;
}

// what each level places
const LEVEL_NAMES = fileIndex.levels.length
  ? fileIndex.levels.map((f) => f.replace(/^(\d\d)_/, '$1 ').replace(/([a-z])([A-Z])/g, '$1 $2'))
  : ['00 Training', '01 Drop Zone', '02 First Block', '03 Bridge'];
const levels = LEVEL_NAMES.map((name, i) => {
  const frame = i * 2 + 2;
  const st = lib.spriteState(screenDef, frame);
  const byName = {};
  for (const [d, e] of st) if (e.name) byName[e.name] = { ...e, depth: d };
  const contents = (inst) => {
    if (!inst) return [];
    const def = lib.get(inst.id);
    const out = [];
    for (const [d, e] of lib.spriteState(def, 1)) {
      const key = `${inst.id}:${d}:${e.placed}`;
      out.push({ id: e.id, key, script: lib.instanceScripts[key] || '' });
    }
    return out;
  };
  return {
    name, frame, byName,
    enemies: contents(byName.enemies_mc),
    boxes: contents(byName.boxes_mc),
    powerups: contents(byName.powerups_mc),
  };
});
const usage = new Map(); // char id -> [{level, n}]
for (const L of levels) {
  const counts = new Map();
  for (const e of [...L.enemies, ...L.boxes, ...L.powerups]) counts.set(e.id, (counts.get(e.id) || 0) + 1);
  for (const [id, n] of counts) {
    if (!usage.has(id)) usage.set(id, []);
    usage.get(id).push({ level: L.name, n });
  }
}

// what powerup.as does on load: show the pickup's type and weapon icon
function dressPowerup(clip, script) {
  if (!script || !(clip instanceof MovieClip) || clip.charId !== lib.idFor('powerup')) return;
  const type = (/type\s*=\s*"([^"]+)"/.exec(script) || [])[1];
  const item = (/item\s*=\s*"([^"]+)"/.exec(script) || [])[1];
  if (type === 'primary' || type === 'secondary') {
    clip.gotoAndStop(type);
    const list = type === 'primary' ? weapons1 : weapons2;
    const w = list.find((x) => x.name === item);
    if (clip.icons_mc && w) clip.icons_mc.gotoAndStop(w.id + 1);
  } else if (type !== 'trigger') clip.gotoAndStop(item || 1);
  else clip.gotoAndStop(1);
}

// ---------------------------------------------------------------- previews
// A Preview owns one live instance and draws it fitted into a canvas.
// spec: {id, label?, hold?, range?, cx, filters, blend, matrix, setup(node), every, boundsOf(node), maxScale}
const all = [];
class Preview {
  constructor(spec) {
    this.spec = spec;
    this.canvas = document.createElement('canvas');
    this.visible = false;
    this.tickN = 0;
    all.push(this);
  }

  make() {
    const s = this.spec;
    const node = rt.createInstance(s.id);
    if (!node) return null;
    if (s.matrix) node.setMatrix([s.matrix[0], s.matrix[1], s.matrix[2], s.matrix[3], 0, 0]);
    if (s.cx) node.cx = s.cx;
    if (s.filters) node.filters = s.filters;
    if (s.blend) node.blendMode = s.blend;
    if (node._initTimeline) node._initTimeline();
    if (node instanceof MovieClip) {
      if (s.hold !== undefined) node.gotoAndStop(s.hold);
      else if (s.range) node.gotoAndPlay(s.range[0]);
    }
    if (s.setup) s.setup(node);
    rt.queue.length = 0; // the explorer never runs game scripts
    return node;
  }

  build() {
    if (this.node !== undefined) return;
    this.node = this.make();
    if (!this.node) return;
    // fit to the union of bounds over the first stretch of playback
    const probe = this.make();
    let b = null;
    const steps = this.spec.static ? 1 : Math.min(90, Math.max(probe._totalframes || 1, 30));
    for (let i = 0; i < steps; i++) {
      const lb = this.spec.boundsOf ? this.spec.boundsOf(probe) : probe.boundsIn(null, true);
      if (lb && isFinite(lb[0]) && lb[1] - lb[0] > 0.01) b = union(b, lb);
      this.advance(probe);
    }
    this.bounds = b || [-10, 10, -10, 10];
    // how many ticks "play once" runs: the label range, else the longest timeline in it
    const r = this.spec.range;
    const fresh = this.make();
    const clips = [];
    if (fresh) collect(fresh, clips);
    this.length = r ? r[1] - r[0] + 1 : Math.max(1, ...clips.map((c) => c._totalframes || 1));
    this.played = 0;
  }

  // back to the first frame (or the held frame / range start)
  reset() {
    if (this.node === undefined) return;
    this.node = this.make();
    this.played = 0;
  }

  advance(node = this.node) {
    const list = [];
    collect(node, list);
    for (const c of list) if (!c.removed) c._advance();
    const r = this.spec.range;
    if (r && node._currentframe > r[1]) node.gotoAndPlay(r[0]);
    rt.queue.length = 0;
  }

  tick() {
    if (!this.node || this.spec.static) return;
    this.advance();
  }

  draw() {
    if (!this.node) return;
    const cv = this.canvas;
    const cssW = cv.clientWidth || +cv.dataset.w, cssH = cv.clientHeight || +cv.dataset.h;
    const W = Math.round(cssW * DPR), H = Math.round(cssH * DPR);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.spec.bgColor && state.bg !== 'checker') { ctx.fillStyle = this.spec.bgColor; ctx.fillRect(0, 0, W, H); } else paintBackground(ctx, W, H, state.bg);
    const b = this.bounds;
    const bw = Math.max(1, b[1] - b[0]), bh = Math.max(1, b[3] - b[2]);
    const pad = 12 * DPR;
    let s = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh, (this.spec.maxScale || 4) * DPR);
    if (this.zoom) s = this.zoom * DPR;
    const cxp = (b[0] + b[1]) / 2 + (this.pan ? this.pan[0] : 0), cyp = (b[2] + b[3]) / 2 + (this.pan ? this.pan[1] : 0);
    const m = [s, 0, 0, s, W / 2 - cxp * s, H / 2 - cyp * s];
    this.view = { m, s };
    R.scale = s; R.W = W; R.H = H; R.baseMatrix = m;
    try { R.drawNode(ctx, this.node, m, null, [0, W, 0, H]); } catch (err) { console.error(err); }
    if (this.overlay) this.overlay(ctx, m, s);
  }
}

function collect(node, out) {
  if (node instanceof MovieClip) {
    out.push(node);
    for (const k of node.children) if (k instanceof MovieClip) collect(k, out);
  }
}
function union(a, b) {
  if (!a) return b.slice();
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])];
}

const BG = {
  dark: '#0b1717',
  game: rt.bgColor,
  checker: null,
  light: '#e8eef0',
};
let checker;
function paintBackground(ctx, W, H, bg) {
  if (bg === 'checker') {
    if (!checker) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      g.fillStyle = '#2a2f33'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#353b40'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
      checker = ctx.createPattern(c, 'repeat');
    }
    ctx.fillStyle = checker;
  } else ctx.fillStyle = BG[bg] || BG.dark;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- UI helpers
const state = { bg: params.get('bg') || 'dark', play: 'stop', tab: 'files', query: params.get('filter') || '', dir: 'source/library', frame: params.get('frame') || '', size: '', ids: params.get('ids') || '', showAll: false };
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
};

function stage(spec, w, h, caption) {
  const p = new Preview(spec);
  p.canvas.dataset.w = w; p.canvas.dataset.h = h;
  p.canvas.style.width = w + 'px';
  p.canvas.style.height = h + 'px';
  const wrap = el('figure', { class: 'stage', title: 'Inspect ' + sym(spec.id).name, onclick: (ev) => { ev.stopPropagation(); inspect(spec); } },
    p.canvas, caption ? el('figcaption', {}, caption) : null);
  observer.observe(p.canvas);
  p.canvas.$preview = p;
  return wrap;
}

// ---------------------------------------------------------------- kinds
// Every file and character is one of these kinds; the help dialog (?) lists them.
const P = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const KINDS = {
  movieclip: { label: 'Movie clip', color: '#4fe0c8', group: 'Library symbols',
    svg: P('<rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 3v10M12 3v10" stroke="currentColor" stroke-width="1.2"/><path d="M7 6.2v3.6l3-1.8z" fill="currentColor"/>'),
    desc: 'A named symbol with its own timeline that plays on its own. Scripts reach it by instance name, so nearly everything the game moves is one: the player, enemies, shots, effects, screens.' },
  graphic: { label: 'Graphic', color: '#ffb547', group: 'Library symbols',
    svg: P('<circle cx="5.5" cy="10" r="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 2.5l5 8.5H4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
    desc: 'A named symbol whose timeline is locked to its parent\'s frames. It has no scripts and no instance name: reusable art, or animation that stays in sync with the clip it sits in.' },
  button: { label: 'Button', color: '#ff7aa8', group: 'Library symbols',
    svg: P('<rect x="1.5" y="4" width="13" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/>'),
    desc: 'A named symbol with up, over, down and hit frames that reacts to the mouse. Used for the menu buttons.' },
  clip: { label: 'Unnamed clip', color: '#8fd3ff', group: 'Pieces',
    svg: P('<rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.2 1.6"/><path d="M7 6.2v3.6l3-1.8z" fill="currentColor"/>'),
    desc: 'A timeline with no library name (clip 1.json…). It lives only inside the symbol whose folder holds it, often because it carries a frame script.' },
  shape: { label: 'Shape', color: '#b6f36b', group: 'Pieces',
    svg: P('<path d="M8 1.8l6 4.4-2.3 7H4.3L2 6.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
    desc: 'Vector drawing (fills and strokes) drawn straight onto a symbol\'s timeline. Most of the actual artwork.' },
  morph: { label: 'Shape tween', color: '#d59bff', group: 'Pieces',
    svg: P('<rect x="1.5" y="5" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="7.5" r="2.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 12.5h4l-1.3-1.2M11.5 12.5l-1.3 1.2" fill="none" stroke="currentColor" stroke-width="1.1"/>'),
    desc: 'A shape that morphs from a start drawing to an end drawing (Flash shape tween). The placing timeline\'s ratio picks the in-between.' },
  text: { label: 'Static text', color: '#e6e6e6', group: 'Pieces',
    svg: P('<path d="M3 3.5h10M8 3.5v9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    desc: 'Text laid out in the FLA and drawn with an embedded font. Scripts can\'t change it.' },
  edittext: { label: 'Text field', color: '#7ee0ff', group: 'Pieces',
    svg: P('<rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 6h2M6 10h2M7 6v4" stroke="currentColor" stroke-width="1.2"/>'),
    desc: 'Dynamic or input text that scripts write to: score, ammo, timers, mission text.' },
  bitmap: { label: 'Bitmap', color: '#ffd36b', group: 'Pieces',
    svg: P('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 12l3.8-4.2 2.6 2.6 1.7-1.6 3 3.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="11" cy="5.5" r="1.2" fill="currentColor"/>'),
    desc: 'A PNG image. Shapes paint it as a bitmap fill, which is how the level backgrounds and collision maps get on screen.' },
  font: { label: 'Font', color: '#c9b8ff', group: 'Pieces',
    svg: P('<path d="M1.8 13L5 3.5 8.2 13M3 10h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M13.8 8.5v4.5M13.8 10.6a2.1 2.1 0 1 1 0-.1" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
    desc: 'Embedded font outlines that static text and text fields draw with.' },
  level: { label: 'Level layer', color: '#ff9c5b', group: 'Level and data files',
    svg: P('<path d="M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.5 2v10.5M10.5 3.5V14" stroke="currentColor" stroke-width="1.1"/>'),
    desc: 'A file in levels/NN_name/ that the build turns into part of the level: placements (boxes, pickups, enemies, doors, features, vision zones, path nodes) or the collision map and background.' },
  briefing: { label: 'Briefing', color: '#9fe870', group: 'Level and data files',
    svg: P('<rect x="2.5" y="1.5" width="11" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 5h6M5 8h6M5 11h3.5" stroke="currentColor" stroke-width="1.2"/>'),
    desc: 'The level\'s briefing screen, compiled into its own frame on screen_mc.' },
  timeline: { label: 'Main timeline', color: '#ffffff', group: 'Level and data files',
    svg: P('<path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    desc: 'movie.json: stage size, frame rate and the root timeline everything else hangs off.' },
  data: { label: 'Data', color: '#9aa7a6', group: 'Level and data files',
    svg: P('<path d="M6 2.5c-2 0-2 1-2 2.5s-1 2.5-2 3c1 .5 2 1.5 2 3s0 2.5 2 2.5M10 2.5c2 0 2 1 2 2.5s1 2.5 2 3c-1 .5-2 1.5-2 3s0 2.5-2 2.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
    desc: 'JSON that isn\'t drawn: level settings, decor placements for the art bake, the id table.' },
  folder: { label: 'Folder', color: '#ffb547', group: 'Level and data files',
    svg: P('<path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor" opacity=".85"/>'),
    desc: 'A folder in source/ or levels/. A symbol\'s pieces sit in a folder named after it; its card links there ("N pieces →").' },
};
// kind of a character id
function kindOf(id) {
  if (id === 0) return 'timeline';
  const s = lib.symbols.get(id);
  if (s && s.type === 'graphic') return 'graphic';
  if (s && s.type === 'button') return 'button';
  const c = lib.get(id);
  if (s && s.type === 'movie clip' && (!c || c.type === 'sprite') && s.name.split('/').pop().match(/^clip \d+$/) === null) return 'movieclip';
  if (!c) return 'data';
  return { sprite: 'clip', shape: 'shape', morph: 'morph', text: 'text', edittext: 'edittext', bitmap: 'bitmap', font: 'font', button: 'button' }[c.type] || 'data';
}
function kindIcon(kind) {
  const k = KINDS[kind] || KINDS.data;
  const span = el('span', { class: 'kicon', title: k.label, style: `color:${k.color}` });
  span.innerHTML = k.svg;
  return span;
}
const kindTag = (kind) => el('span', { class: 'kind' }, kindIcon(kind), ' ', (KINDS[kind] || KINDS.data).label);

function card({ title, sub, stages, stats, tags, search, wide, kind }) {
  if (kind && stats && !stats.kind) stats = { kind: kindTag(kind), ...stats };
  const c = el('article', { class: 'card' + (wide ? ' wide' : '') },
    el('div', { class: 'stages' }, stages),
    el('header', {}, el('h3', {}, kind ? [kindIcon(kind), ' '] : null, title), sub ? el('p', { class: 'sub' }, sub) : null),
    tags && tags.length ? el('div', { class: 'tags' }, tags.map((t) => el('span', { class: 'tag' }, t))) : null,
    stats ? el('dl', {}, Object.entries(stats).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [el('dt', {}, k), el('dd', {}, v.nodeType ? v : String(v))])) : null,
  );
  c.dataset.search = (search || title + ' ' + (sub || '')).toLowerCase();
  c.addEventListener('click', () => {
    const first = c.querySelector('canvas');
    if (first && first.$preview) inspect(first.$preview.spec);
  });
  return c;
}

function section(title, note, cards) {
  return el('section', {}, el('h2', {}, title, note ? el('small', {}, note) : null), el('div', { class: 'grid' }, cards));
}

const labelsOf = (id) => {
  const c = lib.get(id);
  return c && c.labels ? Object.entries(c.labels).sort((a, b) => a[1] - b[1]).map(([n, f]) => [n, f + 1]) : [];
};
const framesOf = (id) => { const c = lib.get(id); return c && c.frames ? c.frames.length : 1; };
const fmt = (v) => (v === Infinity ? '∞' : v === null || v === undefined ? '—' : v);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const usedIn = (id) => (usage.get(id) || []).map((u) => `${u.level} ×${u.n}`).join(', ');

// ---------------------------------------------------------------- tabs
const ICONS_PRIMARY = lib.idFor('weapon assets/wep icons primary - guns');
const ICONS_SECONDARY = lib.idFor('weapon assets/wep icons secondary ');
const POWERUP = lib.idFor('powerup');

// projectile clips: frame 1 is the shot in flight, the rest is its impact
function shotStage(linkage, w = 90, h = 80, impact = true) {
  const t = templates.get(linkage);
  if (!t) return el('figure', { class: 'stage missing' }, el('div', { style: `width:${w}px;height:${h}px` }, 'no clip'), el('figcaption', {}, 'shot'));
  const base = { id: t.id, cx: t.cx, filters: t.filters, blend: t.blend, matrix: t.matrix, maxScale: 6, instKey: `${SCREEN}:${t.depth}:${t.placed}`, title: linkage };
  const T = framesOf(t.id);
  const out = [stage({ ...base, hold: 1 }, w, h, 'in flight')];
  if (impact && T > 1) out.push(stage({ ...base, range: [2, T], title: linkage + ' impact' }, w, h, 'impact'));
  return out;
}

function weaponCard(w, slot) {
  const icons = slot === 1 ? ICONS_PRIMARY : ICONS_SECONDARY;
  const label = slot === 1 ? 'primary' : 'secondary';
  const stats = {
    category: WEAPON_KEYS[w.key], ammo: fmt(w.ammo), max: fmt(w.max), refire: w.refire + 'f', spread: w.spread,
    burst: w.burst ? `${w.burst} / ${w.burstReload || 0}f` : undefined, 'muzzle fx': w.fire, shot: w.shot,
  };
  const t = templates.get(w.shot);
  const ps = instParams(w.shot);
  let shot = w.shot;
  // launcher templates (speed 0) only spawn other shots: show what they spawn
  if (ps.frag && +ps.speed === 0 && templates.has(ps.frag)) {
    stats.shot += ` → ${ps.fragCount || 3}× ${ps.frag}`;
    shot = ps.frag;
    Object.assign(ps, instParams(ps.frag));
  }
  for (const k of ['damage', 'speed', 'blastRange', 'fragCount']) if (ps[k] !== undefined && k !== 'fragCount') stats[k] = ps[k];
  return card({
    title: w.name, sub: w.fullname && w.fullname !== w.name ? w.fullname : `${label} #${w.id + 1}`, wide: true,
    stats, search: `${w.name} ${w.fullname || ''} ${w.shot} ${WEAPON_KEYS[w.key]} ${t ? sym(t.id).name : ''}`,
    stages: [
      stage({ id: icons, hold: w.id + 1, title: `${w.name} HUD icon` }, 90, 80, 'HUD icon'),
      stage({ id: POWERUP, hold: label, title: `${w.name} pickup`, setup: (n) => n.icons_mc && n.icons_mc.gotoAndStop(w.id + 1) }, 90, 80, 'pickup'),
      shotStage(shot),
    ],
  });
}

const ENEMIES = [
  'enemy gnat', 'enemy stinger', 'enemy stinger2', 'enemy stinger3', 'enemy scurge', 'enemy wolfgun', 'enemy double battery', 'enemy object fire barrel',
].map((n) => lib.idFor('enemy assets/' + n));
// finished in the FLA but only placed on guide layers, so the original game never used them
const UNUSED_ENEMIES = ['enemy tank', 'enemy drone', 'enemy missile launcher'].map((n) => lib.idFor('enemy assets/' + n));

function aliveDeadCard(id, extra = {}) {
  const T = framesOf(id);
  const d = defaults(id);
  const stats = { ...extra.stats };
  for (const k of ['health', 'turnSpeed', 'speedMax', 'shotSpread', 'refireRate', 'burstCount', 'burstReload', 'blastRange', 'damage', 'suicideDamage', 'fragCount', 'drops', 'script']) {
    if (d[k] !== undefined && stats[k] === undefined) stats[k] = d[k].replace(/^"|"$/g, '');
  }
  if (d.shot) stats.shot = d.shot.replace(/"/g, '');
  const used = usedIn(id);
  if (used) stats['placed in'] = used;
  const stages = [stage({ id, hold: 1, title: shortName(id) }, 120, 100, 'frame 1')];
  if (T > 1) stages.push(stage({ id, range: [2, T], title: shortName(id) + ' destroyed' }, 120, 100, `frames 2–${T}`));
  if (d.shot) stages.push(shotStage(d.shot.replace(/"/g, ''), 90, 100));
  return card({ title: extra.title || shortName(id), sub: sym(id).name, stats, stages, wide: true, kind: kindOf(id) });
}

function genericCard(id, opts = {}) {
  const T = framesOf(id);
  const labs = labelsOf(id);
  const s = sym(id);
  const stats = { id, frames: T > 1 ? T : undefined, linkage: s.linkage || undefined, labels: labs.map(([n, f]) => `${n}@${f}`).join(' ') || undefined, 'placed in': usedIn(id) || undefined, ...opts.stats };
  const stages = opts.stages || [stage({ id, ...opts.spec, title: shortName(id) }, opts.w || 150, opts.h || 120)];
  return card({ title: opts.title || shortName(id), sub: s.name, stats, stages, wide: opts.wide, kind: kindOf(id) });
}

function labelCards(id, title) {
  const labs = labelsOf(id);
  const T = framesOf(id);
  if (labs.length && labs[0][1] > 1) labs.unshift(['start', 1]);
  return labs.map(([n, f], i) => {
    const end = i + 1 < labs.length ? labs[i + 1][1] - 1 : T;
    return card({
      title: `${title}: ${n}`, sub: `${sym(id).name}, frames ${f}–${end}`,
      stages: [stage({ id, range: [f, end], title: `${shortName(id)} ${n}` }, 150, 120)],
    });
  });
}

const groups = {};
for (const [id, s] of lib.symbols) {
  if (id === 0) continue;
  const folder = s.name.includes('/') ? s.name.replace(/\/[^/]*$/, '') : '(root)';
  (groups[folder] ||= []).push(id);
}
for (const g of Object.values(groups)) g.sort((a, b) => sym(a).name.localeCompare(sym(b).name, undefined, { numeric: true }));
const inFolder = (f, skip = []) => (groups[f] || []).filter((id) => !skip.includes(id));

// A level's game frame on screen_mc, as startLevel() leaves it (the Levels tab).
// Timeline depths come from tools/levels/compile.mjs: background 3, doors 10-199, collision map 200, vision 210,
// features and path nodes 211-999, boxes 1000, powerups 1001, enemies 1002.
const LEVEL_LAYERS = {
  game: { title: 'As played', show: (k, d) => ['background_mc', 'boxes_mc', 'enemies_mc', 'powerups_mc', 'entrance_mc', 'exit_mc'].includes(k.__name) || (d >= 10 && d < 200) },
};
function levelSpec(L, layer = 'game') {
  const Ly = LEVEL_LAYERS[layer];
  return {
    id: SCREEN, hold: L.frame, every: 4, maxScale: 1, title: layer === 'game' ? L.name : `${L.name} · ${Ly.title.toLowerCase()}`, bgColor: layer === 'game' ? '#626A67' : null, level: layer === 'game',
    setup: (n) => {
      // the whole level can also show the collision map and vision zones (Levels tab toggles)
      for (const k of n.children) {
        k.__visible = Ly.show(k, k._depth + 16384)
          || (layer === 'game' && ((k.__name === 'level_mc' && state.collision) || (k.__name === 'vision_mc' && state.vision)));
      }
      // boxes and enemies stop on frame 1 until destroyed; the exit waits closed
      for (const g of ['boxes_mc', 'enemies_mc']) if (n[g]) for (const k of n[g].children) if (k instanceof MovieClip && k.playing) {
        k.gotoAndStop(1);
        if (k.charId === lib.idFor('enemy assets/enemy object fire barrel') && k.core_mc) k.core_mc.__visible = false;
      }
      if (n.exit_mc && n.exit_mc.playing) n.exit_mc.gotoAndStop(1);
      if (n.entrance_mc && n.entrance_mc.playing) n.entrance_mc.gotoAndStop(n.entrance_mc._totalframes);
      if (n.powerups_mc && !n.powerups_mc.$dressed) {
        n.powerups_mc.$dressed = true;
        for (const k of n.powerups_mc.children) dressPowerup(k, lib.instanceScripts[`${k._parent.charId}:${k._depth + 16384}:${k.placed}`]);
      }
      rt.queue.length = 0;
    },
    boundsOf: (n) => n.level_mc.boundsIn(null, true),
  };
}
// ---------------------------------------------------------------- files
// The source folders as a tree: source/movie.json, source/library/** and levels/**.
const fileTree = { name: '', path: '', dirs: new Map(), files: [], count: 0 };
const fileOf = new Map(); // char id -> source path
for (const [p, id] of fileIndex.files) {
  const parts = p.split('/');
  let d = fileTree;
  d.count++;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!d.dirs.has(parts[i])) d.dirs.set(parts[i], { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [], count: 0 });
    d = d.dirs.get(parts[i]);
    d.count++;
  }
  d.files.push({ path: p, name: parts[parts.length - 1], id });
  if (id !== null && id !== undefined && (!fileOf.has(id) || p.endsWith('.json'))) fileOf.set(id, p);
}
const dirAt = (p) => {
  let d = fileTree;
  for (const part of (p || '').split('/').filter(Boolean)) { d = d.dirs.get(part); if (!d) return null; }
  return d;
};
const fileUrl = (p) => '../' + p.split('/').map(encodeURIComponent).join('/');
const GITHUB = 'https://github.com/aaronbeall/shrapnel-city/blob/main/';
const githubUrl = (p) => GITHUB + p.split('/').map(encodeURIComponent).join('/');
// decoded display name: "btn %3C%3F%3E.json" -> "btn <?>.json"
const displayName = (n) => n.replace(/%([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
const RENDERABLE = new Set(['sprite', 'shape', 'morph', 'text', 'edittext', 'button']);
const levelOfPath = (p) => {
  const m = /^levels\/(\d\d)_[^/]+\//.exec(p);
  return m ? levels[+m[1]] : null;
};

// Level files that the build places straight onto screen_mc (doors, features, path nodes,
// decor, the briefing) have no symbol of their own; give each a clip of just its contents,
// compiled the way the build does, so it can be drawn and inspected on its own.
const levelData = await fetch('../assets/levels.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
const pieceIds = new Map(); // file path -> char id
let nextPieceId = Math.max(...lib.chars.keys()) + 1;
function levelPiece(path) {
  if (pieceIds.has(path)) return pieceIds.get(path);
  let cid = null;
  const m = /^levels\/([^/]+)\/(doors|features|pathNodes|decor|briefing)\.json$/.exec(path);
  const L = m && levelData && levelData.levels.find((x) => x.folder === m[1]);
  if (L) {
    try {
      const list = L[m[2]] || [];
      const o = m[2] === 'briefing'
        ? { kind: 'sprite', frames: 1, timeline: [{ frame: 1, changes: list }] }
        : container(list, path);
      const t = decodeTimeline(o, (n) => { const v = levelData.ids[n] ?? lib.idFor(n); if (v === undefined) throw new Error(`unknown symbol "${n}"`); return v; });
      if (o.timeline[0].changes.length) {
        cid = nextPieceId++;
        const c = { id: cid, type: 'sprite', frames: t.frames, labels: t.labels, scriptFrames: t.scriptFrames, frameCount: 1 };
        lib.chars.set(cid, c);
        lib.prepare(c);
        for (const [k, text] of Object.entries(t.instances)) lib.instanceScripts[cid + ':' + k] = text;
        fileOf.set(cid, path);
      }
    } catch (err) { console.warn(path, err); }
  }
  pieceIds.set(path, cid);
  return cid;
}

// Files view options, kept in the URL: frame=<n|mid|last> holds every preview on that frame,
// size=s|m|l sets the cell size, ids=<char ids> lists exactly those characters.
const SIZES = { s: [130, 100], m: [200, 160], l: [300, 240] };
const cellSize = () => SIZES[state.size] || SIZES.s;
function frameHold(id) {
  const f = state.frame;
  if (!f) return {};
  const T = framesOf(id);
  const n = f === 'mid' ? Math.ceil(T / 2) : f === 'last' ? T : Math.min(T, Math.max(1, Math.round(+f) || 1));
  return { hold: n, static: true };
}
const FILE_CAP = 400;

function fileCard(f) {
  if ((f.id === null || f.id === undefined) && f.path.startsWith('levels/')) f = { ...f, id: levelPiece(f.path) };
  const c = f.id !== null && f.id !== undefined ? lib.get(f.id) : null;
  const name = displayName(f.name);
  const dir = f.path.replace(/\/[^/]*$/, '');
  const pieces = f.name.endsWith('.json') && dirAt(f.path.replace(/\.json$/, ''));
  const stats = {};
  let stages = [];
  let open = null;
  let kind = 'data';
  const L = levelOfPath(f.path);
  if (c && RENDERABLE.has(c.type) && f.id !== 0) {
    const s = lib.symbols.get(f.id);
    // a level file builds a generated clip; call it what the file is
    kind = L ? (f.name.endsWith('.png') ? 'bitmap' : f.name === 'briefing.json' ? 'briefing' : 'level') : kindOf(f.id);
    stats.char = f.id;
    if (c.frames && c.frames.length > 1) stats.frames = c.frames.length;
    if (s && s.linkage) stats.linkage = s.linkage;
    const spec = { id: f.id, title: name, file: f.path, kind, ...frameHold(f.id) };
    stages = [stage(spec, ...cellSize())];
    open = () => inspect(spec);
  } else if (f.name.endsWith('.png')) {
    kind = 'bitmap';
    if (c) { stats.char = f.id; stats.size = `${c.w}×${c.h}`; }
    stages = [el('figure', { class: 'stage' }, el('img', { class: 'thumb', src: fileUrl(f.path), alt: name, loading: 'lazy', style: `max-width:${cellSize()[0]}px;max-height:${cellSize()[1]}px` }))];
    open = () => window.open(fileUrl(f.path), '_blank');
  } else {
    kind = f.id === 0 ? 'timeline' : c && c.type === 'font' ? 'font' : 'data';
    if (kind === 'font') stats.char = f.id;
    stages = [el('figure', { class: 'stage missing' }, el('div', { style: `width:${cellSize()[0]}px;height:${cellSize()[1]}px` }, '{ }'))];
    open = () => window.open(fileUrl(f.path), '_blank');
  }
  if (L && f.name.endsWith('.png') && kind === 'bitmap') stats.layer = f.name === 'collision.png' ? 'collision map' : 'background';
  const cardEl = card({ title: name, sub: L ? `${L.name}` : undefined, stats, stages, kind, search: f.path.toLowerCase() });
  cardEl.classList.add('file');
  cardEl.style.width = cellSize()[0] + 18 + 'px';
  cardEl.addEventListener('click', (e) => { if (e.target.closest('a')) return; e.stopImmediatePropagation(); if (open) open(); }, { capture: true });
  if (pieces) cardEl.append(el('a', { class: 'pieces', href: '#' + new URLSearchParams({ tab: 'files', dir: pieces.path }), onclick: (e) => e.stopPropagation() }, `${plural(pieces.count, 'piece', 'pieces')} →`));
  if (state.query) cardEl.querySelector('header').append(el('p', { class: 'sub' }, dir));
  return cardEl;
}

const dirLink = (d, label) => el('a', { href: '#' + new URLSearchParams({ tab: 'files', dir: d.path }), class: 'dirlink' + (d.path === state.dir ? ' cur' : '') }, label || displayName(d.name) || 'all files');

// a symbol's pieces folder sits next to its .json; the tree leaves those out (cards link to them)
const isPiecesDir = (parent, d) => parent.files.some((f) => f.name === d.name + '.json');
function treeNode(d, depth = 0) {
  const kids = [...d.dirs.values()].filter((k) => !isPiecesDir(d, k));
  const label = [kindIcon('folder'), ' ', dirLink(d), el('small', {}, ` ${d.count}`)];
  if (!kids.length) return el('div', { class: 'leaf' }, label);
  const isOpen = depth < 1 || state.dir === d.path || state.dir.startsWith(d.path + '/');
  const det = el('details', { open: isOpen || undefined }, el('summary', {}, label));
  // build children on first open; the library has hundreds of folders
  const fill = () => { if (!det.$filled) { det.$filled = true; det.append(...kids.map((k) => treeNode(k, depth + 1))); } };
  if (isOpen) fill(); else det.addEventListener('toggle', fill, { once: true });
  return det;
}

const filesUi = {};
function buildFiles() {
  filesUi.tree = el('nav', { class: 'tree' });
  filesUi.content = el('div', { class: 'fcontent' });
  const frameIn = el('input', { type: 'text', id: 'f-frame', size: 5, placeholder: 'play', value: state.frame || '', title: 'Hold every preview on this frame: a number, mid or last. Empty plays the timelines' });
  frameIn.addEventListener('change', () => { state.frame = frameIn.value.trim(); syncFilesHash(); renderFiles(); });
  const sizeSel = el('select', { id: 'f-size', 'aria-label': 'Cell size' }, el('option', { value: 's' }, 'small'), el('option', { value: 'm' }, 'medium'), el('option', { value: 'l' }, 'large'));
  sizeSel.value = state.size || 's';
  sizeSel.addEventListener('change', () => { state.size = sizeSel.value; syncFilesHash(); renderFiles(); });
  filesUi.frameIn = frameIn; filesUi.sizeSel = sizeSel;
  filesUi.bar = el('div', { class: 'fbar' }, el('label', {}, 'frame ', frameIn), el('label', {}, 'size ', sizeSel));
  if (!fileIndex.files.length) filesUi.content.append(el('p', { class: 'muted' }, 'assets/files.json is missing: run npm run build.'));
  return el('div', { class: 'fs' }, el('aside', {}, filesUi.tree), el('div', {}, filesUi.bar, filesUi.content));
}
function renderFiles() {
  if (!filesUi.tree || !fileIndex.files.length) return;
  const d = dirAt(state.dir) || dirAt('source/library');
  state.dir = d.path;
  filesUi.tree.replaceChildren(treeNode(fileTree));
  const cur = filesUi.tree.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  const q = state.query.trim().toLowerCase();
  let body;
  const ids = state.ids ? state.ids.split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 0) : null;
  if (q || ids) {
    // flat contact sheet: every file whose path matches, or exactly the listed characters
    const hits = ids
      ? ids.map((id) => { const p = fileOf.get(id); return [p || `char ${id}`, lib.get(id) ? id : null]; })
      : fileIndex.files.filter(([p]) => p.toLowerCase().includes(q));
    const shown = state.showAll ? hits : hits.slice(0, FILE_CAP);
    const what = ids ? `ids ${ids.join(', ')}` : `“${state.query.trim()}”`;
    body = [
      el('h2', {}, what, el('small', {}, hits.length > shown.length ? `first ${shown.length} of ${hits.length} files` : plural(hits.length, 'file', 'files')),
        ids ? el('a', { class: 'clear', href: '#' + new URLSearchParams({ tab: 'files', dir: state.dir }) }, 'clear') : null),
      el('div', { class: 'grid' }, shown.map(([p, id]) => fileCard({ path: p, name: p.replace(/^.*\//, ''), id }))),
      hits.length > shown.length ? el('button', { class: 'more', onclick: () => { state.showAll = true; renderFiles(); } }, `Show all ${hits.length}`) : null,
    ];
  } else {
    const crumbs = [];
    for (let x = d; x; x = x.path ? dirAt(x.path.replace(/\/?[^/]*$/, '')) : null) {
      crumbs.unshift(dirLink(x, x.path ? displayName(x.name) : 'all files'));
      if (!x.path) break;
    }
    const sub = [...d.dirs.values()];
    // a symbol's own pieces sit in a folder named like it: list those folders with the symbol, not as folders
    const pieceDirs = new Set(d.files.filter((f) => f.name.endsWith('.json')).map((f) => f.name.replace(/\.json$/, '')));
    const plain = sub.filter((x) => !pieceDirs.has(x.name));
    body = [
      el('div', { class: 'crumbs' }, crumbs.flatMap((c, i) => (i ? [el('span', { class: 'muted' }, ' / '), c] : [c]))),
      plain.length ? el('div', { class: 'folders' }, plain.map((x) => el('a', { class: 'folder', href: '#' + new URLSearchParams({ tab: 'files', dir: x.path }) },
        el('b', {}, kindIcon('folder'), ' ', displayName(x.name)), el('small', {}, plural(x.count, 'file', 'files'))))) : null,
      d.files.length ? el('div', { class: 'grid' }, d.files.map(fileCard)) : null,
      !plain.length && !d.files.length ? el('p', { class: 'muted' }, 'Empty folder') : null,
    ];
  }
  filesUi.content.replaceChildren(...body.filter(Boolean));
  prunePreviews();
  if (state.tab === 'files') syncFilesHash();
}
function syncFilesHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const set = (k, v) => { if (v) h.set(k, v); else h.delete(k); };
  set('q', state.tab === 'files' ? state.query.trim() : '');
  set('frame', state.frame); set('size', state.size && state.size !== 's' ? state.size : ''); set('ids', state.ids);
  history.replaceState(null, '', '#' + h.toString());
}

// drop previews whose canvas left the page (the files view re-renders its folder)
function prunePreviews() {
  for (let i = all.length - 1; i >= 0; i--) {
    const p = all[i];
    if (p !== ip && !p.canvas.isConnected) { observer.unobserve(p.canvas); p.node = null; all.splice(i, 1); }
  }
}

const TABS = {
  files: {
    title: 'Files',
    build: buildFiles,
  },
  weapons: {
    title: 'Weapons',
    build: () => [
      section('Primary weapons', `${weapons1.length} guns from player.as, with HUD icon, pickup and projectile clip`, weapons1.map((w) => weaponCard(w, 1))),
      section('Secondary weapons', `${weapons2.length} bombs and missiles`, weapons2.map((w) => weaponCard(w, 2))),
      section('Enemy projectiles', 'templates on screen_mc that enemies duplicate',
        [...templates.keys()].filter((n) => /^shot_mcE[A-Z]/.test(n)).map((n) => {
          const t = templates.get(n);
          return card({ title: n.replace('shot_mc', ''), sub: n + ' → ' + sym(t.id).name, stages: [shotStage(n, 150, 110)] });
        })),
      section('Other projectile clips', 'shot templates not tied to one weapon in the tables, plus frag and shells',
        ['shot_mcBomblet', 'shot_mcDrunkRocket', 'shot_mcSmarty', 'shot_mcSpready', 'shot_mcSpreadyFader', 'shot_mcSuperPlasma', 'shrap_mc', 'scrap_mc', 'frag_mc', 'shell_mc']
          .filter((n) => templates.has(n)).map((n) => card({ title: n, sub: sym(templates.get(n).id).name, stages: [shotStage(n, 150, 110)] }))),
      section('Weapon icon sheets', 'every frame of the icon clips',
        [ICONS_PRIMARY, lib.idFor('weapon assets/wep icons primary - projectiles'), ICONS_SECONDARY].map((id) => card({
          title: shortName(id), sub: `${framesOf(id)} frames`, wide: true,
          stages: Array.from({ length: framesOf(id) }, (_, i) => stage({ id, hold: i + 1, static: true }, 56, 48, String(i + 1))),
        }))),
    ],
  },
  enemies: {
    title: 'Enemies',
    build: () => [
      section('Enemies', 'frame 1 is the live enemy; the rest of the timeline is its destruction. Stats are the defaults in each frame 1 script', ENEMIES.map((id) => aliveDeadCard(id))),
      section('Unused enemies', 'finished in the FLA but only placed on guide layers, so not in any level yet', UNUSED_ENEMIES.map((id) => aliveDeadCard(id))),
      section('New enemy designs', 'vector designs from original/art/graphics/enemies.fw.png, not wired up yet', inFolder('enemy assets/designs').map((id) => genericCard(id))),
      section('Enemy parts', 'cores, turrets and muzzle flashes the enemies are built from', inFolder('enemy assets', [...ENEMIES, ...UNUSED_ENEMIES]).map((id) => genericCard(id))),
    ],
  },
  objects: {
    title: 'Objects',
    build: () => {
      const boxes = ['box', 'box computer', 'box reactor'].map((n) => lib.idFor('game objects/' + n));
      const states = [lib.idFor('game objects/exit_mc'), lib.idFor('game objects/entrance_mc'), lib.idFor('game objects/level gate')];
      return [
        section('Destructible boxes', 'frame 1 intact, then the destruction', boxes.map((id) => aliveDeadCard(id))),
        section('Level gear', 'exits, entrances and gates by timeline label', [
          ...labelCards(states[0], 'Exit'), ...labelCards(states[2], 'Gate'),
          genericCard(states[1], { title: 'Entrance warp-in' }),
          genericCard(lib.idFor('game objects/door')),
          genericCard(lib.idFor('game objects/node'), { title: 'Path node' }),
        ]),
        section('Other game objects', null, inFolder('game objects', [...boxes, ...states, lib.idFor('game objects/door'), lib.idFor('game objects/node'), POWERUP, lib.idFor('game objects/message beacon')]).map((id) => genericCard(id))),
      ];
    },
  },
  items: {
    title: 'Items',
    build: () => {
      const inv = lib.idFor('interface/game ui/inventory item_mc');
      return [
        section('Pickups', 'the powerup clip by label; weapon pickups are on the Weapons tab', [
          card({ title: 'Health', sub: 'powerup, label health', stats: { 'powerup clips placed': usedIn(POWERUP) }, stages: [stage({ id: POWERUP, hold: 'health' }, 150, 120)] }),
          card({ title: 'Primary ammo', sub: 'powerup, label primary (Bolter)', stages: [stage({ id: POWERUP, hold: 'primary', setup: (n) => n.icons_mc && n.icons_mc.gotoAndStop(2) }, 150, 120)] }),
          card({ title: 'Secondary ammo', sub: 'powerup, label secondary (Carbon Bomb)', stages: [stage({ id: POWERUP, hold: 'secondary', setup: (n) => n.icons_mc && n.icons_mc.gotoAndStop(1) }, 150, 120)] }),
          card({ title: 'Powerup timeline', sub: `all ${framesOf(POWERUP)} frames looping`, stages: [stage({ id: POWERUP }, 150, 120)] }),
          genericCard(lib.idFor('game objects/message beacon'), { title: 'Message beacon' }),
        ]),
        section('Keys', 'inventory item clip, one label per key colour', labelCards(inv, 'Key')),
        section('Pickups placed per level', 'from the onClipEvent(load) scripts in powerups0–3', levels.map((L) => {
          const items = {};
          for (const p of L.powerups) {
            const m = /item\s*=\s*"([^"]+)"/.exec(p.script) || /item:\s*"([^"]+)"/.exec(p.script);
            const n = m ? m[1] : shortName(p.id);
            items[n] = (items[n] || 0) + 1;
          }
          return card({ title: L.name, sub: `${L.powerups.length} placed`, stats: items, stages: [] });
        })),
      ];
    },
  },
  player: {
    title: 'Player',
    build: () => {
      const P = lib.idFor('player assets/player MC');
      const fire = lib.idFor('player assets/fire_mc');
      return [
        section('Player ship', 'player MC by timeline label', [...labelCards(P, 'Ship'), genericCard(lib.idFor('player assets/ship38x37'))]),
        section('Muzzle flashes', 'fire_mc frame = the weapon table\'s fire value',
          Array.from({ length: framesOf(fire) }, (_, i) => card({
            title: `fire ${i + 1}`, sub: weapons1.filter((w) => w.fire === i + 1).map((w) => w.name).join(', ') || 'unused',
            stages: [stage({ id: fire, hold: i + 1 }, 150, 120)],
          }))),
        section('Indicator', 'popups over the ship', labelCards(lib.idFor('player assets/indicator_mc'), 'Indicator')),
        section('Ship parts', null, inFolder('player assets', [P, fire, lib.idFor('player assets/ship38x37'), lib.idFor('player assets/indicator_mc')]).map((id) => genericCard(id))),
      ];
    },
  },
  effects: {
    title: 'Effects',
    build: () => [
      section('Explosions, smoke and sparks', null, inFolder('graphic assets').map((id) => genericCard(id))),
      section('Particles and fragments', null, ['particle blue', 'particle fire', 'particle dust', 'shrap', 'shrap piece', 'star', 'warhead', 'shell', 'mort fire', 'frag_mc']
        .map((n) => lib.idFor('weapon assets/' + n)).filter((x) => x !== undefined).map((id) => genericCard(id))),
      section('Smoke and blasts', null, ['smoke', 'smokeColumn', 'blasts_mc', 'hit_mc', 'debris', 'debris gray', 'debris yellow', 'debris core']
        .map((n) => lib.idFor('game objects/' + n)).filter((x) => x !== undefined).map((id) => genericCard(id))),
      section('Warp-in cells', '37 pieces of the warp-in effect', inFolder('graphic assets/warp in assets').map((id) => genericCard(id, { w: 90, h: 70 }))),
    ],
  },
  levels: {
    title: 'Levels',
    build: () => {
      const toggle = (key, label, title) => {
        const box = el('input', { type: 'checkbox', checked: state[key] || undefined });
        box.addEventListener('change', () => {
          state[key] = box.checked;
          for (const p of all) if (p.spec.level && p.node) p.spec.setup(p.node);
          redrawAll();
        });
        return el('label', { title }, box, ' ', label);
      };
      const bar = el('div', { class: 'fbar' },
        toggle('collision', 'collision map', 'level_mc: the collision map the game draws into a BitmapData and then removes'),
        toggle('vision', 'vision zones', 'vision_mc: enemy line-of-sight zones (hidden in game)'));
      return [bar, ...levels.map((L, i) => {
        const counts = (list) => {
          const c = {};
          for (const e of list) { const n = shortName(e.id).replace(/^enemy (object )?/, ''); c[n] = (c[n] || 0) + 1; }
          return Object.entries(c).map(([n, k]) => `${n} ×${k}`).join(', ');
        };
        const folder = fileIndex.levels[i];
        const head = [L.name, el('small', {}, `screen_mc frame ${L.frame}`)];
        if (folder) head.push(el('small', {}, el('a', { class: 'hlink', href: '#' + new URLSearchParams({ tab: 'files', dir: `levels/${folder}` }) }, 'files')));
        head.push(el('small', {}, el('a', { class: 'hlink', href: `../?edit=${i}` }, 'open in level editor')));
        return el('section', {}, el('h2', {}, head),
          el('div', { class: 'grid' }, card({
            title: L.name, sub: `${plural(L.enemies.length, 'enemy', 'enemies')}, ${plural(L.boxes.length, 'box', 'boxes')}, ${plural(L.powerups.length, 'pickup', 'pickups')} (powerups also hold message beacons)`, wide: true,
            stats: { enemies: counts(L.enemies), boxes: counts(L.boxes), background: sym(L.byName.background_mc.id).name, level: sym(L.byName.level_mc.id).name },
            stages: [stage(levelSpec(L), 760, 470)],
          })));
      })];
    },
  },
  interface: {
    title: 'Interface',
    build: () => Object.keys(groups).filter((g) => g.startsWith('interface')).sort().map((g) => section(g, null, groups[g].map((id) => genericCard(id)))),
  },
};

// ---------------------------------------------------------------- page
const nav = document.getElementById('tabs');
const main = document.getElementById('main');
const built = {};
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const p = e.target.$preview;
    p.visible = e.isIntersecting;
    if (p.visible) { p.build(); p.draw(); }
  }
}, { rootMargin: '200px' });

function showTab(name) {
  if (!TABS[name]) name = 'files';
  state.tab = name;
  for (const b of nav.children) b.classList.toggle('on', b.dataset.tab === name);
  for (const [k, v] of Object.entries(built)) v.hidden = k !== name;
  if (!built[name]) {
    const pane = el('div', { class: 'pane' }, TABS[name].build());
    built[name] = pane;
    main.append(pane);
  }
  applySearch();
}
for (const [k, t] of Object.entries(TABS)) nav.append(el('button', { 'data-tab': k, onclick: () => { setHash({ tab: k, inspect: null }); } }, t.title));

function applySearch() {
  if (state.tab === 'files') { renderFiles(); return; }
  const q = state.query.trim().toLowerCase();
  const pane = built[state.tab];
  if (!pane) return;
  for (const c of pane.querySelectorAll('.card')) c.hidden = !!q && !c.dataset.search.includes(q);
  for (const s of pane.querySelectorAll('section')) s.hidden = !!q && !s.querySelector('.card:not([hidden])');
}
const searchBox = document.getElementById('search');
let searchTimer;
searchBox.addEventListener('input', (e) => {
  state.query = e.target.value;
  state.showAll = false;
  if (state.tab === 'files') { state.ids = ''; syncFilesHash(); }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applySearch, state.tab === 'files' ? 200 : 0);
});
const bgSel = document.getElementById('bg');
bgSel.value = state.bg;
bgSel.addEventListener('change', () => { state.bg = bgSel.value; redrawAll(); });
// Global playback for every preview: stop (all on frame 1), loop, or play through once and stop
const playBtns = { stop: document.getElementById('pb-stop'), loop: document.getElementById('pb-loop'), once: document.getElementById('pb-once') };
function setPlay(mode) {
  state.play = mode;
  for (const [k, b] of Object.entries(playBtns)) { b.classList.toggle('on', k === mode); b.setAttribute('aria-pressed', k === mode); }
  // stop and play-once both start from frame 1
  if (mode !== 'loop') for (const p of all) if (p !== ip) p.reset();
  else for (const p of all) p.played = 0;
  redrawAll();
}
for (const [k, b] of Object.entries(playBtns)) b.addEventListener('click', () => setPlay(k));
setPlay(state.play);
function redrawAll() { for (const p of all) if (p.visible && p.node) p.draw(); }

// ---------------------------------------------------------------- help
const help = document.getElementById('help');
document.getElementById('help-btn').addEventListener('click', () => {
  if (!help.$built) {
    help.$built = true;
    const groups = {};
    for (const [k, v] of Object.entries(KINDS)) (groups[v.group] ||= []).push([k, v]);
    help.querySelector('.hbody').append(...Object.entries(groups).map(([g, list]) => el('section', {}, el('h4', {}, g),
      el('dl', { class: 'kinds' }, list.map(([k, v]) => [el('dt', {}, kindIcon(k), ' ', v.label), el('dd', {}, v.desc)])))));
  }
  help.showModal();
});
help.querySelector('.hclose').addEventListener('click', () => help.close());
help.addEventListener('click', (e) => { if (e.target === help) help.close(); });

// ---------------------------------------------------------------- inspector
const dlg = document.getElementById('inspector');
let ip = null; // inspector preview
const ui = {
  canvas: document.getElementById('i-canvas'), title: document.getElementById('i-title'), sub: document.getElementById('i-sub'),
  play: document.getElementById('i-play'), prev: document.getElementById('i-prev'), next: document.getElementById('i-next'),
  first: document.getElementById('i-first'), last: document.getElementById('i-last'), frame: document.getElementById('i-frameno'),
  curLabel: document.getElementById('i-curlabel'), note: document.getElementById('i-tlnote'), strip: document.getElementById('i-strip'),
  loop: document.getElementById('i-loop'), speed: document.getElementById('i-speed'),
  zoom: document.getElementById('i-zoom'), boundsBox: document.getElementById('i-bounds'), info: document.getElementById('i-info'),
  kids: document.getElementById('i-kids'), file: document.getElementById('i-file'), fileHead: document.getElementById('i-file-h'), script: document.getElementById('i-script'), close: document.getElementById('i-close'),
};

function inspect(spec) {
  if (ip) { ip.node = null; all.splice(all.indexOf(ip), 1); }
  ip = new Preview({ ...spec, every: 1, static: false, range: undefined, maxScale: 8 });
  ip.canvas = ui.canvas;
  // level maps and briefings are one frame of screen_mc: hold that frame, let its clips animate
  ip.lock = spec.id === SCREEN && spec.hold !== undefined;
  ip.paused = state.play === 'stop' || (spec.hold !== undefined && !ip.lock);
  ip.build();
  if (!ip.node) return;
  ip.visible = true;
  ip.loopMode = 'all';
  if (spec.range) {
    ip.node.gotoAndStop(spec.range[0]);
    const lab = labelsOf(spec.id).find(([, f]) => f === spec.range[0]);
    if (lab) ip.loopMode = 'label:' + lab[0];
    ip.paused = state.play === 'stop';
    if (!ip.paused) ip.node.play();
    rt.queue.length = 0;
  }
  if (state.play === 'once') ip.loopMode = 'once';
  const id = spec.id, s = sym(id), node = ip.node;
  ui.title.textContent = spec.title || (lib.symbols.has(id) ? shortName(id) : charLabel(id));
  ui.sub.replaceChildren(kindTag(spec.kind || kindOf(id)), ` · ${lib.symbols.has(id) ? s.name : charLabel(id)} · char ${id}`);
  const T = node._totalframes || 1;
  buildStrip(id, T);
  const info = {
    'linkage': s.linkage, type: s.type, frames: T, bounds: ip.bounds.map((v) => v.toFixed(1)).join(', '),
    'color transform': spec.cx ? spec.cx.map((v) => +(+v).toFixed(2)).join(' ') : null,
    filters: spec.filters ? spec.filters.map((f) => f.type).join(', ') : null, blend: spec.blend,
    'placed in': usedIn(id) || null,
  };
  showSourceFile(spec.file || fileOf.get(id));
  ui.info.replaceChildren(...Object.entries(info).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => el('div', {}, el('b', {}, k), ' ', String(v))));
  ip.zoom = 0;
  ip.pan = [0, 0];
  ui.zoom.value = 0;
  ip.overlay = (ctx, m, sc) => {
    if (!ui.boundsBox.checked) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = DPR;
    ctx.strokeStyle = 'rgba(255,200,0,.8)';
    const lb = node.boundsIn(null, true);
    if (lb) ctx.strokeRect(m[4] + lb[0] * sc, m[5] + lb[2] * sc, (lb[1] - lb[0]) * sc, (lb[3] - lb[2]) * sc);
    ctx.strokeStyle = 'rgba(0,255,255,.8)';
    ctx.beginPath();
    ctx.moveTo(m[4] - 8 * DPR, m[5]); ctx.lineTo(m[4] + 8 * DPR, m[5]);
    ctx.moveTo(m[4], m[5] - 8 * DPR); ctx.lineTo(m[4], m[5] + 8 * DPR);
    ctx.stroke();
    ctx.restore();
  };
  if (!dlg.open) dlg.showModal();
  refreshInspector();
}

// a child's name: its symbol, else its source file ("enemy tank/shape 2")
function charLabel(id) {
  if (lib.symbols.has(id)) return shortName(id);
  const p = fileOf.get(id);
  return p ? displayName(p.replace(/^(source\/library|levels)\//, '').replace(/\.json$/, '').split('/').slice(-2).join('/')) : 'char' + id;
}

// the file this came from, with a link to its folder and the JSON itself
function showSourceFile(p) {
  ui.fileHead.hidden = ui.file.hidden = !p;
  if (!p) return;
  const dir = p.replace(/\/[^/]*$/, '');
  const pre = el('pre', {}, 'loading…');
  const det = el('details', {}, el('summary', {}, p.endsWith('.json') ? 'JSON' : 'file'), pre);
  det.addEventListener('toggle', async () => {
    if (!det.open || det.$loaded) return;
    det.$loaded = true;
    if (!p.endsWith('.json')) { pre.replaceWith(el('img', { class: 'thumb', src: fileUrl(p), alt: p })); return; }
    try {
      const r = await fetch(fileUrl(p));
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      const t = await r.text();
      pre.textContent = t.length > 200000 ? t.slice(0, 200000) + '\n…' : t;
    } catch (err) { pre.textContent = `couldn't load ${p}: ${err.message}`; }
  });
  ui.file.replaceChildren(
    el('div', { class: 'path' }, displayName(p)),
    el('div', {},
      el('a', { href: '#' + new URLSearchParams({ tab: 'files', dir }), onclick: () => dlg.close() }, 'show in folder'), ' · ',
      el('a', { href: githubUrl(p), target: '_blank', rel: 'noopener' }, 'GitHub')),
    det,
  );
}

function goto(f) {
  if (!ip || !ip.node || ip.lock) return;
  ip.node.gotoAndStop(Math.max(1, Math.min(ip.node._totalframes || 1, f)));
  rt.queue.length = 0;
  ip.paused = true;
  refreshInspector();
}

// ---- timeline strip: one cell per frame, label flags above, keyframes and scripts marked
// label spans: [name, first, last]
function labelSpans(id, T) {
  const labs = labelsOf(id);
  return labs.map(([n, f], i) => [n, f, i + 1 < labs.length ? labs[i + 1][1] - 1 : T]);
}
function buildStrip(id, T) {
  const c = lib.get(id);
  const spans = ip.lock ? [] : labelSpans(id, T);
  const scriptFrames = new Set((c && c.scriptFrames || []).map((f) => f + 1));
  const frames = (c && c.frames) || [];
  const cw = T > 400 ? 6 : T > 150 ? 9 : 14;
  ui.strip.style.setProperty('--cw', cw + 'px');
  ui.strip.replaceChildren();
  ui.strip.hidden = ip.lock;
  ui.loop.hidden = ip.lock;
  for (const b of [ui.first, ui.prev, ui.next, ui.last]) b.disabled = ip.lock;
  if (ip.lock) {
    ui.note.textContent = `frame ${ip.spec.hold} of screen_mc, held: play animates the clips on it`;
  } else {
    ui.note.textContent = T === 1 ? 'single frame' : '';
    const labels = el('div', { class: 'srow labels' });
    for (const [n, a, b] of spans) {
      labels.append(el('button', { class: 'flag', style: `left:${(a - 1) * cw}px;width:${(b - a + 1) * cw}px`, title: `${n}: frames ${a}–${b}. Click to loop it`,
        onclick: () => { ip.loopMode = 'label:' + n; ui.loop.value = ip.loopMode; goto(a); } }, n));
    }
    const cells = el('div', { class: 'srow cells' });
    const nums = el('div', { class: 'srow nums' });
    for (let f = 1; f <= T; f++) {
      const ops = frames[f - 1] || [];
      const key = ops.some((o) => o.op !== 'move' && o.op !== 'update' && !(o.op === 'place' && o.move && !o.id));
      const cell = el('span', { class: 'cell' + (key ? ' key' : ops.length ? ' tw' : '') + (scriptFrames.has(f) ? ' sc' : '') + (spans.some(([, a]) => a === f) ? ' lb' : ''), 'data-f': f });
      cells.append(cell);
      if (f === 1 || f % (cw < 10 ? 10 : 5) === 0) nums.append(el('span', { style: `left:${(f - 1) * cw}px` }, f));
    }
    ui.strip.append(...(spans.length ? [labels] : []), cells, nums);
    ui.strip.style.setProperty('--w', T * cw + 'px');
    const pick = (e) => {
      const r = cells.getBoundingClientRect();
      goto(Math.floor((e.clientX - r.left) / cw) + 1);
    };
    cells.addEventListener('pointerdown', (e) => { pick(e); cells.setPointerCapture(e.pointerId); cells.$drag = true; });
    cells.addEventListener('pointermove', (e) => { if (cells.$drag) pick(e); });
    cells.addEventListener('pointerup', () => { cells.$drag = false; });
  }
  ui.loop.replaceChildren(el('option', { value: 'all' }, 'loop whole timeline'), el('option', { value: 'once' }, 'play once'),
    ...spans.map(([n, a, b]) => el('option', { value: 'label:' + n }, `loop “${n}” (${a}–${b})`)));
  ui.loop.value = ip.loopMode;
  ui.loop.disabled = T === 1;
}
// keep playback inside the chosen label
function applyLoop() {
  if (!ip || !ip.node || ip.lock) return;
  const T = ip.node._totalframes || 1;
  const m = /^label:(.*)$/.exec(ip.loopMode);
  const span = m && labelSpans(ip.spec.id, T).find(([n]) => n === m[1]);
  ip.spec.range = span ? [span[1], span[2]] : undefined;
  const f = ip.node._currentframe;
  if (span && (f < span[1] || f > span[2])) { ip.node.gotoAndStop(span[1]); if (!ip.paused) ip.node.play(); rt.queue.length = 0; }
}

function refreshInspector() {
  if (!ip || !ip.node) return;
  const node = ip.node, f = node._currentframe || 1, T = node._totalframes || 1;
  ui.frame.textContent = ip.lock ? '' : `frame ${f} / ${T}`;
  const span = ip.lock ? null : labelSpans(ip.spec.id, T).filter(([, a]) => a <= f).pop();
  ui.curLabel.textContent = span ? `“${span[0]}”` : '';
  ui.curLabel.hidden = !span;
  ui.play.textContent = ip.paused ? '▶' : '❚❚';
  ui.play.title = (ip.paused ? 'Play' : 'Pause') + ' (space)';
  for (const c of ui.strip.querySelectorAll('.cell.cur')) c.classList.remove('cur');
  const cur = ui.strip.querySelector(`.cell[data-f="${f}"]`);
  if (cur) {
    cur.classList.add('cur');
    const sl = ui.strip.scrollLeft, x = cur.offsetLeft;
    if (x < sl || x > sl + ui.strip.clientWidth - 20) ui.strip.scrollLeft = x - ui.strip.clientWidth / 2;
  }
  const kids = node.children || [];
  ui.kids.replaceChildren(...kids.map((k) => {
    const kname = k.__name && !/^instance\d+$/.test(k.__name) ? k.__name : '';
    const label = `${k._depth + 16384} ${kname ? kname + ' · ' : ''}${k.charId >= 0 ? charLabel(k.charId) : 'empty'}`;
    return el('li', {}, k.charId >= 0 && (lib.symbols.has(k.charId) || fileOf.has(k.charId))
      ? el('a', { href: '#', onclick: (e) => { e.preventDefault(); setHash({ inspect: k.charId }); } }, label) : label,
    k instanceof MovieClip && k._totalframes > 1 ? el('small', {}, ` f${k._currentframe}/${k._totalframes}`) : null);
  }));
  const scripts = sym(ip.spec.id).scripts || {};
  const inst = ip.spec.instKey ? lib.instanceScripts[ip.spec.instKey] : null;
  const keys = Object.keys(scripts).map(Number).sort((a, b) => a - b);
  ui.script.replaceChildren(
    ...(inst ? [el('h4', {}, 'instance script'), el('pre', {}, inst)] : []),
    ...keys.map((k) => el('details', { open: k === f || keys.length === 1 || undefined }, el('summary', { class: k === f ? 'cur' : '' }, `frame ${k}`), el('pre', {}, scripts[k]))),
  );
  if (!keys.length && !inst) ui.script.replaceChildren(el('p', { class: 'muted' }, 'No scripts'));
  ip.draw();
}

ui.play.addEventListener('click', () => {
  if (!ip || !ip.node) return;
  ip.paused = !ip.paused;
  if (!ip.lock && ip.node.play) {
    // play once from the end starts over
    if (!ip.paused && ip.loopMode === 'once' && ip.node._currentframe >= ip.node._totalframes) ip.node.gotoAndStop(1);
    if (ip.paused) ip.node.stop(); else ip.node.play();
    applyLoop();
    rt.queue.length = 0;
  }
  refreshInspector();
});
const span0 = () => { const m = /^label:(.*)$/.exec(ip.loopMode); return m && labelSpans(ip.spec.id, ip.node._totalframes || 1).find(([n]) => n === m[1]); };
ui.first.addEventListener('click', () => { if (ip) { const s0 = span0(); goto(s0 ? s0[1] : 1); } });
ui.last.addEventListener('click', () => { if (ip) { const s0 = span0(); goto(s0 ? s0[2] : ip.node._totalframes); } });
ui.prev.addEventListener('click', () => ip && goto(ip.node._currentframe - 1));
ui.next.addEventListener('click', () => ip && goto(ip.node._currentframe + 1));
ui.loop.addEventListener('change', () => { if (ip) { ip.loopMode = ui.loop.value; applyLoop(); refreshInspector(); } });
ui.zoom.addEventListener('input', () => { if (ip) { ip.zoom = +ui.zoom.value ? Math.pow(2, +ui.zoom.value - 3) : 0; ip.draw(); } });
ui.boundsBox.addEventListener('change', () => ip && ip.draw());
ui.close.addEventListener('click', () => dlg.close());
dlg.addEventListener('close', () => { if (location.hash.includes('inspect')) setHash({ inspect: null }); });
let drag = null;
ui.canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; ui.canvas.setPointerCapture(e.pointerId); });
ui.canvas.addEventListener('pointermove', (e) => {
  if (!drag || !ip || !ip.view) return;
  const k = DPR / ip.view.s;
  ip.pan[0] -= (e.clientX - drag[0]) * k; ip.pan[1] -= (e.clientY - drag[1]) * k;
  drag = [e.clientX, e.clientY];
  ip.draw();
});
ui.canvas.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('keydown', (e) => {
  if (!dlg.open || !ip) return;
  if (e.key === ' ') { e.preventDefault(); ui.play.click(); }
  if (e.target.closest && e.target.closest('select, input')) return;
  if (e.key === 'ArrowLeft') ui.prev.click();
  if (e.key === 'ArrowRight') ui.next.click();
  if (e.key === 'Home') ui.first.click();
  if (e.key === 'End') ui.last.click();
});

// ---------------------------------------------------------------- routing
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  let tab = h.get('tab') || state.tab;
  if (tab === 'library') tab = 'files'; // the old Library tab is now the Files view
  return { tab, inspect: h.get('inspect'), dir: h.get('dir'), q: h.get('q'), frame: h.get('frame'), size: h.get('size'), ids: h.get('ids') };
}
function setHash(ch) {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const [k, v] of Object.entries(ch)) { if (v === null) h.delete(k); else h.set(k, v); }
  location.hash = h.toString();
}
function route() {
  const { tab, inspect: insp, dir, q, frame, size, ids } = readHash();
  let dirChanged = tab === 'files' && dir !== null && dir !== state.dir;
  if (dirChanged) { state.dir = dir; state.query = ''; state.ids = ''; state.showAll = false; }
  if (tab === 'files') {
    const opts = { query: q ?? (dirChanged ? '' : state.query), frame: frame ?? (state.frame || ''), size: size ?? (state.size || ''), ids: ids ?? (dirChanged ? '' : state.ids) };
    for (const [k, v] of Object.entries(opts)) if (state[k] !== v) { state[k] = v; dirChanged = true; }
    searchBox.value = state.query;
    if (filesUi.frameIn) { filesUi.frameIn.value = state.frame; filesUi.sizeSel.value = state.size || 's'; }
  }
  if (tab !== state.tab || !built[tab]) showTab(tab);
  else if (dirChanged) renderFiles();
  if (insp !== null && lib.get(+insp)) inspect({ id: +insp });
  else if (dlg.open) dlg.close();
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(250, now - last);
  last = now;
  const step = 1000 / FPS;
  if (acc >= step) {
    acc %= step;
    if (state.play !== 'stop') {
      for (const p of all) {
        if (!p.visible || !p.node || p === ip) continue;
        if (dlg.open) continue;
        if (state.play === 'once' && p.played >= p.length - 1) continue;
        p.played++;
        p.tickN++;
        p.tick();
        if (p.tickN % (p.spec.every || 1) === 0) p.draw();
      }
    }
    if (ip && dlg.open && ip.node && !ip.paused) {
      ip.acc = (ip.acc || 0) + (+ui.speed.value || 1);
      const f = ip.node._currentframe;
      for (; ip.acc >= 1; ip.acc--) {
        if (!ip.lock && ip.loopMode === 'once' && ip.node._currentframe >= ip.node._totalframes) { ip.paused = true; ip.node.stop(); break; }
        ip.tick();
      }
      if (ip.node._currentframe !== f || ip.paused) refreshInspector(); else ip.draw();
    }
  }
  requestAnimationFrame(loop);
}
route();
status.textContent = `${lib.symbols.size} symbols · ${weapons1.length + weapons2.length} weapons · ${ENEMIES.length} enemies`;
requestAnimationFrame(loop);
window.explorer = { rt, all, showTab, inspect, levels, templates };
document.documentElement.dataset.ready = '1';

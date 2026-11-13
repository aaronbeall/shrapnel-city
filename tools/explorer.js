// Asset explorer: every weapon, enemy, object, item and effect in the game,
// drawn live by the port's own runtime and renderer. Timelines play without
// running the game's ActionScript, so each clip shows exactly what its
// frames contain. Click any card to open the inspector.
import { Runtime } from '../src/flash/runtime.js';
import { MovieClip, SimpleButton, TextField } from '../src/flash/display.js';
import { mul } from '../src/flash/geom.js';

const params = new URLSearchParams(location.search);
const rt = new Runtime(document.createElement('canvas'), { base: '../assets/' });
const status = document.getElementById('status');
await rt.load((p) => { status.textContent = `loading art… ${Math.round(p * 100)}%`; });
const lib = rt.lib;
const R = rt.renderer;
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
const LEVEL_NAMES = ['00 Training', '01 Drop Zone', '02 First Block', '03 Bridge'];
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
const state = { bg: params.get('bg') || 'dark', paused: false, tab: 'weapons', query: '' };
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

function card({ title, sub, stages, stats, tags, search, wide }) {
  const c = el('article', { class: 'card' + (wide ? ' wide' : '') },
    el('div', { class: 'stages' }, stages),
    el('header', {}, el('h3', {}, title), sub ? el('p', { class: 'sub' }, sub) : null),
    tags && tags.length ? el('div', { class: 'tags' }, tags.map((t) => el('span', { class: 'tag' }, t))) : null,
    stats ? el('dl', {}, Object.entries(stats).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))])) : null,
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
  return card({ title: extra.title || shortName(id), sub: sym(id).name, stats, stages, wide: true });
}

function genericCard(id, opts = {}) {
  const T = framesOf(id);
  const labs = labelsOf(id);
  const s = sym(id);
  const stats = { id, frames: T > 1 ? T : undefined, linkage: s.linkage || undefined, labels: labs.map(([n, f]) => `${n}@${f}`).join(' ') || undefined, 'placed in': usedIn(id) || undefined, ...opts.stats };
  const stages = opts.stages || [stage({ id, ...opts.spec, title: shortName(id) }, opts.w || 150, opts.h || 120)];
  return card({ title: opts.title || shortName(id), sub: s.name, stats, stages, wide: opts.wide });
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

const TABS = {
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
      section('Enemy parts', 'cores, turrets and muzzle flashes the enemies are built from', inFolder('enemy assets', ENEMIES).map((id) => genericCard(id))),
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
    build: () => levels.map((L) => {
      const counts = (list) => {
        const c = {};
        for (const e of list) { const n = shortName(e.id).replace(/^enemy (object )?/, ''); c[n] = (c[n] || 0) + 1; }
        return Object.entries(c).map(([n, k]) => `${n} ×${k}`).join(', ');
      };
      const parts = ['background_mc', 'level_mc', 'boxes_mc', 'enemies_mc', 'powerups_mc', 'entrance_mc', 'exit_mc'];
      const spec = {
        id: SCREEN, hold: L.frame, every: 4, maxScale: 1, title: L.name, bgColor: '#626A67',
        setup: (n) => {
          // as startLevel() leaves it: collision map and vision zones hidden, pickups dressed
          for (const k of n.children) {
            if (k.__name === 'level_mc') k.__visible = !!state.collision;
            else if (k.__name === 'vision_mc') k.__visible = !!state.vision;
            else if (!parts.includes(k.__name)) k.__visible = false;
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
      return el('section', {}, el('h2', {}, L.name, el('small', {}, `screen_mc frame ${L.frame}`)),
        el('div', { class: 'grid' }, card({
          title: L.name, sub: `${plural(L.enemies.length, 'enemy', 'enemies')}, ${plural(L.boxes.length, 'box', 'boxes')}, ${plural(L.powerups.length, 'pickup', 'pickups')} (powerups0–3 also hold message beacons)`, wide: true,
          stats: { enemies: counts(L.enemies), boxes: counts(L.boxes), background: sym(L.byName.background_mc.id).name, level: sym(L.byName.level_mc.id).name },
          stages: [stage(spec, 760, 470)],
        })));
    }),
  },
  interface: {
    title: 'Interface',
    build: () => Object.keys(groups).filter((g) => g.startsWith('interface')).sort().map((g) => section(g, null, groups[g].map((id) => genericCard(id)))),
  },
  library: {
    title: 'Library',
    build: () => Object.keys(groups).sort().map((g) => section(g, `${groups[g].length} symbols`, groups[g].map((id) => genericCard(id, { w: 130, h: 100 })))),
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
  if (!TABS[name]) name = 'weapons';
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
  const q = state.query.trim().toLowerCase();
  const pane = built[state.tab];
  if (!pane) return;
  for (const c of pane.querySelectorAll('.card')) c.hidden = !!q && !c.dataset.search.includes(q);
  for (const s of pane.querySelectorAll('section')) s.hidden = !!q && !s.querySelector('.card:not([hidden])');
}
document.getElementById('search').addEventListener('input', (e) => { state.query = e.target.value; applySearch(); });
const bgSel = document.getElementById('bg');
bgSel.value = state.bg;
bgSel.addEventListener('change', () => { state.bg = bgSel.value; redrawAll(); });
const pauseBtn = document.getElementById('pause');
pauseBtn.addEventListener('click', () => { state.paused = !state.paused; pauseBtn.textContent = state.paused ? 'Play all' : 'Pause all'; });
for (const key of ['vision', 'collision']) {
  const box = document.getElementById(key);
  box.addEventListener('change', () => {
    state[key] = box.checked;
    for (const p of all) if (p.spec.id === SCREEN && p.node) p.spec.setup(p.node);
    redrawAll();
  });
}
function redrawAll() { for (const p of all) if (p.visible && p.node) p.draw(); }

// ---------------------------------------------------------------- inspector
const dlg = document.getElementById('inspector');
let ip = null; // inspector preview
const ui = {
  canvas: document.getElementById('i-canvas'), title: document.getElementById('i-title'), sub: document.getElementById('i-sub'),
  play: document.getElementById('i-play'), prev: document.getElementById('i-prev'), next: document.getElementById('i-next'),
  slider: document.getElementById('i-frame'), frame: document.getElementById('i-frameno'), labels: document.getElementById('i-labels'),
  zoom: document.getElementById('i-zoom'), boundsBox: document.getElementById('i-bounds'), info: document.getElementById('i-info'),
  kids: document.getElementById('i-kids'), script: document.getElementById('i-script'), close: document.getElementById('i-close'),
};

function inspect(spec) {
  if (ip) { ip.node = null; all.splice(all.indexOf(ip), 1); }
  ip = new Preview({ ...spec, every: 1, static: false, range: undefined, maxScale: 8 });
  ip.canvas = ui.canvas;
  ip.paused = spec.hold !== undefined;
  ip.build();
  if (!ip.node) return;
  ip.visible = true;
  if (spec.range) { ip.node.gotoAndStop(spec.range[0]); ip.paused = false; ip.node.play(); rt.queue.length = 0; }
  const id = spec.id, s = sym(id), node = ip.node;
  ui.title.textContent = spec.title || shortName(id);
  ui.sub.textContent = `${s.name} · char ${id} · ${lib.get(id).type}`;
  const T = node._totalframes || 1;
  ui.slider.max = T;
  ui.labels.replaceChildren(...labelsOf(id).map(([n, f]) => el('button', { onclick: () => { goto(f); } }, `${n} @${f}`)));
  ui.labels.hidden = !ui.labels.children.length;
  const info = {
    'linkage': s.linkage, type: s.type, frames: T, bounds: ip.bounds.map((v) => v.toFixed(1)).join(', '),
    'color transform': spec.cx ? spec.cx.map((v) => +(+v).toFixed(2)).join(' ') : null,
    filters: spec.filters ? spec.filters.map((f) => f.type).join(', ') : null, blend: spec.blend,
    'placed in': usedIn(id) || null,
  };
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

function goto(f) {
  if (!ip || !ip.node) return;
  ip.node.gotoAndStop(f);
  rt.queue.length = 0;
  ip.paused = true;
  refreshInspector();
}

function refreshInspector() {
  if (!ip || !ip.node) return;
  const node = ip.node, f = node._currentframe || 1;
  ui.slider.value = f;
  ui.frame.textContent = `${f} / ${node._totalframes || 1}`;
  ui.play.textContent = ip.paused ? '▶' : '❚❚';
  const kids = node.children || [];
  ui.kids.replaceChildren(...kids.map((k) => {
    const kname = k.__name && !/^instance\d+$/.test(k.__name) ? k.__name : '';
    const label = `${k._depth + 16384} ${kname ? kname + ' · ' : ''}${k.charId >= 0 ? shortName(k.charId) : 'empty'}`;
    return el('li', {}, k.charId >= 0 && lib.symbols.has(k.charId)
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
  if (!ip) return;
  ip.paused = !ip.paused;
  if (ip.node.play) { if (ip.paused) ip.node.stop(); else ip.node.play(); }
  refreshInspector();
});
ui.prev.addEventListener('click', () => ip && goto(Math.max(1, ip.node._currentframe - 1)));
ui.next.addEventListener('click', () => ip && goto(Math.min(ip.node._totalframes, ip.node._currentframe + 1)));
ui.slider.addEventListener('input', () => goto(+ui.slider.value));
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
  if (e.key === 'ArrowLeft') ui.prev.click();
  if (e.key === 'ArrowRight') ui.next.click();
});

// ---------------------------------------------------------------- routing
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { tab: h.get('tab') || state.tab, inspect: h.get('inspect') };
}
function setHash(ch) {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const [k, v] of Object.entries(ch)) { if (v === null) h.delete(k); else h.set(k, v); }
  location.hash = h.toString();
}
function route() {
  const { tab, inspect: insp } = readHash();
  if (tab !== state.tab || !built[tab]) showTab(tab);
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
    if (!state.paused) {
      for (const p of all) {
        if (!p.visible || !p.node || p === ip) continue;
        if (dlg.open) continue;
        p.tickN++;
        p.tick();
        if (p.tickN % (p.spec.every || 1) === 0) p.draw();
      }
    }
    if (ip && dlg.open && ip.node) {
      const f = ip.node._currentframe;
      ip.tick();
      if (ip.node._currentframe !== f) refreshInspector(); else ip.draw();
    }
  }
  requestAnimationFrame(loop);
}
route();
status.textContent = `${lib.symbols.size} symbols · ${weapons1.length + weapons2.length} weapons · ${ENEMIES.length} enemies`;
requestAnimationFrame(loop);
window.explorer = { rt, all, showTab, inspect, levels, templates };
document.documentElement.dataset.ready = '1';

// In-game level editor. Toggle with backtick (`) or open the page with ?edit.
//
// It edits the level data from levels/ (shipped in assets/levels.json), recompiles the
// level in the browser and restarts it, so the view is the real game paused on the
// level's first frame. Save writes each changed file back to levels/<NN_name>/ when the
// page is served by `npm run edit`, and downloads the files otherwise.
import { LevelApplier, restartLevel } from './apply.js';
import { CollisionMap, COLOURS } from './collision.js';
import { renderPreview } from './preview.js';
import { DEPTH, LAYERS, isRef, isTrigger, triggerNames, zonePath } from '../../tools/levels/compile.mjs';
import { pretty } from '../../tools/flash-source/format.mjs';
import { mul } from '../flash/geom.js';

const PLACE_LAYERS = ['enemies', 'boxes', 'powerups', 'doors', 'features'];
const DATA_LAYERS = [...PLACE_LAYERS, 'vision'];
const VIEW_LAYERS = [
  { key: 'art', label: 'Background art' },
  { key: 'collision', label: 'Collision' },
  { key: 'vision', label: 'Vision zones' },
  { key: 'enemies', label: 'Enemies' },
  { key: 'boxes', label: 'Boxes' },
  { key: 'powerups', label: 'Pickups' },
  { key: 'doors', label: 'Doors' },
  { key: 'features', label: 'Entrance, exit, player' },
  { key: 'paths', label: 'Path nodes' },
  { key: 'preview', label: 'Art preview', hot: 'A' },
];
// what each kind of placement does when it sends triggers
const TRIGGER_EVENTS = { powerups: ['onPickup', 'when picked up'], boxes: ['onDie', 'when destroyed'], enemies: ['onDie', 'when killed'] };
// ready-made placements offered in the palette beside the symbols
const PRESETS = {
  powerups: [{ label: 'trigger pad', symbol: 'game objects/powerup', props: { type: 'trigger', item: '' } }],
};
const ZONE_COLOURS = ['#ff0000', '#990000', '#cc9966', '#cc6633', '#9999cc', '#9966ff', '#ccff33', '#cc6699', '#cc9933', '#cccc66', '#cc3366'];
const AUTO_VISION_ANGLES = 90, LOS_SAMPLE_SIZE = 15; // as2/enemyTurret.as
const NODE_LOS_SAMPLE = 10; // as2/pathNode.as
// extra symbols offered in the place palette besides those already used in a level
const EXTRA = {
  enemies: ['enemy assets/enemy tank', 'enemy assets/enemy drone', 'enemy assets/enemy missile launcher'],
  boxes: ['game objects/box'],
  powerups: ['game objects/powerup', 'game objects/message beacon'],
  doors: ['game objects/door', 'game objects/level gate'],
  features: ['game objects/node', 'game objects/entrance_mc', 'game objects/exit_mc'],
};
const NODE = 'game objects/node';
// path nodes are stored in features.json but edited as their own layer
const dataLayer = (l) => (l === 'paths' ? 'features' : l);
const T = (d) => d - 16384; // timeline depths sit 16384 below script depths, as in Flash
const TOOLS = [
  { key: 'select', label: 'Select', hot: 'V', tip: 'click to select, drag to move (Shift snaps to the grid); R rotates, Delete removes, Ctrl+D duplicates' },
  { key: 'place', label: 'Place', hot: 'P', tip: 'pick a symbol below, then click to drop one' },
  { key: 'link', label: 'Path links', hot: 'N', tip: 'nodes link to every node of their colour they can see (dashed). Click a node, then another: that adds the link, or removes it if they were linked. Changed nodes keep their links pinned (solid)' },
  { key: 'rect', label: 'Rectangle', hot: 'B', tip: 'drag a box; snaps to the grid (hold Alt for free)' },
  { key: 'poly', label: 'Polygon', hot: 'G', tip: 'click corners, angles snap (hold Shift for free); click the first corner or Enter to close, Esc cancels. On the vision layer it draws a zone' },
  { key: 'autozone', label: 'Auto zone', hot: 'Z', tip: 'click a spot to make a vision zone of what can be seen from there, the way the game does for an enemy outside every zone' },
  { key: 'pencil', label: 'Pencil', hot: 'D', tip: 'paint pixels; [ and ] change the size' },
  { key: 'eraser', label: 'Eraser', hot: 'E', tip: 'paint open floor; [ and ] change the size' },
  { key: 'fill', label: 'Fill', hot: 'F', tip: 'flood-fill one colour region' },
];
const DRAW_TOOLS = new Set(['rect', 'poly', 'pencil', 'eraser', 'fill']);
const ZONE_TOOLS = new Set(['select', 'poly', 'autozone']);

let editor = null;

export async function toggle(rt) {
  if (!editor) {
    const data = await fetch('assets/levels.json', { cache: 'no-store' }).then((r) => r.json());
    const writable = await fetch('__editor', { cache: 'no-store' }).then((r) => r.ok && r.json()).then((j) => !!(j && j.writable)).catch(() => false);
    editor = new Editor(rt, data, writable);
    window.levelEditor = editor; // handy from the console
  }
  if (editor.isOpen) editor.close(); else await editor.open();
}

class Editor {
  constructor(rt, data, writable) {
    this.rt = rt;
    this.writable = writable;
    this.applier = new LevelApplier(rt, data);
    this.levels = data.levels.map((L) => structuredClone(L));
    this.maps = {};          // level index -> CollisionMap
    this.dirty = {};         // level index -> Set of file names
    this.undoStack = [];
    this.redoStack = [];
    this.index = 0;
    this.tool = 'select';
    this.active = 'enemies'; // layer that select/place work on
    this.visible = Object.fromEntries(VIEW_LAYERS.map((l) => [l.key, l.key !== 'vision' && l.key !== 'preview']));
    this.mapVersion = 0;     // bumps when a collision map or the live level changes
    this.preview = null;     // {index, version, canvas} art preview
    this.colour = 'wall';
    this.brush = 1;
    this.grid = 16;
    this.snapGrid = true;
    this.snapAngle = 15;
    this.sel = null;         // {layer, k}
    this.placeSymbol = null;
    this.poly = null;        // polygon in progress: [[x, y], ...]
    this.view = { z: 1, ox: 0, oy: 0 };
    this.mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    this.stale = false;      // collision changed since the art was baked
    this.needsReload = false;
    this.isOpen = false;
    this.buildDom();
  }

  get L() { return this.levels[this.index]; }
  get map() {
    const i = this.index;
    if (!this.maps[i]) this.maps[i] = new CollisionMap(this.rt.lib.images.get(this.applier.id(`level assets/level${i}/shape 1/bitmap 1`)));
    return this.maps[i];
  }
  get screen() { return this.rt.root.screen_mc; }

  // ------------------------------------------------------------------ open / close
  async open() {
    const rt = this.rt, G = rt.env.G;
    for (let i = 0; i < 600 && typeof G.gotoLevel !== 'function'; i++) await new Promise((r) => requestAnimationFrame(r));
    const s = this.screen;
    let idx = +(new URLSearchParams(location.search).get('edit') || NaN);
    if (!(idx >= 0 && idx < this.levels.length)) idx = s && s._currentframe > 0 ? Math.min(this.levels.length - 1, Math.floor((s._currentframe - 1) / 2)) : 0;
    this.isOpen = window.levelEditorOpen = true;
    rt.paused = true;
    this.root.style.display = '';
    this.loadLevel(idx);
    this.fitView();
    this.loop();
  }

  close() {
    if (this.needsReload) this.reload();
    this.isOpen = window.levelEditorOpen = false;
    this.root.style.display = 'none';
    this.rt.paused = false;
    this.rt.canvas.focus();
  }

  // recompile every level from the editor's data and restart the current one
  reload() {
    const images = {};
    for (const [i, m] of Object.entries(this.maps)) images[i] = m.canvas;
    try {
      this.applier.apply(this.levels, images);
      restartLevel(this.rt, this.index);
      this.status('');
    } catch (e) {
      console.error(e);
      this.status('Could not rebuild the level: ' + e.message, true);
    }
    this.needsReload = false;
  }

  loadLevel(i) {
    this.index = i;
    this.sel = null;
    this.poly = null;
    this.reload();
    this.refreshPanel();
  }

  fitView() {
    const r = this.canvas.getBoundingClientRect();
    const { w, h } = this.L.size;
    const z = Math.min((r.width - 300) / w, r.height / h) * 0.95;
    this.view = { z, ox: (r.width - 300 - w * z) / 2, oy: (r.height - h * z) / 2 };
  }

  // ------------------------------------------------------------------ data helpers
  list(layer) { return this.L[layer] || (this.L[layer] = []); }

  markDirty(file, i = this.index) {
    (this.dirty[i] ||= new Set()).add(file);
    this.refreshSave();
  }

  snapshot() { return JSON.stringify({ ...Object.fromEntries(DATA_LAYERS.map((l) => [l, this.L[l] || []])), settings: this.L.settings }); }

  // run a data change with undo, then rebuild the level
  change(files, fn, { reload = true } = {}) {
    const before = this.snapshot();
    fn();
    const after = this.snapshot();
    if (before === after) return;
    this.pushUndo({ type: 'data', level: this.index, before, after, files });
    for (const f of files) this.markDirty(f);
    if (reload) this.reload();
    else this.needsReload = true;
    this.refreshPanel();
  }

  restoreData(json) {
    const o = JSON.parse(json);
    for (const k of DATA_LAYERS) this.L[k] = o[k];
    this.L.settings = o.settings;
  }

  pushUndo(e) { this.undoStack.push(e); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack.length = 0; }

  undo(redo = false) {
    const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack;
    const e = from.pop();
    if (!e) return;
    to.push(e);
    if (e.level !== this.index) this.loadLevel(e.level);
    if (e.type === 'data') {
      this.restoreData(redo ? e.after : e.before);
      for (const f of e.files) this.markDirty(f);
      this.sel = null;
      this.reload();
    } else {
      this.map.restore(redo ? e.after : e.before);
      this.collisionChanged();
    }
    this.refreshPanel();
  }

  collisionChanged() {
    this.markDirty('collision.png');
    this.stale = true;
    this.needsReload = true;
    this.mapVersion++;
    this.refreshPanel();
  }

  // live clip for a placement, if the game still has it
  clipFor(layer, k) {
    const s = this.screen;
    if (!s) return null;
    let c = null;
    if (LAYERS.includes(layer)) c = s[layer + '_mc'] && s[layer + '_mc'].byDepth.get(T(k + 1));
    else if (layer === 'doors') c = s.byDepth.get(T(DEPTH.doors + k));
    else if (layer === 'features') c = s.byDepth.get(T(DEPTH.features + k));
    else if (layer === 'vision') c = s.vision_mc && s.vision_mc.byDepth.get(T(2 * k + 1));
    return c && !c.removed ? c : null;
  }

  boundsOf(layer, k) {
    const e = this.list(layer)[k];
    const c = this.clipFor(layer, k);
    if (c) {
      const b = c.getBounds(this.screen);
      if (b.xMax - b.xMin < 1e6 && b.xMax > b.xMin) {
        const pad = 2;
        return [Math.min(b.xMin, e.x - 6) - pad, Math.min(b.yMin, e.y - 6) - pad, Math.max(b.xMax, e.x + 6) + pad, Math.max(b.yMax, e.y + 6) + pad];
      }
    }
    return [e.x - 8, e.y - 8, e.x + 8, e.y + 8];
  }

  isNode(e) { return e && e.symbol === NODE; }
  layerShown(layer, e) {
    if (layer === 'vision') return this.visible.vision && this.active === 'vision';
    if (layer === 'features') return this.isNode(e) ? this.visible.paths : (e.name === 'vision_mc' ? false : this.visible.features);
    return this.visible[layer];
  }

  hit(x, y) {
    if (this.active === 'vision' && this.visible.vision) {
      const zones = this.list('vision');
      for (let k = zones.length - 1; k >= 0; k--) if (this.inZone(zones[k], x, y)) return { layer: 'vision', k };
    }
    if (this.active === 'paths' && this.visible.paths) {
      const f = this.list('features');
      for (let k = f.length - 1; k >= 0; k--) {
        if (!this.isNode(f[k])) continue;
        const [x0, y0, x1, y1] = this.boundsOf('features', k);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { layer: 'features', k };
      }
    }
    const a = dataLayer(this.active);
    const order = [a, ...PLACE_LAYERS.filter((l) => l !== a)].filter((l) => PLACE_LAYERS.includes(l));
    for (const layer of order) {
      const list = this.list(layer);
      for (let k = list.length - 1; k >= 0; k--) {
        if (!this.layerShown(layer, list[k])) continue;
        const [x0, y0, x1, y1] = this.boundsOf(layer, k);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { layer, k };
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ coordinates
  toWorld(sx, sy) { const v = this.view; return [(sx - v.ox) / v.z, (sy - v.oy) / v.z]; }
  snap(x, y, alt) {
    if (!this.snapGrid || alt || !this.grid) return [x, y];
    const g = this.grid;
    return [Math.round(x / g) * g, Math.round(y / g) * g];
  }
  snapAngleFrom(p, x, y, free) {
    if (free || !this.snapAngle) return [x, y];
    const dx = x - p[0], dy = y - p[1];
    const len = Math.hypot(dx, dy);
    const step = this.snapAngle * Math.PI / 180;
    const a = Math.round(Math.atan2(dy, dx) / step) * step;
    return [p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len];
  }

  // ------------------------------------------------------------------ input
  onKey(e) {
    if (e.key === '`') { e.preventDefault(); this.close(); return; }
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); this.undo(e.shiftKey); return; }
    if (mod && k === 'y') { e.preventDefault(); this.undo(true); return; }
    if (mod && k === 's') { e.preventDefault(); this.save(); return; }
    if (mod && k === 'd') { e.preventDefault(); this.duplicate(); return; }
    if (mod) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const order = [...PLACE_LAYERS, 'paths', 'vision', 'collision'];
      this.pickLayer(order[(order.indexOf(this.active) + (e.shiftKey ? order.length - 1 : 1)) % order.length]);
      return;
    }
    if (/^[1-9]$/.test(e.key)) { const l = VIEW_LAYERS[+e.key - 1]; if (l) { this.visible[l.key] = !this.visible[l.key]; this.refreshPanel(); } return; }
    const tool = TOOLS.find((t) => t.hot.toLowerCase() === k);
    if (tool) { this.setTool(tool.key); return; }
    if (k === 'r' && this.sel) { this.rotateSel(e.shiftKey ? -15 : 15); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.tool === 'poly' && this.poly) { this.poly.pop(); if (!this.poly.length) this.poly = null; return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { this.deleteSel(); return; }
    if (e.key === 'Escape') { this.poly = null; this.sel = null; this.linkFrom = null; this.refreshPanel(); return; }
    if (e.key === 'Enter' && this.poly) { this.closePoly(); return; }
    if (e.key === '[') { this.brush = Math.max(1, this.brush - (this.brush > 8 ? 4 : 1)); this.refreshPanel(); return; }
    if (e.key === ']') { this.brush = Math.min(64, this.brush + (this.brush >= 8 ? 4 : 1)); this.refreshPanel(); return; }
    if (k === 'w') { this.colour = 'wall'; this.refreshPanel(); return; }
    if (k === 'c') { this.colour = 'chasm'; this.refreshPanel(); return; }
    if (k === 'o') { this.colour = 'open'; this.refreshPanel(); return; }
    if (k === '0') { this.fitView(); return; }
    if (k === 'a') { this.visible.preview = !this.visible.preview; this.refreshPanel(); return; }
    if (e.key === ' ') { this.spaceDown = true; e.preventDefault(); }
  }

  setTool(t) {
    this.tool = t;
    this.poly = null;
    this.linkFrom = null;
    if (t === 'autozone' || (t === 'poly' && this.active === 'vision')) this.active = 'vision';
    else if (DRAW_TOOLS.has(t)) this.active = 'collision';
    else if (this.active === 'collision' || (this.active === 'vision' && !ZONE_TOOLS.has(t))) this.active = t === 'link' ? 'paths' : 'enemies';
    if (t === 'link') { this.active = 'paths'; this.visible.paths = true; }
    if (this.active === 'vision') this.visible.vision = true;
    this.refreshPanel();
  }

  // make a layer the one tools work on, switching to a tool that works there
  pickLayer(key) {
    this.active = key;
    if (key === 'collision' && !DRAW_TOOLS.has(this.tool)) this.tool = 'pencil';
    else if (key === 'vision' && !ZONE_TOOLS.has(this.tool)) this.tool = 'select';
    else if (key !== 'collision' && key !== 'vision' && (DRAW_TOOLS.has(this.tool) || this.tool === 'autozone')) this.tool = 'select';
    if (key === 'vision') this.visible.vision = true;
    if (key === 'paths') this.visible.paths = true;
    if (key === 'paths') this.placeSymbol = NODE; // the only thing to place there
    else if (this.placeSymbol === NODE) this.placeSymbol = null;
    this.poly = null;
    this.refreshPanel();
  }

  onMouseDown(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [x, y] = this.toWorld(sx, sy);
    if (e.button === 1 || e.button === 2 || this.spaceDown) {
      this.drag = { kind: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy };
      return;
    }
    const t = this.tool;
    if (t === 'select') {
      const v = this.vertexAt(sx, sy);
      if (v) { this.drag = { kind: 'vertex', k: v.k, i: v.i, before: this.snapshot(), moved: false }; return; }
      const h = this.hit(x, y);
      this.sel = h;
      if (h) {
        this.active = h.layer === 'features' && this.isNode(this.list('features')[h.k]) ? 'paths' : h.layer;
        const ent = this.list(h.layer)[h.k];
        this.drag = { kind: 'move', x, y, ex: ent.x, ey: ent.y, before: this.snapshot(), moved: false };
      }
      this.refreshPanel();
    } else if (t === 'place') {
      if (!this.placeSymbol) { this.status('Pick a symbol to place first.', true); return; }
      const [px, py] = this.snap(x, y, e.altKey);
      this.placeAt(px, py);
    } else if (t === 'link') {
      const h = this.hit(x, y);
      if (!h || h.layer !== 'features' || !this.isNode(this.list('features')[h.k])) { this.linkFrom = null; return; }
      if (this.linkFrom == null || this.linkFrom === h.k) { this.linkFrom = h.k; this.sel = h; this.refreshPanel(); return; }
      this.toggleLink(this.linkFrom, h.k);
      this.linkFrom = h.k;
    } else if (t === 'autozone') {
      this.autoZone(x, y);
    } else if (t === 'rect') {
      const [px, py] = this.snap(x, y, e.altKey);
      this.drag = { kind: 'rect', x0: px, y0: py, x1: px, y1: py };
    } else if (t === 'poly') {
      let p = this.snap(x, y, e.altKey);
      if (this.poly && this.poly.length) {
        const first = this.poly[0];
        if (this.poly.length > 2 && Math.hypot(first[0] - x, first[1] - y) * this.view.z < 10) { this.closePoly(); return; }
        p = this.snapAngleFrom(this.poly[this.poly.length - 1], p[0], p[1], e.shiftKey);
      }
      (this.poly ||= []).push(p);
    } else if (t === 'pencil' || t === 'eraser') {
      const colour = t === 'eraser' ? 'open' : this.colour;
      const m = this.map;
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      const before = m.grab(0, 0, m.w, m.h);
      m.dab(x, y, this.brush, colour, box);
      m.commitStroke(box);
      this.drag = { kind: 'paint', colour, box, before, lx: x, ly: y };
    } else if (t === 'fill') {
      const u = this.map.fill(x, y, this.colour);
      if (u) { this.pushUndo({ type: 'pixels', level: this.index, ...u }); this.collisionChanged(); }
    }
  }

  onMouseMove(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [x, y] = this.toWorld(sx, sy);
    this.mouse = { x, y, sx, sy, alt: e.altKey, shift: e.shiftKey };
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pan') { this.view.ox = d.ox + sx - d.sx; this.view.oy = d.oy + sy - d.sy; }
    else if (d.kind === 'move') {
      const ent = this.list(this.sel.layer)[this.sel.k];
      let nx = d.ex + x - d.x, ny = d.ey + y - d.y;
      if (e.shiftKey) [nx, ny] = this.snap(nx, ny, false); // Shift snaps to the grid
      ent.x = round2(nx); ent.y = round2(ny);
      d.moved = true;
      const c = this.clipFor(this.sel.layer, this.sel.k);
      if (c) { c._x = ent.x; c._y = ent.y; }
    } else if (d.kind === 'vertex') {
      const z = this.list('vision')[d.k];
      let [wx, wy] = e.shiftKey ? this.snap(x, y, false) : [x, y];
      const [a, b, c, dd, tx, ty] = zoneMatrix(z);
      const det = a * dd - b * c || 1;
      const lx = (dd * (wx - tx) - c * (wy - ty)) / det, ly = (-b * (wx - tx) + a * (wy - ty)) / det;
      z.points[d.i] = [round2(lx), round2(ly)];
      d.moved = true;
    } else if (d.kind === 'rect') { [d.x1, d.y1] = this.snap(x, y, e.altKey); }
    else if (d.kind === 'paint') {
      this.map.line(d.lx, d.ly, x, y, this.brush, d.colour, d.box);
      this.map.commitStroke(d.box);
      d.lx = x; d.ly = y;
    }
  }

  onMouseUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'vertex' && d.moved) {
      this.pushUndo({ type: 'data', level: this.index, before: d.before, after: this.snapshot(), files: ['vision.json'] });
      this.markDirty('vision.json');
      this.reload();
      this.refreshPanel();
    } else if (d.kind === 'move' && d.moved) {
      const file = this.sel.layer + '.json';
      this.pushUndo({ type: 'data', level: this.index, before: d.before, after: this.snapshot(), files: [file] });
      this.markDirty(file);
      this.needsReload = true; // positions are live already; rebuild before playing
      this.refreshPanel();
    } else if (d.kind === 'rect') {
      if (d.x0 !== d.x1 && d.y0 !== d.y1) {
        const u = this.map.rect(d.x0, d.y0, d.x1, d.y1, this.colour);
        if (u) { this.pushUndo({ type: 'pixels', level: this.index, ...u }); this.collisionChanged(); }
      }
    } else if (d.kind === 'paint') {
      const m = this.map;
      const b = m.clampBox(...d.box);
      if (b) {
        const [x, y, w, h] = b;
        const before = { x, y, w, h, pixels: new ImageData(w, h) };
        for (let j = 0; j < h; j++) before.pixels.data.set(d.before.pixels.data.subarray(((y + j) * m.w + x) * 4, ((y + j) * m.w + x + w) * 4), j * w * 4);
        this.pushUndo({ type: 'pixels', level: this.index, before, after: m.grab(x, y, w, h) });
        this.collisionChanged();
      }
    }
  }

  onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [x, y] = this.toWorld(sx, sy);
    const z = Math.max(0.1, Math.min(48, this.view.z * Math.pow(1.0015, -e.deltaY)));
    this.view = { z, ox: sx - x * z, oy: sy - y * z };
  }

  closePoly() {
    const p = this.poly;
    this.poly = null;
    if (!p || p.length < 3) return;
    if (this.active === 'vision') { this.addZone(p); return; }
    const u = this.map.polygon(p, this.colour);
    if (u) { this.pushUndo({ type: 'pixels', level: this.index, ...u }); this.collisionChanged(); }
  }

  // ------------------------------------------------------------------ placement edits
  defaultFor(symbol) {
    for (const L of this.levels) for (const l of PLACE_LAYERS) for (const e of L[l] || []) if (e.symbol === symbol) {
      const o = {};
      if (e.color) o.color = structuredClone(e.color);
      if (e.props) o.props = structuredClone(e.props);
      return o;
    }
    return {};
  }

  uniqueName(prefix) {
    const used = new Set();
    for (const l of PLACE_LAYERS) for (const e of this.list(l)) if (e.name) used.add(e.name);
    let n = 1;
    while (used.has(prefix + n)) n++;
    return prefix + n;
  }

  placeAt(x, y) {
    const layer = dataLayer(this.active);
    const preset = typeof this.placeSymbol === 'object' ? this.placeSymbol : null;
    const sym = preset ? preset.symbol : this.placeSymbol;
    const ent = { symbol: sym, x: round2(x), y: round2(y), ...(preset ? { props: structuredClone(preset.props) } : this.defaultFor(sym)) };
    if (preset && ent.props.type === 'trigger' && !ent.props.item) {
      const door = this.list('doors').find((d) => d.props && d.props.id);
      ent.props.item = door ? door.props.id + ':open' : 'myTrigger';
    }
    if (layer === 'doors' && ent.props && 'id' in ent.props) {
      let n = 1;
      const ids = new Set(this.list('doors').map((d) => d.props && d.props.id));
      while (ids.has('door' + n)) n++;
      ent.props.id = 'door' + n;
    }
    if (sym === NODE) {
      // a new node joins the selected node's path group (its colour), or the level's first one,
      // and links itself by line of sight when the level starts (no "connections")
      const nodes = this.list('features').filter((n) => this.isNode(n));
      const sel = this.sel && this.sel.layer === 'features' && this.isNode(this.list('features')[this.sel.k]) ? this.list('features')[this.sel.k] : null;
      const from = sel || nodes[0];
      ent.color = from && from.color ? structuredClone(from.color) : { multiply: [0, 0, 0, 1], add: [255, 0, 0, 0] };
      delete ent.props;
      delete ent.name;
    }
    if (sym.endsWith('entrance_mc')) ent.name = 'entrance_mc';
    if (sym.endsWith('exit_mc')) ent.name = 'exit_mc';
    this.change([layer + '.json'], () => this.list(layer).push(ent));
    this.sel = { layer, k: this.list(layer).length - 1 };
    this.refreshPanel();
  }

  duplicate() {
    if (!this.sel) return;
    const { layer, k } = this.sel;
    const ent = structuredClone(this.list(layer)[k]);
    ent.x = round2(ent.x + (this.grid || 16)); ent.y = round2(ent.y + (this.grid || 16));
    if (layer === 'features' && ent.symbol === NODE) { delete ent.name; delete ent.props; } // the copy links itself by line of sight
    else if (ent.name) delete ent.name;
    if (layer === 'doors' && ent.props && ent.props.id) {
      let n = 1;
      const ids = new Set(this.list('doors').map((d) => d.props && d.props.id));
      while (ids.has('door' + n)) n++;
      ent.props.id = 'door' + n;
    }
    this.change([layer + '.json'], () => this.list(layer).push(ent));
    this.sel = { layer, k: this.list(layer).length - 1 };
    this.refreshPanel();
  }

  deleteSel() {
    const { layer, k } = this.sel;
    const ent = this.list(layer)[k];
    this.change([layer + '.json'], () => {
      this.list(layer).splice(k, 1);
      // drop links to a deleted node
      if (ent.name) for (const e of this.list('features')) if (e.props && Array.isArray(e.props.connections)) e.props.connections = e.props.connections.filter((c) => !(isRef(c) && c.$ref === ent.name));
    });
    this.sel = null;
    this.refreshPanel();
  }

  rotateSel(deg) {
    const { layer, k } = this.sel;
    this.change([layer + '.json'], () => {
      const e = this.list(layer)[k];
      const t = transformOf(e);
      setTransform(e, t.rot + deg, t.sx, t.sy);
    });
  }

  toggleLink(a, b) {
    const list = this.list('features');
    const A = list[a], B = list[b];
    const nameOf = (e) => e.name || (e.name = this.uniqueName('n'));
    const auto = this.autoLinks();
    this.change(['features.json'], () => {
      const na = nameOf(A), nb = nameOf(B);
      // pinning a node's links starts from the ones it would make by itself
      const links = (e, k) => {
        if (e.script) { this.status('This node has a script, so its links can\'t be edited here.', true); return null; }
        e.props ||= {};
        if (!Array.isArray(e.props.connections)) e.props.connections = (auto.get(k) || []).map((j) => ({ $ref: nameOf(list[j]) }));
        return e.props.connections;
      };
      const la = links(A, a), lb = links(B, b);
      if (!la || !lb) return;
      const has = la.some((c) => isRef(c) && c.$ref === nb);
      if (has) {
        A.props.connections = la.filter((c) => !(isRef(c) && c.$ref === nb));
        B.props.connections = lb.filter((c) => !(isRef(c) && c.$ref === na));
      } else {
        la.push({ $ref: nb });
        if (!lb.some((c) => isRef(c) && c.$ref === na)) lb.push({ $ref: na });
      }
    });
  }

  unpinLinks(k) {
    const e = this.list('features')[k];
    this.change(['features.json'], () => {
      if (e.props) delete e.props.connections;
      if (e.props && !Object.keys(e.props).length) delete e.props;
    });
  }

  // ------------------------------------------------------------------ path nodes
  // is (x, y) a wall for line of sight? Like wallHitTest: only pure black, and off the map
  isWall(x, y) {
    const m = this.map;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
    const d = m.data.data, i = (y * m.w + x) * 4;
    return d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0;
  }

  // as2/functionsGame.as lineOfSight
  lineOfSight(a, b, rate) {
    let x = a.x, y = a.y;
    const xv = x - b.x, yv = y - b.y;
    let s = Math.floor(Math.hypot(xv, yv) / rate);
    const xs = xv / s, ys = yv / s;
    while (s-- > 0) {
      if (this.isWall(x, y)) return false;
      x -= xs; y -= ys;
    }
    return true;
  }

  // links each node without "connections" makes when the level starts (as2/pathNode.as):
  // every other node of its colour in line of sight. Map of feature index -> [feature index]
  autoLinks() {
    const feats = this.list('features');
    const nodes = feats.map((e, k) => [e, k]).filter(([e]) => this.isNode(e));
    const key = this.index + ':' + this.mapVersion + ':' + JSON.stringify(nodes.map(([e]) => [e.x, e.y, e.color, e.props && Array.isArray(e.props.connections), !!e.script]));
    if (this._auto && this._auto.key === key) return this._auto.links;
    const links = new Map();
    for (const [e, k] of nodes) {
      if ((e.props && e.props.connections !== undefined) || e.script) continue;
      const g = nodeGroup(e);
      links.set(k, nodes.filter(([o, j]) => j !== k && nodeGroup(o) === g && this.lineOfSight(e, o, NODE_LOS_SAMPLE)).map(([, j]) => j));
    }
    this._auto = { key, links };
    return links;
  }

  // ------------------------------------------------------------------ vision zones
  inZone(z, x, y) {
    const [a, b, c, d, tx, ty] = zoneMatrix(z);
    const det = a * d - b * c;
    if (!det) return false;
    const lx = (d * (x - tx) - c * (y - ty)) / det, ly = (-b * (x - tx) + a * (y - ty)) / det;
    try { return this.hitCtx.isPointInPath(zonePath2D(z), lx, ly); } catch { return false; }
  }

  addZone(pts, at) {
    const cx = at ? at[0] : pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = at ? at[1] : pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const zones = this.list('vision');
    const used = new Set(zones.map((z) => z.color));
    const color = ZONE_COLOURS.find((c) => !used.has(c)) || ZONE_COLOURS[zones.length % ZONE_COLOURS.length];
    const z = { x: round2(cx), y: round2(cy), color, points: pts.map(([x, y]) => [round2(x - round2(cx)), round2(y - round2(cy))]) };
    this.change(['vision.json'], () => zones.push(z));
    this.sel = { layer: 'vision', k: zones.length - 1 };
    this.refreshPanel();
  }

  // as2/enemyTurret.as makeVision: rays every 4 degrees until they hit a wall
  autoZone(x, y) {
    if (this.isWall(x, y)) { this.status('Click on open floor to make a zone from there.', true); return; }
    const pts = [];
    for (let i = AUTO_VISION_ANGLES - 1; i >= 0; i--) {
      const a = (i / AUTO_VISION_ANGLES) * 2 * Math.PI;
      const vx = Math.cos(a) * LOS_SAMPLE_SIZE, vy = Math.sin(a) * LOS_SAMPLE_SIZE;
      let px = x, py = y;
      do { px += vx; py += vy; } while (!this.isWall(px, py));
      pts.push([px, py]);
    }
    this.addZone(pts, [x, y]);
  }

  // a zone's corner under the mouse, for dragging
  vertexAt(sx, sy) {
    if (!this.sel || this.sel.layer !== 'vision') return null;
    const z = this.list('vision')[this.sel.k];
    if (!z || !z.points) return null;
    const M = zoneMatrix(z), v = this.view;
    for (let i = z.points.length - 1; i >= 0; i--) {
      const [x, y] = apply(M, z.points[i]);
      if (Math.hypot(x * v.z + v.ox - sx, y * v.z + v.oy - sy) < 7) return { k: this.sel.k, i };
    }
    return null;
  }

  zoneToPolygon(k) {
    const z = this.list('vision')[k];
    this.change(['vision.json'], () => {
      z.points = flattenPath(z.d);
      delete z.d;
      const { color, points, ...rest } = z;
      for (const key of Object.keys(z)) delete z[key];
      Object.assign(z, rest, { color, points });
    });
  }

  // ------------------------------------------------------------------ triggers
  // trigger names the level uses: door ids, trigger pads, sent and received triggers
  knownTriggers() {
    const out = new Set();
    for (const d of this.list('doors')) if (d.props && d.props.id) { out.add(d.props.id + ':open'); out.add(d.props.id + ':close'); }
    for (const l of PLACE_LAYERS) for (const e of this.list(l)) {
      for (const n of sentTriggers(e)) out.add(n);
      for (const m of [].concat(e.script || []).join('\n').matchAll(/registerTrigger\(\s*this\s*,\s*["']([^"']+)["']/g)) out.add(m[1]);
    }
    return [...out].sort();
  }

  // ------------------------------------------------------------------ save
  fileContent(i, file) {
    const L = this.levels[i];
    if (file === 'collision.png') return this.maps[i].toBlob();
    if (file === 'level.json') return pretty(L.settings) + '\n';
    return pretty(L[file.replace('.json', '')] || []) + '\n';
  }

  async save() {
    const jobs = [];
    for (const [i, files] of Object.entries(this.dirty)) for (const f of files) jobs.push([+i, f]);
    if (!jobs.length) { this.status('Nothing to save.'); return; }
    if (this.writable) {
      this.status('Saving…');
      try {
        for (const [i, f] of jobs) {
          const body = await this.fileContent(i, f);
          const r = await fetch(`levels/${this.levels[i].folder}/${f}`, { method: 'PUT', body });
          if (!r.ok) throw new Error((await r.json()).error || r.statusText);
        }
        this.dirty = {};
        this.refreshSave();
        this.status(`Saved ${jobs.map(([i, f]) => this.levels[i].folder + '/' + f).join(', ')}. Rebuilding…`);
        const b = await fetch('__build', { method: 'POST' }).then((r) => r.json());
        this.status(b.ok ? `Saved ${jobs.length} file${jobs.length > 1 ? 's' : ''} to levels/ and rebuilt.` + (this.stale ? ' The background art still needs a re-bake.' : '') : 'Saved, but the build failed: ' + b.log, !b.ok);
      } catch (e) { this.status('Save failed: ' + e.message, true); }
    } else {
      for (const [i, f] of jobs) {
        const body = await this.fileContent(i, f);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(body instanceof Blob ? body : new Blob([body], { type: 'application/json' }));
        a.download = f;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      this.status(`Downloaded ${jobs.map(([i, f]) => this.levels[i].folder + '/' + f).join(', ')}. Put them in levels/<level>/ and run npm run build (or use npm run edit to save directly).`);
      this.dirty = {};
      this.refreshSave();
    }
  }

  // ------------------------------------------------------------------ drawing
  loop() {
    if (!this.isOpen) return;
    this.draw();
    requestAnimationFrame(() => this.loop());
  }

  draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1616';
    ctx.fillRect(0, 0, W, H);
    const v = this.view;
    const M = [v.z * dpr, 0, 0, v.z * dpr, v.ox * dpr, v.oy * dpr];
    const { w, h } = this.L.size;
    this._hint = '';
    ctx.setTransform(...M);
    ctx.fillStyle = '#152B2B';
    ctx.fillRect(0, 0, w, h);
    const preview = this.visible.preview && this.artPreview();
    if (preview) { ctx.imageSmoothingEnabled = false; ctx.drawImage(preview, 0, 0); }

    // the game scene, with layers hidden as asked
    const s = this.screen;
    if (s) {
      const hide = [];
      const set = (c, vis) => { if (c && c.__visible !== vis) { hide.push([c, c.__visible]); c.__visible = vis; } };
      set(s.backgroundContainer_mc, this.visible.art && !preview);
      for (const l of LAYERS) set(s[l + '_mc'], this.visible[l]);
      for (let k = 0; k < (this.L.doors || []).length; k++) set(s.byDepth.get(T(DEPTH.doors + k)), this.visible.doors);
      (this.L.features || []).forEach((e, k) => {
        const c = s.byDepth.get(T(DEPTH.features + k));
        if (e.name === 'vision_mc') set(c, false); // drawn translucent below
        else if (!this.isNode(e)) set(c, this.visible.features);
      });
      set(s.player_mc, this.visible.features);
      set(s.shadow_mc, this.visible.features);
      set(s.byDepth.get(T(DEPTH.fade)), false);
      const sm = s.m.slice();
      s.m[4] = 0; s.m[5] = 0;
      try {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
        this.rt.renderer.renderTo(ctx, s, M, null, W, H);
        ctx.restore();
      } catch (e) { console.error(e); }
      for (const [c, vis] of hide) c.__visible = vis;
      // vision zones are solid red shapes: show them see-through
      const vz = s.vision_mc;
      if (this.visible.vision && vz) {
        const was = vz.__visible;
        vz.__visible = true;
        try { this.rt.renderer.renderTo(ctx, vz, mul(M, vz.m), [1, 1, 1, 0.3, 0, 0, 0, 0], W, H); } catch (e) { console.error(e); }
        vz.__visible = was;
      }
      s.m[4] = sm[4]; s.m[5] = sm[5];
    }
    ctx.setTransform(...M);
    if (this.visible.collision) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = this.active === 'collision' ? 1 : 0.6;
      ctx.drawImage(this.map.overlay, 0, 0);
      ctx.globalAlpha = 1;
    }
    const px = 1 / v.z; // one screen pixel in world units
    // grid
    if (this.snapGrid && this.grid && this.grid * v.z >= 6 && (DRAW_TOOLS.has(this.tool) || this.drag)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let x = 0; x <= w; x += this.grid) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h; y += this.grid) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    }
    if (v.z >= 12) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = px;
      ctx.beginPath();
      const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(r.width, r.height);
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w, x1); x++) { ctx.moveTo(x, Math.max(0, y0)); ctx.lineTo(x, Math.min(h, y1)); }
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h, y1); y++) { ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(Math.min(w, x1), y); }
      ctx.stroke();
    }
    // level edge
    ctx.strokeStyle = 'rgba(120,255,255,0.5)';
    ctx.lineWidth = px;
    ctx.strokeRect(0, 0, w, h);
    // vision zone outlines and corners while editing them
    if (this.visible.vision && this.active === 'vision') {
      this.list('vision').forEach((z, k) => {
        const sel = this.sel && this.sel.layer === 'vision' && this.sel.k === k;
        ctx.save();
        ctx.transform(...zoneMatrix(z));
        ctx.strokeStyle = sel ? '#ffee44' : 'rgba(255,255,255,0.45)';
        ctx.lineWidth = (sel ? 2 : 1) * px / Math.max(1e-6, Math.sqrt(Math.abs(det(zoneMatrix(z)))));
        try { ctx.stroke(zonePath2D(z)); } catch { /* bad path */ }
        ctx.restore();
        if (sel && z.points) {
          ctx.fillStyle = '#ffee44';
          for (const p of z.points) { const [x, y] = apply(zoneMatrix(z), p); ctx.fillRect(x - 3 * px, y - 3 * px, 6 * px, 6 * px); }
        }
      });
    }
    // which triggers open and close which doors
    if (this.visible.doors) {
      const doors = new Map(this.list('doors').filter((d) => d.props && d.props.id).map((d) => [d.props.id, d]));
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      for (const l of ['powerups', 'boxes', 'enemies']) {
        if (!this.visible[l]) continue;
        for (const e of this.list(l)) for (const n of sentTriggers(e)) {
          const m = /^(.+):(open|close)$/.exec(n);
          const d = m && doors.get(m[1]);
          if (!d) continue;
          ctx.strokeStyle = m[2] === 'open' ? 'rgba(120,255,140,0.9)' : 'rgba(255,120,120,0.9)';
          ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(d.x, d.y); ctx.stroke();
          ctx.beginPath(); ctx.arc(d.x, d.y, 4 * px, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    // path nodes and links: pinned links solid, automatic (line of sight) links dashed
    if (this.visible.paths) {
      const feats = this.L.features || [];
      const byName = new Map(feats.filter((e) => e.name).map((e) => [e.name, e]));
      const auto = this.autoLinks();
      feats.forEach((e, k) => {
        if (!this.isNode(e)) return;
        const col = nodeColour(e);
        ctx.strokeStyle = col; ctx.lineWidth = 2 * px;
        for (const c of (e.props && e.props.connections) || []) {
          const t = isRef(c) && byName.get(c.$ref);
          if (t) { ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(t.x, t.y); ctx.stroke(); }
        }
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([5 * px, 4 * px]);
        for (const j of auto.get(k) || []) { const t = feats[j]; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(t.x, t.y); ctx.stroke(); }
        ctx.setLineDash([]);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(e.x, e.y, 5 * px, 0, Math.PI * 2); ctx.fill();
        if (this.linkFrom === k) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(e.x, e.y, 9 * px, 0, Math.PI * 2); ctx.stroke(); }
      });
    }
    // selection
    if (this.sel && this.list(this.sel.layer)[this.sel.k]) {
      const [x0, y0, x1, y1] = this.boundsOf(this.sel.layer, this.sel.k);
      ctx.strokeStyle = '#ffee44'; ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }
    // tool previews
    const m = this.mouse;
    const fillCol = (c, a) => `rgba(${COLOURS[c].join(',')},${a})`;
    if (this.drag && this.drag.kind === 'rect') {
      const d = this.drag;
      ctx.fillStyle = fillCol(this.colour, 0.5); ctx.strokeStyle = '#ff0'; ctx.lineWidth = px;
      ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      this.hint(`${Math.abs(d.x1 - d.x0)} × ${Math.abs(d.y1 - d.y0)}`);
    }
    if (this.poly) {
      let nx, ny;
      [nx, ny] = this.snap(m.x, m.y, m.alt);
      [nx, ny] = this.snapAngleFrom(this.poly[this.poly.length - 1], nx, ny, m.shift);
      ctx.fillStyle = fillCol(this.colour, 0.4); ctx.strokeStyle = '#ff0'; ctx.lineWidth = px;
      ctx.beginPath();
      this.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(nx, ny);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      for (const [x, y] of this.poly) ctx.strokeRect(x - 3 * px, y - 3 * px, 6 * px, 6 * px);
      const last = this.poly[this.poly.length - 1];
      this.hint(`${Math.round(Math.atan2(ny - last[1], nx - last[0]) * 180 / Math.PI)}°  ${Math.round(Math.hypot(nx - last[0], ny - last[1]))} px`);
    }
    if ((this.tool === 'pencil' || this.tool === 'eraser') && !this.spaceDown) {
      const b = this.brush, x0 = Math.floor(m.x - b / 2 + 0.5), y0 = Math.floor(m.y - b / 2 + 0.5);
      ctx.strokeStyle = '#ff0'; ctx.lineWidth = px;
      ctx.strokeRect(x0, y0, b, b);
    }
    if (this.tool === 'place' && this.placeSymbol) {
      const [x, y] = this.snap(m.x, m.y, m.alt);
      ctx.strokeStyle = '#7f7'; ctx.lineWidth = px;
      ctx.beginPath(); ctx.moveTo(x - 6 * px, y); ctx.lineTo(x + 6 * px, y); ctx.moveTo(x, y - 6 * px); ctx.lineTo(x, y + 6 * px); ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.coords.textContent = `${Math.floor(m.x)}, ${Math.floor(m.y)}  ·  ${Math.round(v.z * 100)}%` + (this.map.colourAt(m.x, m.y) ? '  ·  ' + this.map.colourAt(m.x, m.y) : '') + (this._hint ? '  ·  ' + this._hint : '');
  }

  hint(t) { this._hint = t; }

  // the art preview canvas for this level, rebuilt in the background after collision edits
  artPreview() {
    const p = this.preview, want = this.index + ':' + this.mapVersion;
    if ((!p || p.key !== want) && !this.previewBusy) {
      this.previewBusy = true;
      const map = this.map;
      setTimeout(() => renderPreview(map).then((canvas) => { this.preview = { key: want, canvas }; })
        .catch((e) => { this.status('Art preview: ' + e.message, true); this.visible.preview = false; })
        .finally(() => { this.previewBusy = false; }), p ? 150 : 0);
    }
    return p && p.key.split(':')[0] === String(this.index) ? p.canvas : null;
  }

  // ------------------------------------------------------------------ DOM
  buildDom() {
    const root = this.root = el('div', { id: 'level-editor', style: 'display:none' });
    const css = el('style', {}, CSS);
    this.canvas = el('canvas', { class: 'le-view' });
    this.ctx = this.canvas.getContext('2d');
    this.hitCtx = document.createElement('canvas').getContext('2d');
    this.panel = el('div', { class: 'le-panel' });
    this.coords = el('div', { class: 'le-coords' });
    this.statusEl = el('div', { class: 'le-status' });
    root.append(css, this.canvas, this.panel, this.coords, this.statusEl);
    document.body.append(root);
    this.canvas.addEventListener('mousedown', (e) => { e.preventDefault(); this.onMouseDown(e); });
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // keep the game from hearing anything while the editor is open
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (typing(e)) { if (e.key === '`') { e.preventDefault(); e.target.blur(); } return; }
      e.stopImmediatePropagation();
      this.onKey(e);
    }, true);
    window.addEventListener('keyup', (e) => {
      if (!this.isOpen) return;
      if (e.key === ' ') this.spaceDown = false;
      if (!typing(e)) e.stopImmediatePropagation();
    }, true);
    this.panel.addEventListener('keydown', (e) => e.stopPropagation());
    this.panel.addEventListener('keyup', (e) => e.stopPropagation());
    window.addEventListener('mouseup', (e) => { if (!this.isOpen) return; e.stopImmediatePropagation(); this.onMouseUp(e); }, true);
    window.addEventListener('mousemove', (e) => { if (this.isOpen && this.drag) this.onMouseMove(e); }, true);
  }

  status(t, err) { this.statusEl.textContent = t; this.statusEl.classList.toggle('err', !!err); }

  refreshSave() {
    const n = Object.values(this.dirty).reduce((a, s) => a + s.size, 0);
    if (this.saveBtn) this.saveBtn.textContent = (this.writable ? 'Save' : 'Download') + (n ? ` (${n})` : '');
  }

  refreshPanel() {
    const p = this.panel;
    p.textContent = '';
    const L = this.L;
    // level
    const lvl = el('select', { onchange: (e) => this.loadLevel(+e.target.value) }, ...this.levels.map((x) => el('option', { value: x.index, selected: x.index === this.index }, x.folder)));
    p.append(el('div', { class: 'le-row' }, el('b', {}, 'Level '), lvl,
      el('button', { title: 'Restart the level from the edited data', onclick: () => this.reload() }, 'Restart'),
      el('button', { title: 'Back to the game (`)', onclick: () => this.close() }, 'Play ▸')));
    // tools
    p.append(el('h4', {}, 'Tools'), el('div', { class: 'le-tools' }, ...TOOLS.map((t) => el('button', { class: this.tool === t.key ? 'on' : '', title: t.tip, onclick: () => this.setTool(t.key) }, `${t.label} (${t.hot})`))));
    const tip = TOOLS.find((t) => t.key === this.tool);
    p.append(el('div', { class: 'le-tip' }, tip.tip));
    if (DRAW_TOOLS.has(this.tool)) {
      p.append(el('div', { class: 'le-row' }, 'Paint ', ...['wall', 'chasm', 'open'].map((c) => el('button', {
        class: 'le-swatch ' + (this.colour === c ? 'on' : ''), style: `--c: rgb(${COLOURS[c].join(',')})`, title: { wall: 'Wall (W)', chasm: 'Chasm: impassable, shoot over (C)', open: 'Open floor (O)' }[c],
        onclick: () => { this.colour = c; this.refreshPanel(); },
      }, c))));
      p.append(el('div', { class: 'le-row' },
        'Brush ', el('input', { type: 'number', min: 1, max: 64, value: this.brush, onchange: (e) => { this.brush = Math.max(1, Math.min(64, +e.target.value || 1)); } }), ' px'));
      p.append(el('div', { class: 'le-row' },
        el('label', {}, el('input', { type: 'checkbox', checked: this.snapGrid, onchange: (e) => { this.snapGrid = e.target.checked; } }), ' Grid '),
        el('select', { onchange: (e) => { this.grid = +e.target.value; } }, ...[4, 8, 16, 32, 64].map((g) => el('option', { value: g, selected: g === this.grid }, g + ' px'))),
        ' Angles ',
        el('select', { onchange: (e) => { this.snapAngle = +e.target.value; } }, ...[0, 5, 15, 22.5, 45, 90].map((a) => el('option', { value: a, selected: a === this.snapAngle }, a ? a + '°' : 'free')))));
      if (this.stale) p.append(el('div', { class: 'le-warn' }, 'The collision map changed, so the background art no longer matches it. Re-bake the art after saving (tools/art).'));
    }
    // layers
    const active = el('div', { class: 'le-layers' });
    VIEW_LAYERS.forEach((l, i) => {
      const editable = DATA_LAYERS.includes(l.key) || l.key === 'collision' || l.key === 'paths';
      const hot = l.hot || String(i + 1);
      active.append(el('div', { class: 'le-layer' + (this.active === l.key ? ' on' : '') },
        el('input', { type: 'checkbox', checked: this.visible[l.key], title: `show/hide (${hot})`, onchange: (e) => { this.visible[l.key] = e.target.checked; } }),
        el('span', { class: editable ? 'le-pick' : '', onclick: editable ? () => this.pickLayer(l.key) : null }, `${hot}  ${l.label}`),
        DATA_LAYERS.includes(l.key) || l.key === 'paths' ? el('small', {}, String(this.layerCount(l.key))) : ''));
    });
    p.append(el('h4', {}, 'Layers ', el('small', {}, 'Tab picks the layer to edit')), active);
    // palette
    if (this.tool === 'place') {
      const layer = PLACE_LAYERS.includes(this.active) || this.active === 'paths' ? this.active : 'enemies';
      const syms = new Set();
      if (layer === 'paths') syms.add(NODE);
      else {
        for (const x of this.levels) for (const e of x[layer] || []) syms.add(e.symbol);
        for (const s of EXTRA[layer] || []) if (this.applier.ids[s] !== undefined) syms.add(s);
        // nodes have their own layer, and vision_mc is part of every level already
        if (layer === 'features') for (const s of [...syms]) if (s === NODE || /^level assets\/vision\d+$/.test(s)) syms.delete(s);
      }
      p.append(el('h4', {}, 'Place: ' + (VIEW_LAYERS.find((l) => l.key === layer) || { label: layer }).label.toLowerCase()), el('div', { class: 'le-palette' }, ...[...syms].sort().map((s) => el('button', {
        class: this.placeSymbol === s ? 'on' : '', onclick: () => { this.placeSymbol = s; this.active = layer; this.refreshPanel(); },
      }, s.split('/').pop())), ...(PRESETS[layer] || []).map((pr) => el('button', {
        class: this.placeSymbol === pr ? 'on' : '', title: 'a ' + pr.symbol.split('/').pop() + ' set up as a ' + pr.label,
        onclick: () => { this.placeSymbol = pr; this.active = layer; this.refreshPanel(); },
      }, pr.label))));
    }
    // properties
    if (this.sel && this.list(this.sel.layer)[this.sel.k]) p.append(this.sel.layer === 'vision' ? this.zonePanel() : this.propsPanel());
    else if (this.active === 'vision') p.append(el('div', { class: 'le-tip' }, 'Vision zones: an enemy attacks when you and it are in the same zone and it can see you. An enemy outside every zone (or with autoVision) makes its own zone of what it can see. Select (V) moves zones and their corners, Polygon (G) draws one, Auto zone (Z) makes one from a spot.'));
    // stats + settings
    p.append(this.statsPanel());
    p.append(el('details', {}, el('summary', {}, 'Level settings (level.json)'),
      el('textarea', { rows: 4, spellcheck: false, onchange: (e) => {
        try {
          const v = JSON.parse(e.target.value);
          this.change(['level.json'], () => { L.settings = v; });
        } catch (err) { this.status('level.json: ' + err.message, true); }
      } }, JSON.stringify(L.settings, null, 1))));
    // save
    this.saveBtn = el('button', { class: 'le-save', title: this.writable ? 'Write the changed files into levels/ (Ctrl+S)' : 'Download the changed files (Ctrl+S). Run npm run edit to save into levels/ directly.', onclick: () => this.save() });
    p.append(el('div', { class: 'le-row' }, this.saveBtn, el('button', { onclick: () => this.undo(), title: 'Ctrl+Z' }, 'Undo'), el('button', { onclick: () => this.undo(true), title: 'Ctrl+Shift+Z' }, 'Redo')));
    this.refreshSave();
  }

  propsPanel() {
    const { layer, k } = this.sel;
    const e = this.list(layer)[k];
    const t = transformOf(e);
    const file = layer + '.json';
    const num = (label, val, set) => el('label', {}, label + ' ', el('input', { type: 'number', step: 'any', value: round2(val), onchange: (ev) => { const v = +ev.target.value; if (isFinite(v)) this.change([file], () => set(v)); } }));
    const box = el('div', { class: 'le-props' },
      el('h4', {}, e.symbol.split('/').pop(), el('small', {}, ` ${layer} #${k + 1}`)),
      el('div', { class: 'le-row' }, num('x', e.x, (v) => { e.x = v; }), num('y', e.y, (v) => { e.y = v; })),
      el('div', { class: 'le-row' },
        num('rotation', t.rot, (v) => setTransform(e, v, t.sx, t.sy)),
        num('scale x', t.sx, (v) => setTransform(e, t.rot, v, t.sy)),
        num('scale y', t.sy, (v) => setTransform(e, t.rot, t.sx, v))),
      el('div', { class: 'le-row' }, el('label', {}, 'name ', el('input', { value: e.name || '', onchange: (ev) => this.change([file], () => { if (ev.target.value) e.name = ev.target.value; else delete e.name; }) }))));
    if (this.isNode(e)) box.append(this.nodeRows(k));
    box.append(...this.triggerRows(layer, e));
    if (e.script !== undefined) {
      box.append(el('div', { class: 'le-tip' }, 'This instance runs code when it loads, so it keeps its script (edit it in ' + file + '):'),
        el('pre', {}, [].concat(e.script).join('\n')));
    } else {
      box.append(el('div', { class: 'le-tip' }, 'Variables set when it loads (JSON):'),
        el('textarea', { rows: Math.min(10, 2 + JSON.stringify(e.props || {}, null, 1).split('\n').length), spellcheck: false, onchange: (ev) => {
          try {
            const v = ev.target.value.trim() ? JSON.parse(ev.target.value) : {};
            if (typeof v !== 'object' || Array.isArray(v)) throw new Error('expected an object');
            this.change([file], () => { if (Object.keys(v).length) e.props = v; else delete e.props; });
          } catch (err) { this.status('Variables: ' + err.message, true); }
        } }, JSON.stringify(e.props || {}, null, 1)));
    }
    box.append(el('div', { class: 'le-row' },
      el('button', { onclick: () => this.rotateSel(-15) }, '⟲ 15°'), el('button', { onclick: () => this.rotateSel(15) }, '⟳ 15° (R)'),
      el('button', { onclick: () => this.duplicate() }, 'Duplicate'), el('button', { onclick: () => this.deleteSel() }, 'Delete')));
    return box;
  }

  layerCount(key) {
    const f = this.L.features || [];
    if (key === 'paths') return f.filter((e) => this.isNode(e)).length;
    if (key === 'features') return f.filter((e) => !this.isNode(e) && e.name !== 'vision_mc').length;
    return (this.L[key] || []).length;
  }

  nodeRows(k) {
    const e = this.list('features')[k];
    const pinned = e.props && e.props.connections !== undefined;
    const add = (e.color && e.color.add) || [0, 0, 0];
    const hex = '#' + add.slice(0, 3).map((v) => (v | 0).toString(16).padStart(2, '0')).join('');
    return el('div', {},
      el('div', { class: 'le-row' }, 'Path group ', el('input', { type: 'color', value: hex, title: 'nodes only link to nodes of the same colour; an enemy follows the group of the node nearest to it', onchange: (ev) => {
        const v = ev.target.value;
        this.change(['features.json'], () => { e.color = { multiply: [0, 0, 0, 1], add: [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(0) }; });
      } })),
      pinned
        ? el('div', { class: 'le-row' }, 'Links pinned by hand (solid). ', el('button', { onclick: () => this.unpinLinks(k), title: 'remove the pinned links, so the node links to every node of its colour it can see' }, 'Back to automatic'))
        : el('div', { class: 'le-tip' }, 'Links itself to the nodes of its colour it can see (dashed).'),
      el('div', { class: 'le-links' }, ...this.linksOf(k).map((j) => {
        const t = this.list('features')[j];
        return el('div', { class: 'le-row' }, `→ ${t.name || 'node #' + (j + 1)} (${Math.round(t.x)}, ${Math.round(t.y)})`,
          el('button', { title: 'remove this link (from both nodes)', onclick: () => { this.toggleLink(k, j); this.refreshPanel(); } }, '× unlink'));
      })),
      el('div', { class: 'le-tip' }, 'To add a link, use Path links (N): click this node, then another.'));
  }

  // feature indices a node links to: its pinned links, or the ones it makes by line of sight
  linksOf(k) {
    const f = this.list('features'), e = f[k];
    if (e.props && Array.isArray(e.props.connections)) return e.props.connections.filter(isRef).map((c) => f.findIndex((o) => o.name === c.$ref)).filter((j) => j >= 0);
    return this.autoLinks().get(k) || [];
  }

  // the triggers a placement sends, as editable fields
  triggerRows(layer, e) {
    const rows = [];
    const file = layer + '.json';
    const list = 'le-triggers';
    const input = (value, set, title) => el('input', { list, value, title, placeholder: 'nothing', style: 'flex: 1', onchange: (ev) => {
      const names = ev.target.value.split(',').map((t) => t.trim()).filter(Boolean);
      this.change([file], () => set(names));
    } });
    rows.push(el('datalist', { id: list }, ...this.knownTriggers().map((n) => el('option', { value: n }))));
    if (layer === 'doors' && e.props && e.props.id) {
      const id = e.props.id;
      const from = PLACE_LAYERS.flatMap((l) => this.list(l)).filter((o) => sentTriggers(o).some((n) => n === id + ':open' || n === id + ':close')).length;
      rows.push(el('div', { class: 'le-tip' }, `Opens on "${id}:open" and closes on "${id}:close"; ${from || 'nothing'} in this level sends ${from === 1 ? 'one' : 'them'}. Set a pickup, trigger pad, box or enemy to send one.`));
    }
    if (e.script !== undefined) return rows;
    if (layer === 'powerups' && e.props && e.props.type === 'trigger') {
      rows.push(el('div', { class: 'le-row' }, 'Trigger pad sends ', input(e.props.item || '', (n) => { e.props.item = n[0] || ''; }, 'sent when the player walks over it')));
    }
    const ev = TRIGGER_EVENTS[layer];
    if (ev) {
      const [key, when] = ev;
      const cur = e.props && e.props[key];
      if (cur === undefined || isTrigger(cur)) {
        rows.push(el('div', { class: 'le-row' }, `${when[0].toUpperCase() + when.slice(1)}, send `, input(cur ? triggerNames(cur).join(', ') : '', (n) => {
          if (n.length) { e.props ||= {}; e.props[key] = { $trigger: n.length === 1 ? n[0] : n }; } else if (e.props) { delete e.props[key]; if (!Object.keys(e.props).length) delete e.props; }
        }, 'trigger names, separated by commas; a door listens for "<id>:open" and "<id>:close"')));
      }
    }
    return rows;
  }

  zonePanel() {
    const { k } = this.sel;
    const z = this.list('vision')[k];
    const t = transformOf(z);
    const file = 'vision.json';
    const num = (label, val, set) => el('label', {}, label + ' ', el('input', { type: 'number', step: 'any', value: round2(val), onchange: (ev) => { const v = +ev.target.value; if (isFinite(v)) this.change([file], () => set(v)); } }));
    return el('div', { class: 'le-props' },
      el('h4', {}, 'Vision zone', el('small', {}, ` #${k + 1}`)),
      el('div', { class: 'le-row' }, num('x', z.x, (v) => { z.x = v; }), num('y', z.y, (v) => { z.y = v; })),
      el('div', { class: 'le-row' },
        num('rotation', t.rot, (v) => setTransform(z, v, t.sx, t.sy)),
        num('scale x', t.sx, (v) => setTransform(z, t.rot, v, t.sy)),
        num('scale y', t.sy, (v) => setTransform(z, t.rot, t.sx, v))),
      el('div', { class: 'le-row' }, 'Colour ', el('input', { type: 'color', value: z.color || '#ff0000', title: 'only for telling zones apart', onchange: (ev) => this.change([file], () => { z.color = ev.target.value; }) })),
      z.points
        ? el('div', { class: 'le-tip' }, `${z.points.length} corners: drag them with Select (Shift snaps to the grid).`)
        : el('div', { class: 'le-row' }, el('span', { class: 'le-tip' }, 'This zone has curves. '), el('button', { onclick: () => this.zoneToPolygon(k), title: 'turn the curves into straight segments so its corners can be dragged' }, 'Edit corners')),
      el('div', { class: 'le-row' },
        el('button', { onclick: () => this.rotateSel(-15) }, '⟲ 15°'), el('button', { onclick: () => this.rotateSel(15) }, '⟳ 15° (R)'),
        el('button', { onclick: () => this.duplicate() }, 'Duplicate'), el('button', { onclick: () => this.deleteSel() }, 'Delete')));
  }

  statsPanel() {
    const L = this.L;
    const ammo = {};
    let health = 0, healthDrops = 0;
    const add = (d, weight = 1) => {
      if (!d || typeof d !== 'object') return;
      const q = (+d.quantity || 0) * weight * (d.probability !== undefined ? +d.probability : 1);
      if (d.type === 'health') { if (weight === 1 && d.probability === undefined) health += q; else healthDrops += q; }
      else if (d.type === 'primary' || d.type === 'secondary') ammo[d.item] = (ammo[d.item] || 0) + q;
    };
    for (const e of L.powerups || []) if (e.props) add(e.props);
    for (const e of [...(L.boxes || []), ...(L.enemies || [])]) if (e.props && e.props.powerupDrop) add(e.props.powerupDrop, 1 + 1e-9);
    const rows = Object.entries(ammo).sort().map(([k, v]) => el('div', {}, `${k}: ${round2(v)}`));
    return el('details', { open: true }, el('summary', {}, 'Balance'),
      el('div', { class: 'le-stats' },
        el('div', {}, `${(L.enemies || []).length} enemies · ${(L.boxes || []).length} boxes · ${(L.powerups || []).length} pickups`),
        el('div', {}, `Health on the map: ${round2(health)}` + (healthDrops ? ` + ~${round2(healthDrops)} from drops` : '')),
        el('div', { class: 'le-tip' }, 'Ammo (pickups plus expected drops):'), ...rows));
  }
}

// ---------------------------------------------------------------------------- helpers
function round2(v) { return Math.round(v * 100) / 100; }

function transformOf(e) {
  let a = 1, b = 0, c = 0, d = 1;
  if (e.matrix) [a, b, c, d] = e.matrix;
  else if (Array.isArray(e.scale)) [a, d] = e.scale;
  else if (typeof e.scale === 'number') a = d = e.scale;
  const sx = Math.hypot(a, b);
  const rot = Math.atan2(b, a) * 180 / Math.PI;
  const sy = (a * d - b * c) / (sx || 1);
  return { rot: round2(rot), sx: Math.round(sx * 1e6) / 1e6, sy: Math.round(sy * 1e6) / 1e6 };
}

function setTransform(e, rot, sx, sy) {
  const r = ((rot % 360) + 360) % 360 * Math.PI / 180;
  const R = (v) => Math.round(v * 1e6) / 1e6;
  delete e.matrix; delete e.scale;
  const norm = ((rot % 360) + 360) % 360;
  if (Math.abs(norm) < 1e-9 || Math.abs(norm - 360) < 1e-9) {
    if (sx !== 1 || sy !== 1) e.scale = sx === sy ? sx : [sx, sy];
  } else {
    e.matrix = [R(sx * Math.cos(r)), R(sx * Math.sin(r)), R(-sy * Math.sin(r)), R(sy * Math.cos(r))];
  }
  // keep keys in the usual order: symbol, x, y, scale/matrix, ...
  const order = ['symbol', 'x', 'y', 'scale', 'matrix'];
  const copy = { ...e };
  for (const k of Object.keys(e)) delete e[k];
  for (const k of order) if (k in copy) e[k] = copy[k];
  for (const [k, v] of Object.entries(copy)) if (!order.includes(k)) e[k] = v;
}

// the path group a node belongs to: new Color(node).getRGB(), i.e. its colour offsets
function nodeGroup(e) {
  const a = (e.color && e.color.add) || [0, 0, 0];
  return ((a[0] & 255) << 16) | ((a[1] & 255) << 8) | (a[2] & 255);
}

// triggers a placement sends: a trigger pad's item and {"$trigger": ...} handlers, plus
// trigger('...') calls in a load script
function sentTriggers(e) {
  const out = [];
  if (e.props) {
    if (e.props.type === 'trigger' && e.props.item) out.push(e.props.item);
    for (const v of Object.values(e.props)) if (isTrigger(v)) { try { out.push(...triggerNames(v)); } catch { /* bad */ } }
  }
  for (const m of [].concat(e.script || []).join('\n').matchAll(/[^.\w]trigger\(\s*["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

function zoneMatrix(z) {
  let a = 1, b = 0, c = 0, d = 1;
  if (z.matrix) [a, b, c, d] = z.matrix;
  else if (Array.isArray(z.scale)) [a, d] = z.scale;
  else if (typeof z.scale === 'number') a = d = z.scale;
  return [a, b, c, d, z.x || 0, z.y || 0];
}
const det = (m) => m[0] * m[3] - m[1] * m[2];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const paths = new Map();
function zonePath2D(z) {
  const d = zonePath(z);
  let p = paths.get(d);
  if (!p) { p = new Path2D(d); if (paths.size > 500) paths.clear(); paths.set(d, p); }
  return p;
}

// M/L/Q/Z path -> polygon corners, curves cut into short straight pieces
function flattenPath(d) {
  const t = d.trim().split(/\s+/);
  const pts = [];
  let i = 0, cmd = 'M', last = [0, 0];
  const n = () => +t[i++];
  while (i < t.length) {
    if (/^[A-Za-z]$/.test(t[i])) { cmd = t[i++].toUpperCase(); if (cmd === 'Z') continue; }
    if (cmd === 'M' || cmd === 'L') { last = [n(), n()]; pts.push(last); }
    else if (cmd === 'Q') {
      const c = [n(), n()], e = [n(), n()];
      for (let s = 1; s <= 6; s++) {
        const u = s / 6, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), cc = u * u;
        pts.push([a * last[0] + b * c[0] + cc * e[0], a * last[1] + b * c[1] + cc * e[1]]);
      }
      last = e;
    } else i++;
  }
  // drop the repeated closing corner and points on top of each other
  const out = [];
  for (const p of pts.map(([x, y]) => [round2(x), round2(y)])) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function nodeColour(e) {
  const a = e.color && e.color.add;
  return a ? `rgb(${a[0]},${a[1]},${a[2]})` : '#0ff';
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'selected' || k === 'value') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== '') n.append(c);
  return n;
}

const CSS = `
#level-editor { position: fixed; inset: 0; z-index: 10; font: 12px/1.4 system-ui, sans-serif; color: #cfe; }
#level-editor .le-view { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
#level-editor .le-panel { position: absolute; top: 0; right: 0; bottom: 0; width: 300px; overflow: auto; background: rgba(8,20,20,0.94); border-left: 1px solid #244; padding: 8px 10px; box-sizing: border-box; }
#level-editor h4 { margin: 10px 0 4px; font-size: 12px; color: #8ff; }
#level-editor h4 small, #level-editor .le-layer small { color: #688; font-weight: normal; }
#level-editor button { background: #143; color: #cfe; border: 1px solid #276; border-radius: 3px; padding: 2px 6px; margin: 1px; font: inherit; cursor: pointer; }
#level-editor button.on { background: #2a7; color: #021; border-color: #4fc; }
#level-editor input, #level-editor select, #level-editor textarea { background: #021; color: #cfe; border: 1px solid #276; border-radius: 3px; font: 11px ui-monospace, monospace; }
#level-editor input[type=number] { width: 58px; }
#level-editor textarea { width: 100%; box-sizing: border-box; }
#level-editor pre { background: #021; padding: 4px; max-height: 160px; overflow: auto; font-size: 10px; margin: 2px 0; }
#level-editor .le-row { margin: 4px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
#level-editor .le-tools button { width: calc(50% - 4px); text-align: left; }
#level-editor .le-tip { color: #799; font-size: 11px; margin: 2px 0; }
#level-editor .le-warn { color: #fc6; font-size: 11px; margin: 4px 0; }
#level-editor .le-swatch { border-left: 14px solid var(--c); }
#level-editor .le-layer { display: flex; gap: 6px; align-items: center; padding: 1px 2px; border-radius: 3px; }
#level-editor .le-layer.on { background: #164; }
#level-editor .le-layer span { flex: 1; }
#level-editor .le-pick { cursor: pointer; text-decoration: underline dotted #476; }
#level-editor .le-palette button { font-size: 11px; }
#level-editor .le-stats div { margin: 1px 0; }
#level-editor .le-save { font-weight: bold; }
#level-editor .le-coords { position: absolute; left: 8px; bottom: 6px; color: #8aa; font: 11px ui-monospace, monospace; pointer-events: none; }
#level-editor .le-status { position: absolute; left: 8px; top: 6px; right: 310px; color: #cfe; pointer-events: none; text-shadow: 0 1px 2px #000; }
#level-editor .le-status.err { color: #f88; }
`;

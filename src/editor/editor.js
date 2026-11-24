// In-game level editor. Toggle with backtick (`) or open the page with ?edit.
//
// It edits the level data from levels/ (shipped in assets/levels.json), recompiles the
// level in the browser and restarts it, so the view is the real game paused on the
// level's first frame. Save writes each changed file back to levels/<NN_name>/ when the
// page is served by `npm run edit`, and downloads the files otherwise.
import { LevelApplier, restartLevel, showBriefing } from './apply.js';
import { CollisionMap, COLOURS } from './collision.js';
import { ShapeStack, isPixels, MODES, gameClass, greyOf } from './shapes.js';
import { renderPreview } from './preview.js';
import { areaMethods } from './areas.js';
import { parsePath, pathString, fromPoints, isPolygon, clone, curveCount, segEnds, nearestSeg, insertNode, removeNodes, nodeHandles, isSmooth, toggleSmooth, oppositeHandle, moveNodes } from './path.js';
import { DEPTH, LAYERS, isRef, isTrigger, triggerNames, zonePath, zoneColour, briefingJSON } from '../../tools/levels/compile.mjs';
import { pretty } from '../../tools/flash-source/format.mjs';
import { mul } from '../flash/geom.js';
import { newLevelFiles, resizeOffset, shifted, loadImage, pngBase64, validSize, settingsJSON, PAD, MIN_SIZE, MAX_SIZE } from './levelsize.js';

const PLACE_LAYERS = ['enemies', 'boxes', 'powerups', 'doors', 'features', 'pathNodes'];
const INNER_SCROLLS = '.le-shape-list, .le-decor-pal, .le-inspector, .le-artlog';
const DATA_LAYERS = [...PLACE_LAYERS, 'vision', 'decor', 'collision'];
const VIEW_LAYERS = [
  { key: 'art', label: 'Background art' },
  { key: 'collision', label: 'Collision' },
  { key: 'vision', label: 'Vision zones' },
  { key: 'enemies', label: 'Enemies' },
  { key: 'boxes', label: 'Boxes' },
  { key: 'powerups', label: 'Pickups' },
  { key: 'doors', label: 'Doors' },
  { key: 'features', label: 'Entrance, exit, player' },
  { key: 'pathNodes', label: 'Path nodes' },
  { key: 'decor', label: 'Decor (art bake)', hot: 'K' },
  { key: 'triggers', label: 'Triggers', hot: 'T' },
  { key: 'preview', label: 'Art preview', hot: 'A' },
];
// what each kind of placement does when it sends triggers
const TRIGGER_EVENTS = { powerups: ['onPickup', 'when picked up'], boxes: ['onDie', 'when destroyed'], enemies: ['onDie', 'when killed'] };
// ready-made placements offered in the palette beside the symbols
const PRESETS = {
  powerups: [
    { label: 'trigger pad', symbol: 'game objects/powerup', props: { type: 'trigger', item: '' } },
    // keycards: a key goes into the inventory; its lock pad (by a door) uses it up and sends unlock
    { label: 'keycard', symbol: 'game objects/powerup', props: { type: 'key', item: 'yellowKey' } },
    { label: 'keycard lock pad', symbol: 'game objects/powerup', props: { type: 'lock', item: 'yellowKey', unlock: 'door1:open' } },
  ],
};
const AUTO_VISION_ANGLES = 90, LOS_SAMPLE_SIZE = 15; // as2/enemyTurret.as
const NODE_LOS_SAMPLE = 10; // as2/pathNode.as
const NODE = 'game objects/node';
// a trap tile's group listens for <group>:alarm, <group>:on and <group>:off (as2/trapTile.as)
const TRAP_EVENTS = ['alarm', 'on', 'off'];
// decor (decor.json) is baked into the background by tools/art/bake.py; sprites live here
const DECOR_DIR = 'tools/art/parts/decor/';
// how each decor category is drawn by the bake when placed by hand
// the decor types the art pipeline places (tools/art/bake.py CATEGORIES)
// the names planned for levels 04-23, offered as New level's default name
const PLANNED_NAMES = ['00_Training', '01_DropZone', '02_FirstBlock', '03_Bridge', '04_Urban', '05_Gateway', '06_Downtown', '07_Shipyard', '08_Bunker', '09_Complex', '10_Interface', '11_Skyrise', '12_Transit', '13_Security', '14_Core', '15_Escape', '16_Outskirts', '17_Outpost', '18_Docking', '19_Deep Space', '20_Station', '21_Central', '22_Source', '23_Terminate'];
const DECOR_TYPES = ['panels', 'floorpaint', 'rails', 'greebles', 'vents', 'wallmarks', 'lights'];
const DECOR_DEFAULTS = { panels: { effect: 'emboss' }, floorpaint: { effect: 'paint' }, greebles: { effect: 'shadow', strength: 0.35 }, greebles2: { effect: 'shadow', strength: 0.35 }, vents: { effect: 'shadow', strength: 0.3 }, rails: { effect: 'shadow', strength: 0.25 }, lights: { effect: 'glow', strength: 0.9 } };
const T = (d) => d - 16384; // timeline depths sit 16384 below script depths, as in Flash
const TOOLS = [
  { key: 'select', label: 'Select', hot: 'V', tip: 'click anything on a shown, unlocked layer; Shift+click adds or removes one (from any layer). Drag to move (hold Shift to snap to the grid), arrows nudge 1 px (Shift: 10); R rotates, Delete removes, Ctrl+D duplicates' },
  { key: 'place', label: 'Place', hot: 'P', tip: 'pick a layer and a symbol below, then click to drop one (hold Shift to snap to the grid)' },
  { key: 'link', label: 'Path links', hot: 'N', tip: 'nodes link to every node of their colour they can see (dashed). Click a node, then another: that adds the link, or removes it if they were linked. Changed nodes keep their links pinned (solid)' },
  { key: 'rect', label: 'Rectangle', hot: 'B', tip: 'drag a box (hold Shift to snap to the grid)' },
  { key: 'poly', label: 'Polygon', hot: 'G', tip: 'click corners (hold Shift to snap: the first corner to the grid, the next ones to the angle step); click the first corner or Enter to close, Esc cancels. Draws collision or a vision zone: click either name in Layers' },
  { key: 'autozone', label: 'Auto zone', hot: 'Z', tip: 'click a spot to make a vision zone of what can be seen from there, the way the game does for an enemy outside every zone' },
  { key: 'pencil', label: 'Pencil', hot: 'D', tip: 'paint pixels; [ and ] change the size' },
  { key: 'eraser', label: 'Eraser', hot: 'E', tip: 'paint open floor; [ and ] change the size' },
  { key: 'fill', label: 'Fill', hot: 'F', tip: 'flood-fill one colour region' },
];
// the tool buttons, by what they do
const TOOL_GROUPS = [['Edit', ['select', 'place', 'link']], ['Draw shapes', ['rect', 'poly', 'autozone']], ['Paint pixels', ['pencil', 'eraser', 'fill']]];
const PANEL_W = 320; // the side panel's width (CSS .le-panel)
const DRAW_TOOLS = new Set(['rect', 'poly', 'pencil', 'eraser', 'fill']);
// layers that can be clicked and selected (every visible, unlocked one at once)
const SELECT_LAYERS = [...PLACE_LAYERS, 'decor', 'vision', 'collision'];
// every layer each tool can work on (Place: the palette's layer; Polygon: collision or a zone)
const TOOL_LAYERS = {
  select: SELECT_LAYERS, place: [...PLACE_LAYERS, 'decor'], link: ['pathNodes'], rect: ['collision'], poly: ['collision', 'vision'],
  autozone: ['vision'], pencil: ['collision'], eraser: ['collision'], fill: ['collision'],
};
const LOCKABLE = new Set([...DATA_LAYERS, 'collision']);

let editor = null;

// What the local editor server (npm run edit, tools/levels/serve.mjs) says about itself, or
// null when there is none (a static server or the Pages site): then Save downloads instead.
const serverStatus = () => fetch('__editor', { cache: 'no-store' }).then((r) => r.ok && r.json()).then((j) => (j && j.writable ? j : null)).catch(() => null);
const SERVER_POLL_MS = 3000;

export async function toggle(rt) {
  if (!editor) {
    const data = await fetch('assets/levels.json', { cache: 'no-store' }).then((r) => r.json());
    // the settings each placeable symbol reads (tools/props/spec.mjs); the panel falls back to raw JSON without it
    data.props = await fetch('assets/props.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    editor = new Editor(rt, data, await serverStatus());
    window.levelEditor = editor; // handy from the console
  }
  if (editor.isOpen) editor.close(); else await editor.open();
}

class Editor {
  constructor(rt, data, server) {
    this.rt = rt;
    this.server = server;    // latest /__editor answer, null when offline
    this.writable = !!server;
    this.applier = new LevelApplier(rt, data);
    this.palette = data.palette || {}; // layer -> library symbols placeable there (the build finds them by their class)
    this.propsSpec = data.props;   // {groups, symbols: {name: {classes, settings: [...]}}} or null
    this.openGroups = new Set(['behaviour']); // settings groups shown open in the panel
    this.levels = data.levels.map((L) => structuredClone(L));
    this.maps = {};          // level index -> CollisionMap
    this.dirty = {};         // level index -> Set of file names
    this.undoStack = [];
    this.redoStack = [];
    this.index = 0;
    this.tool = 'select';
    this.locked = {};        // layer -> true: can't be selected or edited
    this.placeLayer = 'enemies'; // the layer Place adds to
    this.polyTarget = 'collision'; // what Polygon draws: collision pixels or a vision zone
    this.visible = Object.fromEntries(VIEW_LAYERS.map((l) => [l.key, !['vision', 'preview', 'decor'].includes(l.key)]));
    this.decorIndex = null;  // tools/art/parts/decor/index.json: {category: [{file, w, h}]}
    this.decorImages = new Map();
    this.art = null;         // the art pipeline step running: {step, started}
    this.mapVersion = 0;     // bumps when a collision map or the live level changes
    this.stacks = {};        // level index -> ShapeStack (collision shapes' pixel layers)
    this.mismatch = {};      // level index -> pixels where collision.png differs from the shapes' bake
    this.outside = {};       // level index -> {diff, data}: those pixels and the map as it was loaded
    this.autoBake = true;    // bake shapes into the collision map as they're edited
    this.shapesAhead = false; // shapes edited since the last bake (only with autoBake off)
    this.openShapeGroups = new Set();
    this.preview = null;     // {index, version, canvas} art preview
    this.colour = 'wall';
    this.brush = 1;
    this.grid = 16;
    this.snapAngle = 15;
    this.selection = [];     // [{layer, k}] across layers; the last is the primary one (Shift+click adds)
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
  // the primary selection (the last clicked), or null; setting it selects just that
  get sel() { const s = this.selItems(); return s.length ? s[s.length - 1] : null; }
  set sel(v) { this.selection = v ? [{ layer: v.layer, k: v.k }] : []; this.pts = null; }
  // everything selected that still exists, primary last
  selItems() { return this.selection.filter((s) => this.list(s.layer)[s.k]); }
  isSelected(layer, k) { return this.selection.some((s) => s.layer === layer && s.k === k); }
  selLayers() { return [...new Set(this.selItems().map((s) => s.layer))]; }
  selFiles(items = this.selItems()) { return [...new Set(items.map((s) => s.layer + '.json'))]; }
  // can this layer be clicked and edited? (shown and not locked)
  editable(layer) { return !this.locked[layer] && !!this.visible[layer]; }
  // the layers the tool works on right now
  toolLayers(t = this.tool) { return t === 'place' ? [this.placeLayer] : t === 'poly' ? [this.polyTarget] : TOOL_LAYERS[t] || []; }
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
    this.resume();
    this.loop();
    this.pollServer();
  }

  // after an art bake reloads the page: the same view, layers and tool as before
  resume() {
    let r = null;
    try { r = JSON.parse(sessionStorage.getItem('levelEditorResume')); sessionStorage.removeItem('levelEditorResume'); } catch { /* none */ }
    if (!r || r.index !== this.index) return;
    if (r.view) this.view = r.view;
    if (r.visible) Object.assign(this.visible, r.visible);
    if (r.locked) this.locked = r.locked;
    if (r.placeLayer) this.placeLayer = r.placeLayer;
    if (r.polyTarget) this.polyTarget = r.polyTarget;
    if (r.tool) this.tool = r.tool;
    if (r.tab) this.tab = r.tab;
    this.refreshPanel();
    if (r.msg) this.status(r.msg);
  }

  // ------------------------------------------------------------------ server status
  // re-checked every few seconds while open, and before a save, so the badge notices
  // npm run edit stopping or starting
  async checkServer() {
    const s = await serverStatus();
    const was = this.writable;
    this.server = s;
    this.writable = !!s;
    if (was !== this.writable) this.refreshSave();
    const artNow = JSON.stringify(s && s.art);
    if (artNow !== this.lastArt && this.isOpen && !this.art) { this.lastArt = artNow; this.refreshPanel(); } else this.lastArt = artNow;
    this.renderServer();
    return s;
  }

  pollServer() {
    clearTimeout(this.pollTimer);
    if (!this.isOpen) return;
    this.checkServer().finally(() => { if (this.isOpen) this.pollTimer = setTimeout(() => this.pollServer(), SERVER_POLL_MS); });
  }

  renderServer() {
    const b = this.serverEl;
    if (!b) return;
    const s = this.server, busy = this.saving || (s && s.building);
    const state = !s ? 'offline' : busy ? 'busy' : s.lastBuild && !s.lastBuild.ok ? 'err' : 'ok';
    const ago = s && s.lastBuild ? ` · last build ${s.lastBuild.ok ? 'ok' : 'FAILED'} ${new Date(s.lastBuild.at).toLocaleTimeString()}` : '';
    b.className = 'le-server ' + state;
    b.textContent = {
      ok: 'saves to levels/',
      busy: this.saving && !(s && s.building) ? 'saving…' : 'building…',
      err: 'last build failed',
      offline: 'no server: downloads',
    }[state];
    b.title = { ok: 'Local server connected: Save writes to levels/. ', busy: 'Local server busy. ', err: 'Local server connected, but the last build failed. ', offline: 'No local server: Save downloads the files. ' }[state] + (s ? 'npm run edit (tools/levels/serve.mjs) is running at ' + location.host + ago
      : 'The editor server is not running here. Run npm run edit and open http://localhost:8123/?edit to save straight into levels/.') + ' Checked every few seconds.';
  }

  close() {
    clearTimeout(this.pollTimer);
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
    this.confirmPlace = false;
    this.artLog = '';
    this.poly = null;
    this.initShapes(i);
    this.reload();
    this.refreshPanel();
    this.loadShapes(i);
  }

  fitView() {
    const r = this.canvas.getBoundingClientRect();
    const { w, h } = this.L.size;
    const z = Math.min((r.width - PANEL_W) / w, r.height / h) * 0.95;
    this.view = { z, ox: (r.width - PANEL_W - w * z) / 2, oy: (r.height - h * z) / 2 };
  }

  // ------------------------------------------------------------------ data helpers
  list(layer) { return this.L[layer] || (this.L[layer] = []); }

  markDirty(file, i = this.index) {
    (this.dirty[i] ||= new Set()).add(file);
    if (file === 'collision.json') {
      const L = this.levels[i];
      if (L.collisionImplicit) { L.collisionImplicit = false; this.dirty[i].add('collision-base.png'); } // its first save writes the map as the base layer
      if (i === this.index) this.rebake();
    }
    this.refreshSave();
  }

  snapshot() { return JSON.stringify({ ...Object.fromEntries(DATA_LAYERS.map((l) => [l, this.L[l] || []])), settings: this.L.settings, briefing: this.L.briefing }); }

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
    this.L.briefing = o.briefing;
  }

  pushUndo(e) { this.undoStack.push(e); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack.length = 0; }

  undo(redo = false) {
    const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack;
    const e = from.pop();
    if (!e) return;
    to.push(e);
    if (e.level !== this.index) this.loadLevel(e.level);
    if (e.type === 'data') {
      if (e.outside) { this.mismatch[e.level] = redo ? 0 : e.outside.diff.length; this.outside[e.level] = redo ? null : e.outside; }
      this.restoreData(redo ? e.after : e.before);
      for (const f of e.files) this.markDirty(f);
      this.sel = null;
      this.reload();
    } else if (e.type === 'layerPixels') {
      if (this.shapes) { this.shapes.restore(redo ? e.after : e.before); this.markDirty(e.before.file); this.rebake(); }
    } else {
      this.map.restore(redo ? e.after : e.before);
      this.collisionChanged();
    }
    this.refreshPanel();
  }

  collisionChanged(refresh = true) {
    this.markDirty('collision.png');
    this.stale = true;
    this.needsReload = true;
    this.mapVersion++;
    if (refresh) this.refreshPanel();
  }

  // live clip for a placement, if the game still has it
  clipFor(layer, k) {
    const s = this.screen;
    if (!s) return null;
    let c = null;
    if (LAYERS.includes(layer)) c = s[layer + '_mc'] && s[layer + '_mc'].byDepth.get(T(k + 1));
    else if (layer === 'doors') c = s.byDepth.get(T(DEPTH.doors + k));
    else if (layer === 'features') c = s.byDepth.get(T(DEPTH.features + k));
    else if (layer === 'pathNodes') c = s.byDepth.get(T(DEPTH.features + this.list('features').length + k));
    else if (layer === 'vision') c = s.vision_mc && s.vision_mc.byDepth.get(T(2 * k + 1));
    return c && !c.removed ? c : null;
  }

  boundsOf(layer, k) {
    const e = this.list(layer)[k];
    if (layer === 'decor') return decorBounds(e, this.decorSize(e.sprite));
    if (layer === 'collision') return this.shapes ? this.shapes.boundsOf(e) : [0, 0, 0, 0];
    const c = this.clipFor(layer, k);
    if (c) {
      // around the body (core_mc) when it has one, so guns and treads don't stretch the box
      const core = c.core_mc && !c.core_mc.removed && typeof c.core_mc.getBounds === 'function' ? c.core_mc : null;
      let b = core && core.getBounds(this.screen);
      if (!b || !(b.xMax > b.xMin) || b.xMax - b.xMin >= 1e6) b = c.getBounds(this.screen);
      if (b.xMax - b.xMin < 1e6 && b.xMax > b.xMin) {
        const pad = 2;
        return [Math.min(b.xMin, e.x - 6) - pad, Math.min(b.yMin, e.y - 6) - pad, Math.max(b.xMax, e.x + 6) + pad, Math.max(b.yMax, e.y + 6) + pad];
      }
    }
    return [e.x - 8, e.y - 8, e.x + 8, e.y + 8];
  }

  // is this placement invisible in the game?
  isHidden(layer, e, k) {
    if (layer === 'decor') return false;
    if (e.props && e.props.type === 'trigger') return true;
    if (e.color && e.color.alpha === 0) return true;
    const c = this.clipFor(layer, k);
    return !!c && (!c.__visible || c._alpha <= 0 || !drawsSomething(c));
  }

  // ------------------------------------------------------------------ decor sprites
  // tools/art/parts/decor/index.json, fetched the first time the Decor layer is shown
  loadDecorIndex() {
    if (this.decorIndex || this.decorIndexLoading) return;
    this.decorIndexLoading = fetch(DECOR_DIR + 'index.json', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { this.decorIndex = j; })
      .catch((e) => { this.decorIndex = {}; this.status('Decor sprites: ' + e.message, true); })
      .finally(() => { this.decorIndexLoading = null; if (this.isOpen) this.refreshPanel(); });
  }

  decorSize(sprite) {
    const [cat] = sprite.split('/');
    const f = this.decorIndex && (this.decorIndex[cat] || []).find((s) => s.file === sprite);
    if (f) return f;
    const img = this.decorImage(sprite);
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 32, h: 32 };
  }

  // the sprite's image once it has loaded, else null (it starts loading)
  decorImage(sprite) {
    let img = this.decorImages.get(sprite);
    if (!img) { img = new Image(); img.src = DECOR_DIR + sprite; this.decorImages.set(sprite, img); }
    return img.complete && img.naturalWidth ? img : null;
  }

  // the size a sprite's category usually has (median over every level), so a new one fits in
  decorScale(sprite) {
    const cat = sprite.split('/')[0];
    const scales = this.levels.flatMap((L) => (L.decor || []).filter((e) => e.sprite.split('/')[0] === cat).map((e) => e.scale)).sort((a, b) => a - b);
    return scales.length ? scales[scales.length >> 1] : 0.3;
  }

  isNode(e) { return e && e.symbol === NODE; }
  layerShown(layer, e) {
    return this.visible[layer];
  }

  // what's under (x, y) on the visible, unlocked layers: the smallest thing there, so a pickup
  // on a big floor panel can still be clicked; vision zones (big) only when nothing else is
  hits(x, y, layers = SELECT_LAYERS) {
    const out = [];
    for (const l of layers) {
      if (l === 'vision' || l === 'collision' || !this.editable(l)) continue;
      const list = this.list(l);
      for (let k = list.length - 1; k >= 0; k--) {
        if (!this.layerShown(l, list[k])) continue;
        const [x0, y0, x1, y1] = this.boundsOf(l, k);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push({ layer: l, k, area: (x1 - x0) * (y1 - y0) });
      }
    }
    out.sort((a, b) => a.area - b.area);
    if (layers.includes('vision') && this.editable('vision')) {
      const zones = this.list('vision');
      for (let k = zones.length - 1; k >= 0; k--) if (this.inZone(zones[k], x, y)) out.push({ layer: 'vision', k, area: Infinity });
    }
    // collision shapes, top first: the one that paints the clicked pixel (locked ones never)
    if (layers.includes('collision') && this.editable('collision') && this.shapes) {
      const list = this.list('collision');
      for (let k = list.length - 1; k >= 0; k--) {
        const sh = list[k];
        if (!sh.hidden && !sh.locked && this.shapes.hit(sh, x, y, this.hitCtx)) out.push({ layer: 'collision', k, area: Infinity });
      }
    }
    return out.map(({ layer, k }) => ({ layer, k }));
  }

  // the thing to click at (x, y): one already selected if there is one (so a group can be dragged)
  hit(x, y, layers) {
    const h = this.hits(x, y, layers);
    return h.find((o) => this.isSelected(o.layer, o.k)) || h[0] || null;
  }

  // ------------------------------------------------------------------ coordinates
  toWorld(sx, sy) { const v = this.view; return [(sx - v.ox) / v.z, (sy - v.oy) / v.z]; }
  // Shift snaps: to the grid, and lines to the angle step
  snap(x, y, on) {
    if (!on || !this.grid) return [x, y];
    const g = this.grid;
    return [Math.round(x / g) * g, Math.round(y / g) * g];
  }
  snapAngleFrom(p, x, y, on) {
    if (!on || !this.snapAngle) return [x, y];
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
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { // collision shapes up / down the stack
      e.preventDefault();
      const up = e.code === 'BracketRight';
      this.reorderShapes(e.shiftKey ? (up ? Infinity : -Infinity) : up ? 1 : -1);
      return;
    }
    if (mod) return;
    if (e.key === 'Shift') this.shiftDown = true;
    if (this.areaKey(e)) { e.preventDefault(); return; }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrow && this.selPoints().length) { e.preventDefault(); this.nudgePoints(arrow[0] * (e.shiftKey ? 10 : 1), arrow[1] * (e.shiftKey ? 10 : 1)); return; }
    if (arrow) { e.preventDefault(); if (this.sel) this.nudge(arrow[0] * (e.shiftKey ? 10 : 1), arrow[1] * (e.shiftKey ? 10 : 1)); return; }
    if (/^[1-9]$/.test(e.key)) { const l = VIEW_LAYERS[+e.key - 1]; if (l) this.setVisible(l.key, !this.visible[l.key]); return; }
    const tool = TOOLS.find((t) => t.hot.toLowerCase() === k);
    if (tool) { this.setTool(tool.key); return; }
    if (k === 'r' && this.sel) { this.rotateSel(e.shiftKey ? -15 : 15); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.tool === 'poly' && this.poly) { this.poly.pop(); if (!this.poly.length) this.poly = null; return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selPoints().length) { this.deletePoints(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { this.deleteSel(); return; }
    if (e.key === 'Escape' && this.selPoints().length) { this.pts = null; this.refreshPanel(); return; }
    if (e.key === 'Escape') { this.poly = null; this.sel = null; this.linkFrom = null; this.refreshPanel(); return; }
    if (e.key === 'Enter' && this.poly) { this.closePoly(); return; }
    if (e.key === '[') { this.brush = Math.max(1, this.brush - (this.brush > 8 ? 4 : 1)); this.refreshPanel(); return; }
    if (e.key === ']') { this.brush = Math.min(64, this.brush + (this.brush >= 8 ? 4 : 1)); this.refreshPanel(); return; }
    if (k === 'w') { this.colour = 'wall'; this.refreshPanel(); return; }
    if (k === 'c') { this.colour = 'chasm'; this.refreshPanel(); return; }
    if (k === 'o') { this.colour = 'open'; this.refreshPanel(); return; }
    if (k === '0') { this.fitView(); return; }
    if (k === 'a') { this.visible.preview = !this.visible.preview; this.refreshPanel(); return; }
    if (k === 't') { this.visible.triggers = !this.visible.triggers; this.refreshPanel(); return; }
    if (k === 'k') { this.setVisible('decor', !this.visible.decor); return; }
    if (e.key === ' ') { this.spaceDown = true; e.preventDefault(); }
  }

  // tools and layers are picked separately: a tool never changes the layers, nor a layer the tool
  setTool(t) {
    this.tool = t;
    this.poly = null;
    this.linkFrom = null;
    this.refreshPanel();
  }

  // the layer Place adds to (the tabs above its palette)
  setPlaceLayer(key) {
    this.placeLayer = key;
    if (key === 'pathNodes') this.placeSymbol = NODE; // the only thing to place there
    else if (key === 'decor' ? typeof this.placeSymbol !== 'string' || !this.placeSymbol.includes('.') : this.placeSymbol === NODE || (typeof this.placeSymbol === 'string' && this.placeSymbol.includes('.'))) this.placeSymbol = null;
    if (key === 'decor') this.loadDecorIndex();
    this.refreshPanel();
  }

  // point the tools that can work on a layer at it (Place's layer, what Polygon draws),
  // without changing the tool; the layer is shown if it was hidden
  pickLayer(key) {
    this.pickedLayer = key;
    if (TOOL_LAYERS.place.includes(key)) { this.setPlaceLayer(key); }
    if (key === 'collision' || key === 'vision') { this.polyTarget = key; this.poly = null; }
    if (!this.visible[key]) this.setVisible(key, true);
    this.refreshPanel();
  }

  // can the tool work on its layer now? Says why not in the status line
  toolReady() {
    const l = this.toolLayers().find((x) => this.locked[x]);
    if (l) { this.status(`${layerLabel(l)} is locked: unlock it in Layers to edit it.`, true); return false; }
    return true;
  }

  setVisible(key, on) {
    this.visible[key] = on;
    if (!on) this.selection = this.selection.filter((s) => s.layer !== key);
    if (on && key === 'decor') this.loadDecorIndex();
    this.refreshPanel();
  }

  setLocked(key, on) {
    if (on) this.locked[key] = true; else delete this.locked[key];
    if (on) this.selection = this.selection.filter((s) => s.layer !== key);
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
    if (this.areaMouseDown(e, x, y)) return; // a kit area list picked in the Art tab takes the map
    const t = this.tool;
    if (t !== 'select' && !this.toolReady()) return;
    if (t === 'select') {
      const part = this.zonePartAt(sx, sy);
      if (part && this.zoneMouseDown(part, e, x, y)) return;
      // a click on the edited zone's edge (perhaps just outside its fill) is a click on the zone
      const h = part && part.kind === 'edge' ? { layer: part.layer, k: part.k } : this.hit(x, y);
      let toggleOff = null;
      // on nothing: a drag boxes points of the zone being edited; a click clears the selection
      if (!h && this.editZone()) { this.drag = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y, shift: e.shiftKey }; return; }
      if (!h) { if (!e.shiftKey) this.sel = null; this.refreshPanel(); return; } // Shift+click on nothing keeps the selection
      if (!e.shiftKey) this.pts = null;
      const i = this.selection.findIndex((s) => s.layer === h.layer && s.k === h.k);
      if (i < 0) { if (e.shiftKey) this.selection.push(h); else this.sel = h; } // Shift+click adds, from any layer
      else {
        this.selection.push(...this.selection.splice(i, 1)); // clicking a selected one keeps the group (it becomes the primary)
        if (e.shiftKey) toggleOff = h; // Shift+click on a selected one takes it out, unless it gets dragged
      }
      this.drag = { kind: 'move', x, y, toggleOff, starts: this.selItems().map((s) => ({ ...s, x: this.list(s.layer)[s.k].x, y: this.list(s.layer)[s.k].y })), before: this.snapshot(), moved: false };
      this.refreshPanel();
    } else if (t === 'place') {
      if (!this.placeSymbol) { this.status('Pick something to place first.', true); return; }
      const [px, py] = this.snap(x, y, e.shiftKey);
      this.placeAt(px, py);
    } else if (t === 'link') {
      const h = this.hit(x, y, ['pathNodes']);
      if (!h) { this.linkFrom = null; if (!this.editable('pathNodes')) this.status('Show and unlock Path nodes to link them.', true); return; }
      if (this.linkFrom == null || this.linkFrom === h.k) { this.linkFrom = h.k; this.sel = h; this.refreshPanel(); return; }
      this.toggleLink(this.linkFrom, h.k);
      this.linkFrom = h.k;
    } else if (t === 'autozone') {
      this.autoZone(x, y);
    } else if (t === 'rect') {
      const [px, py] = this.snap(x, y, e.shiftKey);
      this.drag = { kind: 'rect', x0: px, y0: py, x1: px, y1: py };
    } else if (t === 'poly') {
      let p = [x, y];
      if (this.poly && this.poly.length) {
        const first = this.poly[0];
        if (this.poly.length > 2 && Math.hypot(first[0] - x, first[1] - y) * this.view.z < 10) { this.closePoly(); return; }
        p = this.snapAngleFrom(this.poly[this.poly.length - 1], x, y, e.shiftKey);
      } else p = this.snap(x, y, e.shiftKey);
      (this.poly ||= []).push(p);
    } else if (t === 'pencil' || t === 'eraser') {
      const colour = t === 'eraser' ? 'open' : this.colour;
      const layer = this.pixelTarget();
      if (!layer) return;
      const st = this.shapes, f = layer.pixels, ox = Math.round(layer.x || 0), oy = Math.round(layer.y || 0);
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      const before = st.grab(f, 0, 0, st.w, st.h);
      st.dab(f, x - ox, y - oy, this.brush, colour, box);
      st.commit(f, box);
      this.rebake([box[0] + ox, box[1] + oy, box[2] + ox, box[3] + oy]);
      this.drag = { kind: 'paint', colour, box, before, lx: x, ly: y, file: f, ox, oy };
    } else if (t === 'fill') {
      const area = this.map.floodMask(x, y);
      if (!area || area.colour === this.colour) return;
      const layer = this.pixelTarget();
      if (!layer) return;
      const st = this.shapes, f = layer.pixels, ox = Math.round(layer.x || 0), oy = Math.round(layer.y || 0);
      const before = st.grab(f, 0, 0, st.w, st.h);
      st.paintMask(f, area.mask, area.x - ox, area.y - oy, area.w, area.h, this.colour);
      const b = st.commit(f, [area.x - ox, area.y - oy, area.x - ox + area.w, area.y - oy + area.h]);
      if (b) this.pushUndo({ type: 'layerPixels', level: this.index, ...cropUndo(st, f, before, b) });
      this.markDirty(f);
      this.rebake([area.x, area.y, area.x + area.w, area.y + area.h]);
      this.refreshPanel();
    }
  }

  onMouseMove(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [x, y] = this.toWorld(sx, sy);
    this.mouse = { x, y, sx, sy, shift: e.shiftKey };
    this.shiftDown = e.shiftKey;
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pan') { this.view.ox = d.ox + sx - d.sx; this.view.oy = d.oy + sy - d.sy; }
    else if (this.areaMouseMove(e, x, y)) return;
    else if (d.kind === 'move') {
      const p0 = d.starts[d.starts.length - 1]; // the primary (the one clicked)
      let nx = p0.x + x - d.x, ny = p0.y + y - d.y;
      [nx, ny] = this.snap(nx, ny, e.shiftKey); // Shift snaps the one under the mouse to the grid
      const dx = nx - p0.x, dy = ny - p0.y;
      if (!d.moved && Math.hypot(x - d.x, y - d.y) * this.view.z < 2) return; // a click, not a drag
      d.moved = true;
      for (const s0 of d.starts) this.moveTo(s0.layer, s0.k, s0.x + dx, s0.y + dy);
    } else if (d.kind === 'points') {
      if (!d.moved && Math.hypot(x - d.x, y - d.y) * this.view.z < 2) return; // a click, not a drag
      d.moved = true;
      const z = this.list(d.layer)[d.k], list = this.selPoints();
      // the point that was clicked follows the mouse (Shift snaps it to the grid); the rest keep up
      const p0 = d.from[d.ci].nodes[d.i], w0 = apply(zoneMatrix(z), p0);
      const [wx, wy] = this.snap(w0[0] + x - d.x, w0[1] + y - d.y, e.shiftKey);
      const [lx, ly] = this.zoneLocal(z, wx, wy);
      const cs = clone(d.from);
      moveNodes(cs, d.from, list, round2(lx - p0[0]), round2(ly - p0[1]));
      this.setZoneContours(z, cs);
    } else if (d.kind === 'handle') {
      d.moved = true;
      const z = this.list(d.layer)[d.k], cs = this.zoneContours(z), k = cs[d.ci];
      const p = this.zoneLocal(z, ...this.snap(x, y, e.shiftKey)).map(round2);
      k.segs[d.si].c[d.h] = p;
      if (d.opp) { // a smooth node stays smooth: the other handle swings round, keeping its length
        const node = k.nodes[d.opp.node], o = k.segs[d.opp.si].c[d.opp.h];
        const len = Math.hypot(o[0] - node[0], o[1] - node[1]), a = Math.atan2(node[1] - p[1], node[0] - p[0]);
        k.segs[d.opp.si].c[d.opp.h] = [round2(node[0] + Math.cos(a) * len), round2(node[1] + Math.sin(a) * len)];
      }
      this.setZoneContours(z, cs);
    } else if (d.kind === 'marquee') { d.x1 = x; d.y1 = y; }
    else if (d.kind === 'rect') { [d.x1, d.y1] = this.snap(x, y, e.shiftKey); }
    else if (d.kind === 'paint') {
      const st = this.shapes, seg = [Infinity, Infinity, -Infinity, -Infinity];
      st.line(d.file, d.lx - d.ox, d.ly - d.oy, x - d.ox, y - d.oy, this.brush, d.colour, seg);
      st.commit(d.file, seg);
      for (let j = 0; j < 2; j++) { d.box[j] = Math.min(d.box[j], seg[j]); d.box[j + 2] = Math.max(d.box[j + 2], seg[j + 2]); }
      this.rebake([seg[0] + d.ox, seg[1] + d.oy, seg[2] + d.ox, seg[3] + d.oy]);
      d.lx = x; d.ly = y;
    }
  }

  onMouseUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (this.areaMouseUp(d)) return;
    if ((d.kind === 'points' || d.kind === 'handle') && d.moved) {
      this.pushUndo({ type: 'data', level: this.index, before: d.before, after: this.snapshot(), files: [d.file] });
      this.markDirty(d.file);
      if (d.layer === 'vision') this.reload();
      this.refreshPanel();
    } else if (d.kind === 'points' && d.toggleOff) {
      this.pts.list = this.pts.list.filter((q) => !(q.ci === d.toggleOff.ci && q.i === d.toggleOff.i));
      this.refreshPanel();
    } else if (d.kind === 'marquee') {
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * this.view.z < 3) { if (!d.shift) this.sel = null; } // a click
      else {
        const ez = this.editZone(), cs = this.zoneContours(ez.z), M = zoneMatrix(ez.z);
        const [ax, bx] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)], [ay, by] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
        const list = d.shift ? this.selPoints().slice() : [];
        cs.forEach((k, ci) => k.nodes.forEach((p, i) => {
          const [wx, wy] = apply(M, p);
          if (wx >= ax && wx <= bx && wy >= ay && wy <= by && !list.some((q) => q.ci === ci && q.i === i)) list.push({ ci, i });
        }));
        this.pts = { k: ez.k, list };
      }
      this.refreshPanel();
    } else if (d.kind === 'move' && d.moved) {
      const files = this.selFiles(d.starts);
      this.pushUndo({ type: 'data', level: this.index, before: d.before, after: this.snapshot(), files });
      for (const f of files) this.markDirty(f);
      this.needsReload = true; // positions are live already; rebuild before playing
      this.refreshPanel();
    } else if (d.kind === 'move' && d.toggleOff) {
      this.selection = this.selection.filter((s) => !(s.layer === d.toggleOff.layer && s.k === d.toggleOff.k));
      this.refreshPanel();
    } else if (d.kind === 'rect') {
      if (d.x0 !== d.x1 && d.y0 !== d.y1) {
        const [ax, bx] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)], [ay, by] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
        this.addShape(this.colour, pathString(fromPoints([[ax, ay], [bx, ay], [bx, by], [ax, by]])));
      }
    } else if (d.kind === 'paint') {
      const st = this.shapes, b = this.map.clampBox(...d.box);
      if (b) {
        this.pushUndo({ type: 'layerPixels', level: this.index, ...cropUndo(st, d.file, d.before, b) });
        this.markDirty(d.file);
        this.refreshPanel();
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
    if (this.polyTarget === 'vision') { this.addZone(p); return; }
    this.addShape(this.colour, pathString(fromPoints(p.map(([x, y]) => [round2(x), round2(y)]))));
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
    const layer = this.placeLayer;
    if (!this.visible[layer]) this.setVisible(layer, true); // what you place should show
    if (layer === 'decor') {
      const sprite = this.placeSymbol;
      const cat = sprite.split('/')[0];
      const ent = { sprite, x: Math.round(x), y: Math.round(y), scale: this.decorScale(sprite), rotation: 0, ...(DECOR_DEFAULTS[cat] || {}) };
      this.change(['decor.json'], () => this.list('decor').push(ent), { reload: false });
      this.sel = { layer, k: this.list(layer).length - 1 };
      this.refreshPanel();
      return;
    }
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
      const nodes = this.list('pathNodes');
      const sel = this.sel && this.sel.layer === 'pathNodes' ? nodes[this.sel.k] : null;
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

  // does changing these layers need the level rebuilt? (decor is only drawn by the editor)
  needsRebuild(items) { return items.some((s) => s.layer !== 'decor'); }

  duplicate() {
    const items = this.selItems();
    if (!items.length) return;
    const copies = items.map(({ layer, k }) => {
      const ent = structuredClone(this.list(layer)[k]);
      ent.x = round2(ent.x + (this.grid || 16)); ent.y = round2(ent.y + (this.grid || 16));
      if (layer === 'pathNodes') { delete ent.name; delete ent.props; } // the copy links itself by line of sight
      else if (layer === 'collision') {
        ent.name = this.shapeName((ent.name || 'shape').replace(/ \d+$/, ''));
        delete ent.locked;
        if (isPixels(ent)) { const f = this.newPixelsFile(); this.shapes.copy(ent.pixels, f); ent.pixels = f; this.markDirty(f); ent.x = Math.round(ent.x); ent.y = Math.round(ent.y); }
      } else if (ent.name) delete ent.name;
      return { layer, ent };
    });
    const added = [];
    this.change(this.selFiles(items), () => {
      for (const { layer, ent } of copies) {
        const list = this.list(layer);
        if (layer === 'doors' && ent.props && ent.props.id) {
          let n = 1;
          const ids = new Set(list.map((d) => d.props && d.props.id));
          while (ids.has('door' + n)) n++;
          ent.props.id = 'door' + n;
        }
        list.push(ent);
        added.push({ layer, k: list.length - 1 });
      }
    }, { reload: this.needsRebuild(items) });
    this.selection = added;
    this.refreshPanel();
  }

  deleteSel() {
    const items = this.selItems();
    if (!items.length) return;
    this.change(this.selFiles(items), () => {
      for (const layer of new Set(items.map((s) => s.layer))) {
        const list = this.list(layer);
        const keys = items.filter((s) => s.layer === layer).map((s) => s.k).sort((a, b) => b - a);
        const names = keys.map((k) => list[k].name).filter(Boolean);
        for (const k of keys) list.splice(k, 1);
        // drop links to deleted nodes
        if (names.length && layer === 'pathNodes') for (const e of list) if (e.props && Array.isArray(e.props.connections)) e.props.connections = e.props.connections.filter((c) => !(isRef(c) && names.includes(c.$ref)));
      }
    }, { reload: this.needsRebuild(items) });
    this.sel = null;
    this.refreshPanel();
  }

  // put one thing at (x, y), moving its clip in the game too so it shows without a rebuild
  moveTo(layer, k, x, y) {
    const ent = this.list(layer)[k];
    if (layer === 'collision') {
      ent.x = isPixels(ent) ? Math.round(x) : round2(x); ent.y = isPixels(ent) ? Math.round(y) : round2(y);
      this.rebake();
      return;
    }
    ent.x = round2(x); ent.y = round2(y);
    const c = this.clipFor(layer, k);
    if (c) { c._x = ent.x; c._y = ent.y; }
  }

  // arrow keys: move the selection by (dx, dy) px; presses in a row make one undo step
  nudge(dx, dy) {
    const items = this.selItems();
    if (!items.length) return;
    const key = this.index + ':' + JSON.stringify(items), last = this.undoStack[this.undoStack.length - 1];
    const join = last && last.nudge === key && Date.now() - last.at < 1500 && !this.redoStack.length;
    const before = join ? null : this.snapshot();
    for (const { layer, k } of items) { const e = this.list(layer)[k]; this.moveTo(layer, k, e.x + dx, e.y + dy); }
    const files = this.selFiles(items);
    if (join) { last.after = this.snapshot(); last.at = Date.now(); }
    else this.pushUndo({ type: 'data', level: this.index, before, after: this.snapshot(), files, nudge: key, at: Date.now() });
    for (const f of files) this.markDirty(f);
    this.needsReload = true;
    clearTimeout(this.nudgeTimer); // the panel's x, y catch up once the keys stop
    this.nudgeTimer = setTimeout(() => this.refreshPanel(), 150);
  }

  // line the selection up (same x or y, the middle of their spread), or space it evenly
  // between the outermost two
  arrange(axis, how) {
    const items = this.selItems();
    if (items.length < (how === 'space' ? 3 : 2)) return;
    const ents = items.map((s) => ({ ...s, e: this.list(s.layer)[s.k] }));
    const vals = ents.map((o) => o.e[axis]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    this.change(this.selFiles(items), () => {
      if (how === 'align') for (const o of ents) o.e[axis] = round2((lo + hi) / 2);
      else ents.sort((a, b) => a.e[axis] - b.e[axis]).forEach((o, i) => { o.e[axis] = round2(lo + (hi - lo) * i / (ents.length - 1)); });
    }, { reload: this.needsRebuild(items) });
  }

  // turn (degrees, clockwise on screen) and scale the selection: one thing about its own
  // origin, a group about its centre
  transformSel(deg, f = 1, items = this.selItems()) {
    if (!items.length) return;
    const ents = items.map((s) => [s.layer, this.list(s.layer)[s.k]]);
    const group = ents.length > 1;
    const cx = ents.reduce((a, [, e]) => a + e.x, 0) / ents.length, cy = ents.reduce((a, [, e]) => a + e.y, 0) / ents.length;
    const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    for (const [layer, e] of ents) {
      if (layer === 'collision' && isPixels(e)) continue; // pixel layers only move
      if (group) {
        const dx = e.x - cx, dy = e.y - cy;
        e.x = round2(cx + f * (dx * cos - dy * sin)); e.y = round2(cy + f * (dx * sin + dy * cos));
      }
      if (layer === 'decor') {
        e.rotation = round2((((e.rotation || 0) - deg) % 360 + 360) % 360);
        if (f !== 1) e.scale = Math.round((e.scale || 1) * f * 1e4) / 1e4;
      } else {
        const t = transformOf(e);
        setTransform(e, t.rot + deg, t.sx * f, t.sy * f);
      }
    }
  }

  rotateSel(deg) {
    const items = this.selItems();
    if (!items.length) return;
    this.change(this.selFiles(items), () => this.transformSel(deg, 1, items), { reload: this.needsRebuild(items) });
  }

  toggleLink(a, b) {
    const list = this.list('pathNodes');
    const A = list[a], B = list[b];
    const nameOf = (e) => e.name || (e.name = this.uniqueName('n'));
    const auto = this.autoLinks();
    this.change(['pathNodes.json'], () => {
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
    const e = this.list('pathNodes')[k];
    this.change(['pathNodes.json'], () => {
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
    const nodes = this.list('pathNodes').map((e, k) => [e, k]);
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

  // ------------------------------------------------------------------ collision shapes
  // L.collision is collision.json: the shapes, bottom first, baked into collision.png (src/editor/
  // shapes.js). A level without one starts as a single locked pixel layer holding its map.
  // this.stacks[i] holds a level's pixel layers once they've loaded; until then shape editing waits.
  get shapes() { const s = this.stacks[this.index]; return s && s.ready ? s : null; }
  isShapePixels(e) { return isPixels(e); }

  initShapes(i) {
    const L = this.levels[i];
    if (!Array.isArray(L.collision)) { L.collision = [{ name: 'original map', pixels: 'collision-base.png', locked: true }]; L.collisionImplicit = true; }
    for (const s of L.collision) { s.x ??= 0; s.y ??= 0; }
  }

  async loadShapes(i) {
    if (this.stacks[i]) return;
    this.initShapes(i);
    const L = this.levels[i], map = this.maps[i] || (i === this.index ? this.map : null);
    if (!map) return;
    const st = this.stacks[i] = new ShapeStack(map.w, map.h);
    const load = (file) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = `levels/${L.folder}/${file}?t=${Date.now()}`;
    });
    for (const s of L.collision) {
      if (!isPixels(s) || st.canvases.has(s.pixels)) continue;
      const img = L.collisionImplicit ? null : await load(s.pixels);
      if (img) st.setImage(s.pixels, img);
      else if (s.pixels === 'collision-base.png') st.setImage(s.pixels, map.canvas); // the map itself
      else this.status(`Could not load levels/${L.folder}/${s.pixels}; that layer is empty.`, true);
    }
    st.ready = true;
    // does the game read collision.png the same as what the shapes bake to? (not if it was
    // edited outside them; soft edges a grey or two apart don't count)
    const diff = classDiff(st.bake(L.collision), map.data);
    this.mismatch[i] = diff.length;
    // keep them as loaded: until the choice is made the shapes don't bake, and Keep the map uses these
    this.outside[i] = diff.length ? { diff, data: new Uint8ClampedArray(map.data.data) } : null;
    if (i === this.index) this.refreshPanel();
  }

  // shapes -> collision map. Live while editing (this.autoBake), else only when forced. While
  // collision.png has edits outside the shapes nothing is baked until you pick Keep the map or Use
  // the shapes (discard: replace those edits); returns whether the map is now the shapes' bake
  rebake(box, force = false, discard = false) {
    const st = this.shapes;
    if (!st) return false;
    if (this.mismatch[this.index] && !discard) {
      this.shapesAhead = true;
      this.status(`collision.png has ${this.mismatch[this.index]} pixels edited outside the shapes: pick Keep the map or Use the shapes (the shape stack under Collision in Layers) before the shapes bake.`, true);
      return false;
    }
    if (!this.autoBake && !force) { this.shapesAhead = true; return false; }
    if (this.mismatch[this.index]) { box = null; this.mismatch[this.index] = 0; this.outside[this.index] = null; } // the map takes the shapes' pixels everywhere
    let b = box ? this.map.clampBox(box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1) : [0, 0, st.w, st.h];
    if (!b) return false;
    const changed = this.map.putRegion(st.bake(this.list('collision'), b), b[0], b[1]);
    if (!box) this.shapesAhead = false;
    if (changed) this.collisionChanged(false);
    return true;
  }

  bakeCollision(discard = false) {
    const ok = this.rebake(null, true, discard);
    if (ok) this.status(discard ? 'Collision map re-baked from the shapes; its outside edits are gone (git still has them).' : 'Collision map baked from the shapes.');
    this.refreshPanel();
    return ok;
  }

  // keep collision.png as it is: its pixels the shapes don't make go in a locked layer on top
  // (the pixels that differed when the level loaded, so shape edits made meanwhile still apply)
  keepMap() {
    const st = this.shapes, o = this.outside[this.index];
    if (!st || !o) return;
    const d = o.data, file = this.newPixelsFile('edits'), q = st.data(file).data;
    for (const k of o.diff) { q[k] = d[k]; q[k + 1] = d[k + 1]; q[k + 2] = d[k + 2]; q[k + 3] = 255; }
    st.commit(file, [0, 0, st.w, st.h]);
    this.mismatch[this.index] = 0;
    this.outside[this.index] = null;
    this.change(['collision.json', file], () => this.list('collision').push({ name: 'map edits', pixels: file, x: 0, y: 0, locked: true }), { reload: false });
    const e = this.undoStack[this.undoStack.length - 1];
    if (e && e.files.includes(file)) e.outside = o; // undoing this brings the choice back
  }

  newPixelsFile(base = 'pixels') {
    const used = new Set(this.list('collision').filter(isPixels).map((s) => s.pixels));
    for (const f of this.shapes ? this.shapes.canvases.keys() : []) used.add(f);
    let n = 1;
    while (used.has(`collision-${base}-${n}.png`)) n++;
    return `collision-${base}-${n}.png`;
  }

  shapeName(prefix) {
    const used = new Set(this.list('collision').map((s) => s.name));
    let n = 1;
    while (used.has(`${prefix} ${n}`)) n++;
    return `${prefix} ${n}`;
  }

  // a new vector shape on top, selected
  addShape(mode, d) {
    if (!this.shapes) { this.status('Collision shapes are still loading.', true); return; }
    const list = this.list('collision');
    this.change(['collision.json'], () => list.push({ name: this.shapeName(mode), mode, d, x: 0, y: 0 }), { reload: false });
    this.sel = { layer: 'collision', k: list.length - 1 };
    this.refreshPanel();
  }

  // the pixel layer pencil, eraser and fill paint into: the selected one, else a new one on top
  pixelTarget() {
    const st = this.shapes;
    if (!st) { this.status('Collision shapes are still loading.', true); return null; }
    const s = this.sel, list = this.list('collision');
    if (s && s.layer === 'collision' && isPixels(list[s.k]) && !list[s.k].locked && !list[s.k].hidden) return list[s.k];
    const file = this.newPixelsFile();
    st.canvas(file);
    const layer = { name: this.shapeName('pixels'), pixels: file, x: 0, y: 0 };
    this.change(['collision.json'], () => list.push(layer), { reload: false });
    this.sel = { layer: 'collision', k: list.length - 1 };
    this.refreshPanel();
    return layer;
  }

  // move the selected shapes up (+1) or down (-1) the stack, or to the top / bottom (+-Infinity)
  reorderShapes(dir) {
    const list = this.list('collision');
    const picked = this.selItems().filter((s) => s.layer === 'collision').map((s) => s.k);
    if (!picked.length) return;
    const set = new Set(picked);
    const entries = list.map((e, k) => ({ e, k, on: set.has(k) }));
    let order;
    if (!isFinite(dir)) {
      const on = entries.filter((x) => x.on), off = entries.filter((x) => !x.on);
      order = dir > 0 ? [...off, ...on] : [...on, ...off];
    } else {
      order = entries.slice();
      const idx = order.map((_, i) => i);
      const step = (i) => { const j = i + dir; if (j < 0 || j >= order.length || order[j].on) return; [order[i], order[j]] = [order[j], order[i]]; };
      if (dir > 0) for (let i = idx.length - 1; i >= 0; i--) { if (order[i].on) step(i); }
      else for (let i = 0; i < idx.length; i++) { if (order[i].on) step(i); }
    }
    const primary = this.sel;
    this.change(['collision.json'], () => { list.splice(0, list.length, ...order.map((x) => x.e)); }, { reload: false });
    const at = new Map(order.map((x, i) => [x.k, i]));
    this.selection = this.selection.map((s) => (s.layer === 'collision' ? { layer: 'collision', k: at.get(s.k) } : s));
    if (primary && primary.layer === 'collision') { // keep the primary last
      const p = this.selection.findIndex((s) => s.layer === 'collision' && s.k === at.get(primary.k));
      if (p >= 0) this.selection.push(...this.selection.splice(p, 1));
    }
    this.refreshPanel();
  }

  setShapeFlag(ks, key, on) {
    const list = this.list('collision');
    this.change(['collision.json'], () => { for (const k of ks) { if (on) list[k][key] = true; else delete list[k][key]; } }, { reload: false });
  }

  // the stack, top first, with an eye and a lock per shape; consecutive shapes in a group fold
  // into one row
  shapesPanel() {
    const list = this.list('collision'), st = this.shapes;
    const box = el('div', { class: 'le-shapes', title: '' },
      el('div', { class: 'le-label', title: 'Shapes paint in order, bottom first; hidden ones are left out. Rectangle and Polygon add a vector shape in the chosen colour; Pencil, Eraser and Fill paint into the selected pixel layer (or a new one). Select picks shapes on the map, drags and nudges them, and edits a vector shape\'s points and curves.' },
        'Shape stack ', el('small', {}, `top paints last${this.L.collisionImplicit ? ' · no collision.json yet' : ''}`)));
    if (!st) { box.append(el('div', { class: 'le-tip' }, 'Loading…')); return box; }
    const mm = this.mismatch[this.index];
    if (mm) box.append(el('div', { class: 'le-warn' }, `collision.png differs from what these shapes bake to in ${mm} pixels (it was edited outside them). Shape edits won't bake into it until you pick one:`,
      el('div', { class: 'le-row' },
        el('button', { title: 'add the pixels only collision.png has as a locked layer on top, so the bake matches it', onclick: () => this.keepMap() }, 'Keep the map: add its edits as a layer'),
        el('button', { title: 'replace collision.png with the shapes\' bake', onclick: () => this.bakeCollision(true) }, 'Use the shapes'))));
    const rows = el('div', { class: 'le-shape-list' });
    const selected = new Set(this.selItems().filter((s) => s.layer === 'collision').map((s) => s.k));
    const pick = (ks, e) => {
      if (e.shiftKey) { for (const k of ks) { if (!selected.has(k)) this.selection.push({ layer: 'collision', k }); else if (ks.length === 1) this.selection = this.selection.filter((s) => !(s.layer === 'collision' && s.k === k)); } }
      else this.selection = ks.map((k) => ({ layer: 'collision', k }));
      this.pts = null;
      this.refreshPanel();
    };
    const swatch = (s) => el('span', { class: 'le-mode', style: isPixels(s) ? '' : `--c: rgb(${greyOf(s)},${greyOf(s)},${greyOf(s)})`, title: isPixels(s) ? 'pixels' : s.mode + (s.outline ? ` outline ${s.outline}px` : '') }, isPixels(s) ? '▦' : s.outline ? '▢' : '■');
    const row = (s, k, indent) => el('div', { class: 'le-shape' + (selected.has(k) ? ' on' : '') + (s.hidden ? ' hidden' : '') + (indent ? ' in' : '') },
      el('button', { class: 'le-icon' + (s.hidden ? '' : ' on'), title: s.hidden ? 'show: bake it' : 'hide: leave it out of the bake', onclick: () => this.setShapeFlag([k], 'hidden', !s.hidden) }, s.hidden ? ICON.eyeOff : ICON.eye),
      el('button', { class: 'le-icon' + (s.locked ? ' on' : ''), title: s.locked ? 'unlock' : 'lock: can\'t be selected on the map or edited', onclick: () => this.setShapeFlag([k], 'locked', !s.locked) }, s.locked ? ICON.lock : ICON.unlock),
      swatch(s), el('span', { class: 'le-name', onclick: (e) => pick([k], e) }, s.name || `shape ${k + 1}`));
    // top first
    for (let k = list.length - 1; k >= 0;) {
      const g = list[k].group;
      if (!g) { rows.append(row(list[k], k, false)); k--; continue; }
      const ks = [];
      while (k >= 0 && list[k].group === g) ks.push(k--);
      const open = this.openShapeGroups.has(g), shown = ks.filter((j) => !list[j].hidden).length;
      rows.append(el('div', { class: 'le-shape group' + (ks.every((j) => selected.has(j)) ? ' on' : '') },
        el('button', { class: 'le-icon' + (shown ? ' on' : ''), title: shown ? 'hide them all' : 'show them all', onclick: () => this.setShapeFlag(ks, 'hidden', !!shown) }, shown ? ICON.eye : ICON.eyeOff),
        el('button', { class: 'le-icon', title: open ? 'fold' : 'unfold', onclick: () => { this.openShapeGroups[open ? 'delete' : 'add'](g); this.refreshPanel(); } }, open ? '▾' : '▸'),
        el('span', { class: 'le-name', title: 'click to select them all', onclick: (e) => pick(ks, e) }, `${g} `, el('small', {}, `${shown}/${ks.length} shown`))));
      if (open) for (const j of ks) rows.append(row(list[j], j, true));
    }
    const any = selected.size > 0;
    box.append(rows,
      el('div', { class: 'le-row' },
        el('button', { disabled: !any, title: 'to the top (Ctrl+Shift+])', onclick: () => this.reorderShapes(Infinity) }, '⤒'),
        el('button', { disabled: !any, title: 'up one (Ctrl+])', onclick: () => this.reorderShapes(1) }, '↑'),
        el('button', { disabled: !any, title: 'down one (Ctrl+[)', onclick: () => this.reorderShapes(-1) }, '↓'),
        el('button', { disabled: !any, title: 'to the bottom (Ctrl+Shift+[)', onclick: () => this.reorderShapes(-Infinity) }, '⤓'),
        el('button', { disabled: !any, title: 'delete the selected shapes', onclick: () => this.deleteSel() }, '✕'),
        el('span', { class: 'le-grow' }),
        el('button', { title: 'a new empty pixel layer on top for Pencil, Eraser and Fill', onclick: () => { this.sel = null; this.pixelTarget(); } }, '+ Pixels')),
      el('div', { class: 'le-row' },
        el('label', { title: 'bake the shapes into collision.png as you edit them; off, the map only changes when you press Bake collision' },
          el('input', { type: 'checkbox', checked: this.autoBake, onchange: (ev) => { this.autoBake = ev.target.checked; if (this.autoBake && this.shapesAhead) this.bakeCollision(); else this.refreshPanel(); } }), ' Bake as I edit'),
        el('button', { class: this.shapesAhead ? 'le-hot' : '', title: 'shapes -> collision.png now (step 1; Bake art in the Art tab is step 2 and reads only collision.png)', onclick: () => this.bakeCollision() }, 'Bake collision')),
      this.shapesAhead ? el('div', { class: 'le-warn' }, 'The shapes changed since the collision map was baked.') : '');
    return box;
  }

  shapePanel() {
    const { k } = this.sel;
    const s = this.list('collision')[k], file = 'collision.json';
    const num = (label, val, set) => this.liveNum(label, round2(val), set, { file, reload: false });
    const setMode = (m) => this.change([file], () => { s.mode = m; delete s.grey; }, { reload: false });
    return el('div', { class: 'le-props' },
      this.inspHead(s.name || (isPixels(s) ? 'Pixel layer' : 'Collision shape'), `${isPixels(s) ? 'pixel layer' : 'shape'} #${k + 1} of ${this.list('collision').length}`, { rotate: !isPixels(s), reorder: true }),
      el('label', { class: 'le-set' }, el('span', { class: 'le-set-name' }, 'name'), el('input', { value: s.name || '', onchange: (ev) => this.change([file], () => { s.name = ev.target.value.trim() || s.name; }, { reload: false }) })),
      isPixels(s) ? el('div', { class: 'le-tip' }, `${s.pixels}: Pencil, Eraser and Fill paint here while it's selected. Its pixels keep their own colours.`)
        : el('div', { class: 'le-row' }, el('span', { class: 'le-label' }, 'Paints'), ...MODES.map((m) => el('button', { class: 'le-swatch ' + (s.mode === m ? 'on' : ''), style: `--c: rgb(${COLOURS[m].join(',')})`, onclick: () => setMode(m) }, m))),
      isPixels(s) ? '' : el('label', { class: 'le-set' }, el('span', { class: 'le-set-name' }, 'outline px'), el('input', { type: 'number', min: 0, max: 64, step: 1, value: s.outline || 0, style: 'width: 4em', title: '0 fills the shape; more strokes its edge that many px wide instead', onchange: (ev) => this.change([file], () => { const v = Math.max(0, +ev.target.value || 0); if (v) s.outline = v; else delete s.outline; }, { reload: false }) })),
      el('div', { class: 'le-xform' }, num('x', s.x || 0, (v) => { s.x = isPixels(s) ? Math.round(v) : v; this.rebake(); }), num('y', s.y || 0, (v) => { s.y = isPixels(s) ? Math.round(v) : v; this.rebake(); })),
      el('div', { class: 'le-row' },
        el('label', {}, el('input', { type: 'checkbox', checked: !s.hidden, onchange: (ev) => this.setShapeFlag([k], 'hidden', !ev.target.checked) }), ' baked'),
        el('label', {}, el('input', { type: 'checkbox', checked: !!s.locked, onchange: (ev) => this.setShapeFlag([k], 'locked', ev.target.checked) }), ' locked'),
        s.group ? el('small', {}, ` in "${s.group}"`) : ''),
      isPixels(s) || s.locked ? '' : this.zonePointsPanel(s));
  }

  collisionJSON(list) {
    const clean = list.map((s) => {
      const o = {};
      for (const [k, v] of Object.entries(s)) if (!((k === 'x' || k === 'y') && !v)) o[k] = v;
      return o;
    });
    return '[\n' + clean.map((s) => '  ' + oneLine(s)).join(',\n') + '\n]\n';
  }

  // ------------------------------------------------------------------ vision zones
  inZone(z, x, y) {
    const [a, b, c, d, tx, ty] = zoneMatrix(z);
    const det = a * d - b * c;
    if (!det) return false;
    const lx = (d * (x - tx) - c * (y - ty)) / det, ly = (-b * (x - tx) + a * (y - ty)) / det;
    try { return this.hitCtx.isPointInPath(zonePath2D(z), lx, ly, 'evenodd'); } catch { return false; }
  }

  addZone(pts, at) {
    const cx = at ? at[0] : pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = at ? at[1] : pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const zones = this.list('vision');
    const z = { x: round2(cx), y: round2(cy), points: pts.map(([x, y]) => [round2(x - round2(cx)), round2(y - round2(cy))]) };
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

  // ------------------------------------------------------------------ zone points and curves
  // A zone's outline is edited point by point with Select: the zone being edited is the primary
  // selection when it's a vision zone on an editable layer. this.pts = {k, list: [{ci, i}]} holds
  // its selected points (contour, node); their handles are shown and can be dragged.
  editZone() {
    const s = this.sel;
    if (!s || !(s.layer === 'vision' || s.layer === 'collision') || !this.editable(s.layer) || this.tool !== 'select') return null;
    const z = this.list(s.layer)[s.k];
    if (!z || (s.layer === 'collision' && (isPixels(z) || z.locked || typeof z.d !== 'string'))) return null;
    return { layer: s.layer, k: s.k, z, file: s.layer + '.json' };
  }
  selPoints() { const e = this.editZone(); return e && this.pts && this.pts.k === e.k ? this.pts.list : []; }
  isPointSel(ci, i) { return this.selPoints().some((p) => p.ci === ci && p.i === i); }

  zoneContours(z) { return z.points ? fromPoints(z.points) : parsePath(z.d || ''); }
  // write an outline back: a zone made of points stays points while it's a plain polygon;
  // anything with curves (or several outlines) is a path, "d"
  setZoneContours(z, cs) {
    if (z.points && isPolygon(cs)) { z.points = cs[0].nodes.map(([x, y]) => [round2(x), round2(y)]); return; }
    delete z.points;
    z.d = pathString(cs);
    if (z.mode) this.rebake(); // a collision shape
  }
  // world -> the zone's own coordinates
  zoneLocal(z, wx, wy) {
    const [a, b, c, d, tx, ty] = zoneMatrix(z), D = a * d - b * c || 1;
    return [(d * (wx - tx) - c * (wy - ty)) / D, (-b * (wx - tx) + a * (wy - ty)) / D];
  }

  // the handles shown: those of the selected points
  visibleHandles(cs) {
    const out = [], seen = new Set();
    for (const { ci, i } of this.selPoints()) {
      const k = cs[ci];
      if (!k || !k.nodes[i]) continue;
      for (const h of nodeHandles(k, i)) {
        const key = `${ci}:${h.si}:${h.h}`;
        if (!seen.has(key)) { seen.add(key); out.push({ ci, ...h }); }
      }
    }
    return out;
  }

  // what's under the mouse on the zone being edited: a handle, a point or an edge
  zonePartAt(sx, sy) {
    const e = this.editZone();
    if (!e) return null;
    const cs = this.zoneContours(e.z), M = zoneMatrix(e.z), v = this.view;
    const S = (p) => { const [x, y] = apply(M, p); return [x * v.z + v.ox, y * v.z + v.oy]; };
    for (const h of this.visibleHandles(cs)) {
      const [x, y] = S(cs[h.ci].segs[h.si].c[h.h]);
      if (Math.hypot(x - sx, y - sy) < 6) return { kind: 'handle', ...e, cs, ...h };
    }
    for (let ci = cs.length - 1; ci >= 0; ci--) {
      for (let i = cs[ci].nodes.length - 1; i >= 0; i--) {
        const [x, y] = S(cs[ci].nodes[i]);
        if (Math.hypot(x - sx, y - sy) < 7) return { kind: 'point', ...e, cs, ci, i };
      }
    }
    const n = nearestSeg(cs, sx, sy, S);
    if (n && n.dist < 5) return { kind: 'edge', ...e, cs, ...n };
    return null;
  }

  // true when it handled the click
  zoneMouseDown(p, e, x, y) {
    const { k, z, cs, layer, file } = p;
    const before = this.snapshot();
    if (p.kind === 'handle') {
      this.drag = { kind: 'handle', layer, file, k, ci: p.ci, si: p.si, h: p.h, opp: e.altKey ? null : oppositeHandle(cs[p.ci], p.si, p.h), before, moved: false };
      return true;
    }
    if (p.kind === 'edge') {
      if (e.detail < 2) return false; // one click on an edge is a click on the zone
      const i = insertNode(cs[p.ci], p.si, p.t); // double-click adds a point there
      this.change([file], () => this.setZoneContours(z, cs), { reload: layer === 'vision' });
      this.pts = { k, list: [{ ci: p.ci, i }] };
      this.refreshPanel();
      return true;
    }
    const list = this.selPoints().slice(), at = list.findIndex((q) => q.ci === p.ci && q.i === p.i);
    if (e.altKey) { // Alt+click: corner <-> smooth
      toggleSmooth(cs[p.ci], p.i);
      if (at < 0) this.pts = { k, list: [{ ci: p.ci, i: p.i }] };
      this.change([file], () => this.setZoneContours(z, cs), { reload: layer === 'vision' });
      return true;
    }
    let toggleOff = null;
    if (at < 0) { if (e.shiftKey) list.push({ ci: p.ci, i: p.i }); else list.splice(0, list.length, { ci: p.ci, i: p.i }); }
    else if (e.shiftKey) toggleOff = { ci: p.ci, i: p.i }; // Shift+click on a selected one takes it out, unless it gets dragged
    this.pts = { k, list };
    this.drag = { kind: 'points', layer, file, k, ci: p.ci, i: p.i, from: clone(cs), x, y, toggleOff, before, moved: false };
    this.refreshPanel();
    return true;
  }

  // arrow keys on selected points; presses in a row make one undo step
  nudgePoints(dx, dy) {
    const e = this.editZone(), list = this.selPoints();
    const cs = this.zoneContours(e.z), from = clone(cs);
    const [lx, ly] = this.zoneLocal(e.z, (e.z.x || 0) + dx, (e.z.y || 0) + dy);
    const key = `pts:${this.index}:${e.k}:${JSON.stringify(list)}`, last = this.undoStack[this.undoStack.length - 1];
    const join = last && last.nudge === key && Date.now() - last.at < 1500 && !this.redoStack.length;
    const before = join ? null : this.snapshot();
    moveNodes(cs, from, list, round2(lx), round2(ly));
    this.setZoneContours(e.z, cs);
    if (join) { last.after = this.snapshot(); last.at = Date.now(); }
    else this.pushUndo({ type: 'data', level: this.index, before, after: this.snapshot(), files: [e.file], nudge: key, at: Date.now() });
    this.markDirty(e.file);
    this.needsReload = true;
  }

  // Delete on selected points: the outline closes up around them (curves either side join into
  // one); an outline left with fewer than 3 points goes, and the zone goes with its last outline
  deletePoints() {
    const e = this.editZone(), cs = this.zoneContours(e.z), by = new Map();
    for (const { ci, i } of this.selPoints()) { if (!by.has(ci)) by.set(ci, []); by.get(ci).push(i); }
    const keep = cs.filter((k, ci) => !by.has(ci) || removeNodes(k, by.get(ci)));
    if (!keep.length) { this.deleteSel(); return; }
    this.pts = null;
    this.change([e.file], () => this.setZoneContours(e.z, keep), { reload: e.layer === 'vision' });
  }

  // the panel's Corner / Smooth buttons, on every selected point
  setPointsSmooth(on) {
    const e = this.editZone(), cs = this.zoneContours(e.z);
    for (const { ci, i } of this.selPoints()) if (cs[ci] && cs[ci].nodes[i]) toggleSmooth(cs[ci], i, on);
    this.change([e.file], () => this.setZoneContours(e.z, cs), { reload: e.layer === 'vision' });
  }

  drawZonePoints(ctx, px) {
    const e = this.editZone();
    if (!e) return;
    const cs = this.zoneContours(e.z), M = zoneMatrix(e.z), W = (p) => apply(M, p);
    ctx.lineWidth = px;
    for (const h of this.visibleHandles(cs)) {
      const k = cs[h.ci], s = k.segs[h.si], [p0, p1] = segEnds(k, h.si), q = W(s.c[h.h]);
      ctx.strokeStyle = 'rgba(255,222,59,0.9)';
      for (const a of s.c.length === 1 ? [p0, p1] : [h.h === 0 ? p0 : p1]) {
        const A = W(a);
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(q[0], q[1], 4.5 * px, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#ffde3b'; ctx.beginPath(); ctx.arc(q[0], q[1], 3 * px, 0, 2 * Math.PI); ctx.fill();
    }
    // points: filled white when selected, hollow otherwise; smooth points are round
    cs.forEach((k, ci) => k.nodes.forEach((p, i) => {
      const [x, y] = W(p), on = this.isPointSel(ci, i), r = (on ? 4 : 3.5) * px;
      const shape = (rr) => { ctx.beginPath(); if (isSmooth(k, i)) ctx.arc(x, y, rr, 0, 2 * Math.PI); else ctx.rect(x - rr, y - rr, 2 * rr, 2 * rr); };
      ctx.fillStyle = '#000'; shape(r + px); ctx.fill();
      ctx.fillStyle = on ? '#fff' : '#2ee6ff'; shape(r); ctx.fill();
      if (!on) { ctx.fillStyle = '#000'; shape(r - 1.5 * px); ctx.fill(); }
    }));
    const d = this.drag;
    if (d && d.kind === 'marquee') {
      ctx.setLineDash([3 * px, 3 * px]); ctx.strokeStyle = '#fff'; ctx.lineWidth = px;
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.setLineDash([]);
    }
  }

  // ------------------------------------------------------------------ triggers
  // trigger names the level uses: door ids, trigger pads, sent and received triggers
  knownTriggers() {
    const out = new Set();
    for (const d of this.list('doors')) if (d.props && d.props.id) { out.add(d.props.id + ':open'); out.add(d.props.id + ':close'); }
    for (const g of this.trapGroups().keys()) for (const v of TRAP_EVENTS) out.add(g + ':' + v);
    for (const l of PLACE_LAYERS) for (const e of this.list(l)) {
      for (const n of sentTriggers(e)) out.add(n);
      for (const m of [].concat(e.script || []).join('\n').matchAll(/registerTrigger\(\s*this\s*,\s*["']([^"']+)["']/g)) out.add(m[1]);
    }
    return [...out].sort();
  }

  // the classes a placed symbol is built from (assets/props.json), e.g. trapTile or enemyAlarm
  classesOf(e) {
    const s = this.propsSpec && this.propsSpec.symbols[e.symbol];
    return (s && s.classes) || [];
  }
  isTrap(e) { return this.classesOf(e).includes('trapTile'); }
  isAlarm(e) { return this.classesOf(e).includes('enemyAlarm'); }
  // trap tiles by group: group -> [[tile, k], ...] (tiles without a group only run on their timers)
  trapGroups() {
    const m = new Map();
    this.list('doors').forEach((d, k) => {
      const g = d.props && d.props.group;
      if (!g || !this.isTrap(d)) return;
      if (!m.has(g)) m.set(g, []);
      m.get(g).push([d, k]);
    });
    return m;
  }
  // an alarm unit's settings as the game reads them (its props over the symbol's defaults)
  alarmSettings(e) {
    const spec = this.propsSpec && this.propsSpec.symbols[e.symbol];
    return spec ? effectiveSettings(spec.settings, e.props || {}) : {};
  }

  // ------------------------------------------------------------------ save
  fileContent(i, file) {
    const L = this.levels[i];
    if (file === 'collision.png') return this.maps[i].toBlob();
    if (file === 'collision.json') return this.collisionJSON(L.collision || []);
    if (/^collision-.+\.png$/.test(file)) return this.stacks[i].toBlob(file);
    if (file === 'level.json') return settingsJSON(L.settings || {});
    if (file === 'briefing.json') return briefingJSON(L.briefing);
    if (file === 'decor.json') return decorJSON(L.decor || []);
    return pretty(L[file.replace('.json', '')] || []) + '\n';
  }

  async save() {
    const jobs = [];
    for (const [i, files] of Object.entries(this.dirty)) for (const f of files) {
      // a pixel layer no longer in the stack (its add was undone, or it was deleted) isn't written
      if (/^collision-.+\.png$/.test(f) && !(this.levels[i].collision || []).some((s) => s.pixels === f)) continue;
      jobs.push([+i, f]);
    }
    if (!jobs.length) { this.status('Nothing to save.'); return; }
    await this.checkServer();
    if (this.writable) {
      this.status('Saving…');
      this.saving = true;
      this.renderServer();
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
        this.status(b.ok ? `Saved ${jobs.length} file${jobs.length > 1 ? 's' : ''} to levels/ and rebuilt.` + (this.stale ? ' The background art still needs Bake art.' : '') : 'Saved, but the build failed: ' + b.log, !b.ok);
      } catch (e) { this.status('Save failed: ' + e.message, true); }
      this.saving = false;
      this.checkServer();
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
        set(c, this.visible.features);
      });
      set(s.vision_mc, false); // drawn translucent below
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
      ctx.globalAlpha = this.toolLayers().includes('collision') ? 1 : 0.6;
      ctx.drawImage(this.map.overlay, 0, 0);
      ctx.globalAlpha = 1;
    }
    const px = 1 / v.z; // one screen pixel in world units
    // decor: the background shows the last bake; the sprites drawn over it show decor.json now
    if (this.visible.decor) {
      this.loadDecorIndex();
      const on = !this.locked.decor;
      ctx.imageSmoothingEnabled = true;
      this.list('decor').forEach((e) => {
        const { w: sw, h: sh } = this.decorSize(e.sprite), s = e.scale || 1, w = sw * s, h = sh * s;
        const img = this.decorSprites !== false && this.decorImage(e.sprite);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(-(e.rotation || 0) * Math.PI / 180);
        if (img) { ctx.globalAlpha = e.effect === 'paint' ? 0.6 : 0.9; ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.globalAlpha = 1; }
        if (on) { ctx.globalAlpha = 0.45; ctx.strokeStyle = decorColour(e.sprite); ctx.lineWidth = px; ctx.setLineDash([2 * px, 2 * px]); ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]); ctx.globalAlpha = 1; }
        ctx.restore();
      });
    }
    // grid
    // grid: while Shift (snap) is held
    if (this.shiftDown && this.grid && this.grid * v.z >= 6 && this.tool !== 'link' && this.tool !== 'autozone') {
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
    // vision zone outlines (thin, dashed) while they can be edited; selected ones are drawn below
    if (this.editable('vision')) {
      ctx.setLineDash([4 * px, 3 * px]);
      this.list('vision').forEach((z) => {
        ctx.save();
        ctx.transform(...zoneMatrix(z));
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = px / Math.max(1e-6, Math.sqrt(Math.abs(det(zoneMatrix(z)))));
        try { ctx.stroke(zonePath2D(z)); } catch { /* bad path */ }
        ctx.restore();
      });
      ctx.setLineDash([]);
    }
    // collision shapes that can be clicked: thin dashed outlines while selecting
    if (this.tool === 'select' && this.editable('collision') && this.shapes) {
      ctx.setLineDash([2 * px, 3 * px]);
      ctx.strokeStyle = 'rgba(120,200,255,0.55)';
      for (const sh of this.list('collision')) {
        if (sh.hidden || sh.locked || isPixels(sh)) continue;
        ctx.save();
        ctx.transform(...zoneMatrix(sh));
        ctx.lineWidth = px;
        try { ctx.stroke(this.shapes.path(sh.d)); } catch { /* bad path */ }
        ctx.restore();
      }
      ctx.setLineDash([]);
    }
    // things the game doesn't show (trigger pads, alpha-0 areas, hidden clips): outlined and named
    {
      const labels = [];
      ctx.lineWidth = 1 * px;
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.strokeStyle = 'rgba(255,200,80,0.9)';
      for (const l of PLACE_LAYERS) {
        if (l === 'pathNodes') continue; // drawn as nodes below
        this.list(l).forEach((e, k) => {
          if (!this.layerShown(l, e) || !this.isHidden(l, e, k)) return;
          const [x0, y0, x1, y1] = this.boundsOf(l, k);
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
          labels.push([x0, y0, hiddenLabel(e, l)]);
        });
      }
      ctx.setLineDash([]);
      ctx.font = `${10 * px}px system-ui, sans-serif`;
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255,200,80,0.95)';
      for (const [x, y, t] of labels) ctx.fillText(t, x, y - 2 * px);
    }
    // enemies with their own settings (cyan square) or their own script (red square), while the layer is unlocked
    if (this.editable('enemies')) {
      const r = 3 * px;
      this.list('enemies').forEach((e, k) => {
        const hasProps = e.props && Object.keys(e.props).length, hasScript = e.script !== undefined;
        if (!hasProps && !hasScript) return;
        const [, y0, x1] = this.boundsOf('enemies', k);
        let x = x1;
        const badge = (fill) => {
          ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - r - px, y0 - r - px, 2 * r + 2 * px, 2 * r + 2 * px);
          ctx.fillStyle = fill; ctx.fillRect(x - r, y0 - r, 2 * r, 2 * r);
          x -= 2 * r + 3 * px;
        };
        if (hasScript) badge('rgba(255,70,70,0.95)');
        if (hasProps) badge('rgba(110,230,255,0.95)');
      });
    }
    // triggers: who sends what (labels), lines to the doors they open (green) or close (red)
    if (this.visible.triggers) {
      const doors = new Map(this.list('doors').map((d, k) => [d.props && d.props.id, [d, k]]).filter(([id]) => id));
      const labels = [];
      ctx.lineWidth = 1.5 * px;
      for (const [id, [d]] of doors) labels.push([d.x, d.y, id, '#9cf']);
      // trap groups: their tiles outlined (amber timed, blue dormant), one label in the middle of each group
      const traps = new Map();
      ctx.lineWidth = 1 * px;
      for (const [g, tiles] of this.trapGroups()) {
        let sx = 0, sy = 0;
        for (const [d, k] of tiles) {
          const [x0, y0, x1, y1] = this.boundsOf('doors', k);
          ctx.strokeStyle = d.props.dormant ? 'rgba(150,200,255,0.8)' : 'rgba(255,190,90,0.8)';
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
          sx += d.x; sy += d.y;
        }
        const c = [sx / tiles.length, sy / tiles.length];
        traps.set(g, c);
        labels.push([c[0], c[1], `${g} grid${tiles.every(([d]) => d.props.dormant) ? ' (dormant)' : ''}`, '#9cf']);
      }
      ctx.lineWidth = 1.5 * px;
      // independent of the layers: every trigger in the level shows while this is on
      for (const l of ['powerups', 'boxes', 'enemies']) {
        this.list(l).forEach((e) => {
          const sent = sentTriggers(e);
          if (!sent.length) return;
          ctx.setLineDash([6 * px, 4 * px]);
          for (const n of sent) {
            const t = /^(.+):(alarm|on|off)$/.exec(n);
            if (t && traps.has(t[1])) {
              // waking or powering a trap group is a danger (amber, red); shutting it down is green
              const [cx, cy] = traps.get(t[1]);
              ctx.strokeStyle = t[2] === 'off' ? 'rgba(120,255,140,0.9)' : t[2] === 'on' ? 'rgba(255,120,120,0.9)' : 'rgba(255,190,90,0.9)';
              ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(cx, cy); ctx.stroke();
              continue;
            }
            const m = /^(.+):(open|close)$/.exec(n);
            const d = m && doors.get(m[1]);
            if (!d) continue;
            ctx.strokeStyle = m[2] === 'open' ? 'rgba(120,255,140,0.9)' : 'rgba(255,120,120,0.9)';
            ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(d[0].x, d[0].y); ctx.stroke();
          }
          labels.push([e.x, e.y, '→ ' + sent.join(', '), '#fd6']);
        });
      }
      ctx.setLineDash([]);
      ctx.font = `${11 * px}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      for (const [x, y, t, col] of labels) {
        const w = ctx.measureText(t).width;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(x + 6 * px, y - 8 * px, w + 6 * px, 16 * px);
        ctx.fillStyle = col;
        ctx.fillText(t, x + 9 * px, y);
      }
    }
    // path nodes and links: pinned links solid, automatic (line of sight) links dashed
    if (this.visible.pathNodes) {
      const feats = this.L.pathNodes || [];
      const byName = new Map(feats.filter((e) => e.name).map((e) => [e.name, e]));
      const auto = this.autoLinks();
      feats.forEach((e, k) => {
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
    // a selected alarm unit's sight: alarmRange around it, inside alarmCone either side of where it
    // faces (rotation 0 faces up, as the game's getAngle). Walls still block it in the game.
    for (const it of this.selItems()) {
      if (it.layer !== 'enemies') continue;
      const e = this.list('enemies')[it.k];
      if (!e || !this.isAlarm(e)) continue;
      const s = this.alarmSettings(e);
      const range = +s.alarmRange || 0, cone = Math.min(180, +s.alarmCone || 0);
      if (!range) continue;
      const face = (transformOf(e).rot - 90) * Math.PI / 180, half = cone * Math.PI / 180;
      ctx.beginPath();
      if (cone >= 180) ctx.arc(e.x, e.y, range, 0, Math.PI * 2);
      else { ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, range, face - half, face + half); ctx.closePath(); }
      ctx.fillStyle = 'rgba(255,60,60,0.12)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,90,90,0.85)'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.stroke(); ctx.setLineDash([]);
    }
    // selection: solid cyan with a dark edge, a tint and corner handles (the primary's are white),
    // so it stands out from the thin dashed outlines of everything else
    {
      const items = this.selItems(), primary = items[items.length - 1];
      const SEL = '#2ee6ff';
      const handles = (pts, main) => {
        for (const [x, y] of pts) {
          ctx.fillStyle = '#000'; ctx.fillRect(x - 4 * px, y - 4 * px, 8 * px, 8 * px);
          ctx.fillStyle = main ? '#fff' : SEL; ctx.fillRect(x - 3 * px, y - 3 * px, 6 * px, 6 * px);
        }
      };
      for (const it of items) {
        const main = it === primary;
        if (it.layer === 'vision') {
          const z = this.list('vision')[it.k], Z = zoneMatrix(z), sw = px / Math.max(1e-6, Math.sqrt(Math.abs(det(Z))));
          ctx.save();
          ctx.transform(...Z);
          try {
            const path = zonePath2D(z);
            ctx.fillStyle = 'rgba(46,230,255,0.12)'; ctx.fill(path, 'evenodd');
            ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4 * sw; ctx.stroke(path);
            ctx.strokeStyle = SEL; ctx.lineWidth = 2 * sw; ctx.stroke(path);
          } catch { /* bad path */ }
          ctx.restore();
          if (!main || !this.editZone()) handles((z.points || []).map((p) => apply(Z, p)), main);
          continue;
        }
        const sh = it.layer === 'collision' ? this.list('collision')[it.k] : null;
        if (sh && !isPixels(sh) && this.shapes) { // a vector shape: its own outline
          const Z = zoneMatrix(sh), sw = px / Math.max(1e-6, Math.sqrt(Math.abs(det(Z))));
          ctx.save();
          ctx.transform(...Z);
          const path = this.shapes.path(sh.d);
          ctx.fillStyle = 'rgba(46,230,255,0.18)';
          if (!sh.outline) ctx.fill(path, 'evenodd');
          ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4 * sw; ctx.stroke(path);
          ctx.strokeStyle = SEL; ctx.lineWidth = 2 * sw; ctx.stroke(path);
          ctx.restore();
          continue;
        }
        const [x0, y0, x1, y1] = this.boundsOf(it.layer, it.k);
        ctx.fillStyle = 'rgba(46,230,255,0.14)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4 * px; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = SEL; ctx.lineWidth = 2 * px; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        handles([[x0, y0], [x1, y0], [x0, y1], [x1, y1]], main);
      }
    }
    this.drawZonePoints(ctx, px);
    this.drawAreas(ctx, px);
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
      const [nx, ny] = this.snapAngleFrom(this.poly[this.poly.length - 1], m.x, m.y, m.shift);
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
      const [x, y] = this.snap(m.x, m.y, m.shift);
      const img = this.placeLayer === 'decor' && typeof this.placeSymbol === 'string' && this.decorImage(this.placeSymbol);
      if (img) {
        const s = this.decorScale(this.placeSymbol);
        ctx.globalAlpha = 0.6;
        ctx.drawImage(img, x - img.naturalWidth * s / 2, y - img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
        ctx.globalAlpha = 1;
      }
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
      if (e.key === 'Shift') this.shiftDown = false;
      if (!typing(e)) e.stopImmediatePropagation();
    }, true);
    this.panel.addEventListener('keydown', (e) => e.stopPropagation());
    this.panel.addEventListener('keyup', (e) => e.stopPropagation());
    window.addEventListener('mouseup', (e) => { if (!this.isOpen) return; e.stopImmediatePropagation(); this.onMouseUp(e); }, true);
    window.addEventListener('mousemove', (e) => { if (this.isOpen && this.drag) this.onMouseMove(e); }, true);
    window.addEventListener('blur', () => { this.shiftDown = false; });
  }

  status(t, err) { this.statusEl.textContent = t; this.statusEl.classList.toggle('err', !!err); }

  refreshSave() {
    const n = Object.values(this.dirty).reduce((a, s) => a + s.size, 0);
    if (this.saveBtn) this.saveBtn.textContent = (this.writable ? 'Save' : 'Download') + (n ? ` (${n})` : '');
    if (this.saveBtn) this.saveBtn.title = this.writable ? 'Write the changed files into levels/ (Ctrl+S)' : 'Download the changed files (Ctrl+S). Run npm run edit to save into levels/ directly.';
  }

  // The panel: a fixed header (level, save, undo, play) over three tabs. Map is the editing
  // workflow top to bottom: pick a tool, then its options, the layers it works on (collision's
  // shape stack folds out under its row), then the selection or the palette. Level holds what
  // belongs to the whole level (briefing, triggers, balance, size, level.json); Art the bake.
  refreshPanel() {
    const p = this.panel;
    if (this.body) (this.scrolls ||= {})[this.tab] = this.body.scrollTop;
    // scrollable lists inside the panel (shape stack, decor palette, inspector) keep their scroll too
    const inner = {};
    for (const e of p.querySelectorAll(INNER_SCROLLS)) if (e.scrollTop) inner[e.className + '#' + [...p.querySelectorAll('.' + e.classList[0])].indexOf(e)] = e.scrollTop;
    p.textContent = '';
    this.tab ||= 'map';
    p.append(this.headerPanel());
    const body = this.body = el('div', { class: 'le-body' });
    p.append(body);
    if (this.tab === 'level') body.append(...this.levelTab());
    else if (this.tab === 'art') body.append(...this.artTab());
    else body.append(...this.mapTab());
    body.scrollTop = (this.scrolls && this.scrolls[this.tab]) || 0;
    for (const e of p.querySelectorAll(INNER_SCROLLS)) {
      const top = inner[e.className + '#' + [...p.querySelectorAll('.' + e.classList[0])].indexOf(e)];
      if (top) e.scrollTop = top;
    }
    this.refreshSave();
  }

  setTab(t) { this.tab = t; this.refreshPanel(); }

  // a collapsible section whose open state survives refreshes
  section(key, title, kids, { open = false, badge = '', cls = '' } = {}) {
    const id = '$' + key;
    if (!this.openGroups.has(id) && !this.openGroups.has('!' + id) && open) this.openGroups.add(id);
    return el('details', { class: 'le-sec ' + cls, open: this.openGroups.has(id) || null, ontoggle: (ev) => {
      this.openGroups.delete(ev.target.open ? '!' + id : id);
      this.openGroups.add(ev.target.open ? id : '!' + id);
    } }, el('summary', {}, el('span', {}, title), badge ? el('small', {}, badge) : ''), el('div', { class: 'le-sec-body' }, ...kids));
  }

  headerPanel() {
    const lvl = el('select', { class: 'le-level', title: 'the level being edited', onchange: (e) => this.loadLevel(+e.target.value) }, ...this.levels.map((x) => el('option', { value: x.index, selected: x.index === this.index }, x.folder)));
    this.serverEl = el('div', { class: 'le-server' });
    this.renderServer();
    this.saveBtn = el('button', { class: 'le-save', onclick: () => this.save() });
    const artWarn = this.stale || this.shapesAhead || this.mismatch[this.index];
    const tab = (key, label, warn) => el('button', { class: 'le-tab' + (this.tab === key ? ' on' : ''), onclick: () => this.setTab(key) }, label, warn ? el('span', { class: 'le-dot', title: warn }) : '');
    return el('div', { class: 'le-head' },
      el('div', { class: 'le-row le-head-row' }, lvl,
        el('button', { title: 'New level: add a level after the last one (Level tab)', onclick: () => { this.openGroups.add('$new'); this.openGroups.delete('!$new'); this.setTab('level'); } }, '+'),
        el('button', { title: 'Restart the level from the edited data', onclick: () => this.reload() }, '↻'),
        el('button', { class: 'le-play', title: 'Back to the game (`)', onclick: () => this.close() }, 'Play ▸')),
      el('div', { class: 'le-row le-head-row' }, this.saveBtn,
        el('button', { onclick: () => this.undo(), title: 'Undo (Ctrl+Z)' }, '↶ Undo'), el('button', { onclick: () => this.undo(true), title: 'Redo (Ctrl+Shift+Z)' }, '↷ Redo'),
        el('span', { class: 'le-grow' }), this.serverEl),
      el('div', { class: 'le-tabs' }, tab('map', 'Map'), tab('level', 'Level'),
        tab('art', 'Art', artWarn ? (this.shapesAhead ? 'the collision shapes changed since the map was baked' : this.mismatch[this.index] ? 'collision.png was edited outside its shapes' : 'the collision map changed since the art was baked') : '')));
  }

  // ---- Map tab: tools, tool options, layers (+ collision shapes), then the selection
  mapTab() {
    const out = [];
    const L = this.L;
    const toolsFor = (layer) => TOOLS.filter((t) => TOOL_LAYERS[t.key].includes(layer)).map((t) => t.key);
    const usable = new Set(this.pickedLayer ? toolsFor(this.pickedLayer) : []);
    const tool = TOOLS.find((t) => t.key === this.tool);
    const targets = this.toolLayers();
    const toolBtn = (key) => {
      const t = TOOLS.find((x) => x.key === key);
      return el('button', { class: ['le-tool', this.tool === key ? 'on' : '', usable.has(key) ? 'usable' : ''].filter(Boolean).join(' '),
        title: `${t.label} (${t.hot}): ${t.tip}\nWorks on: ${TOOL_LAYERS[key].map(layerLabel).join(', ')}`, onclick: () => this.setTool(key) },
      el('span', {}, t.label), el('kbd', {}, t.hot));
    };
    out.push(el('div', { class: 'le-block' },
      ...TOOL_GROUPS.map(([name, keys]) => el('div', { class: 'le-toolgroup' }, el('div', { class: 'le-label' }, name), el('div', { class: 'le-tools' }, ...keys.map(toolBtn))))));
    // what the tool works on, and its options
    const opts = el('div', { class: 'le-toolopts' },
      el('div', { class: 'le-works' }, el('b', { class: 'le-toolname' }, tool.label), ' works on ', ...(this.tool === 'select' ? ['every shown, unlocked layer (marked in Layers)'] : targets).flatMap((l, i) => [i ? ' ' : '', this.tool === 'select' ? l : el('span', { class: 'le-chip ' + (this.locked[l] ? 'locked' : this.visible[l] ? '' : 'off'), title: this.locked[l] ? 'locked: unlock it in Layers' : this.visible[l] ? '' : 'hidden: show it in Layers' }, layerLabel(l) + (this.locked[l] ? ' 🔒' : this.visible[l] ? '' : ' (hidden)'))])));
    if (DRAW_TOOLS.has(this.tool) && !(this.tool === 'poly' && this.polyTarget === 'vision')) {
      opts.append(el('div', { class: 'le-row' }, el('span', { class: 'le-label' }, 'Paint'), ...['wall', 'chasm', 'open'].map((c) => el('button', {
        class: 'le-swatch ' + (this.colour === c ? 'on' : ''), style: `--c: rgb(${COLOURS[c].join(',')})`, title: { wall: 'Wall (W)', chasm: 'Chasm: impassable, shoot over (C)', open: 'Open floor (O)' }[c],
        onclick: () => { this.colour = c; this.refreshPanel(); },
      }, c))));
      if (this.tool === 'pencil' || this.tool === 'eraser') opts.append(el('div', { class: 'le-row' }, el('span', { class: 'le-label' }, 'Brush'),
        el('input', { type: 'number', min: 1, max: 64, value: this.brush, title: '[ and ] change it', onchange: (e) => { this.brush = Math.max(1, Math.min(64, +e.target.value || 1)); } }), ' px'));
    }
    if (!['link', 'autozone', 'pencil', 'eraser', 'fill'].includes(this.tool)) {
      opts.append(el('div', { class: 'le-row', title: 'nothing snaps unless Shift is held' }, el('span', { class: 'le-label' }, 'Shift snaps'), 'grid ',
        el('select', { onchange: (e) => { this.grid = +e.target.value; } }, ...[1, 2, 4, 8, 16, 32, 64].map((g) => el('option', { value: g, selected: g === this.grid }, g + ' px'))),
        ...(this.tool === 'poly' ? [' angle ', el('select', { onchange: (e) => { this.snapAngle = +e.target.value; } }, ...[0, 5, 15, 22.5, 45, 90].map((a) => el('option', { value: a, selected: a === this.snapAngle }, a ? a + '°' : 'off')))] : [])));
    }
    opts.append(el('div', { class: 'le-tip le-clamp' + (this.showTip ? ' open' : ''), title: this.showTip ? 'click to fold' : 'click for the whole tip', onclick: () => { this.showTip = !this.showTip; this.refreshPanel(); } }, tool.tip));
    out.push(opts);
    if (this.stale || this.shapesAhead) out.push(el('div', { class: 'le-banner' },
      this.shapesAhead ? 'The collision shapes changed since the map was baked.' : 'The collision map changed, so the background art no longer matches it.',
      el('button', { onclick: () => this.setTab('art') }, 'Art tab ▸')));
    out.push(this.layersPanel(targets, toolsFor));
    out.push(this.inspector());
    return out;
  }

  // layers: the eye shows or hides one, the lock keeps it from being selected or edited, a click
  // on its name points the tools at it. Rows the current tool works on are marked, and rows with
  // something selected are lit. Collision's shape stack folds out under its row.
  layersPanel(targets, toolsFor) {
    const layersEl = el('div', { class: 'le-layers' });
    const selLayers = new Set(this.selLayers());
    const pickable = (key) => key === 'collision' || key === 'vision' || TOOL_LAYERS.place.includes(key);
    VIEW_LAYERS.forEach((l, i) => {
      const hot = l.hot || String(i + 1);
      const lockable = LOCKABLE.has(l.key), vis = !!this.visible[l.key], locked = !!this.locked[l.key];
      if (l.key === 'triggers') layersEl.append(el('div', { class: 'le-label le-overlays' }, 'Overlays'));
      const cls = ['le-layer', targets.includes(l.key) ? 'target' : '', this.pickedLayer === l.key ? 'picked' : '', selLayers.has(l.key) ? 'has-sel' : '', locked ? 'locked' : '', vis ? '' : 'hidden'].filter(Boolean).join(' ');
      const tools = toolsFor(l.key);
      const fold = l.key === 'collision' && vis;
      const folded = this.showShapes === false;
      layersEl.append(el('div', { class: cls, title: tools.length ? 'Tools for this layer: ' + tools.map((t) => TOOLS.find((x) => x.key === t).label).join(', ') : '' },
        el('button', { class: 'le-icon' + (vis ? ' on' : ''), title: `${vis ? 'hide' : 'show'} (${hot})`, onclick: () => this.setVisible(l.key, !vis) }, vis ? ICON.eye : ICON.eyeOff),
        lockable ? el('button', { class: 'le-icon' + (locked ? ' on' : ''), title: locked ? 'unlock: let it be selected and edited' : 'lock: keep it from being selected or edited', onclick: () => this.setLocked(l.key, !locked) }, locked ? ICON.lock : ICON.unlock) : el('span', { class: 'le-icon-gap' }),
        el('span', { class: 'le-name' + (pickable(l.key) ? ' le-pick' : ''), title: pickable(l.key) ? 'click to point the tools at this layer: Place adds here, Polygon draws here (the tool stays as it is)' : null, onclick: pickable(l.key) ? () => this.pickLayer(l.key) : null }, l.label),
        selLayers.has(l.key) ? el('small', { class: 'le-nsel' }, this.selItems().filter((s) => s.layer === l.key).length + ' sel') : '',
        DATA_LAYERS.includes(l.key) ? el('small', { class: 'le-count' }, String(this.layerCount(l.key))) : '',
        el('kbd', { title: `${vis ? 'hide' : 'show'} with ${hot}` }, hot),
        l.key === 'collision' ? el('button', { class: 'le-icon le-fold', disabled: !vis, title: folded ? 'show the shape stack' : 'fold the shape stack', onclick: () => { this.showShapes = folded; this.refreshPanel(); } }, folded || !vis ? '▸' : '▾') : el('span', { class: 'le-icon-gap' })));
      if (fold && !folded) layersEl.append(this.shapesPanel());
    });
    return el('div', { class: 'le-block' }, el('div', { class: 'le-label' }, 'Layers ', el('small', {}, 'click a name to point the tools at it')), layersEl);
  }

  // the selection's properties, else the Place palette, else what to do
  inspector() {
    const nSel = this.selItems().length;
    let body;
    if (nSel > 1) body = this.groupPanel();
    else if (nSel) body = this.sel.layer === 'vision' ? this.zonePanel() : this.sel.layer === 'decor' ? this.decorPanel() : this.sel.layer === 'collision' ? this.shapePanel() : this.propsPanel();
    else if (this.tool === 'place') body = this.placePanel();
    else {
      const tips = [el('div', { class: 'le-empty' }, 'Nothing selected. Click something on a shown, unlocked layer; Shift+click adds more.')];
      const tl = this.toolLayers();
      if (tl.includes('vision') && this.visible.vision) tips.push(el('div', { class: 'le-tip' }, 'Vision zones: an enemy attacks when you and it are in the same zone and it can see you. An enemy outside every zone (or with autoVision) makes its own zone of what it can see. Select (V) moves zones, and their points and curve handles once one is selected; Polygon (G) draws one, Auto zone (Z) makes one from a spot.'));
      if (tl.includes('decor') && this.visible.decor) tips.push(el('div', { class: 'le-tip' }, 'Decor (decor.json) is what the art bake paints into background.png: floor paint, wall greebles, vents, rails, lights. The game never reads it. Select (V) moves one, Place (P) adds one, R turns it, Delete removes it; then Bake art (Art tab) to see it for real.'));
      body = el('div', { class: 'le-props' }, ...tips);
    }
    return el('div', { class: 'le-inspector' }, body);
  }

  // the Place palette for the layer Place adds to
  placePanel() {
    const layer = this.placeLayer;
    const layerPick = el('select', { title: 'the layer Place adds to (or click a layer name above)', onchange: (e) => this.pickLayer(e.target.value) },
      ...TOOL_LAYERS.place.map((l) => el('option', { value: l, selected: l === layer }, layerLabel(l))));
    const head = el('div', { class: 'le-insp-head' }, el('h4', {}, 'Place on '), layerPick);
    if (layer === 'decor') return el('div', { class: 'le-props' }, head, this.decorPalette());
    if (layer === 'pathNodes') return el('div', { class: 'le-props' }, head, el('div', { class: 'le-tip' }, 'Click to drop a path node; it joins the selected node\'s group.'));
    const syms = (this.palette[layer] || []).filter((s) => this.applier.ids[s] !== undefined);
    return el('div', { class: 'le-props' }, head,
      el('div', { class: 'le-palette' }, ...syms.map((s) => el('button', {
        class: this.placeSymbol === s ? 'on' : '', title: s, onclick: () => { this.placeSymbol = s; this.refreshPanel(); },
      }, s.split('/').pop())), ...(PRESETS[layer] || []).map((pr) => el('button', {
        class: 'le-preset' + (this.placeSymbol === pr ? ' on' : ''), title: 'a ' + pr.symbol.split('/').pop() + ' set up as a ' + pr.label,
        onclick: () => { this.placeSymbol = pr; this.refreshPanel(); },
      }, '★ ' + pr.label))),
      el('div', { class: 'le-tip' }, this.placeSymbol ? 'Click the map to drop one (Shift snaps to the grid).' : 'Pick one, then click the map to drop it.'));
  }

  // the inspector's title row: a name, what it is, and the actions for the selection
  inspHead(title, sub, { rotate = true, reorder = false } = {}) {
    return el('div', { class: 'le-insp-head' },
      el('h4', {}, title, sub ? el('small', {}, ' ' + sub) : ''),
      el('span', { class: 'le-grow' }),
      el('div', { class: 'le-actions' },
        reorder ? el('button', { onclick: () => this.reorderShapes(1), title: 'up the stack (Ctrl+])' }, '↑') : '',
        reorder ? el('button', { onclick: () => this.reorderShapes(-1), title: 'down the stack (Ctrl+[)' }, '↓') : '',
        rotate ? el('button', { onclick: () => this.rotateSel(-15), title: 'turn 15° anticlockwise (Shift+R)' }, '⟲') : '',
        rotate ? el('button', { onclick: () => this.rotateSel(15), title: 'turn 15° clockwise (R)' }, '⟳') : '',
        el('button', { onclick: () => this.duplicate(), title: 'Duplicate (Ctrl+D)' }, '⧉'),
        el('button', { class: 'le-del', onclick: () => this.deleteSel(), title: 'Delete (Del)' }, '✕')));
  }

  // ---- Level tab: what belongs to the whole level
  levelTab() {
    const L = this.L;
    return [
      this.briefingPanel(),
      this.triggerPanel(),
      this.statsPanel(),
      this.sizePanel(),
      this.newLevelPanel(),
      this.section('settings', 'Level settings', [
        el('div', { class: 'le-tip' }, 'level.json as JSON. The size changes with Resize level, above.'),
        el('textarea', { rows: 6, spellcheck: false, onchange: (e) => {
          try {
            const v = JSON.parse(e.target.value);
            const sz = (o) => JSON.stringify(o && o.size);
            if (sz(v) !== sz(L.settings)) { v.size = L.settings.size; this.status('The level size changes with Resize level (Level tab), so the maps follow it; the rest of level.json is applied.', true); }
            this.change(['level.json'], () => { L.settings = v; });
          } catch (err) { this.status('level.json: ' + err.message, true); }
        } }, JSON.stringify(L.settings, null, 1))], { badge: 'level.json' }),
    ];
  }

  // ---- Art tab: the two bake steps, collision shapes -> collision.png -> background.png
  artTab() {
    const L = this.L, mm = this.mismatch[this.index];
    const step = (n, title, state, ...kids) => el('div', { class: 'le-step' }, el('div', { class: 'le-step-head' }, el('span', { class: 'le-step-n' }, n), el('b', {}, title), el('span', { class: 'le-grow' }), state), ...kids);
    const ok = (t) => el('small', { class: 'le-ok' }, t), warn = (t) => el('small', { class: 'le-warnc' }, t);
    const s1 = step('1', 'Collision map', mm ? warn('edited outside the shapes') : this.shapesAhead ? warn('shapes changed') : ok('matches the shapes'),
      el('div', { class: 'le-tip' }, 'Bakes the collision shapes (Map tab, under Collision) into collision.png, the map the game plays on.'),
      el('div', { class: 'le-row' },
        el('label', { title: 'bake the shapes into collision.png as you edit them; off, the map only changes when you press Bake collision' },
          el('input', { type: 'checkbox', checked: this.autoBake, onchange: (ev) => { this.autoBake = ev.target.checked; if (this.autoBake && this.shapesAhead) this.bakeCollision(); else this.refreshPanel(); } }), ' Bake as I edit'),
        el('button', { class: this.shapesAhead ? 'le-hot' : '', title: 'shapes -> collision.png now', onclick: () => this.bakeCollision() }, 'Bake collision')),
      mm ? el('div', { class: 'le-tip' }, 'collision.png was edited outside the shapes; pick Keep the map or Use the shapes in the shape stack (Map tab) first.') : '');
    const s2 = step('2', 'Background art', L.settings && L.settings.art ? (this.stale ? warn('collision changed') : ok('')) : el('small', {}, 'original art'), this.artPanel());
    return [el('div', { class: 'le-block' }, s1, s2)];
  }

  // the briefing screen (briefing.json): title, text, captions and the pictures beside them.
  // Edits don't restart the level; Show briefing rebuilds and opens the briefing screen.
  briefingPanel() {
    const L = this.L;
    const b = (L.briefing ||= {});
    const edit = (fn) => this.change(['briefing.json'], () => { fn(L.briefing ||= {}); }, { reload: false });
    const text = (value, set, attrs = {}) => el('input', { value: value || '', spellcheck: false, ...attrs, onchange: (ev) => edit((o) => set(o, ev.target.value)) });
    const num = (label, value, set) => el('label', {}, label + ' ', el('input', { type: 'number', step: 'any', value: value ?? 0, style: 'width: 58px', onchange: (ev) => { const v = +ev.target.value; if (isFinite(v)) edit((o) => set(o, v)); } }));
    const caps = b.captions || [];
    const capRows = caps.map((c, k) => el('div', { class: 'le-brief-cap' },
      el('div', { class: 'le-row' },
        el('select', { title: 'name: cyan heading; note: small white text', onchange: (ev) => edit((o) => { o.captions[k].style = ev.target.value; }) },
          ...['name', 'note'].map((s) => el('option', { value: s, selected: (c.style || 'note') === s }, s))),
        num('x', c.x, (o, v) => { o.captions[k].x = v; }), num('y', c.y, (o, v) => { o.captions[k].y = v; }),
        el('button', { title: 'remove this caption', onclick: () => edit((o) => { o.captions.splice(k, 1); }) }, '×')),
      el('textarea', { rows: Math.max(1, String(c.text || '').split('\n').length), spellcheck: false, title: 'centred on x; y is the top of the text. Enter starts a new line.', onchange: (ev) => edit((o) => { o.captions[k].text = ev.target.value; }) }, c.text || '')));
    const graphics = el('textarea', { rows: Math.min(10, 2 + (b.graphics || []).length), spellcheck: false, class: 'le-script', onchange: (ev) => {
      try {
        const v = ev.target.value.trim() ? JSON.parse(ev.target.value) : [];
        if (!Array.isArray(v) || v.some((g) => !g || typeof g.symbol !== 'string')) throw new Error('expected a list of {"symbol", "x", "y", ...}');
        edit((o) => { if (v.length) o.graphics = v; else delete o.graphics; });
      } catch (err) { this.status('Briefing graphics: ' + err.message, true); }
    } }, '[\n' + (b.graphics || []).map((g) => '  ' + JSON.stringify(g)).join(',\n') + '\n]');
    return this.section('briefing', 'Briefing', [
      el('div', { class: 'le-row' }, el('button', { title: 'rebuild and show this level\'s briefing screen (Play mission starts the level)', onclick: () => this.previewBriefing() }, 'Show briefing ▸')),
      el('label', { class: 'le-set' }, el('span', { class: 'le-set-name' }, 'title'), text(b.title, (o, v) => { o.title = v; })),
      el('label', { class: 'le-set' }, el('span', { class: 'le-set-name' }, 'label'), text(b.label, (o, v) => { if (v) o.label = v; else delete o.label; }, { placeholder: 'LVL.' + String(L.index).padStart(2, '0') })),
      el('div', { class: 'le-tip' }, 'Mission text (wraps by itself; Enter starts a new line):'),
      el('textarea', { rows: 7, spellcheck: true, class: 'le-script', style: 'white-space: pre-wrap', onchange: (ev) => edit((o) => { o.body = ev.target.value; }) }, b.body || ''),
      el('div', { class: 'le-tip' }, 'Captions in the Intel panel (it spans about x 560 to 715):'),
      ...capRows,
      el('div', { class: 'le-row' }, el('button', { onclick: () => edit((o) => { (o.captions ||= []).push({ style: 'name', text: 'New target', x: 637, y: o.captions.length ? Math.max(...o.captions.map((c) => +c.y || 0)) + 45 : 210 }); }) }, '+ Caption')),
      el('div', { class: 'le-tip' }, 'Pictures and other graphics: library symbols placed on the screen, like a level\'s placements (symbol, x, y, scale, ...):'),
      graphics,
      el('label', { class: 'le-set' }, el('span', { class: 'le-set-name' }, 'backdrop'),
        el('select', { onchange: (ev) => edit((o) => { if (ev.target.value === 'screen_mc/shape 2') delete o.backdrop; else o.backdrop = ev.target.value; }) },
          ...[['screen_mc/shape 2', 'standard'], ['screen_mc/shape 1', 'training (shape 1)']].map(([v, t]) => el('option', { value: v, selected: (b.backdrop || 'screen_mc/shape 2') === v }, t))))], { badge: 'briefing.json' });
  }

  previewBriefing() {
    const images = {};
    for (const [i, m] of Object.entries(this.maps)) images[i] = m.canvas;
    try {
      this.applier.apply(this.levels, images);
      this.needsReload = false;
      showBriefing(this.rt, this.index);
      this.close();
    } catch (e) {
      console.error(e);
      this.status('Could not rebuild the briefing: ' + e.message, true);
    }
  }

  propsPanel() {
    const { layer, k } = this.sel;
    const e = this.list(layer)[k];
    const t = transformOf(e);
    const file = layer + '.json';
    const num = (label, val, set) => this.liveNum(label, round2(val), set, { file });
    const box = el('div', { class: 'le-props' },
      this.inspHead(e.name || e.symbol.split('/').pop(), `${e.name ? e.symbol.split('/').pop() + ' · ' : ''}${layerLabel(layer).toLowerCase()} #${k + 1}`),
      el('div', { class: 'le-xform' }, num('x', e.x, (v) => { e.x = v; }), num('y', e.y, (v) => { e.y = v; }),
        num('scale x', t.sx, (v) => setTransform(e, t.rot, v, t.sy)),
        num('scale y', t.sy, (v) => setTransform(e, t.rot, t.sx, v)),
        num('rotation', t.rot, (v) => setTransform(e, v, t.sx, t.sy))),
      el('label', { class: 'le-set' }, el('span', { class: 'le-set-name' }, 'name'), el('input', { value: e.name || '', placeholder: 'none', onchange: (ev) => this.change([file], () => { if (ev.target.value) e.name = ev.target.value; else delete e.name; }) })));
    if (layer === 'pathNodes') box.append(this.nodeRows(k));
    else box.append(this.tintRow(e, file));
    box.append(...this.triggerRows(layer, e));
    {
      const spec = this.propsSpec && this.propsSpec.symbols[e.symbol];
      if (spec) box.append(...this.settingsRows(layer, e, spec));
      if (e.script !== undefined) box.append(this.scriptRows(layer, e));
      else if (layer !== 'pathNodes') box.append(el('div', { class: 'le-row' }, el('button', { title: 'give this instance its own ActionScript load code, for things settings can\'t express (it runs after the settings)', onclick: () => { this.openGroups.add('$script'); this.change([layer + '.json'], () => { e.script = ['onClipEvent (load) {', '    ', '}']; }, { reload: false }); } }, '+ Script')));
      const raw = (...kids) => (spec ? el('details', { class: 'le-set-group', open: this.openGroups.has('$json') || null, ontoggle: (ev) => { if (ev.target.open) this.openGroups.add('$json'); else this.openGroups.delete('$json'); } }, el('summary', {}, 'Raw JSON'), ...kids) : el('div', {}, ...kids));
      box.append(raw(el('div', { class: 'le-tip' }, spec ? 'The settings it has, as JSON (the same as the fields above; anything goes here):' : 'Variables set when it loads (JSON):'),
        el('textarea', { rows: Math.min(10, 2 + JSON.stringify(e.props || {}, null, 1).split('\n').length), spellcheck: false, onchange: (ev) => {
          try {
            const v = ev.target.value.trim() ? JSON.parse(ev.target.value) : {};
            if (typeof v !== 'object' || Array.isArray(v)) throw new Error('expected an object');
            this.change([file], () => { if (Object.keys(v).length) e.props = v; else delete e.props; });
          } catch (err) { this.status('Variables: ' + err.message, true); }
        } }, JSON.stringify(e.props || {}, null, 1))));
    }
    return box;
  }

  // sprites to place on the Decor layer, one category at a time
  decorPalette() {
    const idx = this.decorIndex;
    if (!idx) { this.loadDecorIndex(); return el('div', { class: 'le-tip' }, 'Loading the decor sprites…'); }
    const cats = Object.keys(idx).sort();
    if (!cats.includes(this.decorCat)) this.decorCat = (typeof this.placeSymbol === 'string' && cats.find((c) => this.placeSymbol.startsWith(c + '/'))) || cats[0];
    const sprites = idx[this.decorCat] || [];
    return el('div', {},
      el('div', { class: 'le-row' }, el('span', { class: 'le-label' }, 'Category'), el('select', { onchange: (e) => { this.decorCat = e.target.value; this.refreshPanel(); } },
        ...cats.map((c) => el('option', { value: c, selected: c === this.decorCat }, `${c} (${idx[c].length})`)))),
      el('div', { class: 'le-decor-pal' }, ...sprites.map((s) => el('button', {
        class: this.placeSymbol === s.file ? 'on' : '', title: `${s.file} (${s.w} × ${s.h})`,
        onclick: () => { this.placeSymbol = s.file; this.refreshPanel(); },
      }, el('img', { src: DECOR_DIR + s.file, loading: 'lazy' })))),
      el('div', { class: 'le-tip' }, 'New ones take the median size of their category and its bake effect (paint for floor paint, a drop shadow for wall parts, a glow for lights).'));
  }

  decorPanel() {
    const { k } = this.sel;
    const e = this.list('decor')[k];
    const file = 'decor.json';
    const edit = (fn) => this.change([file], fn, { reload: false });
    const num = (label, val, set, attrs = {}) => this.liveNum(label, val, set, { file, reload: false, attrs });
    const cat = e.sprite.split('/')[0];
    const others = (this.decorIndex && this.decorIndex[cat]) || [];
    return el('div', { class: 'le-props' },
      this.inspHead(e.sprite.split('/').pop(), `decor · ${cat} #${k + 1}`),
      el('div', { class: 'le-row' }, el('img', { class: 'le-decor-thumb', src: DECOR_DIR + e.sprite }),
        others.length ? el('select', { title: 'swap for another sprite of this category', onchange: (ev) => edit(() => { e.sprite = ev.target.value; }) },
          ...others.map((s) => el('option', { value: s.file, selected: s.file === e.sprite }, s.file.split('/').pop()))) : ''),
      el('div', { class: 'le-xform' }, num('x', e.x, (v) => { e.x = round2(v); }), num('y', e.y, (v) => { e.y = round2(v); }),
        num('scale', e.scale ?? 1, (v) => { e.scale = Math.max(0.01, round2(v * 1e4) / 1e4); }, { step: 0.01, min: 0.01 }),
        num('rotation', e.rotation || 0, (v) => { e.rotation = round2(((v % 360) + 360) % 360); }, { title: 'degrees, counter-clockwise' })),
      el('div', { class: 'le-row' }, 'Bake effect ',
        el('select', { title: 'paint: soaks into the floor, worn; emboss: a height map (grey = floor level) lit from the top-left, for floor panels; shadow: casts a drop shadow; glow: its bright coloured parts bloom', onchange: (ev) => edit(() => {
          const v = ev.target.value;
          if (v) e.effect = v; else delete e.effect;
          if (v === 'shadow' || v === 'glow') e.strength ??= (DECOR_DEFAULTS[cat] && DECOR_DEFAULTS[cat].strength) || (v === 'glow' ? 0.9 : 0.3);
          else delete e.strength;
        }) }, ...['', 'paint', 'emboss', 'shadow', 'glow'].map((v) => el('option', { value: v, selected: (e.effect || '') === v }, v || 'none'))),
        e.effect === 'shadow' || e.effect === 'glow' ? num('strength', e.strength ?? 0, (v) => { e.strength = round2(v); }, { step: 0.05, min: 0 }) : ''));
  }

  // the art pipeline (tools/art/bake.py), run by the local server: place decor, bake background.png
  artPanel() {
    const L = this.L, art = L.settings && L.settings.art;
    const box = el('div', { class: 'le-art' });
    if (!art) {
      box.append(el('div', { class: 'le-tip' }, 'This level keeps its original background from the Flash file. To generate its art from the collision map instead, give it art settings; Bake art then replaces background.png (git has the old one).'),
        el('button', { onclick: () => this.change(['level.json'], () => { L.settings = { ...(L.settings || {}), art: { kit: 'bridge', seed: 1 + Math.floor(Math.random() * 9999) } }; }, { reload: false }) }, 'Generate this level\'s art'));
      return box;
    }
    const setArt = (o) => this.change(['level.json'], () => {
      const a = { ...art, ...o };
      for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
      L.settings = { ...L.settings, art: a };
    }, { reload: false });
    const running = this.art || (this.server && this.server.art);
    const off = !this.writable || !!running;
    const btn = (label, step, tip) => el('button', { disabled: off, title: tip, onclick: () => this.runArt(step) }, label);
    const n = this.layerCount('decor');
    if (!this.artOptions) {
      this.artOptions = fetch('tools/art/options.json', { cache: 'no-store' }).then((r) => r.json())
        .then((j) => { this.artOptions = j; this.refreshPanel(); }).catch((e) => { this.artOptions = {}; this.status('Art options: ' + e.message, true); });
    }
    const only = this.placeOnly ||= new Set(DECOR_TYPES);
    const all = only.size === DECOR_TYPES.length;
    // the kits, their grades and their area lists (tools/art/kits.json)
    const kits = this.kitSchema() || { [art.kit]: {} }, kit = kits[art.kit] || {};
    const grades = Object.entries(kit.grades || {}), areas = Object.entries(kit.areas || {});
    box.append(
      el('div', { class: 'le-row' }, 'Kit ', el('select', { title: 'the tile set: floor, wall and chasm textures and the decor sheets (tools/art/parts, kits listed in tools/art/kits.json)', onchange: (ev) => { this.setAreaEdit(null); setArt({ kit: ev.target.value }); } },
        ...Object.entries(kits).map(([key, k]) => el('option', { value: key, selected: art.kit === key, title: k.tip || '' }, k.label || key))),
        ' Seed ', el('input', { type: 'number', step: 1, value: art.seed, style: 'width: 6em', title: 'picks the decor layout and the floor grain', onchange: (ev) => { const v = Math.round(+ev.target.value); if (isFinite(v)) setArt({ seed: v }); } }),
        el('button', { title: 'a new random seed (then Re-place decor to use it)', onclick: () => setArt({ seed: 1 + Math.floor(Math.random() * 9999) }) }, '🎲')),
      grades.length ? el('div', { class: 'le-row' }, 'Grade ', el('select', { title: 'the colour grade over the finished art (level.json art.grade); takes effect on the next Bake art', onchange: (ev) => setArt({ grade: ev.target.value || undefined }) },
        el('option', { value: '', selected: !art.grade }, `default (${kit.defaultGrade})`),
        ...grades.map(([g, o]) => el('option', { value: g, selected: art.grade === g, title: o.tip || '' }, g)),
        ...(art.grade && !(kit.grades || {})[art.grade] ? [el('option', { value: art.grade, selected: true }, art.grade + ' (unknown)')] : [])),
        art.grade && (kit.grades || {})[art.grade] && kit.grades[art.grade].tip ? el('small', {}, ' ' + kit.grades[art.grade].tip) : '') : '',
      ...areas.map(([key, a]) => {
        const n = Array.isArray(art[key]) ? art[key].length : 0, on = this.areaEdit === key;
        return el('div', { class: 'le-row', title: (a.tip || '') + ` (level.json art.${key}, ${a.shape === 'polygon' ? 'polygons' : 'rectangles'}; the bake reads them)` },
          el('label', {}, el('input', { type: 'checkbox', checked: on, onchange: (ev) => this.setAreaEdit(ev.target.checked ? key : null) }), ` ${a.label || key} `),
          el('span', { style: `display:inline-block;width:.8em;height:.8em;background:${a.colour || '#e0b040'};margin-right:.4em` }),
          el('small', {}, `${n} ${a.shape === 'polygon' ? (n === 1 ? 'polygon' : 'polygons') : n === 1 ? 'box' : 'boxes'}`),
          on && this.areaSel != null && art[key] && art[key][this.areaSel] ? el('button', { onclick: () => { this.writeAreas(key, art[key].filter((_, i) => i !== this.areaSel)); this.areaSel = null; this.refreshPanel(); } }, 'Delete') : '');
      }),
      this.areaEdit && areas.some(([k]) => k === this.areaEdit) ? el('div', { class: 'le-tip' }, (kit.areas[this.areaEdit].shape === 'polygon'
        ? 'On the map: click corners on empty floor to draw one (click the first corner or Enter to close), drag one to move it, drag a corner to move it, Alt+click a corner to remove it.'
        : 'On the map: drag on empty floor to draw one, drag one to move it, drag a corner to resize it.') + ' Delete removes the selected one, Esc stops editing, Shift snaps. Takes effect on the next Bake art.') : '',
      this.areaRows(el, art),
      el('div', { class: 'le-row' },
        btn('Bake art', 'bake', 'Save, then redraw background.png from collision.png and decor.json as they are (collision shapes aren\'t re-baked)'),
        this.shapesAhead ? el('button', { disabled: off, class: 'le-hot', title: 'the collision shapes changed since collision.png was baked: bake them into it first, then the art', onclick: () => { if (this.bakeCollision()) this.runArt('bake'); } }, 'Bake collision + art') : ''),
      el('div', { class: 'le-tip' }, running ? `Running ${running.step === 'all' ? 're-place + bake' : running.step} on ${running.level || L.folder}… (about 10 s)`
        : !this.writable ? 'Needs the local server (npm run edit).'
          : `Runs tools/art/bake.py on your machine, rebuilds, and reloads the editor with the new art.`),
      el('div', { class: 'le-label le-gap' }, 'Decor layout ', el('small', {}, `${n} placements in decor.json`)),
      el('div', { class: 'le-row' }, el('label', { title: 'decor.json: what the bake paints in. Edit it on the map with Select and Place.' }, el('input', { type: 'checkbox', checked: !!this.visible.decor, onchange: (ev) => this.setVisible('decor', ev.target.checked) }), ' Show and edit decor on the map (K)')),
      el('div', { class: 'le-row le-types', title: 'which decor types Re-place lays out again; the others keep their placements' }, 'Re-place: ',
        ...DECOR_TYPES.map((t) => el('label', {}, el('input', { type: 'checkbox', checked: only.has(t), onchange: (ev) => { if (ev.target.checked) only.add(t); else only.delete(t); this.confirmPlace = false; this.refreshPanel(); } }), t))),
      el('div', { class: 'le-row' },
        this.confirmPlace
          ? el('button', { disabled: off, class: 'le-danger', title: 'decor.json is replaced; Undo cannot bring the old layout back (git can)', onclick: () => { this.confirmPlace = false; this.runArt('all'); } }, all ? `Replace all ${n} decor and bake?` : `Replace ${this.list('decor').filter((e) => only.has(decorType(e))).length} ${[...only].join(', ')} and bake?`)
          : el('button', { disabled: off || !only.size, title: 'Save, then lay out new decor of the ticked types from the seed (replacing those in decor.json, hand edits too; the other types stay) and bake', onclick: () => { this.confirmPlace = true; this.refreshPanel(); } }, all ? 'Re-place decor + bake' : `Re-place ${only.size} type${only.size > 1 ? 's' : ''} + bake`),
        this.confirmPlace ? el('button', { onclick: () => { this.confirmPlace = false; this.refreshPanel(); } }, 'Cancel') : ''));
    if (this.artLog) box.append(el('pre', { class: 'le-artlog' }, this.artLog));
    // the bake's options (tools/art/options.json), saved in level.json art.<group>.<option>
    if (this.artOptions && !(this.artOptions instanceof Promise)) {
      box.append(el('div', { class: 'le-label le-gap' }, 'Bake options ', el('small', {}, 'take effect on the next Bake art')));
      for (const [group, spec] of Object.entries(this.artOptions)) {
        const cur = art[group] || {};
        const changed = Object.keys(cur).length;
        const set = (key, v) => setArt({ [group]: (() => { const o = { ...cur }; if (v === spec.options[key].default) delete o[key]; else o[key] = v; return Object.keys(o).length ? o : undefined; })() });
        const rows = Object.entries(spec.options).map(([key, o]) => {
          const v = cur[key] ?? o.default;
          const input = o.type === 'colour'
            ? el('input', { type: 'color', value: v, onchange: (ev) => set(key, ev.target.value) })
            : o.type === 'text'
              ? el('input', { value: v, placeholder: 'none', onchange: (ev) => set(key, ev.target.value.trim()) })
              : el('input', { type: 'number', min: o.min, max: o.max, step: o.step, value: v, onchange: (ev) => { const x = +ev.target.value; if (isFinite(x)) set(key, Math.min(o.max ?? x, Math.max(o.min ?? x, x))); } });
          return el('label', { class: 'le-opt' + (key in cur ? ' set' : ''), title: (o.tip || '') + ` (default ${o.default === '' ? 'none' : o.default})` }, o.label, input);
        });
        box.append(el('details', { class: 'le-optgroup', open: !!(this.openOpts && this.openOpts.has(group)), ontoggle: (ev) => { (this.openOpts ||= new Set())[ev.target.open ? 'add' : 'delete'](group); } },
          el('summary', {}, spec.label + (changed ? ` (${changed} changed)` : '')),
          spec.tip ? el('div', { class: 'le-tip' }, spec.tip) : '', el('div', { class: 'le-opts' }, ...rows),
          changed ? el('button', { onclick: () => setArt({ [group]: undefined }) }, 'Defaults') : ''));
      }
    }
    return box;
  }

  async runArt(step) {
    const L = this.L;
    this.artLog = '';
    if (Object.keys(this.dirty).length) {
      await this.save(); // the bake reads collision.png, decor.json and level.json from disk
      if (Object.keys(this.dirty).length) return;
    }
    this.art = { step, level: L.folder, started: Date.now() };
    this.status(`Art: running ${step} on ${L.folder}…`);
    this.refreshPanel();
    const r = await fetch('__art', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: L.folder, step, only: step !== 'bake' && this.placeOnly && this.placeOnly.size < DECOR_TYPES.length ? [...this.placeOnly] : undefined }) })
      .then((x) => x.json()).catch((e) => ({ ok: false, log: e.message }));
    this.art = null;
    if (!r.ok) {
      this.artLog = r.log || 'failed';
      this.status(r.missing ? 'The art pipeline needs Python packages; see the Art tab.' : `Art ${step} failed; see the Art tab.`, true);
      this.refreshPanel();
      return;
    }
    // reload the page so the new background.png and decor.json come in, back where we were
    this.reopen(this.index, `Art ${step === 'all' ? 're-placed and baked' : 'baked'} for ${L.folder}.`);
  }

  // reload the page on level `index` (after files changed on disk), back in the same view unless
  // `fresh` (a new or resized level is fitted to the window instead)
  reopen(index, msg, fresh = false) {
    try {
      sessionStorage.setItem('levelEditorResume', JSON.stringify({ index, view: fresh ? null : this.view, visible: this.visible, locked: this.locked, placeLayer: this.placeLayer, polyTarget: this.polyTarget, tool: this.tool, tab: this.tab, msg }));
    } catch { /* private window: we come back to the fitted view */ }
    const u = new URL(location.href);
    u.searchParams.set('edit', index);
    location.replace(u.toString());
  }

  // ------------------------------------------------------------------ level size, new level
  // send a level's files to npm run edit, which writes them and rebuilds; returns whether it worked
  async writeLevel(folder, files, create = false) {
    this.status(`${create ? 'Creating' : 'Writing'} levels/${folder}…`);
    const r = await fetch('__level', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, create, files }) })
      .then((x) => x.json()).catch((e) => ({ ok: false, log: e.message }));
    if (!r.ok) this.status(`Could not write levels/${folder}: ${r.log || 'failed'}`, true);
    return r.ok;
  }

  // save unsaved edits first: New level and Resize reload the page from what's on disk
  async saveFirst() {
    await this.checkServer();
    if (!this.writable) { this.status('New level and Resize need the local server: run npm run edit and open http://localhost:8123/?edit', true); return false; }
    if (Object.keys(this.dirty).length) await this.save();
    return !Object.keys(this.dirty).length;
  }

  async newLevel(name, w, h) {
    name = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)) { this.status('A level name is letters, digits, spaces and dashes, starting with a letter or digit.', true); return; }
    if (!validSize(w) || !validSize(h)) { this.status(`A level is ${MIN_SIZE} to ${MAX_SIZE} px each way.`, true); return; }
    if (!(await this.saveFirst())) return;
    const index = this.levels.length, folder = String(index).padStart(2, '0') + '_' + name;
    this.busy = 'Creating ' + folder;
    this.refreshPanel();
    const ok = await this.writeLevel(folder, await newLevelFiles(name, w, h), true);
    this.busy = null;
    if (ok) this.reopen(index, `Created levels/${folder} (${w}×${h}). It's level ${index} in the game's missions list.`, true);
    else this.refreshPanel();
  }

  // Resize the current level to w x h. Everything placed moves with the map (by the anchor), so
  // nothing shifts relative to the walls. Added collision space is wall, and the background art
  // is padded to match; levels with an art kit need Bake art afterwards.
  async resizeLevel(w, h, anchor) {
    const L = this.L, from = L.size;
    if (!validSize(w) || !validSize(h)) { this.status(`A level is ${MIN_SIZE} to ${MAX_SIZE} px each way.`, true); return; }
    if (w === from.w && h === from.h) { this.status(`${L.folder} is already ${w}×${h}.`); return; }
    const st = this.shapes;
    if (!st) { this.status('Collision shapes are still loading.', true); return; }
    if (!(await this.saveFirst())) return;
    const { dx, dy } = resizeOffset(from, { w, h }, anchor);
    const move = (e) => ({ ...e, x: round2((+e.x || 0) + dx), y: round2((+e.y || 0) + dy) });
    const files = {};
    const json = (file, text) => { files[file] = text; };
    for (const layer of [...PLACE_LAYERS, 'vision']) if ((L[layer] || []).length) json(layer + '.json', pretty(L[layer].map(move)) + '\n');
    if ((L.decor || []).length) json('decor.json', decorJSON(L.decor.map(move)));
    // collision shapes move with the map; pixel layers are redrawn at the offset instead (their
    // PNGs are always the level's size), the base map padded with wall, the others with nothing
    const shapes = L.collision.map((s) => (isPixels(s) ? { ...s } : { ...s, x: (s.x || 0) + dx, y: (s.y || 0) + dy }));
    json('collision.json', this.collisionJSON(shapes));
    for (const s of shapes) if (isPixels(s) && !files[s.pixels]) files[s.pixels] = await pngBase64(shifted(st.canvas(s.pixels), w, h, dx, dy, s.pixels === 'collision-base.png' ? PAD.collision : null));
    files['collision.png'] = await pngBase64(shifted(this.map.canvas, w, h, dx, dy, PAD.collision));
    let art;
    try { art = await loadImage(`levels/${L.folder}/background.png`); } catch (e) { this.status(e.message, true); return; }
    files['background.png'] = await pngBase64(shifted(art, w, h, dx, dy, PAD.art));
    json('level.json', settingsJSON({ ...(L.settings || {}), size: { w, h } }));
    this.busy = 'Resizing ' + L.folder;
    this.refreshPanel();
    const ok = await this.writeLevel(L.folder, files);
    this.busy = null;
    if (ok) this.reopen(this.index, `Resized ${L.folder} from ${from.w}×${from.h} to ${w}×${h}.` + (L.settings && L.settings.art ? ' Press Bake art to redraw the background for the new size.' : ''), true);
    else this.refreshPanel();
  }

  // Level size and New level, in the panel
  sizePanel() {
    const L = this.L, { w, h } = L.size;
    const f = (this.sizeForm ||= {});
    if (f.level !== L.folder) Object.assign(f, { level: L.folder, w, h, anchor: [0, 0] });
    const num = (o, k) => el('input', { type: 'number', min: MIN_SIZE, max: MAX_SIZE, step: 1, value: o[k], style: 'width: 64px', oninput: (ev) => { o[k] = Math.round(+ev.target.value); } });
    const off = !this.writable || !!this.busy;
    const why = this.writable ? '' : ' (needs npm run edit)';
    const anchors = el('div', { class: 'le-anchor', title: 'which part of the map stays put: space is added or cut on the other side(s)' },
      ...[0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => el('button', {
        class: f.anchor[0] === ax && f.anchor[1] === ay ? 'on' : '', onclick: () => { f.anchor = [ax, ay]; this.refreshPanel(); },
      }, f.anchor[0] === ax && f.anchor[1] === ay ? '●' : ''))));
    return this.section('size', 'Size', [
      el('div', { class: 'le-tip' }, 'level.json "size" sets the level\'s size; collision.png and the background follow it. Resizing moves everything placed with the map, so nothing shifts against the walls. Added space is wall.'),
      el('div', { class: 'le-row' }, 'w ', num(f, 'w'), ' h ', num(f, 'h'), anchors),
      el('div', { class: 'le-row' }, el('button', { disabled: off, title: 'Save, then resize this level and reload' + why, onclick: () => this.resizeLevel(f.w, f.h, f.anchor) }, 'Resize level')),
      this.busy ? el('div', { class: 'le-tip' }, this.busy + '…') : ''], { badge: `${w}×${h}` });
  }

  // New level: a new folder after the last level
  newLevelPanel() {
    const nf = (this.newForm ||= { name: '', w: 800, h: 600 });
    const num = (o, k) => el('input', { type: 'number', min: MIN_SIZE, max: MAX_SIZE, step: 1, value: o[k], style: 'width: 64px', oninput: (ev) => { o[k] = Math.round(+ev.target.value); } });
    const off = !this.writable || !!this.busy;
    const why = this.writable ? '' : ' (needs npm run edit)';
    const planned = PLANNED_NAMES[this.levels.length] || '';
    return this.section('new', 'New level', [
      el('div', { class: 'le-tip' }, `Adds levels/${String(this.levels.length).padStart(2, '0')}_<name> after the last level, with a wall border, an entrance and an exit. The game's level list comes from the folders.`),
      el('div', { class: 'le-row' }, 'name ', el('input', { value: nf.name, placeholder: planned.slice(3) || 'Name', spellcheck: false, style: 'width: 120px', oninput: (ev) => { nf.name = ev.target.value; } })),
      el('div', { class: 'le-row' }, 'w ', num(nf, 'w'), ' h ', num(nf, 'h')),
      el('div', { class: 'le-row' }, el('button', { disabled: off, title: 'Save, then create the level and open it' + why, onclick: () => this.newLevel(nf.name || planned.slice(3), nf.w, nf.h) }, 'Create level')),
      this.busy ? el('div', { class: 'le-tip' }, this.busy + '…') : '']);
  }

  // a number field that applies as you type or step it (one undo step per edit), and
  // refreshes the panel when you leave it
  liveNum(label, val, set, { file, files = [file], reload = true, attrs = {} }) {
    let before = null;
    const commit = () => {
      if (before === null) return;
      const after = this.snapshot();
      if (after !== before) this.pushUndo({ type: 'data', level: this.index, before, after, files });
      before = null;
      this.refreshPanel();
    };
    return el('label', {}, label + ' ', el('input', { type: 'number', step: 'any', ...attrs, value: val,
      oninput: (ev) => {
        const raw = ev.target.value, v = +raw;
        if (raw === '' || !isFinite(v)) return;
        if (before === null) before = this.snapshot();
        set(v);
        for (const f of files) this.markDirty(f);
        if (reload) this.reload(); else this.needsReload = true;
      },
      onchange: commit,
      onkeydown: (ev) => { if (ev.key === 'Enter') ev.target.blur(); } }));
  }

  // several things selected (from any layers): move, turn, scale, line up and space them together
  groupPanel() {
    const items = this.selItems(), files = this.selFiles(items);
    const reload = this.needsRebuild(items);
    // relative fields: each change re-applies to the selection as it was when the edit started
    // (the panel is rebuilt when an edit ends, which starts the next one afresh)
    let base = null;
    const rel = (label, val, apply, attrs) => this.liveNum(label, val, (v) => {
      if (base === null) base = this.snapshot();
      this.restoreData(base);
      apply(v);
    }, { files, reload, attrs });
    const layers = this.selLayers().map((l) => layerLabel(l).toLowerCase()).join(', ');
    const arr = (label, axis, how, title) => el('button', { title, disabled: items.length < (how === 'space' ? 3 : 2), onclick: () => this.arrange(axis, how) }, label);
    return el('div', { class: 'le-props' },
      this.inspHead(`${items.length} selected`, layers),
      el('div', { class: 'le-tip' }, 'Drag one to move them all (Shift snaps), arrows nudge 1 px (Shift: 10). Shift+click adds or removes one; Esc clears. The fields turn and scale the group about its centre, live.'),
      el('div', { class: 'le-row' },
        rel('rotate by', 0, (v) => this.transformSel(v, 1, items), { step: 5, title: 'degrees, clockwise' }),
        rel('scale %', 100, (v) => { if (v > 0) this.transformSel(0, v / 100, items); }, { step: 5, min: 1 })),
      el('div', { class: 'le-row le-arrange' }, 'Align ',
        arr('⇹ in a row', 'y', 'align', 'line them up horizontally: the same y (the middle of their spread)'),
        arr('⇳ in a column', 'x', 'align', 'line them up vertically: the same x (the middle of their spread)')),
      el('div', { class: 'le-row le-arrange' }, 'Space evenly ',
        arr('↔ across', 'x', 'space', 'even gaps left to right, between the leftmost and rightmost (3 or more)'),
        arr('↕ down', 'y', 'space', 'even gaps top to bottom, between the topmost and bottommost (3 or more)')));
  }

  layerCount(key) {
    return (this.L[key] || []).length;
  }

  // the instance's colour tint (its Flash colour transform: multiply by 1 - amount, add colour × amount),
  // e.g. 05 Gateway's keycard doors in their key's colour
  tintRow(e, file) {
    const c = e.color, m = c && c.multiply, a = c && c.add;
    const plain = !c || (m && m.slice(0, 3).every((v) => v === m[0]) && m[3] === 1 && (!a || a[3] === 0));
    const amt = c && plain ? round2(1 - (m ? m[0] : 1)) : 0;
    const rgb = c && plain && a && amt > 0 ? a.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v / amt)))) : [255, 255, 255];
    const hex = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    const set = (h, t) => this.change([file], () => {
      if (!(t > 0)) { delete e.color; return; }
      const col = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      e.color = { multiply: [round2(1 - t), round2(1 - t), round2(1 - t), 1], add: col.map((v) => Math.round(v * t)).concat(0) };
    });
    if (c && !plain) return el('div', { class: 'le-row', title: 'a colour transform the tint row can\'t show; edit it in the level\'s JSON' }, 'Tint: custom colour transform ', el('button', { onclick: () => set(hex, 0) }, 'Clear'));
    return el('div', { class: 'le-row', title: 'tints it toward a colour (its colour transform); amount 0 is none' }, 'Tint ',
      el('input', { type: 'color', value: hex, onchange: (ev) => set(ev.target.value, amt || 0.45) }),
      ' amount ', el('input', { type: 'number', min: 0, max: 1, step: 0.05, value: amt, style: 'width: 5em', onchange: (ev) => { const t = +ev.target.value; if (isFinite(t)) set(hex, Math.max(0, Math.min(1, t))); } }),
      c ? el('button', { onclick: () => set(hex, 0) }, 'Clear') : '');
  }

  nodeRows(k) {
    const e = this.list('pathNodes')[k];
    const pinned = e.props && e.props.connections !== undefined;
    const add = (e.color && e.color.add) || [0, 0, 0];
    const hex = '#' + add.slice(0, 3).map((v) => (v | 0).toString(16).padStart(2, '0')).join('');
    return el('div', {},
      el('div', { class: 'le-row' }, 'Path group ', el('input', { type: 'color', value: hex, title: 'nodes only link to nodes of the same colour; an enemy follows the group of the node nearest to it', onchange: (ev) => {
        const v = ev.target.value;
        this.change(['pathNodes.json'], () => { e.color = { multiply: [0, 0, 0, 1], add: [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(0) }; });
      } })),
      pinned
        ? el('div', { class: 'le-row' }, 'Links pinned by hand (solid). ', el('button', { onclick: () => this.unpinLinks(k), title: 'remove the pinned links, so the node links to every node of its colour it can see' }, 'Back to automatic'))
        : el('div', { class: 'le-tip' }, 'Links itself to the nodes of its colour it can see (dashed).'),
      el('div', { class: 'le-links' }, ...this.linksOf(k).map((j) => {
        const t = this.list('pathNodes')[j];
        return el('div', { class: 'le-row' }, `→ ${t.name || 'node #' + (j + 1)} (${Math.round(t.x)}, ${Math.round(t.y)})`,
          el('button', { title: 'remove this link (from both nodes)', onclick: () => { this.toggleLink(k, j); this.refreshPanel(); } }, '× unlink'));
      })),
      el('div', { class: 'le-tip' }, 'To add a link, use Path links (N): click this node, then another.'));
  }

  // feature indices a node links to: its pinned links, or the ones it makes by line of sight
  linksOf(k) {
    const f = this.list('pathNodes'), e = f[k];
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
    if (layer === 'doors' && this.isTrap(e)) {
      const g = e.props && e.props.group;
      if (g) {
        const ns = TRAP_EVENTS.map((v) => g + ':' + v);
        const from = PLACE_LAYERS.flatMap((l) => this.list(l)).filter((o) => sentTriggers(o).some((n) => ns.includes(n))).length;
        const tiles = this.trapGroups().get(g).length;
        rows.push(el('div', { class: 'le-tip' }, `Group "${g}" (${tiles} tile${tiles === 1 ? '' : 's'}): goes live for alarmTime on "${g}:alarm", for good on "${g}:on", and shuts down for good on "${g}:off"; ${from || 'nothing'} in this level sends ${from === 1 ? 'one' : 'them'}.${e.props.dormant ? ' Dormant: it does nothing until the alarm.' : ''}`));
      } else rows.push(el('div', { class: 'le-tip' }, 'No group: it only runs on its timer (onTime, offTime, phase). Give it a group under Floor trap to wake or shut it with triggers.'));
    }
    if (layer === 'enemies' && this.isAlarm(e)) {
      const row = (key, label, title) => rows.push(el('div', { class: 'le-row' }, label, input(alarmTriggers(e, key).join(', '), (n) => {
        if (n.length) { e.props ||= {}; e.props[key] = n.length === 1 ? n[0] : n; } else if (e.props) { delete e.props[key]; if (!Object.keys(e.props).length) delete e.props; }
      }, title)));
      row('alarm', 'When it spots the player, send ', 'trigger names, separated by commas, e.g. "hall:alarm" to wake a trap group or "door2:close" for a lockdown; every hunter is sent after the player as well');
      row('alarmClear', 'When the alarm stands down, send ', 'trigger names, separated by commas, e.g. "door2:open" to end a lockdown; sent alarmCooldown seconds after it lost the player, or when it dies with the alarm up');
      rows.push(el('div', { class: 'le-tip' }, 'It never shoots. Seeing the player (its sight is drawn while it is selected) sends every hunter after them, plus these triggers.'));
    }
    if (layer === 'powerups' && e.props && e.props.type === 'trigger') {
      rows.push(el('div', { class: 'le-row' }, 'Trigger pad sends ', input(e.props.item || '', (n) => { e.props.item = n[0] || ''; }, 'sent when the player walks over it')));
    }
    const ev = TRIGGER_EVENTS[layer];
    if (ev) {
      const [key, when] = ev;
      const cur = e.props && e.props[key];
      const scripted = e.script !== undefined && new RegExp('\\b' + key + '\\b').test([].concat(e.script).join('\n')); // its script sets it, after the props
      if (!scripted && (cur === undefined || isTrigger(cur))) {
        rows.push(el('div', { class: 'le-row' }, `${when[0].toUpperCase() + when.slice(1)}, send `, input(cur ? triggerNames(cur).join(', ') : '', (n) => {
          if (n.length) { e.props ||= {}; e.props[key] = { $trigger: n.length === 1 ? n[0] : n }; } else if (e.props) { delete e.props[key]; if (!Object.keys(e.props).length) delete e.props; }
        }, 'trigger names, separated by commas; a door listens for "<id>:open" and "<id>:close"')));
      }
    }
    return rows;
  }

  // an instance's own ActionScript (load code that does more than set variables): runs after its
  // settings, at the end of the same onClipEvent(load). The game runs the compiled script from the
  // last build, so an edit here works once it's saved (npm run edit rebuilds) and the page reloads.
  scriptRows(layer, e) {
    const file = layer + '.json';
    const text = [].concat(e.script).join('\n');
    return el('details', { class: 'le-set-group', open: this.openGroups.has('$script') || null, ontoggle: (ev) => { if (ev.target.open) this.openGroups.add('$script'); else this.openGroups.delete('$script'); } },
      el('summary', {}, 'Script', el('small', {}, ' runs after the settings')),
      el('div', { class: 'le-tip' }, 'ActionScript, e.g. onClipEvent (load) { ... }. Changes take effect after Save' + (this.writable ? ' (it rebuilds).' : ' and npm run build.') + ' Empty it to remove the script.'),
      el('textarea', { class: 'le-script', rows: Math.min(18, text.split('\n').length + 1), spellcheck: false, onchange: (ev) => {
        const v = ev.target.value.replace(/\r\n?/g, '\n');
        this.change([file], () => { if (v.trim()) e.script = v.split('\n'); else delete e.script; });
      } }, text));
  }

  // named fields for the settings this symbol's scripts read (assets/props.json, built by tools/props/spec.mjs):
  // empty = the default (shown greyed), a value = set in this instance's props
  settingsRows(layer, e, spec) {
    const file = layer + '.json';
    const props = e.props || {};
    const settings = spec.settings.filter((s) => s.type !== 'trigger'); // triggers have their own rows above
    const known = new Set(spec.settings.map((s) => s.name));
    const set = (name, v) => this.change([file], () => {
      if (v === undefined) { if (e.props) { delete e.props[name]; if (!Object.keys(e.props).length) delete e.props; } } else { e.props ||= {}; e.props[name] = v; }
    });
    const vals = effectiveSettings(spec.settings, props);
    const fromLabel = (s) => (s.from === 'symbol' ? 'this symbol' : s.from + '.as');
    const tipOf = (s) => [s.desc, s.forced !== undefined ? `Fixed by this symbol's script at ${s.forced}: setting it here has no effect.` : s.default !== undefined ? `Default: ${s.default} (${fromLabel(s)})` : `No default (${fromLabel(s)}).`].filter(Boolean).join('\n');
    const shown = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const placeholder = (s) => (s.forced !== undefined ? s.forced : s.default !== undefined ? (vals[s.name] !== undefined && shown(vals[s.name]) !== s.default ? `${s.default} = ${shown(vals[s.name])}` : s.default) : '');
    const reset = (s) => (s.name in props ? el('button', { class: 'le-reset', title: 'back to the default', onclick: () => set(s.name, undefined) }, '↺') : null);
    const pathGroups = () => {
      const seen = new Map();
      for (const n of this.list('pathNodes')) { const a = (n.color && n.color.add) || [0, 0, 0]; const v = (a[0] << 16) | (a[1] << 8) | a[2]; if (!seen.has(v)) seen.set(v, 0); seen.set(v, seen.get(v) + 1); }
      return seen;
    };
    const field = (s) => {
      const isSet = s.name in props, cur = props[s.name];
      const attrs = { title: tipOf(s), disabled: s.forced !== undefined };
      const label = el('span', { class: 'le-set-name' + (isSet ? ' on' : '') + (s.forced !== undefined ? ' forced' : ''), title: attrs.title }, s.name);
      let input;
      if (s.type === 'boolean') {
        const v = isSet ? !!cur : !!vals[s.name];
        input = el('input', { type: 'checkbox', ...attrs, checked: v, onchange: (ev) => {
          const b = ev.target.checked;
          set(s.name, vals.__defaults[s.name] === b ? undefined : b); // matching the default: leave it unset
        } });
        return el('label', { class: 'le-set le-set-bool', title: attrs.title }, input, label, reset(s));
      }
      if (s.type === 'path') {
        const groups = pathGroups();
        const hex = (v) => '#' + v.toString(16).padStart(6, '0');
        input = el('select', { ...attrs, onchange: (ev) => set(s.name, ev.target.value === '' ? undefined : ev.target.value === 'auto' ? 'auto' : +ev.target.value) },
          el('option', { value: '', selected: !isSet }, `default (${s.forced || s.default || 'auto'})`),
          el('option', { value: 'auto', selected: cur === 'auto' }, 'auto: nearest node'),
          ...[...groups].map(([v, n]) => el('option', { value: String(v), selected: isSet && cur === v, style: `color: ${hex(v)}` }, `■ ${hex(v)} (${n} node${n === 1 ? '' : 's'})`)),
          ...(isSet && typeof cur === 'number' && !groups.has(cur) ? [el('option', { value: String(cur), selected: true }, `${hex(cur)} (no nodes)`)] : []));
      } else if (s.choices) {
        input = el('select', { ...attrs, onchange: (ev) => set(s.name, ev.target.value === '' ? undefined : s.type === 'number' ? +ev.target.value : ev.target.value) },
          el('option', { value: '', selected: !isSet }, `default${s.default !== undefined ? ' (' + s.default + ')' : ''}`),
          ...s.choices.map((c) => el('option', { value: String(c), selected: isSet && cur === c }, String(c))),
          ...(isSet && !s.choices.includes(cur) ? [el('option', { value: shown(cur), selected: true }, shown(cur))] : []));
      } else {
        const parse = (raw) => {
          if (raw.trim() === '') return undefined;
          if (s.type === 'number') { const n = +raw; if (!isFinite(n)) throw new Error(s.name + ': not a number'); return n; }
          if (s.type === 'json') return JSON.parse(raw);
          return raw;
        };
        input = el('input', { type: s.type === 'number' ? 'number' : 'text', step: 'any', ...attrs, value: isSet ? shown(cur) : '', placeholder: placeholder(s), spellcheck: false,
          onchange: (ev) => { try { set(s.name, parse(ev.target.value)); } catch (err) { this.status(err.message, true); } },
          onkeydown: (ev) => { if (ev.key === 'Enter') ev.target.blur(); } });
      }
      return el('label', { class: 'le-set', title: attrs.title }, label, input, reset(s));
    };
    const out = [];
    const unknown = Object.keys(props).filter((k) => !known.has(k));
    if (unknown.length) out.push(el('div', { class: 'le-warn', title: 'Nothing in this symbol\'s scripts reads these, so they do nothing (a typo?). Edit them in the JSON below.' }, '⚠ Not a setting of this symbol: ' + unknown.join(', ')));
    const groups = this.propsSpec.groups;
    for (const g of Object.keys(groups)) {
      const rows = settings.filter((s) => s.group === g);
      if (!rows.length) continue;
      const nSet = rows.filter((s) => s.name in props).length;
      const d = el('details', { class: 'le-set-group', open: this.openGroups.has(g) || null, ontoggle: (ev) => { if (ev.target.open) this.openGroups.add(g); else this.openGroups.delete(g); } },
        el('summary', {}, groups[g], nSet ? el('small', {}, ` ${nSet} set`) : ''), ...rows.map(field));
      out.push(d);
    }
    return out;
  }

  zonePointsPanel(z) {
    const cs = this.zoneContours(z), n = cs.reduce((a, k) => a + k.nodes.length, 0), curves = curveCount(cs);
    const picked = this.selPoints().length;
    const what = `${n} points${curves ? `, ${curves} curved edge${curves > 1 ? 's' : ''}` : ''}${cs.length > 1 ? `, ${cs.length} outlines` : ''}`;
    return el('div', {},
      el('div', { class: 'le-tip' }, `${what}. Click a point to select it, Shift+click to add or remove, or drag a box from outside the zone. Drag points (Shift snaps), arrows nudge (Shift: 10), Delete removes them. Double-click an edge to add a point. Alt+click a point to switch it between corner and smooth; drag its yellow handles to bend the curve (Alt+drag breaks a smooth point).`),
      picked ? el('div', { class: 'le-row' },
        el('span', {}, `${picked} selected `),
        el('button', { onclick: () => this.setPointsSmooth(false), title: 'sharp corners: the handles go onto the points (Alt+click)' }, 'Corner'),
        el('button', { onclick: () => this.setPointsSmooth(true), title: 'smooth curves through the points (Alt+click)' }, 'Smooth'),
        el('button', { onclick: () => this.deletePoints(), title: 'Delete' }, 'Delete points')) : null);
  }

  zonePanel() {
    const { k } = this.sel;
    const z = this.list('vision')[k];
    const t = transformOf(z);
    const file = 'vision.json';
    const num = (label, val, set) => this.liveNum(label, round2(val), set, { file });
    return el('div', { class: 'le-props' },
      this.inspHead('Vision zone', `#${k + 1}`),
      el('div', { class: 'le-xform' }, num('x', z.x, (v) => { z.x = v; }), num('y', z.y, (v) => { z.y = v; }),
        num('scale x', t.sx, (v) => setTransform(z, t.rot, v, t.sy)),
        num('scale y', t.sy, (v) => setTransform(z, t.rot, t.sx, v)),
        num('rotation', t.rot, (v) => setTransform(z, v, t.sx, t.sy))),
      el('div', { class: 'le-row' }, el('span', { class: 'le-swatch on', style: `--c: ${zoneColour(k)}`, title: 'each zone gets its own colour automatically, only for telling zones apart (the game never uses it)' }), ' Colour is automatic, one per zone'),
      this.zonePointsPanel(z));
  }

  // every trigger in the level: doors and what they listen for, and everything that sends one
  triggerPanel() {
    const rows = [];
    const pick = (layer, k) => () => { this.tool = 'select'; this.tab = 'map'; this.visible[layer] = true; this.visible.triggers = true; if (this.locked[layer]) delete this.locked[layer]; this.sel = { layer, k }; this.refreshPanel(); };
    const where = (e) => `(${Math.round(e.x)}, ${Math.round(e.y)})`;
    this.list('doors').forEach((d, k) => {
      if (!d.props || !d.props.id) return;
      rows.push(el('div', { class: 'le-trig', onclick: pick('doors', k), title: 'select this door' }, el('b', {}, d.props.id), ` ${d.symbol.split('/').pop()} ${where(d)} listens for ${d.props.id}:open / :close`));
    });
    for (const [g, tiles] of this.trapGroups()) {
      const dormant = tiles.filter(([d]) => d.props.dormant).length;
      rows.push(el('div', { class: 'le-trig', onclick: pick('doors', tiles[0][1]), title: 'select its first tile' }, el('b', {}, g), ` trap grid, ${tiles.length} tile${tiles.length === 1 ? '' : 's'}${dormant ? (dormant === tiles.length ? ', dormant' : `, ${dormant} dormant`) : ''}, listens for ${g}:alarm / :on / :off`));
    }
    const names = { powerups: 'pickup', boxes: 'box', enemies: 'enemy' };
    for (const l of ['powerups', 'boxes', 'enemies']) this.list(l).forEach((e, k) => {
      const alarm = alarmTriggers(e), clear = alarmTriggers(e, 'alarmClear');
      const sent = sentTriggers(e).filter((n) => !alarm.includes(n) && !clear.includes(n));
      const kind = e.props && e.props.type === 'trigger' ? 'trigger pad' : names[l] + ' ' + e.symbol.split('/').pop();
      if (l === 'enemies' && this.isAlarm(e)) {
        rows.push(el('div', { class: 'le-trig', onclick: pick(l, k), title: 'select it' }, `${kind} ${where(e)}, spots the player: `, el('b', {}, ['hunters', ...alarm].join(', '))));
        if (clear.length) rows.push(el('div', { class: 'le-trig', onclick: pick(l, k), title: 'select it' }, `${kind} ${where(e)}, alarm stands down: `, el('b', {}, clear.join(', '))));
      }
      if (!sent.length) return;
      const how = e.props && e.props.type === 'trigger' ? 'walked over' : TRIGGER_EVENTS[l][1].replace('when ', '');
      rows.push(el('div', { class: 'le-trig', onclick: pick(l, k), title: 'select it' + (e.script !== undefined ? ' (set by its script)' : '') }, `${kind} ${where(e)}, ${how}: `, el('b', {}, sent.join(', '))));
    });
    return this.section('triggers', 'Triggers', [
      el('div', { class: 'le-tip' }, 'Click one to select it on the map and edit what it sends. Add a trigger pad from the Pickups palette (P). T shows or hides them on the map.'),
      ...rows], { open: true, badge: String(rows.length) });
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
    return this.section('balance', 'Balance', [
      el('div', { class: 'le-stats' },
        el('div', {}, `${(L.enemies || []).length} enemies · ${(L.boxes || []).length} boxes · ${(L.powerups || []).length} pickups`),
        el('div', {}, `Health on the map: ${round2(health)}` + (healthDrops ? ` + ~${round2(healthDrops)} from drops` : '')),
        el('div', { class: 'le-tip' }, 'Ammo (pickups plus expected drops):'), ...rows)], { open: true });
  }
}

// ---------------------------------------------------------------------------- helpers
Object.assign(Editor.prototype, areaMethods);

function round2(v) { return Math.round(v * 100) / 100; }
function layerLabel(key) { return (VIEW_LAYERS.find((l) => l.key === key) || { label: key }).label; }
// small line icons for the layer rows
const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.innerHTML = d; return s; };
const ICON = {
  get eye() { return svg('<path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/>'); },
  get eyeOff() { return svg('<path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"/><path d="M2 14L14 2" stroke="currentColor" stroke-width="1.6"/>'); },
  get lock() { return svg('<rect x="3" y="7" width="10" height="7" rx="1.2" fill="currentColor"/><path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>'); },
  get unlock() { return svg('<rect x="3" y="7" width="10" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".6"/><path d="M5 7V5a3 3 0 016-.6" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".6"/>'); },
};

// box around a decor placement: its sprite scaled, turned (degrees counter-clockwise) and centred on x, y
function decorBounds(e, size) {
  const s = e.scale || 1, a = (e.rotation || 0) * Math.PI / 180;
  const w = size.w * s, h = size.h * s;
  const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  return [e.x - bw / 2, e.y - bh / 2, e.x + bw / 2, e.y + bh / 2];
}

function decorType(e) {
  if (e.of === 'panels') return 'panels'; // a panel's corner lights go with it
  const c = e.sprite.split('/')[0];
  return c === 'greebles2' ? 'greebles' : c;
}

function decorColour(sprite) {
  let h = 0;
  for (const c of sprite.split('/')[0]) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 90%, 65%)`;
}

// decor.json: one placement per line, exactly as tools/art/bake.py writes it
function decorJSON(list) {
  if (!list.length) return '[]\n';
  const one = (e) => '{' + Object.entries(e).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ') + '}';
  return '[\n' + list.map((e) => '  ' + one(e)).join(',\n') + '\n]\n';
}

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
    out.push(...alarmTriggers(e), ...alarmTriggers(e, 'alarmClear'));
  }
  for (const m of [].concat(e.script || []).join('\n').matchAll(/[^.\w]trigger\(\s*["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

// what an alarm unit (as2/enemyAlarm.as) sends when it spots the player (its `alarm` setting) or
// when the alarm stands down (`alarmClear`): one trigger name or a list of them
function alarmTriggers(e, key = 'alarm') {
  const a = e.props && e.props[key];
  return [].concat(a || []).filter((n) => typeof n === 'string' && n);
}

function hiddenLabel(e, layer) {
  if (e.props && e.props.type === 'trigger') return 'trigger pad';
  if (e.name) return e.name;
  return layer === 'powerups' ? 'pickup area' : e.symbol.split('/').pop();
}

// does a clip show anything? (an empty frame, like a pickup on its blank first frame, doesn't)
function drawsSomething(c) {
  if (!c.children) return true; // a shape, bitmap or text
  return c.children.some((x) => !x.removed && x.__visible && (x._alpha > 0) && drawsSomething(x));
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

// byte offsets of the pixels the game reads differently in two ImageDatas of the same size
function classDiff(a, b) {
  const p = a.data, d = b.data, out = [];
  for (let k = 0; k < p.length; k += 4) if (gameClass(p[k], p[k + 1], p[k + 2]) !== gameClass(d[k], d[k + 1], d[k + 2])) out.push(k);
  return out;
}

// the undo record for a pixel layer edit, cropped to box [x, y, w, h], from a full-size grab
function cropUndo(st, file, full, [x, y, w, h]) {
  const before = { file, x, y, w, h, pixels: new ImageData(w, h) };
  for (let j = 0; j < h; j++) before.pixels.data.set(full.pixels.data.subarray(((y + j) * st.w + x) * 4, ((y + j) * st.w + x + w) * 4), j * w * 4);
  return { before, after: st.grab(file, x, y, w, h) };
}

// one-line JSON with a space after commas and colons
function oneLine(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(oneLine).join(', ') + ']';
  return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + oneLine(x)).join(', ') + '}';
}

function nodeColour(e) {
  const a = e.color && e.color.add;
  return a ? `rgb(${a[0]},${a[1]},${a[2]})` : '#0ff';
}

// the value every setting ends up with: props, else what the symbol forces, else its default
// (expressions such as "hunter || patroller" are worked out when they only use other settings)
function effectiveSettings(settings, props) {
  const lit = (x) => { try { return x === undefined ? undefined : JSON.parse(x.replace(/^\./, '0.').replace(/^-\./, '-0.')); } catch { return undefined; } };
  const vals = {}, defaults = {};
  const exprOf = (s) => (s.forced !== undefined ? s.forced : s.default);
  for (let pass = 0; pass < 3; pass++) {
    for (const s of settings) {
      const x = exprOf(s);
      let d = s.value !== undefined && s.forced === undefined ? s.value : lit(x);
      if (d === undefined && x && /^[\w\s|&!?:().*+\-/<>=]+$/.test(x)) {
        const ids = [...new Set(x.match(/[A-Za-z_]\w*/g) || [])];
        if (ids.every((id) => id in vals && (typeof vals[id] === 'number' || typeof vals[id] === 'boolean'))) {
          try { d = Function(...ids, 'return (' + x + ');')(...ids.map((id) => vals[id])); } catch { d = undefined; }
        }
      }
      if (d !== undefined) defaults[s.name] = d;
      const v = s.forced === undefined && s.name in props ? props[s.name] : d;
      if (v !== undefined) vals[s.name] = v;
    }
  }
  vals.__defaults = defaults;
  return vals;
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
#level-editor .le-panel { position: absolute; top: 0; right: 0; bottom: 0; width: 320px; display: flex; flex-direction: column; background: rgba(8,20,20,0.96); border-left: 1px solid #244; box-sizing: border-box; }
#level-editor .le-head { flex: none; padding: 8px 10px 0; background: #0a1a1a; border-bottom: 1px solid #244; }
#level-editor .le-head-row { margin: 0 0 6px; flex-wrap: nowrap; }
#level-editor .le-head .le-level { flex: 1; min-width: 0; font: 600 12px ui-monospace, monospace; padding: 3px 4px; }
#level-editor .le-play { background: #2a7; color: #021; border-color: #4fc; font-weight: 600; }
#level-editor .le-grow { flex: 1; }
#level-editor .le-tabs { display: flex; gap: 2px; margin: 0 -10px; padding: 0 10px; }
#level-editor .le-tab { flex: 1; margin: 0; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: #7aa; padding: 5px 0 4px; font-weight: 600; position: relative; }
#level-editor .le-tab:hover { color: #cfe; }
#level-editor .le-tab.on { color: #8ff; border-bottom-color: #4fc; background: transparent; }
#level-editor .le-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #fc6; margin-left: 5px; vertical-align: 1px; }
#level-editor .le-body { flex: 1; overflow-y: auto; padding: 8px 10px 16px; }
#level-editor .le-block { margin: 0 0 10px; }
#level-editor .le-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #6a9; margin: 0 0 3px; font-weight: 600; }
#level-editor .le-label small { text-transform: none; letter-spacing: 0; color: #577; font-weight: normal; }
#level-editor .le-row > .le-label { margin: 0 4px 0 0; }
#level-editor .le-gap { margin-top: 10px; }
#level-editor .le-toolgroup { margin-bottom: 5px; }
#level-editor .le-tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; }
#level-editor .le-tools button { margin: 0; display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; }
#level-editor kbd { font: 10px ui-monospace, monospace; color: #6a9; border: 1px solid #355; border-radius: 3px; padding: 0 3px; line-height: 14px; }
#level-editor button.on kbd { color: #021; border-color: #063; }
#level-editor .le-toolopts { background: #0c2424; border: 1px solid #1f4040; border-radius: 4px; padding: 6px 8px; margin: 0 0 10px; }
#level-editor .le-toolopts .le-row { margin: 4px 0 0; }
#level-editor .le-toolname { color: #cfe; }
#level-editor .le-chip { display: inline-block; padding: 0 5px; border-radius: 8px; background: #134; color: #8fd; border: 1px solid #276; font-size: 10px; margin: 1px 0; }
#level-editor .le-chip.locked { color: #fb6; border-color: #c84; background: #2a1d0c; }
#level-editor .le-chip.off { color: #688; border-color: #355; background: transparent; }
#level-editor .le-clamp { cursor: pointer; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 4px; }
#level-editor .le-clamp.open { display: block; }
#level-editor .le-banner { display: flex; gap: 6px; align-items: center; background: #2a2210; border: 1px solid #864; color: #fc6; border-radius: 4px; padding: 5px 8px; margin: 0 0 10px; font-size: 11px; }
#level-editor .le-banner button { flex: none; }
#level-editor .le-overlays { margin: 6px 0 2px 4px; }
#level-editor .le-layer kbd { opacity: 0.7; }
#level-editor .le-count { width: 26px; text-align: right; }
#level-editor .le-fold { color: #9cd !important; }
#level-editor .le-inspector { position: sticky; bottom: -16px; max-height: 55vh; overflow-y: auto; border-top: 2px solid #2a6; margin: 4px -10px -16px; padding: 8px 10px 16px; background: #0c2222; box-shadow: 0 -6px 12px rgba(0,0,0,0.5); }
#level-editor .le-xform { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; margin: 4px 0; }
#level-editor .le-xform label { display: flex; align-items: center; justify-content: space-between; gap: 4px; color: #9bb; }
#level-editor .le-xform input[type=number] { width: 78px; }
#level-editor .le-insp-head { display: flex; align-items: center; gap: 4px; margin: 0 0 6px; }
#level-editor .le-insp-head h4 { margin: 0; font-size: 13px; color: #cfe; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
#level-editor .le-insp-head h4 small { font-size: 11px; }
#level-editor .le-insp-head > select { flex: 1; }
#level-editor .le-actions { display: flex; gap: 2px; flex: none; }
#level-editor .le-actions button { margin: 0; width: 24px; padding: 2px 0; }
#level-editor .le-actions .le-del:hover { background: #7a2a2a; border-color: #c55; }
#level-editor .le-empty { color: #9bb; margin: 2px 0 6px; }
#level-editor .le-preset { border-style: dashed; }
#level-editor .le-sec { border: 1px solid #1f4040; border-radius: 4px; margin: 0 0 8px; background: #0b1f1f; }
#level-editor .le-sec > summary { cursor: pointer; padding: 6px 8px; color: #8ff; font-weight: 600; display: flex; gap: 6px; align-items: baseline; list-style: none; }
#level-editor .le-sec > summary::-webkit-details-marker { display: none; }
#level-editor .le-sec > summary::before { content: '▸'; color: #577; width: 10px; }
#level-editor .le-sec[open] > summary::before { content: '▾'; }
#level-editor .le-sec > summary span { flex: 1; }
#level-editor .le-sec > summary small { color: #688; font-weight: normal; font-family: ui-monospace, monospace; font-size: 10px; }
#level-editor .le-sec-body { padding: 0 8px 8px; }
#level-editor .le-step { border: 1px solid #1f4040; border-radius: 4px; padding: 6px 8px 8px; margin: 0 0 8px; background: #0b1f1f; }
#level-editor .le-step-head { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; color: #8ff; }
#level-editor .le-step-n { width: 18px; height: 18px; border-radius: 50%; background: #2a7; color: #021; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
#level-editor .le-ok { color: #6c8; }
#level-editor .le-warnc { color: #fc6; }
#level-editor h4 { margin: 10px 0 4px; font-size: 12px; color: #8ff; }
#level-editor h4 small, #level-editor .le-layer small { color: #688; font-weight: normal; }
#level-editor button { background: #143; color: #cfe; border: 1px solid #276; border-radius: 3px; padding: 2px 6px; margin: 1px; font: inherit; cursor: pointer; }
#level-editor button.on { background: #2a7; color: #021; border-color: #4fc; }
#level-editor input, #level-editor select, #level-editor textarea { background: #021; color: #cfe; border: 1px solid #276; border-radius: 3px; font: 11px ui-monospace, monospace; }
#level-editor input[type=number] { width: 58px; }
#level-editor textarea { width: 100%; box-sizing: border-box; }
#level-editor .le-set-group { margin: 4px 0; border-top: 1px solid #244; padding-top: 2px; }
#level-editor .le-set-group summary { cursor: pointer; color: #8ff; font-weight: 600; padding: 2px 0; }
#level-editor .le-set-group summary small { color: #fc6; font-weight: normal; }
#level-editor .le-set { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
#level-editor .le-set > input:not([type=checkbox]), #level-editor .le-set > select { flex: 1; min-width: 0; }
#level-editor .le-set input::placeholder { color: #587; }
#level-editor .le-set-name { width: 112px; flex: none; overflow: hidden; text-overflow: ellipsis; color: #9bb; }
#level-editor .le-set-bool .le-set-name { width: auto; flex: 1; }
#level-editor .le-set-name.on { color: #fc6; }
#level-editor .le-set-name.forced { color: #666; text-decoration: line-through; }
#level-editor .le-reset { padding: 0 4px; line-height: 1.2; }
#level-editor .le-warn { color: #fa6; margin: 4px 0; }
#level-editor .le-brief-cap { border-left: 2px solid #276; padding-left: 6px; margin: 4px 0; }
#level-editor .le-brief-cap textarea { margin-top: 2px; }
#level-editor textarea.le-script { font: 11px/1.35 ui-monospace, monospace; white-space: pre; tab-size: 4; }
#level-editor pre { background: #021; padding: 4px; max-height: 160px; overflow: auto; font-size: 10px; margin: 2px 0; }
#level-editor .le-row { margin: 4px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
#level-editor .le-anchor { display: inline-grid; grid-template-columns: repeat(3, 16px); gap: 1px; margin-left: 8px; }
#level-editor .le-anchor button { width: 16px; height: 16px; padding: 0; font-size: 9px; line-height: 14px; }
#level-editor .le-tip { color: #799; font-size: 11px; margin: 2px 0; }
#level-editor .le-warn { color: #fc6; font-size: 11px; margin: 4px 0; }
#level-editor .le-swatch { border-left: 14px solid var(--c); }
#level-editor .le-shapes { margin: 2px 0 6px 12px; padding: 4px 0 2px 8px; border-left: 2px solid #2a6; }
#level-editor .le-shape-list { max-height: 220px; overflow-y: auto; border: 1px solid #234; border-radius: 3px; margin: 4px 0; }
#level-editor .le-shape { display: flex; gap: 4px; align-items: center; padding: 1px 4px; cursor: default; }
#level-editor .le-shape.in { padding-left: 20px; }
#level-editor .le-shape.on { background: rgba(46,230,255,0.18); }
#level-editor .le-shape.hidden .le-name { opacity: 0.5; }
#level-editor .le-shape.group .le-name { font-style: italic; }
#level-editor .le-shape .le-name { flex: 1; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#level-editor .le-mode { width: 14px; text-align: center; color: var(--c, #9ab); text-shadow: 0 0 1px #8aa; }
#level-editor .le-hot { border-color: #fc6 !important; color: #fc6; }
#level-editor .le-layer { display: flex; gap: 4px; align-items: center; padding: 1px 2px 1px 4px; border-radius: 3px; border-left: 3px solid transparent; }
#level-editor .le-layer .le-name { flex: 1; }
#level-editor .le-layer .le-pick { cursor: pointer; }
#level-editor .le-layer .le-pick:hover { text-decoration: underline; }
#level-editor .le-layer.target { border-left-color: #4fc; background: #0f2d26; }
#level-editor .le-layer.target .le-name { color: #8fd; }
#level-editor .le-layer.has-sel { background: #0d3442; box-shadow: inset 0 0 0 1px #2ee6ff; }
#level-editor .le-layer.has-sel .le-name { color: #2ee6ff; font-weight: bold; }
#level-editor .le-layer.hidden .le-name, #level-editor .le-layer.locked .le-name { opacity: 0.55; }
#level-editor .le-layer.target.locked { border-left-color: #c84; }
#level-editor .le-layer.picked .le-name { text-decoration: underline 2px #4fc; text-underline-offset: 3px; }
#level-editor .le-nsel { color: #2ee6ff !important; }
#level-editor button.le-icon { width: 20px; height: 18px; padding: 1px 2px; margin: 0; background: transparent; border-color: transparent; color: #577; display: inline-flex; align-items: center; justify-content: center; }
#level-editor button.le-icon.on { color: #cfe; }
#level-editor button.le-icon:hover { border-color: #276; }
#level-editor .le-layer.locked button.le-icon.on { color: #fb6; }
#level-editor .le-icon svg { width: 14px; height: 14px; }
#level-editor .le-icon-gap { width: 20px; flex: none; }
#level-editor .le-tools button.usable { box-shadow: inset 3px 0 0 #4fc; }
#level-editor .le-works { font-size: 11px; color: #799; margin: 0; }
#level-editor button:disabled { opacity: 0.45; cursor: default; }
#level-editor .le-palette button { font-size: 11px; }
#level-editor .le-decor-pal { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 3px; max-height: 220px; overflow-y: auto; }
#level-editor .le-decor-pal button { padding: 2px; height: 44px; background: #1b2b2b; }
#level-editor .le-decor-pal img, #level-editor .le-decor-thumb { max-width: 100%; max-height: 100%; object-fit: contain; display: block; margin: auto; }
#level-editor .le-decor-thumb { width: 48px; height: 48px; background: #1b2b2b; border-radius: 3px; }
#level-editor .le-types { flex-wrap: wrap; gap: 2px 8px; font-size: 11px; }
#level-editor .le-optgroup { margin: 4px 0; }
#level-editor .le-optgroup summary { font-size: 12px; color: #9cd; }
#level-editor .le-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 8px; }
#level-editor .le-opt { display: flex; flex-direction: column; font-size: 10px; color: #9ab; }
#level-editor .le-opt.set { color: #fd6; }
#level-editor .le-opt input { width: 100%; box-sizing: border-box; }
#level-editor .le-danger { background: #7a2a2a; color: #fff; }
#level-editor .le-artlog { max-height: 160px; overflow: auto; white-space: pre-wrap; font-size: 10px; background: #000a; padding: 4px; color: #fcc; }
#level-editor .le-stats div { margin: 1px 0; }
#level-editor .le-trig { cursor: pointer; padding: 1px 3px; border-radius: 3px; font-size: 11px; }
#level-editor .le-trig:hover { background: #164; }
#level-editor .le-trig b { color: #fd6; font-weight: normal; }
#level-editor .le-save { font-weight: bold; }
#level-editor .le-server { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #9ab; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
#level-editor .le-server::before { content: ''; width: 8px; height: 8px; border-radius: 50%; flex: none; background: #667; }
#level-editor .le-server.ok::before { background: #3c6; box-shadow: 0 0 4px #3c6; }
#level-editor .le-server.busy::before { background: #fc3; animation: le-pulse 0.8s infinite alternate; }
#level-editor .le-server.err { color: #f88; }
#level-editor .le-server.err::before { background: #f55; }
#level-editor .le-server.offline::before { background: transparent; border: 1px solid #889; }
@keyframes le-pulse { to { opacity: 0.3; } }
#level-editor .le-coords { position: absolute; left: 8px; bottom: 6px; color: #8aa; font: 11px ui-monospace, monospace; pointer-events: none; }
#level-editor .le-status { position: absolute; left: 8px; top: 6px; right: 330px; color: #cfe; pointer-events: none; text-shadow: 0 1px 2px #000; }
#level-editor .le-status.err { color: #f88; }
`;

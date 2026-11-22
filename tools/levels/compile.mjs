// Level data -> library symbols and screen_mc frames, in the readable source format of
// tools/flash-source/format.mjs. Pure functions with no Node imports, so the build
// (tools/levels/levels.mjs) and the in-game editor (src/editor/) compile levels the same way.
//
// A level is {index, folder, settings, briefing, boxes, powerups, enemies, doors, features,
// pathNodes, vision, decor, size: {w, h}, backgroundSize: {w, h}}; see levels/README.md for the files.

export const LAYERS = ['boxes', 'powerups', 'enemies'];

// Depths on screen_mc for one level's game frame (all below the persistent templates at 2900+).
export const DEPTH = { background: 3, doors: 10, level: 200, vision: 210, features: 211, boxes: 1000, powerups: 1001, enemies: 1002, fade: 3281 };

// --- AS2 literals -------------------------------------------------------------------
// {"$ref": "a2"} is a reference to the sibling clip named a2 (_parent.a2), e.g. path node links.
// {"$trigger": "door2:open"} (or a list of names) is a function that sends those triggers,
// e.g. "onPickup": {"$trigger": "door2:open"} on a pickup or "onDie" on a box or enemy.
export function asLiteral(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') {
    if (!isFinite(v)) throw new Error('props: numbers must be finite');
    return String(v);
  }
  if (Array.isArray(v)) return '[' + v.map(asLiteral).join(', ') + ']';
  if (v && typeof v === 'object') {
    if (isRef(v)) {
      if (!/^[A-Za-z_]\w*$/.test(v.$ref)) throw new Error('props: bad $ref ' + JSON.stringify(v.$ref));
      return '_parent.' + v.$ref;
    }
    if (isTrigger(v)) return 'function () { ' + triggerNames(v).map((n) => `trigger(${JSON.stringify(n)}); `).join('') + '}';
    return '{' + Object.entries(v).map(([k, x]) => {
      if (!/^[A-Za-z_]\w*$/.test(k)) throw new Error('props: bad key ' + JSON.stringify(k));
      return k + ':' + asLiteral(x);
    }).join(', ') + '}';
  }
  throw new Error('props: unsupported value ' + JSON.stringify(v));
}

export const isRef = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$ref === 'string';

export const isTrigger = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && '$trigger' in v;
export function triggerNames(v) {
  const n = [].concat(v.$trigger);
  if (!n.length || n.some((x) => typeof x !== 'string' || !x)) throw new Error('props: $trigger needs a trigger name or a list of them');
  return n;
}

export function propsScript(props) {
  return ['onClipEvent (load) {', ...Object.entries(props).map(([k, v]) => {
    if (!/^[A-Za-z_]\w*$/.test(k)) throw new Error('props: bad name ' + JSON.stringify(k));
    return `    ${k} = ${asLiteral(v)};`;
  }), '}'];
}

// An instance's load code: its props as `name = value;` lines, run before its script when it has
// both. They go at the top of the script's onClipEvent(load) block (a second load block would
// replace the first), between PROPS_BEGIN/PROPS_END markers, so stripProps() gives back the script
// as written: the editor uses that to keep running the build's compiled script after props change.
export const PROPS_BEGIN = '/* props */', PROPS_END = '/* end props */';
export function instanceScript(props, script) {
  if (!props) return script;
  if (script === undefined) return propsScript(props);
  const lines = [].concat(script).join('\n').split('\n');
  const at = lines.findIndex((l) => /^\s*onClipEvent\s*\(\s*load\s*\)\s*\{\s*$/.test(l));
  const body = propsScript(props).slice(1, -1);
  if (at < 0) return ['onClipEvent (load) {', '    ' + PROPS_BEGIN, ...body, '    ' + PROPS_END, '}', ...lines];
  return [...lines.slice(0, at + 1), '    ' + PROPS_BEGIN, ...body, '    ' + PROPS_END, ...lines.slice(at + 1)];
}
export const stripProps = (text) => text.replace(/^[ \t]*\/\* props \*\/[\s\S]*?\/\* end props \*\/[^\n]*\n?/m, '').replace(/^onClipEvent \(load\) \{\n\}\n?/, '');

// instance -> timeline place change
export function place(inst, depth, where) {
  const { symbol, props, script, ...rest } = inst;
  if (!symbol) throw new Error(`${where}: instance without "symbol"`);
  const c = { place: symbol, depth, ...rest };
  try {
    if (props || script !== undefined) { c.clipEvents = [1]; c.script = instanceScript(props, script); }
  } catch (e) { throw new Error(`${where}: ${e.message}`); }
  return c;
}

// a full-size bitmap as sprite > shape > bitmap, under the names the game's ids already use
export function bitmapSymbols(base, { w, h }) {
  return [
    [`${base}/shape 1`, {
      kind: 'shape',
      bounds: [0, w, 0, h],
      fills: [{ type: 'clipped bitmap (unsmoothed)', bitmap: `${base}/shape 1/bitmap 1`, m: [1, 0, 0, 1, 0, 0], repeat: false, smooth: false }],
      lines: [],
      paths: [{ fill: 0, d: `M ${w} ${h} L 0 ${h} L 0 0 L ${w} 0 L ${w} ${h} Z` }],
    }],
    [base, { kind: 'sprite', symbol: { type: 'movie clip' }, frames: 1, timeline: [{ frame: 1, changes: [{ place: `${base}/shape 1`, depth: 1, x: 0, y: 0 }] }] }],
  ];
}

// --- vision zones -------------------------------------------------------------------
// A zone is {x, y, scale|matrix, d} with d an SVG-style path (M/L/Q/Z, absolute) in
// the zone's own coordinates, or {x, y, ..., points: [[x, y], ...]} for a plain polygon.
// Each becomes a clip inside vision_mc, so the game sees the same structure as the original.
// The game only hit-tests the shapes (vision_mc is hidden), so a zone's fill colour is not
// data: zone k is drawn in zoneColour(k), a distinct hue per zone for telling them apart.
export function zoneColour(k) {
  // golden-angle hues: neighbours in the list are far apart, and no two zones share one
  const h = (k * 137.508) % 360, l = k % 2 ? 0.42 : 0.55, a = 0.75 * Math.min(l, 1 - l);
  const f = (n) => { const t = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1)))); };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function zonePath(z) {
  if (z.points) {
    if (!Array.isArray(z.points) || z.points.length < 3) throw new Error('a vision zone needs at least 3 points');
    return 'M ' + z.points.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L ') + ' Z';
  }
  if (typeof z.d !== 'string') throw new Error('a vision zone needs "d" or "points"');
  return z.d;
}
const num = (v) => { if (!isFinite(v)) throw new Error('vision: numbers must be finite'); return String(Math.round(v * 100) / 100); };

function pathBounds(d) {
  const n = d.match(/-?[\d.]+(e-?\d+)?/g).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

export function visionSymbols(L) {
  const i = L.index, base = `level assets/vision${i}`;
  const out = [], changes = [];
  (L.vision || []).forEach((z, k) => {
    const where = `levels/${L.folder}/vision.json[${k}]`;
    let d;
    try { d = zonePath(z); } catch (e) { throw new Error(`${where}: ${e.message}`); }
    const name = `${base}-${k + 1}`;
    out.push([`${name}/shape 1`, { kind: 'shape', bounds: pathBounds(d), fills: [{ type: 'solid', color: zoneColour(k) }], lines: [], paths: [{ fill: 0, d }] }]);
    out.push([name, { kind: 'sprite', symbol: { type: 'movie clip' }, frames: 1, timeline: [{ frame: 1, changes: [{ place: `${name}/shape 1`, depth: 1, x: 0, y: 0 }] }] }]);
    const c = { place: name, depth: 2 * k + 1, x: z.x || 0, y: z.y || 0 };
    if (z.scale !== undefined) c.scale = z.scale;
    if (z.matrix !== undefined) c.matrix = z.matrix;
    changes.push(c);
  });
  out.push([base, { kind: 'sprite', symbol: { type: 'movie clip' }, frames: 1, timeline: changes.length ? [{ frame: 1, changes }] : [] }]);
  return out;
}

export function container(list, where) {
  return { kind: 'sprite', symbol: { type: 'movie clip' }, frames: 1, timeline: [{ frame: 1, changes: list.map((inst, k) => place(inst, k + 1, `${where}[${k}]`)) }] };
}

// The library symbols one level adds: [[name, source object], ...] (bitmaps are named in the
// fills; the caller supplies them as "level assets/level<N>/shape 1/bitmap 1" and
// "level assets/background<N>/shape 1/bitmap 1").
// --- briefings ----------------------------------------------------------------------
// briefing.json is {title, body, captions: [{style, text, x, y}], graphics: [placements]} (see
// levels/README.md). The screen around it is the same for every level: the wipe-in mask, the
// backdrop, the "LVL.NN" label, the buttons and the scanlines. Texts are live text fields in the
// game's embedded fonts, one generated symbol each: level assets/briefingN/text K.
export const BRIEFING_STYLES = {
  // font, size, colour, ascent (px), box width, alignment
  title: { font: 'fonts/Digital Display Regular Bold', size: 36, color: '#ffffff', asc: 38.04, w: 640, align: 'left' },
  label: { font: 'fonts/Digital Display Regular Bold', size: 14, color: '#ffffff', asc: 14.79, w: 200, align: 'left' },
  body: { font: 'fonts/Consolas', size: 14, color: '#ffffff', asc: 12.88, w: 450, align: 'left', wrap: true, leading: 4 },
  name: { font: 'fonts/Digital Display Regular', size: 16, color: '#00ffff', asc: 16.91, w: 240, align: 'center' },
  note: { font: 'fonts/Consolas', size: 10, color: '#ffffff', asc: 9.2, w: 240, align: 'center', leading: 10.3 },
};
// where the fixed texts go: x is the left edge, y the top of the first line (captions: x is the centre)
export const BRIEFING_LAYOUT = { title: { x: 87.05, y: 81.76 }, label: { x: 89.05, y: 76.01 }, body: { x: 90, y: 164.12 } };
const BRIEFING_DEPTH = { mask: 3281, backdrop: 3369, first: 3370 };
const BTN_PLAY = ['on (release) {', '    continueLevel();', '}', 'on (keyPress "<Space>") {', '    continueLevel();', '}', '', 'on (keyPress "<Enter>") {', '    continueLevel();', '}', ''];
const BTN_BACK = ['on (release) {', '    quit();', '}', '', 'on (keyPress "<Escape>") {', '    quit();', '}', ''];

export const briefingTextName = (i, k) => `level assets/briefing${i}/text ${k}`;

// the texts of a level's briefing, in drawing order: [{style, text, x, y, leading?}]
export function briefingTexts(L) {
  const b = L.briefing || {};
  const lay = BRIEFING_LAYOUT;
  const out = [];
  for (const c of b.captions || []) if (c && c.text) out.push({ style: BRIEFING_STYLES[c.style] ? c.style : 'note', text: String(c.text), x: +c.x || 0, y: +c.y || 0, leading: c.leading });
  if (b.title) out.push({ style: 'title', text: String(b.title), ...lay.title });
  out.push({ style: 'label', text: b.label !== undefined ? String(b.label) : 'LVL.' + String(L.index).padStart(2, '0'), ...lay.label });
  if (b.body) out.push({ style: 'body', text: String(b.body), ...lay.body, leading: b.bodyLeading });
  return out;
}

function textField(t) {
  const s = BRIEFING_STYLES[t.style];
  const lines = t.text.split('\n').length;
  const leading = t.leading ?? s.leading ?? 2;
  const h = Math.ceil(lines * (s.size * 1.2 + leading) + 8);
  const x0 = s.align === 'center' ? -s.w / 2 : 0;
  return {
    kind: 'text field', bounds: [x0, x0 + s.w, 0, h], wordWrap: !!s.wrap, multiline: true, password: false, readOnly: true,
    font: s.font, size: s.size, color: s.color, autoSize: false, align: s.align, leftMargin: 0, rightMargin: 0, indent: 0,
    leading, noSelect: true, border: false, html: false, useOutlines: true, variable: '', text: t.text,
  };
}

export function briefingSymbols(L) {
  return briefingTexts(L).map((t, k) => [briefingTextName(L.index, k), textField(t)]);
}

// the briefing frame's placements on screen_mc
export function briefingChanges(L) {
  const b = L.briefing || {};
  const where = `levels/${L.folder}/briefing.json`;
  const c = [];
  let d = BRIEFING_DEPTH.first;
  c.push({ place: b.backdrop || 'screen_mc/shape 2', depth: BRIEFING_DEPTH.backdrop, x: 0, y: 0 });
  (b.graphics || []).forEach((g, k) => c.push(place(g, d++, `${where} graphics[${k}]`)));
  // text fields draw 2 px inside their box (centred ones are centred on x)
  briefingTexts(L).forEach((t, k) => c.push({ place: briefingTextName(L.index, k), depth: d++, x: round2(BRIEFING_STYLES[t.style].align === 'center' ? t.x : t.x - 2), y: round2(t.y - 2) }));
  c.push({ place: 'interface/buttons/btn play mission', depth: d++, x: 548, y: 544, clipEvents: [2048, 131072, 131072], script: BTN_PLAY });
  c.push({ place: 'interface/buttons/btn back to main menu', depth: d++, x: 65, y: 3.05, script: BTN_BACK });
  c.push({ place: 'interface/screens/briefing monitor scanlines anim', depth: d++, x: 0, y: 0, color: { alpha: 0.1484375 }, blend: 'overlay' });
  c.unshift({ place: 'interface/mask wipe', depth: BRIEFING_DEPTH.mask, x: 0, y: 0, clipDepth: d });
  return c;
}
const round2 = (v) => Math.round(v * 100) / 100;

// briefing.json as written to disk: one key per line, captions and graphics one per line
export function briefingJSON(b) {
  const parts = [];
  for (const [k, v] of Object.entries(b || {})) {
    if (Array.isArray(v)) parts.push(`  ${JSON.stringify(k)}: [` + (v.length ? '\n' + v.map((x) => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]' : ']'));
    else parts.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  }
  return '{\n' + parts.join(',\n') + '\n}\n';
}

export function levelSymbols(L) {
  const i = L.index;
  const out = [...bitmapSymbols(`level assets/level${i}`, L.size), ...bitmapSymbols(`level assets/background${i}`, L.backgroundSize || L.size)];
  for (const layer of LAYERS) out.push([`level assets/${layer}${i}`, container(L[layer] || [], `levels/${L.folder}/${layer}.json`)]);
  out.push(...visionSymbols(L));
  out.push(...briefingSymbols(L));
  return out;
}

export function gameChanges(L) {
  const i = L.index;
  const doors = L.doors || [], features = L.features || [];
  const c = [{ place: `level assets/background${i}`, depth: DEPTH.background, x: 0, y: 0, name: 'background_mc' }];
  if (doors.length > DEPTH.level - DEPTH.doors) throw new Error(`levels/${L.folder}: too many doors`);
  doors.forEach((d, k) => c.push(place(d, DEPTH.doors + k, `levels/${L.folder}/doors.json[${k}]`)));
  c.push({ place: `level assets/level${i}`, depth: DEPTH.level, x: 0, y: 0, name: 'level_mc' });
  const pathNodes = L.pathNodes || [];
  if (features.length + pathNodes.length > DEPTH.boxes - DEPTH.features) throw new Error(`levels/${L.folder}: too many features and path nodes`);
  // vision_mc holds the vision zones (vision.json); the game looks for it by name. The
  // original levels placed it scaled 0.999939 across, and the zones' edges depend on it
  c.push({ place: `level assets/vision${i}`, depth: DEPTH.vision, x: 0, y: 0, scale: [0.999939, 1], name: 'vision_mc' });
  features.forEach((d, k) => c.push(place(d, DEPTH.features + k, `levels/${L.folder}/features.json[${k}]`)));
  // path nodes go right after the features: they find each other as siblings on screen_mc
  pathNodes.forEach((d, k) => c.push(place(d, DEPTH.features + features.length + k, `levels/${L.folder}/pathNodes.json[${k}]`)));
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
    frame(L.index * 2 + 1, briefingChanges(L));
    const fade = [{ place: 'graphic assets/fade in anim', depth: DEPTH.fade, x: 0, y: 0 }];
    frame(L.index * 2 + 2, [...gameChanges(L), ...fade], 'startLevel();');
  }
  const { levels: _, ...rest } = screen;
  return { ...rest, frames: Math.max(2, levels.length * 2), timeline };
}

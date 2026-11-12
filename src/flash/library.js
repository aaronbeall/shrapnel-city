// Loads the extracted SWF data (assets/swf.json + assets/symbols.json + bitmaps)
// and builds cached Path2D geometry for shapes, morphs, fonts and texts.
import { invert, mul } from './geom.js';

export function buildPath(d, out = new Path2D()) {
  let i = 0;
  const n = d.length;
  while (i < n) {
    const c = d[i++];
    if (c === 'M') { out.moveTo(d[i], d[i + 1]); i += 2; }
    else if (c === 'L') { out.lineTo(d[i], d[i + 1]); i += 2; }
    else if (c === 'Q') { out.quadraticCurveTo(d[i], d[i + 1], d[i + 2], d[i + 3]); i += 4; }
    else if (c === 'Z') { out.closePath(); }
  }
  return out;
}

// morph commands carry start and end coords; t in 0..1
export function buildMorphPath(d, t) {
  const p = new Path2D();
  const u = 1 - t;
  let i = 0;
  const n = d.length;
  while (i < n) {
    const c = d[i++];
    if (c === 'M') {
      p.moveTo(d[i] * u + d[i + 2] * t, d[i + 1] * u + d[i + 3] * t); i += 4;
    } else if (c === 'Q') {
      const cx = d[i] * u + d[i + 4] * t, cy = d[i + 1] * u + d[i + 5] * t;
      const x = d[i + 2] * u + d[i + 6] * t, y = d[i + 3] * u + d[i + 7] * t;
      if (cx === null || isNaN(cx)) p.lineTo(x, y); else p.quadraticCurveTo(cx, cy, x, y);
      i += 8;
    } else if (c === 'Z') p.closePath();
  }
  return p;
}

const lerp = (a, b, t) => a + (b - a) * t;

export function lerpFill(f, t) {
  if (t === 0 || !('c1' in f || 'm1' in f || 'stops1' in f)) return f;
  const o = { t: f.t };
  if (f.c) o.c = f.c.map((v, i) => lerp(v, f.c1[i], t));
  if (f.m) o.m = f.m.map((v, i) => lerp(v, f.m1[i], t));
  if (f.stops) o.stops = f.stops.map((s, j) => s.map((v, i) => lerp(v, f.stops1[j][i], t)));
  if ('focal' in f) o.focal = f.focal;
  if ('bitmap' in f) { o.bitmap = f.bitmap; o.repeat = f.repeat; o.smooth = f.smooth; }
  return o;
}

export class Library {
  constructor(base = 'assets/') {
    this.base = base;
    this.chars = new Map();
    this.images = new Map();
    this.byName = new Map();     // XFL library name -> char id
    this.byLinkage = new Map();  // linkage id -> char id
    this.symbols = new Map();    // char id -> {name, linkage, scripts, labels}
    this.instanceScripts = {};
  }

  async load(onProgress) {
    const [swf, sym] = await Promise.all([
      fetch(this.base + 'swf.json').then((r) => r.json()),
      fetch(this.base + 'symbols.json').then((r) => r.json()),
    ]);
    this.stage = swf.stage;
    this.frameRate = swf.frameRate;
    this.background = swf.background;
    for (const [id, c] of Object.entries(swf.chars)) {
      c.id = +id;
      this.chars.set(+id, c);
    }
    swf.root.type = 'sprite';
    swf.root.id = 0;
    this.chars.set(0, swf.root);
    for (const [name, id] of Object.entries(swf.exports)) this.byLinkage.set(name, id);
    for (const [id, s] of Object.entries(sym.symbols)) {
      this.symbols.set(+id, s);
      this.byName.set(s.name, +id);
    }
    this.instanceScripts = sym.instances;
    const bitmaps = [...this.chars.values()].filter((c) => c.type === 'bitmap');
    let done = 0;
    await Promise.all(bitmaps.map(async (c) => {
      const img = new Image();
      img.src = this.base + c.src;
      await img.decode();
      this.images.set(c.id, img);
      done++;
      if (onProgress) onProgress(done / bitmaps.length);
    }));
    for (const c of this.chars.values()) this.prepare(c);
  }

  get(id) { return this.chars.get(id); }

  idFor(name) {
    if (this.byLinkage.has(name)) return this.byLinkage.get(name);
    if (this.byName.has(name)) return this.byName.get(name);
    return undefined;
  }

  prepare(c) {
    if (c.type === 'shape') {
      for (const p of c.paths) p.path = buildPath(p.d);
    } else if (c.type === 'morph') {
      c.cache = new Map();
    } else if (c.type === 'font') {
      c.paths = c.glyphs.map((g) => buildPath(g));
      c.codeMap = new Map(c.codes.map((code, i) => [code, i]));
    } else if (c.type === 'sprite') {
      c.states = [];
    }
  }

  // morph geometry at ratio t (0..1), cached
  morphAt(c, t) {
    const key = Math.round(t * 4096);
    let m = c.cache.get(key);
    if (!m) {
      const tt = key / 4096;
      m = {
        paths: c.paths.map((p) => ({
          f: p.f, l: p.l, path: buildMorphPath(p.d, tt),
          style: p.f !== undefined ? lerpFill(c.fills[p.f], tt) : lerpLine(c.lines[p.l], tt),
        })),
      };
      if (c.cache.size > 256) c.cache.clear();
      c.cache.set(key, m);
    }
    return m;
  }

  // Display list state of a sprite at a given frame (1-based):
  // Map depth -> {id, placed, matrix, cx, ratio, name, clipDepth, filters, blend}
  spriteState(c, frame) {
    const st = c.states;
    if (!st.length) {
      let dl = new Map();
      c.frames.forEach((ops, fi) => {
        dl = new Map(dl);
        for (const op of ops) {
          if (op.op === 'remove') { dl.delete(op.depth); continue; }
          const prev = dl.get(op.depth);
          let e;
          if (op.id !== undefined && (op.new || !prev || !op.move)) {
            e = { id: op.id, placed: fi + 1, matrix: op.matrix || (op.move && prev ? prev.matrix : [1, 0, 0, 1, 0, 0]),
              cx: op.cx || null, ratio: op.ratio || 0, name: op.name || null, clipDepth: op.clipDepth || 0,
              filters: op.filters || null, blend: op.blend || null, events: op.clipEvents || null };
            if (prev && op.move && prev.id !== op.id) { e.cx = op.cx || prev.cx; e.name = op.name || prev.name; }
          } else if (prev) {
            e = { ...prev };
            if (op.id !== undefined) e.id = op.id;
            if (op.matrix) e.matrix = op.matrix;
            if (op.cx) e.cx = op.cx;
            if (op.ratio !== undefined) e.ratio = op.ratio;
            if (op.name) e.name = op.name;
            if (op.clipDepth) e.clipDepth = op.clipDepth;
            if (op.filters) e.filters = op.filters;
            if (op.blend) e.blend = op.blend;
          } else continue;
          dl.set(op.depth, e);
        }
        st.push(dl);
      });
      if (!st.length) st.push(new Map());
    }
    return st[Math.max(0, Math.min(st.length - 1, frame - 1))];
  }

  // Path in gradient unit space for a shape path + gradient fill (cached on the path entry)
  gradientPath(entry, fill, key) {
    entry.gcache = entry.gcache || new Map();
    let p = entry.gcache.get(key);
    if (!p) {
      p = new Path2D();
      const inv = invert(fill.m);
      p.addPath(entry.path, new DOMMatrix(inv));
      entry.gcache.set(key, p);
    }
    return p;
  }
}

function lerpLine(l, t) {
  if (!l) return l;
  if (t === 0 || !l.c1) return { ...l, w: l.w };
  return { ...l, w: lerp(l.w, l.w1, t), c: l.c.map((v, i) => lerp(v, l.c1[i], t)) };
}

export { mul };

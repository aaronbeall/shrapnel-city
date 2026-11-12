// AS2-flavoured display list: MovieClip timelines driven by the extracted SWF
// data, with the property names the original ActionScript used (_x, _alpha,
// gotoAndStop, attachMovie, hitTest ...), so the port can stay close to the source.
import { mul, invert, apply, transformRect, unionRect } from './geom.js';
import { Matrix } from './bitmapdata.js';

// init objects (attachMovie/duplicateMovieClip) set properties in order, so
// _x/_rotation/_xscale/_alpha go through the AS2 property setters
function applyInit(k, init) {
  for (const key of Object.keys(init)) k[key] = init[key];
}

const TIMELINE_DEPTH = -16384;
const DEG = Math.PI / 180;

let instanceCounter = 0;

export class DisplayObject {
  constructor(rt, char) {
    this.rt = rt;
    this.char = char;
    this.charId = char ? char.id : -1;
    this._parent = undefined;
    this.__name = '';
    this._depth = 0;
    this.m = [1, 0, 0, 1, 0, 0];
    this.cx = null;
    this.__visible = true;
    this.blendMode = null;
    this.filters = null;
    this.scripted = false;   // transformed by script: timeline no longer drives it
    this.placed = 0;         // timeline placement frame (0 = created by script)
    this.ratio = 0;
    this.clipDepth = 0;
    this.maskedBy = null;     // setMask()
    this.maskOf = null;
    this.cacheAsBitmap = false;
    this._dc = null;
    this.removed = false;
    this.uid = ++instanceCounter;
  }

  // ---- transform -------------------------------------------------------
  _decomp() {
    if (!this._dc) {
      const [a, b, c, d] = this.m;
      let sx = Math.hypot(a, b), sy = Math.hypot(c, d);
      const rot = Math.atan2(b, a);
      let skew = Math.atan2(-c, d) - rot;
      if (a * d - b * c < 0) { sy = -sy; skew = Math.atan2(c, -d) - rot; }
      this._dc = { sx, sy, rot, skew };
    }
    return this._dc;
  }
  _recompose() {
    const { sx, sy, rot, skew } = this._dc;
    const m = this.m;
    m[0] = sx * Math.cos(rot);
    m[1] = sx * Math.sin(rot);
    m[2] = -sy * Math.sin(rot + skew);
    m[3] = sy * Math.cos(rot + skew);
    this.scripted = true;
  }
  setMatrix(m) { this.m = m.slice(); this._dc = null; }

  get _x() { return this.m[4]; }
  set _x(v) { v = +v; if (!isFinite(v)) return; this.m[4] = v; this.scripted = true; }
  get _y() { return this.m[5]; }
  set _y(v) { v = +v; if (!isFinite(v)) return; this.m[5] = v; this.scripted = true; }
  get _xscale() { return this._decomp().sx * 100; }
  set _xscale(v) { v = +v; if (!isFinite(v)) return; this._decomp().sx = v / 100; this._recompose(); }
  get _yscale() { return this._decomp().sy * 100; }
  set _yscale(v) { v = +v; if (!isFinite(v)) return; this._decomp().sy = v / 100; this._recompose(); }
  get _rotation() {
    let r = this._decomp().rot / DEG;
    return r;
  }
  set _rotation(v) {
    v = +v; if (!isFinite(v)) return;
    v = ((v % 360) + 540) % 360 - 180;
    this._decomp().rot = v * DEG; this._recompose();
  }
  get _alpha() { return this.cx ? this.cx[3] * 100 : 100; }
  set _alpha(v) {
    v = +v; if (!isFinite(v)) return;
    if (!this.cx) this.cx = [1, 1, 1, 1, 0, 0, 0, 0]; else this.cx = this.cx.slice();
    this.cx[3] = v / 100; this.scripted = true;
  }
  get _visible() { return this.__visible; }
  set _visible(v) { this.__visible = !!v; }
  get _name() { return this.__name; }
  set _name(v) {
    const p = this._parent;
    if (p && this.__name && p[this.__name] === this) delete p[this.__name];
    this.__name = String(v);
    if (p) p._bindName(this);
  }
  get _width() { const b = this.boundsIn(this._parent ? null : null, true); return b ? b[1] - b[0] : 0; }
  set _width(v) {
    const w = this._width; if (!w) return;
    this._xscale = this._xscale * v / w;
  }
  get _height() { const b = this.boundsIn(null, true); return b ? b[3] - b[2] : 0; }
  set _height(v) {
    const h = this._height; if (!h) return;
    this._yscale = this._yscale * v / h;
  }
  get _xmouse() { return apply(invert(this.worldMatrix()), this.rt.mouseX, this.rt.mouseY)[0]; }
  get _ymouse() { return apply(invert(this.worldMatrix()), this.rt.mouseX, this.rt.mouseY)[1]; }
  get _root() { return this.rt.root; }
  get _target() {
    let s = '', o = this;
    while (o && o._parent) { s = '/' + o._name + s; o = o._parent; }
    return s || '/';
  }

  worldMatrix() {
    let m = this.m;
    for (let p = this._parent; p; p = p._parent) m = mul(p.m, m);
    return m;
  }
  get transform() {
    const self = this;
    return {
      get matrix() { const m = self.m; return new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]); },
      set matrix(v) { self.setMatrix([v.a, v.b, v.c, v.d, v.tx, v.ty]); self.scripted = true; },
      get concatenatedMatrix() { const m = self.worldMatrix(); return new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]); },
    };
  }
  worldMatrixScaled(s) { return mul([s, 0, 0, s, 0, 0], this.worldMatrix()); }
  getDepth() { return this._depth; }

  localToGlobal(pt) {
    const [x, y] = apply(this.worldMatrix(), pt.x, pt.y);
    pt.x = x; pt.y = y;
  }
  globalToLocal(pt) {
    const [x, y] = apply(invert(this.worldMatrix()), pt.x, pt.y);
    pt.x = x; pt.y = y;
  }

  // local content bounds (own coordinate space) [xmin,xmax,ymin,ymax]
  localBounds() { return null; }

  // bounds in the coordinate space of `target` (null = parent space when inParent)
  boundsIn(target, inParent) {
    const lb = this.localBounds();
    if (!lb) return null;
    let m;
    if (inParent) m = this.m;
    else if (!target) m = this.worldMatrix();
    else m = mul(invert(target.worldMatrix()), this.worldMatrix());
    return transformRect(m, lb);
  }

  getBounds(target) {
    const b = this.boundsIn(target || this, false);
    if (!b) return { xMin: 6710886.35, xMax: 6710886.35, yMin: 6710886.35, yMax: 6710886.35 };
    return { xMin: b[0], xMax: b[1], yMin: b[2], yMax: b[3] };
  }
  getRect(target) { return this.getBounds(target); }

  // shape-accurate point test in global coordinates
  hitTestPoint(gx, gy, shapeFlag) {
    if (!shapeFlag) {
      const b = this.boundsIn(null, false);
      return !!b && gx >= b[0] && gx <= b[1] && gy >= b[2] && gy <= b[3];
    }
    return this.rt.renderer.hitTestShape(this, gx, gy);
  }

  hitTest(a, b, c) {
    if (typeof a === 'object' && a) {
      const r1 = this.boundsIn(null, false), r2 = a.boundsIn(null, false);
      return !!(r1 && r2 && r1[0] <= r2[1] && r2[0] <= r1[1] && r1[2] <= r2[3] && r2[2] <= r1[3]);
    }
    return this.hitTestPoint(+a, +b, !!c);
  }

  swapDepths(target) {
    const p = this._parent;
    if (!p) return;
    if (typeof target === 'object' && target) {
      if (target._parent !== p) return;
      const d = target._depth;
      p._setDepth(target, this._depth);
      p._setDepth(this, d);
    } else {
      const d = +target;
      const other = p.byDepth.get(d);
      if (other === this) return;
      const old = this._depth;
      if (other) p._setDepth(other, old);
      p._setDepth(this, d);
    }
    this.placed = 0; // no longer timeline-managed
  }

  removeMovieClip() {
    if (this._parent && this._depth >= 0) this._parent._removeChild(this);
  }

  setMask(mc) {
    if (this.maskedBy) this.maskedBy.maskOf = null;
    this.maskedBy = mc || null;
    if (mc) mc.maskOf = this;
  }

  _removeTree() { this._onRemoved(); }

  _onRemoved() {
    this.removed = true;
    if (this.maskedBy) this.maskedBy.maskOf = null;
    if (this.maskOf) this.maskOf.maskedBy = null;
  }
}

export class Shape extends DisplayObject {
  localBounds() { return this.char.bounds; }
}

export class MorphShape extends DisplayObject {
  localBounds() {
    const a = this.char.bounds, b = this.char.bounds1, t = this.ratio;
    return [0, 1, 2, 3].map((i) => a[i] + (b[i] - a[i]) * t);
  }
}

export class StaticText extends DisplayObject {
  localBounds() { return this.char.bounds; }
}

export class BitmapNode extends DisplayObject {
  constructor(rt, bmd) { super(rt, null); this.bitmapData = bmd; }
  localBounds() { return [0, this.bitmapData.width, 0, this.bitmapData.height]; }
}

// ---- dynamic text -------------------------------------------------------
export class TextField extends DisplayObject {
  constructor(rt, char) {
    super(rt, char);
    this._text = '';
    this.html = !!char.html;
    this._textColor = char.color ? (char.color[0] << 16 | char.color[1] << 8 | char.color[2]) : 0;
    this.align = char.align || 'left';
    this.size = char.size || 12;
    this.font = char.font !== undefined ? rt.lib.get(char.font) : null;
    if (this.font && !this.font.glyphs.length) this.font = rt.fontByName(this.font.name) || this.font;
    this._autoSize = char.autoSize ? 'left' : 'none';
    this.wordWrap = !!char.wordWrap;
    this.multiline = !!char.multiline;
    this.selectable = !char.noSelect;
    this.background = !!char.background;
    this.backgroundColor = 0xffffff;
    this.border = !!char.border;
    this.borderColor = 0;
    this.styleSheet = null;
    this.bounds = char.bounds.slice();
    this.runs = null;
    if (char.text) this.htmlText = char.text;
  }
  localBounds() { return this.bounds; }
  get text() { return this._text; }
  set text(v) {
    this._text = v === undefined || v === null ? '' : String(v);
    this.runs = [{ text: this._text, color: this._textColor, size: this.size, align: this.align, font: this.font }];
    this._fit();
  }
  get htmlText() { return this._text; }
  set htmlText(v) {
    if (!this.html) { this.text = v; return; }
    v = v === undefined || v === null ? '' : String(v);
    this.runs = parseHtmlText(this.rt, v, this);
    this._text = this.runs.map((r) => r.text).join('');
    this._fit();
  }
  get textColor() { return this._textColor; }
  set textColor(c) {
    this._textColor = c | 0;
    if (this.runs) this.runs = this.runs.map((r) => ({ ...r, color: this._textColor }));
  }
  get autoSize() { return this._autoSize; }
  set autoSize(v) {
    this._autoSize = v === true ? 'left' : v === false || !v ? 'none' : String(v);
    this._fit();
  }
  // autoSize: grow/shrink the box around the text, anchored by alignment
  _fit() {
    if (!this.runs || this._autoSize === 'none' || !this.rt.renderer) return;
    const { w, h } = this.rt.renderer.measureText(this, true);
    const b = this.bounds;
    const nw = w + 4, nh = h + 4;
    if (!this.wordWrap) {
      if (this._autoSize === 'center') { const cx = (b[0] + b[1]) / 2; b[0] = cx - nw / 2; b[1] = cx + nw / 2; }
      else if (this._autoSize === 'right') b[0] = b[1] - nw;
      else b[1] = b[0] + nw;
    }
    b[3] = b[2] + nh;
  }
  get textWidth() { return this.rt.renderer.measureText(this).w; }
  get textHeight() { return this.rt.renderer.measureText(this).h; }
  // TextField _width/_height resize the box, they do not scale the text
  get _width() { return (this.bounds[1] - this.bounds[0]) * Math.abs(this._decomp().sx); }
  set _width(v) { v = +v; if (!isFinite(v)) return; this.bounds[1] = this.bounds[0] + v / (Math.abs(this._decomp().sx) || 1); this.$layoutKey = null; }
  get _height() { return (this.bounds[3] - this.bounds[2]) * Math.abs(this._decomp().sy); }
  set _height(v) { v = +v; if (!isFinite(v)) return; this.bounds[3] = this.bounds[2] + v / (Math.abs(this._decomp().sy) || 1); }
}

function parseHtmlText(rt, html, tf) {
  const runs = [];
  const stack = [{ color: tf._textColor, size: tf.size, align: tf.align, font: tf.font }];
  const re = /<\s*(\/?)\s*([a-zA-Z]+)([^>]*)>|([^<]+)/g;
  let m;
  const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  let pCount = 0;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      const top = stack[stack.length - 1];
      runs.push({ ...top, text: ent(m[4]) });
      continue;
    }
    const close = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3];
    const attr = (n) => { const r = new RegExp(n + '\\s*=\\s*"([^"]*)"', 'i').exec(attrs); return r ? r[1] : null; };
    if ((tag === 'strong' || tag === 'b') && !close && tf.styleSheet) {
      stack.push({ ...stack[stack.length - 1], color: 0x009999 });
      continue;
    }
    if (tag === 'br') { runs.push({ ...stack[stack.length - 1], text: '\n' }); continue; }
    if (close) {
      if (tag === 'p') { pCount++; runs.push({ ...stack[stack.length - 1], text: '\n', para: true }); }
      if (stack.length > 1) stack.pop();
      continue;
    }
    const top = { ...stack[stack.length - 1] };
    if (tag === 'p' && attr('align')) top.align = attr('align').toLowerCase();
    if (tag === 'font') {
      const c = attr('color');
      if (c) top.color = parseInt(c.replace('#', ''), 16);
      const s = attr('size');
      if (s) top.size = +s;
      const f = attr('face');
      if (f) top.font = rt.fontByName(f) || top.font;
    }
    stack.push(top);
  }
  // drop the trailing paragraph break
  while (runs.length && runs[runs.length - 1].para) runs.pop();
  return runs;
}

// ---- buttons --------------------------------------------------------------
export class SimpleButton extends DisplayObject {
  constructor(rt, char) {
    super(rt, char);
    this.$state = 1; // up=1 over=2 down=4 hit=8
    this.enabled = true;
    this.useHandCursor = true;
    this.stateChildren = new Map();
  }
  stateKids(state) {
    let kids = this.stateChildren.get(state);
    if (!kids) {
      kids = [];
      for (const r of this.char.records) {
        if (!(r.states & state)) continue;
        const k = this.rt.createInstance(r.id);
        if (!k) continue;
        k.setMatrix(r.matrix);
        k.cx = r.cx && !(r.cx.join() === '1,1,1,1,0,0,0,0') ? r.cx : null;
        k.filters = r.filters || null;
        k.blendMode = r.blend || null;
        k._parent = this;
        k._depth = r.depth;
        if (k instanceof MovieClip) k._initTimeline();
        kids.push(k);
      }
      kids.sort((a, b) => a._depth - b._depth);
      this.stateChildren.set(state, kids);
    }
    return kids;
  }
  get children() { return this.stateKids(this.$state); }
  localBounds() {
    let r = null;
    for (const k of this.stateKids(1)) r = unionRect(r, k.boundsIn(null, true));
    return r;
  }
}

// ---- movie clips ------------------------------------------------------------
export class MovieClip extends DisplayObject {
  constructor(rt, char) {
    super(rt, char);
    this.children = [];
    this.byDepth = new Map();
    this.__currentframe = 1;
    this.playing = true;
    this.graphics = null;
    this.enabled = true;
    this.useHandCursor = true;
  }

  get _currentframe() { return this.__currentframe; }
  get _totalframes() { return this.char && this.char.frames ? Math.max(1, this.char.frames.length) : 1; }
  get _framesloaded() { return this._totalframes; }

  localBounds() {
    let r = null;
    for (const k of this.children) {
      if (k.maskOf) continue;
      r = unionRect(r, k.boundsIn(null, true));
    }
    if (this.graphics) r = unionRect(r, this.graphics.bounds());
    return r;
  }

  _bindName(child) {
    const n = child.__name;
    if (!n) return;
    if (n in MovieClip.prototype || n in DisplayObject.prototype) return;
    this[n] = child;
  }

  _insert(child, depth) {
    child._parent = this;
    child._depth = depth;
    this.byDepth.set(depth, child);
    // keep children sorted by depth
    const ch = this.children;
    let i = ch.length;
    while (i > 0 && ch[i - 1]._depth > depth) i--;
    ch.splice(i, 0, child);
    this._bindName(child);
  }

  _setDepth(child, depth) {
    if (this.byDepth.get(child._depth) === child) this.byDepth.delete(child._depth);
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child._depth = depth;
    this.byDepth.set(depth, child);
    const ch = this.children;
    let j = ch.length;
    while (j > 0 && ch[j - 1]._depth > depth) j--;
    ch.splice(j, 0, child);
  }

  _removeChild(child) {
    const i = this.children.indexOf(child);
    if (i < 0) return;
    this.children.splice(i, 1);
    if (this.byDepth.get(child._depth) === child) this.byDepth.delete(child._depth);
    if (child.__name && this[child.__name] === child) delete this[child.__name];
    child._removeTree();
  }

  _removeTree() {
    if (this.removed) return;
    if (typeof this.onUnload === 'function') { try { this.onUnload(); } catch (e) { console.error(e); } }
    this._onRemoved();
    for (const k of this.children) if (k._removeTree) k._removeTree(); else k._onRemoved();
    this.rt._forgetClip(this);
  }

  // ---- timeline ----
  play() { this.playing = true; }
  stop() { this.playing = false; }
  _frameNum(f) {
    if (typeof f === 'string') {
      const lab = this.char && this.char.labels && this.char.labels[f];
      if (lab === undefined) {
        const n = parseInt(f, 10);
        return isNaN(n) ? null : n;
      }
      return lab + 1; // swf labels are 0-based frame indices
    }
    const n = Math.floor(+f);
    return isFinite(n) ? n : null;
  }
  gotoAndStop(f) { const n = this._frameNum(f); this.playing = false; if (n !== null) this._goto(n); }
  gotoAndPlay(f) { const n = this._frameNum(f); this.playing = true; if (n !== null) this._goto(n); }
  nextFrame() { this.playing = false; if (this.__currentframe < this._totalframes) this._goto(this.__currentframe + 1); }
  prevFrame() { this.playing = false; if (this.__currentframe > 1) this._goto(this.__currentframe - 1); }

  _goto(n) {
    const total = this._totalframes;
    if (n < 1) n = 1;
    if (n > total) n = total;
    if (n === this.__currentframe) return;
    const prev = this.__currentframe;
    this.__currentframe = n;
    this.rt.queueFrameScript(this, n);
    this._sync(n, prev);
  }

  _advance() {
    if (!this.playing) return;
    const total = this._totalframes;
    if (total <= 1) return;
    const prev = this.__currentframe;
    let n = prev + 1;
    if (n > total) n = 1;
    this.__currentframe = n;
    this.rt.queueFrameScript(this, n);
    this._sync(n, prev);
  }

  // build frame 1 when the clip is first created
  _initTimeline() {
    if (!this.char || !this.char.frames) return;
    this.rt._trackClip(this);
    this._sync(1, 0);
  }

  _sync(frame, prev = 0) {
    const forward = frame > prev;
    const def = this.char;
    if (!def || !def.frames) return;
    const st = this.rt.lib.spriteState(def, frame);
    // remove timeline children that are not part of the target frame
    for (let i = this.children.length - 1; i >= 0; i--) {
      const k = this.children[i];
      if (!k.placed) continue;
      const e = st.get(k._depth - TIMELINE_DEPTH);
      if (!e || e.id !== k.charId || e.placed !== k.placed) this._removeChild(k);
    }
    for (const [d, e] of st) {
      const depth = d + TIMELINE_DEPTH;
      let k = this.byDepth.get(depth);
      if (k && k.placed) {
        if (!k.scripted) {
          if (k.m !== e.matrix) k.setMatrix(e.matrix);
          k.cx = e.cx;
        }
        k.ratio = e.ratio || 0;
        if (e.filters) k.filters = e.filters;
        if (e.blend) k.blendMode = e.blend;
        continue;
      }
      if (k) continue; // occupied by a script clip
      // moving forward, Flash only places objects whose PlaceObject tag is in
      // the frames being entered; anything removed by script stays removed
      if (forward && e.placed <= prev) continue;
      k = this.rt.createInstance(e.id);
      if (!k) continue;
      k.placed = e.placed;
      k.setMatrix(e.matrix);
      k.cx = e.cx;
      k.ratio = e.ratio || 0;
      k.clipDepth = e.clipDepth ? e.clipDepth + TIMELINE_DEPTH : 0;
      k.filters = e.filters;
      k.blendMode = e.blend;
      k.__name = e.name || (k instanceof MovieClip || k instanceof SimpleButton || k instanceof TextField ? 'instance' + k.uid : '');
      this._insert(k, depth);
      const key = this.charId + ':' + d + ':' + e.placed;
      if (k instanceof MovieClip) {
        this.rt.queueInit(k, key);
        k._initTimeline();
      } else if (k instanceof SimpleButton) {
        this.rt.attachHandlers(k, key);
      }
    }
  }

  // ---- script-created children ----
  attachMovie(id, name, depth, init) {
    const cid = this.rt.lib.idFor(id);
    if (cid === undefined) { console.warn('attachMovie: unknown linkage', id); return undefined; }
    return this._attach(cid, name, depth, init);
  }
  _attach(cid, name, depth, init, instKey = null) {
    depth = Math.floor(+depth) || 0;
    const old = this.byDepth.get(depth);
    if (old) this._removeChild(old);
    const k = this.rt.createInstance(cid);
    if (!k) return undefined;
    k.__name = String(name);
    this._insert(k, depth);
    if (init) applyInit(k, init);
    if (k instanceof MovieClip) {
      this.rt.queueInit(k, instKey);
      k._initTimeline();
    }
    return k;
  }
  duplicateMovieClip(name, depth, init) {
    const p = this._parent;
    if (!p) return undefined;
    const k = p._attach(this.charId, name, depth, null, this.$instKey || null);
    if (!k) return k;
    // the copy starts with the original's transform, then the init object applies
    k.setMatrix(this.m);
    k.cx = this.cx ? this.cx.slice() : null;
    k.filters = this.filters;
    k.blendMode = this.blendMode;
    k.scripted = true;
    if (init) applyInit(k, init);
    return k;
  }
  createEmptyMovieClip(name, depth) {
    depth = Math.floor(+depth) || 0;
    const old = this.byDepth.get(depth);
    if (old) this._removeChild(old);
    const k = new MovieClip(this.rt, null);
    k.__name = String(name);
    this._insert(k, depth);
    this.rt._trackClip(k);
    return k;
  }
  getNextHighestDepth() {
    let d = 0;
    for (const k of this.children) if (k._depth >= d) d = k._depth + 1;
    return d;
  }
  getInstanceAtDepth(d) { return this.byDepth.get(d); }
  attachBitmap(bmd, depth) {
    const old = this.byDepth.get(depth);
    if (old) this._removeChild(old);
    const k = new BitmapNode(this.rt, bmd);
    this._insert(k, depth);
    return k;
  }

  getBytesLoaded() { return 1; }
  getBytesTotal() { return 1; }
  get _quality() { return this.rt.quality; }
  set _quality(v) { this.rt.setQuality(v); }
  get scrollRect() { return this._scrollRect; }
  set scrollRect(v) { this._scrollRect = v; }

  // ---- drawing API ----
  _g() { return this.graphics || (this.graphics = new Graphics()); }
  clear() { if (this.graphics) this.graphics.clear(); }
  lineStyle(w, color, alpha) { this._g().lineStyle(w, color, alpha); }
  beginFill(color, alpha) { this._g().beginFill(color, alpha); }
  endFill() { this._g().endFill(); }
  moveTo(x, y) { this._g().moveTo(x, y); }
  lineTo(x, y) { this._g().lineTo(x, y); }
  curveTo(cx, cy, x, y) { this._g().curveTo(cx, cy, x, y); }
}

export class Graphics {
  constructor() { this.clear(); }
  clear() { this.ops = []; this.cur = null; this.line = null; this.fill = null; this.x = 0; this.y = 0; this._b = null; }
  _seg() {
    if (!this.cur) {
      this.cur = { path: new Path2D(), line: this.line, fill: this.fill };
      this.cur.path.moveTo(this.x, this.y);
      this.ops.push(this.cur);
    }
    return this.cur;
  }
  lineStyle(w, color, alpha) {
    this.cur = null;
    this.line = w === undefined || w === null ? null : { w: +w, color: color | 0, alpha: alpha === undefined ? 100 : +alpha };
  }
  beginFill(color, alpha) {
    this.cur = null;
    this.fill = { color: color | 0, alpha: alpha === undefined ? 100 : +alpha };
  }
  endFill() { if (this.cur && this.cur.fill) this.cur.path.closePath(); this.cur = null; this.fill = null; }
  moveTo(x, y) { this._ext(x, y); this.x = x; this.y = y; if (this.cur) this.cur.path.moveTo(x, y); }
  lineTo(x, y) { this._ext(this.x, this.y); this._ext(x, y); this._seg().path.lineTo(x, y); this.x = x; this.y = y; }
  curveTo(cx, cy, x, y) { this._ext(cx, cy); this._ext(x, y); this._seg().path.quadraticCurveTo(cx, cy, x, y); this.x = x; this.y = y; }
  _ext(x, y) {
    const b = this._b;
    if (!b) this._b = [x, x, y, y];
    else { if (x < b[0]) b[0] = x; if (x > b[1]) b[1] = x; if (y < b[2]) b[2] = y; if (y > b[3]) b[3] = y; }
  }
  bounds() { return this._b; }
}

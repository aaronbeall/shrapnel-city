// Canvas 2D renderer for the display list.  Reproduces the Flash 8 features the
// game relies on: color transforms, blend modes (add/screen/overlay/...),
// glow/blur/drop-shadow filters, timeline masks, gradients and bitmap fills.
import { mul, invert, apply, transformRect, mulCx, cxColor, cxAlpha } from './geom.js';
import { MovieClip, Shape, MorphShape, StaticText, TextField, BitmapNode, SimpleButton } from './display.js';

const BLEND = {
  add: 'lighter', screen: 'screen', multiply: 'multiply', lighten: 'lighten', darken: 'darken',
  difference: 'difference', overlay: 'overlay', hardlight: 'hard-light', invert: 'difference',
  subtract: 'difference', alpha: 'destination-in', erase: 'destination-out',
};

// blend modes that are separable per pixel: for content that is a single
// path, drawing it straight onto the target with this mode gives the same
// pixels as Flash's render-to-layer-then-blend
const DIRECT_BLEND = new Set(['add', 'screen', 'multiply', 'lighten', 'darken', 'difference', 'overlay', 'hardlight']);

const FILL_RULE = 'evenodd';

export class Renderer {
  constructor(rt, canvas, scale = 1) {
    this.rt = rt;
    this.lib = rt.lib;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pool = [];
    this.baseMatrix = [scale, 0, 0, scale, 0, 0];
    this.hctx = document.createElement('canvas').getContext('2d');
    this.tintCache = new Map();
    this.quality = 'high';
    this.setScale(scale);
  }

  setScale(scale) {
    this.scale = scale;
    const w = Math.round(this.rt.width * scale), h = Math.round(this.rt.height * scale);
    this.canvas.width = w;
    this.canvas.height = h;
    this.W = w; this.H = h;
    this.pool = [];
  }

  // scratch canvases of at least w x h, origin at 0,0
  acquire(w, h) {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const c = this.pool[i];
      if (c.width >= w && c.height >= h) { this.pool.splice(i, 1); return c; }
    }
    const c = document.createElement('canvas');
    c.width = Math.max(64, Math.ceil(w / 64) * 64);
    c.height = Math.max(64, Math.ceil(h / 64) * 64);
    c.ctx = c.getContext('2d');
    return c;
  }
  release(c) { if (c && this.pool.length < 24) this.pool.push(c); }

  // ---------------------------------------------------------------------
  render(root, bg) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.W, this.H);
    const s = this.scale;
    this.baseMatrix = [s, 0, 0, s, 0, 0];
    this.drawNode(ctx, root, this.baseMatrix, null, [0, this.W, 0, this.H]);
  }

  // render a subtree into an arbitrary 2d context (BitmapData.draw)
  renderTo(ctx, node, matrix, cx, w, h) {
    const prev = this.baseMatrix;
    this.baseMatrix = mul(matrix, invert(node.worldMatrix()));
    this.drawContent(ctx, node, matrix, cx || null, [0, w, 0, h]);
    this.baseMatrix = prev;
  }

  drawNode(ctx, node, pm, pcx, clip) {
    if (!node.__visible || node.maskOf) return;
    const m = mul(pm, node.m);
    const cx = node.cx ? mulCx(pcx, node.cx) : pcx;
    if (cx && cx[3] <= 0 && cx[7] <= 0) return;
    const blend = node.blendMode;
    const fx = node.filters && node.filters.length && this.quality !== 'low' ? node.filters : null;
    if (blend && DIRECT_BLEND.has(blend) && !fx && !node.maskedBy && this.directBlend !== false && this.singlePath(node)) {
      // one visible path: blend it straight in, no offscreen layer
      if (this.stats) { const k = this.stats.kinds['direct-' + blend] || (this.stats.kinds['direct-' + blend] = { n: 0, miss: 0, missPx: 0, drawPx: 0, ms: 0 }); k.n++; }
      ctx.save();
      ctx.globalCompositeOperation = BLEND[blend];
      this.drawContent(ctx, node, m, cx, clip);
      ctx.restore();
    } else if ((blend && blend !== 'normal' && blend !== 'layer') || fx || node.maskedBy) {
      this.drawLayered(ctx, node, m, cx, blend, fx, clip);
    } else if (node.cacheAsBitmap && this.cacheAsBitmap && !(node.$cabOff > 0 && node.$cabOff--)) {
      // Flash's bitmap caching: rasterise once, reuse while only the position
      // changes (the layer cache is keyed on content, colour and rotation/scale).
      // Clips too big to cache, or that keep changing, are drawn directly for a while.
      const prev = node.$cache && node.$cache.key;
      this.drawLayered(ctx, node, m, cx, null, null, clip);
      const c = node.$cache;
      if (!c) node.$cabOff = this.cabAdaptive ? 60 : 0;
      else if (c.key !== prev) { if ((node.$cabMiss = (node.$cabMiss | 0) + 1) >= 3 && this.cabAdaptive) { node.$cabOff = 30; node.$cabMiss = 0; } }
      else node.$cabMiss = 0;
    } else {
      this.drawContent(ctx, node, m, cx, clip);
    }
  }

  // true when a subtree draws exactly one visible path (fill, or stroke with
  // some alpha) and nothing in it needs its own layer
  singlePath(node) {
    let count = 0, visited = 0;
    const walk = (n) => {
      if (!n.__visible || n.maskOf) return true;
      if (++visited > 16) return false;
      if (n instanceof MovieClip) {
        if (n.graphics && n.graphics.cmds && n.graphics.cmds.length) return false;
        for (const c of n.children) {
          if (!c.__visible || c.maskOf) continue;
          if ((c.blendMode && c.blendMode !== 'normal' && c.blendMode !== 'layer') || (c.filters && c.filters.length) || c.maskedBy || c.clipDepth) return false;
          if (!walk(c)) return false;
        }
        return true;
      }
      let paths;
      if (n instanceof Shape) paths = n.char.paths.map((p) => (p.f !== undefined ? 1 : visibleLine(n.char.lines[p.l])));
      else if (n instanceof MorphShape) paths = this.lib.morphAt(n.char, n.ratio).paths.map((p) => (p.f !== undefined ? 1 : visibleLine(p.style)));
      else return false; // text and bitmaps: keep the layer
      for (const v of paths) count += v;
      return count <= 1;
    };
    return walk(node) && count === 1;
  }

  drawContent(ctx, node, m, cx, clip) {
    if (node instanceof MovieClip) {
      if (node.graphics) this.drawGraphics(ctx, node.graphics, m, cx);
      this.drawChildren(ctx, node.children, m, cx, clip);
    } else if (node instanceof Shape) {
      this.drawShape(ctx, node.char.fills, node.char.lines, node.char.paths, m, cx);
    } else if (node instanceof MorphShape) {
      const g = this.lib.morphAt(node.char, node.ratio);
      this.drawMorph(ctx, g, m, cx);
    } else if (node instanceof StaticText) {
      this.drawStaticText(ctx, node.char, m, cx);
    } else if (node instanceof TextField) {
      this.drawTextField(ctx, node, m, cx);
    } else if (node instanceof BitmapNode) {
      const bmd = node.bitmapData;
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.globalAlpha = cxAlpha(cx);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bmd.canvas, 0, 0);
      ctx.globalAlpha = 1;
    } else if (node instanceof SimpleButton) {
      this.drawChildren(ctx, node.children, m, cx, clip);
    }
  }

  drawChildren(ctx, kids, m, cx, clip) {
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.clipDepth) {
        // timeline mask: clips every following sibling up to clipDepth
        let j = i + 1;
        while (j < kids.length && kids[j]._depth <= k.clipDepth) j++;
        const path = new Path2D();
        this.collectPaths(k, mul(m, k.m), path);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clip(path, 'nonzero');
        for (let q = i + 1; q < j; q++) this.drawNode(ctx, kids[q], m, cx, clip);
        ctx.restore();
        i = j - 1;
        continue;
      }
      this.drawNode(ctx, k, m, cx, clip);
    }
  }

  // gather fill geometry of a subtree in device space (for masks)
  collectPaths(node, m, out) {
    const dm = new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]);
    if (node instanceof Shape) {
      for (const p of node.char.paths) if (p.f !== undefined) out.addPath(p.path, dm);
    } else if (node instanceof MorphShape) {
      for (const p of this.lib.morphAt(node.char, node.ratio).paths) if (p.f !== undefined) out.addPath(p.path, dm);
    } else if (node instanceof MovieClip) {
      if (node.graphics) for (const op of node.graphics.ops) if (op.fill) out.addPath(op.path, dm);
      for (const k of node.children) if (k.__visible || true) this.collectPaths(k, mul(m, k.m), out);
    } else if (node instanceof StaticText) {
      const t = node.char;
      const tm = mul(m, t.matrix);
      const dm2 = new DOMMatrix([tm[0], tm[1], tm[2], tm[3], tm[4], tm[5]]);
      for (const r of t.records) out.addPath(this.textRecordPath(r), dm2);
    } else if (node instanceof BitmapNode) {
      const p = new Path2D();
      p.rect(0, 0, node.bitmapData.width, node.bitmapData.height);
      out.addPath(p, dm);
    }
  }

  // ---------------------------------------------------------------------
  // Nodes with filters, a blend mode or a script mask are rendered into their
  // own small offscreen canvas (in device space, sized to the node's padded
  // bounds) and composited.  The raster is cached on the node and reused while
  // its content, color transform and rotation/scale are unchanged, so static
  // glows and lights cost one drawImage per frame.
  drawLayered(ctx, node, m, cx, blend, fx, clip) {
    const lb = node.localBounds();
    if (!lb) return;
    let pad = 2;
    if (fx) for (const f of fx) pad += this.filterPad(f);
    const L = [m[0], m[1], m[2], m[3], 0, 0];
    const rb = transformRect(L, lb); // bounds relative to the node origin
    let rx0 = Math.floor(rb[0] - pad), ry0 = Math.floor(rb[2] - pad);
    let rx1 = Math.ceil(rb[1] + pad), ry1 = Math.ceil(rb[3] + pad);
    // on-screen test
    if (m[4] + rx1 < clip[0] || m[4] + rx0 > clip[1] || m[5] + ry1 < clip[2] || m[5] + ry0 > clip[3]) return;
    let w = rx1 - rx0, h = ry1 - ry0;
    const huge = w * h > this.W * this.H * 1.2;
    const cacheable = !node.maskedBy && !huge && this.cacheLayers !== false;
    if (huge) {
      // very large nodes: only rasterise the visible part (plus filter padding)
      const vx0 = Math.max(rx0, Math.floor(clip[0] - m[4] - pad)), vx1 = Math.min(rx1, Math.ceil(clip[1] - m[4] + pad));
      const vy0 = Math.max(ry0, Math.floor(clip[2] - m[5] - pad)), vy1 = Math.min(ry1, Math.ceil(clip[3] - m[5] + pad));
      rx0 = vx0; ry0 = vy0; w = vx1 - vx0; h = vy1 - vy0;
      if (w <= 0 || h <= 0) return;
    }
    let raster = null;
    let key = null;
    const st = this.stats;
    const t0 = st ? performance.now() : 0;
    if (cacheable) {
      key = this.contentHash(node, 0x811c9dc5) + ':' + (cx ? cx.map((v) => Math.round(v * 1000)).join(',') : '') + ':' +
        L.slice(0, 4).map((v) => Math.round(v * 1000)).join(',') + ':' + (fx ? fx.map(filterKey).join(';') : '') + ':' + this.quality;
      const c = node.$cache;
      if (c && c.key === key) raster = c;
    }
    if (st) {
      const kind = ((blend && blend !== 'normal' ? blend : '') + (fx ? '+' + fx.map((f) => f.type).join('+') : '') + (node.maskedBy ? '+mask' : '')) || 'cacheAsBitmap';
      const k = st.kinds[kind] || (st.kinds[kind] = { n: 0, miss: 0, missPx: 0, drawPx: 0, ms: 0 });
      k.n++; k.drawPx += w * h;
      if (!raster) { k.miss++; k.missPx += w * h; }
      st.cur = k;
    }
    // A layer whose only filter is a blur loses all detail finer than the blur,
    // so it is rendered and blurred at reduced resolution (ds) and scaled back
    // up when composited: same picture, up to 16x fewer pixels.
    let ds = 1;
    if (fx && fx.length === 1 && fx[0].type === 'blur' && blend !== 'invert' && !node.maskedBy && this.downsampleBlur !== false) {
      const f = fx[0], b = Math.min(f.blurX || 0, f.blurY || 0) * this.scale, n = f.passes || f.quality || 1;
      const sigma = Math.sqrt(n * Math.max(0, b * b - 1) / 12);
      ds = Math.max(1, Math.min(4, Math.floor(sigma / 3)));
    }
    const lw = ds > 1 ? Math.ceil(w / ds) : w, lh = ds > 1 ? Math.ceil(h / ds) : h;
    if (raster && raster.ds !== ds) raster = null;
    if (!raster) {
      const prevScale = this.scale;
      this.scale = prevScale / ds; // line widths and filter radii follow the layer's resolution
      const layer = this.acquire(lw, lh);
      const lc = layer.ctx;
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.clearRect(0, 0, lw, lh);
      lc.save();
      lc.beginPath(); lc.rect(0, 0, lw, lh); lc.clip();
      const lm = [m[0] / ds, m[1] / ds, m[2] / ds, m[3] / ds, -rx0 / ds, -ry0 / ds];
      this.drawContent(lc, node, lm, cx, [0, lw, 0, lh]);
      lc.restore();
      if (node.maskedBy && !node.maskedBy.removed) {
        const path = new Path2D();
        const mk = node.maskedBy;
        const mw = mul([1, 0, 0, 1, -(m[4] + rx0), -(m[5] + ry0)], mul(this.baseMatrix, mk.worldMatrix()));
        this.collectPaths(mk, mw, path);
        lc.save();
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.globalCompositeOperation = 'destination-in';
        lc.fillStyle = '#000';
        lc.fill(path);
        lc.restore();
      }
      let src = layer;
      if (fx) {
        for (const f of fx) {
          const out = this.applyFilter(src, f, lw, lh);
          if (out !== src) { this.release(src); src = out; }
        }
      }
      this.scale = prevScale;
      if (cacheable) {
        let c = node.$cache;
        if (!c || c.canvas.width < lw || c.canvas.height < lh || c.canvas.width > lw * 2 + 64 || c.canvas.height > lh * 2 + 64) {
          const cv = document.createElement('canvas');
          cv.width = lw; cv.height = lh;
          c = { canvas: cv, ctx: cv.getContext('2d') };
        }
        c.ctx.setTransform(1, 0, 0, 1, 0, 0);
        c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
        c.ctx.drawImage(src, 0, 0, lw, lh, 0, 0, lw, lh);
        c.key = key; c.w = lw; c.h = lh; c.ds = ds;
        node.$cache = c;
        this.release(src);
        raster = c;
      } else {
        raster = { canvas: src, w: lw, h: lh, ds, temp: true };
      }
    }
    const dx = m[4] + rx0, dy = m[5] + ry0;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (blend === 'invert') {
      // invert the destination wherever the clip has coverage
      const inv = this.acquire(w, h);
      const ic = inv.ctx;
      ic.setTransform(1, 0, 0, 1, 0, 0);
      ic.clearRect(0, 0, w, h);
      ic.drawImage(raster.canvas, 0, 0, w, h, 0, 0, w, h);
      ic.globalCompositeOperation = 'source-in';
      ic.fillStyle = '#fff';
      ic.fillRect(0, 0, w, h);
      ic.globalCompositeOperation = 'source-over';
      ctx.globalCompositeOperation = 'difference';
      ctx.drawImage(inv, 0, 0, w, h, dx, dy, w, h);
      this.release(inv);
    } else {
      ctx.globalCompositeOperation = (blend && BLEND[blend]) || 'source-over';
      ctx.drawImage(raster.canvas, 0, 0, lw, lh, dx, dy, lw * ds, lh * ds);
    }
    ctx.restore();
    if (raster.temp) this.release(raster.canvas);
    if (st) st.cur.ms += performance.now() - t0; // includes nested layers
  }

  // hash of everything that affects how a subtree renders (except the root's
  // own transform), used to validate cached layer rasters
  contentHash(n, h, top = true) {
    h = mix(h, n.uid);
    if (!top) {
      h = mix(h, n.__visible ? 1 : 2);
      const m = n.m;
      for (let i = 0; i < 6; i++) h = mixf(h, m[i]);
      if (n.cx) for (let i = 0; i < 8; i++) h = mixf(h, n.cx[i]);
      if (n.blendMode) h = mix(h, n.blendMode.length);
      if (n.filters) for (const f of n.filters) h = mix(h, hashStr(filterKey(f)));
    }
    if (n.ratio) h = mixf(h, n.ratio);
    if (n instanceof MovieClip) {
      h = mix(h, n.__currentframe);
      if (n.graphics) h = mix(h, n.graphics.ops.length * 7 + (n.graphics.version || 0));
      if (n.maskedBy) h = mix(h, n.maskedBy.uid);
      const kids = n.children;
      h = mix(h, kids.length);
      for (let i = 0; i < kids.length; i++) h = this.contentHash(kids[i], h, false);
    } else if (n instanceof SimpleButton) {
      h = mix(h, n.$state);
      for (const k of n.children) h = this.contentHash(k, h, false);
    } else if (n instanceof TextField) {
      h = mix(h, hashStr(n._text));
      h = mix(h, n._textColor);
      h = mixf(h, n.bounds[1] - n.bounds[0]);
    } else if (n instanceof BitmapNode) {
      h = mix(h, n.bitmapData.version || 0);
    }
    return h >>> 0;
  }

  filterPad(f) {
    const s = this.scale;
    if (f.type === 'blur' || f.type === 'glow' || f.type === 'dropShadow' || f.type === 'bevel') {
      const d = f.type === 'dropShadow' || f.type === 'bevel' ? (f.distance || 0) : 0;
      return (Math.max(f.blurX || 0, f.blurY || 0) * (f.passes || f.quality || 1) + Math.abs(d)) * s;
    }
    return 0;
  }

  // filters come either from the SWF (color as [r,g,b,a], passes) or from
  // script-created flash.filters objects (color int + alpha, quality)
  filterColor(f) {
    if (Array.isArray(f.color)) return f.color;
    const c = f.color | 0;
    const a = f.alpha === undefined ? 1 : f.alpha;
    return [c >> 16 & 255, c >> 8 & 255, c & 255, Math.max(0, Math.min(1, a)) * 255];
  }

  sigma(f) {
    // Flash box blur of width w repeated n passes ~ gaussian sigma
    const wdt = (Math.max(f.blurX || 0, f.blurY || 0));
    const n = f.passes || f.quality || 1;
    return Math.sqrt(n * Math.max(0, wdt * wdt - 1) / 12) * this.scale;
  }

  applyFilter(src, f, w, h) {
    const x0 = 0, y0 = 0;
    if (f.type === 'blur') {
      const sg = this.sigma(f);
      if (sg < 0.3) return src;
      const out = this.acquire(w, h);
      const oc = out.ctx;
      oc.setTransform(1, 0, 0, 1, 0, 0);
      oc.clearRect(x0, y0, w, h);
      // clip to the layer: a canvas filter otherwise processes the whole
      // (pooled, often much larger) canvas
      oc.save();
      oc.beginPath(); oc.rect(0, 0, w, h); oc.clip();
      oc.filter = `blur(${sg.toFixed(2)}px)`;
      oc.drawImage(src, x0, y0, w, h, x0, y0, w, h);
      oc.restore();
      return out;
    }
    if (f.type === 'glow' || f.type === 'dropShadow') {
      if (f.inner) return src; // rare; keep the content itself
      const sg = this.sigma(f);
      const c = this.filterColor(f);
      if (c[3] <= 0) return src;
      const out = this.acquire(w, h);
      const oc = out.ctx;
      oc.setTransform(1, 0, 0, 1, 0, 0);
      oc.clearRect(x0, y0, w, h);
      // colored silhouette, blurred, then content on top
      let dx = 0, dy = 0;
      if (f.type === 'dropShadow') {
        dx = Math.cos(f.angle || 0) * (f.distance || 0) * this.scale;
        dy = Math.sin(f.angle || 0) * (f.distance || 0) * this.scale;
      }
      const sil = this.acquire(w, h);
      const sc = sil.ctx;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(x0, y0, w, h);
      sc.drawImage(src, x0, y0, w, h, x0, y0, w, h);
      sc.globalCompositeOperation = 'source-atop'; // source-in would clear the whole pooled canvas
      sc.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
      sc.fillRect(x0, y0, w, h);
      sc.globalCompositeOperation = 'source-over';
      oc.save();
      oc.beginPath(); oc.rect(0, 0, w, h); oc.clip(); // see blur above
      oc.filter = sg >= 0.3 ? `blur(${sg.toFixed(2)}px)` : 'none';
      const strength = Math.max(0, f.strength === undefined ? 1 : f.strength);
      let s = strength;
      while (s > 0) {
        oc.globalAlpha = Math.min(1, s);
        oc.drawImage(sil, x0, y0, w, h, x0 + dx, y0 + dy, w, h);
        s -= 1;
      }
      oc.restore();
      this.release(sil);
      if (f.knockout) {
        oc.globalCompositeOperation = 'destination-out';
        oc.drawImage(src, x0, y0, w, h, x0, y0, w, h);
        oc.globalCompositeOperation = 'source-over';
      } else {
        oc.drawImage(src, x0, y0, w, h, x0, y0, w, h);
      }
      return out;
    }
    if (f.type === 'bevel') return this.bevel(src, f, w, h);
    return src; // gradient glow/bevel etc: content unchanged
  }

  // Inner bevel: the highlight lands on edges facing away from the light angle
  // (where the content shifted by +distance does not cover it), the shadow on the
  // opposite edges; both stay inside the content's own alpha.
  bevel(src, f, w, h) {
    const dist = (f.distance || 0) * this.scale;
    const ox = Math.cos(f.angle || 0) * dist, oy = Math.sin(f.angle || 0) * dist;
    const strength = Math.max(0, f.strength === undefined ? 1 : f.strength);
    const bx = (f.blurX || 0) * this.scale, by = (f.blurY || 0) * this.scale;
    if (!strength || (!ox && !oy && bx < 2 && by < 2)) return src;
    const out = this.acquire(w, h);
    const oc = out.ctx;
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.clearRect(0, 0, w, h);
    oc.drawImage(src, 0, 0, w, h, 0, 0, w, h);
    // the cutter is the content's alpha, softened with Flash's box blur; done in JS
    // because canvas `filter` costs milliseconds even on tiny layers
    const cut = this.boxBlurAlpha(src, w, h, bx, by, f.passes || f.quality || 1);
    const edge = this.acquire(w, h);
    const ec = edge.ctx;
    ec.setTransform(1, 0, 0, 1, 0, 0);
    for (const [c, sx, sy] of [[f.highlight, ox, oy], [f.shadow, -ox, -oy]]) {
      if (!c || c[3] <= 0) continue;
      ec.globalCompositeOperation = 'source-over';
      ec.clearRect(0, 0, w, h);
      ec.drawImage(src, 0, 0, w, h, 0, 0, w, h);
      ec.globalCompositeOperation = 'source-atop'; // source-in would clear the whole pooled canvas
      ec.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
      ec.fillRect(0, 0, w, h);
      ec.globalCompositeOperation = 'destination-out';
      ec.drawImage(cut, 0, 0, w, h, sx, sy, w, h);
      ec.globalCompositeOperation = 'source-over';
      oc.globalCompositeOperation = 'source-atop';
      for (let s = strength; s > 0; s -= 1) {
        oc.globalAlpha = Math.min(1, s);
        oc.drawImage(edge, 0, 0, w, h, 0, 0, w, h);
      }
      oc.globalAlpha = 1;
      oc.globalCompositeOperation = 'source-over';
    }
    this.release(edge);
    if (cut !== src) this.release(cut);
    return out;
  }

  // Flash-style box blur (width bx/by device px, repeated `passes` times) of the
  // alpha channel only. Returns `src` untouched when the blur is below a pixel.
  boxBlurAlpha(src, w, h, bx, by, passes) {
    const rx = Math.max(0, Math.round((bx - 1) / 2)), ry = Math.max(0, Math.round((by - 1) / 2));
    if (!rx && !ry) return src;
    const c = this.acquire(w, h);
    const x = c.ctx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, w, h);
    x.drawImage(src, 0, 0, w, h, 0, 0, w, h);
    const img = x.getImageData(0, 0, w, h), d = img.data;
    let a = new Float32Array(w * h), t = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3];
    const pass = (from, to, r, horiz) => {
      const n = horiz ? w : h, m = horiz ? h : w, step = horiz ? 1 : w, lineStep = horiz ? w : 1, k = 1 / (2 * r + 1);
      for (let l = 0; l < m; l++) {
        const base = l * lineStep;
        let sum = 0;
        for (let i = -r; i <= r; i++) if (i >= 0 && i < n) sum += from[base + i * step];
        for (let i = 0; i < n; i++) {
          to[base + i * step] = sum * k;
          const add = i + r + 1, sub = i - r;
          if (add < n) sum += from[base + add * step];
          if (sub >= 0) sum -= from[base + sub * step];
        }
      }
    };
    for (let p = 0; p < passes; p++) {
      if (rx) { pass(a, t, rx, true); [a, t] = [t, a]; }
      if (ry) { pass(a, t, ry, false); [a, t] = [t, a]; }
    }
    for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0; d[i * 4 + 3] = a[i]; }
    x.putImageData(img, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------------
  lineWidth(w, m) {
    const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    return Math.max(w, 1 / sc);
  }

  drawShape(ctx, fills, lines, paths, m, cx) {
    for (const p of paths) {
      if (p.f !== undefined) this.fillPath(ctx, p, fills[p.f], m, cx, p.path);
      else this.strokePath(ctx, lines[p.l], m, cx, p.path);
    }
  }

  drawMorph(ctx, g, m, cx) {
    for (const p of g.paths) {
      if (p.f !== undefined) this.fillPath(ctx, p, p.style, m, cx, p.path, true);
      else this.strokePath(ctx, p.style, m, cx, p.path);
    }
  }

  strokePath(ctx, l, m, cx, path) {
    if (!l || !l.c) return;
    if (l.c[3] === 0 && !(cx && cx[7] > 0)) return; // fully transparent outline
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.lineWidth = this.lineWidth(l.w, m);
    ctx.lineCap = l.cap === 1 ? 'butt' : l.cap === 2 ? 'square' : 'round';
    ctx.lineJoin = l.join === 1 ? 'bevel' : l.join === 2 ? 'miter' : 'round';
    if (l.join === 2) ctx.miterLimit = l.miter || 3;
    ctx.strokeStyle = cxColor(l.c, cx);
    ctx.stroke(path);
  }

  fillPath(ctx, entry, fill, m, cx, path, dynamic) {
    if (!fill) return;
    const t = fill.t;
    if (t === 0) {
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.fillStyle = cxColor(fill.c, cx);
      ctx.fill(path, FILL_RULE);
    } else if (t === 0x10 || t === 0x12 || t === 0x13) {
      const gm = fill.m;
      if (!(gm[0] * gm[3] - gm[1] * gm[2])) return;
      // a fade (alpha-only colour transform) is applied as globalAlpha so the
      // gradient object can be built once per fill and reused
      const fade = cx && cx[0] === 1 && cx[1] === 1 && cx[2] === 1 && !cx[4] && !cx[5] && !cx[6] && !cx[7] && cx[3] >= 0 && cx[3] <= 1;
      let g;
      if (!cx || fade) g = fill.$grad || (fill.$grad = this.gradient(ctx, fill, null));
      else g = this.gradient(ctx, fill, cx);
      const mm = mul(m, gm);
      let gp;
      if (dynamic) {
        gp = new Path2D();
        gp.addPath(path, new DOMMatrix(invert(gm)));
      } else gp = this.lib.gradientPath(entry, fill, 0);
      ctx.setTransform(mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]);
      ctx.fillStyle = g;
      if (fade) {
        const ga = ctx.globalAlpha;
        ctx.globalAlpha = ga * cx[3];
        ctx.fill(gp, FILL_RULE);
        ctx.globalAlpha = ga;
      } else ctx.fill(gp, FILL_RULE);
    } else {
      const img = this.bitmapFor(fill.bitmap, cx);
      if (!img) return;
      const pat = ctx.createPattern(img, fill.repeat ? 'repeat' : 'no-repeat');
      pat.setTransform(new DOMMatrix(fill.m));
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      const sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = !!fill.smooth || this.quality === 'best';
      const ga = ctx.globalAlpha;
      if (cx && !this.tintNeeded(cx)) ctx.globalAlpha = ga * cxAlpha(cx);
      ctx.fillStyle = pat;
      ctx.fill(path, FILL_RULE);
      ctx.globalAlpha = ga;
      ctx.imageSmoothingEnabled = sm;
    }
  }

  gradient(ctx, fill, cx) {
    let g;
    if (fill.t === 0x10) g = ctx.createLinearGradient(-1, 0, 1, 0);
    else g = ctx.createRadialGradient(fill.t === 0x13 ? (fill.focal || 0) : 0, 0, 0, 0, 0, 1);
    for (const s of fill.stops) {
      g.addColorStop(Math.max(0, Math.min(1, s[0])), cxColor([s[1], s[2], s[3], s[4]], cx));
    }
    return g;
  }

  tintNeeded(cx) {
    return cx[0] !== 1 || cx[1] !== 1 || cx[2] !== 1 || cx[4] || cx[5] || cx[6] || cx[7];
  }

  bitmapFor(id, cx) {
    const img = this.lib.images.get(id);
    if (!img) return null;
    if (!cx || !this.tintNeeded(cx)) return img;
    const key = id + ':' + cx.map((v) => Math.round(v * 100) / 100).join(',');
    let c = this.tintCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height);
      const a = d.data;
      for (let i = 0; i < a.length; i += 4) {
        a[i] = a[i] * cx[0] + cx[4];
        a[i + 1] = a[i + 1] * cx[1] + cx[5];
        a[i + 2] = a[i + 2] * cx[2] + cx[6];
        a[i + 3] = a[i + 3] * cx[3] + cx[7];
      }
      x.putImageData(d, 0, 0);
      if (this.tintCache.size > 200) this.tintCache.clear();
      this.tintCache.set(key, c);
    }
    return c;
  }

  drawGraphics(ctx, g, m, cx) {
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    for (const op of g.ops) {
      if (op.fill) {
        const f = op.fill;
        ctx.fillStyle = cxColor([f.color >> 16 & 255, f.color >> 8 & 255, f.color & 255, f.alpha * 2.55], cx);
        ctx.fill(op.path, FILL_RULE);
      }
      if (op.line) {
        const l = op.line;
        ctx.lineWidth = this.lineWidth(l.w, m);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = cxColor([l.color >> 16 & 255, l.color >> 8 & 255, l.color & 255, l.alpha * 2.55], cx);
        ctx.stroke(op.path);
      }
    }
  }

  // ---------------------------------------------------------------------
  textRecordPath(r) {
    if (r.path) return r.path;
    const font = this.lib.get(r.font);
    const p = new Path2D();
    if (font) {
      const s = r.size / font.em;
      let x = r.x || 0;
      const y = r.y || 0;
      for (const [gi, adv] of r.glyphs) {
        const gp = font.paths[gi];
        if (gp) p.addPath(gp, new DOMMatrix([s, 0, 0, s, x, y]));
        x += adv;
      }
    }
    r.path = p;
    return p;
  }

  drawStaticText(ctx, t, m, cx) {
    const tm = mul(m, t.matrix);
    ctx.setTransform(tm[0], tm[1], tm[2], tm[3], tm[4], tm[5]);
    for (const r of t.records) {
      ctx.fillStyle = cxColor(r.color || [0, 0, 0, 255], cx);
      ctx.fill(this.textRecordPath(r), 'nonzero');
    }
  }

  // lay out a TextField's runs into positioned glyphs
  layout(tf) {
    const b = tf.bounds;
    const key = tf._text + '|' + tf.wordWrap + '|' + (b[1] - b[0]);
    if (tf.$layoutKey === key && tf.$layoutRuns === tf.runs) return tf.$layout;
    const width = b[1] - b[0] - 4;
    const lines = [];
    let line = { items: [], w: 0, asc: 0, desc: 0, align: 'left' };
    const hctx = this.hctx;
    const pushLine = () => { lines.push(line); line = { items: [], w: 0, asc: 0, desc: 0, align: line.align }; };
    for (const run of tf.runs || []) {
      const font = run.font;
      const size = run.size || tf.size;
      line.align = run.align || line.align;
      const s = font ? size / font.em : 0;
      const asc = font && font.ascent ? font.ascent * s : size * 0.8;
      const desc = font && font.descent ? font.descent * s : size * 0.2;
      for (const ch of run.text) {
        if (ch === '\n' || ch === '\r') { line.asc = Math.max(line.asc, asc); line.desc = Math.max(line.desc, desc); pushLine(); continue; }
        const code = ch.charCodeAt(0);
        let gi = font ? font.codeMap.get(code) : undefined;
        let adv;
        if (gi !== undefined && font.advances) adv = font.advances[gi] * s;
        else {
          hctx.font = `${size}px sans-serif`;
          adv = hctx.measureText(ch).width;
          gi = undefined;
        }
        if (tf.wordWrap && line.w + adv > width && ch !== ' ' && line.items.length) {
          // break at last space
          let k = line.items.length - 1;
          while (k >= 0 && line.items[k].ch !== ' ') k--;
          if (k >= 0) {
            const rest = line.items.splice(k + 1);
            line.items.pop();
            line.w = line.items.length ? line.items[line.items.length - 1].x + line.items[line.items.length - 1].adv : 0;
            pushLine();
            let x = 0;
            for (const it of rest) { it.x = x; x += it.adv; line.items.push(it); }
            line.w = x;
            line.asc = asc; line.desc = desc;
          } else pushLine();
        }
        line.items.push({ ch, gi, font, size, s, color: run.color, x: line.w, adv });
        line.w += adv;
        line.asc = Math.max(line.asc, asc);
        line.desc = Math.max(line.desc, desc);
      }
    }
    if (line.items.length || !lines.length) pushLine();
    tf.$layout = lines;
    tf.$layoutKey = key;
    tf.$layoutRuns = tf.runs;
    return lines;
  }

  measureText(tf) {
    const lines = this.layout(tf);
    let w = 0, h = 0;
    const lead = tf.char.leading || 0;
    for (const l of lines) { w = Math.max(w, l.w); h += l.asc + l.desc + lead; }
    return { w, h };
  }

  drawTextField(ctx, tf, m, cx) {
    const lines = this.layout(tf);
    const b = tf.bounds;
    const width = b[1] - b[0] - 4;
    const lead = tf.char.leading || 0;
    let y = b[2] + 2;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (tf.background) {
      const c = tf.backgroundColor;
      ctx.fillStyle = cxColor([c >> 16 & 255, c >> 8 & 255, c & 255, 255], cx);
      ctx.fillRect(b[0], b[2], b[1] - b[0], b[3] - b[2]);
    }
    if (tf.border) {
      const c = tf.borderColor;
      ctx.strokeStyle = cxColor([c >> 16 & 255, c >> 8 & 255, c & 255, 255], cx);
      ctx.lineWidth = this.lineWidth(1, m);
      ctx.strokeRect(b[0], b[2], b[1] - b[0], b[3] - b[2]);
    }
    for (const l of lines) {
      y += l.asc;
      let x0 = b[0] + 2;
      if (l.align === 'center') x0 += (width - l.w) / 2;
      else if (l.align === 'right') x0 += width - l.w;
      for (const it of l.items) {
        if (it.ch === ' ') continue;
        const c = it.color;
        ctx.fillStyle = cxColor([c >> 16 & 255, c >> 8 & 255, c & 255, 255], cx);
        if (it.gi !== undefined) {
          const gp = it.font.paths[it.gi];
          const s = it.s;
          const tmx = mul(m, [s, 0, 0, s, x0 + it.x, y]);
          ctx.setTransform(tmx[0], tmx[1], tmx[2], tmx[3], tmx[4], tmx[5]);
          ctx.fill(gp, 'nonzero');
        } else {
          ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
          ctx.font = `${it.size}px sans-serif`;
          ctx.fillText(it.ch, x0 + it.x, y);
        }
      }
      y += l.desc + lead;
    }
  }

  // ---------------------------------------------------------------------
  // shape-accurate hit test (Flash hitTest with shapeFlag=true), global coords
  hitTestShape(node, gx, gy) {
    const pm = node._parent ? node._parent.worldMatrix() : [1, 0, 0, 1, 0, 0];
    return this.hitNode(node, pm, gx, gy, true);
  }

  hitNode(node, pm, gx, gy, top) {
    if (!top && !node.__visible && !(node instanceof SimpleButton)) return false;
    if (node.maskOf && !top) return false;
    const m = mul(pm, node.m);
    const h = this.hctx;
    if (node instanceof MovieClip) {
      if (node.graphics) {
        const [lx, ly] = apply(invert(m), gx, gy);
        for (const op of node.graphics.ops) if (op.fill && h.isPointInPath(op.path, lx, ly, FILL_RULE)) return true;
      }
      for (const k of node.children) {
        if (k.clipDepth) continue;
        if (this.hitNode(k, m, gx, gy, false)) return true;
      }
      return false;
    }
    if (node instanceof SimpleButton) {
      for (const k of node.stateKids(8)) if (this.hitNode(k, m, gx, gy, false)) return true;
      return false;
    }
    const [lx, ly] = apply(invert(m), gx, gy);
    if (node instanceof Shape || node instanceof MorphShape) {
      // cheap reject: SWF shape bounds already include stroke widths (+1 for hairlines)
      const b = node.localBounds();
      if (b && (lx < b[0] - 1 || lx > b[1] + 1 || ly < b[2] - 1 || ly > b[3] + 1)) return false;
    }
    if (node instanceof Shape) {
      for (const p of node.char.paths) {
        if (p.f !== undefined && h.isPointInPath(p.path, lx, ly, FILL_RULE)) return true;
        if (p.l !== undefined) {
          const l = node.char.lines[p.l];
          h.lineWidth = Math.max(1, l.w);
          if (h.isPointInStroke(p.path, lx, ly)) return true;
        }
      }
      return false;
    }
    if (node instanceof MorphShape) {
      for (const p of this.lib.morphAt(node.char, node.ratio).paths) {
        if (p.f !== undefined && h.isPointInPath(p.path, lx, ly, FILL_RULE)) return true;
      }
      return false;
    }
    const b = node.localBounds();
    return !!b && lx >= b[0] && lx <= b[1] && ly >= b[2] && ly <= b[3];
  }
}

function mix(h, v) { return Math.imul(h ^ (v | 0), 16777619); }
function mixf(h, v) { return Math.imul(h ^ ((v * 1024) | 0), 16777619); }
function hashStr(s) {
  let h = 0x811c9dc5;
  s = String(s);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h;
}
function filterKey(f) {
  return [f.type, f.blurX, f.blurY, f.strength, f.alpha, Array.isArray(f.color) ? f.color.join('.') : f.color,
    f.passes || f.quality, f.inner ? 1 : 0, f.knockout ? 1 : 0, f.distance || 0, f.angle || 0].join(',');
}

function visibleLine(l) { return l && l.c && l.c[3] > 0 ? 1 : 0; }

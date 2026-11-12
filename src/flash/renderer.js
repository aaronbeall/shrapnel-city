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

const FILL_RULE = 'evenodd';

export class Renderer {
  constructor(rt, canvas, scale = 1) {
    this.rt = rt;
    this.lib = rt.lib;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pool = [];
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

  acquire() {
    let c = this.pool.pop();
    if (!c) {
      c = document.createElement('canvas');
      c.width = this.W; c.height = this.H;
      c.ctx = c.getContext('2d');
    }
    return c;
  }
  release(c) { this.pool.push(c); }

  // ---------------------------------------------------------------------
  render(root, bg) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.W, this.H);
    const s = this.scale;
    this.drawNode(ctx, root, [s, 0, 0, s, 0, 0], null, [0, this.W, 0, this.H]);
  }

  // render a subtree into an arbitrary 2d context (BitmapData.draw)
  renderTo(ctx, node, matrix, cx, w, h) {
    this.drawContent(ctx, node, matrix, cx || null, [0, w, 0, h]);
  }

  drawNode(ctx, node, pm, pcx, clip) {
    if (!node.__visible || node.maskOf) return;
    const m = mul(pm, node.m);
    const cx = node.cx ? mulCx(pcx, node.cx) : pcx;
    if (cx && cx[3] <= 0 && cx[7] <= 0) return;
    const blend = node.blendMode;
    const fx = node.filters && node.filters.length && this.quality !== 'low' ? node.filters : null;
    if ((blend && blend !== 'normal' && blend !== 'layer') || fx || node.maskedBy) {
      this.drawLayered(ctx, node, m, cx, blend, fx, clip);
    } else {
      this.drawContent(ctx, node, m, cx, clip);
    }
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
  drawLayered(ctx, node, m, cx, blend, fx, clip) {
    // screen-space bounds of the node, padded for filters
    let b = transformRect(m, node.localBounds());
    if (!b) return;
    let pad = 2;
    if (fx) for (const f of fx) pad += this.filterPad(f);
    const x0 = Math.max(clip[0], Math.floor(b[0] - pad)), x1 = Math.min(clip[1], Math.ceil(b[1] + pad));
    const y0 = Math.max(clip[2], Math.floor(b[2] - pad)), y1 = Math.min(clip[3], Math.ceil(b[3] + pad));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, h = y1 - y0;
    const layer = this.acquire();
    const lc = layer.ctx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(x0, y0, w, h);
    lc.save();
    lc.beginPath(); lc.rect(x0, y0, w, h); lc.clip();
    this.drawContent(lc, node, m, cx, [x0, x1, y0, y1]);
    lc.restore();
    if (node.maskedBy && !node.maskedBy.removed) {
      const path = new Path2D();
      const mk = node.maskedBy;
      this.collectPaths(mk, mk.worldMatrixScaled(this.scale), path);
      lc.save();
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'destination-in';
      lc.fillStyle = '#000';
      lc.fill(path);
      lc.restore();
    }
    let src = layer;
    let tmp = null;
    if (fx) {
      for (const f of fx) {
        const out = this.applyFilter(src, f, x0, y0, w, h);
        if (out !== src) {
          if (src !== layer) this.release(src);
          src = out;
        }
      }
      tmp = src !== layer ? src : null;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (blend === 'invert') {
      // invert destination wherever the clip has coverage
      const inv = this.acquire();
      const ic = inv.ctx;
      ic.setTransform(1, 0, 0, 1, 0, 0);
      ic.clearRect(x0, y0, w, h);
      ic.drawImage(src, x0, y0, w, h, x0, y0, w, h);
      ic.globalCompositeOperation = 'source-in';
      ic.fillStyle = '#fff';
      ic.fillRect(x0, y0, w, h);
      ic.globalCompositeOperation = 'source-over';
      ctx.globalCompositeOperation = 'difference';
      ctx.drawImage(inv, x0, y0, w, h, x0, y0, w, h);
      this.release(inv);
    } else {
      ctx.globalCompositeOperation = (blend && BLEND[blend]) || 'source-over';
      ctx.drawImage(src, x0, y0, w, h, x0, y0, w, h);
    }
    ctx.restore();
    if (tmp) this.release(tmp);
    this.release(layer);
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

  applyFilter(src, f, x0, y0, w, h) {
    if (f.type === 'blur') {
      const sg = this.sigma(f);
      if (sg < 0.3) return src;
      const out = this.acquire();
      const oc = out.ctx;
      oc.setTransform(1, 0, 0, 1, 0, 0);
      oc.clearRect(x0, y0, w, h);
      oc.filter = `blur(${sg.toFixed(2)}px)`;
      oc.drawImage(src, x0, y0, w, h, x0, y0, w, h);
      oc.filter = 'none';
      return out;
    }
    if (f.type === 'glow' || f.type === 'dropShadow') {
      if (f.inner) return src; // rare; keep the content itself
      const sg = this.sigma(f);
      const c = this.filterColor(f);
      if (c[3] <= 0) return src;
      const out = this.acquire();
      const oc = out.ctx;
      oc.setTransform(1, 0, 0, 1, 0, 0);
      oc.clearRect(x0, y0, w, h);
      // colored silhouette, blurred, then content on top
      let dx = 0, dy = 0;
      if (f.type === 'dropShadow') {
        dx = Math.cos(f.angle || 0) * (f.distance || 0) * this.scale;
        dy = Math.sin(f.angle || 0) * (f.distance || 0) * this.scale;
      }
      const sil = this.acquire();
      const sc = sil.ctx;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(x0, y0, w, h);
      sc.drawImage(src, x0, y0, w, h, x0, y0, w, h);
      sc.globalCompositeOperation = 'source-in';
      sc.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
      sc.fillRect(x0, y0, w, h);
      sc.globalCompositeOperation = 'source-over';
      oc.filter = sg >= 0.3 ? `blur(${sg.toFixed(2)}px)` : 'none';
      const strength = Math.max(0, f.strength === undefined ? 1 : f.strength);
      let s = strength;
      while (s > 0) {
        oc.globalAlpha = Math.min(1, s);
        oc.drawImage(sil, x0, y0, w, h, x0 + dx, y0 + dy, w, h);
        s -= 1;
      }
      oc.globalAlpha = 1;
      oc.filter = 'none';
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
    return src; // bevel etc: content unchanged
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
      const g = this.gradient(ctx, fill, cx);
      const mm = mul(m, gm);
      let gp;
      if (dynamic) {
        gp = new Path2D();
        gp.addPath(path, new DOMMatrix(invert(gm)));
      } else gp = this.lib.gradientPath(entry, fill, 0);
      ctx.setTransform(mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]);
      ctx.fillStyle = g;
      ctx.fill(gp, FILL_RULE);
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

// flash.display.BitmapData on top of a canvas, with a lazily refreshed pixel
// cache so getPixel (used by the pixel-perfect collision code) is fast.

export class Matrix {
  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) { Object.assign(this, { a, b, c, d, tx, ty }); }
  translate(x, y) { this.tx += x; this.ty += y; }
  scale(sx, sy) {
    this.a *= sx; this.b *= sy; this.c *= sx; this.d *= sy; this.tx *= sx; this.ty *= sy;
  }
  rotate(r) {
    const cos = Math.cos(r), sin = Math.sin(r);
    const { a, b, c, d, tx, ty } = this;
    this.a = a * cos - b * sin; this.b = a * sin + b * cos;
    this.c = c * cos - d * sin; this.d = c * sin + d * cos;
    this.tx = tx * cos - ty * sin; this.ty = tx * sin + ty * cos;
  }
  identity() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }); }
  toArray() { return [this.a, this.b, this.c, this.d, this.tx, this.ty]; }
}

export class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
}

export class Rectangle {
  constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height }); }
}

export class ColorTransform {
  constructor(rm = 1, gm = 1, bm = 1, am = 1, ro = 0, go = 0, bo = 0, ao = 0) {
    Object.assign(this, { redMultiplier: rm, greenMultiplier: gm, blueMultiplier: bm, alphaMultiplier: am,
      redOffset: ro, greenOffset: go, blueOffset: bo, alphaOffset: ao });
  }
  toArray() {
    return [this.redMultiplier, this.greenMultiplier, this.blueMultiplier, this.alphaMultiplier,
      this.redOffset, this.greenOffset, this.blueOffset, this.alphaOffset];
  }
}

export function GlowFilter(color = 0xff0000, alpha = 1, blurX = 6, blurY = 6, strength = 2, quality = 1, inner = false, knockout = false) {
  return { type: 'glow', color: [color >> 16 & 255, color >> 8 & 255, color & 255, Math.round(alpha * 255)],
    blurX, blurY, strength, passes: quality, inner, knockout };
}
export function BlurFilter(blurX = 4, blurY = 4, quality = 1) {
  return { type: 'blur', blurX, blurY, passes: quality };
}

export class BitmapData {
  constructor(rt, width, height, transparent = true, fill = 0xffffffff) {
    this.rt = rt;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.transparent = transparent;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.pixels = null;
    this.fillRect(new Rectangle(0, 0, this.width, this.height), transparent ? fill : (fill | 0xff000000));
  }

  _dirty() { this.pixels = null; }

  _read() {
    if (!this.pixels) {
      const d = this.ctx.getImageData(0, 0, this.width, this.height);
      this.pixels = new Uint32Array(d.data.buffer); // little-endian ABGR
    }
    return this.pixels;
  }

  getPixel(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const v = this._read()[y * this.width + x];
    return ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
  }

  getPixel32(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const v = this._read()[y * this.width + x];
    return (((v >>> 24) << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
  }

  setPixel(x, y, c) {
    this.ctx.fillStyle = css(c | 0xff000000, true);
    this.ctx.fillRect(x | 0, y | 0, 1, 1);
    this._dirty();
  }

  fillRect(r, color) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(r.x, r.y, r.width, r.height);
    ctx.fillStyle = css(color, this.transparent);
    ctx.fillRect(r.x, r.y, r.width, r.height);
    this._dirty();
  }

  // draw(source, matrix, colorTransform, blendMode)
  draw(source, matrix, cxf, blend) {
    const ctx = this.ctx;
    const m = matrix ? (matrix.toArray ? matrix.toArray() : [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]) : [1, 0, 0, 1, 0, 0];
    ctx.save();
    if (blend === 'add') ctx.globalCompositeOperation = 'lighter';
    else if (blend && blend !== 'normal') ctx.globalCompositeOperation = blend;
    if (source instanceof BitmapData) {
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.drawImage(source.canvas, 0, 0);
    } else if (source) {
      const r = this.rt.renderer;
      const prev = r.scale;
      r.scale = 1;
      r.renderTo(ctx, source, m, cxf ? cxf.toArray() : null, this.width, this.height);
      r.scale = prev;
    }
    ctx.restore();
    if (!this.transparent) {
      // opaque bitmaps have no alpha: flatten anything partially transparent
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
    this._dirty();
  }

  copyPixels(src, rect, pt) {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(pt.x, pt.y, rect.width, rect.height);
    this.ctx.drawImage(src.canvas, rect.x, rect.y, rect.width, rect.height, pt.x, pt.y, rect.width, rect.height);
    this._dirty();
  }

  clone() {
    const b = new BitmapData(this.rt, this.width, this.height, this.transparent, 0);
    b.ctx.clearRect(0, 0, this.width, this.height);
    b.ctx.drawImage(this.canvas, 0, 0);
    return b;
  }

  get rectangle() { return new Rectangle(0, 0, this.width, this.height); }

  dispose() { this.canvas.width = this.canvas.height = 1; this.pixels = null; }
}

function css(c, transparent) {
  const a = transparent ? ((c >>> 24) & 255) / 255 : 1;
  return `rgba(${c >> 16 & 255},${c >> 8 & 255},${c & 255},${a})`;
}

// Collision shapes: levels/NN/collision.json lists the shapes, bottom first, that bake into
// collision.png, the only collision file the game (and the art bake) reads.
//   {name, mode: "wall"|"chasm"|"open", d, x, y, scale|matrix, outline, grey, hidden, locked, group}
//       a vector shape: d is a path (M/L/Q/C/Z, filled even-odd); with "outline": w it is a
//       stroke w px wide instead of a fill. It paints its mode's grey (0, 153, 255), or "grey"
//       when it has one (the Bridge's original hairlines are #333333)
//   {name, pixels: "collision-<id>.png", x, y, hidden, locked, group}
//       a pixel layer: a PNG the size of the level, transparent where it leaves what's below
//       alone, black / #999999 / white where it paints wall / chasm / open
//
// Baking draws the shown shapes in order on a white canvas: vectors anti-aliased, pixel layers as
// they are. That's what the game itself did with a vector map (level_bmp.draw(level_mc)), so the
// Bridge's original shapes bake back to its collision.png. The game reads a pixel as wall when
// it is exactly black, as impassable but shoot-over when it is #999999 or darker, else as open
// (wallHitTest in as2/functionsGame.as), so a vector's soft edge is a thin impassable fringe,
// as it always was.

export const GREY = { wall: 0, chasm: 153, open: 255 };
export const MODES = ['wall', 'chasm', 'open'];
export const isPixels = (s) => !!s && typeof s.pixels === 'string';
// what the game makes of a pixel (wallHitTest): 0 wall, 1 impassable (chasm), 2 open
export const gameClass = (r, g, b) => { const v = (r << 16) | (g << 8) | b; return v === 0 ? 0 : v <= 0x999999 ? 1 : 2; };
export const greyOf = (s) => (typeof s.grey === 'number' ? s.grey : GREY[s.mode] ?? 0);

export function shapeMatrix(s) {
  let a = 1, b = 0, c = 0, d = 1;
  if (s.matrix) [a, b, c, d] = s.matrix;
  else if (Array.isArray(s.scale)) [a, d] = s.scale;
  else if (typeof s.scale === 'number') a = d = s.scale;
  return [a, b, c, d, s.x || 0, s.y || 0];
}

export class ShapeStack {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.canvases = new Map(); // pixel layer file -> canvas (kept after a layer is deleted, for undo)
    this.datas = new Map();    // file -> ImageData mirror, for painting
    this.paths = new Map();    // d -> Path2D
    this.bounds = new Map();   // file -> [x0, y0, x1, y1] of its painted pixels, or null
  }

  blank() { const c = document.createElement('canvas'); c.width = this.w; c.height = this.h; return c; }
  ctx(file) { return this.canvas(file).getContext('2d', { willReadFrequently: true }); }
  canvas(file) {
    let c = this.canvases.get(file);
    if (!c) { c = this.blank(); this.canvases.set(file, c); }
    return c;
  }
  data(file) {
    let d = this.datas.get(file);
    if (!d) { d = this.ctx(file).getImageData(0, 0, this.w, this.h); this.datas.set(file, d); }
    return d;
  }

  // a pixel layer from an image: each pixel is either left alone (transparent) or painted
  setImage(file, img) {
    const c = this.blank(), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, this.w, this.h), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 128) p[i] = p[i + 1] = p[i + 2] = p[i + 3] = 0;
      else p[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    this.canvases.set(file, c);
    this.datas.set(file, d);
    this.bounds.delete(file);
  }

  copy(from, to) { const c = this.blank(); c.getContext('2d').drawImage(this.canvas(from), 0, 0); this.canvases.set(to, c); this.datas.delete(to); this.bounds.delete(to); }

  path(d) {
    let p = this.paths.get(d);
    if (!p) { p = new Path2D(d); if (this.paths.size > 2000) this.paths.clear(); this.paths.set(d, p); }
    return p;
  }

  // Bake the shown shapes into ImageData for the box [x, y, w, h] (whole map by default).
  bake(shapes, box = [0, 0, this.w, this.h]) {
    const [bx, by, bw, bh] = box;
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff';
    x.fillRect(0, 0, bw, bh);
    x.translate(-bx, -by);
    x.imageSmoothingEnabled = false;
    for (const s of shapes) this.draw(x, s);
    return x.getImageData(0, 0, bw, bh);
  }

  draw(x, s) {
    if (s.hidden) return;
    x.save();
    if (isPixels(s)) {
      const cv = this.canvases.get(s.pixels);
      if (cv) x.drawImage(cv, Math.round(s.x || 0), Math.round(s.y || 0));
    } else if (typeof s.d === 'string') {
      x.transform(...shapeMatrix(s));
      const g = greyOf(s), col = `rgb(${g},${g},${g})`;
      try {
        if (s.outline) { x.strokeStyle = col; x.lineWidth = s.outline; x.stroke(this.path(s.d)); }
        else { x.fillStyle = col; x.fill(this.path(s.d), 'evenodd'); }
      } catch { /* a bad path draws nothing */ }
    }
    x.restore();
  }

  // is (x, y) on this shape? (a pixel layer: on one of its painted pixels)
  hit(s, x, y, hitCtx) {
    if (isPixels(s)) {
      const px = Math.floor(x - Math.round(s.x || 0)), py = Math.floor(y - Math.round(s.y || 0));
      if (px < 0 || py < 0 || px >= this.w || py >= this.h) return false;
      return this.data(s.pixels).data[(py * this.w + px) * 4 + 3] > 0;
    }
    const [a, b, c, d, tx, ty] = shapeMatrix(s), D = a * d - b * c;
    if (!D) return false;
    const lx = (d * (x - tx) - c * (y - ty)) / D, ly = (-b * (x - tx) + a * (y - ty)) / D;
    try {
      if (s.outline) { hitCtx.lineWidth = Math.max(s.outline, 3); return hitCtx.isPointInStroke(this.path(s.d), lx, ly); }
      return hitCtx.isPointInPath(this.path(s.d), lx, ly, 'evenodd');
    } catch { return false; }
  }

  // [x0, y0, x1, y1] of a shape in level pixels
  boundsOf(s) {
    if (isPixels(s)) {
      let b = this.bounds.get(s.pixels);
      if (b === undefined) {
        const p = this.data(s.pixels).data, W = this.w;
        let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        for (let y = 0; y < this.h; y++) for (let x = 0; x < W; x++) if (p[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
        b = x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
        this.bounds.set(s.pixels, b);
      }
      const ox = Math.round(s.x || 0), oy = Math.round(s.y || 0);
      return b ? [b[0] + ox, b[1] + oy, b[2] + ox, b[3] + oy] : [ox, oy, ox, oy];
    }
    const n = (s.d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
    const M = shapeMatrix(s);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < n.length; i += 2) {
      const X = M[0] * n[i] + M[2] * n[i + 1] + M[4], Y = M[1] * n[i] + M[3] * n[i + 1] + M[5];
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
    const w = (s.outline || 0) / 2;
    return [x0 - w, y0 - w, x1 + w, y1 + w];
  }

  // ---- painting pixel layers (coordinates in the layer's own pixels)
  grab(file, x, y, w, h) { return { file, x, y, w, h, pixels: this.ctx(file).getImageData(x, y, w, h) }; }
  restore(r) {
    const x = this.ctx(r.file);
    x.putImageData(r.pixels, r.x, r.y);
    this.datas.delete(r.file);
    this.bounds.delete(r.file);
  }

  // a brush dab like CollisionMap.dab: size 1 is one pixel, bigger ones are round
  dab(file, cx, cy, size, mode, box) {
    const v = GREY[mode], img = this.data(file), d = img.data, W = this.w;
    const half = size / 2, x0 = Math.floor(cx - half + 0.5), y0 = Math.floor(cy - half + 0.5), round = size > 2;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (round) { const dx = i + 0.5 - half, dy = j + 0.5 - half; if (dx * dx + dy * dy > half * half) continue; }
        const x = x0 + i, y = y0 + j;
        if (x < 0 || y < 0 || x >= W || y >= this.h) continue;
        const k = (y * W + x) * 4;
        d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255;
      }
    }
    box[0] = Math.min(box[0], x0); box[1] = Math.min(box[1], y0);
    box[2] = Math.max(box[2], x0 + size); box[3] = Math.max(box[3], y0 + size);
  }

  line(file, ax, ay, bx, by, size, mode, box) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= n; s++) this.dab(file, ax + (bx - ax) * s / n, ay + (by - ay) * s / n, size, mode, box);
  }

  // paint the pixels set in mask (w*h bytes, at x, y) in a mode
  paintMask(file, mask, x, y, w, h, mode) {
    const v = GREY[mode], d = this.data(file).data, W = this.w;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!mask[j * w + i]) continue;
      const X = x + i, Y = y + j;
      if (X < 0 || Y < 0 || X >= W || Y >= this.h) continue;
      const k = (Y * W + X) * 4;
      d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255;
    }
  }

  // write the painted ImageData back to the canvas, for box [x0, y0, x1, y1]
  commit(file, box) {
    const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(this.w, Math.ceil(box[2])), y1 = Math.min(this.h, Math.ceil(box[3]));
    if (x1 <= x0 || y1 <= y0) return null;
    this.ctx(file).putImageData(this.data(file), 0, 0, x0, y0, x1 - x0, y1 - y0);
    this.bounds.delete(file);
    return [x0, y0, x1 - x0, y1 - y0];
  }

  toBlob(file) { return new Promise((res) => this.canvas(file).toBlob(res, 'image/png')); }
}

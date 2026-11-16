// Pixel-exact editing of a collision map canvas. Everything is drawn aliased, in exactly
// the three collision colours, so what you paint is what the game hit-tests.
export const COLOURS = {
  wall: [0, 0, 0],
  chasm: [153, 153, 153],
  open: [255, 255, 255],
};

export class CollisionMap {
  constructor(source) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.drawImage(source, 0, 0);
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.data = this.ctx.getImageData(0, 0, this.w, this.h);
    this.overlay = document.createElement('canvas');
    this.overlay.width = this.w;
    this.overlay.height = this.h;
    this.octx = this.overlay.getContext('2d');
    this.refreshOverlay(0, 0, this.w, this.h);
  }

  // tinted view: walls blue, chasms orange, open floor clear
  refreshOverlay(x, y, w, h) {
    const src = this.data.data, W = this.w;
    const out = this.octx.createImageData(w, h);
    const o = out.data;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = src[((y + j) * W + x + i) * 4];
        const k = (j * w + i) * 4;
        if (v < 77) { o[k] = 40; o[k + 1] = 90; o[k + 2] = 255; o[k + 3] = 150; }
        else if (v < 205) { o[k] = 255; o[k + 1] = 140; o[k + 2] = 0; o[k + 3] = 140; }
      }
    }
    this.octx.putImageData(out, x, y);
  }

  // copy a region, for undo
  grab(x, y, w, h) { return { x, y, w, h, pixels: this.ctx.getImageData(x, y, w, h) }; }

  restore(r) {
    this.ctx.putImageData(r.pixels, r.x, r.y);
    this.data = this.ctx.getImageData(0, 0, this.w, this.h);
    this.refreshOverlay(r.x, r.y, r.w, r.h);
  }

  clampBox(x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(this.w, Math.ceil(x1)); y1 = Math.min(this.h, Math.ceil(y1));
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
  }

  // Fill a shape drawn by draw(ctx) (in map pixels) with a collision colour, aliased: a
  // pixel is painted when the shape covers at least half of it. Returns the undo record.
  fillShape(box, colour, draw) {
    const b = this.clampBox(...box);
    if (!b) return null;
    const [x, y, w, h] = b;
    const before = this.grab(x, y, w, h);
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    const tc = t.getContext('2d', { willReadFrequently: true });
    tc.translate(-x, -y);
    tc.fillStyle = '#000';
    draw(tc);
    const mask = tc.getImageData(0, 0, w, h).data;
    const [r, g, bl] = COLOURS[colour];
    const d = this.data.data, W = this.w;
    let any = false;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (mask[(j * w + i) * 4 + 3] < 128) continue;
        const k = ((y + j) * W + x + i) * 4;
        d[k] = r; d[k + 1] = g; d[k + 2] = bl; d[k + 3] = 255;
        any = true;
      }
    }
    if (!any) return null;
    this.ctx.putImageData(this.data, 0, 0, x, y, w, h);
    this.refreshOverlay(x, y, w, h);
    return { before, after: this.grab(x, y, w, h) };
  }

  rect(x0, y0, x1, y1, colour) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    return this.fillShape([ax, ay, bx, by], colour, (c) => c.fillRect(ax, ay, bx - ax, by - ay));
  }

  polygon(pts, colour) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return this.fillShape([Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1], colour, (c) => {
      c.beginPath();
      pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      c.closePath();
      c.fill();
    });
  }

  // brush dab of `size` pixels centred on (cx, cy); size 1 is exactly one pixel
  dab(cx, cy, size, colour, box) {
    const [r, g, b] = COLOURS[colour];
    const d = this.data.data, W = this.w;
    const half = size / 2;
    const x0 = Math.floor(cx - half + 0.5), y0 = Math.floor(cy - half + 0.5);
    const round = size > 2;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (round) {
          const dx = i + 0.5 - half, dy = j + 0.5 - half;
          if (dx * dx + dy * dy > half * half) continue;
        }
        const x = x0 + i, y = y0 + j;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const k = (y * W + x) * 4;
        d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
      }
    }
    box[0] = Math.min(box[0], x0); box[1] = Math.min(box[1], y0);
    box[2] = Math.max(box[2], x0 + size); box[3] = Math.max(box[3], y0 + size);
  }

  // a pencil stroke segment, interpolated so fast strokes stay continuous
  line(ax, ay, bx, by, size, colour, box) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= n; s++) this.dab(ax + (bx - ax) * s / n, ay + (by - ay) * s / n, size, colour, box);
  }

  commitStroke(box) {
    const b = this.clampBox(...box);
    if (!b) return;
    this.ctx.putImageData(this.data, 0, 0, b[0], b[1], b[2], b[3]);
    this.refreshOverlay(...b);
  }

  // 4-connected flood fill of the exact colour under (x, y)
  fill(x, y, colour) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const d = this.data.data, W = this.w, H = this.h;
    const k0 = (y * W + x) * 4;
    const [r, g, b] = COLOURS[colour];
    const tr = d[k0], tg = d[k0 + 1], tb = d[k0 + 2];
    if (tr === r && tg === g && tb === b) return null;
    const before = this.grab(0, 0, W, H);
    const stack = [x, y];
    let x0 = x, y0 = y, x1 = x, y1 = y;
    while (stack.length) {
      const py = stack.pop(), px = stack.pop();
      let l = px;
      const same = (xx) => { const k = (py * W + xx) * 4; return d[k] === tr && d[k + 1] === tg && d[k + 2] === tb; };
      while (l > 0 && same(l - 1)) l--;
      let rr = px;
      while (rr < W - 1 && same(rr + 1)) rr++;
      for (let xx = l; xx <= rr; xx++) {
        const k = (py * W + xx) * 4;
        d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
        for (const ny of [py - 1, py + 1]) {
          if (ny < 0 || ny >= H) continue;
          const kk = (ny * W + xx) * 4;
          if (d[kk] === tr && d[kk + 1] === tg && d[kk + 2] === tb) stack.push(xx, ny);
        }
      }
      x0 = Math.min(x0, l); x1 = Math.max(x1, rr); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    this.ctx.putImageData(this.data, 0, 0, x0, y0, w, h);
    this.refreshOverlay(x0, y0, w, h);
    const crop = (full) => ({ x: x0, y: y0, w, h, pixels: cropImage(full.pixels, x0, y0, w, h) });
    return { before: crop(before), after: this.grab(x0, y0, w, h) };
  }

  colourAt(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const v = this.data.data[(y * this.w + x) * 4];
    return v < 77 ? 'wall' : v < 205 ? 'chasm' : 'open';
  }

  toBlob() { return new Promise((res) => this.canvas.toBlob(res, 'image/png')); }
}

function cropImage(img, x, y, w, h) {
  const out = new ImageData(w, h);
  for (let j = 0; j < h; j++) out.data.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4), j * w * 4);
  return out;
}

// A quick preview of the level art for the collision map being edited: the Bridge kit's
// floor, wall and chasm textures (tools/art/parts) filled into the three collision colours,
// with cheap versions of the bake's extruded wall sides, shadows, bevels and chasm lips.
// It's only a guide while drawing; tools/art bakes the real background.
const PARTS = 'tools/art/parts/';
const TEX = { floor: { scale: 0.5, tone: 0.24 }, wall: { scale: 0.33, tone: 0.74 }, chasm: { scale: 0.45, tone: 0.2 } };

let textures = null;
function loadTextures() {
  if (!textures) {
    textures = Promise.all(Object.entries(TEX).map(([name, t]) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res([name, toned(img, t)]);
      img.onerror = () => rej(new Error('could not load ' + PARTS + name + '.png'));
      img.src = PARTS + name + '.png';
    }))).then(Object.fromEntries);
  }
  return textures;
}

// the texture at its bake scale, brightened or darkened to the bake's average tone
function toned(img, { scale, tone }) {
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h);
  let sum = 0;
  for (let i = 0; i < d.data.length; i += 4) sum += d.data[i] + d.data[i + 1] + d.data[i + 2];
  const k = (tone * 255) / (sum / (d.data.length / 4) / 3);
  for (let i = 0; i < d.data.length; i += 4) for (let j = 0; j < 3; j++) d.data[i + j] = Math.min(255, d.data[i + j] * k);
  x.putImageData(d, 0, 0);
  return c;
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// white-on-transparent mask of the pixels whose red value passes test(v)
function mask(map, test) {
  const { w, h } = map;
  const c = canvas(w, h), x = c.getContext('2d');
  const out = x.createImageData(w, h), src = map.data.data, o = out.data;
  for (let i = 0; i < w * h; i++) if (test(src[i * 4])) { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = 255; o[i * 4 + 3] = 255; }
  x.putImageData(out, 0, 0);
  return c;
}

// fill `m`'s shape with a pattern or colour
function shaped(m, fill, op = 'source-in') {
  const c = canvas(m.width, m.height), x = c.getContext('2d');
  x.drawImage(m, 0, 0);
  x.globalCompositeOperation = op;
  x.fillStyle = fill;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

// pixels of `m` within r of its edge, outside it
function ring(m, r) {
  const c = canvas(m.width, m.height), x = c.getContext('2d');
  for (let a = 0; a < 16; a++) x.drawImage(m, Math.cos(a * Math.PI / 8) * r, Math.sin(a * Math.PI / 8) * r);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(m, 0, 0);
  return c;
}

// pixels of `m` whose neighbour at (-dx, -dy) is outside it: a lit or shaded edge
function edge(m, dx, dy) {
  const c = canvas(m.width, m.height), x = c.getContext('2d');
  x.drawImage(m, 0, 0);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(m, dx, dy);
  return c;
}

export async function renderPreview(map) {
  const tex = await loadTextures();
  const { w, h } = map;
  const out = canvas(w, h), x = out.getContext('2d');
  const pat = (t) => x.createPattern(tex[t], 'repeat');
  const wall = mask(map, (v) => v < 77), chasm = mask(map, (v) => v >= 77 && v < 205);

  // floor, darker near walls
  x.fillStyle = pat('floor');
  x.fillRect(0, 0, w, h);
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 14;
  x.drawImage(shaped(wall, '#000'), 0, 0);
  x.restore();

  // chasms with a hazard-striped lip
  x.drawImage(shaped(chasm, pat('chasm')), 0, 0);
  const lip = ring(chasm, 5);
  const stripes = canvas(14, 14), sx = stripes.getContext('2d');
  sx.fillStyle = '#171717'; sx.fillRect(0, 0, 14, 14);
  sx.strokeStyle = '#b88f1c'; sx.lineWidth = 5;
  sx.beginPath(); for (let o = -14; o <= 28; o += 14) { sx.moveTo(o, 0); sx.lineTo(o - 14, 14); } sx.stroke();
  x.globalAlpha = 0.8;
  x.drawImage(shaped(lip, x.createPattern(stripes, 'repeat')), 0, 0);
  x.globalAlpha = 1;

  // wall sides, extruded toward the map centre like the bake (the mask scaled about the centre)
  const cx = w / 2, cy = h / 2, K = 0.02;
  const side = canvas(w, h), s = side.getContext('2d');
  for (let i = 12; i >= 1; i--) {
    const k = 1 / (1 + K * (i / 12));
    s.setTransform(k, 0, 0, k, cx * (1 - k), cy * (1 - k));
    s.drawImage(wall, 0, 0);
  }
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = '#0b0c0d'; s.fillRect(0, 0, w, h);
  x.drawImage(side, 0, 0);

  // wall tops, bevelled: lit top-left edges, shaded bottom-right edges, a dark rim
  x.drawImage(shaped(wall, pat('wall')), 0, 0);
  x.globalAlpha = 0.28; x.drawImage(shaped(edge(wall, 3, 3), '#fff'), 0, 0);
  x.globalAlpha = 0.4; x.drawImage(shaped(edge(wall, -3, -3), '#000'), 0, 0);
  x.globalAlpha = 0.5;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) x.drawImage(shaped(edge(wall, dx, dy), '#000'), 0, 0);
  x.globalAlpha = 1;
  return out;
}

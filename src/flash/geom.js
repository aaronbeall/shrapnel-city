// 2D affine matrices as [a, b, c, d, tx, ty] (Flash convention: x' = a*x + c*y + tx)
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export function mul(m, n) {
  // returns m * n (apply n first, then m)
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [0, 0, 0, 0, -m[4], -m[5]];
  const id = 1 / det;
  return [
    m[3] * id, -m[1] * id, -m[2] * id, m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function transformRect(m, r) {
  // r = [xmin, xmax, ymin, ymax]
  if (!r) return null;
  const pts = [apply(m, r[0], r[2]), apply(m, r[1], r[2]), apply(m, r[0], r[3]), apply(m, r[1], r[3])];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, x1, y0, y1];
}

export function unionRect(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])];
}

// Color transforms as [rMul, gMul, bMul, aMul, rAdd, gAdd, bAdd, aAdd]
export const CX_IDENTITY = Object.freeze([1, 1, 1, 1, 0, 0, 0, 0]);

export function isIdentityCx(c) {
  return !c || (c[0] === 1 && c[1] === 1 && c[2] === 1 && c[3] === 1 && !c[4] && !c[5] && !c[6] && !c[7]);
}

export function mulCx(outer, inner) {
  // result applies inner first, then outer
  if (!inner) return outer;
  if (!outer) return inner;
  return [
    outer[0] * inner[0], outer[1] * inner[1], outer[2] * inner[2], outer[3] * inner[3],
    outer[0] * inner[4] + outer[4], outer[1] * inner[5] + outer[5],
    outer[2] * inner[6] + outer[6], outer[3] * inner[7] + outer[7],
  ];
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function cxColor(c, cx) {
  // c = [r,g,b,a] 0..255 -> css string
  let r = c[0], g = c[1], b = c[2], a = c[3];
  if (cx) {
    r = clamp(r * cx[0] + cx[4]);
    g = clamp(g * cx[1] + cx[5]);
    b = clamp(b * cx[2] + cx[6]);
    a = clamp(a * cx[3] + cx[7]);
  }
  return `rgba(${r | 0},${g | 0},${b | 0},${(a / 255).toFixed(4)})`;
}

export function cxAlpha(cx) {
  return cx ? Math.max(0, Math.min(1, cx[3] + cx[7] / 255)) : 1;
}

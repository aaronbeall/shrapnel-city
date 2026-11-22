// Editable vector paths. A path is an SVG-style "d" string: absolute M/L/Q/C/Z, one or more
// subpaths, filled even-odd. Flash shapes only ever use lines and quadratic curves (L, Q);
// Fireworks art also has cubic curves (C), so all three are kept exactly as they are.
//
// In memory a path is a list of contours: {closed, nodes: [[x, y], ...], segs: [{c}, ...]}.
// segs[i] runs from nodes[i] to nodes[i + 1] (for a closed contour the last one runs back to
// nodes[0]), and c holds its control points: [] a line, [q] a quadratic, [c1, c2] a cubic.
// For a cubic, c1 is the handle of the segment's start node and c2 that of its end node.

const TOKEN = /[MLQCZmlqcz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

export function parsePath(d) {
  const t = String(d).match(TOKEN) || [];
  const out = [];
  let i = 0, cmd = 'M', cur = null, start = [0, 0];
  const n = () => +t[i++];
  const pt = () => [n(), n()];
  const begin = (p) => { cur = { closed: false, nodes: [p], segs: [] }; out.push(cur); start = p; };
  while (i < t.length) {
    if (/^[A-Za-z]$/.test(t[i])) {
      cmd = t[i++].toUpperCase();
      if (cmd === 'Z') {
        if (cur) close(cur);
        cur = null;
        continue;
      }
    }
    if (!/^[-\d.]/.test(t[i] || '')) { i++; continue; } // stray token
    if (cmd === 'M') { begin(pt()); cmd = 'L'; continue; } // further pairs after M are lines
    if (!cur) begin([...start]); // drawing on after Z starts again from the last subpath's start
    const c = cmd === 'Q' ? [pt()] : cmd === 'C' ? [pt(), pt()] : [];
    cur.segs.push({ c });
    cur.nodes.push(pt());
  }
  return out.filter((k) => k.nodes.length > 1 || k.segs.length);
}

// Z: the path returns to its first node. When it got there with its own segment (L/Q/C back to
// the start), that segment closes the contour; otherwise an implicit straight line does.
function close(k) {
  k.closed = true;
  const a = k.nodes[0], b = k.nodes[k.nodes.length - 1];
  if (k.nodes.length > 1 && a[0] === b[0] && a[1] === b[1]) k.nodes.pop();
  else k.segs.push({ c: [] });
}

// up to 4 decimals: the original data has some (most is in 0.05 px twips); edits round to 0.01
const num = (v) => { const r = Math.round(v * 10000) / 10000; return String(Object.is(r, -0) ? 0 : r); };
const P = ([x, y]) => `${num(x)} ${num(y)}`;

export function pathString(contours) {
  const parts = [];
  for (const k of contours) {
    if (!k.nodes.length) continue;
    parts.push('M ' + P(k.nodes[0]));
    k.segs.forEach((s, i) => {
      const to = k.nodes[(i + 1) % k.nodes.length];
      parts.push(s.c.length === 0 ? 'L ' + P(to) : s.c.length === 1 ? `Q ${P(s.c[0])} ${P(to)}` : `C ${P(s.c[0])} ${P(s.c[1])} ${P(to)}`);
    });
    if (k.closed) parts.push('Z');
  }
  return parts.join(' ');
}

export const fromPoints = (points) => [{ closed: true, nodes: points.map((p) => [...p]), segs: points.map(() => ({ c: [] })) }];
// one closed contour of straight lines: can be stored as plain points
export const isPolygon = (cs) => cs.length === 1 && cs[0].closed && cs[0].segs.every((s) => !s.c.length);
export const clone = (cs) => cs.map((k) => ({ closed: k.closed, nodes: k.nodes.map((p) => [...p]), segs: k.segs.map((s) => ({ c: s.c.map((p) => [...p]) })) }));
export const curveCount = (cs) => cs.reduce((a, k) => a + k.segs.filter((s) => s.c.length).length, 0);

// the segment index that ends at node i (null for the first node of an open contour)
export const segIn = (k, i) => (i > 0 ? i - 1 : k.closed ? k.segs.length - 1 : null);
// the segment index that starts at node i (null for the last node of an open contour)
export const segOut = (k, i) => (i < k.segs.length ? i : null);
export const segEnds = (k, si) => [k.nodes[si], k.nodes[(si + 1) % k.nodes.length]];

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// a quadratic is exactly the cubic with handles 2/3 of the way to its control point
export function toCubic(k, si) {
  const s = k.segs[si], [p0, p1] = segEnds(k, si);
  if (s.c.length === 2) return;
  if (s.c.length === 1) s.c = [lerp(p0, s.c[0], 2 / 3), lerp(p1, s.c[0], 2 / 3)];
  else s.c = [[...p0], [...p1]];
}

// a cubic whose handles both sit on their nodes is a line
function tidy(k, si) {
  const s = k.segs[si], [p0, p1] = segEnds(k, si);
  if (s.c.length === 2 && same(s.c[0], p0) && same(s.c[1], p1)) s.c = [];
}
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

export function evalSeg(p0, c, p1, t) {
  const u = 1 - t;
  if (!c.length) return lerp(p0, p1, t);
  if (c.length === 1) return [u * u * p0[0] + 2 * u * t * c[0][0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[0][1] + t * t * p1[1]];
  const [a, b] = c;
  return [u * u * u * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p1[1]];
}

// the closest point on any segment to (x, y): {ci, si, t, dist, at}; `map` takes path coordinates
// to the space distances are measured in (screen pixels)
export function nearestSeg(cs, x, y, map = (p) => p) {
  let best = null;
  cs.forEach((k, ci) => k.segs.forEach((s, si) => {
    const [p0, p1] = segEnds(k, si);
    const N = s.c.length ? 48 : 1;
    let prev = map(p0);
    for (let j = 1; j <= N; j++) {
      const q = map(evalSeg(p0, s.c, p1, j / N));
      const dx = q[0] - prev[0], dy = q[1] - prev[1], L = dx * dx + dy * dy;
      const f = L ? Math.max(0, Math.min(1, ((x - prev[0]) * dx + (y - prev[1]) * dy) / L)) : 0;
      const dist = Math.hypot(prev[0] + dx * f - x, prev[1] + dy * f - y);
      if (!best || dist < best.dist) best = { ci, si, t: (j - 1 + f) / N, dist };
      prev = q;
    }
  }));
  return best;
}

// split segment si at t (de Casteljau, so the shape doesn't change); returns the new node's index
export function insertNode(k, si, t) {
  const s = k.segs[si], [p0, p1] = segEnds(k, si);
  let left, right, mid;
  if (!s.c.length) { mid = lerp(p0, p1, t); left = []; right = []; }
  else if (s.c.length === 1) {
    const a = lerp(p0, s.c[0], t), b = lerp(s.c[0], p1, t);
    mid = lerp(a, b, t); left = [a]; right = [b];
  } else {
    const [c1, c2] = s.c;
    const a = lerp(p0, c1, t), b = lerp(c1, c2, t), c = lerp(c2, p1, t), ab = lerp(a, b, t), bc = lerp(b, c, t);
    mid = lerp(ab, bc, t); left = [a, ab]; right = [bc, c];
  }
  k.nodes.splice(si + 1, 0, mid);
  k.segs.splice(si, 1, { c: left }, { c: right });
  return si + 1;
}

// remove nodes (indices into one contour); the two segments either side of a removed node become
// one, keeping the outer handles, so curves stay curves. Returns false when too few would be left.
export function removeNodes(k, indices) {
  const left = k.nodes.length - indices.length;
  if (left < (k.closed ? 3 : 2)) return false;
  for (const i of [...indices].sort((a, b) => b - a)) {
    const a = segIn(k, i), b = segOut(k, i);
    if (a === null) { k.nodes.splice(0, 1); k.segs.splice(0, 1); continue; } // open contour's first node
    if (b === null) { k.nodes.pop(); k.segs.pop(); continue; } // open contour's last node
    const sa = k.segs[a], sb = k.segs[b];
    let c = [];
    if (sa.c.length || sb.c.length) {
      toCubic(k, a); toCubic(k, b);
      c = [sa.c[0], sb.c[1]];
    }
    // the merged segment runs from the start of a to the end of b and takes a's place
    k.segs[a] = { c };
    k.segs.splice(b, 1);
    k.nodes.splice(i, 1);
    // node 0 of a closed contour: a was the last segment, and after the splice it still is
    const si = b < a ? k.segs.length - 1 : a;
    tidy(k, si);
  }
  return true;
}

// a node's handles: the control points that belong to it ({si, h} pairs). A cubic's c1 belongs to
// its start node and c2 to its end node; a quadratic's one control point belongs to both ends.
export function nodeHandles(k, i) {
  const out = [];
  const a = segIn(k, i), b = segOut(k, i);
  if (a !== null && k.segs[a].c.length) out.push({ si: a, h: k.segs[a].c.length - 1 });
  if (b !== null && k.segs[b].c.length) out.push({ si: b, h: 0 });
  return out;
}

export function isSmooth(k, i) {
  const node = k.nodes[i];
  return nodeHandles(k, i).some(({ si, h }) => !same(k.segs[si].c[h], node));
}

// Alt+click: a curved node becomes a sharp corner (its own handles pulled onto it), a corner
// becomes smooth (handles along the line between its neighbours, a third of each side long)
export function toggleSmooth(k, i, smooth = !isSmooth(k, i)) {
  const node = k.nodes[i];
  const a = segIn(k, i), b = segOut(k, i);
  if (!smooth) {
    if (a !== null) { toCubic(k, a); k.segs[a].c[1] = [...node]; tidy(k, a); }
    if (b !== null) { toCubic(k, b); k.segs[b].c[0] = [...node]; tidy(k, b); }
    return;
  }
  const prev = a !== null ? segEnds(k, a)[0] : node, next = b !== null ? segEnds(k, b)[1] : node;
  let dx = next[0] - prev[0], dy = next[1] - prev[1];
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  if (a !== null) { toCubic(k, a); const l = Math.hypot(node[0] - prev[0], node[1] - prev[1]) / 3; k.segs[a].c[1] = [node[0] - dx * l, node[1] - dy * l]; }
  if (b !== null) { toCubic(k, b); const l = Math.hypot(next[0] - node[0], next[1] - node[1]) / 3; k.segs[b].c[0] = [node[0] + dx * l, node[1] + dy * l]; }
}

// the handle on the other side of a node from handle (si, h), when both are cubic handles of that
// node and lie in a straight line through it (a smooth node): dragging one swings the other
export function oppositeHandle(k, si, h) {
  const s = k.segs[si];
  if (s.c.length !== 2) return null;
  const i = h === 0 ? si : (si + 1) % k.nodes.length;
  const other = h === 0 ? segIn(k, i) : segOut(k, i);
  if (other === null || k.segs[other].c.length !== 2) return null;
  const oh = h === 0 ? 1 : 0, node = k.nodes[i], p = s.c[h], q = k.segs[other].c[oh];
  const a1 = Math.atan2(p[1] - node[1], p[0] - node[0]), a2 = Math.atan2(q[1] - node[1], q[0] - node[0]);
  if (same(p, node) || same(q, node)) return null;
  const diff = Math.abs(((a1 - a2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return diff < 0.05 ? { si: other, h: oh, node: i } : null;
}

// move a set of nodes ({ci, i}) by (dx, dy), from a copy of the contours taken when the drag
// began: their own handles go with them; a quadratic's control point moves half as far when
// only one of its two ends moves
export function moveNodes(cs, from, picked, dx, dy) {
  const sel = new Set(picked.map(({ ci, i }) => ci + ':' + i));
  const on = (ci, i) => sel.has(ci + ':' + i);
  cs.forEach((k, ci) => {
    const f = from[ci];
    k.nodes.forEach((p, i) => { if (on(ci, i)) { p[0] = f.nodes[i][0] + dx; p[1] = f.nodes[i][1] + dy; } });
    k.segs.forEach((s, si) => {
      const e0 = on(ci, si), e1 = on(ci, (si + 1) % k.nodes.length);
      const fc = f.segs[si].c;
      if (s.c.length === 1) {
        const w = (e0 + e1) / 2;
        s.c[0] = [fc[0][0] + dx * w, fc[0][1] + dy * w];
      } else if (s.c.length === 2) {
        s.c[0] = e0 ? [fc[0][0] + dx, fc[0][1] + dy] : [...fc[0]];
        s.c[1] = e1 ? [fc[1][0] + dx, fc[1][1] + dy] : [...fc[1]];
      }
    });
  });
}

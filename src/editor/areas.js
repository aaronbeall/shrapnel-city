// Kit area lists on the map: named lists of rectangles or polygons in level.json art.<name>,
// declared per kit in tools/art/kits.json (e.g. the city kit's "paved"). The bake reads them;
// here they're drawn over the map and edited by hand when one is picked in the Art tab.
//
// Rect lists hold [x0, y0, x1, y1]; polygon lists hold [[x, y], ...].
//   rect:    drag on empty floor to draw one, drag one to move it, drag a corner to resize
//   polygon: click corners on empty floor, click the first one or Enter to close; drag one to
//            move it, drag a corner to move the corner, Alt+click a corner to remove it
// Click one to select it; Delete removes it, Esc lets go. Shift snaps to the grid.

const HANDLE = 6; // screen px

export const areaMethods = {
  // the kits schema (tools/art/kits.json), loaded once; null until it arrives
  kitSchema() {
    if (!this.kits) {
      this.kits = fetch('tools/art/kits.json', { cache: 'no-store' }).then((r) => r.json())
        .then((j) => { this.kits = j; this.refreshPanel(); })
        .catch((e) => { this.kits = {}; this.status('Kits: ' + e.message, true); });
    }
    return this.kits instanceof Promise ? null : this.kits;
  },

  // the area list being edited: {key, spec, list} or null
  areaEditing() {
    const art = this.L.settings && this.L.settings.art, kits = this.kitSchema();
    if (!this.areaEdit || !art || !kits) return null;
    const spec = ((kits[art.kit] || {}).areas || {})[this.areaEdit];
    if (!spec) return null;
    return { key: this.areaEdit, spec, list: Array.isArray(art[this.areaEdit]) ? art[this.areaEdit] : [] };
  },

  setAreaEdit(key) {
    this.areaEdit = key;
    this.areaSel = null;
    this.areaPoly = null;
    this.refreshPanel();
  },

  // replace the list (with undo unless it's mid-drag)
  writeAreas(key, list, undo = true) {
    const apply = () => {
      const art = { ...this.L.settings.art };
      if (list.length) art[key] = list; else delete art[key];
      this.L.settings = { ...this.L.settings, art };
    };
    if (undo) this.change(['level.json'], apply, { reload: false });
    else apply();
  },

  areaShape(spec, a) {
    return spec.shape === 'polygon' ? a : [[a[0], a[1]], [a[2], a[1]], [a[2], a[3]], [a[0], a[3]]];
  },

  // what's under a world point: {i, corner} (a corner handle) or {i} (inside), topmost first
  areaAt(ed, x, y) {
    const r = HANDLE / this.view.z;
    const order = ed.list.map((_, i) => i).reverse();
    if (this.areaSel != null && ed.list[this.areaSel]) order.unshift(this.areaSel);
    for (const i of order) {
      const pts = this.areaShape(ed.spec, ed.list[i]);
      const c = pts.findIndex(([px, py]) => Math.abs(px - x) <= r && Math.abs(py - y) <= r);
      if (c >= 0) return { i, corner: c };
    }
    for (const i of order) if (inside(this.areaShape(ed.spec, ed.list[i]), x, y)) return { i };
    return null;
  },

  // true when the click was taken by the area list being edited
  areaMouseDown(e, x, y) {
    const ed = this.areaEditing();
    if (!ed) return false;
    const [sx, sy] = this.snap(x, y, e.shiftKey).map(Math.round);
    const poly = ed.spec.shape === 'polygon';
    if (this.areaPoly) { // a polygon in progress takes every click
      const first = this.areaPoly[0];
      if (this.areaPoly.length > 2 && Math.hypot(first[0] - x, first[1] - y) * this.view.z < 10) this.closeAreaPoly();
      else this.areaPoly.push([sx, sy]);
      return true;
    }
    const h = this.areaAt(ed, x, y);
    const before = this.snapshot();
    if (h && h.corner != null && poly && e.altKey) {
      const pts = ed.list[h.i];
      if (pts.length > 3) this.writeAreas(ed.key, ed.list.map((a, i) => (i === h.i ? a.filter((_, c) => c !== h.corner) : a)));
      else this.status('A polygon needs 3 corners; Delete removes the whole polygon.', true);
      return true;
    }
    if (h) {
      this.areaSel = h.i;
      this.drag = { kind: 'area', key: ed.key, spec: ed.spec, i: h.i, corner: h.corner, x, y, from: structuredClone(ed.list[h.i]), before, moved: false };
      this.refreshPanel();
      return true;
    }
    this.areaSel = null;
    if (poly) this.areaPoly = [[sx, sy]];
    else this.drag = { kind: 'areaNew', key: ed.key, x0: sx, y0: sy, x1: sx, y1: sy };
    this.refreshPanel();
    return true;
  },

  areaMouseMove(e, x, y) {
    const d = this.drag;
    if (!d || (d.kind !== 'area' && d.kind !== 'areaNew')) return false;
    if (d.kind === 'areaNew') { [d.x1, d.y1] = this.snap(x, y, e.shiftKey).map(Math.round); return true; }
    if (!d.moved && Math.hypot(x - d.x, y - d.y) * this.view.z < 2) return true; // a click, not a drag
    d.moved = true;
    const ed = this.areaEditing();
    if (!ed) return true;
    const list = ed.list.slice(), a = structuredClone(d.from);
    if (d.corner == null) { // move: the shape's first corner snaps
      const p0 = d.spec.shape === 'polygon' ? a[0] : [a[0], a[1]];
      const [nx, ny] = this.snap(p0[0] + x - d.x, p0[1] + y - d.y, e.shiftKey);
      const dx = Math.round(nx - p0[0]), dy = Math.round(ny - p0[1]);
      if (d.spec.shape === 'polygon') for (const p of a) { p[0] += dx; p[1] += dy; }
      else { a[0] += dx; a[2] += dx; a[1] += dy; a[3] += dy; }
    } else {
      const [nx, ny] = this.snap(x, y, e.shiftKey).map(Math.round);
      if (d.spec.shape === 'polygon') a[d.corner] = [nx, ny];
      else { // corners go round from the top left: 0 (x0, y0), 1 (x1, y0), 2 (x1, y1), 3 (x0, y1)
        if (d.corner === 0 || d.corner === 3) a[0] = nx; else a[2] = nx;
        if (d.corner === 0 || d.corner === 1) a[1] = ny; else a[3] = ny;
      }
    }
    list[d.i] = a;
    this.writeAreas(d.key, list, false);
    return true;
  },

  areaMouseUp(d) {
    if (d.kind === 'areaNew') {
      const ax = Math.min(d.x0, d.x1), bx = Math.max(d.x0, d.x1), ay = Math.min(d.y0, d.y1), by = Math.max(d.y0, d.y1);
      const ed = this.areaEditing();
      if (ed && bx - ax >= 2 && by - ay >= 2) {
        this.writeAreas(d.key, [...ed.list, [ax, ay, bx, by]]);
        this.areaSel = ed.list.length;
        this.refreshPanel();
      }
      return true;
    }
    if (d.kind !== 'area') return false;
    if (d.moved) {
      const ed = this.areaEditing();
      if (ed && d.spec.shape !== 'polygon') { // keep x0 < x1, y0 < y1
        const a = ed.list[d.i];
        ed.list[d.i] = [Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3])];
      }
      this.pushUndo({ type: 'data', level: this.index, before: d.before, after: this.snapshot(), files: ['level.json'] });
      this.markDirty('level.json');
      this.needsReload = true;
    }
    this.refreshPanel();
    return true;
  },

  closeAreaPoly() {
    const ed = this.areaEditing(), pts = this.areaPoly;
    this.areaPoly = null;
    if (ed && pts && pts.length > 2) {
      this.writeAreas(ed.key, [...ed.list, pts]);
      this.areaSel = ed.list.length;
    }
    this.refreshPanel();
  },

  // Delete, Esc and Enter while an area list is being edited; true when taken
  areaKey(e) {
    const ed = this.areaEditing();
    if (!ed) return false;
    if (e.key === 'Escape') {
      if (this.areaPoly) this.areaPoly = null;
      else if (this.areaSel != null) this.areaSel = null;
      else { this.setAreaEdit(null); return true; }
      this.refreshPanel();
      return true;
    }
    if (e.key === 'Enter' && this.areaPoly) { this.closeAreaPoly(); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.areaPoly) { this.areaPoly.pop(); if (!this.areaPoly.length) this.areaPoly = null; return true; }
      if (this.areaSel != null && ed.list[this.areaSel]) {
        this.writeAreas(ed.key, ed.list.filter((_, i) => i !== this.areaSel));
        this.areaSel = null;
        this.refreshPanel();
        return true;
      }
    }
    return false;
  },

  // number boxes for the selected rectangle (the panel's el helper passed in)
  areaRows(el, art) {
    const ed = this.areaEditing();
    if (!ed || this.areaSel == null || !ed.list[this.areaSel] || ed.spec.shape === 'polygon') return '';
    const a = ed.list[this.areaSel];
    const set = (j, v) => {
      if (!isFinite(v)) return;
      const b = a.slice(); b[j] = Math.round(v);
      const r = [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
      this.writeAreas(ed.key, ed.list.map((x, i) => (i === this.areaSel ? r : x)));
    };
    return el('div', { class: 'le-row' }, `${ed.spec.label || ed.key} ${this.areaSel + 1}: `,
      ...['x0', 'y0', 'x1', 'y1'].map((n, j) => el('label', {}, ` ${n} `, el('input', { type: 'number', step: 1, value: a[j], style: 'width: 4.5em', onchange: (ev) => set(j, +ev.target.value) }))));
  },

  drawAreas(ctx, px) {
    const ed = this.areaEditing();
    if (!ed) return;
    const col = ed.spec.colour || '#e0b040';
    const path = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    ctx.save();
    ed.list.forEach((a, i) => {
      const pts = this.areaShape(ed.spec, a), sel = i === this.areaSel;
      path(pts);
      ctx.globalAlpha = sel ? 0.3 : 0.18; ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash(sel ? [] : [6 * px, 4 * px]);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = (sel ? 4 : 3) * px; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = (sel ? 2 : 1.5) * px; ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of pts) {
        const r = (sel ? 4 : 3) * px;
        ctx.fillStyle = sel ? '#fff' : col; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        ctx.strokeStyle = '#000'; ctx.lineWidth = px; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
      }
      ctx.fillStyle = '#fff'; ctx.font = `${12 * px}px sans-serif`;
      ctx.fillText(`${ed.spec.label || ed.key} ${i + 1}`, pts[0][0] + 5 * px, pts[0][1] + 14 * px);
    });
    const d = this.drag;
    if (d && d.kind === 'areaNew') {
      ctx.globalAlpha = 0.3; ctx.fillStyle = col;
      ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = px;
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      this.hint(`${Math.abs(d.x1 - d.x0)} × ${Math.abs(d.y1 - d.y0)}`);
    } else if (d && d.kind === 'area' && d.moved) {
      const a = ed.list[d.i];
      if (ed.spec.shape !== 'polygon') this.hint(`${Math.min(a[0], a[2])}, ${Math.min(a[1], a[3])}  ${Math.abs(a[2] - a[0])} × ${Math.abs(a[3] - a[1])}`);
    }
    if (this.areaPoly) {
      const m = this.mouse;
      path([...this.areaPoly, [m.x, m.y]]);
      ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = px; ctx.stroke();
      for (const [x, y] of this.areaPoly) ctx.strokeRect(x - 3 * px, y - 3 * px, 6 * px, 6 * px);
    }
    ctx.restore();
  },
};

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

#!/usr/bin/env python3
"""
SWF -> JSON/PNG asset extractor for the Shrapnel City browser port.

Parses the compiled v14 SWF and emits:
  assets/swf.json         every character (shapes, morph shapes, sprites, text,
                          fonts, buttons, bitmaps) plus the root timeline
  assets/bitmaps/<id>.png decoded bitmaps (lossless + JPEG, alpha merged)

Shapes are converted from Flash's edge representation (each edge carries a
left/right fill style) into closed per-fill contours so they can be drawn
directly with Canvas2D Path2D.  Coordinates are emitted in pixels (twips/20).

Usage: python3 tools/swf2json.py path/to/shrapnel.swf assets/
"""
import io
import json
import os
import struct
import sys
import zlib

from PIL import Image

TW = 20.0  # twips per pixel


# --------------------------------------------------------------------------
# bit reader
# --------------------------------------------------------------------------
class Bits:
    def __init__(self, data, pos=0):
        self.d = data
        self.p = pos      # byte position
        self.b = 0        # bit buffer
        self.n = 0        # bits in buffer

    def align(self):
        self.n = 0
        self.b = 0

    def ub(self, n):
        v = 0
        for _ in range(n):
            if self.n == 0:
                self.b = self.d[self.p]
                self.p += 1
                self.n = 8
            self.n -= 1
            v = (v << 1) | ((self.b >> self.n) & 1)
        return v

    def sb(self, n):
        if n == 0:
            return 0
        v = self.ub(n)
        if v & (1 << (n - 1)):
            v -= 1 << n
        return v

    def fb(self, n):
        return self.sb(n) / 65536.0

    def u8(self):
        self.align()
        v = self.d[self.p]
        self.p += 1
        return v

    def u16(self):
        self.align()
        v = struct.unpack_from('<H', self.d, self.p)[0]
        self.p += 2
        return v

    def s16(self):
        self.align()
        v = struct.unpack_from('<h', self.d, self.p)[0]
        self.p += 2
        return v

    def u32(self):
        self.align()
        v = struct.unpack_from('<I', self.d, self.p)[0]
        self.p += 4
        return v

    def fixed(self):  # 16.16
        self.align()
        v = struct.unpack_from('<i', self.d, self.p)[0] / 65536.0
        self.p += 4
        return v

    def fixed8(self):  # 8.8
        self.align()
        v = struct.unpack_from('<h', self.d, self.p)[0] / 256.0
        self.p += 2
        return v

    def f32(self):
        self.align()
        v = struct.unpack_from('<f', self.d, self.p)[0]
        self.p += 4
        return v

    def string(self):
        self.align()
        e = self.d.index(b'\0', self.p)
        s = self.d[self.p:e]
        self.p = e + 1
        try:
            return s.decode('utf-8')
        except UnicodeDecodeError:
            return s.decode('latin-1')

    def bytes(self, n):
        self.align()
        v = self.d[self.p:self.p + n]
        self.p += n
        return v

    def rect(self):
        self.align()
        n = self.ub(5)
        r = [self.sb(n) / TW for _ in range(4)]  # xmin xmax ymin ymax
        self.align()
        return r

    def rgb(self):
        self.align()
        r, g, b = self.d[self.p:self.p + 3]
        self.p += 3
        return [r, g, b, 255]

    def rgba(self):
        self.align()
        r, g, b, a = self.d[self.p:self.p + 4]
        self.p += 4
        return [r, g, b, a]

    def argb(self):
        self.align()
        a, r, g, b = self.d[self.p:self.p + 4]
        self.p += 4
        return [r, g, b, a]

    def matrix(self):
        self.align()
        a = d = 1.0
        b = c = 0.0
        if self.ub(1):
            n = self.ub(5)
            a = self.fb(n)
            d = self.fb(n)
        if self.ub(1):
            n = self.ub(5)
            b = self.fb(n)
            c = self.fb(n)
        n = self.ub(5)
        tx = self.sb(n) / TW
        ty = self.sb(n) / TW
        self.align()
        return [round(a, 6), round(b, 6), round(c, 6), round(d, 6), round(tx, 3), round(ty, 3)]

    def cxform(self, alpha):
        self.align()
        has_add = self.ub(1)
        has_mult = self.ub(1)
        n = self.ub(4)
        mult = [1.0, 1.0, 1.0, 1.0]
        add = [0, 0, 0, 0]
        cnt = 4 if alpha else 3
        if has_mult:
            for i in range(cnt):
                mult[i] = self.sb(n) / 256.0
        if has_add:
            for i in range(cnt):
                add[i] = self.sb(n)
        self.align()
        return mult + add


# --------------------------------------------------------------------------
# styles
# --------------------------------------------------------------------------
def read_gradient(r, shape_ver, focal):
    r.align()
    spread = r.ub(2)
    interp = r.ub(2)
    num = r.ub(4)
    stops = []
    for _ in range(num):
        ratio = r.u8()
        col = r.rgba() if shape_ver >= 3 else r.rgb()
        stops.append([ratio / 255.0] + col)
    g = {'spread': spread, 'interp': interp, 'stops': stops}
    if focal:
        g['focal'] = r.fixed8()
    return g


def read_fill(r, ver):
    t = r.u8()
    f = {'t': t}
    if t == 0x00:
        f['c'] = r.rgba() if ver >= 3 else r.rgb()
    elif t in (0x10, 0x12, 0x13):
        m = r.matrix()
        f['m'] = gradient_matrix(m)
        f.update(read_gradient(r, ver, t == 0x13))
    elif t in (0x40, 0x41, 0x42, 0x43):
        f['bitmap'] = r.u16()
        m = r.matrix()
        # bitmap matrix maps bitmap pixels to twips; convert to px space
        f['m'] = [m[0] / TW, m[1] / TW, m[2] / TW, m[3] / TW, m[4], m[5]]
        f['repeat'] = t in (0x40, 0x42)
        f['smooth'] = t in (0x40, 0x41)
    else:
        raise ValueError('unknown fill type %x' % t)
    return f


def gradient_matrix(m):
    # gradient square is -16384..16384 twips; we normalise the gradient space to
    # -1..1 and emit a matrix mapping that unit space into pixel space
    k = 16384.0 / TW
    return [m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4], m[5]]


def read_fill_array(r, ver):
    n = r.u8()
    if n == 0xFF and ver >= 2:
        n = r.u16()
    return [read_fill(r, ver) for _ in range(n)]


def read_line(r, ver):
    if ver == 4:
        w = r.u16() / TW
        r.align()
        start_cap = r.ub(2)
        join = r.ub(2)
        has_fill = r.ub(1)
        no_h = r.ub(1)
        no_v = r.ub(1)
        hint = r.ub(1)
        r.ub(5)
        no_close = r.ub(1)
        end_cap = r.ub(2)
        ls = {'w': w, 'cap': start_cap, 'ecap': end_cap, 'join': join,
              'noScale': bool(no_h or no_v), 'noClose': bool(no_close)}
        if join == 2:
            ls['miter'] = r.fixed8()
        if has_fill:
            ls['fill'] = read_fill(r, ver)
            if ls['fill']['t'] == 0:
                ls['c'] = ls['fill']['c']
        else:
            ls['c'] = r.rgba()
        return ls
    w = r.u16() / TW
    c = r.rgba() if ver >= 3 else r.rgb()
    return {'w': w, 'c': c, 'cap': 0, 'ecap': 0, 'join': 0}


def read_line_array(r, ver):
    n = r.u8()
    if n == 0xFF:
        n = r.u16()
    return [read_line(r, ver) for _ in range(n)]


# --------------------------------------------------------------------------
# shape records
# --------------------------------------------------------------------------
def read_shape_records(r, ver, fills, lines, nfb=None, nlb=None, morph=False):
    """Return list of records. Style indices are made global (into fills/lines
    lists, which are extended on NewStyles)."""
    r.align()
    if nfb is None:
        nfb = r.ub(4)
        nlb = r.ub(4)
    recs = []
    fill_base = 0
    line_base = 0
    x = y = 0
    while True:
        if r.ub(1) == 0:
            flags = r.ub(5)
            if flags == 0:
                break
            rec = {'k': 'style'}
            if flags & 1:
                n = r.ub(5)
                x = r.sb(n)
                y = r.sb(n)
                rec['move'] = (x, y)
            if flags & 2:
                v = r.ub(nfb)
                rec['f0'] = (v + fill_base - 1) if v else -1
            if flags & 4:
                v = r.ub(nfb)
                rec['f1'] = (v + fill_base - 1) if v else -1
            if flags & 8:
                v = r.ub(nlb)
                rec['l'] = (v + line_base - 1) if v else -1
            if flags & 16 and ver >= 2:
                fill_base = len(fills)
                line_base = len(lines)
                fills.extend(read_fill_array(r, ver))
                lines.extend(read_line_array(r, ver))
                r.align()
                nfb = r.ub(4)
                nlb = r.ub(4)
                rec['newstyles'] = True
            recs.append(rec)
        else:
            if r.ub(1):  # straight
                n = r.ub(4) + 2
                if r.ub(1):
                    dx = r.sb(n)
                    dy = r.sb(n)
                elif r.ub(1):
                    dx = 0
                    dy = r.sb(n)
                else:
                    dx = r.sb(n)
                    dy = 0
                recs.append({'k': 'line', 'd': (dx, dy)})
            else:
                n = r.ub(4) + 2
                cdx = r.sb(n)
                cdy = r.sb(n)
                adx = r.sb(n)
                ady = r.sb(n)
                recs.append({'k': 'curve', 'c': (cdx, cdy), 'a': (adx, ady)})
    return recs


def edges_from_records(recs):
    """Walk records -> list of groups; each group: list of edges
    (x0,y0,cx,cy,x1,y1,f0,f1,l) in twips (cx=None for straight)."""
    groups = [[]]
    x = y = 0
    f0 = f1 = l = -1
    for rec in recs:
        k = rec['k']
        if k == 'style':
            if rec.get('newstyles'):
                groups.append([])
                f0 = f1 = l = -1
            if 'move' in rec:
                x, y = rec['move']
            if 'f0' in rec:
                f0 = rec['f0']
            if 'f1' in rec:
                f1 = rec['f1']
            if 'l' in rec:
                l = rec['l']
        elif k == 'line':
            nx, ny = x + rec['d'][0], y + rec['d'][1]
            groups[-1].append((x, y, None, None, nx, ny, f0, f1, l))
            x, y = nx, ny
        else:
            cx, cy = x + rec['c'][0], y + rec['c'][1]
            nx, ny = cx + rec['a'][0], cy + rec['a'][1]
            groups[-1].append((x, y, cx, cy, nx, ny, f0, f1, l))
            x, y = nx, ny
    return groups


def link_contours(segs):
    """segs: list of (x0,y0,cx,cy,x1,y1,payload). Link into closed (or open)
    chains by matching endpoints. Returns list of chains (list of segs)."""
    from collections import defaultdict
    starts = defaultdict(list)
    for i, s in enumerate(segs):
        starts[(s[0], s[1])].append(i)
    used = [False] * len(segs)
    chains = []
    for i in range(len(segs)):
        if used[i]:
            continue
        chain = [segs[i]]
        used[i] = True
        sx, sy = segs[i][0], segs[i][1]
        ex, ey = segs[i][4], segs[i][5]
        while (ex, ey) != (sx, sy):
            nxt = None
            for j in starts.get((ex, ey), ()):
                if not used[j]:
                    nxt = j
                    break
            if nxt is None:
                break
            used[nxt] = True
            chain.append(segs[nxt])
            ex, ey = segs[nxt][4], segs[nxt][5]
        chains.append(chain)
    return chains


def fmt(v):
    v = round(v / TW, 2)
    return int(v) if v == int(v) else v


def chains_to_cmds(chains, idx=0):
    """Convert chains to compact command arrays.
    'M',x,y  'L',x,y  'Q',cx,cy,x,y  ('Z' closes)."""
    out = []
    for ch in chains:
        s = ch[0]
        out += ['M', fmt(s[idx + 0]), fmt(s[idx + 1])]
        for e in ch:
            if e[idx + 2] is None:
                out += ['L', fmt(e[idx + 4]), fmt(e[idx + 5])]
            else:
                out += ['Q', fmt(e[idx + 2]), fmt(e[idx + 3]), fmt(e[idx + 4]), fmt(e[idx + 5])]
        if (ch[-1][idx + 4], ch[-1][idx + 5]) == (s[idx + 0], s[idx + 1]):
            out.append('Z')
    return out


def build_paths(groups):
    """groups of edges -> list of path entries {f:idx,d:cmds} / {l:idx,d:cmds}"""
    paths = []
    for g in groups:
        fills = {}
        lines = {}
        for (x0, y0, cx, cy, x1, y1, f0, f1, l) in g:
            if f1 >= 0:
                fills.setdefault(f1, []).append((x0, y0, cx, cy, x1, y1))
            if f0 >= 0:
                fills.setdefault(f0, []).append((x1, y1, cx, cy, x0, y0))
            if l >= 0:
                lines.setdefault(l, []).append((x0, y0, cx, cy, x1, y1))
        for fi in sorted(fills):
            paths.append({'f': fi, 'd': chains_to_cmds(link_contours(fills[fi]))})
        for li in sorted(lines):
            paths.append({'l': li, 'd': chains_to_cmds(link_lines(lines[li]))})
    return paths


def link_lines(segs):
    # keep drawing order, but join consecutive segments into polylines
    chains = []
    for s in segs:
        if chains and (chains[-1][-1][4], chains[-1][-1][5]) == (s[0], s[1]):
            chains[-1].append(s)
        else:
            chains.append([s])
    return chains


# ---- morph shapes -----------------------------------------------------------
def morph_edges(srecs, erecs):
    """pair start/end records -> group list of edges with both coordinate sets:
    (x0,y0,cx,cy,x1,y1, X0,Y0,CX,CY,X1,Y1, f0,f1,l)"""
    edges = []
    ei = 0
    x = y = 0
    X = Y = 0
    f0 = f1 = l = -1
    for rec in srecs:
        k = rec['k']
        if k == 'style':
            if 'move' in rec:
                x, y = rec['move']
            if 'f0' in rec:
                f0 = rec['f0']
            if 'f1' in rec:
                f1 = rec['f1']
            if 'l' in rec:
                l = rec['l']
            # consume matching end style record
            if ei < len(erecs) and erecs[ei]['k'] == 'style':
                if 'move' in erecs[ei]:
                    X, Y = erecs[ei]['move']
                ei += 1
            continue
        # edge: find next end edge
        while ei < len(erecs) and erecs[ei]['k'] == 'style':
            if 'move' in erecs[ei]:
                X, Y = erecs[ei]['move']
            ei += 1
        er = erecs[ei] if ei < len(erecs) else {'k': 'line', 'd': (0, 0)}
        ei += 1
        # start edge
        if k == 'line':
            nx, ny = x + rec['d'][0], y + rec['d'][1]
            cx, cy = (x + nx) / 2.0, (y + ny) / 2.0
        else:
            cx, cy = x + rec['c'][0], y + rec['c'][1]
            nx, ny = cx + rec['a'][0], cy + rec['a'][1]
        if er['k'] == 'line':
            NX, NY = X + er['d'][0], Y + er['d'][1]
            CX, CY = (X + NX) / 2.0, (Y + NY) / 2.0
        else:
            CX, CY = X + er['c'][0], Y + er['c'][1]
            NX, NY = CX + er['a'][0], CY + er['a'][1]
        edges.append((x, y, cx, cy, nx, ny, X, Y, CX, CY, NX, NY, f0, f1, l))
        x, y = nx, ny
        X, Y = NX, NY
    return edges


def link_morph(segs):
    """segs: tuples of 12 coords (start 6 + end 6). link on start coords."""
    from collections import defaultdict
    starts = defaultdict(list)
    for i, s in enumerate(segs):
        starts[(s[0], s[1])].append(i)
    used = [False] * len(segs)
    chains = []
    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        chain = [segs[i]]
        sx, sy = segs[i][0], segs[i][1]
        ex, ey = segs[i][4], segs[i][5]
        while (ex, ey) != (sx, sy):
            nxt = None
            for j in starts.get((ex, ey), ()):
                if not used[j]:
                    nxt = j
                    break
            if nxt is None:
                break
            used[nxt] = True
            chain.append(segs[nxt])
            ex, ey = segs[nxt][4], segs[nxt][5]
        chains.append(chain)
    return chains


def morph_cmds(chains):
    """Morph commands: every segment is a quad.  Format:
    ['M', x,y,X,Y, 'Q', cx,cy,x,y, CX,CY,X,Y, ..., 'Z']"""
    out = []
    for ch in chains:
        s = ch[0]
        out += ['M', fmt(s[0]), fmt(s[1]), fmt(s[6]), fmt(s[7])]
        for e in ch:
            out += ['Q', fmt(e[2]), fmt(e[3]), fmt(e[4]), fmt(e[5]),
                    fmt(e[8]), fmt(e[9]), fmt(e[10]), fmt(e[11])]
        if (ch[-1][4], ch[-1][5]) == (s[0], s[1]):
            out.append('Z')
    return out


def morph_paths(edges):
    fills = {}
    lines = {}
    for e in edges:
        f0, f1, l = e[12], e[13], e[14]
        st = e[0:6]
        en = e[6:12]
        if f1 >= 0:
            fills.setdefault(f1, []).append(st + en)
        if f0 >= 0:
            rs = (st[4], st[5], st[2], st[3], st[0], st[1])
            re_ = (en[4], en[5], en[2], en[3], en[0], en[1])
            fills.setdefault(f0, []).append(rs + re_)
        if l >= 0:
            lines.setdefault(l, []).append(st + en)
    paths = []
    for fi in sorted(fills):
        paths.append({'f': fi, 'd': morph_cmds(link_morph(fills[fi]))})
    for li in sorted(lines):
        segs = lines[li]
        chains = []
        for s in segs:
            if chains and (chains[-1][-1][4], chains[-1][-1][5]) == (s[0], s[1]):
                chains[-1].append(s)
            else:
                chains.append([s])
        paths.append({'l': li, 'd': morph_cmds(chains)})
    return paths


def read_morph_fill(r):
    t = r.u8()
    f = {'t': t}
    if t == 0:
        f['c'] = r.rgba()
        f['c1'] = r.rgba()
    elif t in (0x10, 0x12, 0x13):
        f['m'] = gradient_matrix(r.matrix())
        f['m1'] = gradient_matrix(r.matrix())
        r.align()
        b = r.u8()
        num = b & 0xF
        f['spread'] = (b >> 6) & 3
        f['interp'] = (b >> 4) & 3
        s0 = []
        s1 = []
        for _ in range(num):
            ra = r.u8()
            ca = r.rgba()
            rb = r.u8()
            cb = r.rgba()
            s0.append([ra / 255.0] + ca)
            s1.append([rb / 255.0] + cb)
        f['stops'] = s0
        f['stops1'] = s1
        if t == 0x13:
            f['focal'] = r.fixed8()
            f['focal1'] = r.fixed8()
    elif t in (0x40, 0x41, 0x42, 0x43):
        f['bitmap'] = r.u16()
        m0 = r.matrix()
        m1 = r.matrix()
        f['m'] = [m0[0] / TW, m0[1] / TW, m0[2] / TW, m0[3] / TW, m0[4], m0[5]]
        f['m1'] = [m1[0] / TW, m1[1] / TW, m1[2] / TW, m1[3] / TW, m1[4], m1[5]]
        f['repeat'] = t in (0x40, 0x42)
        f['smooth'] = t in (0x40, 0x41)
    return f


def read_morph_line(r, ver):
    if ver == 2:
        w0 = r.u16() / TW
        w1 = r.u16() / TW
        r.align()
        sc = r.ub(2)
        join = r.ub(2)
        has_fill = r.ub(1)
        r.ub(3)
        r.ub(5)
        r.ub(1)
        ec = r.ub(2)
        ls = {'w': w0, 'w1': w1, 'cap': sc, 'ecap': ec, 'join': join}
        if join == 2:
            ls['miter'] = r.fixed8()
        if has_fill:
            mf = read_morph_fill(r)
            ls['c'] = mf.get('c', [0, 0, 0, 255])
            ls['c1'] = mf.get('c1', ls['c'])
        else:
            ls['c'] = r.rgba()
            ls['c1'] = r.rgba()
        return ls
    w0 = r.u16() / TW
    w1 = r.u16() / TW
    c0 = r.rgba()
    c1 = r.rgba()
    return {'w': w0, 'w1': w1, 'c': c0, 'c1': c1, 'cap': 0, 'ecap': 0, 'join': 0}


# --------------------------------------------------------------------------
# filters / misc
# --------------------------------------------------------------------------
def read_filters(r):
    n = r.u8()
    out = []
    for _ in range(n):
        fid = r.u8()
        if fid == 0:  # drop shadow
            c = r.rgba()
            bx = r.fixed()
            by = r.fixed()
            ang = r.fixed()
            dist = r.fixed()
            st = r.fixed8()
            fl = r.u8()
            out.append({'type': 'dropShadow', 'color': c, 'blurX': bx, 'blurY': by,
                        'angle': ang, 'distance': dist, 'strength': st,
                        'inner': bool(fl & 0x80), 'knockout': bool(fl & 0x40),
                        'passes': fl & 0x1F})
        elif fid == 1:  # blur
            bx = r.fixed()
            by = r.fixed()
            fl = r.u8()
            out.append({'type': 'blur', 'blurX': bx, 'blurY': by, 'passes': fl >> 3})
        elif fid == 2:  # glow
            c = r.rgba()
            bx = r.fixed()
            by = r.fixed()
            st = r.fixed8()
            fl = r.u8()
            out.append({'type': 'glow', 'color': c, 'blurX': bx, 'blurY': by, 'strength': st,
                        'inner': bool(fl & 0x80), 'knockout': bool(fl & 0x40),
                        'passes': fl & 0x1F})
        elif fid == 3:  # bevel
            # the SWF spec lists shadow first, but Flash actually writes the highlight colour first
            hc = r.rgba()
            sc = r.rgba()
            bx = r.fixed()
            by = r.fixed()
            ang = r.fixed()
            dist = r.fixed()
            st = r.fixed8()
            fl = r.u8()
            out.append({'type': 'bevel', 'shadow': sc, 'highlight': hc, 'blurX': bx, 'blurY': by,
                        'angle': ang, 'distance': dist, 'strength': st,
                        'inner': bool(fl & 0x80), 'knockout': bool(fl & 0x40),
                        'onTop': bool(fl & 0x10), 'passes': fl & 0x0F})
        elif fid in (4, 7):  # gradient glow / bevel
            nc = r.u8()
            cols = [r.rgba() for _ in range(nc)]
            ratios = [r.u8() for _ in range(nc)]
            bx = r.fixed()
            by = r.fixed()
            ang = r.fixed()
            dist = r.fixed()
            st = r.fixed8()
            fl = r.u8()
            out.append({'type': 'gradientGlow' if fid == 4 else 'gradientBevel',
                        'colors': cols, 'ratios': ratios, 'blurX': bx, 'blurY': by,
                        'angle': ang, 'distance': dist, 'strength': st})
        elif fid == 5:  # convolution
            mx = r.u8()
            my = r.u8()
            r.f32()
            r.f32()
            for _ in range(mx * my):
                r.f32()
            r.rgba()
            r.u8()
            out.append({'type': 'convolution'})
        elif fid == 6:  # color matrix
            m = [r.f32() for _ in range(20)]
            out.append({'type': 'colorMatrix', 'matrix': m})
        else:
            raise ValueError('filter %d' % fid)
    return out


BLEND = {0: 'normal', 1: 'normal', 2: 'layer', 3: 'multiply', 4: 'screen', 5: 'lighten',
         6: 'darken', 7: 'difference', 8: 'add', 9: 'subtract', 10: 'invert', 11: 'alpha',
         12: 'erase', 13: 'overlay', 14: 'hardlight'}


def read_clip_actions(r, swf_ver):
    """Skip clip actions, returning list of event flag ints."""
    r.u16()
    r.u32() if swf_ver >= 6 else r.u16()
    events = []
    while True:
        flags = r.u32() if swf_ver >= 6 else r.u16()
        if flags == 0:
            break
        size = r.u32()
        r.p += size
        events.append(flags)
    return events


# --------------------------------------------------------------------------
# main parser
# --------------------------------------------------------------------------
class SWF:
    def __init__(self, path, outdir):
        raw = open(path, 'rb').read()
        sig = raw[:3]
        self.version = raw[3]
        if sig == b'CWS':
            body = zlib.decompress(raw[8:])
        elif sig == b'FWS':
            body = raw[8:]
        else:
            raise ValueError('unsupported swf ' + str(sig))
        self.body = body
        self.outdir = outdir
        os.makedirs(os.path.join(outdir, 'bitmaps'), exist_ok=True)
        r = Bits(body)
        self.stage = r.rect()
        r.align()
        self.frame_rate = r.u16() / 256.0
        self.frame_count = r.u16()
        self.chars = {}
        self.exports = {}
        self.jpeg_tables = None
        self.bg = [0, 0, 0, 255]
        self.scale9 = {}
        self.font_names = {}
        self.root = self.parse_timeline(r.p, len(body), root=True)

    def tags(self, p, end):
        b = self.body
        while p < end:
            h = struct.unpack_from('<H', b, p)[0]
            p += 2
            code = h >> 6
            ln = h & 0x3F
            if ln == 0x3F:
                ln = struct.unpack_from('<I', b, p)[0]
                p += 4
            yield code, p, ln
            p += ln
            if code == 0:
                return

    def parse_timeline(self, p, end, root=False):
        frames = [[]]
        labels = {}
        scripts = []  # frames with DoAction (0-based)
        for code, tp, ln in self.tags(p, end):
            r = Bits(self.body, tp)
            if code == 1:  # ShowFrame
                frames.append([])
            elif code == 0:
                break
            elif code in (4, 26, 70):
                frames[-1].append(self.place(code, r, tp + ln))
            elif code in (5, 28):
                if code == 5:
                    r.u16()
                frames[-1].append({'op': 'remove', 'depth': r.u16()})
            elif code == 43:
                labels[r.string()] = len(frames) - 1
            elif code == 12:
                scripts.append(len(frames) - 1)
            elif root or code in ():
                self.define(code, r, tp, ln)
            else:
                # definition tags only appear in root
                pass
        if not frames[-1]:
            frames.pop()
        return {'frames': frames, 'labels': labels, 'scriptFrames': sorted(set(scripts))}

    def place(self, code, r, end):
        op = {'op': 'place'}
        if code == 4:
            op['id'] = r.u16()
            op['depth'] = r.u16()
            op['matrix'] = r.matrix()
            if r.p < end:
                op['cx'] = r.cxform(False)
            op['new'] = True
            return op
        flags = r.u8()
        flags2 = r.u8() if code == 70 else 0
        op['depth'] = r.u16()
        if code == 70 and (flags2 & 0x08 or (flags2 & 0x10 and flags & 2)):
            op['className'] = r.string()
        move = flags & 1
        if flags & 2:
            op['id'] = r.u16()
        op['new'] = not move or bool(flags & 2)
        op['move'] = bool(move)
        if flags & 4:
            op['matrix'] = r.matrix()
        if flags & 8:
            op['cx'] = r.cxform(True)
        if flags & 16:
            op['ratio'] = r.u16() / 65535.0
        if flags & 32:
            op['name'] = r.string()
        if flags & 64:
            op['clipDepth'] = r.u16()
        if code == 70:
            if flags2 & 1:
                op['filters'] = read_filters(r)
            if flags2 & 2:
                op['blend'] = BLEND.get(r.u8(), 'normal')
            if flags2 & 4:
                op['cacheAsBitmap'] = bool(r.u8())
            if flags2 & 0x20:
                op['visible'] = bool(r.u8())
        if flags & 128:
            op['clipEvents'] = read_clip_actions(r, self.version)
        return op

    # ------------------------------------------------------------------
    def define(self, code, r, tp, ln):
        end = tp + ln
        if code == 9:
            self.bg = r.rgb()
        elif code in (2, 22, 32, 83):
            ver = {2: 1, 22: 2, 32: 3, 83: 4}[code]
            cid = r.u16()
            bounds = r.rect()
            sh = {'type': 'shape', 'bounds': bounds}
            if ver == 4:
                sh['edgeBounds'] = r.rect()
                fl = r.u8()
                sh['nonzero'] = bool(fl & 4)
            fills = read_fill_array(r, ver)
            lines = read_line_array(r, ver)
            recs = read_shape_records(r, ver, fills, lines)
            sh['fills'] = fills
            sh['lines'] = lines
            sh['paths'] = build_paths(edges_from_records(recs))
            self.chars[cid] = sh
        elif code in (46, 84):
            cid = r.u16()
            sb = r.rect()
            eb = r.rect()
            if code == 84:
                r.rect()
                r.rect()
                r.u8()
            off = r.u32()
            off_pos = r.p
            n = r.u8()
            if n == 0xFF:
                n = r.u16()
            fills = [read_morph_fill(r) for _ in range(n)]
            n = r.u8()
            if n == 0xFF:
                n = r.u16()
            lines = [read_morph_line(r, 2 if code == 84 else 1) for _ in range(n)]
            srecs = read_shape_records(r, 3, [], [], morph=True)
            er = Bits(self.body, off_pos + off)
            erecs = read_shape_records(er, 3, [], [], morph=True)
            edges = morph_edges(srecs, erecs)
            self.chars[cid] = {'type': 'morph', 'bounds': sb, 'bounds1': eb,
                               'fills': fills, 'lines': lines, 'paths': morph_paths(edges)}
        elif code == 39:
            cid = r.u16()
            fc = r.u16()
            tl = self.parse_timeline(r.p, end)
            tl['type'] = 'sprite'
            tl['frameCount'] = fc
            self.chars[cid] = tl
        elif code == 8:
            self.jpeg_tables = self.body[tp:end]
        elif code in (6, 21, 35, 90):
            cid = r.u16()
            alpha_data = None
            if code in (35, 90):
                aoff = r.u32()
                if code == 90:
                    r.u16()
                jpeg = self.body[r.p:r.p + aoff]
                alpha_data = self.body[r.p + aoff:end]
            else:
                jpeg = self.body[r.p:end]
            if code == 6 and self.jpeg_tables:
                jt = self.jpeg_tables
                if jt.endswith(b'\xff\xd9'):
                    jt = jt[:-2]
                j = jpeg[2:] if jpeg.startswith(b'\xff\xd8') else jpeg
                jpeg = jt + j
            jpeg = fix_jpeg(jpeg)
            img = Image.open(io.BytesIO(jpeg))
            if img.format == 'JPEG' or True:
                img = img.convert('RGBA')
            if alpha_data:
                try:
                    a = zlib.decompress(alpha_data)
                    am = Image.frombytes('L', img.size, a[:img.size[0] * img.size[1]])
                    img = unpremultiply_rgb(img, am)
                except Exception as ex:  # noqa
                    print('alpha fail', cid, ex)
            self.save_bitmap(cid, img)
        elif code in (20, 36):
            cid = r.u16()
            fmt_ = r.u8()
            w = r.u16()
            h = r.u16()
            if fmt_ == 3:
                ncol = r.u8() + 1
                data = zlib.decompress(self.body[r.p:end])
                csz = 4 if code == 36 else 3
                pal = [data[i * csz:(i + 1) * csz] for i in range(ncol)]
                stride = (w + 3) & ~3
                px = bytearray(w * h * 4)
                o = ncol * csz
                for y in range(h):
                    for x in range(w):
                        ci = data[o + y * stride + x]
                        c = pal[ci] if ci < ncol else b'\0\0\0\0'
                        if csz == 3:
                            px[(y * w + x) * 4:(y * w + x) * 4 + 4] = bytes(c) + b'\xff'
                        else:
                            px[(y * w + x) * 4:(y * w + x) * 4 + 4] = bytes(c)
                img = Image.frombytes('RGBA', (w, h), bytes(px))
                if code == 36:
                    img = unpremultiply(img)
            elif fmt_ == 5:
                data = zlib.decompress(self.body[r.p:end])
                img = Image.frombytes('RGBA', (w, h), data[:w * h * 4], 'raw', 'ARGB')
                if code == 20:
                    img.putalpha(255)
                else:
                    img = unpremultiply(img)
            elif fmt_ == 4:
                data = zlib.decompress(self.body[r.p:end])
                stride = ((w * 2) + 3) & ~3
                px = bytearray(w * h * 4)
                for y in range(h):
                    for x in range(w):
                        v = struct.unpack_from('>H', data, y * stride + x * 2)[0]
                        rr = ((v >> 10) & 31) * 255 // 31
                        gg = ((v >> 5) & 31) * 255 // 31
                        bb = (v & 31) * 255 // 31
                        px[(y * w + x) * 4:(y * w + x) * 4 + 4] = bytes((rr, gg, bb, 255))
                img = Image.frombytes('RGBA', (w, h), bytes(px))
            else:
                raise ValueError('bitmap fmt %d' % fmt_)
            self.save_bitmap(cid, img)
        elif code in (48, 75):
            fid = r.u16()
            self.chars[fid] = self.read_font(r, code)
        elif code == 88:
            fid = r.u16()
            self.font_names[fid] = r.string()
        elif code in (11, 33):
            cid = r.u16()
            bounds = r.rect()
            m = r.matrix()
            gb = r.u8()
            ab = r.u8()
            recs = []
            cur = {}
            while True:
                r.align()
                fl = r.u8()
                if fl == 0:
                    break
                rec = {}
                if fl & 8:
                    cur['font'] = r.u16()
                if fl & 4:
                    cur['color'] = r.rgba() if code == 33 else r.rgb()
                if fl & 1:
                    cur['x'] = r.s16() / TW
                if fl & 2:
                    cur['y'] = r.s16() / TW
                if fl & 8:
                    cur['size'] = r.u16() / TW
                n = r.u8()
                glyphs = []
                for _ in range(n):
                    gi = r.ub(gb)
                    adv = r.sb(ab) / TW
                    glyphs.append([gi, adv])
                rec.update(cur)
                rec['glyphs'] = glyphs
                recs.append(rec)
                # x advances for next record when no xoffset
                cur['x'] = cur.get('x', 0) + sum(g[1] for g in glyphs)
            self.chars[cid] = {'type': 'text', 'bounds': bounds, 'matrix': m, 'records': recs}
        elif code == 37:
            cid = r.u16()
            bounds = r.rect()
            r.align()
            fl1 = r.u8()
            fl2 = r.u8()
            et = {'type': 'edittext', 'bounds': bounds}
            et['wordWrap'] = bool(fl1 & 0x40)
            et['multiline'] = bool(fl1 & 0x20)
            et['password'] = bool(fl1 & 0x10)
            et['readOnly'] = bool(fl1 & 0x08)
            if fl1 & 0x01:
                et['font'] = r.u16()
                et['size'] = r.u16() / TW
            if fl2 & 0x80 and code == 37 and not (fl1 & 1):
                pass
            if fl1 & 0x04:
                et['color'] = r.rgba()
            if fl1 & 0x02:
                et['maxLength'] = r.u16()
            et['autoSize'] = bool(fl2 & 0x40)
            if fl2 & 0x20:
                et['align'] = ['left', 'right', 'center', 'justify'][r.u8() & 3]
                et['leftMargin'] = r.u16() / TW
                et['rightMargin'] = r.u16() / TW
                et['indent'] = r.u16() / TW
                et['leading'] = r.s16() / TW
            et['noSelect'] = bool(fl2 & 0x10)
            et['border'] = bool(fl2 & 0x08)
            et['html'] = bool(fl2 & 0x02)
            et['useOutlines'] = bool(fl2 & 0x01)
            et['variable'] = r.string()
            if fl1 & 0x80:
                et['text'] = r.string()
            self.chars[cid] = et
        elif code == 34:
            cid = r.u16()
            r.u8()
            r.u16()
            recs = []
            while True:
                fl = r.u8()
                if fl == 0:
                    break
                rec = {'states': fl & 0x0F, 'id': r.u16(), 'depth': r.u16(), 'matrix': r.matrix(),
                       'cx': r.cxform(True)}
                if fl & 0x10:
                    rec['filters'] = read_filters(r)
                if fl & 0x20:
                    rec['blend'] = BLEND.get(r.u8(), 'normal')
                recs.append(rec)
            self.chars[cid] = {'type': 'button', 'records': recs}
        elif code == 56:
            n = r.u16()
            for _ in range(n):
                cid = r.u16()
                self.exports[r.string()] = cid
        elif code == 78:
            cid = r.u16()
            self.scale9[cid] = r.rect()
        # ignore others (DoAction handled in timeline, metadata, etc.)

    def read_font(self, r, code):
        fl = r.u8()
        has_layout = fl & 0x80
        wide_off = fl & 0x08
        wide_codes = fl & 0x04
        italic = bool(fl & 0x02)
        bold = bool(fl & 0x01)
        r.u8()  # lang
        nl = r.u8()
        name = r.bytes(nl).rstrip(b'\0').decode('latin-1')
        ng = r.u16()
        base = r.p
        offs = []
        for _ in range(ng):
            offs.append(r.u32() if wide_off else r.u16())
        code_off = r.u32() if wide_off else r.u16()
        glyphs = []
        scale = 20.0 if code == 75 else 1.0  # font3 is 20x
        for i in range(ng):
            gr = Bits(self.body, base + offs[i])
            fills = [{'t': 0, 'c': [0, 0, 0, 255]}]
            recs = read_shape_records(gr, 1, fills, [])
            groups = edges_from_records(recs)
            # glyphs use fill style 1 on either side
            segs = []
            for g in groups:
                for (x0, y0, cx, cy, x1, y1, f0, f1, l) in g:
                    if f1 >= 0:
                        segs.append((x0, y0, cx, cy, x1, y1))
                    if f0 >= 0:
                        segs.append((x1, y1, cx, cy, x0, y0))
            ch = link_contours(segs)
            cmds = chains_to_cmds(ch)
            # coords: divide by additional scale (font3 em = 1024*20)
            glyphs.append([round(v / scale, 3) if isinstance(v, (int, float)) else v for v in cmds])
        r.p = base + code_off
        codes = [r.u16() if wide_codes else r.u8() for _ in range(ng)]
        font = {'type': 'font', 'name': name, 'bold': bold, 'italic': italic,
                'glyphs': glyphs, 'codes': codes, 'em': 1024.0 / TW}
        if has_layout:
            font['ascent'] = r.u16() / TW / scale
            font['descent'] = r.u16() / TW / scale
            font['leading'] = r.s16() / TW / scale
            font['advances'] = [r.s16() / TW / scale for _ in range(ng)]
        return font

    def save_bitmap(self, cid, img):
        p = os.path.join(self.outdir, 'bitmaps', '%d.png' % cid)
        img.save(p, optimize=True)
        self.chars[cid] = {'type': 'bitmap', 'src': 'bitmaps/%d.png' % cid,
                           'w': img.size[0], 'h': img.size[1]}

    def to_json(self):
        for cid, b in self.scale9.items():
            if cid in self.chars:
                self.chars[cid]['scale9'] = b
        for fid, n in self.font_names.items():
            if fid in self.chars:
                self.chars[fid]['fullName'] = n
        return {
            'version': self.version,
            'stage': self.stage,
            'frameRate': self.frame_rate,
            'background': self.bg,
            'exports': self.exports,
            'root': self.root,
            'chars': {str(k): v for k, v in sorted(self.chars.items())},
        }


def fix_jpeg(j):
    # strip erroneous header that some SWF jpegs carry
    if j.startswith(b'\xff\xd9\xff\xd8'):
        j = j[4:]
    # remove embedded EOI/SOI pairs
    j = j[:2] + j[2:].replace(b'\xff\xd9\xff\xd8', b'')
    return j


def unpremultiply(img):
    import numpy as np
    a = np.asarray(img).astype('float32')
    al = a[..., 3:4]
    with np.errstate(divide='ignore', invalid='ignore'):
        rgb = np.where(al > 0, np.clip(a[..., :3] * 255.0 / al, 0, 255), 0)
    out = np.concatenate([rgb, al], axis=2).astype('uint8')
    return Image.fromarray(out, 'RGBA')


def unpremultiply_rgb(img, am):
    import numpy as np
    a = np.asarray(img).astype('float32')
    al = np.asarray(am).astype('float32')[..., None]
    with np.errstate(divide='ignore', invalid='ignore'):
        rgb = np.where(al > 0, np.clip(a[..., :3] * 255.0 / al, 0, 255), 0)
    out = np.concatenate([rgb, al], axis=2).astype('uint8')
    return Image.fromarray(out, 'RGBA')


def main():
    src, outdir = sys.argv[1], sys.argv[2]
    swf = SWF(src, outdir)
    data = swf.to_json()
    with open(os.path.join(outdir, 'swf.json'), 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    kinds = {}
    for c in swf.chars.values():
        kinds[c['type']] = kinds.get(c['type'], 0) + 1
    print('chars', kinds, 'exports', len(swf.exports))


if __name__ == '__main__':
    main()

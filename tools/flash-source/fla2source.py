#!/usr/bin/env python3
"""Convert FLA (XFL) library symbols that never made it into the SWF into source/.

source/ was transpiled from the compiled SWF, with names taken from the FLA, so
anything the SWF does not contain was never converted: symbols that are only
placed on guide layers (the enemy tank, drone and missile launcher), unused
library symbols and bitmaps.  This tool reads those straight from the
uncompressed FLA (an XFL folder) and writes them in the same format as the rest
of source/, so they build and render like everything else.

Usage:
  python3 tools/flash-source/fla2source.py <xfl dir> [--out source/library] [--dry-run]
  python3 tools/flash-source/fla2source.py <xfl dir> --only "enemy assets/enemy tank" ...
  python3 tools/flash-source/fla2source.py <xfl dir> --calibrate <symbol> ...

By default it converts every FLA symbol that has no file in source/library and
is not a duplicate of one that has (see SKIP), plus every bitmap they use, and
every library bitmap whose pixels are not already in source/library.  Existing
files are never overwritten.  --calibrate converts symbols that already exist
into a scratch folder so the output can be diffed against the SWF-derived file.

Supported: shapes (solid, gradient and bitmap fills; solid strokes, dashed and
dotted strokes are drawn solid), groups, drawing objects, symbol and bitmap
instances, masks, motion tweens (linear, acceleration and custom eases,
rotation), colour effects, filters, blend modes, frame and instance scripts,
labels.  Not supported (reported as warnings): shape tweens (the keyframe
shapes are held instead), static/dynamic text, graphic symbol loop modes.
"""
import argparse
import glob
import html
import io
import json
import math
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

from PIL import Image

NS = '{http://ns.adobe.com/xfl/2008/}'
TW = 20.0
GRAD_K = 16384.0 / TW  # gradient square half-size in px

# FLA library entries that are copies of symbols already in source/ under
# another name (Flash kept duplicate copies of the mission panel and title
# header when they were pasted in from another file), or that the SWF-derived
# source keeps as unnamed pieces.
SKIP = {
    'box reactor core': 'game objects/box reactor core',
    'btn continue': 'interface/buttons/btn continue',
    'mission panel': 'interface/screens/mission panel',
    'mission panel body': 'interface/screens/mission panel body',
    'mission panel close btn': 'interface/screens/mission panel/button 1',
    'mission panel list': 'interface/screens/mission panel/clip 1',
    'mission panel scanlines': None,
    'mission panel scanlines anim': 'interface/screens/mission panel/clip 2',
    'mission panel wire1': 'interface/screens/mission panel wire1',
    'mission panel wire2': 'interface/screens/mission panel wire2',
    'interface/screens/mission panel close btn': 'interface/screens/mission panel/button 1',
    'interface/screens/mission panel list': 'interface/screens/mission panel/clip 1',
    'interface/screens/mission panel list item': 'mission panel list item',
    'interface/screens/mission panel list item back': 'mission panel list item back',
    'interface/screens/mission panel scanlines': None,
    'interface/screens/mission panel scanlines anim': 'interface/screens/mission panel/clip 2',
    'titlescreen header': 'interface/screens/titlescreen header',
    'player assets/ship': 'player assets/ship38x37',
}

# Flash flattens graphic-symbol instances into the parent timeline when it
# compiles the SWF, so graphic symbols that use shape tweens (which this tool
# cannot convert from the FLA) exist in source/ only as pieces inside the
# symbols that use them.  For these, a sprite is rebuilt from one flattened
# copy: (new name, symbol holding the copy, first frame, last frame, depths,
# the instance transform it was placed with).
FLATTENED = {
    'graphic assets/explosion': ('graphic assets/explosion anim', 'weapon assets/shot MC enemy shell', 2, 14,
                                 [1, 2, 3, 5], [0.613495, 0, 0, 0.613495, 0.9, 2.15]),
}

warnings = []


def warn(msg):
    if msg not in warnings:
        warnings.append(msg)


# ---------------------------------------------------------------------------
# file names (same escaping as tools/flash-source/format.mjs)
def name_to_path(name):
    def part(p):
        p = re.sub(r'[%<>:"\\|?*]', lambda m: '%' + '%02X' % ord(m.group(0)), p)
        p = re.sub(r'^ +| +$', lambda m: '%20' * len(m.group(0)), p)
        return p
    return '/'.join(part(p) for p in name.split('/'))


def path_to_name(p):
    return '/'.join(re.sub(r'%([0-9A-F]{2})', lambda m: chr(int(m.group(1), 16)), x) for x in p.split('/'))


# ---------------------------------------------------------------------------
# pretty printer (same output as format.mjs pretty())
def _spaced(v):
    if v is None or not isinstance(v, (list, dict)):
        return _js(v)
    if isinstance(v, list):
        return '[' + ', '.join(_spaced(x) for x in v) + ']'
    return '{' + ', '.join(json.dumps(k) + ': ' + _spaced(x) for k, x in v.items()) + '}'


def _js(v):
    if isinstance(v, bool) or v is None:
        return json.dumps(v)
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return str(int(v))
        return repr(v)
    return json.dumps(v)


def _flat(v):
    if isinstance(v, list):
        return '[' + ','.join(_flat(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(json.dumps(k) + ':' + _flat(x) for k, x in v.items()) + '}'
    return _js(v)


def pretty(v, indent='', width=110):
    if v is None or not isinstance(v, (list, dict)):
        return _js(v)
    flat = _flat(v)
    vals = v if isinstance(v, list) else list(v.values())
    all_num = isinstance(v, list) and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v)
    if len(indent) + len(flat) <= width or all_num:
        return _spaced(v)
    inner = indent + '  '
    if isinstance(v, list):
        return '[\n' + ',\n'.join(inner + pretty(x, inner, width) for x in v) + '\n' + indent + ']'
    return '{\n' + ',\n'.join(inner + json.dumps(k) + ': ' + pretty(x, inner, width) for k, x in v.items()) + '\n' + indent + '}'


def rnd(v, n=6):
    v = round(v, n)
    return int(v) if v == int(v) else v


# ---------------------------------------------------------------------------
# bitmaps: FLA bin/*.dat
def read_dat(path):
    b = open(path, 'rb').read()
    if b[:2] == b'\xff\xd8':
        return Image.open(io.BytesIO(b)).convert('RGBA')
    kind = b[1]
    if b[0] != 3 or kind not in (3, 5):
        raise ValueError('unknown bitmap format %r in %s' % (b[:2], path))
    stride, w, h = struct.unpack_from('<HHH', b, 2)
    p = 24
    pal = None
    if kind == 5:
        alpha, comp = b[p], b[p + 1]
        p += 2
    else:  # 8-bit palette
        alpha = b[p]
        n = struct.unpack_from('<H', b, p + 1)[0]
        p += 3
        pal = [(b[p + 4 * i + 1], b[p + 4 * i + 2], b[p + 4 * i + 3], b[p + 4 * i]) for i in range(n)]
        p += 4 * n
        comp = b[p]
        p += 1
    if comp:
        data = bytearray()
        while True:
            n = struct.unpack_from('<H', b, p)[0]
            p += 2
            if n == 0:
                break
            data += b[p:p + n]
            p += n
        raw = zlib.decompress(bytes(data))
    else:
        raw = b[p:]
    if kind == 3:
        rowb = (w + 3) & ~3
        img = Image.new('RGBA', (w, h))
        img.putdata([pal[raw[y * rowb + x]] for y in range(h) for x in range(w)])
        return img
    img = Image.frombuffer('RGBA', (w, h), bytes(raw[:stride * h]), 'raw', 'ARGB', stride, 1).copy()
    if not alpha:
        return img.convert('RGB').convert('RGBA')
    # stored premultiplied
    px = list(img.getdata())
    out = []
    for r, g, bb, a in px:
        if 0 < a < 255:
            r, g, bb = min(255, (r * 255 + a // 2) // a), min(255, (g * 255 + a // 2) // a), min(255, (bb * 255 + a // 2) // a)
        elif a == 0:
            r = g = bb = 0
        out.append((r, g, bb, a))
    img.putdata(out)
    return img


# ---------------------------------------------------------------------------
# XFL numbers and edges
def xnum(t):
    if t.startswith('#'):
        ip, _, fp = t[1:].partition('.')
        fp = (fp + '00')[:2]
        n = int(ip + fp, 16)
        bits = 4 * (len(ip) + 2)
        if len(ip) >= 6 and n >= 1 << (bits - 1):
            n -= 1 << bits
        return n / 256.0
    return float(t)


EDGE_TOK = re.compile(r'[!|/\[\]]|S\d+|#[-0-9A-Fa-f.]+|-?[0-9.]+(?:e-?[0-9]+)?')


def parse_edges(s):
    """XFL edge string -> list of segments (x0,y0,cx,cy,x1,y1) in twips."""
    segs = []
    toks = EDGE_TOK.findall(s)
    i = 0
    x = y = 0.0
    while i < len(toks):
        t = toks[i]
        if t == '!':
            x, y = xnum(toks[i + 1]), xnum(toks[i + 2])
            i += 3
        elif t in ('|', '/'):
            nx, ny = xnum(toks[i + 1]), xnum(toks[i + 2])
            segs.append((x, y, None, None, nx, ny))
            x, y = nx, ny
            i += 3
        elif t in ('[', ']'):
            cx, cy, nx, ny = (xnum(v) for v in toks[i + 1:i + 5])
            segs.append((x, y, cx, cy, nx, ny))
            x, y = nx, ny
            i += 5
        else:
            i += 1  # S<n> selection markers
    return segs


# ---------------------------------------------------------------------------
# matrices: [a, b, c, d, tx, ty]
IDENT = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]


def mat_el(el):
    m = el.find(NS + 'matrix/' + NS + 'Matrix') if el is not None else None
    if m is None:
        return list(IDENT)
    g = lambda k, d: float(m.get(k, d))
    return [g('a', 1), g('b', 0), g('c', 0), g('d', 1), g('tx', 0), g('ty', 0)]


def mul(m, n):
    """m applied after n"""
    a, b, c, d, tx, ty = m
    return [a * n[0] + c * n[1], b * n[0] + d * n[1], a * n[2] + c * n[3], b * n[2] + d * n[3],
            a * n[4] + c * n[5] + tx, b * n[4] + d * n[5] + ty]


def apply(m, x, y):
    return m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]


# ---------------------------------------------------------------------------
# fills and strokes
def color_of(el, ckey='color', akey='alpha'):
    c = (el.get(ckey) or '#000000').lstrip('#').lower()
    a = float(el.get(akey, 1))
    ai = int(round(a * 255))
    return '#' + c + ('' if ai == 255 else '%02x' % ai)


def conv_fill(el, smat, conv):
    """XFL fill element (SolidColor/LinearGradient/RadialGradient/BitmapFill) -> source fill"""
    tag = el.tag[len(NS):]
    if tag == 'SolidColor':
        return {'type': 'solid', 'color': color_of(el)}
    if tag in ('LinearGradient', 'RadialGradient'):
        m = mat_el(el)
        m = [m[0] * GRAD_K, m[1] * GRAD_K, m[2] * GRAD_K, m[3] * GRAD_K, m[4], m[5]]
        m = mul(smat, m)
        focal = el.get('focalPointRatio')
        t = 'linear gradient' if tag == 'LinearGradient' else ('focal gradient' if focal else 'radial gradient')
        f = {'type': t, 'm': [rnd(v, 7) for v in m],
             'spread': {'pad': 0, 'reflect': 1, 'repeat': 2}.get(el.get('spreadMethod', 'pad'), 0),
             'interp': 1 if el.get('interpolationMethod') == 'linearRGB' else 0,
             'stops': [[float(g.get('ratio', 0)), color_of(g)] for g in el.findall(NS + 'GradientEntry')]}
        if focal:
            f['focal'] = float(focal)
        return f
    if tag == 'BitmapFill':
        m = mat_el(el)
        m = [m[0] / TW, m[1] / TW, m[2] / TW, m[3] / TW, m[4], m[5]]
        m = mul(smat, m)
        name = html.unescape(el.get('bitmapPath'))
        clipped = el.get('bitmapIsClipped') == 'true'
        smooth = conv.bitmap_smooth(name)
        t = ('clipped bitmap' if clipped else 'bitmap') + ('' if smooth else ' (unsmoothed)')
        return {'type': t, 'bitmap': conv.bitmap_ref(name), 'm': [rnd(v, 8) for v in m], 'repeat': not clipped, 'smooth': smooth}
    raise ValueError('fill ' + tag)


CAPS = {'round': 0, 'none': 1, 'square': 2}
JOINS = {'round': 0, 'bevel': 1, 'miter': 2}


def conv_stroke(el, smat, conv):
    kind = el.tag[len(NS):]
    dash = None
    if kind == 'DashedStroke':
        dash = (float(el.get('dash1', 6)), float(el.get('dash2', 6)))
    elif kind == 'DottedStroke':
        dash = (0.01, float(el.get('dotSpace', 0)) / TW + float(el.get('weight', 1)))
    elif kind != 'SolidStroke':
        warn('%s drawn as a solid stroke' % kind)
    w = float(el.get('weight', 1))
    fill = el.find(NS + 'fill')
    fe = list(fill)[0] if fill is not None and len(fill) else None
    sc = math.sqrt(abs(smat[0] * smat[3] - smat[1] * smat[2])) or 1
    cap = CAPS.get(el.get('caps', 'round'), 0)
    ls = {'width': rnd(w * sc, 4), 'cap': cap, 'ecap': cap, 'join': JOINS.get(el.get('joints', 'round'), 0),
          'noScale': el.get('scaleMode') in ('none', 'horizontal', 'vertical'), 'noClose': False}
    if el.get('joints') == 'miter':
        ls['miter'] = float(el.get('miterLimit', 3))
    if fe is None or fe.tag == NS + 'SolidColor':
        ls['color'] = color_of(fe) if fe is not None else '#000000'
    else:
        ls['fill'] = conv_fill(fe, smat, conv)
    if el.get('weight') is None and el.get('solidStyle') == 'hairline':
        ls['width'] = 0.05
    if dash:
        ls['_dash'] = dash
    return ls


def dash_chains(chains, on, off):
    """split stroke chains into dashes (Flash bakes dashed/dotted strokes into short line segments)"""
    out = []
    for ch in chains:
        pts = [(ch[0][0], ch[0][1])]
        for (x0, y0, cx, cy, x1, y1) in ch:
            if cx is None:
                pts.append((x1, y1))
            else:
                for k in range(1, 9):
                    t = k / 8.0
                    u = 1 - t
                    pts.append((u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1))
        pos, drawing, left = 0, True, on * TW
        cur = [pts[0]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            seg = math.hypot(bx - ax, by - ay)
            t0 = 0.0
            while seg - t0 > 1e-9:
                step = min(left, seg - t0)
                t1 = t0 + step
                px, py = ax + (bx - ax) * t1 / seg, ay + (by - ay) * t1 / seg
                if drawing:
                    cur.append((px, py))
                left -= step
                t0 = t1
                if left <= 1e-9:
                    if drawing and len(cur) > 1:
                        out.append(cur)
                    drawing = not drawing
                    left = (on if drawing else off) * TW
                    cur = [(px, py)]
        if drawing and len(cur) > 1:
            out.append(cur)
    return [[(a[0], a[1], None, None, b[0], b[1]) for a, b in zip(c, c[1:])] for c in out]


def shape_parts(shape_el, smat, conv):
    """one DOMShape -> (fills, lines, edges as (x0,y0,cx,cy,x1,y1,f0,f1,l) with 0-based local indexes)"""
    fills, lines, fidx, lidx = [], [], {}, {}
    for fs in shape_el.findall(NS + 'fills/' + NS + 'FillStyle'):
        fidx[int(fs.get('index'))] = len(fills)
        fills.append(conv_fill(list(fs)[0], smat, conv))
    for ss in shape_el.findall(NS + 'strokes/' + NS + 'StrokeStyle'):
        lidx[int(ss.get('index'))] = len(lines)
        lines.append(conv_stroke(list(ss)[0], smat, conv))
    edges = []
    for e in shape_el.findall(NS + 'edges/' + NS + 'Edge'):
        s = e.get('edges')
        if not s:
            continue
        f0 = fidx.get(int(e.get('fillStyle0', 0)), -1)
        f1 = fidx.get(int(e.get('fillStyle1', 0)), -1)
        l = lidx.get(int(e.get('strokeStyle', 0)), -1)
        if f0 < 0 and f1 < 0 and l < 0:
            continue
        for (x0, y0, cx, cy, x1, y1) in parse_edges(s):
            x0, y0 = apply_tw(smat, x0, y0)
            x1, y1 = apply_tw(smat, x1, y1)
            if cx is not None:
                cx, cy = apply_tw(smat, cx, cy)
            edges.append((x0, y0, cx, cy, x1, y1, f0, f1, l))
    return fills, lines, edges


def apply_tw(m, x, y):
    """apply a px matrix to a twip point -> twips, rounded to whole twips like the SWF"""
    px, py = apply(m, x / TW, y / TW)
    return round(px * TW), round(py * TW)


# edge linking, the same algorithm tools/swf2json.py uses for SWF shapes
def link_contours(segs):
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


def link_lines(segs):
    chains = []
    for s in segs:
        if chains and (chains[-1][-1][4], chains[-1][-1][5]) == (s[0], s[1]):
            chains[-1].append(s)
        else:
            chains.append([s])
    return chains


def fmt(v):
    v = round(v / TW, 2)
    return int(v) if v == int(v) else v


def chains_to_d(chains):
    out = []
    for ch in chains:
        s = ch[0]
        out += ['M', fmt(s[0]), fmt(s[1])]
        for e in ch:
            if e[2] is None:
                out += ['L', fmt(e[4]), fmt(e[5])]
            else:
                out += ['Q', fmt(e[2]), fmt(e[3]), fmt(e[4]), fmt(e[5])]
        if (ch[-1][4], ch[-1][5]) == (s[0], s[1]):
            out.append('Z')
    return ' '.join(str(t) for t in out)


def build_shape(parts):
    """list of (fills, lines, edges) groups -> source shape dict"""
    fills, lines, paths = [], [], []
    xs, ys = [], []
    for gf, gl, ge in parts:
        fo, lo = len(fills), len(lines)
        fills += gf
        lines += gl
        fd, ld = {}, {}
        for (x0, y0, cx, cy, x1, y1, f0, f1, l) in ge:
            if f1 >= 0:
                fd.setdefault(f1 + fo, []).append((x0, y0, cx, cy, x1, y1))
            if f0 >= 0:
                fd.setdefault(f0 + fo, []).append((x1, y1, cx, cy, x0, y0))
            if l >= 0:
                ld.setdefault(l + lo, []).append((x0, y0, cx, cy, x1, y1))
            xs += [x0, x1] + ([cx] if cx is not None else [])
            ys += [y0, y1] + ([cy] if cy is not None else [])
        for fi in sorted(fd):
            paths.append({'fill': fi, 'd': chains_to_d(link_contours(fd[fi]))})
        for li in sorted(ld):
            chains = link_lines(ld[li])
            if lines[li].get('_dash'):
                chains = dash_chains(chains, *lines[li]['_dash'])
            paths.append({'line': li, 'd': chains_to_d(chains)})
    for l in lines:
        l.pop('_dash', None)
    pad = max([l.get('width', 0) for l in lines] + [0]) / 2
    bounds = [fmt(min(xs)) - pad, fmt(max(xs)) + pad, fmt(min(ys)) - pad, fmt(max(ys)) + pad] if xs else [0, 0, 0, 0]
    return {'kind': 'shape', 'bounds': [rnd(b, 2) for b in bounds], 'fills': fills, 'lines': lines, 'paths': paths}


# ---------------------------------------------------------------------------
# instance properties
def color_effect(inst):
    c = inst.find(NS + 'color/' + NS + 'Color')
    if c is None:
        return None
    g = lambda k, d=0.0: float(c.get(k, d))
    mult = [g('redMultiplier', 1), g('greenMultiplier', 1), g('blueMultiplier', 1), g('alphaMultiplier', 1)]
    add = [g('redOffset'), g('greenOffset'), g('blueOffset'), g('alphaOffset')]
    if c.get('tintMultiplier') is not None:
        t = g('tintMultiplier')
        tc = (c.get('tintColor') or '#000000').lstrip('#')
        rgb = [int(tc[i:i + 2], 16) for i in (0, 2, 4)]
        mult[:3] = [1 - t] * 3
        add[:3] = [v * t for v in rgb]
    if c.get('brightness') is not None:
        br = g('brightness')
        if br < 0:
            mult[:3] = [1 + br] * 3
        else:
            mult[:3] = [1 - br] * 3
            add[:3] = [255 * br] * 3
    return mult + add


def encode_cx(cx):
    rm, gm, bm, am, ra, ga, ba, aa = cx
    if rm == gm == bm == 1 and ra == ga == ba == aa == 0:
        return {} if am == 1 else {'alpha': rnd(am, 8)}
    o = {}
    if not (rm == gm == bm == am == 1):
        o['multiply'] = [rnd(v, 8) for v in (rm, gm, bm, am)]
    if not (ra == ga == ba == aa == 0):
        o['add'] = [rnd(v, 4) for v in (ra, ga, ba, aa)]
    return o


def filters_of(inst):
    out = []
    fe = inst.find(NS + 'filters')
    if fe is None:
        return out
    for f in fe:
        t = f.tag[len(NS):]
        g = lambda k, d: float(f.get(k, d))
        b = lambda k, d=False: f.get(k, str(d).lower()) == 'true'
        passes = int(f.get('quality', 1))
        base = {'blurX': g('blurX', 5), 'blurY': g('blurY', 5)}
        if t == 'GlowFilter':
            out.append({'type': 'glow', 'color': color_of(f), **base, 'strength': g('strength', 1),
                        'inner': b('inner'), 'knockout': b('knockout'), 'passes': passes})
            if f.get('color') is None:
                out[-1]['color'] = '#ff0000' + ('' if g('alpha', 1) == 1 else '%02x' % round(g('alpha', 1) * 255))
        elif t == 'DropShadowFilter':
            out.append({'type': 'dropShadow', 'color': color_of(f), **base, 'angle': math.radians(g('angle', 45)),
                        'distance': g('distance', 5), 'strength': g('strength', 1), 'inner': b('inner'),
                        'knockout': b('knockout'), 'passes': passes})
        elif t == 'BlurFilter':
            out.append({'type': 'blur', **base, 'passes': passes})
        elif t == 'BevelFilter':
            ty = f.get('type', 'inner')
            out.append({'type': 'bevel', 'shadow': color_of(f, 'shadowColor', 'shadowAlpha'),
                        'highlight': color_of(f, 'highlightColor', 'highlightAlpha') if f.get('highlightColor') else
                        '#ffffff' + ('' if g('highlightAlpha', 1) == 1 else '%02x' % round(g('highlightAlpha', 1) * 255)),
                        **base, 'angle': math.radians(g('angle', 45)), 'distance': g('distance', 5), 'strength': g('strength', 1),
                        'inner': ty == 'inner', 'knockout': b('knockout'), 'onTop': ty == 'full', 'passes': passes})
        else:
            warn('filter %s not converted' % t)
    for o in out:
        for k, v in list(o.items()):
            if isinstance(v, float):
                o[k] = rnd(v, 6)
    return out


def encode_matrix(m, o):
    a, b, c, d, tx, ty = (rnd(v, 6) for v in m)
    o['x'], o['y'] = rnd(tx, 2), rnd(ty, 2)
    if b == 0 and c == 0:
        if a != d:
            o['scale'] = [a, d]
        elif a != 1:
            o['scale'] = a
    else:
        o['matrix'] = [a, b, c, d]


# ---------------------------------------------------------------------------
# tweens
def decompose(m):
    a, b, c, d = m[:4]
    sx = math.hypot(a, b)
    sy = math.hypot(c, d)
    ry = math.atan2(b, a)  # rotation of x axis
    rx = math.atan2(-c, d)  # rotation of y axis
    return sx, sy, rx, ry


def compose(sx, sy, rx, ry):
    return [sx * math.cos(ry), sx * math.sin(ry), -sy * math.sin(rx), sy * math.cos(rx)]


def custom_ease(points):
    """XFL CustomEase points (p0, c, c, p1, c, c, p2 ...) in 0..1 -> f(t)"""
    pts = [(float(p.get('x', 0)), float(p.get('y', 0))) for p in points]

    def bez(p0, p1, p2, p3, s):
        u = 1 - s
        return u ** 3 * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s ** 3 * p3

    segs = [pts[i:i + 4] for i in range(0, len(pts) - 3, 3)]

    def f(t):
        for p in segs:
            if p[0][0] <= t <= p[3][0]:
                lo, hi = 0.0, 1.0
                for _ in range(40):
                    mid = (lo + hi) / 2
                    if bez(p[0][0], p[1][0], p[2][0], p[3][0], mid) < t:
                        lo = mid
                    else:
                        hi = mid
                return bez(p[0][1], p[1][1], p[2][1], p[3][1], (lo + hi) / 2)
        return t
    return f


def ease_fn(frame):
    ce = frame.find(NS + 'tweens/' + NS + 'CustomEase')
    if frame.get('hasCustomEase') == 'true' and ce is not None:
        return custom_ease(ce.findall(NS + 'Point'))
    e = float(frame.get('acceleration', 0)) / 100.0
    return lambda t: t + e * t * (1 - t)


def tween_matrix(m0, m1, tp, t, frame):
    s0, s1 = decompose(m0), decompose(m1)
    rot = frame.get('motionTweenRotate', 'auto')
    times = int(frame.get('motionTweenRotateTimes', 0))

    def ang(a0, a1):
        d = a1 - a0
        if rot == 'none':
            return a0
        d = (d + math.pi) % (2 * math.pi) - math.pi
        if rot == 'clockwise':
            d = (d % (2 * math.pi)) + 2 * math.pi * times
        elif rot == 'counter-clockwise':
            d = -((-d) % (2 * math.pi)) - 2 * math.pi * times
        return a0 + d * t
    sx = s0[0] + (s1[0] - s0[0]) * t
    sy = s0[1] + (s1[1] - s0[1]) * t
    lin = compose(sx, sy, ang(s0[2], s1[2]), ang(s0[3], s1[3]))
    p0 = apply(m0, *tp)
    p1 = apply(m1, *tp)
    px, py = p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t
    q = apply(lin + [0, 0], *tp)
    return lin + [px - q[0], py - q[1]]


# ---------------------------------------------------------------------------
class Converter:
    def __init__(self, xfl, src_lib, outdir):
        self.xfl = xfl
        self.src = src_lib
        self.out = outdir
        self.syms = {}
        for f in sorted(glob.glob(os.path.join(xfl, 'LIBRARY', '**', '*.xml'), recursive=True)):
            root = ET.parse(f).getroot()
            if root.tag == NS + 'DOMSymbolItem':
                self.syms.setdefault(root.get('name'), root)
        doc = ET.parse(os.path.join(xfl, 'DOMDocument.xml')).getroot()
        self.bitmaps = {b.get('name'): b for b in doc.iter(NS + 'DOMBitmapItem')}
        self.have = set()
        for f in glob.glob(os.path.join(src_lib, '**', '*.*'), recursive=True):
            if f.endswith(('.json', '.png')):
                self.have.add(path_to_name(os.path.relpath(f, src_lib).rsplit('.', 1)[0].replace(os.sep, '/')))
        self.bmp_names = {}  # FLA bitmap name -> source name
        self.new_files = {}  # source name -> (kind, data)
        self._src_pngs = None
        self.models = {}

    # -- bitmaps ------------------------------------------------------------
    def bitmap_smooth(self, name):
        b = self.bitmaps.get(name)
        return b is not None and b.get('allowSmoothing') == 'true'

    def bitmap_image(self, name):
        return read_dat(os.path.join(self.xfl, 'bin', self.bitmaps[name].get('bitmapDataHRef')))

    def find_in_source(self, img):
        """name of a source PNG with the same pixels (lossless, or JPEG-close for photo-compressed SWF bitmaps)"""
        import numpy as np
        if self._src_pngs is None:
            self._src_pngs = {}
            for f in glob.glob(os.path.join(self.src, '**', '*.png'), recursive=True):
                im = Image.open(f).convert('RGBA')
                self._src_pngs.setdefault(im.size, []).append((path_to_name(os.path.relpath(f, self.src)[:-4]), np.asarray(im).astype(int)))
        a = np.asarray(img).astype(int)
        best = None
        for n, b in self._src_pngs.get(img.size, []):
            vis = (a[..., 3] > 8) | (b[..., 3] > 8)
            d = np.abs(a - b)[vis].mean() if vis.any() else 0
            if best is None or d < best[1]:
                best = (n, d)
        return best[0] if best and best[1] <= 8 else None

    def bitmap_ref(self, name):
        if name in self.bmp_names:
            return self.bmp_names[name]
        img = self.bitmap_image(name)
        found = self.find_in_source(img)
        if not found:
            base = re.sub(r'\.(png|jpg|gif)$', '', name, flags=re.I)
            found = base
            n = 2
            while found in self.have or found in self.syms or found in self.new_files:
                found = '%s bitmap%s' % (base, '' if n == 2 else ' %d' % (n - 1))
                n += 1
            buf = io.BytesIO()
            img.save(buf, 'PNG', optimize=True)
            self.new_files[found] = ('png', buf.getvalue())
        self.bmp_names[name] = found
        return found

    # -- symbols -------------------------------------------------------------
    def ref(self, name):
        if name in FLATTENED:
            return self.unflatten(name)
        if name in SKIP and SKIP[name]:
            return SKIP[name]
        return name

    def flat_model(self, name):
        """model of a FLATTENED graphic, replayed from its flattened copy in source/"""
        key = ('flat', name)
        if key in self.models:
            return self.models[key]
        new, holder, f0, f1, depths, m = FLATTENED[name]
        src = json.load(open(os.path.join(self.src, name_to_path(holder) + '.json')))
        det = m[0] * m[3] - m[1] * m[2]
        inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det]
        inv += [-(inv[0] * m[4] + inv[2] * m[5]), -(inv[1] * m[4] + inv[3] * m[5])]
        dmap = {d: i + 1 for i, d in enumerate(depths)}
        frames, dl, serial = [], {}, 0
        for f in range(1, f1 + 1):
            e = next((x for x in src['timeline'] if x['frame'] == f), {})
            for c in e.get('changes', []):
                d = c.get('remove', c.get('update', c.get('depth')))
                if 'remove' in c:
                    dl.pop(d, None)
                    continue
                if 'place' in c:
                    serial += 1
                    st = {'key': ('flat', name, serial), 'ref': c['place'], 'm': list(IDENT), 'it': {'kind': 'shape'}}
                else:
                    st = dict(dl.get(d, {}))
                    if 'replace' in c:
                        st['ref'] = c['replace']
                if 'x' in c:
                    sc = c.get('scale', 1)
                    mm = c.get('matrix') or ([sc[0], 0, 0, sc[1]] if isinstance(sc, list) else [sc, 0, 0, sc])
                    st['m'] = mul(inv, list(mm) + [c['x'], c['y']])
                if 'color' in c:
                    col = c['color']
                    st['cx'] = (list(col.get('multiply', [1, 1, 1, 1])) + list(col.get('add', [0, 0, 0, 0]))
                                if ('multiply' in col or 'add' in col) else [1, 1, 1, col.get('alpha', 1), 0, 0, 0, 0])
                for k in ('filters', 'blend', 'ratio'):
                    if k in c:
                        st[k] = c[k]
                dl[d] = st
            if f >= f0:
                frames.append({dmap[d]: v for d, v in dl.items() if d in dmap})
        md = {'nframes': len(frames), 'span': len(depths), 'state': lambda i: frames[min(i, len(frames) - 1)],
              'scripts': {}, 'labels': {}}
        self.models[key] = md
        return md

    def unflatten(self, name):
        new, holder, f0, f1, depths, m = FLATTENED[name]
        if new in self.have or new in self.new_files:
            return new
        src = json.load(open(os.path.join(self.src, name_to_path(holder) + '.json')))
        det = m[0] * m[3] - m[1] * m[2]
        inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det]
        inv += [-(inv[0] * m[4] + inv[2] * m[5]), -(inv[1] * m[4] + inv[3] * m[5])]
        dmap = {d: i + 1 for i, d in enumerate(depths)}
        timeline = []
        for e in src['timeline']:
            if not f0 <= e['frame'] <= f1:
                continue
            ch = []
            for c in e.get('changes', []):
                d = c.get('remove', c.get('update', c.get('depth')))
                if d not in dmap:
                    continue
                c = dict(c)
                for k in ('remove', 'update', 'depth'):
                    if k in c:
                        c[k] = dmap[d]
                if 'x' in c:
                    mm = list(c.pop('matrix', [1, 0, 0, 1]))
                    sc = c.pop('scale', None)
                    if sc is not None:
                        mm = [sc[0] if isinstance(sc, list) else sc, 0, 0, sc[1] if isinstance(sc, list) else sc]
                    full = mul(inv, mm + [c.pop('x'), c.pop('y')])
                    o = {}
                    encode_matrix(full, o)
                    c = {**{k: v for k, v in c.items() if k in ('place', 'replace', 'update', 'remove', 'depth')}, **o,
                         **{k: v for k, v in c.items() if k not in ('place', 'replace', 'update', 'remove', 'depth')}}
                ch.append(c)
            entry = {'frame': e['frame'] - f0 + 1}
            if e['frame'] == f1:
                entry['script'] = 'stop();'
            if ch:
                entry['changes'] = ch
            if len(entry) > 1:
                timeline.append(entry)
        self.new_files[new] = ('json', {'kind': 'sprite', 'symbol': {'type': 'graphic'}, 'frames': f1 - f0 + 1, 'timeline': timeline})
        warn('%s rebuilt as "%s" from its flattened copy in %s' % (name, new, holder))
        return new

    def convert_symbol(self, name, dest=None):
        dest = dest or name
        root = self.syms[name]
        stype = root.get('symbolType') or 'movie clip'
        tl = root.find(NS + 'timeline/' + NS + 'DOMTimeline')
        sym = {'type': stype}
        if root.get('linkageIdentifier'):
            sym['linkage'] = root.get('linkageIdentifier')
        if stype == 'button':
            self.new_files[dest] = ('json', self.convert_button(tl, dest, sym))
        else:
            o = {'kind': 'sprite', 'symbol': sym}
            o.update(self.convert_timeline(tl, dest))
            if root.find(NS + 'scaleGrid') is not None or root.get('scaleGridLeft'):
                warn('%s: 9-slice scaling not converted' % name)
            self.new_files[dest] = ('json', o)
        return dest

    def new_shape(self, owner, shape):
        n = 1
        while '%s/shape %d' % (owner, n) in self.new_files or '%s/shape %d' % (owner, n) in self.have:
            n += 1
        nm = '%s/shape %d' % (owner, n)
        self.new_files[nm] = ('json', shape)
        return nm

    def frame_elements(self, frame, owner):
        """DOMFrame -> list of display items: ('inst', el, matrix) or ('shape', source name)"""
        els = frame.find(NS + 'elements')
        items = []
        pending = []

        def flush():
            if pending:
                items.append({'kind': 'shape', 'ref': self.new_shape(owner, build_shape(list(pending))), 'm': list(IDENT)})
                pending.clear()

        def walk(elements, gm):
            for el in elements:
                t = el.tag[len(NS):]
                if t == 'DOMShape':
                    m = mul(gm, mat_el(el))
                    pending.append(shape_parts(el, m, self))
                elif t == 'DOMGroup':
                    mem = el.find(NS + 'members')
                    walk(list(mem) if mem is not None else [], gm)
                elif t == 'DOMSymbolInstance':
                    flush()
                    items.append({'kind': 'inst', 'el': el, 'ref': self.ref(html.unescape(el.get('libraryItemName'))),
                                  'm': mul(gm, mat_el(el))})
                elif t == 'DOMBitmapInstance':
                    flush()
                    bname = html.unescape(el.get('libraryItemName'))
                    bm = self.bitmaps[bname]
                    w, h = float(bm.get('frameRight', 0)) / TW, float(bm.get('frameBottom', 0)) / TW
                    ref = self.bitmap_ref(bname)
                    sm = self.bitmap_smooth(bname)
                    shape = {'kind': 'shape', 'bounds': [0, rnd(w, 2), 0, rnd(h, 2)],
                             'fills': [{'type': 'clipped bitmap' + ('' if sm else ' (unsmoothed)'), 'bitmap': ref,
                                        'm': [1, 0, 0, 1, 0, 0], 'repeat': False, 'smooth': sm}],
                             'lines': [], 'paths': [{'fill': 0, 'd': 'M 0 0 L %s 0 L %s %s L 0 %s L 0 0 Z' % (rnd(w, 2), rnd(w, 2), rnd(h, 2), rnd(h, 2))}]}
                    key = ('bitmap', bname)
                    if key not in self.new_files:
                        self.new_files[key] = self.new_shape(owner, shape)
                    items.append({'kind': 'shape', 'ref': self.new_files[key], 'm': mul(gm, mat_el(el)), 'el': el})
                elif t in ('DOMStaticText', 'DOMDynamicText', 'DOMInputText'):
                    flush()
                    warn('%s: %s not converted' % (owner, t))
                else:
                    flush()
                    warn('%s: element %s not converted' % (owner, t))
        walk(list(els) if els is not None else [], list(IDENT))
        flush()
        return items

    def is_graphic(self, el):
        t = el.get('symbolType')
        if t is None:
            s = self.syms.get(html.unescape(el.get('libraryItemName')))
            t = (s.get('symbolType') if s is not None else None) or 'movie clip'
        return t == 'graphic'

    def model(self, tl, owner):
        """timeline -> model {'nframes', 'span', 'state': f -> {depth: state}}"""
        if owner not in self.models:
            self.models[owner] = self._model(tl, owner)
        return self.models[owner]

    def _model(self, tl, owner):
        layers = tl.findall(NS + 'layers/' + NS + 'DOMLayer')
        ltype = [l.get('layerType', 'normal') for l in layers]

        def parent_type(l):
            p = l.get('parentLayerIndex')
            return ltype[int(p)] if p is not None else None

        # bottom-up order, each mask before the layers it masks
        order, deferred = [], {}
        for li in range(len(layers) - 1, -1, -1):
            l = layers[li]
            if ltype[li] in ('guide', 'folder'):
                continue
            if parent_type(l) == 'mask':
                deferred.setdefault(int(l.get('parentLayerIndex')), []).append(li)
                continue
            order.append(li)
            if ltype[li] == 'mask':
                order += deferred.pop(li, [])
        nframes = 1
        for l in layers:
            for fr in l.findall(NS + 'frames/' + NS + 'DOMFrame'):
                nframes = max(nframes, int(fr.get('index')) + int(fr.get('duration', 1)))

        lay = {}
        for li in order:
            kfs = []
            for fr in layers[li].findall(NS + 'frames/' + NS + 'DOMFrame'):
                if fr.get('tweenType') == 'shape':
                    warn('%s: shape tween held at its keyframes' % owner)
                items = self.frame_elements(fr, owner)
                for it in items:
                    it['span'] = 1
                    el = it.get('el')
                    if it['kind'] == 'inst' and self.is_graphic(el):
                        name = html.unescape(el.get('libraryItemName'))
                        if name in FLATTENED:
                            it['sub'] = self.flat_model(name)
                        elif name in self.syms:
                            it['sub'] = self.model(self.syms[name].find(NS + 'timeline/' + NS + 'DOMTimeline'), name)
                        if 'sub' in it:
                            it['span'] = it['sub']['span']
                off = 0
                for it in items:
                    it['off'] = off
                    off += it['span']
                kfs.append({'i': int(fr.get('index')), 'n': int(fr.get('duration', 1)), 'el': fr, 'items': items, 'span': off})
            lay[li] = kfs
        depth_base, d = {}, 0
        for li in order:
            depth_base[li] = d
            d += max([k['span'] for k in lay[li]] + [1])
        span = d
        mask_clip = {}
        for li in order:
            if ltype[li] == 'mask':
                kids = [k for k in order if parent_type(layers[k]) == 'mask' and int(layers[k].get('parentLayerIndex')) == li]
                mask_clip[li] = max([depth_base[k] + max([x['span'] for x in lay[k]] + [1]) for k in kids] + [depth_base[li] + 1])

        def state(f):
            out = {}
            for li in order:
                kfs = lay[li]
                for ki, k in enumerate(kfs):
                    if k['i'] <= f < k['i'] + k['n']:
                        break
                else:
                    continue
                nxt = kfs[ki + 1] if ki + 1 < len(kfs) else None
                for ei, it in enumerate(k['items']):
                    st = {'key': (li, k['i'], ei), 'ref': it['ref'], 'm': it['m'], 'it': it}
                    el = it.get('el')
                    if el is not None and it['kind'] == 'inst':
                        st['cx'] = color_effect(el)
                        st['filters'] = filters_of(el)
                        st['blend'] = el.get('blendMode')
                        st['name'] = el.get('name')
                    if (k['el'].get('tweenType') == 'motion' and nxt is not None and f > k['i']
                            and ei < len(nxt['items']) and nxt['items'][ei]['ref'] == it['ref']):
                        t = ease_fn(k['el'])((f - k['i']) / float(k['n']))
                        tpe = el.find(NS + 'transformationPoint/' + NS + 'Point') if el is not None else None
                        tp = (float(tpe.get('x', 0)), float(tpe.get('y', 0))) if tpe is not None else (0.0, 0.0)
                        st['m'] = tween_matrix(it['m'], nxt['items'][ei]['m'], tp, t, k['el'])
                        nel = nxt['items'][ei].get('el')
                        c0 = st.get('cx') or [1, 1, 1, 1, 0, 0, 0, 0]
                        c1 = (color_effect(nel) if nel is not None else None) or [1, 1, 1, 1, 0, 0, 0, 0]
                        if c0 != c1:
                            st['cx'] = [a + (b - a) * t for a, b in zip(c0, c1)]
                    base = depth_base[li] + it['off']
                    if 'sub' in it:
                        # graphic symbol: Flash flattens its content into this timeline
                        sub = it['sub']
                        first = int(el.get('firstFrame', 0))
                        loop = el.get('loop', 'loop')
                        local = first + (f - k['i'])
                        if loop == 'single frame':
                            local = first
                        elif loop == 'play once':
                            local = min(local, sub['nframes'] - 1)
                        else:
                            local %= sub['nframes']
                        pc = st.get('cx')
                        for cd, cs in sub['state'](local).items():
                            cs = dict(cs)
                            cs['key'] = (st['key'], cs['key'])
                            cs['m'] = mul(st['m'], cs['m'])
                            if pc:
                                cc = cs.get('cx') or [1, 1, 1, 1, 0, 0, 0, 0]
                                cs['cx'] = [cc[i] * pc[i] for i in range(4)] + [cc[4 + i] * pc[i] + pc[4 + i] for i in range(4)]
                            if cs.get('clip'):
                                cs['clip'] += base
                            if li in mask_clip:
                                cs['clip'] = mask_clip[li]
                            out[base + cd] = cs
                        continue
                    if li in mask_clip:
                        st['clip'] = mask_clip[li]
                    out[base + 1] = st
            return out

        scripts, labels = {}, {}
        for l in layers:
            if l.get('layerType') in ('guide', 'folder'):
                continue
            for fr in l.findall(NS + 'frames/' + NS + 'DOMFrame'):
                idx = int(fr.get('index'))
                if fr.get('name') and fr.get('labelType', 'name') == 'name':
                    labels.setdefault(idx + 1, []).append(fr.get('name'))
                for scr in fr.findall(NS + 'Actionscript/' + NS + 'script'):
                    scripts.setdefault(idx + 1, []).append((scr.text or '').replace('\r\n', '\n').replace('\r', '\n'))
        return {'nframes': nframes, 'span': span, 'state': state, 'scripts': scripts, 'labels': labels}

    def convert_timeline(self, tl, owner):
        md = self.model(tl, owner)
        nframes, scripts, labels = md['nframes'], md['scripts'], md['labels']
        timeline = []
        prev = {}
        for f in range(nframes):
            cur = md['state'](f)
            changes = []
            for dpt in sorted(prev):
                if dpt not in cur:
                    changes.append({'remove': dpt})
            for dpt in sorted(cur):
                s, p = cur[dpt], prev.get(dpt)
                props = self.props(s)
                if p is None or (p['key'] != s['key'] and (p['ref'] != s['ref'] or p.get('name') != s.get('name')
                                                            or p['it']['kind'] != 'inst')):
                    if p is not None:
                        changes.append({'remove': dpt})
                    c = {'place': s['ref'], 'depth': dpt}
                    c.update(props)
                    el = s['it'].get('el')
                    if el is not None and s['it']['kind'] == 'inst':
                        src = [x.text or '' for x in el.findall(NS + 'Actionscript/' + NS + 'script')]
                        if src:
                            c['script'] = encode_script('\n'.join(src).replace('\r\n', '\n').replace('\r', '\n'))
                    changes.append(c)
                elif p['key'] == s['key'] and p['ref'] != s['ref']:
                    c = {'replace': s['ref'], 'depth': dpt}
                    pp = self.props(p)
                    c.update({k: v for k, v in props.items() if pp.get(k) != v or k == 'ratio'})
                    changes.append(c)
                else:
                    pp = self.props(p)
                    diff = {k: v for k, v in props.items() if pp.get(k) != v}
                    for k in pp:
                        if k not in props:
                            diff[k] = {'color': {}, 'filters': [], 'blend': 'normal'}.get(k)
                    if diff:
                        c = {'update': dpt}
                        if any(k in diff for k in ('x', 'y', 'scale', 'matrix')):
                            for k in ('x', 'y', 'scale', 'matrix'):
                                diff.pop(k, None)
                            encode_matrix(s['m'], c)
                        c.update({k: v for k, v in diff.items() if v is not None})
                        changes.append(c)
            entry = {'frame': f + 1}
            if f + 1 in labels:
                entry['label'] = labels[f + 1][0] if len(labels[f + 1]) == 1 else labels[f + 1]
            if f + 1 in scripts:
                entry['script'] = encode_script('\n'.join(scripts[f + 1]))
            if changes:
                entry['changes'] = changes
            if len(entry) > 1:
                timeline.append(entry)
            prev = cur
        return {'frames': nframes, 'timeline': timeline}

    def props(self, s):
        o = {}
        encode_matrix(s['m'], o)
        if s.get('name'):
            o['name'] = s['name']
        if s.get('cx'):
            c = encode_cx(s['cx'])
            if c:
                o['color'] = c
        if s.get('filters'):
            o['filters'] = s['filters']
        if s.get('blend') and s['blend'] != 'normal':
            o['blend'] = s['blend']
        if s.get('clip'):
            o['clipDepth'] = s['clip']
        if s.get('ratio') is not None:
            o['ratio'] = s['ratio']
        return o

    def convert_button(self, tl, owner, sym):
        warn('%s: button converted from its four frames' % owner)
        states = ['up', 'over', 'down', 'hit']
        records = []
        layers = tl.findall(NS + 'layers/' + NS + 'DOMLayer')
        depth = 0
        for li in range(len(layers) - 1, -1, -1):
            if layers[li].get('layerType') in ('guide', 'folder'):
                continue
            for fr in layers[li].findall(NS + 'frames/' + NS + 'DOMFrame'):
                i, n = int(fr.get('index')), int(fr.get('duration', 1))
                st = [states[k] for k in range(i, min(i + n, 4))]
                for it in self.frame_elements(fr, owner):
                    depth += 1
                    r = {'symbol': it['ref'], 'depth': depth}
                    encode_matrix(it['m'], r)
                    r['states'] = st
                    records.append(r)
        return {'kind': 'button', 'symbol': sym, 'records': records}

    # -- output --------------------------------------------------------------
    def write(self, dry):
        written = []
        clash = [n for n in self.new_files if isinstance(n, str) and n in self.have]
        if clash:
            raise SystemExit('refusing to overwrite existing source files: %s' % ', '.join(clash))
        for name, v in self.new_files.items():
            if not isinstance(name, str):
                continue
            kind, data = v
            p = os.path.join(self.out, name_to_path(name) + ('.png' if kind == 'png' else '.json'))
            if os.path.exists(p):
                raise SystemExit('refusing to overwrite ' + p)
            written.append(p)
            if dry:
                continue
            os.makedirs(os.path.dirname(p), exist_ok=True)
            if kind == 'png':
                open(p, 'wb').write(data)
            else:
                open(p, 'w').write(pretty(data) + '\n')
        return written


def encode_script(s):
    if '\n' not in s:
        return re.sub(r'^\t+', lambda m: '    ' * len(m.group(0)), s)
    return [re.sub(r'^\t+', lambda m: '    ' * len(m.group(0)), l) for l in s.split('\n')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xfl')
    ap.add_argument('--out', default=None)
    ap.add_argument('--src', default=os.path.join(os.path.dirname(__file__), '..', '..', 'source', 'library'))
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--calibrate', nargs='*')
    ap.add_argument('--no-bitmaps', action='store_true', help='skip unused library bitmaps')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    src = os.path.abspath(a.src)
    out = os.path.abspath(a.out or src)
    c = Converter(a.xfl, src, out)
    if a.calibrate:
        for n in a.calibrate:
            c.convert_symbol(n)
    else:
        todo = a.only or sorted(n for n in c.syms if n not in c.have and n not in SKIP)
        for n in todo:
            c.convert_symbol(n)
        if not a.only and not a.no_bitmaps:
            for n in sorted(c.bitmaps):
                c.bitmap_ref(n)
    files = c.write(a.dry_run)
    for f in files:
        print(('would write ' if a.dry_run else 'wrote ') + os.path.relpath(f, out))
    for b, s in sorted(c.bmp_names.items()):
        print('bitmap %-50s -> %s' % (b, s))
    for w in warnings:
        print('warning:', w)


if __name__ == '__main__':
    main()

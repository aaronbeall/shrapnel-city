"""Read the editable vector document inside a Fireworks PNG (.fw.png).

A Fireworks PNG is a normal PNG (the flattened image) plus private chunks:
  mkTS  zlib: the document as a tag tree. Each node is a 3-letter tag, a type
        letter and a {...} body: v = list of child nodes, s = u16 length +
        UTF-16BE string, i = hex int (signed 32-bit), b = hex bool, f = float.
  mkBT  one 128x128 bitmap tile: "FACECAFE", u32 tile id, 68 zero bytes, then
        zlib of 65536 bytes ARGB.
  mkBS, prVW, mkBF  not needed here.

Document: MKB > LYL > LAY (layers, bottom first; LNM name) > CLL > CEL > ELM
(elements, TOP first) > PTH | GRP | IMG. VIS{0} hides an element.
  PTH  path. PAT holds FCL fill / BCL stroke colour (ARGB), FPL fill (CAT
       fc_Solid / fc_Linear / fc_Circular / fc_Elliptical; gradient stops in
       FGL > FGY > FG0 colours + FG1 opacities, FGP position, FGC ARGB) and BPL
       brush (present = stroked, BDI size). PSX/PSY gradient start, PEX/PEY end,
       PFX/PFY second axis. PBL > PBP contours (ISC closed) > PBT points:
       XLC/YLC anchor, XPC/YPC incoming and XSC/YSC outgoing cubic control (an
       omitted control coordinate equals the anchor's). OPA opacity /1000,
       BLD blend mode, EFL > EPS > DCE effects as DCK/DCV string pairs.
  GRP  group: ELM children, GRT 1 = mask group (first child is the mask; MNA
       1 = mask by alpha), OPA, EFL.
  IMG  bitmap: XLC/YLC position, WPX/HPX size, TIL lists the tiles row by row
       (TID tile id, or TMC = an empty tile filled with that ARGB value).
Coordinates are document pixels; groups carry no transform.
"""
import struct, zlib, math, sys
import numpy as np

def chunks(path):
    b = open(path, 'rb').read()
    p = 8
    while p < len(b):
        n, t = struct.unpack('>I4s', b[p:p + 8])
        yield t.decode('latin1'), b[p + 8:p + 8 + n]
        p += 12 + n

def parse(b, p=0, end=None):
    out = []
    end = len(b) if end is None else end
    while p < end:
        if b[p:p + 1] == b'}':
            return out, p + 1
        tag = b[p:p + 3].decode('latin1'); ty = chr(b[p + 3]); p += 5
        if ty == 'v':
            val, p = parse(b, p, end)
        elif ty == 's':
            n = int.from_bytes(b[p:p + 2], 'big'); val = b[p + 2:p + 2 + 2 * n].decode('utf-16-be'); p += 3 + 2 * n
        else:
            q = b.index(b'}', p); s = b[p:q].decode('latin1'); p = q + 1
            val = int(s, 16) if ty in 'ib' else float(s)
            if ty == 'i' and val >= 1 << 31: val -= 1 << 32
        out.append((tag, ty, val))
    return out, p

def g(v, tag, d=None):
    if v is None: return d
    for tg, ty, x in v:
        if tg == tag: return x
    return d

def ga(v, tag):
    return [x for tg, ty, x in (v or []) if tg == tag]

def argb(i):
    i &= 0xffffffff
    return ((i >> 16) & 255, (i >> 8) & 255, i & 255, (i >> 24) & 255)

def effects(efl):
    out = []
    for eps in ga(efl, 'EPS'):
        d = {}
        for dce in ga(eps, 'DCE'):
            d[g(dce, 'DCK')] = g(dce, 'DCV')
        d['name'] = d.get('mkbFile_WriteOnly_TemporaryEffectUiName') or d.get('name')
        if d.get('EffectIsVisible', 'true') == 'false': continue
        out.append(d)
    return out

def gradient(fpl):
    fgl = g(fpl, 'FGL'); fgy = g(fgl, 'FGY')
    if fgy:
        cols = [(g(i, 'FGP'), argb(g(i, 'FGC'))) for i in ga(g(fgy, 'FG0'), 'FGI')]
        alps = [(g(i, 'FGP'), argb(g(i, 'FGC'))[3]) for i in ga(g(fgy, 'FG1'), 'FGI')]
    else:
        cols = [(g(i, 'FGP'), argb(g(i, 'FGC'))) for i in ga(g(fgl, 'FGV'), 'FGI')]
        alps = [(p, c[3]) for p, c in cols]
    def interp(lst, t, f):
        if t <= lst[0][0]: return f(lst[0][1])
        for (p0, a), (p1, b) in zip(lst, lst[1:]):
            if t <= p1:
                k = 0 if p1 == p0 else (t - p0) / (p1 - p0)
                fa, fb = f(a), f(b)
                return tuple(x + (y - x) * k for x, y in zip(fa, fb))
        return f(lst[-1][1])
    pos = sorted(set([p for p, _ in cols] + [p for p, _ in alps]))
    stops = []
    for t in pos:
        r, gg, b = interp(cols, t, lambda c: c[:3])
        a, = interp(alps, t, lambda a: (a,))
        stops.append((t, (round(r), round(gg), round(b), round(a))))
    return stops

def contours(pth):
    out = []
    for pbp in ga(g(pth, 'PBL'), 'PBP'):
        pts = []
        for pt in ga(pbp, 'PBT'):
            x, y = g(pt, 'XLC'), g(pt, 'YLC')
            pts.append(((x, y), (g(pt, 'XPC', x), g(pt, 'YPC', y)), (g(pt, 'XSC', x), g(pt, 'YSC', y))))
        out.append((bool(g(pbp, 'ISC')), pts))
    return out

def node(tag, v):
    if g(v, 'VIS', 1) == 0: return None
    if tag == 'PTH':
        pat = g(v, 'PAT'); fpl = g(pat, 'FPL'); bpl = g(pat, 'BPL')
        n = dict(kind='path', name=g(v, 'OBN'), contours=contours(v),
                 opacity=g(v, 'OPA', 1000) / 1000, blend=g(v, 'BLD', 0), fx=effects(g(v, 'EFL')))
        if fpl:
            cat = g(fpl, 'CAT')
            n['fill'] = dict(type=cat, color=argb(g(pat, 'FCL')),
                             ps=(g(v, 'PSX'), g(v, 'PSY')), pe=(g(v, 'PEX'), g(v, 'PEY')), pf=(g(v, 'PFX'), g(v, 'PFY')),
                             edge=g(fpl, 'FEF'), feather=g(fpl, 'FRR'))
            if cat != 'fc_Solid': n['fill']['stops'] = gradient(fpl)
            txf = g(pat, 'TXF')
        if bpl:
            n['stroke'] = dict(color=argb(g(pat, 'BCL')), size=g(bpl, 'BDI', 1), name=g(bpl, 'INM'), aa=g(bpl, 'BIA'),
                               place=g(v, 'BRP'))
        return n
    if tag == 'GRP':
        kids = [n for n in (node(t, x) for t, ty, x in g(v, 'ELM') or [] if t in ('PTH', 'GRP', 'IMG')) if n]
        return dict(kind='group', mask=g(v, 'GRT', 0), mna=g(v, 'MNA'), mrx=g(v, 'MRX'), children=kids,
                    opacity=g(v, 'OPA', 1000) / 1000, blend=g(v, 'BLD', 0), fx=effects(g(v, 'EFL')))
    if tag == 'IMG':
        return dict(kind='image', x=g(v, 'XLC'), y=g(v, 'YLC'), xo=g(v, 'XOF'), yo=g(v, 'YOF'), w=g(v, 'WPX'), h=g(v, 'HPX'),
                    tsz=g(v, 'TSZ'), tiles=[(tg, x) for t in ga(v, 'TIL') for tg, _, x in t],
                    opacity=g(v, 'OPA', 1000) / 1000, blend=g(v, 'BLD', 0), fx=effects(g(v, 'EFL')))

class Doc:
    def __init__(self, path):
        self.tiles = {}
        for t, d in chunks(path):
            if t == 'mkTS': ts = zlib.decompress(d)
            elif t == 'mkBT':
                tid = int.from_bytes(d[4:8], 'big')
                self.tiles[tid] = zlib.decompress(d[76:])
        tree, _ = parse(ts)
        mkb = g(tree, 'MKB')
        self.w, self.h = g(mkb, 'WID'), g(mkb, 'HIT'); self.bg = argb(g(mkb, 'BGC'))
        self.layers = []
        for lay in ga(g(mkb, 'LYL'), 'LAY'):
            elms = []
            for cel in ga(g(lay, 'CLL'), 'CEL'):
                elms += [n for n in (node(t, x) for t, ty, x in g(cel, 'ELM') or [] if t in ('PTH', 'GRP', 'IMG')) if n]
            self.layers.append(dict(name=g(lay, 'LNM'), visible=g(g(lay, 'VIF'), 'VIS', 1), children=[bake(e) for e in elms]))

    def image(self, n):
        """RGBA numpy array for an IMG node (tiles row-major, ARGB)."""
        ts = n['tsz'] if n['tsz'] in (128, 256) else 128
        T = 128
        cols = math.ceil(n['w'] / T); rows = math.ceil(n['h'] / T)
        out = np.zeros((rows * T, cols * T, 4), np.uint8)
        for i, tid in enumerate(n['tiles']):
            r, c = divmod(i, cols)
            if r >= rows: break
            kind, tid = tid
            if kind == 'TMC':
                a = np.zeros((T, T, 4), np.uint8); a[:] = [(tid >> 24) & 255, (tid >> 16) & 255, (tid >> 8) & 255, tid & 255]
            else:
                a = np.frombuffer(self.tiles[tid], np.uint8).reshape(T, T, 4)
            out[r * T:(r + 1) * T, c * T:(c + 1) * T] = a[..., [1, 2, 3, 0]]
        return out[:n['h'], :n['w']]

# ---- colour-adjustment effects, baked into fill/stroke colours (they are per-pixel, so this is exact for flat fills)
import colorsys

def _adj(e):
    nm = e.get('name') or ''
    clamp = lambda v: max(0, min(255, v))
    if nm.startswith('Brightness/Contrast'):
        b = float(e.get('brightness_amount', 0)); c = float(e.get('contrast_amount', 0))
        k = (100 + c) / 100 if c >= 0 else (100 + c) / 100
        return lambda r, g_, b_: tuple(clamp((v - 128) * k + 128 + b * 2.55) for v in (r, g_, b_))
    if nm.startswith('Hue/Saturation'):
        H = float(e.get('hue_amount', 0)); S = float(e.get('saturation_amount', 0)); L = float(e.get('lightness_amount', 0))
        col = e.get('hls_colorize') == 'true'
        def f(r, g_, b_):
            h, l, s = colorsys.rgb_to_hls(r / 255, g_ / 255, b_ / 255)
            if col:
                h = (H % 360) / 360; s = max(0, min(1, S / 100))
            else:
                h = (h + H / 360) % 1; s = max(0, min(1, s * (1 + S / 100)))
            l = l + (1 - l) * L / 100 if L > 0 else l * (1 + L / 100)
            return tuple(v * 255 for v in colorsys.hls_to_rgb(h, l, s))
        return f
    if nm == 'Color Fill':
        c = e.get('Color', '#000000'); fc = [int(c[i:i + 2], 16) for i in (1, 3, 5)]; op = float(e.get('Opacity', 100)) / 100
        mode = e.get('Blendmode', '0')
        def f(r, g_, b_):
            src = (r, g_, b_)
            top = [a * b / 255 for a, b in zip(src, fc)] if mode == '4' else fc
            return tuple(s + (t - s) * op for s, t in zip(src, top))
        return f
    return None

ADJUST = ('Brightness/Contrast', 'Hue/Saturation', 'Color Fill', 'Curves', 'Levels', 'Auto Levels')

def bake(n, fns=()):
    """apply colour-adjustment effects to colours, remove them from fx (recursively)"""
    own = [f for f in (_adj(e) for e in n.get('fx', [])) if f]
    n['fx'] = [e for e in n.get('fx', []) if not (e.get('name') or '').startswith(ADJUST)]
    fns = tuple(own) + tuple(fns)  # own effects first, then the enclosing groups'
    def tc(c):
        rgb = c[:3]
        for f in fns: rgb = f(*rgb)
        return tuple(int(round(v)) for v in rgb) + (c[3],)
    if fns and n['kind'] == 'path':
        if 'fill' in n:
            n['fill']['color'] = tc(n['fill']['color'])
            if 'stops' in n['fill']: n['fill']['stops'] = [(p, tc(c)) for p, c in n['fill']['stops']]
        if 'stroke' in n: n['stroke']['color'] = tc(n['stroke']['color'])
    if n['kind'] == 'image' and fns:
        n['adjust'] = fns
    for k in n.get('children', []): bake(k, fns)
    return n

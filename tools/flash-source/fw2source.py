#!/usr/bin/env python3
"""Convert designs drawn in a Fireworks PNG (.fw.png) into source/ vector symbols.

  python3 tools/flash-source/fw2source.py tools/flash-source/fw-designs/enemies.json [--dry-run]

The JSON names the .fw.png, the layer, the library folder and each design's
elements (their indices in that layer, top first, hidden elements skipped; run
with --list to print them with their bounds). Every design becomes a movie clip
symbol `<folder>/<name>`, centred on its bounds, made of shapes as in the rest of
source/:

  - Fireworks paths are cubic; Flash shapes are quadratic, so each cubic is
    split into quadratics within 0.05 px.
  - Solid, linear, radial and elliptical gradient fills, 1 px strokes.
  - Paths that have effects, opacity or a blend mode get their own shape
    instance; consecutive plain paths share one shape.
  - Groups with effects, opacity or a mask become a nested clip. Mask groups
    clip their contents with the mask's shape (bitmap masks: its bounds).
  - Effects map to Flash filters: drop shadow, inner shadow, inner bevel, inner
    glow, glow and gaussian blur. Colour adjustments (brightness/contrast,
    hue/saturation, colour fill) are baked into the colours.
  - Bitmaps are cropped to their pixels and written as PNGs.

Like fla2source.py it only adds files and refuses to overwrite existing ones.
"""
import argparse, io, json, math, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fwpng import Doc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, 'source', 'library')
BLEND = {46: 'screen'}  # Fireworks blend ids seen in our files; others draw as normal
TOL = 0.05


def rnd(v, n=2):
    v = round(v, n)
    return int(v) if v == int(v) else v


def hexc(c, alpha=1.0):
    a = round(c[3] * alpha)
    s = '#%02x%02x%02x' % tuple(int(round(x)) for x in c[:3])
    return s if a >= 255 else s + '%02x' % max(0, a)


# ---- geometry
def cubic_to_quads(p0, p1, p2, p3, depth=0):
    """approximate a cubic bezier with quadratics, error <= TOL"""
    err = math.hypot(p3[0] - 3 * p2[0] + 3 * p1[0] - p0[0], p3[1] - 3 * p2[1] + 3 * p1[1] - p0[1]) * math.sqrt(3) / 36
    if err <= TOL or depth > 8:
        q = ((3 * (p1[0] + p2[0]) - p0[0] - p3[0]) / 4, (3 * (p1[1] + p2[1]) - p0[1] - p3[1]) / 4)
        return [(q, p3)]
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    a, b, c = mid(p0, p1), mid(p1, p2), mid(p2, p3)
    d, e = mid(a, b), mid(b, c)
    m = mid(d, e)
    return cubic_to_quads(p0, a, d, m, depth + 1) + cubic_to_quads(m, e, c, p3, depth + 1)


def path_d(contours, ox, oy, close_all):
    out = []
    f = lambda p: ' %s %s' % (rnd(p[0] - ox), rnd(p[1] - oy))
    for closed, pts in contours:
        if not pts:
            continue
        s = ['M' + f(pts[0][0])]
        segs = list(zip(pts, pts[1:])) + ([(pts[-1], pts[0])] if closed or close_all else [])
        for a, b in segs:
            p0, c1, c2, p3 = a[0], a[2], b[1], b[0]
            if c1 == p0 and c2 == p3:
                s.append(' L' + f(p3))
            else:
                for q, e in cubic_to_quads(p0, c1, c2, p3):
                    s.append(' Q' + f(q) + f(e))
        if closed or close_all:
            s.append(' Z')
        out.append(''.join(s))
    return ' '.join(out)


def node_points(n):
    if n['kind'] == 'path':
        w = n['stroke']['size'] / 2 if 'stroke' in n else 0
        for _, pts in n['contours']:
            for a, c1, c2 in pts:
                for p in (a, c1, c2):
                    yield p[0] - w, p[1] - w
                    yield p[0] + w, p[1] + w
    elif n['kind'] == 'image' and n.get('crop'):
        x0, y0, x1, y1 = n['crop']
        yield n['x'] + x0, n['y'] + y0
        yield n['x'] + x1, n['y'] + y1
    kids = n.get('children', [])
    for k in kids[1:] if n.get('mask') else kids:  # a mask adds no pixels of its own
        yield from node_points(k)


# ---- paint
def fill_of(f, ox, oy, alpha):
    t = f['type']
    if t == 'fc_Solid' or 'stops' not in f:
        return {'type': 'solid', 'color': hexc(f['color'], alpha)}
    (sx, sy), (ex, ey), (fx, fy) = f['ps'], f['pe'], f['pf']
    stops = [[rnd(p, 4), hexc(c, alpha)] for p, c in f['stops']]
    ax, ay = ex - sx, ey - sy
    if t == 'fc_Linear':  # unit gradient box -1..1 spans start..end
        m = [ax / 2, ay / 2, -ay / 2, ax / 2, (sx + ex) / 2 - ox, (sy + ey) / 2 - oy]
        kind = 'linear gradient'
    else:
        bx, by = (-ay, ax) if t == 'fc_Circular' else (fx - sx, fy - sy)
        m = [ax, ay, bx, by, sx - ox, sy - oy]
        kind = 'radial gradient'
    return {'type': kind, 'm': [rnd(v, 4) for v in m], 'spread': 0, 'interp': 0, 'stops': stops}


def flash_angle(fw_deg):
    """Fireworks angles run counter-clockwise with y up; Flash's clockwise with y down"""
    return rnd(math.radians((360 - float(fw_deg)) % 360), 6)


def filters_of(fx):
    out = []
    for e in fx:
        nm = e.get('name') or ''
        if nm in ('Drop Shadow', 'Inner Shadow'):
            c = e.get('ShadowColor', '#000000')
            b = float(e.get('ShadowBlur', 4))
            out.append({'type': 'dropShadow', 'color': c if len(c) > 7 else c, 'blurX': rnd(b * 2), 'blurY': rnd(b * 2),
                        'angle': flash_angle(e.get('ShadowAngle', 315)), 'distance': float(e.get('ShadowDistance', 7)),
                        'strength': 1, 'inner': nm == 'Inner Shadow', 'knockout': False, 'passes': 2})
        elif nm == 'Inner Bevel':
            w = float(e.get('BevelWidth', 10)); con = float(e.get('BevelContrast', 75)) / 100
            # the light comes from LightAngle, so the shadow side is the opposite way
            ang = flash_angle(float(e.get('LightAngle', 135)) + 180)
            out.append({'type': 'bevel', 'shadow': '#000000%02x' % round(255 * con), 'highlight': '#ffffff%02x' % round(255 * con),
                        'blurX': rnd(w), 'blurY': rnd(w), 'angle': ang, 'distance': rnd(max(1, w / 3)), 'strength': 1,
                        'inner': True, 'knockout': False, 'onTop': False, 'passes': 2})
        elif nm in ('Inner Glow', 'Glow'):
            w = float(e.get('GlowWidth', 4)) + float(e.get('MaskSoftness', 4))
            a = float(e.get('BevelContrast', 65)) / 100
            out.append({'type': 'glow', 'color': e.get('OuterBevelColor', '#ffffff')[:7] + '%02x' % round(255 * a),
                        'blurX': rnd(w * 2), 'blurY': rnd(w * 2), 'strength': 1, 'inner': nm == 'Inner Glow',
                        'knockout': False, 'passes': 2})
        elif nm.startswith('Gaussian Blur'):
            r = float(e.get('gaussian_blur_radius', 2))
            out.append({'type': 'blur', 'blurX': rnd(r * 2), 'blurY': rnd(r * 2), 'passes': 2})
        elif not nm.startswith(('Curves', 'Levels', 'Auto Levels')):
            print('  effect %r not converted' % nm)
    return out


def plain(n):
    return not n.get('fx') and not BLEND.get(n.get('blend')) and (n['kind'] != 'group' or (n.get('opacity', 1) >= 1 and not n.get('mask')))


# ---- emitter
class Emitter:
    def __init__(self, doc, dry):
        self.doc, self.dry, self.files = doc, dry, {}

    def new(self, sym, kind):
        k = 1
        while '%s/%s %d' % (sym, kind, k) in self.files:
            k += 1
        name = '%s/%s %d' % (sym, kind, k)
        self.files[name] = None
        return name

    def shape(self, sym, paths, ox, oy, alpha=1.0):
        fills, lines, out, pts = [], [], [], []
        for n in paths:
            a = alpha * (n.get('opacity', 1) if plain(n) else 1)
            if 'fill' in n:
                fills.append(fill_of(n['fill'], ox, oy, a))
                out.append({'fill': len(fills) - 1, 'd': path_d(n['contours'], ox, oy, True)})
            if 'stroke' in n:
                lines.append({'width': n['stroke']['size'], 'cap': 0, 'ecap': 0, 'join': 0, 'noScale': False, 'noClose': False,
                              'color': hexc(n['stroke']['color'], a)})
                out.append({'line': len(lines) - 1, 'd': path_d(n['contours'], ox, oy, False)})
            pts += list(node_points(n))
        xs = [p[0] - ox for p in pts]; ys = [p[1] - oy for p in pts]
        name = self.new(sym, 'shape')
        self.files[name] = {'kind': 'shape', 'bounds': [rnd(min(xs) - 1), rnd(max(xs) + 1), rnd(min(ys) - 1), rnd(max(ys) + 1)],
                            'fills': fills, 'lines': lines, 'paths': out}
        return name

    def image(self, sym, n, ox, oy):
        px = self.doc.image(n).copy()
        if n.get('adjust'):
            rgb = px[..., :3].reshape(-1, 3).astype(float)
            for f in n['adjust']:
                rgb = np.array([f(*c) for c in rgb])
            px[..., :3] = np.clip(rgb, 0, 255).reshape(px.shape[:2] + (3,)).astype(np.uint8)
        ys, xs = np.nonzero(px[..., 3])
        if not len(xs):
            return None
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        bmp = self.new(sym, 'bitmap')
        buf = io.BytesIO(); Image.fromarray(px[y0:y1, x0:x1], 'RGBA').save(buf, 'PNG', optimize=True)
        self.files[bmp] = buf.getvalue()
        X, Y = n['x'] + x0 - ox, n['y'] + y0 - oy
        w, h = x1 - x0, y1 - y0
        name = self.new(sym, 'shape')
        self.files[name] = {'kind': 'shape', 'bounds': [rnd(X), rnd(X + w), rnd(Y), rnd(Y + h)],
                            'fills': [{'type': 'clipped bitmap', 'bitmap': bmp, 'm': [1, 0, 0, 1, rnd(X), rnd(Y)], 'repeat': False, 'smooth': True}],
                            'lines': [], 'paths': [{'fill': 0, 'd': 'M %s %s L %s %s L %s %s L %s %s Z' % (rnd(X), rnd(Y), rnd(X + w), rnd(Y), rnd(X + w), rnd(Y + h), rnd(X), rnd(Y + h))}]}
        return name

    def props(self, n):
        p = {}
        if n.get('opacity', 1) < 1 and not (n['kind'] == 'path' and plain(n)):
            p['color'] = {'alpha': rnd(n['opacity'], 3)}
        if BLEND.get(n.get('blend')):
            p['blend'] = BLEND[n['blend']]
        f = filters_of(n.get('fx') or [])
        if f:
            p['filters'] = f
        return p

    def items(self, sym, nodes, ox, oy):
        """nodes bottom first -> list of (symbol name, props)"""
        out, run = [], []
        flush = lambda: (out.append((self.shape(sym, run, ox, oy), {})), run.clear()) if run else None
        for n in nodes:
            if n['kind'] == 'path' and plain(n):
                run.append(n)
                continue
            if n['kind'] == 'group' and plain(n):
                flush()
                out += self.items(sym, list(reversed(n['children'])), ox, oy)
                continue
            flush()
            if n['kind'] == 'path':
                out.append((self.shape(sym, [n], ox, oy), self.props(n)))
            elif n['kind'] == 'image':
                s = self.image(sym, n, ox, oy)
                if s:
                    out.append((s, self.props(n)))
            else:
                out.append((self.clip(sym, n, ox, oy), self.props(n)))
        flush()
        return out

    def timeline(self, items, mask=None):
        changes, depth = [], 1
        if mask:
            changes.append({'place': mask, 'depth': 1, 'x': 0, 'y': 0, 'clipDepth': len(items) + 1})
            depth = 2
        for name, p in items:
            changes.append({'place': name, 'depth': depth, 'x': 0, 'y': 0, **p})
            depth += 1
        return {'kind': 'sprite', 'frames': 1, 'timeline': [{'frame': 1, 'changes': changes}]}

    def clip(self, sym, n, ox, oy):
        kids = list(n['children'])
        mask = None
        if n.get('mask') and kids:
            m = kids.pop(0)  # the top element of a mask group is the mask
            if m['kind'] == 'image':
                cx0, cy0, cx1, cy1 = m.get('crop') or (0, 0, m['w'], m['h'])
                x0, y0 = m['x'] + cx0 - ox, m['y'] + cy0 - oy
                x1, y1 = m['x'] + cx1 - ox, m['y'] + cy1 - oy
                mask = self.new(sym, 'shape')
                self.files[mask] = {'kind': 'shape', 'bounds': [rnd(x0), rnd(x1), rnd(y0), rnd(y1)], 'fills': [{'type': 'solid', 'color': '#000000'}],
                                    'lines': [], 'paths': [{'fill': 0, 'd': 'M %s %s L %s %s L %s %s L %s %s Z' % (rnd(x0), rnd(y0), rnd(x1), rnd(y0), rnd(x1), rnd(y1), rnd(x0), rnd(y1))}]}
            else:
                mask = self.shape(sym, [dict(m, fx=[], opacity=1, blend=0)], ox, oy)
        items = self.items(sym, list(reversed(kids)), ox, oy)
        name = self.new(sym, 'clip')
        self.files[name] = self.timeline(items, mask)
        return name

    def design(self, sym, nodes):
        pts = [p for n in nodes for p in node_points(n)]
        ox = round((min(p[0] for p in pts) + max(p[0] for p in pts)) / 2)
        oy = round((min(p[1] for p in pts) + max(p[1] for p in pts)) / 2)
        items = self.items(sym, list(reversed(nodes)), ox, oy)
        t = self.timeline(items)
        self.files[sym] = {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': 1, 'timeline': t['timeline']}
        return ox, oy

    def write(self):
        paths = {}
        for name, data in self.files.items():
            ext = '.png' if isinstance(data, bytes) else '.json'
            paths[name] = os.path.join(LIB, name + ext)
        clash = [n for n, p in paths.items() if os.path.exists(p)]
        if clash:
            sys.exit('refusing to overwrite existing source files: ' + ', '.join(clash[:8]))
        for name, data in self.files.items():
            if self.dry:
                continue
            os.makedirs(os.path.dirname(paths[name]), exist_ok=True)
            if isinstance(data, bytes):
                open(paths[name], 'wb').write(data)
            else:
                open(paths[name], 'w').write(json.dumps(data, indent=2) + '\n')
        print('%s %d files' % ('would write' if self.dry else 'wrote', len(self.files)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('config')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--list', action='store_true', help='print the layer\'s elements and their bounds')
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    doc = Doc(os.path.join(ROOT, cfg['source']))
    layer = next(l for l in doc.layers if l['name'] == cfg['layer'])['children']

    def crop(n):  # visible bounds of each bitmap
        if n['kind'] == 'image':
            ys, xs = np.nonzero(doc.image(n)[..., 3])
            n['crop'] = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1) if len(xs) else None
        for k in n.get('children', []):
            crop(k)
    for n in layer:
        crop(n)
    if a.list:
        for i, n in enumerate(layer):
            pts = list(node_points(n))
            print(i, n['kind'], [rnd(min(p[0] for p in pts)), rnd(min(p[1] for p in pts)), rnd(max(p[0] for p in pts)), rnd(max(p[1] for p in pts))] if pts else '')
        return
    em = Emitter(doc, a.dry_run)
    for name, idx in cfg['designs'].items():
        sym = cfg['folder'] + '/' + name
        ox, oy = em.design(sym, [layer[i] for i in sorted(idx)])
        print('%-50s centre %s,%s' % (sym, ox, oy))
    em.write()


if __name__ == '__main__':
    main()

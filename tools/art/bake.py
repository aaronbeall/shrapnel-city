"""Bake a level's background art from its collision map, in two independent steps.

    python tools/art/bake.py 03_Bridge place      # collision.png -> decor.json (new decor placements)
    python tools/art/bake.py 03_Bridge bake       # collision.png + decor.json -> background.png
    python tools/art/bake.py 03_Bridge all        # place, then bake
    python tools/art/bake.py 03_Bridge place --seed 7   # a different random layout

Needs numpy, scipy and Pillow. Only levels whose level.json has an "art" section can be
baked, so the original backgrounds (levels 00-02) are never overwritten:

    "art": {"kit": "bridge", "seed": 2012}

- kit: the art kit, i.e. which textures and decor sprites to use. Only "bridge" exists
  (tools/art/parts/: floor, wall and chasm textures plus the decor sprites).
- seed: the random seed for decor placement and the floor's light variation.

The kit's parts were generated with OpenAI gpt-image-2 using only the original levels
(backgrounds 0-2) as style references; the prompts sit next to them. The bake lays them
onto the collision map so the walls you see are the walls you hit:

- floor and chasm textures are tiled; the wall-top texture runs along each wall's
  direction (horizontal, vertical or diagonal)
- walls get rounded corners, a soft bevel lit from the top-left, and dark sides
  extruded toward a camera over the map centre, like the original levels
- the floor gets soft gradient lighting and contact shadows; chasms get a hazard lip
- decor from decor.json is drawn on top: floor paint worn into the floor, wall
  greebles and vents with drop shadows, lights with a glow

decor.json is a list of placements, each {"sprite", "x", "y", "scale", "rotation"} plus
"effect" ("paint", "shadow" or "glow") and its "strength". sprite is a path under
tools/art/parts/decor/, (x, y) the centre in level pixels, scale the sprite's size factor
and rotation in degrees counter-clockwise. The level editor edits it (Decor layer).
"""
import argparse
import io
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(__file__))
from collision import coverage  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
PARTS = os.path.join(os.path.dirname(__file__), 'parts')
DECOR = os.path.join(PARTS, 'decor')
KITS = ('bridge',)


def blur(a, s): return ndi.gaussian_filter(a.astype(np.float32), s, mode='nearest')


def level_paths(folder):
    d = os.path.join(ROOT, 'levels', folder)
    if not os.path.isdir(d): sys.exit(f'no level folder levels/{folder}')
    settings = json.load(open(os.path.join(d, 'level.json'))) if os.path.exists(os.path.join(d, 'level.json')) else {}
    art = settings.get('art')
    if not art: sys.exit(f'levels/{folder}/level.json has no "art" settings, so its background is not baked (it keeps its original art)')
    if art.get('kit') not in KITS: sys.exit(f'unknown art kit {art.get("kit")!r}; known: {", ".join(KITS)}')
    return d, art


# ---------------------------------------------------------------- options
OPTIONS = json.load(open(os.path.join(os.path.dirname(__file__), 'options.json')))


def options(art):
    """The art settings with every option filled in from tools/art/options.json."""
    o = {}
    for group, spec in OPTIONS.items():
        given = art.get(group) or {}
        o[group] = {k: given.get(k, v['default']) for k, v in spec['options'].items()}
    return o


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


# ---------------------------------------------------------------- geometry
class Geometry:
    """Everything derived from the collision map that both steps need."""

    def __init__(self, path, opts):
        with Image.open(path) as im: self.W, self.H = W, H = im.size
        self.wall, self.chasm = coverage(path, W, H)
        self.wallb, self.chasmb = self.wall > 0.5, self.chasm > 0.5
        self.yy, self.xx = np.mgrid[0:H, 0:W].astype(np.float32)
        # rounded art mask: corners rounded by blurring, then a steep ramp so the edge
        # stays crisp (aa px of anti-aliasing, like the originals)
        e = opts['edges']
        if e['round'] > 0:
            k = np.sqrt(2 * np.pi) * e['round'] / max(0.3, e['aa'])
            self.wr = np.clip((blur(self.wall, e['round']) - 0.5) * k + 0.5, 0, 1)
        else:
            self.wr = self.wall.astype(np.float32)
        self.wrb = self.wr > 0.5
        # wall sides: copies of the walls scaled down step by step toward the camera point
        sd = opts['sides']
        self.cx, self.cy = W * sd['cx'], H * sd['cy']
        self.steps = []          # (sample coordinates, mask) per copy, nearest first
        side = np.zeros((H, W), np.float32)
        for i in range(1, int(sd['steps']) + 1):
            f = 1 + sd['scale'] * i  # sample the wall at c + f (p - c): the wall shrunk by 1/f
            coords = [self.cy + f * (self.yy - self.cy), self.cx + f * (self.xx - self.cx)]
            m = ndi.map_coordinates(self.wr, coords, order=1, mode='constant')
            self.steps.append((coords, m))
            side = np.maximum(side, m)
        self.side = side * (1 - self.wr)
        # distance into the wall art and each wall's direction (0 horiz, 1 diag, 2 vert, 3 other diag)
        self.dist = ndi.distance_transform_edt(self.wrb).astype(np.float32)
        ny, nx = np.gradient(blur(self.dist, 4))
        self.q = ndi.median_filter(np.round((np.arctan2(ny, nx) + np.pi / 2) / (np.pi / 4)).astype(int) % 4, 7)


# ---------------------------------------------------------------- textures
def load(name):
    return np.array(Image.open(os.path.join(PARTS, name + '.png')).convert('RGB'), np.float32) / 255


def make_seamless(t, band=96):
    """Cross-fade each edge with the opposite one so the texture wraps cleanly."""
    h, w, _ = t.shape
    for axis, n in ((1, w), (0, h)):
        r = np.roll(t, n // 2, axis=axis)
        ramp = np.clip((np.abs(np.arange(n) - n / 2) - (n / 2 - band)) / band, 0, 1)
        ramp = ramp[None, :, None] if axis == 1 else ramp[:, None, None]
        t = t * (1 - ramp) + r * ramp
    return t


def tiled(g, t, scale, angle=0.0, off=(0.0, 0.0)):
    """Sample texture t over the canvas at `scale` (canvas px per texture px), rotated."""
    h, w, _ = t.shape
    ca, sa = np.cos(angle), np.sin(angle)
    u = (g.xx * ca + g.yy * sa) / scale + off[0]
    v = (-g.xx * sa + g.yy * ca) / scale + off[1]
    return np.stack([ndi.map_coordinates(t[..., c], [v % h, u % w], order=1, mode='grid-wrap') for c in range(3)], -1)


def base_art(g, seed, opts):
    """Floor, chasms and walls, before decor."""
    W, H, xx, yy = g.W, g.H, g.xx, g.yy
    rng = np.random.default_rng(seed)
    floor_t, wall_t, chasm_t = (make_seamless(load(n)) for n in ('floor', 'wall', 'chasm'))
    # floor
    img = tiled(g, floor_t, 0.5)
    img = img / img.mean() * 0.24                                  # match the originals' floor tone
    open_d = ndi.distance_transform_edt(~(g.wallb | g.chasmb)).astype(np.float32)
    light = 0.86 + 0.24 * blur(np.clip(open_d / 90, 0, 1), 12)     # brighter away from walls
    light *= 1 + 0.10 * (blur(rng.random((H // 40 + 1, W // 40 + 1)).repeat(40, 0).repeat(40, 1)[:H, :W], 30) - 0.5)
    img *= light[..., None]
    # chasms
    inside = ndi.distance_transform_edt(g.chasmb).astype(np.float32)
    ch = tiled(g, chasm_t, 0.45, off=(37, 11))
    ch = ch * (0.9 - 0.5 * np.clip(inside / 70, 0, 1))[..., None]
    img = img * (1 - g.chasm[..., None]) + ch * g.chasm[..., None]
    # hazard stripes on the floor around chasms
    hzo = opts['hazard']
    if hzo['width'] > 0 and hzo['opacity'] > 0:
        lip = (ndi.distance_transform_edt(~g.chasmb) <= hzo['width']) & ~g.chasmb & ~g.wallb
        lipf = blur(lip, 0.4) * hzo['opacity']
        a = np.radians(hzo['angle'])
        if hzo.get('texture'):
            hz = tiled(g, load(os.path.splitext(hzo['texture'])[0]), 1.0, a)
        else:
            u = xx * np.cos(a) + yy * np.sin(a)
            stripe = (u % hzo['period']) < hzo['period'] / 2
            hz = np.where(stripe[..., None], hex_rgb(hzo['colourA']), hex_rgb(hzo['colourB']))
        img = img * (1 - lipf[..., None]) + hz * lipf[..., None]
    # ambient occlusion where the walls meet the floor
    wr, side = g.wr, g.side
    ao = blur(np.maximum(side, wr), 5)
    img *= (1 - 0.5 * ao * (1 - wr) * (1 - side))[..., None]
    # wall tops: the plate texture, run along each wall's direction
    top = np.zeros_like(img)
    for k in range(4):
        tk = tiled(g, wall_t, 0.33, k * np.pi / 4, off=(k * 131.0, k * 57.0))
        top += tk * (g.q == k)[..., None]
    top = top / top[g.wrb].mean() * 0.74
    # bevel lit from the top-left, over a narrow band so the edge stays crisp
    hgt = np.clip(g.dist / 5.0, 0, 1); hgt = blur(hgt * hgt * (3 - 2 * hgt), 0.7)
    gy, gx = np.gradient(hgt)
    nz = 0.18
    lam = (-gx * -0.55 - gy * -0.6 + nz * 0.58) / np.sqrt(gx * gx + gy * gy + nz * nz)
    top *= (0.70 + 0.42 * lam)[..., None]
    top *= (1 - 0.22 * np.clip(1 - g.dist / 1.2, 0, 1))[..., None]   # crisp dark edge line
    # wall sides: darkened copies of the wall art, each scaled down a little more toward
    # the camera point, deepest first, so the sides keep the plates' texture
    sd = opts['sides']
    for i in range(len(g.steps) - 1, -1, -1):
        coords, m = g.steps[i]
        copy = np.stack([ndi.map_coordinates(top[..., c], coords, order=1, mode='nearest') for c in range(3)], -1)
        copy *= sd['darken'] * sd['fade'] ** i
        m = m[..., None]
        img = img * (1 - m) + copy * m
    return img * (1 - wr[..., None]) + top * wr[..., None]


# ---------------------------------------------------------------- decor sprites
_sprites = {}


def sprite(path):
    if path not in _sprites: _sprites[path] = Image.open(os.path.join(DECOR, path)).convert('RGBA')
    return _sprites[path]


def xform(sp, scale, rotation):
    """A sprite at its placed size and rotation (degrees counter-clockwise)."""
    w, h = sp.size
    sp = sp.resize((max(2, int(round(w * scale))), max(2, int(round(h * scale)))), Image.LANCZOS)
    return sp.rotate(rotation, resample=Image.BICUBIC, expand=True) if rotation % 360 else sp


# ---------------------------------------------------------------- step 1: place decor
# floor paint first (it sits under everything else), then wall decor, big to small
PASSES = [
    # category, count, surface, short side, long side max, options
    ('floorpaint', 22, 'floor', 40, 80, dict(along=False, unique=True, effect='paint')),
    ('rails', 40, 'lip', 7, 90, dict(orient='lip', min_aspect=6, tries=8000)),
    ('greebles', 70, 'wall', ('wall', 1.0, 44), 60, dict(effect='shadow', strength=0.35)),
    ('vents', 40, 'wall', ('wall', 0.75, 18), 34, dict(effect='shadow', strength=0.3)),
    ('rails', 30, 'wall', ('wall', 0.4, 8), 60, dict(effect='shadow', strength=0.25)),
    ('wallmarks', 40, 'wall', ('wall', 0.75, 16), 30, {}),
    ('lights', 55, 'wall', ('wall', 0.5, 9), 24, dict(effect='glow', strength=0.9)),
]


CATEGORIES = ('panels', 'floorpaint', 'rails', 'greebles', 'vents', 'wallmarks', 'lights')


def category(e):
    if e.get('of') == 'panels': return 'panels'  # a panel's corner lights go with it
    c = e['sprite'].split('/')[0]
    return 'greebles' if c == 'greebles2' else c


def place_panels(g, rng, opts, cats, surface, used, entrance):
    """Floor panels (and their corner lights): one under the entrance, then `count` more."""
    po = opts['panels']
    files = cats.get('panels', [])
    lamps = [f for f in cats.get('lights', []) if 0.8 < sprite(f).size[0] / sprite(f).size[1] < 1.25]  # round/square ones
    out = []
    want = int(po['count']) + (1 if entrance else 0)
    pool = []
    for t in range(6000):
        if len(out) >= want or not files: break
        first = entrance and not out
        if first: cx, cy = entrance
        else:
            pts = np.argwhere(surface)
            if not len(pts): break
            cy, cx = (int(v) for v in pts[rng.integers(len(pts))])
        if not pool: pool = list(files)
        f = pool[int(rng.integers(len(pool)))]
        sp = sprite(f)
        scale = float(rng.uniform(po['minScale'], max(po['minScale'], po['maxScale'])))
        if first: scale = max(scale, 90 / min(sp.size))   # big enough to stand on
        if first and max(sp.size) * scale > 150: continue
        rotation = 90.0 if rng.random() < 0.3 else 0.0
        spx = xform(sp, scale, rotation)
        sw, sh = spx.size
        x0, y0 = int(cx - sw / 2), int(cy - sh / 2)
        if x0 < 0 or y0 < 0 or x0 + sw > g.W or y0 + sh > g.H:
            if first and t > 40: entrance = None  # no panel fits there
            continue
        a = np.array(spx)[..., 3] > 40
        if not first and (not surface[y0:y0 + sh, x0:x0 + sw][a].all() or used[y0:y0 + sh, x0:x0 + sw][a].any()): continue
        used[y0:y0 + sh, x0:x0 + sw] |= ndi.binary_dilation(a, iterations=6)
        pool.remove(f)
        out.append({'sprite': f, 'x': cx, 'y': cy, 'scale': round(scale, 4), 'rotation': rotation, 'effect': 'emboss'})
        if lamps and rng.random() < po['lights']:
            lamp = lamps[int(rng.integers(len(lamps)))]
            ls = 9 / max(sprite(lamp).size)
            for fx in (-1, 1):
                for fy in (-1, 1):
                    out.append({'sprite': lamp, 'x': int(cx + fx * (sw / 2 - 9)), 'y': int(cy + fy * (sh / 2 - 9)), 'scale': round(ls, 4), 'rotation': 0, 'effect': 'glow', 'strength': 0.9, 'of': 'panels'})
    print(f'panels on floor: {sum(1 for e in out if e["effect"] == "emboss")}')
    return out


def place_decor(g, seed, opts, only=None, keep=(), entrance=None):
    """New decor placements. With `only` (a set of categories) just those are placed, after
    `keep` (the existing placements of the other categories, which they avoid)."""
    index = json.load(open(os.path.join(DECOR, 'index.json')))
    cats = {c: [it['file'] for it in items] for c, items in index.items()}
    cats['greebles'] = cats.get('greebles', []) + cats.get('greebles2', [])
    rng = np.random.default_rng(seed + 1)
    H, W = g.H, g.W
    surfaces = {
        'wall': ndi.binary_erosion(g.wrb, iterations=2),
        'floor': ndi.binary_erosion(~(g.wallb | g.chasmb), iterations=10) & (g.side < 0.05),
    }
    cd = ndi.distance_transform_edt(~g.chasmb).astype(np.float32)
    surfaces['lip'] = (cd <= 16) & (cd >= 8) & ~g.wallb
    ly, lx = np.gradient(blur(cd, 3))
    orients = {'lip': ndi.median_filter(np.round((np.arctan2(ly, lx) + np.pi / 2) / (np.pi / 4)).astype(int) % 4, 5)}
    # one rail style per continuous chasm edge: each straight run of the lip band
    edge_ids = np.zeros((H, W), np.int32)
    for k in range(4):
        lab, n = ndi.label(surfaces['lip'] & (orients['lip'] == k))
        edge_ids[lab > 0] = lab[lab > 0] + k * 100000
    edge_pick = {}
    used = np.zeros((H, W), bool)
    out = list(keep)
    for e in keep:  # what stays takes up its space
        try: sp = sprite(e['sprite'])
        except OSError: continue
        a = np.array(xform(sp, float(e.get('scale', 1)), float(e.get('rotation', 0))))[..., 3] > 40
        sh, sw = a.shape
        x0, y0 = int(e['x'] - sw / 2), int(e['y'] - sh / 2)
        sx0, sy0, sx1, sy1 = max(0, -x0), max(0, -y0), min(sw, W - x0), min(sh, H - y0)
        if sx1 > sx0 and sy1 > sy0: used[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1] |= a[sy0:sy1, sx0:sx1]

    if only is None or 'panels' in only:
        out += place_panels(g, rng, opts, cats, surfaces['floor'], used, entrance)
    go = opts['greebles']
    # where an overhanging greeble may reach: near a wall, on open floor (not over a chasm)
    reach = ndi.binary_dilation(g.wrb, iterations=int(go['overhang'])) & ~g.chasmb if go['overhang'] > 0 else g.wrb
    for cat, count, surf, short, long_max, o in PASSES:
        if only is not None and cat not in only: continue
        if cat == 'greebles' and surf == 'wall':
            count, short = int(go['count']), ('wall', 1.0, go['size'])
        surface = surfaces[surf]
        files = [f for f in cats.get(cat, []) if max(sprite(f).size) >= o.get('min_aspect', 0) * min(sprite(f).size)]
        pts = np.argwhere(surface)
        n = 0
        for _ in range(o.get('tries', 4000)):
            if n >= count or not files or not len(pts): break
            cy, cx = (int(v) for v in pts[rng.integers(len(pts))])
            along = o.get('along', True)
            orient = orients[o['orient']] if 'orient' in o else g.q
            ang = orient[cy, cx] * np.pi / 4 if along else 0.0
            over = cat == 'greebles' and go['overhang'] > 0 and rng.random() < go['chance']
            s_ = min(2 * g.dist[cy, cx] - 4 + (2 * go['overhang'] if over else 0), 10_000) * short[1] if isinstance(short, tuple) else short
            if isinstance(short, tuple): s_ = min(s_, short[2])
            if s_ < 5: continue
            k = int(rng.integers(len(files)))
            if surf == 'lip' and edge_ids[cy, cx]:  # the edge's rail, picked by its first one
                k = edge_pick.setdefault(int(edge_ids[cy, cx]), k)
            sp = sprite(files[k])
            w, h = sp.size
            turn = 90 if h > w and along else 0
            if turn: w, h = h, w
            if not along: s_ = s_ * max(w, h) / min(w, h) if h > w else s_
            scale = min(s_ / h, long_max / w)
            rotation = round((turn + np.degrees(-ang)) % 360, 2)
            spx = xform(sp, scale, rotation)
            sw, sh = spx.size
            x0, y0 = int(cx - sw / 2), int(cy - sh / 2)
            if x0 < 0 or y0 < 0 or x0 + sw > W or y0 + sh > H: continue
            a = np.array(spx)[..., 3] > 40
            allowed = reach if over else surface
            if not allowed[y0:y0 + sh, x0:x0 + sw][a].all() or used[y0:y0 + sh, x0:x0 + sw][a].any(): continue
            outside = (~g.wrb[y0:y0 + sh, x0:x0 + sw])[a].sum()
            if over and (outside < 3 or outside > 0.4 * a.sum()): continue  # sticks out, but mostly on the wall
            used[y0:y0 + sh, x0:x0 + sw] |= ndi.binary_dilation(a, iterations=2)
            e = {'sprite': files[k], 'x': cx, 'y': cy, 'scale': round(float(scale), 4), 'rotation': float(rotation)}
            if o.get('effect'): e['effect'] = o['effect']
            if o.get('strength'): e['strength'] = o['strength']
            if over: e['solid'] = True
            out.append(e)
            n += 1
            if o.get('unique'): files.pop(k)
        print(f'{cat} on {surf}: {n}')
    return out


# ---------------------------------------------------------------- step 2: bake
def worn(h, w, seed):
    """Wear mask for painted markings, 1 = paint intact: chipped-off blotches, broad faded
    areas and pinholes, from blurred noise at three scales (like the original floors)."""
    r = np.random.default_rng(seed)
    n = lambda s: (lambda z: (z - z.mean()) / (z.std() + 1e-6))(blur(r.random((h, w)), s))
    chips = np.clip((n(5) + 0.5 * n(2) + 1.0) * 2.5, 0, 1)
    scuff = np.clip(1 - 0.3 * np.clip(n(12) + 0.3, 0, 2), 0.55, 1)
    speck = np.clip((n(0.7) + 2.0) * 1.5, 0, 1)
    return chips * scuff * speck


def bake(g, decor, seed, opts):
    W, H = g.W, g.H
    img = np.clip(base_art(g, seed, opts), 0, 1)
    shadow = np.zeros((H, W), np.float32)
    bloom = np.zeros((H, W, 3), np.float32)
    lighting = np.zeros((H, W, 3), np.float32)
    lo = opts['lights']
    for i, e in enumerate(decor):
        try: sp = sprite(e['sprite'])
        except OSError: print(f'decor.json[{i}]: no sprite {e["sprite"]!r}, skipped'); continue
        spx = np.array(xform(sp, float(e.get('scale', 1)), float(e.get('rotation', 0))), np.float32) / 255
        h, w = spx.shape[:2]
        x0, y0 = int(e['x'] - w / 2), int(e['y'] - h / 2)
        # clip to the canvas
        sx0, sy0 = max(0, -x0), max(0, -y0)
        sx1, sy1 = min(w, W - x0), min(h, H - y0)
        if sx1 <= sx0 or sy1 <= sy0: continue
        spx = spx[sy0:sy1, sx0:sx1]
        X0, Y0, X1, Y1 = x0 + sx0, y0 + sy0, x0 + sx1, y0 + sy1
        region = img[Y0:Y1, X0:X1]
        col, a = spx[..., :3], spx[..., 3:]
        effect, k = e.get('effect'), float(e.get('strength', 0))
        if effect == 'emboss':
            # a height map (grey 0.5 = floor level) lit from the top-left, worked into the floor
            hgt = (col.mean(-1) - 0.5) * a[..., 0] * 2 * opts['panels']['depth']
            gy, gx = np.gradient(blur(hgt, 0.6))
            lit = 1 + 3.0 * (0.55 * gx + 0.6 * gy) + 0.3 * hgt
            img[Y0:Y1, X0:X1] = region * np.clip(lit, 0.3, 2.0)[..., None]
            continue
        if effect == 'paint':
            # soaked into the floor: takes the floor's shading and grain, worn through,
            # at partial opacity, like the markings in backgrounds 0-2
            lum = col.mean(-1, keepdims=True)
            col = lum + (col - lum) * 0.8
            fl = region.mean(-1, keepdims=True)
            shade = fl / (blur(fl[..., 0], 6)[..., None] + 1e-3)
            col = np.clip(col * np.clip(shade, 0.6, 1.3) * 0.9, 0, 1)
            a = a * worn(h, w, int(e['x']) * 7919 + int(e['y']))[sy0:sy1, sx0:sx1, None] * 0.75
        img[Y0:Y1, X0:X1] = region * (1 - a) + col * a
        if effect == 'shadow': shadow[Y0:Y1, X0:X1] += k * (a[..., 0] > 40 / 255)
        if effect == 'glow':
            hot = np.clip((col.max(-1) - 0.7) * 4, 0, 1) * a[..., 0]
            bloom[Y0:Y1, X0:X1] += k * hot[..., None] * col
            # a pool of the light's own colour around it
            if lo['radius'] > 0 and hot.sum() > 1:
                c = (col * hot[..., None]).sum((0, 1)) / hot.sum()
                c = c / max(c.max(), 1e-3)
                r = lo['radius'] * max(w, h) / 2
                cx, cy = float(e['x']), float(e['y'])
                bx0, by0 = max(0, int(cx - 3 * r)), max(0, int(cy - 3 * r))
                bx1, by1 = min(W, int(cx + 3 * r) + 1), min(H, int(cy + 3 * r) + 1)
                if bx1 > bx0 and by1 > by0:
                    d2 = (g.xx[by0:by1, bx0:bx1] - cx) ** 2 + (g.yy[by0:by1, bx0:bx1] - cy) ** 2
                    lighting[by0:by1, bx0:bx1] += k * np.exp(-d2 / (2 * r * r))[..., None] * c
    img *= (1 - 0.5 * blur(np.clip(ndi.shift(shadow, (2, 2), order=0), 0, 1), 1.5))[..., None]
    # lights: tinted brightening of what's under the pool (a "light" blend), then the bloom
    # (strongest on mid tones, so the dark floor picks up colour and bright walls don't wash out)
    img = img + lo['intensity'] * lighting * (0.12 + img) * (1 - np.clip(img, 0, 1))
    img += np.stack([blur(bloom[..., c], 4) for c in range(3)], -1) * lo['bloom']
    img *= (1 - 0.12 * (((g.xx / W - 0.5) * 2) ** 4 + ((g.yy / H - 0.5) * 2) ** 4))[..., None]
    sh = opts['edges']['sharpen']
    if sh > 0: img = img + sh * (img - np.stack([blur(img[..., c], 1.0) for c in range(3)], -1))
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


SOLID = 'collision_decor.png'  # the wall pixels the bake added to collision.png for solid decor


def footprint(decor, W, H):
    """Pixels covered by decor marked solid (sticking out of walls), as a bool mask."""
    m = np.zeros((H, W), bool)
    for e in decor:
        if not e.get('solid'): continue
        try: sp = sprite(e['sprite'])
        except OSError: continue
        a = np.array(xform(sp, float(e.get('scale', 1)), float(e.get('rotation', 0))))[..., 3] > 127
        sh, sw = a.shape
        x0, y0 = int(e['x'] - sw / 2), int(e['y'] - sh / 2)
        sx0, sy0, sx1, sy1 = max(0, -x0), max(0, -y0), min(sw, W - x0), min(sh, H - y0)
        if sx1 > sx0 and sy1 > sy0: m[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1] |= a[sy0:sy1, sx0:sx1]
    return m


def base_collision(d):
    """collision.png without the solid decor the last bake added (back to open floor)."""
    im = Image.open(os.path.join(d, 'collision.png')).convert('RGB')
    arr = np.array(im)
    sp = os.path.join(d, SOLID)
    if os.path.exists(sp):
        prev = np.array(Image.open(sp).convert('L'))[:arr.shape[0], :arr.shape[1]] > 127
        arr[prev] = 255
    return arr


def png_bytes(arr):
    b = io.BytesIO(); Image.fromarray(arr, 'RGB').save(b, 'PNG'); b.seek(0)
    return b


def write_decor(path, decor):
    # one placement per line, formatted like the editor writes it (whole numbers without ".0")
    decor = [{k: int(v) if isinstance(v, float) and v.is_integer() else v for k, v in e.items()} for e in decor]
    with open(path, 'w', newline='\n') as f:
        f.write('[\n' + ',\n'.join('  ' + json.dumps(e, separators=(', ', ': ')) for e in decor) + '\n]\n' if decor else '[]\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('level', help='level folder, e.g. 03_Bridge')
    ap.add_argument('step', choices=['place', 'bake', 'all'])
    ap.add_argument('--seed', type=int, help='seed for decor placement (default: level.json art.seed)')
    ap.add_argument('--only', help='place only these decor types, comma separated (' + ', '.join(CATEGORIES) + '); the others in decor.json are kept')
    args = ap.parse_args()
    d, art = level_paths(args.level)
    opts = options(art)
    seed = int(art.get('seed', 2012))
    base = base_collision(d)
    g = Geometry(png_bytes(base), opts)
    decor_path = os.path.join(d, 'decor.json')
    if args.step in ('place', 'all'):
        only, keep = None, []
        entrance = None
        fp = os.path.join(d, 'features.json')
        if os.path.exists(fp):
            for e in json.load(open(fp)):
                if str(e.get('symbol', '')).endswith('entrance_mc'): entrance = (int(e['x']), int(e['y']))
        if args.only:
            only = {c.strip() for c in args.only.split(',') if c.strip()}
            bad = only - set(CATEGORIES)
            if bad: sys.exit(f'unknown decor types: {", ".join(sorted(bad))}; known: {", ".join(CATEGORIES)}')
            old = json.load(open(decor_path)) if os.path.exists(decor_path) else []
            keep = [e for e in old if category(e) not in only]
        decor = place_decor(g, args.seed if args.seed is not None else seed, opts, only, keep, entrance)
        write_decor(decor_path, decor)
        print(f'wrote levels/{args.level}/decor.json ({len(decor)} placements)')
    if args.step in ('bake', 'all'):
        decor = json.load(open(decor_path)) if os.path.exists(decor_path) else []
        # solid decor (greebles sticking out of walls) becomes wall in collision.png
        H, W = base.shape[:2]
        solid = footprint(decor, W, H) & (base.min(-1) > 250)
        coll = base.copy(); coll[solid] = 0
        Image.fromarray(coll, 'RGB').convert('RGBA').save(os.path.join(d, 'collision.png'), optimize=True)
        if solid.any(): Image.fromarray((solid * 255).astype(np.uint8), 'L').save(os.path.join(d, SOLID), optimize=True)
        elif os.path.exists(os.path.join(d, SOLID)): os.remove(os.path.join(d, SOLID))
        if solid.any(): print(f'collision.png: {int(solid.sum())} px of solid decor')
        g = Geometry(png_bytes(coll), opts)
        out = bake(g, decor, seed, opts)
        Image.fromarray(out, 'RGB').convert('RGBA').save(os.path.join(d, 'background.png'), optimize=True)
        print(f'wrote levels/{args.level}/background.png ({len(decor)} decor placements)')


if __name__ == '__main__':
    main()

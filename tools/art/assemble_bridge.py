"""Assemble the Bridge (level 3) background from AI-generated parts on the exact
collision shape.

    python3 tools/art/assemble_bridge.py         # needs numpy, scipy, pillow

Parts in tools/art/parts/ were generated with OpenAI gpt-image-2 using only the
original levels (backgrounds 0-2) as style references; the prompts sit next to
them. This script lays them onto level3's collision shape so the walls you see
are the walls you hit:

- floor and chasm textures are tiled; the wall-top texture is tiled along each
  wall's direction (horizontal, vertical or diagonal)
- walls get rounded corners, a soft bevel lit from the top-left, and dark sides
  extruded toward a camera over the map centre, like the original levels
- the floor gets soft gradient lighting and contact shadows; chasms get a
  hazard-striped lip
"""
import json
import os
import re

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
PARTS = os.path.join(os.path.dirname(__file__), 'parts')
LEVEL = os.path.join(ROOT, 'source/library/level assets/level3/shape 1.json')
OUT = os.path.join(ROOT, 'source/library/level assets/background3/shape 1/bitmap 1.png')
W, H, SS = 1600, 600, 4
rng = np.random.default_rng(2012)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


# ---------------------------------------------------------------- collision shape
def subpaths(d):
    pts, out = [], []
    for cmd, x, y in re.findall(r'([MLZ])\s*(?:(-?[\d.]+)\s+(-?[\d.]+))?', d):
        if cmd == 'M':
            if pts: out.append(pts)
            pts = [(float(x), float(y))]
        elif cmd == 'L': pts.append((float(x), float(y)))
        elif cmd == 'Z' and pts: out.append(pts); pts = []
    if pts: out.append(pts)
    return out


def raster(d):
    acc = np.zeros((H * SS, W * SS), bool)
    for pts in subpaths(d):
        im = Image.new('1', (W * SS, H * SS), 0)
        ImageDraw.Draw(im).polygon([(x * SS, y * SS) for x, y in pts], fill=1)
        acc ^= np.array(im)
    return acc


shape = json.load(open(LEVEL))
label = np.zeros((H * SS, W * SS), np.uint8)
for p in shape['paths']:
    if 'fill' not in p: continue
    col = shape['fills'][p['fill']]['color'].lower()
    if col == '#ffffff': continue
    label[raster(p['d'])] = 1 if col == '#000000' else 2
down = lambda m: m.reshape(H, SS, W, SS).mean(axis=(1, 3)).astype(np.float32)
wall, chasm = down(label == 1), down(label == 2)
wallb, chasmb = wall > 0.5, chasm > 0.5


def blur(a, s): return ndi.gaussian_filter(a.astype(np.float32), s, mode='nearest')


# ---------------------------------------------------------------- textures
def load(name):
    return np.array(Image.open(os.path.join(PARTS, name + '.png')).convert('RGB'), np.float32) / 255


def make_seamless(t, band=96):
    """Cross-fade each edge with the opposite one so the texture wraps cleanly."""
    h, w, _ = t.shape
    for axis, n in ((1, w), (0, h)):
        r = np.roll(t, n // 2, axis=axis)
        ramp = np.clip((np.abs(np.arange(n) - n / 2) - (n / 2 - band)) / band, 0, 1)  # 1 at the edges, 0 inside
        ramp = ramp[None, :, None] if axis == 1 else ramp[:, None, None]
        t = t * (1 - ramp) + r * ramp
    return t


def tiled(t, scale, angle=0.0, off=(0.0, 0.0)):
    """Sample texture t over the canvas at `scale` (canvas px per texture px), rotated."""
    h, w, _ = t.shape
    ca, sa = np.cos(angle), np.sin(angle)
    u = (xx * ca + yy * sa) / scale + off[0]
    v = (-xx * sa + yy * ca) / scale + off[1]
    return np.stack([ndi.map_coordinates(t[..., c], [v % h, u % w], order=1, mode='grid-wrap') for c in range(3)], -1)


floor_t = make_seamless(load('floor'))
wall_t = make_seamless(load('wall'))
chasm_t = make_seamless(load('chasm'))

# ---------------------------------------------------------------- floor
img = tiled(floor_t, 0.5)
img = img / img.mean() * 0.24                                  # match the originals' floor tone
open_d = ndi.distance_transform_edt(~(wallb | chasmb)).astype(np.float32)
light = 0.86 + 0.24 * blur(np.clip(open_d / 90, 0, 1), 12)     # brighter away from walls
light *= 1 + 0.10 * (blur(rng.random((H // 40 + 1, W // 40 + 1)).repeat(40, 0).repeat(40, 1)[:H, :W], 30) - 0.5)
img *= light[..., None]

# ---------------------------------------------------------------- chasms
inside = ndi.distance_transform_edt(chasmb).astype(np.float32)
ch = tiled(chasm_t, 0.45, off=(37, 11))
ch = ch * (0.9 - 0.5 * np.clip(inside / 70, 0, 1))[..., None]
img = img * (1 - chasm[..., None]) + ch * chasm[..., None]
lip = (ndi.distance_transform_edt(~chasmb) <= 5) & ~chasmb & ~wallb
stripe = ((xx + yy) % 14 < 7)
lipf = blur(lip, 0.5)
hz = np.where(stripe[..., None], np.array([0.72, 0.56, 0.11]), np.array([0.09, 0.09, 0.09]))
img = img * (1 - 0.75 * lipf[..., None]) + hz * 0.75 * lipf[..., None]

# ---------------------------------------------------------------- walls
# rounded art mask: convex corners softened, inside corners filleted
wr = np.clip((blur(wall, 3.2) - 0.5) * 3.0 + 0.5, 0, 1)
wrb = wr > 0.5
CX, CY, K, MAXOFF = W / 2, H / 2, 0.02, 9.0
vx = np.clip(K * (xx - CX), -MAXOFF, MAXOFF)
vy = np.clip(K * (yy - CY), -MAXOFF, MAXOFF)
side = np.zeros((H, W), np.float32); st = np.ones((H, W), np.float32)
for i in range(24, 0, -1):  # walls extruded toward the map centre
    t = i / 24
    s = ndi.map_coordinates(wr, [yy + t * vy, xx + t * vx], order=1, mode='nearest')
    st[s > 0.5] = t; side = np.maximum(side, s)
side = blur(side * (1 - wr), 0.6)
ao = blur(np.maximum(side, wr), 5)
img *= (1 - 0.5 * ao * (1 - wr) * (1 - side))[..., None]
scol = 0.025 + 0.05 * (1 - st) ** 3
img = img * (1 - side[..., None]) + scol[..., None] * side[..., None]

# wall tops: the generated plate texture, run along each wall's direction
dist = ndi.distance_transform_edt(wrb).astype(np.float32)
ny, nx = np.gradient(blur(dist, 4))
ang = np.arctan2(ny, nx) + np.pi / 2
q = np.round(ang / (np.pi / 4)).astype(int) % 4                 # 0 horiz, 1 diag, 2 vert, 3 other diag
q = ndi.median_filter(q, 7)
top = np.zeros_like(img)
for k in range(4):
    tk = tiled(wall_t, 0.33, k * np.pi / 4, off=(k * 131.0, k * 57.0))
    top += tk * (q == k)[..., None]
top = top / top[wrb].mean() * 0.74

# soft bevel lit from the top-left
hgt = np.clip(dist / 7.0, 0, 1); hgt = blur(hgt * hgt * (3 - 2 * hgt), 1.2)
gy, gx = np.gradient(hgt)
nz = 0.18
lam = (-gx * -0.55 - gy * -0.6 + nz * 0.58) / np.sqrt(gx * gx + gy * gy + nz * nz)
top *= (0.70 + 0.42 * lam)[..., None]
top *= (1 - 0.18 * np.clip(1 - dist / 1.5, 0, 1))[..., None]   # crisp dark edge line
img = img * (1 - wr[..., None]) + top * wr[..., None]

img *= (1 - 0.12 * (((xx / W - 0.5) * 2) ** 4 + ((yy / H - 0.5) * 2) ** 4))[..., None]
out = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(out, 'RGB').convert('RGBA').save(OUT, optimize=True)
print('wrote', os.path.relpath(OUT, ROOT))

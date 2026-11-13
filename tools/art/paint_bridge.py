"""Paint the Bridge (level 3) background bitmap from the level's own collision shape.

    python3 tools/art/paint_bridge.py            # needs numpy, scipy, pillow

Reads source/library/level assets/level3/shape 1.json (black = wall, #999999 =
chasm the player can't cross but shots fly over, white = floor) and writes
source/library/level assets/background3/shape 1/bitmap 1.png at 1600x600, in the style
of the other levels' backgrounds: dark tiled floor, light greebled metal walls
with bevel and drop shadow, hazard markings, rust, and additive light glows.
The output lines up with the collision map pixel for pixel, so the walls you see
are the walls you hit. Seeded, so re-running gives the same image.
"""
import json
import os
import re

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
LEVEL = os.path.join(ROOT, 'source/library/level assets/level3/shape 1.json')
OUT = os.path.join(ROOT, 'source/library/level assets/background3/shape 1/bitmap 1.png')
W, H, SS = 1600, 600, 4
rng = np.random.default_rng(2012)


# ---------------------------------------------------------------- masks
def subpaths(d):
    pts, out = [], []
    for cmd, x, y in re.findall(r'([MLZ])\s*(?:(-?[\d.]+)\s+(-?[\d.]+))?', d):
        if cmd == 'M':
            if pts: out.append(pts)
            pts = [(float(x), float(y))]
        elif cmd == 'L':
            pts.append((float(x), float(y)))
        elif cmd == 'Z' and pts:
            out.append(pts); pts = []
    if pts: out.append(pts)
    return out


def raster(d):
    """Even-odd fill of one path, supersampled, as a bool array (H*SS, W*SS)."""
    acc = np.zeros((H * SS, W * SS), bool)
    for pts in subpaths(d):
        im = Image.new('1', (W * SS, H * SS), 0)
        ImageDraw.Draw(im).polygon([(x * SS, y * SS) for x, y in pts], fill=1)
        acc ^= np.array(im)
    return acc


shape = json.load(open(LEVEL))
label = np.zeros((H * SS, W * SS), np.uint8)  # 0 floor, 1 wall, 2 chasm
for p in shape['paths']:
    if 'fill' not in p: continue
    col = shape['fills'][p['fill']]['color'].lower()
    if col == '#ffffff': continue
    label[raster(p['d'])] = 1 if col == '#000000' else 2


def down(m):
    return m.reshape(H, SS, W, SS).mean(axis=(1, 3))


wall = down(label == 1)    # coverage 0..1, anti-aliased
chasm = down(label == 2)
floor = np.clip(1 - wall - chasm, 0, 1)
wallb, chasmb = wall > 0.5, chasm > 0.5

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def blur(a, s):
    return ndi.gaussian_filter(a.astype(np.float32), s, mode='nearest')


def noise(scale, octaves=4, seed=0):
    r = np.random.default_rng(seed)
    out = np.zeros((H, W), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        s = max(1, int(scale / 2 ** o))
        g = r.random((H // s + 2, W // s + 2)).astype(np.float32)
        out += amp * ndi.zoom(g, s, order=3)[:H, :W]; tot += amp; amp *= 0.5
    return out / tot


def rgb(h):
    h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


img = np.zeros((H, W, 3), np.float32)

# ---------------------------------------------------------------- floor
grime = noise(80, 5, 1)
base = 0.20 + 0.05 * (grime - 0.5) + 0.025 * (rng.random((H, W)) - 0.5)
# 25px deck plates (the level is laid out on a 25px grid) with darker seams
seam = ((xx % 50 < 1) | (yy % 50 < 1)).astype(np.float32) * 0.5 + ((xx % 25 < 1) | (yy % 25 < 1)) * 0.25
base -= 0.03 * seam
plate_var = rng.random((H // 50 + 1, W // 50 + 1)).astype(np.float32)
base += 0.02 * (np.kron(plate_var, np.ones((50, 50)))[:H, :W] - 0.5)
# scorch / oil blotches
blot = np.clip((noise(120, 3, 7) - 0.62) * 4, 0, 1)
base -= 0.07 * blot
floor_col = base[..., None] * rgb('#e6e9ea')[None, None] / 0.9
img += floor_col

# faint circuit traces on the floor, like levels 1 and 2
trace = Image.new('L', (W, H), 0); td = ImageDraw.Draw(trace)
for _ in range(70):
    x, y = rng.integers(25, W - 25), rng.integers(25, H - 25)
    for _ in range(rng.integers(2, 5)):
        if rng.random() < 0.5: nx, ny = x + rng.integers(-180, 180), y
        else: nx, ny = x, y + rng.integers(-120, 120)
        td.line([(x, y), (nx, ny)], fill=255, width=1); x, y = nx, ny
    td.ellipse([x - 2, y - 2, x + 2, y + 2], outline=255)
img += (np.array(trace, np.float32) / 255 * 0.035)[..., None]

# ---------------------------------------------------------------- chasm (the bridge spans it)
inside = ndi.distance_transform_edt(chasmb)
depth = np.clip(inside / 60, 0, 1)
ch = (0.10 - 0.08 * depth)[..., None] * rgb('#8fa3b5')[None, None]
# girders far below, receding: a lattice that darkens with depth
lat = (((xx + yy * 0.0) % 75 < 6) | (yy % 60 < 5)).astype(np.float32)
diag = (((xx + yy) % 106 < 4) | ((xx - yy) % 106 < 4)).astype(np.float32)
ch += ((0.06 * lat + 0.035 * diag) * (1 - 0.6 * depth))[..., None] * rgb('#9fb0c0')[None, None]
ch *= (0.75 + 0.5 * noise(60, 3, 9))[..., None]
img = img * (1 - chasm[..., None]) + ch * chasm[..., None]

# ---------------------------------------------------------------- walls: greebled metal panels
pan = np.full((H, W), 0.66, np.float32)
for _ in range(2600):  # overlapping plates of slightly different tone
    w, h = rng.integers(4, 40), rng.integers(4, 40)
    x, y = rng.integers(0, W), rng.integers(0, H)
    v = rng.normal(0, 0.06)
    pan[y:y + h, x:x + w] += v
    pan[y:y + 1, x:x + w] += 0.05; pan[y + h - 1:y + h, x:x + w] -= 0.06
    pan[y:y + h, x:x + 1] += 0.04; pan[y:y + h, x + w - 1:x + w] -= 0.05
pan = np.clip(pan, 0.35, 0.95)
pan += 0.03 * (rng.random((H, W)) - 0.5)
# bevel: height from distance to the wall edge, lit from the top-left
dist = ndi.distance_transform_edt(wallb).astype(np.float32)
height = np.clip(dist / 7, 0, 1) ** 0.6
gy, gx = np.gradient(blur(height, 1.0))
light = np.clip(-(gx * -0.7 + gy * -0.7) * 6, -0.5, 0.5)
edge = np.clip(1 - dist / 2.0, 0, 1)
wcol = (pan + light * 0.9 - 0.25 * edge)[..., None] * rgb('#e9ecee')[None, None]

# rust and red paint flecks on the walls, like the other levels
rust = blur(np.clip((noise(40, 4, 3) - 0.74) * 5, 0, 1) * (rng.random((H, W)) > 0.6), 0.7)
wcol = wcol * (1 - 0.6 * rust[..., None]) + rust[..., None] * rgb('#a8341f')[None, None] * 0.6

# drop shadow onto the floor and into the chasm (light from the top-left)
shadow = blur(ndi.shift(wall, (5, 5), order=1, mode='nearest'), 3.5)
img *= (1 - 0.55 * shadow * (1 - wall))[..., None]
img = img * (1 - wall[..., None]) + wcol * wall[..., None]

# ---------------------------------------------------------------- markings on the floor
over = Image.new('RGBA', (W, H), (0, 0, 0, 0)); od = ImageDraw.Draw(over)

# yellow/black hazard rim round both chasms, on the floor side
rim = (ndi.distance_transform_edt(~chasmb) <= 8) & ~chasmb & ~wallb
stripe = ((xx + yy) % 16 < 8)
hz = np.where(stripe, 1, 0)[..., None] * rgb('#d7a91c')[None, None] + np.where(stripe, 0, 1)[..., None] * rgb('#1b1b1b')[None, None]
hz *= (0.8 + 0.2 * noise(30, 3, 4))[..., None]
rimf = blur(rim, 0.6) * floor
img = img * (1 - 0.85 * rimf[..., None]) + hz * 0.85 * rimf[..., None]

# bridge deck: centre-line dashes and direction chevrons across the span
for x in range(480, 930, 50):
    od.rectangle([x, 298, x + 24, 301], fill=(225, 190, 60, 120))
for cx in (560, 840):
    for k in range(3):
        x0 = cx + k * 14
        od.polygon([(x0, 280), (x0 + 10, 300), (x0, 320), (x0 + 5, 320), (x0 + 15, 300), (x0 + 5, 280)], fill=(225, 190, 60, 70))

# east and west landing pads
for (x, y) in [(1490, 105), (95, 520)]:
    od.rectangle([x - 32, y - 32, x + 32, y + 32], outline=(200, 200, 200, 50), width=2)
    od.rectangle([x - 24, y - 24, x + 24, y + 24], fill=(0, 0, 0, 35))

ov = np.array(over, np.float32) / 255
ov_a = ov[..., 3:4] * floor[..., None]
img = img * (1 - ov_a) + ov[..., :3] * ov_a

# ---------------------------------------------------------------- additive glows
glow = np.zeros_like(img)


def lamp(x, y, col, r=10, k=0.6):
    d2 = (xx - x) ** 2 + (yy - y) ** 2
    glow[...] += (np.exp(-d2 / (2 * r * r)) * k)[..., None] * rgb(col)[None, None]
    glow[...] += (np.exp(-d2 / 3.0) * 0.8)[..., None] * rgb('#ffffff')[None, None]


# running lights along the bridge rails (the chasm-side walls)
for x in range(475, 950, 50):
    lamp(x, 88, '#5fd7ff', 9, 0.5); lamp(x, 512, '#5fd7ff', 9, 0.5)
# lights deep in the chasm
for _ in range(26):
    m = np.argwhere(inside > 25)
    y, x = m[rng.integers(len(m))]
    lamp(x, y, rng.choice(['#ff8a3c', '#5fd7ff', '#ff5040']), rng.uniform(6, 14), rng.uniform(0.15, 0.35))
# warning lamps by the doors and in the corners of the big rooms
for (x, y) in [(188, 82), (1010, 82), (1010, 518), (1212, 470), (1300, 88)]:
    lamp(x, y, '#ff4030', 12, 0.55)
for (x, y) in [(38, 38), (1560, 38), (38, 562), (1560, 562), (460, 40), (460, 560)]:
    lamp(x, y, '#ffd28a', 18, 0.25)
img = img + glow  # additive, like the game's ADD-blended lights

# light vignette so the playfield edges sit back
vig = 1 - 0.18 * (((xx / W - 0.5) * 2) ** 4 + ((yy / H - 0.5) * 2) ** 4)
img *= vig[..., None]

out = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(out, 'RGB').convert('RGBA').save(OUT, optimize=True)
print('wrote', os.path.relpath(OUT, ROOT), out.shape)

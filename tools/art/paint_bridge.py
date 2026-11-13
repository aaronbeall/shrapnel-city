"""Paint the Bridge (level 3) background bitmap from the level's own collision shape.

    python3 tools/art/paint_bridge.py            # needs numpy, scipy, pillow

Reads source/library/level assets/level3/shape 1.json (black = wall, #999999 =
chasm the player can't cross but shots fly over, white = floor) and writes
source/library/level assets/background3/shape 1/bitmap 1.png at 1600x600.

It follows how the other levels' backgrounds were made: wall tops are flat light
plates with fine panel lines, and the walls are extruded along z and rendered
dark, seen from a camera above the middle of the map, so each wall shows a dark
stepped side face on the side that faces the centre. The floor is dark plating
with faint panel and circuit lines, dust patches, scratches, stencilled decals
and soft lighting. The wall tops line up with the collision map pixel for pixel.
Seeded, so re-running gives the same image.
"""
import json
import os
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFont
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
    return m.reshape(H, SS, W, SS).mean(axis=(1, 3)).astype(np.float32)


wall = down(label == 1)    # coverage 0..1, anti-aliased
chasm = down(label == 2)
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


def layer(draw_fn, mode='L'):
    im = Image.new(mode, (W, H), 0); draw_fn(ImageDraw.Draw(im)); return np.array(im, np.float32) / 255


def sample(a, sy, sx):
    return ndi.map_coordinates(a, [sy, sx], order=1, mode='nearest')


# Pseudo-perspective: a camera above the middle of the map. A wall's base sits
# nearer the centre than its top, by K * (distance from centre) at full height.
CX, CY, K, MAXOFF = W / 2, H / 2, 0.02, 9.0
vx = np.clip(K * (xx - CX), -MAXOFF, MAXOFF)
vy = np.clip(K * (yy - CY), -MAXOFF, MAXOFF)


def extrude(solid, steps=14):
    """Side faces of `solid` (tops) dropping toward the centre. Returns
    (coverage, t) where t in 0..1 is how far down the face (0 = top edge)."""
    cov = np.zeros((H, W), np.float32); tt = np.ones((H, W), np.float32)
    for i in range(steps, 0, -1):  # far (base) first, so nearer steps win
        t = i / steps
        s = sample(solid, yy + t * vy, xx + t * vx)
        hit = s > 0.5
        tt[hit] = t; cov = np.maximum(cov, s)
    return cov * (1 - solid), tt


# ---------------------------------------------------------------- floor
base = np.full((H, W), 0.215, np.float32)
base += 0.05 * (blur(noise(220, 2, 1), 30) - 0.5) * 2        # soft lighting pools
base += 0.012 * (rng.random((H, W)) - 0.5)                    # fine grain

# panel lines: a fine 25px grid plus a scatter of larger plate outlines
lines = layer(lambda d: [d.line([(x, 0), (x, H)], fill=60) for x in range(0, W, 25)] +
                        [d.line([(0, y), (W, y)], fill=60) for y in range(0, H, 25)])
def plates(d):
    for _ in range(260):
        x, y = rng.integers(0, W // 25) * 25, rng.integers(0, H // 25) * 25
        w, h = rng.integers(1, 6) * 25, rng.integers(1, 5) * 25
        d.rectangle([x, y, x + w, y + h], outline=int(rng.integers(90, 170)))
    for _ in range(160):  # small inset squares
        x, y = rng.integers(0, W), rng.integers(0, H); s = rng.integers(4, 14)
        d.rectangle([x, y, x + s, y + s], outline=90)
plate_lines = layer(plates)
base -= 0.018 * lines + 0.03 * plate_lines
base += 0.01 * ndi.shift(plate_lines, (1, 1), order=0)        # tiny lip highlight

# plate tone variation
tone = rng.random((H // 25 + 1, W // 25 + 1)).astype(np.float32)
base += 0.012 * (np.kron(tone, np.ones((25, 25), np.float32))[:H, :W] - 0.5)

# circuit traces with rounded corners and terminal pads
def traces(d):
    for _ in range(55):
        x, y = int(rng.integers(30, W - 30)), int(rng.integers(30, H - 30))
        horiz = rng.random() < 0.5
        pts = [(x, y)]
        for _ in range(int(rng.integers(2, 5))):
            if horiz: x = int(np.clip(x + rng.integers(-220, 220), 5, W - 5))
            else: y = int(np.clip(y + rng.integers(-150, 150), 5, H - 5))
            pts.append((x, y)); horiz = not horiz
        d.line(pts, fill=255, width=1, joint='curve')
        d.rectangle([pts[-1][0] - 2, pts[-1][1] - 2, pts[-1][0] + 2, pts[-1][1] + 2], outline=255)
base += 0.035 * layer(traces)

# dust: clusters of fine speckle
dust = np.zeros((H, W), np.float32)
for _ in range(40):
    cx, cy, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(15, 45)
    dust += np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r))
speck = rng.random((H, W)) > 0.55
base += 0.05 * np.clip(dust, 0, 1) * speck * (noise(6, 2, 5) - 0.3)

# scratches: short thin light strokes, mostly along the traffic lanes
def scratches(d):
    for _ in range(900):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        a = rng.normal(0, 0.35) + (0 if rng.random() < 0.6 else np.pi / 2)
        l = rng.uniform(3, 18)
        d.line([(x, y), (x + l * np.cos(a), y + l * np.sin(a))], fill=int(rng.integers(60, 200)))
base += 0.05 * layer(scratches)

# oil / scorch stains
stain = np.clip((noise(90, 4, 7) - 0.66) * 4, 0, 1)
base -= 0.06 * stain

img = base[..., None] * np.array([1.0, 1.0, 1.02], np.float32)[None, None]

# ---------------------------------------------------------------- decals
def decals(d):
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
        small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
    except OSError:
        font = small = ImageFont.load_default()
    return font, small

font, small = decals(None)
red = Image.new('L', (W, H), 0); rd = ImageDraw.Draw(red)
yel = Image.new('L', (W, H), 0); ydr = ImageDraw.Draw(yel)
plate = Image.new('L', (W, H), 0); pd = ImageDraw.Draw(plate)
# stencilled sector numbers on dark plates, as in Drop Zone ("326")
blocked = ndi.binary_dilation(wallb | chasmb, iterations=6)


def clear_spot(x, y, w, h):
    # nearest spot to (x, y) where a w*h decal sits on open floor
    for r in range(0, 200, 4):
        for dx, dy in [(0, 0), (r, 0), (-r, 0), (0, r), (0, -r), (r, r), (-r, r), (r, -r), (-r, -r)]:
            X, Y = x + dx, y + dy
            if 0 <= X and 0 <= Y and X + w < W and Y + h < H and not blocked[Y:Y + h, X:X + w].any():
                return X, Y
    raise ValueError((x, y))


for (x, y, txt) in [(40, 300, '03'), (1150, 410, "3B"), (1180, 100, '3C'), (1500, 280, '3D')]:
    w = 26 * len(txt) + 20
    x, y = clear_spot(x, y, w, 46)
    pd.rounded_rectangle([x, y, x + w, y + 46], 6, fill=255)
    rd.text((x + 10, y + 6), txt, font=font, fill=230)
# bridge deck: centre dashes and chevrons
for x in range(480, 930, 50):
    ydr.rectangle([x, 298, x + 22, 301], fill=200)
for cx in (560, 820):
    for k in range(3):
        x0 = cx + k * 12
        ydr.line([(x0, 288), (x0 + 10, 300), (x0, 312)], fill=170, width=3)
# red hatched danger boxes in the two big end rooms
for (x, y, w, h) in [(1475, 455, 75, 75), (35, 30, 50, 60)]:
    box = Image.new('L', (w, h), 0); bd = ImageDraw.Draw(box)
    for i in range(-h, w, 9): bd.line([(i, h), (i + h, 0)], fill=150, width=3)
    bd.rectangle([0, 0, w - 1, h - 1], outline=200)
    red.paste(box, (x, y), box)

wear = np.clip(noise(5, 2, 11) * 1.6 - 0.25, 0, 1)            # chipped paint
pl = np.array(plate, np.float32) / 255
img *= (1 - 0.35 * pl)[..., None]
img += (0.025 * pl * (rng.random((H, W)) - 0.5))[..., None]
ra = np.array(red, np.float32) / 255 * wear
ya = np.array(yel, np.float32) / 255 * wear
img = img * (1 - 0.7 * ra[..., None]) + rgb('#9c2018')[None, None] * 0.7 * ra[..., None]
img = img * (1 - 0.55 * ya[..., None]) + rgb('#b89a2e')[None, None] * 0.55 * ya[..., None]

# ---------------------------------------------------------------- chasms
# the floor plate's edge drops away into the chasm: extrude the floor down
notch = 1 - chasm
pside, pt = extrude(notch * (1 - wall) + wall)
inside = ndi.distance_transform_edt(chasmb).astype(np.float32)
depth = np.clip(inside / 70, 0, 1)
ch = (0.075 - 0.06 * depth)[..., None] * rgb('#9aaabb')[None, None]
lat = ((xx % 75 < 5) | (yy % 60 < 4)).astype(np.float32)
diag = (((xx + yy) % 106 < 3) | ((xx - yy) % 106 < 3)).astype(np.float32)
ch += ((0.05 * lat + 0.025 * diag) * (1 - 0.7 * depth))[..., None] * rgb('#9fb0c0')[None, None]
ch *= (0.8 + 0.4 * noise(50, 3, 9))[..., None]
img = img * (1 - chasm[..., None]) + ch * chasm[..., None]
# the drop face of the floor plate: dark with fine steps
step = (np.floor(pt * 14) % 2) * 0.012
pcol = (0.10 - 0.07 * pt + step)
pcov = pside * chasm
img = img * (1 - pcov[..., None]) + pcol[..., None] * pcov[..., None]
# thin hazard edge along the lip
lip = (ndi.distance_transform_edt(~chasmb) <= 5) & ~chasmb & ~wallb
stripe = ((xx + yy) % 14 < 7)
lipf = blur(lip, 0.5)
hz = np.where(stripe[..., None], rgb('#b8901c')[None, None], rgb('#161616')[None, None])
img = img * (1 - 0.75 * lipf[..., None]) + hz * 0.75 * lipf[..., None]

# ---------------------------------------------------------------- walls
side, st = extrude(wall, steps=18)
# ambient occlusion where the extruded side meets the floor
ao = blur(np.maximum(side, wall), 4)
img *= (1 - 0.45 * ao * (1 - wall) * (1 - side))[..., None]
step = (np.floor(st * 9) % 2) * 0.025
scol = 0.035 + 0.07 * (1 - st) ** 2 + step
img = img * (1 - side[..., None]) + scol[..., None] * side[..., None]

# wall tops: flat plates of slightly different greys with fine outlines, laid
# along each wall's run (rotated on the diagonals), like the hand-built walls
top = np.full((H, W), 0.70, np.float32)
top += 0.05 * (blur(noise(160, 2, 21), 20) - 0.5) * 2        # smooth large shading
dist = ndi.distance_transform_edt(wallb).astype(np.float32)
ny, nx = np.gradient(blur(dist, 2.5))                         # points into the wall
outl = Image.new('L', (W, H), 0); od = ImageDraw.Draw(outl)
fill = Image.new('L', (W, H), 128); fd = ImageDraw.Draw(fill)
cand = np.argwhere(wallb)
for _ in range(2600):
    cy, cx = cand[rng.integers(len(cand))]
    a = np.arctan2(ny[cy, cx], nx[cy, cx]) + np.pi / 2       # along the wall
    a = np.round(a / (np.pi / 4)) * (np.pi / 4)
    L, T = rng.uniform(8, 50), rng.uniform(4, 14)
    if rng.random() < 0.15: L, T = T, L * 0.5                 # occasional cross plate
    ca, sa = np.cos(a), np.sin(a)
    pts = [(cx + ca * u - sa * v, cy + sa * u + ca * v) for u, v in
           [(-L / 2, -T / 2), (L / 2, -T / 2), (L / 2, T / 2), (-L / 2, T / 2)]]
    fd.polygon(pts, fill=int(np.clip(128 + rng.normal(0, 14), 90, 170)))
    od.polygon(pts, outline=int(rng.integers(60, 140)))
    if rng.random() < 0.04:                                   # small dark sockets
        od.rectangle([cx - 2, cy - 2, cx + 2, cy + 2], fill=200)
top += (np.array(fill, np.float32) - 128) / 255 * 0.55
top -= 0.07 * np.array(outl, np.float32) / 255
top += 0.006 * (rng.random((H, W)) - 0.5)
# a soft rim: 1px light top-left lip and slightly darker bottom-right edge
gy, gx = np.gradient(blur(wall, 0.8))
rim = np.clip(1.5 - dist, 0, 1)
top += rim * np.clip((gx + gy) * 2.0, -0.12, 0.12)
top -= 0.05 * np.clip(1 - dist / 3, 0, 1)
tcol = top[..., None] * np.array([1.0, 1.0, 1.015], np.float32)[None, None]
# rust and red paint splats: a few dotty clusters
rust = np.zeros((H, W), np.float32)
for _ in range(22):
    cy, cx = cand[rng.integers(len(cand))]; r = rng.uniform(3, 9)
    rust += np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r))
rust = np.clip(rust * 1.3 - 0.15, 0, 1) * (rng.random((H, W)) > 0.6) * wall
tcol = tcol * (1 - 0.75 * rust[..., None]) + rust[..., None] * rgb('#c0441f')[None, None] * 0.75
img = img * (1 - wall[..., None]) + tcol * wall[..., None]

# ---------------------------------------------------------------- lights (additive)
glow = np.zeros_like(img)


def lamp(x, y, col, r=10, k=0.6, core=0.6):
    d2 = (xx - x) ** 2 + (yy - y) ** 2
    glow[...] += (np.exp(-d2 / (2 * r * r)) * k)[..., None] * rgb(col)[None, None]
    glow[...] += (np.exp(-d2 / 2.0) * core)[..., None] * rgb('#ffffff')[None, None]


for x in range(487, 950, 50):          # running lights on the bridge rails
    lamp(x, 88, '#5fd7ff', 7, 0.3, 0.5); lamp(x, 512, '#5fd7ff', 7, 0.3, 0.5)
m = np.argwhere(inside > 25)
for _ in range(22):                     # lights deep in the chasms
    y, x = m[rng.integers(len(m))]
    lamp(x, y, str(rng.choice(['#ff8a3c', '#5fd7ff', '#ff5040'])), rng.uniform(5, 10), rng.uniform(0.1, 0.22), 0.35)
for (x, y) in [(188, 84), (1010, 84), (1010, 516), (1212, 468)]:
    lamp(x, y, '#ff4030', 9, 0.35, 0.6)
img = img + glow

img *= (1 - 0.12 * (((xx / W - 0.5) * 2) ** 4 + ((yy / H - 0.5) * 2) ** 4))[..., None]

out = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(out, 'RGB').convert('RGBA').save(OUT, optimize=True)
print('wrote', os.path.relpath(OUT, ROOT), out.shape)

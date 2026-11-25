"""07 Shipyard's own decor, added to the decor the city kit places.

    python tools/art/bake.py 07_Shipyard place        # the city kit's decor (replaces decor.json)
    python tools/levels/07_Shipyard/decor.py          # + the Shipyard's own (replaces only its own)
    python tools/art/bake.py 07_Shipyard bake

Sprites: the sheets city-docks and city-ships (tools/art/gen_city.sh city-docks city-ships, then
tools/art/cut_decor.py). What goes where:
- a gantry crane house over each set of crane legs, its boom out over the water (or the dry dock)
- bollards with mooring ropes on the bollard posts along the quay, rope coils, life rings and
  chains along the quay edges, rubber fenders hung where the ships lie against the piers
- drums and pallets in the yards, navigation buoys out in the harbour
- the ships: windlass and anchor chain on each bow, hatches, vents, life rafts and winches on
  the decks, radar domes and searchlights on the bridges, helicopter pads on the cruiser's
  afterdeck and the flagship's hangar roof

It reads the layout's own geometry (layout.py) and the level's placements, so nothing lands
under an enemy or a pickup. Entries with a city-docks or city-ships sprite are this tool's:
running it again replaces them and leaves the rest of decor.json alone.
"""
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(__file__)
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
D = os.path.join(ROOT, 'levels', '07_Shipyard')
sys.path.insert(0, os.path.join(ROOT, 'tools', 'art'))
sys.path.insert(0, HERE)
from bake import write_decor  # noqa: E402
import layout as L  # noqa: E402

CATS = ('city-docks', 'city-ships')
SIZES = json.load(open(os.path.join(ROOT, 'tools', 'art', 'parts', 'decor', 'index.json')))
# city-docks
CRANES, BOLLARDS, COILS, DRUMS, RINGS = (0, 1, 2), (8, 9, 10, 11), (7, 12, 13), (14, 15, 16, 17), (18, 19, 21)
BUOYS, PALLETS, CHAINS, FENDERS = (22, 25), (23, 24, 26), (27, 28), (29, 30)
# city-ships
HATCHES, MUSHROOMS, DOMES, BOXVENTS, WINDLASS = (0, 1, 2, 3), (4, 5), (6, 9), (7, 8), (10, 11)
RAFTS, LIGHTS, WINCHES, PADS, LOCKERS = (12, 13, 14), (15, 16, 17), (18, 19, 20), (21, 22), (23, 24)


def main():
    rng = random.Random(7071)
    decor = [e for e in json.load(open(os.path.join(D, 'decor.json'))) if not e['sprite'].startswith(CATS)]
    load = lambda n: json.load(open(os.path.join(D, n))) if os.path.exists(os.path.join(D, n)) else []
    busy = [(o['x'], o['y'], 26) for o in load('enemies.json')] + [(o['x'], o['y'], 18) for o in load('powerups.json')] + \
           [(o['x'], o['y'], 14) for o in load('boxes.json')] + [(f['x'], f['y'], 50) for f in load('features.json')]
    c = np.array(Image.open(os.path.join(D, 'collision.png')).convert('L'))
    open_ = c > 0x99
    clear = ndi.distance_transform_edt(open_)
    mine = []

    def free(x, y, r):
        return all(math.hypot(x - bx, y - by) > r + br for bx, by, br in busy) and \
            all(math.hypot(x - e['x'], y - e['y']) > r + e['_r'] for e in mine)

    def put(cat, i, x, y, length, rot=0.0, effect='shadow', strength=0.45, r=None, check=False):
        """length: the sprite's long side in level px; rotation counter-clockwise."""
        w, h = SIZES[cat][i]['w'], SIZES[cat][i]['h']
        if check and not free(x, y, r or length / 2): return False
        e = {'sprite': f'{cat}/{i:02d}.png', 'x': round(x), 'y': round(y), 'scale': round(length / max(w, h), 4), 'rotation': round(rot % 360, 2), 'effect': effect}
        if strength is not None: e['strength'] = strength
        e['_r'] = r if r is not None else length / 2
        mine.append(e)
        return True

    # ---- cranes: the house over the legs, the boom out over the water
    booms = {0: 90, 1: 90, 2: 90, 3: 180, 4: 90}   # per crane in layout.CRANES, counter-clockwise from east
    for k, (cx, cy) in enumerate(L.CRANES):
        i = CRANES[k % 3]
        w = SIZES['city-docks'][i]['w']
        length = 240 if i != 1 else 200
        s = length / w
        off = 0.3 * length        # the house sits 20% in from the sprite's left end
        a = math.radians(booms[k])
        put('city-docks', i, cx + math.cos(a) * off, cy - math.sin(a) * off, length, booms[k], strength=0.7, r=0)

    # ---- the quay edge: bollards on the bollard posts, ropes and rings along every edge
    for x in (60, 470, 760, 1000, 1160):
        put('city-docks', rng.choice(BOLLARDS), x, L.QY + 12, 16, 0, r=0)
    water = (c > 0) & (c <= 0x99)
    wd = ndi.distance_transform_edt(~water)
    from docks import raster
    hulls = raster(L.W, L.H, polys=list(L.HULLS.values()))
    gang = raster(L.W, L.H, rects=list(L.GANGWAYS.values()))
    quay_edge = open_ & ~hulls & ~gang & (wd > 9) & (wd < 13) & (clear > 9)
    ys, xs = np.nonzero(quay_edge[::6, ::6])
    pts = list(zip(xs * 6, ys * 6))
    rng.shuffle(pts)
    n_ring = n_coil = n_chain = 0
    for x, y in pts:
        if n_ring < 9 and put('city-docks', rng.choice(RINGS), x, y, 15, rng.uniform(0, 360), r=12, check=True): n_ring += 1; continue
        if n_coil < 10 and put('city-docks', rng.choice(COILS), x, y, 15, rng.uniform(0, 360), r=12, check=True): n_coil += 1; continue
        if n_chain < 4:
            # a chain lying along the edge
            gy, gx = np.gradient(ndi.gaussian_filter(wd.astype(np.float32), 3))
            ang = -math.degrees(math.atan2(gy[y, x], gx[y, x])) + 90
            if put('city-docks', rng.choice(CHAINS), x, y, 40, ang, r=22, check=True): n_chain += 1
        if n_ring >= 9 and n_coil >= 10 and n_chain >= 4: break

    # fenders: where a ship lies alongside a pier, hung over the pier's edge
    for (x, y, rot) in ((424, 600, 90), (424, 800, 90), (944, 760, 90), (944, 940, 90), (1296, 420, 90), (1296, 560, 90)):
        put('city-docks', rng.choice(FENDERS), x, y, 34, rot, strength=0.5, r=0)

    # ---- the yards: drums and pallets landside and in the dockyard, buoys out in the harbour
    yard = [(130, 1360), (60, 1290), (660, 1260), (860, 1260), (1260, 1250), (1460, 1250), (1350, 260), (1760, 990), (1340, 1000),
            (1460, 1060), (290, 1070), (1700, 1100), (980, 1250), (500, 1090)]
    for x, y in yard:
        if rng.random() < 0.55: put('city-docks', rng.choice(DRUMS), x, y, 24, rng.uniform(0, 360), r=16, check=True)
        else: put('city-docks', rng.choice(PALLETS), x, y, 24, rng.choice((0, 90)) + rng.uniform(-8, 8), r=16, check=True)
    for k, (x, y) in enumerate(((240, 300), (260, 990), (1000, 200), (1240, 170), (760, 360), (980, 980))):
        put('city-docks', BUOYS[k % 2], x, y, 20, 0, effect='glow', strength=0.35, r=0)

    # ---- the ships
    def deck_spots(name, margin=12):
        h = raster(L.W, L.H, polys=[L.HULLS[name]]) & open_ & (clear >= margin)
        e = ndi.distance_transform_edt(h)
        return h, e

    def scatter(name, items, n, length, margin=12, rot=None):
        h, e = deck_spots(name, margin)
        ys, xs = np.nonzero(h[::4, ::4] & (e[::4, ::4] >= margin))
        pts = list(zip(xs * 4, ys * 4))
        rng.shuffle(pts)
        k = 0
        for x, y in pts:
            if k >= n: break
            r_ = rot if rot is not None else rng.choice((0, 90, 180, 270))
            if put('city-ships', rng.choice(items), x, y, length, r_, strength=0.4, r=length * 0.75, check=True): k += 1

    for name, (x0, y0, x1, y1, bow) in L.SHIPS.items():
        small = 'gunboat' in name
        # windlass on the bow, its chain running forward
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if not small:
            if bow == 'n': put('city-ships', rng.choice(WINDLASS), cx, y0 + 46, 30, 90, r=0)
            elif bow == 's': put('city-ships', rng.choice(WINDLASS), cx, y1 - 46, 30, 270, r=0)
            elif bow == 'e': put('city-ships', rng.choice(WINDLASS), x1 - 46, cy, 30, 0, r=0)
        if small:
            scatter(name, HATCHES + BOXVENTS, 2, 13)
            continue
        scatter(name, HATCHES, 3, 18)
        scatter(name, MUSHROOMS + BOXVENTS, 3, 14)
        scatter(name, RAFTS, 2, 22, margin=8)
        scatter(name, WINCHES, 1, 22)
        scatter(name, LOCKERS, 1, 16)

    # bridges: radar domes and searchlights on the roofs
    for name, pts in L.SUPER:
        if 'bridge' not in name: continue
        xs_, ys_ = [p[0] for p in pts], [p[1] for p in pts]
        bx0, bx1, by0, by1 = min(xs_), max(xs_), min(ys_), max(ys_)
        put('city-ships', rng.choice(DOMES), (bx0 + bx1) / 2, (by0 + by1) / 2, 18, 0, strength=0.6, r=0)
        put('city-ships', rng.choice(LIGHTS), bx0 + 8, by0 + 8, 10, 45, strength=0.5, r=0)
        put('city-ships', rng.choice(LIGHTS), bx1 - 8, by0 + 8, 10, -45, strength=0.5, r=0)
    # helicopter pads: the cruiser's afterdeck, the flagship's hangar roof
    put('city-ships', PADS[0], 410, 220, 54, 0, effect='paint', strength=None, r=0)
    put('city-ships', PADS[1], 1110, 910, 52, 0, effect='paint', strength=None, r=0)

    for e in mine: e.pop('_r')
    paint = [e for e in mine if e['effect'] == 'paint']
    rest = [e for e in mine if e['effect'] != 'paint']
    decor = paint + decor + rest
    write_decor(os.path.join(D, 'decor.json'), decor)
    print(f'decor.json: {len(mine)} Shipyard decor placements, {len(decor)} in all')


if __name__ == '__main__':
    main()

"""Level 06 Downtown: the first-draft layout, written as the standard level files.

    python tools/levels/06_Downtown/layout.py                    # writes levels/06_Downtown/*.json
    python tools/levels/06_Downtown/layout.py --preview out.png  # also a schematic PNG

A one-off tool for this level (each map is its own task, see the level plan). The plan's
idea: dense alleys with barrel clusters; gnat drones, scurge swarms and fire barrels; the
enemy generator (a destroyable spawner) as the new mechanic; the city art set at night.

Where 04 Urban is wide streets on a grid with tanks driving loops, Downtown is the old city
core: one solid mass of buildings with the alleys carved out of it, 56-80 px wide, with
jogs, dead ends and small squares. Sight lines are short, so turrets matter less and the
swarms come round corners at you; the new Flamer and Pepper Bombs are made for that.
Fire barrels sit in clusters at the junctions so they can be set off under a swarm.

The map is three districts, unlocked one after another by killing a drone hive:
  Market (south-west, the start) -> hive 1 in the fish market opens the shutter to
  the Neon Strip and the back alleys (south and east) -> hive 2 in the parking garage opens
  the shutter to the Old Town (north): the spire plaza (hive 3) and the gate square with the
  exit (hive 4, the final room). A sinkhole separates the market from the Old Town: you can
  see and shoot across it, but not cross.

collision.json is one "city mass" wall with the alleys cut out of it ("open" shapes), lot
lines (thin chasm gaps between buildings, so the art kit gives each building its own roof),
and small walls for stalls, kiosks and dumpsters. Every piece is its own shape in the
editor's shape stack. collision.png is baked from it by tools/levels/bake_collision.mjs.
Re-running this overwrites hand edits in the files it writes.
"""
import argparse
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FOLDER = '06_Downtown'

W, H = 1600, 1280
B = 20          # outer wall
rng = random.Random(606)


def num(v):
    v = round(v, 2)
    return int(v) if float(v).is_integer() else v


def poly_d(pts):
    return 'M ' + ' L '.join(f'{num(x)} {num(y)}' for x, y in pts) + ' Z'


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def chamfer_rect(x0, y0, x1, y1, c=6):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def pts_of(r):
    """An open area: a rectangle (x0, y0, x1, y1) or a polygon's points."""
    return rect(*r) if len(r) == 4 and not isinstance(r[0], tuple) else r


def bbox(r):
    p = pts_of(r)
    return min(x for x, _ in p), min(y for _, y in p), max(x for x, _ in p), max(y for _, y in p)


def octagon(cx, cy, r):
    c = r * 0.41
    return chamfer_rect(cx - r, cy - r, cx + r, cy + r, c)


def blob(cx, cy, rx, ry, n=14, jitter=0.18):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rng.uniform(-jitter, jitter)
        pts.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k))
    return pts


# ---------------------------------------------------------------- the open city
# Every open area: name -> (x0, y0, x1, y1). Districts in comments.
OPEN = {
    # --- the Market (south-west): the start, stall lanes, the fish market (hive 1)
    'market lane': (B, 1184, 640, H - B),           # the bottom lane; the entrance at its west end
    'west alley': (40, 760, 100, 1184),
    'stall lane': (100, 966, 620, 1026),
    'noodle yard': (176, 1026, 244, 1122),          # dead end off the stall lane: the Flamer
    'lantern alley': [(260, 760), (320, 760), (320, 850), (296, 874), (296, 966), (236, 966), (236, 874), (260, 850)],
    'fish market link': (300, 816, 352, 876),
    'fish market': (352, 770, 540, 930),            # hive 1
    'fish market steps': (420, 930, 480, 966),
    'east market alley': (560, 770, 620, 1184),
    'canal walk': (40, 704, 620, 760),              # along the sinkhole's south edge
    'shutter 1': (620, 1100, 700, 1160),            # door 1, opened by hive 1
    # --- the Neon Strip and the back alleys (south and east)
    'neon strip': (700, 660, 804, H - B),
    'pawn alley': (804, 1110, 1180, 1170),
    'noodle alley': (804, 830, 1000, 890),
    'laundry yard': (1000, 760, 1130, 960),         # the Pepper Bombs
    'yard link': (1130, 880, 1180, 940),
    'back alley': (1180, 700, 1240, 1244),
    'rail lane': (1240, 700, 1500, 760),
    'east alley': (1500, 700, 1560, 1190),
    'loading lane': (1240, 1190, 1560, 1244),
    'garage': (1290, 800, 1460, 1130),              # hive 2
    'garage ramp east': (1460, 900, 1500, 960),
    'garage ramp west': (1240, 1050, 1290, 1110),
    'arcade row': (804, 620, 1180, 680),
    'arcade link': (1180, 620, 1240, 700),
    'pigeon alley': (1380, 560, 1440, 700),         # dead end off the rail lane
    'shutter 2': (722, 520, 782, 660),              # door 2, opened by hive 2
    # --- the Old Town (north)
    'high street': (260, 470, 1180, 530),
    'stair alley': (400, 530, 460, 580),
    'sinkhole edge': (40, 580, 640, 634),           # across the sinkhole from the canal walk
    'west lane': (40, 40, 100, 580),
    'shrine link': (100, 290, 128, 350),
    'shrine yard': (128, 240, 236, 400),
    'north lane': (100, 40, 1240, 100),
    'tea alley': [(260, 100), (320, 100), (320, 220), (356, 256), (356, 340), (320, 376), (320, 470), (260, 470), (260, 352), (296, 316), (296, 280), (260, 244)],
    'spire plaza': (500, 160, 960, 470),            # hive 3, round the spire
    'clock alley': (1100, 100, 1160, 470),
    'gate neck': (1160, 380, 1240, 440),
    'gate square': (1240, 40, 1560, 440),           # the final room: hive 4 and the exit
}
SPIRE = (636, 250, 824, 384)                        # the building in the middle of the plaza
SINKHOLE = (40, 634, 640, 704)                      # chasm: shoot across, don't cross
DOOR1 = (660, 1130)
DOOR2 = (752, 612)
DOOR3 = ((1200, 410), (1200, 70))                   # both ways into the gate square, opened by hive 3

# vision zones: an enemy attacks only while the player is in a zone it stands in (and it can see
# them), so each zone is one street, yard or square, reaching a little into the alleys off it.
# Zones overlap where streets meet. Hive prints take the zone of their hive.
VISION = {
    'start': (20, 1170, 190, 1260),                 # its own zone: the lane's scurge wake as you leave it
    'market lane': (170, 1170, 660, 1260),
    'west alley': (30, 750, 110, 1194),
    'stall lane': (90, 956, 630, 1132),
    'fish market': (226, 750, 630, 976),
    'east market alley': (550, 760, 630, 1194),
    'sinkhole': (30, 570, 650, 770),                # both edges: shoot across the sinkhole
    'neon strip': (690, 650, 814, 1260),
    'pawn alley': (794, 1100, 1190, 1180),
    'laundry yard': (794, 750, 1190, 970),
    'back alley': (1170, 690, 1250, 1254),
    'garage': (1230, 790, 1510, 1140),
    'rail lane': (1230, 550, 1570, 770),
    'east alley': (1490, 690, 1570, 1254),
    'loading lane': (1230, 1180, 1570, 1254),
    'arcade row': (712, 510, 1250, 690),
    'high street': (250, 460, 1190, 590),
    'west lane': (30, 30, 246, 590),
    'north lane': (90, 30, 1250, 110),
    'tea alley': (250, 90, 366, 480),
    'spire plaza': (490, 150, 970, 480),
    'clock alley': (1090, 90, 1250, 450),
    'gate square': (1230, 30, 1570, 450),
}

shapes = []


def add(name, d, mode='wall', group=None):
    s = {'name': name, 'mode': mode, 'd': d}
    if group: s['group'] = group
    shapes.append(s)


add('city mass', poly_d(rect(0, 0, W, H)), group='city')


# ---------------------------------------------------------------- small walls: cover in the open
SMALL = []   # (name, pts, group)


def small(name, pts, group):
    SMALL.append((name, pts, group))


# market stalls: low counters down the middle of the stall lane and round the fish market
for k, (x, y) in enumerate(((300, 966), (380, 1012), (520, 966))):   # against the lane's walls
    small(f'stall {k + 1}', chamfer_rect(x - 22, y, x + 22, y + 14, 4), 'market stalls')
for k, (x, y) in enumerate(((392, 806), (500, 806), (392, 894), (500, 894))):
    small(f'fish stall {k + 1}', chamfer_rect(x - 16, y - 9, x + 16, y + 9, 4), 'market stalls')
# neon strip: kiosks down the middle and two wrecked cars
for k, y in enumerate((760, 960, 1180)):
    small(f'kiosk {k + 1}', chamfer_rect(740, y - 16, 764, y + 16, 5), 'strip kiosks')
small('wreck 1', chamfer_rect(716, 1052, 742, 1100, 7), 'strip kiosks')
small('wreck 2', chamfer_rect(708, 846, 734, 894, 7), 'strip kiosks')
# dumpsters along the back alleys
for k, (x, y, w, h) in enumerate(((1233, 812, 14, 30), (1187, 1010, 14, 30), (1553, 820, 14, 30), (1553, 1080, 14, 30), (1360, 1237, 34, 14), (980, 1117, 34, 14))):
    small(f'dumpster {k + 1}', chamfer_rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2, 3), 'dumpsters')
# the garage: concrete pillars in two rows
for k, (x, y) in enumerate(((1340, 880), (1410, 880), (1340, 1000), (1410, 1000))):
    small(f'garage pillar {k + 1}', chamfer_rect(x - 9, y - 9, x + 9, y + 9, 3), 'garage')
# spire plaza: planters on the plaza corners
for k, (x, y) in enumerate(((540, 200), (920, 200), (540, 430), (920, 430))):
    small(f'plaza planter {k + 1}', octagon(x, y, 16), 'plaza')
# gate square: barricades in front of the exit
for k, (x, y, w, h) in enumerate(((1330, 200, 60, 14), (1470, 260, 14, 60), (1330, 330, 60, 14))):
    small(f'gate barricade {k + 1}', chamfer_rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2, 4), 'gate square')


# ---------------------------------------------------------------- lot lines
def raster(with_lots=()):
    """0 open, 1 wall, 2 chasm: the map as the shapes would bake it (for the tool's own use)."""
    im = Image.new('L', (W, H), 1)
    d = ImageDraw.Draw(im)
    for x0, y0, x1, y1 in with_lots: d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=2)
    d.polygon(SINK_PTS, fill=2)
    for r in OPEN.values(): d.polygon(pts_of(r), fill=0)
    for r in BAYS: d.rectangle([r[0], r[1], r[2] - 1, r[3] - 1], fill=0)
    d.rectangle([SPIRE[0], SPIRE[1], SPIRE[2] - 1, SPIRE[3] - 1], fill=1)
    for _, pts, _ in SMALL: d.polygon(pts, fill=1)
    return np.array(im)


BAYS = []


def doorways():
    """Shallow recesses in the alley walls (doorways, loading bays): the alleys aren't ruled
    straight. Only where the wall behind is deep enough, and never into another space."""
    m = raster() == 1
    deep = ndi.distance_transform_edt(m)
    for name, r in OPEN.items():
        if not (len(r) == 4 and not isinstance(r[0], tuple)): continue
        x0, y0, x1, y1 = r
        horiz = (x1 - x0) > (y1 - y0)
        L = (x1 - x0) if horiz else (y1 - y0)
        for side in (0, 1):
            t = rng.uniform(30, 90)
            while t < L - 60:
                w, dep = rng.choice((24, 30, 36, 44)), rng.choice((10, 12, 16))
                if horiz:
                    bx0, bx1 = x0 + t, x0 + t + w
                    by0, by1 = (y0 - dep, y0) if side == 0 else (y1, y1 + dep)
                    cx, cy = (bx0 + bx1) / 2, (by0 - 14 if side == 0 else by1 + 14)
                else:
                    by0, by1 = y0 + t, y0 + t + w
                    bx0, bx1 = (x0 - dep, x0) if side == 0 else (x1, x1 + dep)
                    cx, cy = (bx0 - 14 if side == 0 else bx1 + 14), (by0 + by1) / 2
                ix, iy = int(cx), int(cy)
                if 0 <= ix < W and 0 <= iy < H and deep[iy, ix] > 10 and m[int(by0):int(by1), int(bx0):int(bx1)].all():
                    BAYS.append((bx0, by0, bx1, by1))
                    m[int(by0) - 30:int(by1) + 30, int(bx0) - 30:int(bx1) + 30] = False
                t += w + rng.uniform(70, 190)


SINK_PTS = blob((SINKHOLE[0] + SINKHOLE[2]) / 2, (SINKHOLE[1] + SINKHOLE[3]) / 2, 296, 40, 28, 0.06)
doorways()
LOT = 5   # lot line width


def lot_lines():
    """Split the city mass into buildings with thin gaps: cut every block wider or taller than
    about 200 px across, at a random point, along its whole depth."""
    lots = []
    for axis in (1, 0):  # vertical cuts first (splitting wide blocks), then horizontal
        m = raster(lots) == 1
        m[:B, :] = m[-B:, :] = m[:, :B] = m[:, -B:] = False   # the outer wall stays whole
        lab, n = ndi.label(m)
        for k, sl in enumerate(ndi.find_objects(lab), 1):
            ys, xs = sl
            span = (xs.stop - xs.start) if axis == 1 else (ys.stop - ys.start)
            if span < 200: continue
            cuts = max(1, int(span // 170))
            for c in range(cuts):
                t = (c + 1) / (cuts + 1) + rng.uniform(-0.12, 0.12) / (cuts + 1)
                if axis == 1:
                    x = int(xs.start + span * t)
                    col = lab[:, x] == k
                    for y0, y1 in runs(col):
                        if y1 - y0 > 24: lots.append((x - LOT // 2, max(B, y0 - 1), x - LOT // 2 + LOT, min(H - B, y1 + 1)))
                else:
                    y = int(ys.start + span * t)
                    row = lab[y, :] == k
                    for x0, x1 in runs(row):
                        if x1 - x0 > 24: lots.append((max(B, x0 - 1), y - LOT // 2, min(W - B, x1 + 1), y - LOT // 2 + LOT))
    return lots


def runs(v):
    out, start = [], None
    for i, on in enumerate(list(v) + [False]):
        if on and start is None: start = i
        if not on and start is not None: out.append((start, i)); start = None
    return out


LOTS = lot_lines()
for k, r in enumerate(LOTS):
    add(f'lot line {k + 1}', poly_d(rect(*r)), mode='chasm', group='lot lines')
add('sinkhole', poly_d(SINK_PTS), mode='chasm', group='sinkhole')
for name, r in OPEN.items():
    add(name, poly_d(pts_of(r)), mode='open', group='alleys')
for k, r in enumerate(BAYS):
    add(f'doorway {k + 1}', poly_d(rect(*r)), mode='open', group='doorways')
add('the spire', poly_d(chamfer_rect(*SPIRE, 18)), group='city')
for name, pts, group in SMALL:
    add(name, poly_d(pts), group=group)


# ---------------------------------------------------------------- placements
def P(symbol, x, y, props=None, rot=None, scale=None, name=None):
    o = {'symbol': symbol, 'x': num(x), 'y': num(y)}
    if rot is not None:
        a = math.radians(rot)
        o['matrix'] = [num(math.cos(a) * 1e4) / 1e4, num(math.sin(a) * 1e4) / 1e4, num(-math.sin(a) * 1e4) / 1e4, num(math.cos(a) * 1e4) / 1e4]
    if scale is not None: o['scale'] = scale
    if name: o['name'] = name
    if props: o['props'] = props
    return o


def centre(name):
    x0, y0, x1, y1 = bbox(OPEN[name])
    return (x0 + x1) / 2, (y0 + y1) / 2


features = [
    P('game objects/entrance_mc', 70, 1222, name='entrance_mc', rot=90),
    P('game objects/exit_mc', 1490, 110, name='exit_mc'),
]

HIVE = 'enemy assets/enemy hive'
DRONE = 'enemy assets/enemy drone'          # the Swarmer: the recovered scout drone
GNAT = 'enemy assets/enemy gnat'
BOT = 'enemy assets/enemy barrel bot'
STINGER, STINGER2, STINGER3 = 'enemy assets/enemy stinger', 'enemy assets/enemy stinger2', 'enemy assets/enemy stinger3'
WOLFGUN, BATTERY = 'enemy assets/enemy wolfgun', 'enemy assets/enemy double battery'
SCURGE, BARREL = 'enemy assets/enemy scurge', 'enemy assets/enemy object fire barrel'

enemies = []
E = lambda sym, x, y, **kw: enemies.append(P(sym, x, y, **kw))


def tri(x, y, s=28, down=False):
    k = -1 if down else 1
    for dx, dy in ((0, -k * s * 0.58), (-s / 2, k * s * 0.29), (s / 2, k * s * 0.29)):
        E(SCURGE, x + dx, y + dy)


def grid(x, y, cols, rows, s=28):
    for i in range(cols):
        for j in range(rows):
            E(SCURGE, x + (i - (cols - 1) / 2) * s, y + (j - (rows - 1) / 2) * s)


def barrels(x, y, n=3, r=15):
    """A cluster of fire barrels, packed tight so one sets off the rest."""
    for k in range(n):
        a = 2 * math.pi * k / n + rng.uniform(-0.3, 0.3)
        rr = 0 if n == 1 else r
        E(BARREL, x + math.cos(a) * rr, y + math.sin(a) * rr)


def pack(sym, x, y, n=3, r=18):
    for k in range(n):
        a = 2 * math.pi * k / n
        E(sym, x + math.cos(a) * r, y + math.sin(a) * r)


# the hives: what each spawns, how many at once, how often (frames). Their death opens a shutter.
HIVES = [
    ('hive 1', centre('fish market'), {'breed': 'enemyDroneGnat', 'breedMax': 4, 'breedRate': 70, 'onDie': {'$trigger': 'door1:open'}}),
    ('hive 2', (1375, 940), {'breed': 'enemySwarmer', 'breedMax': 3, 'breedRate': 90, 'onDie': {'$trigger': 'door2:open'}}),
    ('hive 3', (730, 205), {'breed': 'enemyBarrelBot', 'breedMax': 3, 'breedRate': 80, 'onDie': {'$trigger': 'door3:open'}}),
    ('hive 4', (1400, 120), {'breed': 'enemySwarmer,enemyDroneGnat', 'breedMax': 5, 'breedRate': 55, 'health': 600,
                             'powerupDrop': {'type': 'health', 'item': 'health', 'quantity': 50}}),
]
for name, (x, y), props in HIVES:
    E(HIVE, x, y, props=props)

# --- the Market: a gentle start, the Flamer in the noodle yard, swarms in the lanes
tri(250, 1222)
barrels(330, 1214)
pack(GNAT, 420, 1220, 3)
E(STINGER, 600, 1210)
E(STINGER, 590, 1060)
grid(210, 1100, 2, 1)                       # the noodle yard: something to burn
barrels(70, 990)
pack(DRONE, 70, 860, 2, 16)                 # first Swarmers, up the west alley
E(STINGER2, 290, 780)
barrels(266, 940, 3)
grid(470, 996, 3, 1)
barrels(590, 1000)
E(WOLFGUN, 590, 800)
# the fish market: hive 1 behind its stalls, scurge on the corners, a stinger3 over it
tri(380, 840, s=24)
tri(510, 860, s=24, down=True)
E(STINGER3, 446, 786)
barrels(446, 915, 2, 10)
E(STINGER, 600, 732)
barrels(520, 732)
# --- the Neon Strip: a gauntlet of Swarmer packs between the kiosks, barrels under them
E(STINGER2, 724, 1236)
pack(DRONE, 762, 1140, 3)
barrels(776, 1034, 3)
pack(GNAT, 760, 910, 3)
barrels(722, 820, 3)
E(STINGER3, 782, 690)
grid(752, 718, 3, 1)
E(WOLFGUN, 722, 690)
# pawn alley and the noodle alley to the laundry yard (Pepper Bombs)
tri(900, 1140)
barrels(1060, 1140, 4)
E(STINGER, 1160, 1150)
barrels(990, 860, 3)
pack(BOT, 1065, 860, 3, 22)                 # first Barrel Bots, waiting in the yard
E(STINGER2, 1110, 780)
E(WOLFGUN, 1020, 940)
# the back alleys round the garage
E(STINGER, 1210, 730)
barrels(1210, 1140, 3)
tri(1380, 730)
E(STINGER3, 1530, 730)
grid(1530, 960, 1, 2)
barrels(1530, 1150, 3)
grid(1400, 1218, 3, 1)
pack(DRONE, 1500, 1218, 2, 16)
# arcade row: a lane of shuttered arcades between the strip and the back alley
pack(DRONE, 900, 650, 3)
barrels(1000, 650, 3)
grid(1100, 650, 3, 1)
E(STINGER, 1210, 640)
E(STINGER3, 1410, 580)                      # pigeon alley: guarding a stash
# the garage: hive 2 between the pillars, guns on the far wall
E(BATTERY, 1375, 815, rot=180)
E(STINGER2, 1310, 1110)
E(STINGER2, 1440, 1110)
tri(1375, 1060, s=26)
barrels(1334, 826, 2, 10)
barrels(1440, 830, 2, 10)
# --- the Old Town: up through shutter 2
barrels(640, 500, 3)
barrels(880, 500, 3)
E(STINGER, 400, 500)
E(STINGER2, 1150, 500)
grid(330, 607, 3, 1)                         # sinkhole edge: across from the canal walk
E(WOLFGUN, 600, 607)
pack(BOT, 160, 607, 2, 16)
grid(70, 420, 1, 3)                          # west lane
E(STINGER, 70, 230)
barrels(182, 270, 2, 10)                     # shrine yard
grid(182, 330, 2, 2)
E(STINGER3, 205, 380)
barrels(290, 150, 3)
grid(500, 70, 4, 1)                          # north lane
barrels(820, 70, 4)
E(STINGER, 1000, 70)
# the spire plaza: hive 3 (Barrel Bots) on the north side, guns round the spire
E(BATTERY, 730, 420)
E(STINGER3, 600, 300)
E(STINGER3, 860, 330)
E(WOLFGUN, 900, 180)
grid(560, 330, 2, 2)
grid(900, 260, 2, 2)
barrels(620, 440, 3)
barrels(840, 200, 3)
grid(1130, 300, 1, 3)                        # clock alley
E(STINGER2, 1130, 130)
# --- the gate square: the final room. Hive 4, a double battery and stinger3s over the exit,
# packed scurge and barrels behind the barricades
E(BATTERY, 1280, 70, rot=90)
E(STINGER3, 1540, 200)
E(STINGER3, 1420, 410)
E(STINGER2, 1270, 410)
E(WOLFGUN, 1540, 420)
grid(1400, 260, 4, 3, s=24)
grid(1300, 140, 2, 3, s=24)
barrels(1330, 230, 3, 13)
barrels(1500, 330, 4)
pack(DRONE, 1380, 180, 3)
pack(BOT, 1500, 200, 2, 14)

# pickups
pick = []


def pickup(x, y, type_, item, q, **kw):
    pick.append(P('game objects/powerup', x, y, props=dict({'type': type_, 'item': item, 'quantity': q}, **kw)))


pickup(210, 1056, 'primary', 'Flamer', 200)          # the noodle yard
pickup(70, 1110, 'health', 'health', 25)
pickup(140, 1222, 'primary', 'Bolter', 40)
pickup(450, 948, 'health', 'health', 50)              # the fish market
pickup(590, 1150, 'secondary', 'Carbon Bomb', 2)
pickup(70, 740, 'primary', 'Flamer', 100)
pickup(1090, 900, 'secondary', 'Pepper Bombs', 15)    # the laundry yard
pickup(1075, 795, 'health', 'health', 50)
pickup(780, 1236, 'primary', 'Plasma', 15)
pickup(1530, 1220, 'health', 'health', 25)
pickup(1420, 1100, 'primary', 'Flamer', 120)          # the garage
pickup(1270, 730, 'secondary', 'Pepper Bombs', 10)
pickup(1410, 640, 'health', 'health', 50)             # pigeon alley
pickup(182, 300, 'health', 'health', 50)              # the shrine yard
pickup(182, 360, 'secondary', 'Pepper Bombs', 10)
pickup(600, 190, 'primary', 'Vertigo', 60)
pickup(1130, 440, 'health', 'health', 50)
pickup(1130, 200, 'primary', 'Flamer', 120)
pickup(1270, 300, 'health', 'health', 50)             # the final room
pickup(1540, 70, 'secondary', 'Pepper Bombs', 10)

doors = [P('game objects/door', *DOOR1, props={'id': 'door1'}), P('game objects/door', *DOOR2, rot=90, props={'id': 'door2'})] + \
    [P('game objects/door', *xy, props={'id': 'door3'}) for xy in DOOR3]
vision = [{'x': x0, 'y': y0, 'points': [[0, 0], [x1 - x0, 0], [x1 - x0, y1 - y0], [0, y1 - y0]]} for x0, y0, x1, y1 in VISION.values()]

# boxes: crates stacked against the walls of the lanes, some carrying drops
boxes = []
brng = random.Random(6060)
DROPS = [{'type': 'health', 'item': 'health', 'quantity': 25}, {'type': 'primary', 'item': 'Bolter', 'quantity': 25},
         {'type': 'primary', 'item': 'Flamer', 'quantity': 60}, {'type': 'secondary', 'item': 'Pepper Bombs', 'quantity': 5},
         {'type': 'secondary', 'item': 'Carbon Bomb', 'quantity': 1}, {'type': 'primary', 'item': 'Vertigo', 'quantity': 30}]


def crates(x, y, n, dx=20, dy=0, drop=None):
    for k in range(n):
        o = P('game objects/box', x + k * dx, y + k * dy)
        if drop is not False and k == n // 2 and (drop or brng.random() < 0.45):
            o['scale'] = 1.285706
            o['props'] = {'health': 25, 'powerupDrop': drop or brng.choice(DROPS)}
        boxes.append(o)


def stack(x, y):
    for dx in (0, 20):
        crates(x + dx, y, 2, 0, 20, drop=False)


crates(110, 1198, 3)
crates(52, 790, 1, 0, 20)
stack(236, 984)
crates(440, 1012, 3)
crates(140, 716, 4)
crates(600, 900, 3, 0, 20)
stack(470, 1196)
crates(420, 716, 2)
crates(820, 1124, 4)
crates(1110, 1124, 3)
crates(712, 1200, 2, 0, 20)
crates(792, 960, 3, 0, 20)
stack(1014, 774)
crates(1060, 944, 3)
crates(1192, 1206, 3)
crates(1260, 1206, 4)
crates(1290, 716, 4)
crates(1516, 1012, 3, 0, 20)
crates(1300, 820, 3, 0, 20)
crates(1440, 1040, 3, 0, -20)
crates(280, 486, 4)
crates(1000, 486, 4)
crates(52, 120, 4, 0, 20)
crates(140, 52, 5)
crates(240, 590, 3)
crates(272, 380, 3, 0, 20)
stack(520, 250)
stack(860, 430)
crates(944, 250, 3, 0, 20)
crates(1260, 52, 5)
crates(1540, 360, 3, 0, -20, drop={'type': 'health', 'item': 'health', 'quantity': 50})
stack(1260, 360)
crates(1176, 392, 3)
crates(830, 636, 3)
crates(1392, 600, 2, drop={'type': 'secondary', 'item': 'Pepper Bombs', 'quantity': 8})

BRIEFING = {
    'title': 'DOWNTOWN',
    'body': ("Downtown revitalization is complete. Every barrel is now\n"
             "explosive and every drone is now judgmental. The robots\n"
             "have installed drone hives in the old town: they print\n"
             "Swarmers and Barrel Bots faster than you can be rude\n"
             "about them. Burn the hives out, one district at a time --\n"
             "each one you kill shuts down a street lock. The exit is\n"
             "in the gate square, behind the last hive. Mind the barrels."),
    'captions': [
        {'style': 'name', 'text': 'Swarmer', 'x': 636.45, 'y': 209.89},
        {'style': 'note', 'text': 'Comes in packs.', 'x': 636.45, 'y': 316.6},
        {'style': 'name', 'text': 'Barrel Bot', 'x': 636.48, 'y': 359.89},
        {'style': 'note', 'text': 'Hugs. Explodes.', 'x': 636.45, 'y': 426.6},
    ],
    'graphics': [
        {'symbol': 'enemy assets/enemy drone core', 'x': 636.5, 'y': 271, 'scale': 1.4},
        {'symbol': 'enemy assets/designs/tentacle mine', 'x': 636.5, 'y': 396, 'scale': 1.4},
        {'symbol': 'screen_mc/shape 3', 'x': 0, 'y': 0},
    ],
}

INTRO = {'Flamer': 'FLAMER UNIT: a short, wide stream of fire. Hold it down and sweep. Swarms hate this.',
         'Pepper Bombs': 'PEPPER BOMBS: a spray of little bomblets. Pepper a pack before it reaches you.'}


def add_intros():
    props = [o['props'] for o in pick] + [o['props']['powerupDrop'] for o in boxes + enemies if 'powerupDrop' in o.get('props', {})]
    for pr in props:
        if pr.get('type') in ('primary', 'secondary') and pr.get('item') in INTRO:
            pr.update(alertMessage=INTRO[pr['item']], alertOnce=True)


# ---------------------------------------------------------------- write
def pretty(v, indent='', width=110):
    def spaced(x):
        if isinstance(x, dict): return '{' + ', '.join(json.dumps(k) + ': ' + spaced(y) for k, y in x.items()) + '}'
        if isinstance(x, list): return '[' + ', '.join(spaced(y) for y in x) + ']'
        return json.dumps(num(x) if isinstance(x, float) else x)
    flat = spaced(v)
    if not isinstance(v, (dict, list)) or len(indent) + len(flat) <= width: return flat
    inner = indent + '  '
    if isinstance(v, list): return '[\n' + ',\n'.join(inner + pretty(x, inner, width) for x in v) + '\n' + indent + ']'
    return '{\n' + ',\n'.join(inner + json.dumps(k) + ': ' + pretty(x, inner, width) for k, x in v.items()) + '\n' + indent + '}'


def list_json(items):
    return '[\n' + ',\n'.join('  ' + pretty(x, '  ') for x in items) + '\n]\n'


PAVED = [OPEN[k] for k in ('fish market', 'laundry yard', 'garage', 'spire plaza', 'gate square', 'shrine yard', 'noodle yard')]


def main():
    add_intros()
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'levels', FOLDER))
    ap.add_argument('--preview')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    files = {
        'collision.json': list_json([{'name': 'collision map', 'pixels': 'collision-base.png', 'locked': True}] + shapes),
        'features.json': list_json(features),
        'pathNodes.json': '[]\n',
        'enemies.json': list_json(enemies),
        'boxes.json': list_json(boxes),
        'powerups.json': list_json(pick),
        'doors.json': list_json(doors),
        'vision.json': list_json(vision),
    }
    for name, text in files.items():
        with open(os.path.join(a.out, name), 'w', encoding='utf-8', newline='\n') as f: f.write(text)
    lj = os.path.join(a.out, 'level.json')
    settings = json.load(open(lj)) if os.path.exists(lj) else {}
    settings['size'] = {'w': W, 'h': H}
    # the city art kit at night: dimmed to moonlight, then lit by the lamps, neon and lanterns
    # (tools/levels/06_Downtown/decor.py), with bigger, stronger light pools than by day
    settings.setdefault('art', {'kit': 'city', 'seed': 606, 'grade': 'night', 'lights': {'radius': 2.6, 'intensity': 1.1, 'bloom': 1.2}})
    settings['art']['paved'] = [[num(v) for v in r] for r in PAVED]
    with open(lj, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n' + ',\n'.join(f'  {json.dumps(k)}: {pretty(v, "  ")}' for k, v in settings.items()) + '\n}\n')
    bj = os.path.join(a.out, 'briefing.json')
    if not os.path.exists(bj):
        with open(bj, 'w', encoding='utf-8', newline='\n') as f: f.write(json.dumps(BRIEFING, indent=2) + '\n')
    base = os.path.join(a.out, 'collision-base.png')
    if not os.path.exists(base): Image.new('RGBA', (W, H), (255, 255, 255, 255)).save(base)
    print('wrote', ', '.join(files), 'and level.json to', a.out)
    if a.preview: preview(a.preview)


def preview(path):
    """A schematic: walls, chasms, hives, enemies, barrels, pickups, crates, doors, plus a legend."""
    from PIL import ImageFont
    r = raster(LOTS)
    im = Image.fromarray(np.choose(r, [np.uint8(232), np.uint8(40), np.uint8(130)]).astype(np.uint8)).convert('RGB')
    im = im.crop((0, 0, W, H)).resize((W, H))
    canvas = Image.new('RGB', (W + 300, H), (20, 20, 20))
    canvas.paste(im, (0, 0))
    d = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
        big = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
    except OSError:
        font = big = ImageFont.load_default()
    for k, (x0, y0, x1, y1) in enumerate(VISION.values()):
        hue = [(90, 200, 90), (90, 140, 230), (220, 160, 60), (200, 90, 200)][k % 4]
        d.rectangle([x0 + 2, y0 + 2, x1 - 2, y1 - 2], outline=hue, width=2)
    for e in enemies:
        s = e['symbol']
        if s == HIVE:
            d.ellipse([e['x'] - 24, e['y'] - 24, e['x'] + 24, e['y'] + 24], fill=(160, 0, 200), outline=(255, 255, 255), width=2)
            continue
        rad = {DRONE: 9, GNAT: 7, BOT: 8, BATTERY: 16, WOLFGUN: 11}.get(s, 8)
        col = {DRONE: (255, 120, 0), GNAT: (255, 200, 120), BOT: (220, 0, 120), SCURGE: (120, 120, 0), BARREL: (255, 30, 30)}.get(s, (230, 190, 0))
        d.ellipse([e['x'] - rad, e['y'] - rad, e['x'] + rad, e['y'] + rad], fill=col)
    for p in pick:
        t = p['props']
        col = (0, 255, 255) if t['item'] in INTRO else (0, 140, 255)
        d.rectangle([p['x'] - 7, p['y'] - 7, p['x'] + 7, p['y'] + 7], outline=col, width=3)
    for b in boxes: d.rectangle([b['x'] - 8, b['y'] - 8, b['x'] + 8, b['y'] + 8], fill=(150, 110, 60))
    for o in doors:
        horiz = 'matrix' in o
        w, h = (30, 7) if horiz else (7, 30)
        d.rectangle([o['x'] - w, o['y'] - h, o['x'] + w, o['y'] + h], fill=(0, 220, 220))
    for f in features: d.ellipse([f['x'] - 22, f['y'] - 22, f['x'] + 22, f['y'] + 22], outline=(0, 200, 0), width=4)
    labels = [('START', 30, 1150), ('MARKET', 120, 880), ('fish market: HIVE 1', 330, 745), ('noodle yard: FLAMER', 120, 1130),
              ('SINKHOLE (shoot across)', 160, 655), ('NEON STRIP', 712, 1060), ('shutter 1', 590, 1166), ('shutter 2', 790, 600),
              ('laundry yard: PEPPER BOMBS', 930, 735), ('arcade row', 900, 690), ('GARAGE: HIVE 2', 1300, 775),
              ('BACK ALLEYS', 1250, 1150), ('OLD TOWN', 120, 110), ('SPIRE PLAZA: HIVE 3', 560, 175), ('spire', 690, 310),
              ('GATE SQUARE: HIVE 4 + EXIT', 1250, 412), ('high street', 520, 486), ('shrine', 140, 245), ('pigeon alley', 1300, 540)]
    for text, x, y in labels:
        d.text((x, y), text, fill=(255, 255, 255), font=font, stroke_width=3, stroke_fill=(0, 0, 0))
    lx, ly = W + 20, 20
    d.text((lx, ly), '06 DOWNTOWN', fill=(255, 255, 255), font=big); ly += 40
    leg = [('ellipse', (160, 0, 200), 'drone hive (new spawner)'), ('ellipse', (255, 120, 0), 'Swarmer drone'), ('ellipse', (255, 200, 120), 'gnat'),
           ('ellipse', (220, 0, 120), 'Barrel Bot'), ('ellipse', (255, 30, 30), 'fire barrel'), ('ellipse', (120, 120, 0), 'scurge'),
           ('ellipse', (230, 190, 0), 'turret (stinger/2/3, wolfgun, battery)'), ('rect', (0, 255, 255), 'Flamer / Pepper Bombs'),
           ('rect', (0, 140, 255), 'other pickup'), ('fill', (150, 110, 60), 'crate'), ('fill', (0, 220, 220), 'shutter (door)'), ('rect', (90, 140, 230), 'vision zone'),
           ('ellipse2', (0, 200, 0), 'entrance / exit'), ('fill', (130, 130, 130), 'chasm / lot gap')]
    for kind, col, text in leg:
        if kind == 'ellipse': d.ellipse([lx, ly, lx + 16, ly + 16], fill=col)
        elif kind == 'ellipse2': d.ellipse([lx, ly, lx + 16, ly + 16], outline=col, width=3)
        elif kind == 'rect': d.rectangle([lx, ly, lx + 16, ly + 16], outline=col, width=3)
        else: d.rectangle([lx, ly, lx + 16, ly + 16], fill=col)
        d.text((lx + 26, ly), text, fill=(230, 230, 230), font=font)
        ly += 28
    ly += 10
    from collections import Counter
    cnt = Counter(e['symbol'].split('/')[-1] for e in enemies)
    for k, v in sorted(cnt.items(), key=lambda kv: -kv[1]):
        d.text((lx, ly), f'{v:3d}  {k.replace("enemy ", "")}', fill=(200, 200, 200), font=font); ly += 22
    d.text((lx, ly + 10), f'{len(boxes)} crates, {len(pick)} pickups', fill=(200, 200, 200), font=font)
    canvas.save(path)


if __name__ == '__main__':
    main()

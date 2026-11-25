"""Level 07 Shipyard: the first-draft layout, written as the standard level files.

    python tools/levels/07_Shipyard/layout.py                  # writes levels/07_Shipyard/*.json
    python tools/levels/07_Shipyard/layout.py --preview out.png   # also a quick schematic PNG

A one-off tool for this level (see the level plan: each map is its own task). The plan's idea:
"Docks with hulls as islands; double batteries on ships; destroy-to-exit (the exit opens when
the targets die); city street art set (docks, water)". The new enemies are the Deck Battery
(the objective) and the Flak Turret.

How the map plays: the harbour is water, which stops you but not bullets, so most fights are
gun duels across a basin. Four warships each carry a Deck Battery, and the exit (a launch pad
on the lighthouse headland) only opens once all four are scrap:

- the destroyer in the west basin: boardable over one gangway from the west pier
- the cruiser moored out by the breakwater: an island you can never set foot on. It sits close
  to the west pier, the central pier and the breakwater, so you circle it and trade fire
- the flagship in the east basin: boarded over a short gangway from the central pier and a long,
  exposed one from the dockyard. The densest fight
- the frigate in the dry dock: no water round it, a deep pit, crossed on two gantry bridges

Two gunboats in the west basin carry flak turrets and harass the quay and the west pier. Tanks
patrol the quay road and the dockyard round the dry dock. Crates are cargo, not the objective
(required false): the exit ignores them.

Writes collision.json (one vector shape per pier, hull, superstructure, container stack...),
features, pathNodes, enemies, boxes, powerups, doors, an empty vision.json, level.json and briefing.json.
collision.png is baked from collision.json by tools/levels/bake_collision.mjs and the art by
tools/art/bake.py. Re-running overwrites hand edits in those files.
"""
import argparse
import json
import math
import os
import random

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FOLDER = '07_Shipyard'

W, H = 1800, 1400
B = 20            # outer wall
QY = 1040         # the quay's edge: water north of it, the shipyard south of it

rng = random.Random(707)


# ---------------------------------------------------------------- shapes
def num(v):
    v = round(v, 2)
    return int(v) if float(v).is_integer() else v


def poly_d(pts):
    return 'M ' + ' L '.join(f'{num(x)} {num(y)}' for x, y in pts) + ' Z'


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def chamfer_rect(x0, y0, x1, y1, c=8):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def octagon(cx, cy, r):
    return chamfer_rect(cx - r, cy - r, cx + r, cy + r, r * 0.41)


def hull(x0, y0, x1, y1, bow='n', bow_len=None, stern=14):
    """A ship's hull seen from above: a pointed, curved bow at one end and a square stern with
    rounded corners at the other. bow is the compass side the bow points to."""
    horiz = bow in ('e', 'w')
    # work in a frame where the ship lies along +v (bow at v = 0), u across
    L = (x1 - x0) if horiz else (y1 - y0)
    Wd = (y1 - y0) if horiz else (x1 - x0)
    bl = bow_len or Wd * 1.15
    half = Wd / 2
    pts = []
    n = 10
    for i in range(n + 1):                                  # port side of the bow, tip to shoulder
        t = i / n
        pts.append((-half * math.sin(t * math.pi / 2) ** 0.8, bl * (1 - math.cos(t * math.pi / 2))))
    pts += [(-half, L - stern), (-half + stern * 0.3, L - stern * 0.3), (-half + stern, L),
            (half - stern, L), (half - stern * 0.3, L - stern * 0.3), (half, L - stern)]
    for i in range(n, -1, -1):                              # starboard side, shoulder to tip
        t = i / n
        pts.append((half * math.sin(t * math.pi / 2) ** 0.8, bl * (1 - math.cos(t * math.pi / 2))))
    pts = pts[:-1]
    out = []
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for u, v in pts:
        if bow == 'n': out.append((cx + u, y0 + v))
        elif bow == 's': out.append((cx - u, y1 - v))
        elif bow == 'e': out.append((x1 - v, cy + u))
        else: out.append((x0 + v, cy - u))
    return out


shapes = []       # collision.json, bottom first (after the white base)


def add(name, pts, mode='wall', group=None):
    s = {'name': name, 'mode': mode, 'd': pts if isinstance(pts, str) else poly_d(pts)}
    if group: s['group'] = group
    shapes.append(s)


# ---------------------------------------------------------------- the map
# outer wall
add('outer wall', poly_d(rect(0, 0, W, H)) + ' ' + poly_d([(B, B), (B, H - B), (W - B, H - B), (W - B, B)]))

# the harbour: everything north of the quay is water to start with
add('harbour', rect(B, B, W - B, QY), mode='chasm', group='harbour')
# a boat slip cut into the quay, and a little inlet by the entrance
add('boat slip', [(560, QY - 2), (690, QY - 2), (690, QY + 64), (670, QY + 78), (580, QY + 78), (560, QY + 64)], mode='chasm', group='harbour')

# land reaching out into the water (open floor drawn over the harbour)
PIER_W = (300, 330, 420, QY + 2)        # the west pier
PIER_C = (820, 116, 940, QY + 2)        # the central pier, out to the breakwater
BREAK = (560, 56, 1580, 116)            # the breakwater along the north
HEAD = (1560, B - 1, W - B + 1, 260)    # the lighthouse headland (the exit)
YARD = (1300, 220, W - B + 1, QY + 2)   # the dockyard round the dry dock
for name, r in (('west pier', PIER_W), ('central pier', PIER_C), ('breakwater', BREAK), ('headland', HEAD), ('dockyard', YARD)):
    add(name, rect(*r), mode='open', group='docks')
# the breakwater's west end: a round gun platform
add('breakwater platform', octagon(560, 86, 48), mode='open', group='docks')
# the pier heads widen a little (mooring platforms)
add('west pier head', chamfer_rect(286, 330, 434, 400, 10), mode='open', group='docks')

# the dry dock: a deep pit in the dockyard, its frigate on keel blocks in the middle
DOCK = (1430, 300, 1700, 960)
add('dry dock', chamfer_rect(*DOCK, 14), mode='chasm', group='dry dock')

# ships: decks are open floor over the water, so the only way aboard is a gangway
SHIPS = {
    'cruiser': (340, 168, 760, 272, 'e'),       # out by the breakwater, never boarded
    'destroyer': (500, 420, 650, 960, 'n'),     # west basin, gangway from the west pier
    'flagship': (1020, 340, 1200, 970, 'n'),    # east basin, gangways from the central pier and the dockyard
    'frigate': (1505, 360, 1625, 900, 'n'),     # in the dry dock, gantries from both sides
    'gunboat 1': (96, 430, 176, 650, 'n'),      # west basin, never boarded
    'gunboat 2': (150, 740, 230, 940, 's'),
}
HULLS = {}
for name, (x0, y0, x1, y1, bow) in SHIPS.items():
    HULLS[name] = hull(x0, y0, x1, y1, bow, bow_len=(70 if 'gunboat' in name else None))
    add(f'{name} deck', HULLS[name], mode='open', group='ships')

# gangways and gantries: narrow open strips over the water (or the pit)
GANGWAYS = {
    'destroyer gangway': (420 - 2, 676, 500 + 14, 730),
    'flagship west gangway': (940 - 2, 826, 1020 + 16, 880),
    'flagship east gangway': (1200 - 16, 456, 1300 + 2, 508),
    'frigate west gantry': (1430 - 2, 500, 1505 + 12, 552),
    'frigate east gantry': (1625 - 12, 760, 1700 + 2, 812),
}
for name, r in GANGWAYS.items():
    add(name, rect(*r), mode='open', group='gangways')

# superstructures: the ships' bridges, funnels and gun housings are walls on deck
SUPER = [
    # destroyer: bridge block aft of the foredeck, funnel, aft deckhouse
    ('destroyer bridge', chamfer_rect(548, 600, 602, 668, 8)),
    ('destroyer funnel', octagon(575, 760, 18)),
    ('destroyer deckhouse', chamfer_rect(552, 846, 598, 900, 6)),
    # cruiser: a long superstructure down its middle, leaving the gun decks fore and aft
    ('cruiser bridge', chamfer_rect(470, 200, 560, 240, 8)),
    ('cruiser funnel', octagon(596, 220, 16)),
    # flagship: bridge tower, two funnels, a hangar aft, cover blocks on the long deck
    ('flagship bridge', chamfer_rect(1070, 560, 1150, 650, 10)),
    ('flagship funnel 1', octagon(1110, 710, 20)),
    ('flagship funnel 2', octagon(1110, 776, 20)),
    ('flagship hangar', chamfer_rect(1066, 880, 1154, 940, 8)),
    ('flagship mast', octagon(1110, 470, 10)),
    # frigate: bridge and funnel
    ('frigate bridge', chamfer_rect(1540, 600, 1590, 660, 8)),
    ('frigate funnel', octagon(1565, 720, 15)),
    # gunboats: a little wheelhouse each
    ('gunboat 1 wheelhouse', chamfer_rect(122, 560, 150, 596, 5)),
    ('gunboat 2 wheelhouse', chamfer_rect(176, 784, 204, 820, 5)),
]
for name, pts in SUPER:
    add(name, pts, group='superstructures')

# landside: warehouses along the south wall, the harbour office by the entrance
add('warehouse 1', chamfer_rect(300, 1276, 640, H - B + 4, 8), group='landside')
add('warehouse 2', chamfer_rect(880, 1276, 1240, H - B + 4, 8), group='landside')
add('warehouse 3', chamfer_rect(1490, 1236, W - B + 4, H - B + 4, 8), group='landside')
add('harbour office', chamfer_rect(B - 4, 1080, 150, 1170, 8), group='landside')
add('lighthouse', octagon(1720, 70, 30), group='docks')

# container stacks: cover on the quay and the piers (each stack one shape)
CONTAINERS = [
    (690, 1146, 750, 1182), (760, 1146, 820, 1182),                                # container yard west, between the road's lanes
    (1220, 1146, 1330, 1182),                                                      # container yard east
    (842, 330, 870, 400), (890, 470, 918, 540), (842, 620, 870, 690), (890, 900, 918, 970),   # the central pier, staggered
    (314, 520, 342, 590), (376, 820, 404, 890),                                    # the west pier
    (1316, 640, 1344, 710),                                                        # the dockyard
    (1590, 212, 1650, 238),                                                        # the headland
]
for k, r in enumerate(CONTAINERS):
    add(f'container stack {k + 1}', chamfer_rect(*r, 3), group='containers')

# crane legs: dockside gantry cranes stand on four small legs (the crane itself is art)
CRANES = [(360, 1000), (880, 1000), (1360, 990), (1740, 300), (240, 1080)]
for k, (cx, cy) in enumerate(CRANES):
    for dx, dy in ((-26, -22), (26, -22), (-26, 22), (26, 22)):
        add(f'crane {k + 1} leg', chamfer_rect(cx + dx - 6, cy + dy - 6, cx + dx + 6, cy + dy + 6, 3), group='cranes')

# bollards along the quay edge: tiny posts (cover for nothing, art for everything)
for k, x in enumerate((60, 470, 760, 1000, 1160)):
    add(f'bollard {k + 1}', octagon(x, QY + 12, 5), group='bollards')


# ---------------------------------------------------------------- placements
def P(symbol, x, y, props=None, rot=None, scale=None, name=None, color=None):
    o = {'symbol': symbol, 'x': num(x), 'y': num(y)}
    if rot is not None:
        a = math.radians(rot)
        o['matrix'] = [num(math.cos(a) * 1e4) / 1e4, num(math.sin(a) * 1e4) / 1e4, num(-math.sin(a) * 1e4) / 1e4, num(math.cos(a) * 1e4) / 1e4]
    if scale is not None: o['scale'] = scale
    if name: o['name'] = name
    if color: o['color'] = color
    if props: o['props'] = props
    return o


EXIT = (1660, 140)
features = [
    P('game objects/entrance_mc', 80, 1310, name='entrance_mc'),
    P('game objects/exit_mc', *EXIT, name='exit_mc'),
]

# path nodes: one colour per patrol loop, pinned in loop order
GROUPS = {'red': [255, 0, 0, 0], 'blue': [0, 0, 255, 0], 'green': [0, 200, 0, 0]}
nodes, node_n = [], [0]


def loop(group, corners):
    names = []
    for _ in corners:
        node_n[0] += 1
        names.append(f'n{node_n[0]}')
    # every other node 1 px to the right: a vehicle can't drive exactly straight down (see 04 Urban)
    corners = [(x + k % 2, y) for k, (x, y) in enumerate(corners)]
    for k, (x, y) in enumerate(corners):
        nodes.append(P('game objects/node', x, y, name=names[k], color={'multiply': [0, 0, 0, 1], 'add': GROUPS[group]},
                       props={'connections': [{'$ref': names[(k + 1) % len(names)]}, {'$ref': names[k - 1]}]}))
    return (GROUPS[group][0] << 16) | (GROUPS[group][1] << 8) | GROUPS[group][2]


# red: a long loop up and down the quay road: the yard's containers sit between its lanes
red = loop('red', [(200, 1110), (700, 1110), (1200, 1110), (1430, 1110), (1430, 1215), (1200, 1215), (700, 1215), (200, 1215)])
# blue: round the dry dock, its west lane close to the pit so the gangway head stays clear
blue = loop('blue', [(1398, 260), (1740, 260), (1740, 1000), (1398, 1000)])

TANK = 'enemy assets/enemy tank'
SCOUT = 'enemy assets/enemy scout'
DECK = 'enemy assets/enemy deck battery'
FLAK = 'enemy assets/enemy flak turret'
STINGER, STINGER2, STINGER3 = 'enemy assets/enemy stinger', 'enemy assets/enemy stinger2', 'enemy assets/enemy stinger3'
WOLFGUN, BATTERY, LAUNCHER = 'enemy assets/enemy wolfgun', 'enemy assets/enemy double battery', 'enemy assets/enemy missile launcher'
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


def target(x, y, ship, rot):
    """A Deck Battery: the objective. The exit opens when every one is destroyed."""
    E(DECK, x, y, rot=rot, props={'objective': True, 'objectiveName': f'{ship} Deck Battery'})


# --- the four targets
target(575, 520, 'Destroyer', 0)
target(660, 220, 'Cruiser', 90)
target(1110, 860, 'Flagship', 180)
target(1565, 820, 'Frigate', 180)

# Density follows the earlier levels (about 11 enemies and 11 crates per 100k px of floor you
# can reach). Scurge are filler; the flagship is the packed final fight. Every turret type is
# used: stinger, stinger2/3, wolfgun, double battery (on the ships, as the plan says), missile
# launcher, plus the two new ones.
# --- landside: the start, the container yards and the quay road (red tank)
E(TANK, 700, 1215, props={'pathID': red}, rot=90)
E(STINGER, 300, 1058)
E(STINGER, 900, 1058)
E(STINGER2, 1250, 1058)
E(WOLFGUN, 760, 1258)
grid(560, 1164, 3, 1)
grid(920, 1164, 2, 1)
E(BARREL, 460, 1164)
E(BARREL, 1000, 1164)
tri(1100, 1164, s=26)
E(SCOUT, 1370, 1164)
# the gunboats: flak over the west basin
E(FLAK, 136, 500, rot=0)
E(FLAK, 136, 620, rot=180)
E(FLAK, 190, 880, rot=180)
E(STINGER, 190, 770)
# --- the west pier: a gun nest at its head, scurge along it
E(STINGER, 320, 360)
E(STINGER3, 404, 360)
tri(360, 460)
E(BARREL, 400, 640)
tri(360, 950)
# --- the destroyer (boarded over its gangway): the first target, and the Rocket Pod
E(BATTERY, 575, 700, rot=0)
E(STINGER2, 545, 820)
E(STINGER, 605, 820)
E(FLAK, 575, 930, rot=180)
E(SCOUT, 545, 570)
# --- the cruiser (an island): double battery and flak fore and aft, the second target
E(BATTERY, 420, 220, rot=-90)
E(FLAK, 520, 262, rot=180)
E(FLAK, 520, 180, rot=0)
E(STINGER3, 720, 220)
# --- the breakwater: the gun platform at its west end, scurge along it, a launcher at the far end
E(WOLFGUN, 560, 86)
grid(700, 86, 3, 1)
grid(1100, 86, 3, 1)
E(STINGER, 1300, 86)
E(LAUNCHER, 1480, 86)
# --- the central pier: under fire from three ships, scurge between the containers
tri(880, 260)
E(STINGER2, 850, 460)
grid(880, 580, 2, 1)
E(STINGER, 900, 760)
# --- the flagship: the final fight. Batteries, flak, stinger3s, a launcher, a packed deck
E(BATTERY, 1110, 420, rot=0)
E(BATTERY, 1110, 510, rot=0)
E(LAUNCHER, 1046, 640)
E(FLAK, 1050, 710, rot=-90)
E(FLAK, 1170, 710, rot=90)
E(STINGER3, 1050, 860)
E(STINGER3, 1170, 860)
grid(1110, 380, 2, 1, s=30)
grid(1046, 560, 1, 2, s=34)
grid(1174, 560, 1, 3)
grid(1110, 830, 3, 1, s=24)
E(SCOUT, 1045, 790)
E(SCOUT, 1175, 790)
# --- the dockyard round the dry dock (blue tank) and the frigate
E(TANK, 1740, 640, props={'pathID': blue, 'powerupDrop': {'type': 'health', 'item': 'health', 'quantity': 50}}, rot=180)
E(STINGER, 1330, 420)
E(STINGER, 1330, 880)
E(BATTERY, 1565, 450, rot=0)
E(FLAK, 1565, 560, rot=0)
E(STINGER2, 1540, 870)
tri(1565, 395, s=22)
# --- the headland: the exit pad, guarded
E(STINGER3, 1610, 60)
E(WOLFGUN, 1750, 200)
grid(1700, 222, 3, 1)

# pickups
pick = []


def pickup(x, y, type_, item, q, **kw):
    pick.append(P('game objects/powerup', x, y, props=dict({'type': type_, 'item': item, 'quantity': q}, **kw)))


pickup(120, 1230, 'primary', 'Auto Cannon', 120)         # by the start: the new primary
pickup(60, 1250, 'health', 'health', 25)
pickup(575, 440, 'secondary', 'Rocket Pod', 6)            # on the destroyer's bow: the new bomb
pickup(530, 760, 'health', 'health', 50)
pickup(360, 400, 'primary', 'Auto Cannon', 60)
pickup(560, 112, 'secondary', 'Rocket Pod', 4)            # the breakwater's gun platform
pickup(880, 160, 'health', 'health', 50)
pickup(880, 820, 'primary', 'Plasma', 15)
pickup(760, 1330, 'secondary', 'Carbon Bomb', 2)
pickup(1360, 1330, 'primary', 'Bolter', 40)
pickup(1330, 760, 'health', 'health', 25)
pickup(1330, 980, 'secondary', 'Rocket Pod', 4)
pickup(1540, 500, 'primary', 'Auto Cannon', 60)
pickup(1045, 910, 'health', 'health', 50)
pickup(1150, 460, 'secondary', 'Thermal Bomb', 2)
pickup(1690, 190, 'health', 'health', 50)
pickup(1740, 120, 'primary', 'Auto Cannon', 40)
# message beacons: what the job is, at the start and at the locked pad
BEACON = 'game objects/message beacon'
pick.append(P(BEACON, 170, 1310, props={'alertMessage': 'Four warships, four <strong>DECK BATTERIES</strong> (the guns on the red and white rings). The launch pad on the lighthouse headland unlocks when all four are scrap.', 'persistent': True}))
pick.append(P(BEACON, 1610, 150, props={'alertMessage': 'Launch pad locked. It opens when every <strong>DECK BATTERY</strong> in the yard is destroyed.', 'persistent': True}))
# doors: blast gates on the gangways (a door is 50 px tall, a gangway 52 px wide)
# - the dry dock's two gantries stay shut until the dock control terminal in the dockyard is shot,
#   so the frigate is a two-step job
# - the flagship's long east gangway is shut from the dockyard side: you board over the short
#   west gangway from the central pier, and stepping on deck opens the east gate as a way out
GATE_SCALE = [1, 1.1]
doors = [
    P('game objects/door', 1442, 526, scale=GATE_SCALE, props={'id': 'door1'}),      # frigate west gantry, dockyard end
    P('game objects/door', 1690, 786, scale=GATE_SCALE, props={'id': 'door2'}),      # frigate east gantry, dockyard end
    P('game objects/door', 1290, 482, scale=GATE_SCALE, props={'id': 'door3'}),      # flagship east gangway, dockyard end
]
# a trigger pad across the flagship's deck just inboard of its west gangway
pick.append(P('game objects/powerup', 1060, 853, scale=[2.2, 2.2], props={'type': 'trigger', 'item': 'door3:open'}))

# crates: cargo on the quay, the piers and the decks. None is required: the exit only cares
# about the Deck Batteries. Some carry drops.
boxes = []
brng = random.Random(7070)
DROPS = [{'type': 'health', 'item': 'health', 'quantity': 25}, {'type': 'primary', 'item': 'Auto Cannon', 'quantity': 30},
         {'type': 'secondary', 'item': 'Rocket Pod', 'quantity': 2}, {'type': 'primary', 'item': 'Bolter', 'quantity': 25},
         {'type': 'primary', 'item': 'Plasma', 'quantity': 10}]


def crates(x, y, n, dx=20, dy=0, drop=None):
    for k in range(n):
        o = P('game objects/box', x + k * dx, y + k * dy, props={'required': False})
        if drop is not False and k == n // 2 and (drop or brng.random() < 0.4):
            o['scale'] = 1.285706
            o['props'] = {'required': False, 'health': 25, 'powerupDrop': drop or brng.choice(DROPS)}
        boxes.append(o)


def stack(x, y):
    for dx in (0, 20):
        crates(x + dx, y, 2, 0, 20, drop=False)


for args in (
        (40, 1190, 4, 0, 20), (180, 1360, 6), (680, 1360, 4, 0, -20), (1260, 1360, 4, 0, -20),
        (360, 1164, 4), (1440, 1330, 3, 0, -20),
        (316, 660, 4, 0, 20), (404, 980, 3, 0, -20),
        (830, 850, 3, 0, 20), (930, 240, 3, 0, 20), (930, 640, 4, 0, 20),
        (530, 560, 2, 0, 20), (630, 880, 2, 0, -20),
        (1316, 300, 4, 0, 20), (1316, 940, 2, 0, -20), (1600, 32, 3),
        (770, 70, 3), (1000, 100, 4), (1380, 76, 4)):
    crates(*args)
for x, y in ((180, 1250), (1400, 1300), (1590, 120)):
    stack(x, y)
# the dock control terminal: opens both dry dock gantries. Not required: the exit only wants the targets
boxes.append(P('game objects/box computer', 1350, 560, props={'required': False, 'onDie': {'$trigger': ['door1:open', 'door2:open']}}))

# no vision zones: enemies see by their visionRange (420 by default, PR #37) and line of sight.
# Zones let you shoot in from outside them, and water hides nothing anyway
vision = []


BRIEFING = {
    'title': 'SHIPYARD',
    'body': ("The navy was automated for efficiency. It is now very\n"
             "efficiently pointed at you. Four warships in this yard\n"
             "carry Deck Batteries, and the harbour master's launch\n"
             "pad stays locked until all four are scrap. Water stops\n"
             "you; it does not stop bullets. Board what you can,\n"
             "shoot across what you can't, then get to the pad on\n"
             "the lighthouse headland."),
    'captions': [
        {'style': 'name', 'text': 'Deck Battery', 'x': 636.45, 'y': 209.89},
        {'style': 'note', 'text': 'Target. Destroy all four.', 'x': 636.45, 'y': 316.6},
        {'style': 'name', 'text': 'Flak Turret', 'x': 636.48, 'y': 359.89},
        {'style': 'note', 'text': 'Fills the sky with regret.', 'x': 636.45, 'y': 426.6},
    ],
    'graphics': [
        {'symbol': 'enemy assets/enemy deck battery core', 'x': 636.5, 'y': 268, 'scale': 0.95},
        {'symbol': 'enemy assets/enemy deck battery turret', 'x': 636.5, 'y': 268, 'scale': 0.95},
        {'symbol': 'enemy assets/enemy flak turret core', 'x': 636.5, 'y': 400},
        {'symbol': 'enemy assets/enemy flak turret turret', 'x': 636.5, 'y': 400},
        {'symbol': 'screen_mc/shape 3', 'x': 0, 'y': 0},
    ],
}

# areas paved as concrete quays rather than road: everything landside but the road the tank drives
PAVED = [[B, QY - 2, W - B, 1080], PIER_W, PIER_C, BREAK, HEAD, YARD, [B, 1240, W - B, H - B]]


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
    if not items: return '[]\n'
    return '[\n' + ',\n'.join('  ' + pretty(x, '  ') for x in items) + '\n]\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'levels', FOLDER))
    ap.add_argument('--preview')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    files = {
        'collision.json': list_json([{'name': 'collision map', 'pixels': 'collision-base.png', 'locked': True}] + shapes),
        'features.json': list_json(features),
        'pathNodes.json': list_json(nodes),
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
    settings.pop('sightRange', None)
    settings.setdefault('art', {'kit': 'city', 'seed': 707})
    settings['art'].setdefault('paved', [[num(v) for v in r] for r in PAVED])
    # what kind of water, floor and wall each place is, for the city kit's docks (tools/art/docks.py)
    settings['art'].pop('docks', None)
    settings['art'].update({
        'dockPits': [list(DOCK)],
        'shipDecks': [[[num(x), num(y)] for x, y in pts] for pts in HULLS.values()],
        'gangways': [[num(v) for v in r] for r in GANGWAYS.values()],
        'containers': [list(r) for r in CONTAINERS],
    })
    with open(lj, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n' + ',\n'.join(f'  {json.dumps(k)}: {pretty(v, "  ")}' for k, v in settings.items()) + '\n}\n')
    bj = os.path.join(a.out, 'briefing.json')
    if not os.path.exists(bj):
        with open(bj, 'w', encoding='utf-8', newline='\n') as f: f.write(json.dumps(BRIEFING, indent=2) + '\n')
    from PIL import Image
    base = os.path.join(a.out, 'collision-base.png')
    if not os.path.exists(base): Image.new('RGBA', (W, H), (255, 255, 255, 255)).save(base)
    print('wrote', ', '.join(files), 'and level.json to', a.out)
    if a.preview: preview(a.preview)


def preview(path):
    """A schematic: water, land, ships, loops, enemies and pickups (the editor shows the real thing)."""
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new('RGB', (W, H), (226, 222, 210))
    d = ImageDraw.Draw(im)

    def polys(dstr):
        out = []
        for part in dstr.split('Z'):
            nums = [float(t) for t in part.replace('M', ' ').replace('L', ' ').split()]
            if nums: out.append(list(zip(nums[0::2], nums[1::2])))
        return out
    for s in shapes:
        g = s.get('group')
        col = {'wall': (40, 40, 44), 'chasm': (60, 110, 160), 'open': (226, 222, 210)}[s['mode']]
        if s['mode'] == 'open' and g == 'ships': col = (170, 176, 186)
        if s['mode'] == 'open' and g == 'gangways': col = (200, 160, 90)
        if s['mode'] == 'chasm' and g == 'dry dock': col = (95, 90, 85)
        if s['mode'] == 'wall' and g == 'containers': col = (150, 70, 50)
        ps = polys(s['d'])
        d.polygon(ps[0], fill=col)
        for hole in ps[1:]: d.polygon(hole, fill=(226, 222, 210))
    for n in nodes:
        c = tuple(n['color']['add'][:3])
        m = next(o for o in nodes if o['name'] == n['props']['connections'][0]['$ref'])
        d.line([(n['x'], n['y']), (m['x'], m['y'])], fill=c, width=3)
    for e in enemies:
        s = e['symbol']
        r = {TANK: 16, SCOUT: 8, BATTERY: 15, WOLFGUN: 11, DECK: 20, FLAK: 12, LAUNCHER: 12}.get(s, 8)
        col = {TANK: (200, 60, 0), SCOUT: (180, 0, 200), SCURGE: (150, 150, 0), BARREL: (255, 0, 0), DECK: (255, 0, 120),
               FLAK: (0, 200, 120), BATTERY: (230, 120, 0)}.get(s, (240, 200, 0))
        d.ellipse([e['x'] - r, e['y'] - r, e['x'] + r, e['y'] + r], fill=col, outline=(0, 0, 0))
        if s == DECK: d.ellipse([e['x'] - 30, e['y'] - 30, e['x'] + 30, e['y'] + 30], outline=(255, 0, 120), width=4)
    for b in boxes: d.rectangle([b['x'] - 7, b['y'] - 7, b['x'] + 7, b['y'] + 7], fill=(160, 120, 60), outline=(90, 60, 20))
    for p in pick:
        pr = p['props']
        if p['symbol'] == BEACON:
            d.ellipse([p['x'] - 9, p['y'] - 9, p['x'] + 9, p['y'] + 9], outline=(0, 200, 255), width=3)
            continue
        col = (0, 120, 255) if pr['type'] != 'health' else (0, 170, 0)
        if pr.get('item') in ('Auto Cannon', 'Rocket Pod'): col = (255, 0, 255)
        d.rectangle([p['x'] - 8, p['y'] - 8, p['x'] + 8, p['y'] + 8], outline=col, width=3)
    for f in features:
        d.ellipse([f['x'] - 24, f['y'] - 24, f['x'] + 24, f['y'] + 24], outline=(0, 160, 0), width=5)
    try: font = ImageFont.truetype('DejaVuSans-Bold.ttf', 22)
    except OSError: font = None
    for label, (x, y) in (('START', (40, 1350)), ('EXIT', (1630, 180)), ('DESTROYER', (510, 980)), ('CRUISER', (400, 132)),
                          ('FLAGSHIP', (1050, 990)), ('FRIGATE (dry dock)', (1440, 930)), ('GUNBOATS', (60, 400)),
                          ('BREAKWATER', (1150, 30)), ('CONTAINER YARD', (680, 1225))):
        d.text((x, y), label, fill=(0, 0, 0), font=font)
    im.save(path)


if __name__ == '__main__':
    main()

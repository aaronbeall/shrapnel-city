"""Level 08 Bunker: the first-draft layout, written as the standard level files.

    python tools/levels/08_Bunker/layout.py            # writes levels/08_Bunker/*.json (not the art)
    python tools/levels/08_Bunker/layout.py --preview out.png   # also a quick schematic PNG

A one-off tool for this level (each map is its own task). The plan's idea: rocky ground
leading down into bunker rooms; wolfguns behind bunker cover; the rock and earth art set
(ochre, chasm). New enemies: the Bunker Mortar (lobs shells over walls) and the Walker.
New weapons: Flak (primary) and the Bunker Buster (a new bomb: heavy, huge blast).

The map, north to south:

- the badlands: rock outcrops and a crevasse that splits the field, crossed by a rock
  bridge. Mortar pits ringed by sandbags shell you wherever you hide, so the play is to keep
  moving and get to them. Concrete pillboxes hold wolfguns that only see out of a slit:
  come at them from the side. The bunker's door control sits in a hut in the north-east.
- the trench: a cut between two revetments down to the bunker's blast door (door1, opened
  by destroying the door control).
- the bunker: concrete rooms round a corridor. Walkers patrol the corridor loops, wolfguns
  sit behind sandbag and concrete barriers (low cover you can shoot over but not cross), a
  mortar shells the corridor from the mortar hall. The command room (exit) is sealed by two
  blast doors (door2, door3) until the generator in the generator room is destroyed.

It writes collision.json (one vector shape per rock, crevasse, bunker room, pillbox and
barrier, so each can be reshaped in the editor's shape stack), features.json,
pathNodes.json, enemies.json, boxes.json, powerups.json, doors.json, vision.json (empty: enemies
see by sightRange), level.json and
briefing.json. collision.png is then baked by tools/levels/bake_collision.mjs and the art by
tools/art/bake.py (kit "rock"). Re-running this overwrites hand edits in those files.
"""
import argparse
import json
import math
import os
import random

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FOLDER = '08_Bunker'

W, H = 1760, 1360
B = 20            # outer wall
SHELL_Y = 640     # the bunker's north face
rng = random.Random(808)


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


def blob(cx, cy, rx, ry, n=16, jitter=0.2, rot=0.0):
    """A rock: a lumpy ellipse, turned by rot degrees."""
    pts, ca, sa = [], math.cos(math.radians(rot)), math.sin(math.radians(rot))
    ks = [1 + rng.uniform(-jitter, jitter) for _ in range(n)]
    ks = [(ks[i - 1] + 2 * ks[i] + ks[(i + 1) % n]) / 4 for i in range(n)]   # smooth the lumps a little
    for i in range(n):
        a = 2 * math.pi * i / n
        x, y = math.cos(a) * rx * ks[i], math.sin(a) * ry * ks[i]
        pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts


def ridge(points, width, jitter=0.25):
    """A long rock ridge (or crevasse) along a polyline: a ragged band `width` wide."""
    left, right = [], []
    for i, (x, y) in enumerate(points):
        a = points[min(i + 1, len(points) - 1)]
        b = points[max(i - 1, 0)]
        dx, dy = a[0] - b[0], a[1] - b[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        end = i in (0, len(points) - 1)
        w1 = width / 2 * (0.55 if end else 1 + rng.uniform(-jitter, jitter))
        w2 = width / 2 * (0.55 if end else 1 + rng.uniform(-jitter, jitter))
        left.append((x + nx * w1, y + ny * w1))
        right.append((x - nx * w2, y - ny * w2))
    return left + right[::-1]


def ring(outer, inner):
    return poly_d(outer) + ' ' + poly_d(inner)


shapes = []


def add(name, d, mode='wall', group=None):
    s = {'name': name, 'mode': mode, 'd': d}
    if group: s['group'] = group
    shapes.append(s)


# ---------------------------------------------------------------- the badlands
# outer wall: rock all round, ragged on the inside so it reads as a canyon rim
add('outer wall', poly_d(rect(0, 0, W, H)) + ' ' + poly_d(rect(B, B, W - B, H - B)))
for k, (cx, cy, rx, ry) in enumerate(((40, 300, 46, 70), (30, 560, 34, 50), (500, 26, 90, 30), (1240, 26, 110, 28),
                                     (1730, 330, 44, 90), (1736, 560, 30, 46), (210, 24, 50, 22))):
    add(f'canyon rim {k + 1}', poly_d(blob(cx, cy, rx, ry, 14, 0.18)), group='canyon rim')

# rock outcrops: cover from the pillboxes (not from the mortars)
ROCKS = [
    ('rock by the drop', 300, 150, 62, 40, 20),
    ('rock west', 120, 300, 40, 56, 0),
    ('rock mid-west', 470, 300, 70, 46, -25),
    ('rock south-west', 210, 540, 70, 34, 10),
    ('rock east of the crevasse', 1060, 330, 56, 40, 15),
    ('rock north-east', 1420, 150, 50, 34, -20),
    ('rock east', 1580, 330, 44, 60, 0),
    ('rock south-east', 1300, 520, 64, 32, -8),
    ('boulder 1', 640, 440, 26, 22, 0),
    ('boulder 2', 1180, 230, 24, 20, 0),
    ('boulder 3', 370, 420, 22, 18, 0),
    ('rock north-centre', 1040, 50, 40, 26, 0),
    ('rock by the trench', 640, 590, 40, 26, -5),
]
for name, cx, cy, rx, ry, rot in ROCKS:
    add(name, poly_d(blob(cx, cy, rx, ry, 16, 0.2, rot)), group='rocks')
# ridges: long spines of rock that make lanes
for name, pts, w in (('ridge west', [(150, 400), (210, 380), (270, 395)], 30),
                     ('ridge north-east', [(1460, 50), (1480, 110), (1470, 160)], 30)):
    add(name, poly_d(ridge(pts, w, 0.2)), group='rocks')
# the landing pocket: two short ridges close the north-west corner round the drop point, with
# a way out to the south-east, so the player lands with nothing in sight (Aaron: a quiet spawn).
# Their own seed, so the shapes after them don't change.
_rng, rng = rng, random.Random(8081)
for name, pts, w in (('ridge by the drop east', [(215, 20), (222, 110), (212, 185)], 34),
                     ('ridge by the drop south', [(20, 215), (85, 222), (150, 212)], 34)):
    add(name, poly_d(ridge(pts, w, 0.2)), group='rocks')
rng = _rng
# boulder fields: little rocks to duck behind (from the guns; the mortars don't care)
for k, (cx, cy) in enumerate(((600, 500), (1150, 250), (260, 620), (1000, 520), (860, 330))):
    for j in range(3):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(10, 26)
        add(f'boulder field {k + 1}.{j + 1}', poly_d(blob(cx + math.cos(a) * d, cy + math.sin(a) * d, rng.uniform(9, 14), rng.uniform(8, 12), 10, 0.25)), group='boulder fields')

# the crevasse: from the north rim down to the trench, splitting the field. A rock bridge
# crosses it at y ~ 250; its south end stops short of the trench, so you can walk round it.
CREV = [(705, 30), (720, 120), (760, 200)]
CREV2 = [(790, 300), (840, 380), (920, 440), (1010, 470)]
add('crevasse north', poly_d(ridge(CREV, 56)), mode='chasm', group='crevasse')
add('crevasse south', poly_d(ridge(CREV2, 60)), mode='chasm', group='crevasse')
BRIDGE = (775, 250)                      # the rock bridge between the two halves

# ---------------------------------------------------------------- pillboxes, pits, the hut
CONCRETE = []      # badlands rects whose walls are drawn as concrete (art.concrete)


def pillbox(name, cx, cy, slit, w=78, h=66, t=14, gap=24):
    """A concrete pillbox: a thick ring with a firing slit on one side. Its wolfgun sees out
    of the slit only. Returns the gun's spot."""
    outer = chamfer_rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, 12)
    inner = chamfer_rect(cx - w / 2 + t, cy - h / 2 + t, cx + w / 2 - t, cy + h / 2 - t, 6)
    add(name, ring(outer, inner), group='pillboxes')
    CONCRETE.append([cx - w / 2 - 2, cy - h / 2 - 2, cx + w / 2 + 2, cy + h / 2 + 2])
    g = gap / 2
    cut = {'n': rect(cx - g, cy - h / 2 - 1, cx + g, cy - h / 2 + t + 1), 's': rect(cx - g, cy + h / 2 - t - 1, cx + g, cy + h / 2 + 1),
           'w': rect(cx - w / 2 - 1, cy - g, cx - w / 2 + t + 1, cy + g), 'e': rect(cx + w / 2 - t - 1, cy - g, cx + w / 2 + 1, cy + g)}[slit]
    add(name + ' slit', poly_d(cut), mode='open', group='pillboxes')
    return cx, cy


def sandbag_ring(name, cx, cy, r, gap_dir, t=10, n=20, gap=0.5):
    """A low ring of sandbags (shoot over it, can't drive through it) with an opening of `gap`
    radians toward gap_dir (degrees, 0 = east, 90 = south)."""
    a0 = math.radians(gap_dir)
    outer, inner = [], []
    for i in range(n + 1):
        a = a0 + gap / 2 + (2 * math.pi - gap) * i / n
        outer.append((cx + math.cos(a) * (r + t / 2), cy + math.sin(a) * (r + t / 2)))
        inner.append((cx + math.cos(a) * (r - t / 2), cy + math.sin(a) * (r - t / 2)))
    add(name, poly_d(outer + inner[::-1]), mode='chasm', group='sandbags')


def sandbags(name, x0, y0, x1, y1, t=10):
    """A straight low sandbag wall from (x0, y0) to (x1, y1)."""
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * t / 2, dx / L * t / 2
    add(name, poly_d([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]), mode='chasm', group='sandbags')


PB1 = pillbox('pillbox west', 400, 440, 'n')
PB2 = pillbox('pillbox north-east', 1220, 110, 'w')
PB3 = pillbox('pillbox east', 1500, 470, 'w')
PB4 = pillbox('pillbox trench', 1060, 560, 'w')

M1 = (960, 170)          # mortar pit north, across the crevasse from the start
M2 = (1380, 300)         # mortar pit east (Bunker Buster beside it)
sandbag_ring('mortar pit north', *M1, 42, 200)
sandbag_ring('mortar pit east', *M2, 44, 160)

# the door control hut in the north-east corner: a concrete hut, open to the south-west
HUT = (1640, 110)
add('door control hut', ring(chamfer_rect(HUT[0] - 64, HUT[1] - 66, HUT[0] + 70, HUT[1] + 60, 12),
                             chamfer_rect(HUT[0] - 50, HUT[1] - 52, HUT[0] + 56, HUT[1] + 46, 8)), group='hut')
CONCRETE.append([HUT[0] - 66, HUT[1] - 68, HUT[0] + 72, HUT[1] + 62])
add('door control hut doorway', poly_d(rect(HUT[0] - 65, HUT[1] - 12, HUT[0] - 49, HUT[1] + 46)), mode='open', group='hut')

# low cover out in the open
sandbags('sandbags by the drop', 395, 125, 450, 112)
sandbags('sandbags mid', 560, 200, 610, 170)
sandbags('sandbags south', 560, 560, 640, 560)
sandbags('sandbags east', 1420, 400, 1470, 380)

# ---------------------------------------------------------------- the trench and the bunker
DOOR_X = 880
add('bunker', poly_d(rect(B - 1, SHELL_Y, W - B + 1, H - B + 1)), group='bunker')
# revetments: two concrete walls running north from the bunker face, the trench between them
add('trench revetment west', poly_d(chamfer_rect(DOOR_X - 92, 560, DOOR_X - 66, SHELL_Y + 4, 6)), group='trench')
add('trench revetment east', poly_d(chamfer_rect(DOOR_X + 66, 560, DOOR_X + 92, SHELL_Y + 4, 6)), group='trench')

ROOMS = {
    'entry hall': (740, 690, 1020, 860),
    'barracks': (90, 690, 520, 880),
    'armory': (1240, 690, 1670, 880),
    'corridor': (90, 920, 1670, 1000),
    'generator room': (90, 1050, 560, 1320),
    'mortar hall': (640, 1050, 1120, 1320),
    'command room': (1200, 1050, 1670, 1320),
}
CONNECT = {
    'blast door': (DOOR_X - 30, SHELL_Y - 1, DOOR_X + 30, 691),
    'barracks to hall': (520, 740, 740, 810),
    'hall to armory': (1020, 740, 1240, 810),
    'barracks to corridor': (270, 879, 340, 921),
    'hall to corridor': (845, 859, 915, 921),
    'armory to corridor': (1420, 879, 1490, 921),
    'corridor to generators': (290, 999, 360, 1051),
    'corridor to mortar hall': (845, 999, 915, 1051),
    'corridor to command': (1400, 999, 1470, 1051),
    'generators to mortar hall': (559, 1150, 641, 1220),
    'mortar hall to command': (1119, 1150, 1201, 1220),
}
for name, r in ROOMS.items():
    add(name, poly_d(chamfer_rect(*r, 10)), mode='open', group='bunker rooms')
for name, r in CONNECT.items():
    add(name, poly_d(rect(*r)), mode='open', group='bunker doorways')

# bunker cover: low concrete barriers (chasm grey: shoot over, can't cross) and pillars
def barrier(name, x, y, w, h):
    add(name, poly_d(chamfer_rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2, 3)), mode='chasm', group='bunker cover')


def pillar(name, x, y, s=26):
    add(name, poly_d(chamfer_rect(x - s / 2, y - s / 2, x + s / 2, y + s / 2, 5)), group='bunker pillars')


# entry hall: barriers across the hall, wolfgun behind them
barrier('hall barrier', DOOR_X, 735, 80, 12)          # right in front of the blast door
barrier('hall barrier west', 790, 800, 12, 60)
# barracks: rows of bunks as pillars, a sandbag nest
for k, x in enumerate((170, 250, 330, 410)):
    pillar(f'barracks bunk {k + 1}', x, 740, 30)
barrier('barracks nest', 300, 830, 90, 10)
# armory: racks (pillars) and a barrier in front of the gun
for k, (x, y) in enumerate(((1310, 740), (1310, 830), (1600, 740), (1600, 830))):
    pillar(f'armory rack {k + 1}', x, y, 28)
barrier('armory barrier', 1455, 770, 12, 70)
# the corridor stays clear: it's the walkers' beat
# generator room: the generator stands in the middle behind a barrier ring
GEN = (330, 1230)
for k, (x, y, w, h) in enumerate(((GEN[0], GEN[1] - 58, 110, 12), (GEN[0], GEN[1] + 56, 110, 12), (GEN[0] - 70, GEN[1], 12, 70))):
    barrier(f'generator barrier {k + 1}', x, y, w, h)
# mortar hall: pillars round the mortar, which shells the corridor over the wall. The north
# strip stays clear for the red walker.
MH = (880, 1200)
MH_PILLARS = ((-130, 75), (130, 75), (140, -45))
for k, (dx, dy) in enumerate(MH_PILLARS):
    pillar(f'mortar hall pillar {k + 1}', MH[0] + dx, MH[1] + dy, 34)
sandbag_ring('mortar hall pit', *MH, 40, 270)
# command room: the final room. Barriers in front of the battery, pillars, the exit pad
EXIT = (1560, 1220)
barrier('command barrier 1', 1360, 1130, 70, 12)
barrier('command barrier 2', 1360, 1260, 70, 12)
pillar('command pillar 1', 1280, 1195, 30)
pillar('command pillar 2', 1460, 1195, 30)

# areas drawn as bunker (concrete floors and walls) instead of badlands rock and earth
INTERIOR = [[B, SHELL_Y, W - B, H - B], [DOOR_X - 92, 560, DOOR_X + 92, SHELL_Y]]


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


START = (110, 100)
features = [
    P('game objects/entrance_mc', *START, name='entrance_mc'),
    P('game objects/exit_mc', *EXIT, name='exit_mc'),
]

# path nodes: one colour per walker loop, pinned in loop order
GROUPS = {'red': [255, 0, 0, 0], 'blue': [0, 0, 255, 0], 'green': [0, 200, 0, 0], 'yellow': [255, 200, 0, 0]}
nodes, node_n = [], [0]


def loop(group, corners):
    names = []
    for _ in corners:
        node_n[0] += 1
        names.append(f'n{node_n[0]}')
    # every other node 1 px to the right: a vehicle can't drive exactly straight down
    # (enemyVehicle waits for _rotation == target, 180 vs -180)
    corners = [(x + k % 2, y) for k, (x, y) in enumerate(corners)]
    for k, (x, y) in enumerate(corners):
        nxt, prv = names[(k + 1) % len(names)], names[k - 1]
        nodes.append(P('game objects/node', x, y, name=names[k], color={'multiply': [0, 0, 0, 1], 'add': GROUPS[group]},
                       props={'connections': [{'$ref': nxt}, {'$ref': prv}]}))
    return (GROUPS[group][0] << 16) | (GROUPS[group][1] << 8) | GROUPS[group][2]


# red: corridor west half -> down to the generator room -> mortar hall -> back up
RED = [(320, 960), (880, 960), (880, 1085), (665, 1085), (665, 1185), (520, 1185), (430, 1100), (325, 1095)]
red = loop('red', RED)
# blue: corridor east half -> armory -> entry hall -> back down
BLUE = [(880, 960), (1455, 960), (1455, 835), (1385, 775), (1130, 775), (1020, 775), (881, 880)]
blue = loop('blue', BLUE)
# green: out in the badlands, round the rock mid-west and the west pillbox
GREEN = [(560, 380), (600, 300), (530, 230), (400, 240), (330, 330), (300, 500), (480, 520)]
green = loop('green', GREEN)
# yellow: round the east field, between the mortar pit east and the south-east rock
YELLOW = [(1190, 420), (1290, 410), (1430, 470), (1400, 580), (1200, 590), (1150, 500)]
yellow = loop('yellow', YELLOW)

WALKER, MORTAR = 'enemy assets/enemy walker', 'enemy assets/enemy bunker mortar'
SCOUT = 'enemy assets/enemy scout'
STINGER, STINGER2, STINGER3 = 'enemy assets/enemy stinger', 'enemy assets/enemy stinger2', 'enemy assets/enemy stinger3'
WOLFGUN, BATTERY = 'enemy assets/enemy wolfgun', 'enemy assets/enemy double battery'
SCURGE, BARREL = 'enemy assets/enemy scurge', 'enemy assets/enemy object fire barrel'

enemies = []
E = lambda sym, x, y, **kw: enemies.append(P(sym, x, y, **kw))


def tri(x, y, s=30, down=False):
    k = -1 if down else 1
    for dx, dy in ((0, -k * s * 0.58), (-s / 2, k * s * 0.29), (s / 2, k * s * 0.29)):
        E(SCURGE, x + dx, y + dy)


def grid(x, y, cols, rows, s=30):
    for i in range(cols):
        for j in range(rows):
            E(SCURGE, x + (i - (cols - 1) / 2) * s, y + (j - (rows - 1) / 2) * s)


# --- the drop zone (north-west): a gentle start, the first look at a mortar across the crevasse
E(STINGER, 290, 80)
tri(200, 330)
tri(90, 440, down=True)
E(STINGER, 340, 60)
grid(330, 230, 2, 2)
E(BARREL, 250, 280)
# the west pillbox (Flak behind it, in the nook by the south-west rock) and the green walker
E(WOLFGUN, *PB1)
E(WALKER, *GREEN[0], props={'pathID': green}, rot=-90)
E(STINGER2, 110, 580)
tri(380, 560, down=True)
grid(470, 600, 3, 2)
E(STINGER, 560, 470)
E(BARREL, 650, 470)
# the crevasse's west bank and the rock bridge
tri(600, 110)
E(STINGER, 640, 60)
grid(660, 360, 2, 2, s=26)
# --- across the bridge: the north mortar pit and the north-east pillbox
E(MORTAR, *M1)
E(STINGER2, M1[0] + 70, M1[1] - 70)
tri(M1[0] - 20, M1[1] + 90)
grid(860, 70, 3, 2)
E(WOLFGUN, *PB2)
tri(1140, 64, down=True)
E(STINGER, 1320, 60)
E(BARREL, 1060, 240)
# the east field: mortar pit east (Bunker Buster), the yellow walker, the east pillbox
E(MORTAR, *M2, props={'mortarRange': 370})      # stops short of the armory below it
E(WALKER, *YELLOW[2], props={'pathID': yellow}, rot=90)
E(STINGER, 1300, 230)
E(STINGER3, 1490, 250)
grid(1550, 205, 2, 3)
E(WOLFGUN, *PB3)
tri(1640, 470)
grid(1620, 580, 3, 2)
E(BARREL, 1470, 600)
# the door control hut: a stinger3 and scouts round the terminal
E(STINGER3, HUT[0] + 30, HUT[1] + 25)
E(SCOUT, HUT[0] - 10, HUT[1] + 150)
E(SCOUT, HUT[0] + 20, HUT[1] + 140)
# the trench: its pillbox looks along the bunker face; scurge in the cut, a scout pair
E(WOLFGUN, *PB4)
grid(DOOR_X, 600, 3, 2, s=24)
E(STINGER, 700, 600)
E(SCOUT, 1000, 380)
E(SCOUT, 1130, 600)
tri(760, 520)
# --- inside. The entry hall: a wolfgun behind the barriers, stingers in the corners
E(WOLFGUN, DOOR_X, 768)
E(STINGER, 770, 720)
E(STINGER, 990, 720)
# barracks (west): scurge in the bunk rows, a wolfgun behind the sandbag nest, scouts
E(WOLFGUN, 300, 860)
for x in (210, 290, 370):
    E(SCURGE, x, 740)
grid(130, 810, 2, 2)
E(STINGER2, 480, 720)
E(SCOUT, 430, 820)
E(SCOUT, 170, 850)
# armory (east): wolfgun behind its barrier, stinger3 over the racks, the blue walker
E(WOLFGUN, 1490, 770)
E(STINGER3, 1640, 790)
E(WALKER, *BLUE[1], props={'pathID': blue}, rot=90)
grid(1380, 860, 2, 1, s=26)
tri(1600, 785)
# the corridor: the red walker, stingers in the doorway alcoves, scurge strings
E(WALKER, *RED[0], props={'pathID': red}, rot=0)
grid(170, 960, 3, 2, s=26)
grid(1580, 960, 3, 2, s=26)
E(STINGER, 110, 990)            # at the corridor's ends, looking down it
E(STINGER, 1650, 990)
# generator room: the generator, guarded; wolfgun behind its west barrier
E(WOLFGUN, GEN[0] - 100, GEN[1])
E(STINGER2, 140, 1090)
E(STINGER2, 520, 1290)
grid(160, 1260, 3, 2, s=26)
grid(480, 1270, 2, 1, s=26)
E(BARREL, 120, 1150)
# mortar hall: the mortar in its pit between the pillars, scurge round the pillars, stingers
E(MORTAR, *MH, props={'mortarRange': 300})       # reaches the corridor, not the whole bunker
for dx, dy in MH_PILLARS:
    E(SCURGE, MH[0] + dx + (30 if dx < 0 else -30), MH[1] + dy)
E(STINGER, 660, 1240)
E(STINGER, 1080, 1290)
E(STINGER2, 1080, 1090)
grid(700, 1280, 2, 2, s=26)
# command room: the final room. A double battery over the exit, stinger3s, a packed block of
# scurge, a mortar in the back, scouts
E(BATTERY, 1600, 1100, rot=180)
E(MORTAR, 1630, 1290, props={'mortarRange': 270})   # the command room only, not the corridor outside
E(STINGER3, 1300, 1080)
E(STINGER3, 1300, 1300)
E(WOLFGUN, 1400, 1195)
grid(1520, 1140, 3, 2, s=24)
grid(1250, 1250, 2, 2, s=24)
E(SCOUT, 1500, 1290)
E(SCOUT, 1460, 1080)

# pickups
pick = []


def pickup(x, y, type_, item, q, **kw):
    pick.append(P('game objects/powerup', x, y, props=dict({'type': type_, 'item': item, 'quantity': q}, **kw)))


pickup(110, 520, 'primary', 'Flak', 30)                 # in the nook behind the west pillbox
pickup(150, 470, 'health', 'health', 25)
pickup(M2[0], M2[1] + 70, 'secondary', 'Bunker Buster', 3)    # beside the east mortar pit
pickup(M2[0] + 40, M2[1] + 80, 'health', 'health', 50)
pickup(70, 160, 'primary', 'Bolter', 40)
pickup(560, 120, 'secondary', 'Carbon Bomb', 2)
pickup(1000, 90, 'primary', 'Flak', 20)
pickup(1350, 625, 'health', 'health', 25)
pickup(HUT[0] - 20, HUT[1] + 20, 'health', 'health', 50)
pickup(DOOR_X - 60, 760, 'primary', 'Bolter', 40)
pickup(130, 740, 'primary', 'Flak', 25)
pickup(1630, 700, 'secondary', 'Bunker Buster', 2)
pickup(1640, 850, 'health', 'health', 50)
pickup(940, 1260, 'health', 'health', 25)
pickup(130, 1300, 'secondary', 'Carbon Bomb', 2)
pickup(GEN[0] + 40, GEN[1], 'primary', 'Plasma', 15)
pickup(1060, 1240, 'health', 'health', 50)
pickup(1250, 1100, 'primary', 'Flak', 25)

doors = [
    P('game objects/door', DOOR_X, SHELL_Y + 25, rot=90, props={'id': 'door1'}),
    P('game objects/door', 1435, 1025, rot=90, props={'id': 'door2'}),
    P('game objects/door', 1160, 1185, props={'id': 'door3'}),
]

# boxes
boxes = []
brng = random.Random(8080)
DROPS = [{'type': 'health', 'item': 'health', 'quantity': 25}, {'type': 'primary', 'item': 'Bolter', 'quantity': 25},
         {'type': 'primary', 'item': 'Flak', 'quantity': 15}, {'type': 'secondary', 'item': 'Bunker Buster', 'quantity': 1},
         {'type': 'secondary', 'item': 'Carbon Bomb', 'quantity': 1}, {'type': 'primary', 'item': 'Plasma', 'quantity': 10}]


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


# badlands: supply dumps by the rocks and pits
crates(60, 60, 3, 0, 20)
crates(390, 90, 4)
stack(80, 370)
crates(200, 470, 4)
crates(440, 360, 3, 0, 20)
crates(660, 230, 3, 0, 20)
crates(930, 40, 4)
stack(1040, 140)
crates(860, 245, 3)
crates(1300, 140, 4, 0, 20)
crates(1420, 220, 3)
crates(1660, 400, 4, 0, 20)
stack(1200, 330)
crates(1150, 330, 3, 0, 20)
crates(520, 615, 4)
stack(1500, 590)
crates(990, 600, 3, 0, -20)
crates(HUT[0] + 40, HUT[1] - 30, 2, 0, 20, drop={'type': 'secondary', 'item': 'Bunker Buster', 'quantity': 1})
# bunker: ammo crates along the room walls
crates(200, 700, 3)
crates(430, 870 - 10, 3)
crates(755, 845, 3)
crates(940, 700, 3)
crates(1260, 700, 3)
crates(1530, 860, 4)
crates(1650, 700, 3, 0, 20)
crates(110, 1070, 5)
stack(430, 1240)
crates(110, 1200, 3, 0, 20)
crates(990, 1300, 3)
crates(1080, 1110, 3, 0, 20)
stack(980, 1070)
crates(760, 1300, 3)
crates(1220, 1070, 3)
crates(1220, 1300, 3)
stack(1640, 1150)
crates(1580, 1300, 2)
crates(1380, 700, 3)
# more supply dumps
crates(140, 620, 3)
stack(560, 60)
crates(1080, 440, 3)
stack(1680, 590)
crates(700, 440, 2, 0, 20)
stack(1520, 700)
crates(140, 1150, 3, 0, 20)
crates(1530, 1060, 3)
stack(1330, 1170)
crates(220, 1080, 3)
crates(720, 1170, 2, 0, 20)
# the door control (opens the blast door) and the generator (opens the command room)
boxes.append(P('game objects/box computer', HUT[0] + 10, HUT[1] - 25, props={'onDie': {'$trigger': 'door1:open'}}))
boxes.append(P('game objects/box computer', *GEN, rot=90, props={'onDie': {'$trigger': ['door2:open', 'door3:open']}}))


BRIEFING = {
    'title': 'BUNKER',
    'body': ("Command has moved underground for your safety.\n"
             "Theirs, specifically. The robots dug in under the\n"
             "badlands and left mortars on the roof to discourage\n"
             "visitors: hiding behind a rock will not help, so keep\n"
             "moving. Find the door control in the north-east hut to\n"
             "open the blast door, then knock out the generator to\n"
             "get into the command room. Mind the walkers."),
    'captions': [
        {'style': 'name', 'text': 'Bunker Mortar', 'x': 636.45, 'y': 209.89},
        {'style': 'note', 'text': 'Shells you over walls.', 'x': 636.45, 'y': 316.6},
        {'style': 'name', 'text': 'Walker', 'x': 636.48, 'y': 359.89},
        {'style': 'note', 'text': 'Patient. Armoured.', 'x': 636.45, 'y': 426.6},
    ],
    'graphics': [
        {'symbol': 'enemy assets/designs/carrier nuke', 'x': 636.5, 'y': 268, 'matrix': [1.4, 0, 0, 1.4]},
        {'symbol': 'enemy assets/enemy walker legs', 'x': 636.5, 'y': 398},
        {'symbol': 'enemy assets/enemy walker core', 'x': 636.5, 'y': 398},
        {'symbol': 'enemy assets/enemy walker turret', 'x': 636.5, 'y': 398},
        {'symbol': 'screen_mc/shape 3', 'x': 0, 'y': 0},
    ],
}


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


# this level's new weapons: an intro message on every copy (pickups and drops); alertOnce
# shows it only for the first one the player picks up
INTRO = {'Flak': 'FLAK CANNON: a burst of shrapnel at arm\'s length. Get close and personal.',
         'Bunker Buster': 'BUNKER BUSTER: one heavy bomb, one very large hole. Returns the favour to the mortar crews.'}


def add_intros():
    props = [o['props'] for o in pick] + [o['props']['powerupDrop'] for o in boxes + enemies if 'powerupDrop' in o.get('props', {})]
    for pr in props:
        if pr.get('type') in ('primary', 'secondary') and pr.get('item') in INTRO:
            pr.update(alertMessage=INTRO[pr['item']], alertOnce=True)


# no vision zones: enemies see by the level's sight range (level.json "sightRange") and line of
# sight, and the mortars by their mortarRange
SIGHT_RANGE = 420

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
        'pathNodes.json': list_json(nodes),
        'enemies.json': list_json(enemies),
        'boxes.json': list_json(boxes),
        'powerups.json': list_json(pick),
        'doors.json': list_json(doors),
        'vision.json': '[]\n',
    }
    for name, text in files.items():
        with open(os.path.join(a.out, name), 'w', encoding='utf-8', newline='\n') as f: f.write(text)
    lj = os.path.join(a.out, 'level.json')
    settings = json.load(open(lj)) if os.path.exists(lj) else {}
    settings['size'] = {'w': W, 'h': H}
    settings['sightRange'] = SIGHT_RANGE
    settings.setdefault('art', {'kit': 'rock', 'seed': 808})
    settings['art']['interior'] = [[num(v) for v in r] for r in INTERIOR]
    settings['art']['concrete'] = [[num(v) for v in r] for r in CONCRETE]
    # deeper wall sides than the default: the rocks and the bunker walls stand tall
    settings['art'].setdefault('sides', {'steps': 18, 'scale': 0.0026})
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
    """A schematic: walls, chasms, loops, enemies and pickups (the editor shows the real thing)."""
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (W, H), (235, 235, 235))
    d = ImageDraw.Draw(im)

    def polys(dstr):
        out = []
        for part in dstr.split('Z'):
            nums = [float(t) for t in part.replace('M', ' ').replace('L', ' ').split()]
            if nums: out.append(list(zip(nums[0::2], nums[1::2])))
        return out
    for s in shapes:
        col = {'wall': (30, 30, 30), 'chasm': (150, 150, 170), 'open': (235, 235, 235)}[s['mode']]
        ps = polys(s['d'])
        d.polygon(ps[0], fill=col)
        for hole in ps[1:]: d.polygon(hole, fill=(235, 235, 235))
    for n in nodes:
        c = tuple(n['color']['add'][:3])
        for ref in n['props']['connections'][:1]:
            m = next(o for o in nodes if o['name'] == ref['$ref'])
            d.line([(n['x'], n['y']), (m['x'], m['y'])], fill=c, width=3)
        d.ellipse([n['x'] - 5, n['y'] - 5, n['x'] + 5, n['y'] + 5], fill=c)
    for e in enemies:
        r = {WALKER: 18, MORTAR: 18, BATTERY: 18, WOLFGUN: 12}.get(e['symbol'], 9)
        col = {WALKER: (200, 60, 0), MORTAR: (255, 0, 120), SCOUT: (180, 0, 200), SCURGE: (120, 120, 0), BARREL: (255, 0, 0),
               WOLFGUN: (0, 120, 255)}.get(e['symbol'], (220, 180, 0))
        d.ellipse([e['x'] - r, e['y'] - r, e['x'] + r, e['y'] + r], fill=col)
    for p in pick:
        d.rectangle([p['x'] - 6, p['y'] - 6, p['x'] + 6, p['y'] + 6], outline=(0, 160, 255), width=2)
    for b in boxes:
        col = (0, 220, 120) if 'computer' in b['symbol'] else (150, 110, 60)
        d.rectangle([b['x'] - 8, b['y'] - 8, b['x'] + 8, b['y'] + 8], fill=col)
    for o in doors:
        horiz = 'matrix' in o
        d.rectangle([o['x'] - (28 if horiz else 6), o['y'] - (6 if horiz else 28), o['x'] + (28 if horiz else 6), o['y'] + (6 if horiz else 28)], fill=(0, 200, 200))
    for f in features: d.ellipse([f['x'] - 20, f['y'] - 20, f['x'] + 20, f['y'] + 20], outline=(0, 160, 0), width=4)
    im.save(path)


if __name__ == '__main__':
    main()

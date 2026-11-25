"""Level 05 Gateway: the first-draft layout, written as the standard level files.

    python tools/levels/05_Gateway/layout.py                    # writes levels/05_Gateway/*.json (not the art)
    python tools/levels/05_Gateway/layout.py --preview out.png  # also a schematic PNG

A one-off tool for this level (each map is its own task). The plan's idea: a walled
checkpoint split by colour-locked doors, stingers guarding keys, turrets; keycard doors are
the new mechanic; Missile Battery (the recovered missile launcher, fires seekers) and the
Checkpoint Warden (a patrolling crawler that sounds the alarm and drops a keycard) are the
new enemies; Spreader and Stun Bomb are the new weapons; city street art, olive checkpoint.

The map is a border crossing, entered from the free(ish) side in the south and left through
the great gate in the north-east. Four security bands, each sealed by a coloured door, and
the way zig-zags across them so every band is crossed in full:

  D  THE GATE        hall of pillars; the exit under the gate arch, north-east. Final room.
     --- inner wall, RED door (west) ---
  C  THE STRIP       the death strip between the walls: an anti-vehicle ditch down its length
                     with three crossings, missile batteries on islands in the ditch (shoot
                     them or stun them, you can't reach them), tank traps for cover, a tank on
                     the south lane and Warden 2 (red keycard) on the north lane.
     --- customs wall, BLUE door (east) ---
  B  CUSTOMS YARD    west: the records office, rooms and a corridor; the blue keycard in its
                     back room under stinger2s and a stinger3. Centre: the inspection yard.
                     East: the impound lot (crate rows), the Missile Battery's debut over the
                     Stun Bomb.
     --- customs hall, YELLOW door (centre) ---
  A  THE QUEUE       the serpentine queue pen (scurge in the lanes, the Spreader at its start)
                     or the boulevard round it; Warden 1 (yellow keycard) circles the toll
                     plaza; the guard barracks hold the hunters the wardens call when they
                     spot you.

Writes collision.json (one vector shape per wall, rail, booth, trap, ditch), features.json,
pathNodes.json, enemies.json, boxes.json, powerups.json, doors.json, level.json and (once)
briefing.json. collision.png is baked from collision.json by tools/levels/bake_collision.mjs;
background.png by tools/art/bake.py (+ tools/levels/05_Gateway/decor.py).
Re-running overwrites hand edits in those files (use --out to write somewhere else).
"""
import argparse
import json
import math
import os
import random

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FOLDER = '05_Gateway'

W, H = 1440, 1600          # the design grid; everything from y 620 down is drawn 60 px lower (see Y)
B = 20                     # outer wall
SHIFT_AT, SHIFT = 620, 60  # the strip was widened after the first draft: bands B and A moved down


def Y(y):
    return y + SHIFT if y >= SHIFT_AT else y

GAP = 56                   # a door's opening
rng = random.Random(505)

# the bands (y ranges of open floor) and the walls between them
D_ = (B, 300)
WALL_CD = (300, 340)
C_ = (340, 680)                # (drawn; its design-grid end is 620)
WALL_BC = (620, 660)
B_ = (660, 1040)
WALL_AB = (1040, 1120)     # the customs hall: a thick building
A_ = (1120, H - B)

DOOR_RED = (172, (WALL_CD[0] + WALL_CD[1]) / 2)
DOOR_BLUE = (1250, (WALL_BC[0] + WALL_BC[1]) / 2)
DOOR_YELLOW = (720, (WALL_AB[0] + WALL_AB[1]) / 2)

KEYS = {'yellow': 'yellowKey', 'blue': 'blueKey', 'red': 'redKey'}
KEY_RGB = {'yellow': (255, 210, 40), 'blue': (40, 140, 255), 'red': (240, 40, 40)}


# ---------------------------------------------------------------- shapes
def num(v):
    v = round(v, 2)
    return int(v) if float(v).is_integer() else v


def poly_d(pts):
    return 'M ' + ' L '.join(f'{num(x)} {num(Y(y))}' for x, y in pts) + ' Z'


def chamfer_rect(x0, y0, x1, y1, c=4):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def octagon(cx, cy, r):
    return chamfer_rect(cx - r, cy - r, cx + r, cy + r, r * 0.41)


def circle(cx, cy, r, n=20, jitter=0.0):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rng.uniform(-jitter, jitter)
        pts.append((cx + math.cos(a) * r * k, cy + math.sin(a) * r * k))
    return pts


def hedgehog(cx, cy, s=12, rot=0):
    """A tank trap seen from above: three crossed beams, as one star-shaped outline."""
    pts = []
    for i in range(6):
        a = math.radians(rot + i * 60)
        r = s if i % 2 == 0 else s * 0.42
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
        a2 = math.radians(rot + i * 60 + 30)
        pts.append((cx + math.cos(a2) * s * 0.42, cy + math.sin(a2) * s * 0.42))
    return pts


shapes = []


def add(name, d, mode='wall', group=None):
    s = {'name': name, 'mode': mode, 'd': d}
    if group: s['group'] = group
    shapes.append(s)


def wall_with_door(name, y0, y1, door_x, group, x0=0, x1=W):
    """A horizontal wall band from x0 to x1 with a door-sized opening at door_x."""
    a, b = door_x - GAP / 2, door_x + GAP / 2
    add(name + ' west', poly_d(rect(x0, y0, a, y1)), group=group)
    add(name + ' east', poly_d(rect(b, y0, x1, y1)), group=group)


# outer wall
add('outer wall', poly_d(rect(0, 0, W, H)) + ' ' + poly_d([(B, B), (B, H - B), (W - B, H - B), (W - B, B)]))

# ---- the three security walls, each with its coloured door
wall_with_door('inner wall', *WALL_CD, DOOR_RED[0], 'inner wall')
# bastions on the inner wall's strip side: short square towers (the strip's watchtowers)
TOWERS = (470, 970)
for k, tx in enumerate(TOWERS):
    add(f'inner wall tower {k + 1}', poly_d(chamfer_rect(tx - 34, WALL_CD[1] - 6, tx + 34, WALL_CD[1] + 22, 5)), group='inner wall')
wall_with_door('customs wall', *WALL_BC, DOOR_BLUE[0], 'customs wall')
# the customs hall: thick, with a canopy line of booths on its south face and the inspection
# lane cut right through it
wall_with_door('customs hall', *WALL_AB, DOOR_YELLOW[0], 'customs hall')
# the lane is lined by kerbs that narrow its mouth on both sides (so the door seals it)
for side in (-1, 1):
    x = DOOR_YELLOW[0] + side * (GAP / 2 + 9)
    for y0, y1 in ((WALL_AB[0] - 22, WALL_AB[0]), (WALL_AB[1], WALL_AB[1] + 22)):
        add(f'inspection lane kerb {"west" if side < 0 else "east"} {"north" if y0 < WALL_AB[0] else "south"}',
            poly_d(chamfer_rect(x - 9, y0 - 1, x + 9, y1 + 1, 3)), group='customs hall')

# ---- D: the gate hall
EXIT = (1240, 92)
# the gate arch: two gate towers either side of the exit alcove
for k, (x0, x1) in enumerate(((1104, 1160), (1320, 1376))):
    add(f'gate tower {k + 1}', poly_d(chamfer_rect(x0, B - 4, x1, 172, 8)), group='gate')
# pillars down the hall, two rows
PILLARS = [(x, y) for y in (118, 218) for x in (380, 580, 780, 960)]
for k, (px, py) in enumerate(PILLARS):
    add(f'hall pillar {k + 1}', poly_d(octagon(px, py, 18)), group='gate hall')
# a guard post by the red door: a low wall screening the door from the hall
add('red door screen', poly_d(chamfer_rect(118, 214, 230, 230, 4)), group='gate hall')

# ---- C: the strip
DITCH = (482, 530)
CROSSINGS = ((290, 372), (690, 772), (1120, 1202))
xs = [B] + [v for c in CROSSINGS for v in c] + [W - B]
for k in range(0, len(xs), 2):
    x0, x1 = xs[k], xs[k + 1]
    pts = [(x0, DITCH[0] + 3)]
    for x in range(int(x0) + 30, int(x1) - 10, 34):
        pts.append((x, DITCH[0] + rng.uniform(-3, 4)))
    pts.append((x1, DITCH[0] + 2))
    pts.append((x1, DITCH[1] - 2))
    for x in range(int(x1) - 30, int(x0) + 10, -34):
        pts.append((x, DITCH[1] + rng.uniform(-4, 3)))
    pts.append((x0, DITCH[1] - 3))
    add(f'ditch {k // 2 + 1}', poly_d(pts), mode='chasm', group='ditch')
# the pits: the ditch widens round two islands; a missile battery stands on each
PITS = ((520, 506), (930, 506))
for k, (px, py) in enumerate(PITS):
    add(f'ditch pit {k + 1}', poly_d(circle(px, py, 50, 22, 0.04)), mode='chasm', group='ditch')
    add(f'ditch island {k + 1}', poly_d(circle(px, py, 21, 16)), mode='open', group='ditch')
# tank traps: cover along both lanes, clear of the patrol lines (north 400, south 610)
TRAPS = [(110, 460), (232, 464), (420, 462), (640, 460), (860, 464), (1060, 460), (1280, 464),
         (160, 552), (440, 550), (620, 554), (830, 552), (1040, 554), (1260, 552), (1370, 550)]
for k, (tx, ty) in enumerate(TRAPS):
    add(f'tank trap {k + 1}', poly_d(hedgehog(tx, ty, 13, rng.uniform(0, 60))), group='tank traps')

# ---- B: the customs yard
# the records office (west): outer east wall with the lobby door, rooms inside
OF = 560                    # the office's east wall (x of its yard face)
add('office east wall north', poly_d(rect(OF, B_[0], OF + 22, 936)), group='records office')
add('office east wall south', poly_d(rect(OF, 1000, OF + 22, B_[1])), group='records office')
add('office wall lobby', poly_d(rect(B, 852, 268, 872)), group='records office')            # filing room | back room
add('office wall lobby east', poly_d(rect(330, 852, 420, 872)), group='records office')
add('office corridor wall', poly_d(rect(400, B_[0], 420, 690)), group='records office')      # back room | corridor
add('office back room door jamb', poly_d(rect(400, 760, 420, 852)), group='records office')
add('office filing wall', poly_d(rect(292, 872, 312, 930)), group='records office')          # filing room | lobby
add('office filing wall south', poly_d(rect(292, 990, 312, B_[1])), group='records office')
# desks and cabinets (cover)
for k, (x0, y0, x1, y1) in enumerate(((120, 740, 200, 760), (240, 700, 320, 720), (240, 790, 330, 806),
                                       (440, 940, 520, 958), (360, 1000, 440, 1016))):
    add(f'office desk {k + 1}', poly_d(chamfer_rect(x0, y0, x1, y1, 3)), group='records office')
# the inspection yard: two scanner pillars either side of the lane's north mouth
for k, x in enumerate((650, 790)):
    add(f'scanner pillar {k + 1}', poly_d(chamfer_rect(x - 14, 950, x + 14, 990, 5)), group='inspection yard')
add('inspection kiosk', poly_d(chamfer_rect(690, 800, 750, 840, 6)), group='inspection yard')
# the impound lot (east): a fence with two openings
LOT = 930
add('impound fence north', poly_d(rect(LOT, B_[0], LOT + 10, 750)), group='impound lot')
add('impound fence mid', poly_d(rect(LOT, 820, LOT + 10, 920)), group='impound lot')
add('impound fence south', poly_d(rect(LOT, 990, LOT + 10, B_[1])), group='impound lot')

# ---- A: the queue
# the serpentine pen: fences at these heights; each rail has its opening at alternating ends
PEN_X = (B, 560)
RAILS = (1236, 1302, 1368, 1434, 1500)
RAIL_T = 8
OPEN = 64
for k, y in enumerate(RAILS):
    x0, x1 = PEN_X
    if k == 0:   # top fence: the way out is at the west end
        segs = [(x0 + OPEN, x1)]
    elif k == len(RAILS) - 1:   # bottom fence: the way in, at the west end beside the entrance
        segs = [(x0 + OPEN + 40, x1)]
    elif k % 2 == 1:   # opening at the east end
        segs = [(x0, x1 - OPEN)]
    else:              # opening at the west end
        segs = [(x0 + OPEN, x1)]
    for j, (a, b) in enumerate(segs):
        add(f'queue rail {k + 1}', poly_d(chamfer_rect(a, y - RAIL_T / 2, b, y + RAIL_T / 2, 2)), group='queue pen')
# the pen's east fence, with a smashed section (a shortcut into the second lane)
add('queue fence east north', poly_d(chamfer_rect(PEN_X[1] - 4, RAILS[0] - 4, PEN_X[1] + 4, 1310, 2)), group='queue pen')
add('queue fence east south', poly_d(chamfer_rect(PEN_X[1] - 4, 1362, PEN_X[1] + 4, RAILS[-1] + 4, 2)), group='queue pen')
# the toll plaza: booth islands in front of the customs hall
BOOTHS = (590, 652, 788, 850)
for k, bx in enumerate(BOOTHS):
    add(f'toll booth {k + 1}', poly_d(chamfer_rect(bx - 12, 1150, bx + 12, 1214, 6)), group='toll plaza')
# the guard barracks (east): a U-shaped building open to the west
BX0, BY0 = 1130, 1300
add('barracks', poly_d(rect(BX0, BY0, W - B + 2, H - B + 2)) + ' ' + poly_d(rect(BX0 + 34, BY0 + 34, W - B - 30, H - B - 30)), group='barracks')
add('barracks door', poly_d(rect(BX0 - 1, 1410, BX0 + 36, 1500)), mode='open', group='barracks')
# barriers on the boulevard (cover)
for k, (bx, by, bw, bh) in enumerate(((700, 1360, 56, 14), (1010, 1200, 14, 56), (880, 1460, 56, 14), (1010, 1400, 14, 50))):
    add(f'barrier {k + 1}', poly_d(chamfer_rect(bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2, 4)), group='boulevard')

# paved areas in the art: the gate hall, the office and the inspection yard (the rest is road)
PAVED = [[B, B, W - B, 300], [B, 660, 560, 1040], [582, 660, 930, 1040]]


# ---------------------------------------------------------------- placements
def P(symbol, x, y, props=None, rot=None, scale=None, name=None, color=None):
    o = {'symbol': symbol, 'x': num(x), 'y': num(Y(y))}
    if rot is not None:
        a = math.radians(rot)
        o['matrix'] = [num(math.cos(a) * 1e4) / 1e4, num(math.sin(a) * 1e4) / 1e4, num(-math.sin(a) * 1e4) / 1e4, num(math.cos(a) * 1e4) / 1e4]
    if scale is not None: o['scale'] = scale
    if name: o['name'] = name
    if color: o['color'] = color
    if props: o['props'] = props
    return o


ENTRANCE = (64, 1548)
features = [
    P('game objects/entrance_mc', *ENTRANCE, name='entrance_mc'),
    P('game objects/exit_mc', *EXIT, name='exit_mc'),
]

# path node groups (node colour): patrol routes pinned in order, hunter networks auto-linked by sight
GROUPS = {'red': [255, 0, 0, 0], 'green': [0, 200, 0, 0], 'blue': [0, 0, 255, 0], 'purple': [160, 0, 200, 0], 'cyan': [0, 200, 200, 0]}
nodes, node_n = [], [0]


def colour(group):
    g = GROUPS[group]
    return (g[0] << 16) | (g[1] << 8) | g[2]


def route(group, pts, loop=True):
    names = []
    for _ in pts:
        node_n[0] += 1
        names.append(f'n{node_n[0]}')
    # every other node 1 px to the side: a vehicle never drives exactly straight down (it can't)
    pts = [(x + k % 2, y) for k, (x, y) in enumerate(pts)]
    for k, (x, y) in enumerate(pts):
        conn = []
        if loop or k + 1 < len(pts): conn.append({'$ref': names[(k + 1) % len(names)]})
        if loop or k > 0: conn.append({'$ref': names[k - 1]})
        nodes.append(P('game objects/node', x, y, name=names[k], color={'multiply': [0, 0, 0, 1], 'add': GROUPS[group]},
                       props={'connections': conn}))
    return colour(group)


def network(group, pts):
    """Hunter nodes: no connections given, so the game links each to those it can see."""
    for x, y in pts:
        node_n[0] += 1
        nodes.append(P('game objects/node', x, y, name=f'n{node_n[0]}', color={'multiply': [0, 0, 0, 1], 'add': GROUPS[group]}))
    return colour(group)


# Warden 1: round the toll plaza and the boulevard
W1 = route('red', [(610, 1290), (870, 1290), (1080, 1290), (1080, 1400), (1080, 1546), (830, 1546), (610, 1546), (610, 1400)])
# A's hunters (barracks): a network over the boulevard and the plaza
HA = network('green', [(1200, 1460), (1090, 1460), (1000, 1320), (800, 1320), (640, 1320), (720, 1200), (900, 1200),
                       (1000, 1520), (760, 1520), (600, 1180), (1060, 1180), (1300, 1220)])
# Warden 2: up and down the strip's north lane
W2 = route('blue', [(96, 400), (330, 400), (720, 400), (1100, 400), (1344, 400)], loop=False)
# the strip tank: up and down the south lane
T2 = route('purple', [(96, 610), (400, 610), (720, 610), (1050, 610), (1344, 610)], loop=False)
# C's hunters
HC = network('cyan', [(80, 400), (331, 420), (331, 600), (731, 420), (731, 600), (1161, 420), (1161, 600), (1380, 420), (1380, 610), (60, 610)])

TANK, SCOUT, WARDEN = 'enemy assets/enemy tank', 'enemy assets/enemy scout', 'enemy assets/enemy warden'
LAUNCHER = 'enemy assets/enemy missile launcher'
STINGER, STINGER2, STINGER3 = 'enemy assets/enemy stinger', 'enemy assets/enemy stinger2', 'enemy assets/enemy stinger3'
WOLFGUN, BATTERY = 'enemy assets/enemy wolfgun', 'enemy assets/enemy double battery'
SCURGE, BARREL = 'enemy assets/enemy scurge', 'enemy assets/enemy object fire barrel'

enemies = []
E = lambda sym, x, y, **kw: enemies.append(P(sym, x, y, **kw))


def key_drop(colour_):
    return {'type': 'key', 'item': KEYS[colour_], 'quantity': 1}


def row(x, y, n, dx=26, dy=0, sym=SCURGE):
    for k in range(n): E(sym, x + k * dx, y + k * dy)


def grid(x, y, cols, rows, s=28):
    for i in range(cols):
        for j in range(rows):
            E(SCURGE, x + (i - (cols - 1) / 2) * s, y + (j - (rows - 1) / 2) * s)


def tri(x, y, s=28, down=False):
    k = -1 if down else 1
    for dx, dy in ((0, -k * s * 0.58), (-s / 2, k * s * 0.29), (s / 2, k * s * 0.29)):
        E(SCURGE, x + dx, y + dy)


# ======== A: the queue
# the pen's lanes (centre lines) and scurge queuing in them, single file, as if waiting their turn
LANES = [(RAILS[k] + RAILS[k + 1]) / 2 for k in range(len(RAILS) - 1)]   # north to south
row(180, LANES[3], 6, 52)                    # first lane (south): the Spreader's first targets
row(110, LANES[2], 7, 52)
row(150, LANES[1], 6, 56)
row(130, LANES[0], 6, 56)
E(STINGER, 520, LANES[3])                    # a stinger at each lane's far end
E(STINGER, 70, LANES[1])
E(STINGER2, 520, LANES[0] - 2)
# the toll plaza: stingers in the booth lanes, a wolfgun covering the yellow lane from the hall face
E(STINGER, 621, 1170)
E(STINGER, 819, 1170)
E(WOLFGUN, 980, 1140)
E(WOLFGUN, 460, 1146)
tri(720, 1226, down=True)
# Warden 1 (yellow keycard)
E(WARDEN, 870, 1290, props={'pathID': W1, 'powerupDrop': key_drop('yellow')}, rot=90)
# the boulevard
E(STINGER, 950, 1440)
E(STINGER3, 900, 1400)
grid(780, 1440, 3, 2)
tri(690, 1480)
E(BARREL, 720, 1505)
E(BARREL, 980, 1340)
# the barracks: hunters waiting for the alarm, a guard at the door
for x, y in ((1220, 1380), (1320, 1440), (1220, 1500)):
    E(SCOUT, x, y, props={'hunter': True, 'pathID': HA})
E(STINGER2, 1360, 1380)
E(STINGER, 1180, 1530)

# ======== B: the customs yard
# the records office: scurge in the lobby, a stinger at the corridor, the key vault under guard
grid(470, 985, 2, 2)
tri(200, 950)
E(STINGER, 150, 1010)
E(STINGER, 480, 700)
row(450, 760, 3, 0, 28)
# the back room: the blue keycard on the floor under two stinger2s and a stinger3
KEY_BLUE = (90, 700)
E(STINGER2, 160, 700)
E(STINGER2, 90, 800)
E(STINGER3, 330, 760)
tri(220, 830, s=24)
# the inspection yard: open ground with a kiosk; stingers by the scanners, scurge filling it
E(STINGER, 610, 920)
E(STINGER, 830, 920)
grid(720, 740, 3, 2)
tri(640, 700)
tri(820, 700)
E(WOLFGUN, 880, 690)
E(BARREL, 760, 880)
# the impound lot: the Missile Battery's debut, high in the lot's corner over the Stun Bomb
E(LAUNCHER, 1380, 700, rot=-135)
E(LAUNCHER, 1000, 1000, rot=-45)
E(STINGER, 1140, 860)
E(STINGER2, 1360, 1000)
grid(1180, 760, 2, 2)
tri(1080, 960)
E(BARREL, 1300, 860)

# ======== C: the strip
for k, (px, py) in enumerate(PITS):          # the island batteries
    E(LAUNCHER, px, py, rot=90 if k else -90)
# patrollers on an open route start at one end (from the middle they'd only drive half of it)
E(WARDEN, 1344, 400, props={'pathID': W2, 'powerupDrop': key_drop('red')}, rot=-90)
E(TANK, 97, 610, props={'pathID': T2, 'powerupDrop': {'type': 'health', 'item': 'health', 'quantity': 50}}, rot=90)
for x, y in ((60, 560), (1395, 445)):
    E(SCOUT, x, y, props={'hunter': True, 'pathID': HC})
# along the inner wall (clear of the towers' feet), and along the ditch's south lip
E(STINGER3, 60, 356)                          # by the red door
E(STINGER, 230, 356)
E(WOLFGUN, 720, 358)
row(780, 356, 4)
row(1040, 356, 3)
E(STINGER2, 1390, 560)                        # by the blue door
E(STINGER, 1190, 556)
row(300, 556, 3)
row(700, 452, 3)
E(BARREL, 1000, 452)

# ======== D: the gate (the final room)
# the hall west of the gate: scurge blocks between the pillars, wolfguns on the walls
grid(480, 168, 3, 3, 24)
grid(870, 168, 3, 3, 24)
grid(680, 60, 4, 2, 24)
grid(680, 270, 4, 2, 24)
E(STINGER, 300, 50)
E(STINGER, 300, 270)
E(STINGER2, 1060, 60)
E(STINGER2, 1060, 270)
E(WOLFGUN, 760, 40)
E(WOLFGUN, 40, 40)
# the gate: a double battery in the arch's mouth, stinger3s flanking the exit, launchers on the flanks
E(BATTERY, 1240, 218, rot=180)
E(STINGER3, 1190, 50)
E(STINGER3, 1290, 50)
E(LAUNCHER, 1396, 270, rot=-135)
E(LAUNCHER, 1080, 160, rot=-90)
grid(1240, 278, 5, 1, 24)
E(BARREL, 1400, 40)

# ---------------------------------------------------------------- pickups
pick = []


def pickup(x, y, type_, item, q, **kw):
    pick.append(P('game objects/powerup', x, y, props=dict({'type': type_, 'item': item, 'quantity': q}, **kw)))


# A
pickup(130, LANES[3] + 2, 'primary', 'Spreader', 60)          # the queue's first lane: right at the start
pickup(150, 1548, 'health', 'health', 25)
pickup(1380, 1515, 'primary', 'Spreader', 40)                 # barracks back
pickup(1370, 1340, 'health', 'health', 50)
pickup(520, 1200, 'primary', 'Bolter', 40)
pickup(900, 1510, 'secondary', 'Carbon Bomb', 2)
# B
pickup(*KEY_BLUE, 'key', KEYS['blue'], 1)
pickup(60, 1010, 'health', 'health', 50)
pickup(1200, 960, 'secondary', 'Stun Bomb', 4)                # under the missile battery's eye
pickup(1240, 960, 'health', 'health', 25)
pickup(720, 900, 'primary', 'Spreader', 40)
pickup(860, 1010, 'primary', 'Plasma', 15)
# C
pickup(60, 610, 'health', 'health', 50)
pickup(1380, 360, 'secondary', 'Stun Bomb', 3)
pickup(800, 556, 'primary', 'Spreader', 40)
# D
pickup(220, 60, 'health', 'health', 50)
pickup(1060, 120, 'primary', 'Spreader', 50)
pickup(1060, 210, 'health', 'health', 50)

# the locks: an invisible pad on the near side of each door takes the keycard and opens it
LOCKS = (('yellow', DOOR_YELLOW, +1, 'door1'), ('blue', DOOR_BLUE, +1, 'door2'), ('red', DOOR_RED, +1, 'door3'))
doors = []
for colour_, (dx, dy), side, did in LOCKS:
    r, g, b = KEY_RGB[colour_]
    doors.append(P('game objects/door', dx, dy, rot=90, props={'id': did},
                   color={'multiply': [0.55, 0.55, 0.55, 1], 'add': [int(r * 0.45), int(g * 0.45), int(b * 0.45), 0]}))
    half = (WALL_AB[1] - WALL_AB[0] if colour_ == 'yellow' else 40) / 2
    pick.append(P('game objects/powerup', dx, dy + side * (half + 18), scale=[5.2, 3.2],
                  props={'type': 'lock', 'item': KEYS[colour_], 'unlock': f'{did}:open'}))

# ---------------------------------------------------------------- boxes
# Every box is required for the exit, as on the earlier maps.
boxes = []
brng = random.Random(5050)
DROPS = [{'type': 'health', 'item': 'health', 'quantity': 25}, {'type': 'primary', 'item': 'Bolter', 'quantity': 25},
         {'type': 'primary', 'item': 'Spreader', 'quantity': 25}, {'type': 'secondary', 'item': 'Stun Bomb', 'quantity': 1},
         {'type': 'secondary', 'item': 'Carbon Bomb', 'quantity': 1}, {'type': 'primary', 'item': 'Plasma', 'quantity': 10}]


def crates(x, y, n, dx=20, dy=0, drop=None):
    for k in range(n):
        o = P('game objects/box', x + k * dx, y + k * dy)
        if drop is not False and k == n // 2 and (drop or brng.random() < 0.4):
            o['scale'] = 1.285706
            d = drop or brng.choice(DROPS)
            if d['item'] == 'Stun Bomb' and y > 1100: d = DROPS[0]      # no stun bombs before the yard
            o['props'] = {'health': 25, 'powerupDrop': d}
        boxes.append(o)


def stack(x, y, cols=2, rows=2):
    for i in range(cols):
        crates(x + i * 20, y, rows, 0, 20, drop=False)


# A: crates along the hall face, round the barracks, in the pen's corners (luggage), on the boulevard
crates(880, 1140, 4)
crates(520, 1140, 3, drop=False)
crates(1170, 1250, 6)
stack(1300, 1480)
stack(1180, 1350, 1, 3)
crates(40, LANES[0] - 14, 2, 0, 24, drop=False)
crates(460, LANES[2], 3)
crates(480, LANES[1], 2, drop=False)
crates(860, 1360, 4)
stack(650, 1380)
crates(960, 1505, 3, drop={'type': 'health', 'item': 'health', 'quantity': 25})
crates(330, 1560, 5)
# B: filing cabinets in the office, the yard, rows of impounded crates in the lot
crates(40, 900, 4, 0, 20)
crates(150, 900, 5)
crates(330, 900, 4, 0, 20, drop=False)
stack(340, 690)
crates(530, 800, 2, 0, 20, drop=False)
stack(600, 770)
stack(830, 760)
crates(620, 1010, 3, drop=False)
for k, y in enumerate((720, 800, 880)):
    crates(1000, y, 6 - k)
    crates(1230, y + 40, 5)
crates(970, 1015, 2, drop=False)
crates(1300, 1015, 4, drop={'type': 'secondary', 'item': 'Stun Bomb', 'quantity': 2})
# C: crates along the inner wall between the towers, and on the ditch's south lip
crates(290, 352, 3)
crates(560, 352, 3)
crates(1270, 352, 3, drop={'type': 'health', 'item': 'health', 'quantity': 25})
crates(660, 556, 3)
crates(985, 560, 2)
crates(1120, 352, 2, drop=False)
crates(1090, 556, 3, drop=False)
# D: crates round the pillars and in the corners
for px, py in PILLARS:
    crates(px - 10, py - 34, 2, drop=False)
crates(40, 160, 4, 0, 20)
crates(140, 270, 4)
crates(1390, 100, 5, 0, 20)
crates(1100, 282, 2, drop={'type': 'health', 'item': 'health', 'quantity': 50})


BRIEFING = {
    'title': 'GATEWAY',
    'body': ("Please have your keycard, your papers and your\n"
             "remaining dignity ready for inspection. Three walls,\n"
             "three locked doors, a Warden on every patrol. Wardens\n"
             "call the guards the moment they spot you, and they\n"
             "will spot you. They also carry the keycards -- they\n"
             "won't be needing them. Missile Batteries can't be\n"
             "reached, only reasoned with. Reason loudly."),
    'captions': [
        {'style': 'name', 'text': 'Checkpoint Warden', 'x': 636.45, 'y': 209.89},
        {'style': 'note', 'text': 'Calls the guards. Has your keys.', 'x': 636.45, 'y': 316.6},
        {'style': 'name', 'text': 'Missile Battery', 'x': 636.48, 'y': 359.89},
        {'style': 'note', 'text': 'Seekers. Stun it, then shoot it.', 'x': 636.45, 'y': 426.6},
    ],
    'graphics': [
        {'symbol': 'enemy assets/designs/beetle', 'x': 636.5, 'y': 270, 'matrix': [-1.6, 0, 0, -1.6]},
        {'symbol': 'enemy assets/enemy missile launcher core', 'x': 636.5, 'y': 400},
        {'symbol': 'enemy assets/enemy missile launcher turret', 'x': 636.5, 'y': 400},
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


# intro messages: the weapons' are on their definitions (as2/player.as); the keycard's is the level's own
INTRO = {KEYS['yellow']: 'KEYCARD: it opens the door marked in its colour. Drive up to the door to use it.'}


def add_intros():
    props = [o['props'] for o in pick] + [o['props']['powerupDrop'] for o in boxes + enemies if 'powerupDrop' in o.get('props', {})]
    for pr in props:
        if pr.get('type') == 'key' and pr.get('item') in INTRO:
            pr.update(alertMessage=INTRO[pr['item']])


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
    }
    for name, text in files.items():
        with open(os.path.join(a.out, name), 'w', encoding='utf-8', newline='\n') as f: f.write(text)
    lj = os.path.join(a.out, 'level.json')
    settings = json.load(open(lj)) if os.path.exists(lj) else {}
    settings['size'] = {'w': W, 'h': H + SHIFT}
    settings.setdefault('art', {'kit': 'city', 'seed': 505, 'grade': 'olive'})
    settings['art'].setdefault('paved', [[num(r[0]), num(Y(r[1])), num(r[2]), num(Y(r[3]))] for r in PAVED])
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
    """A schematic: walls, chasms, routes, enemies, pickups, doors in their key colours."""
    from PIL import Image, ImageDraw
    S = 0.75
    im = Image.new('RGB', (int(W * S), int((H + SHIFT) * S)), (226, 224, 214))
    d = ImageDraw.Draw(im)
    sc = lambda pts: [(x * S, y * S) for x, y in pts]

    def polys(dstr):
        out = []
        for part in dstr.split('Z'):
            nums = [float(t) for t in part.replace('M', ' ').replace('L', ' ').split()]
            if nums: out.append(list(zip(nums[0::2], nums[1::2])))
        return out
    for s in shapes:
        col = {'wall': (40, 42, 36), 'chasm': (120, 118, 140), 'open': (226, 224, 214)}[s['mode']]
        ps = polys(s['d'])
        d.polygon(sc(ps[0]), fill=col)
        for hole in ps[1:]: d.polygon(sc(hole), fill=(226, 224, 214))
    by = {n['name']: n for n in nodes}
    for n in nodes:
        c = tuple(n['color']['add'][:3])
        for ref in (n.get('props') or {}).get('connections', [])[:1]:
            m = by[ref['$ref']]
            d.line(sc([(n['x'], n['y']), (m['x'], m['y'])]), fill=c, width=2)
        r = 3 if n.get('props') else 2
        d.ellipse([n['x'] * S - r, n['y'] * S - r, n['x'] * S + r, n['y'] * S + r], fill=c)
    for b in boxes: d.rectangle([b['x'] * S - 6, b['y'] * S - 6, b['x'] * S + 6, b['y'] * S + 6], fill=(150, 110, 60), outline=(90, 60, 30))
    for e in enemies:
        r = {TANK: 14, BATTERY: 15, WOLFGUN: 9, LAUNCHER: 11, WARDEN: 12, SCURGE: 5}.get(e['symbol'], 7)
        col = {TANK: (200, 60, 0), SCOUT: (180, 0, 200), SCURGE: (130, 130, 30), BARREL: (255, 60, 0), LAUNCHER: (0, 120, 220),
               WARDEN: (90, 140, 30), BATTERY: (150, 0, 0)}.get(e['symbol'], (230, 170, 0))
        d.ellipse([e['x'] * S - r, e['y'] * S - r, e['x'] * S + r, e['y'] * S + r], fill=col, outline=(0, 0, 0))
        drop = (e.get('props') or {}).get('powerupDrop')
        if drop and drop['type'] == 'key':
            kc = KEY_RGB[[k for k, v in KEYS.items() if v == drop['item']][0]]
            d.rectangle([e['x'] * S - 6, e['y'] * S - 4, e['x'] * S + 6, e['y'] * S + 4], fill=kc, outline=(0, 0, 0))
    for p in pick:
        t = p['props']['type']
        if t == 'lock': continue
        col = {'primary': (0, 160, 255), 'secondary': (255, 120, 0), 'health': (0, 180, 60)}.get(t, (0, 0, 0))
        if t == 'key':
            col = KEY_RGB[[k for k, v in KEYS.items() if v == p['props']['item']][0]]
            d.rectangle([p['x'] * S - 8, p['y'] * S - 5, p['x'] * S + 8, p['y'] * S + 5], fill=col, outline=(0, 0, 0), width=2)
        else:
            d.rectangle([p['x'] * S - 6, p['y'] * S - 6, p['x'] * S + 6, p['y'] * S + 6], outline=col, width=3)
    for colour_, (dx, dy), _, _ in LOCKS:
        dy = Y(dy)
        d.rectangle([(dx - 30) * S, (dy - 7) * S, (dx + 30) * S, (dy + 7) * S], fill=KEY_RGB[colour_], outline=(0, 0, 0))
    for f in features: d.ellipse([f['x'] * S - 16, f['y'] * S - 16, f['x'] * S + 16, f['y'] * S + 16], outline=(0, 150, 0), width=4)
    from PIL import ImageFont
    try: font = ImageFont.truetype('DejaVuSans-Bold.ttf', 15)
    except OSError: font = ImageFont.load_default()
    for text, x, y in (('D  THE GATE (exit)', 560, 260), ('C  THE STRIP', 40, 640), ('B  RECORDS OFFICE', 40, 1060),
                       ('B  INSPECTION YARD', 600, 1060), ('B  IMPOUND LOT', 1010, 1060), ('A  QUEUE PEN', 300, 1200),
                       ('A  TOLL PLAZA / BOULEVARD', 680, 1440), ('A  BARRACKS', 1180, 1630)):
        d.text((x * S, y * S), text, fill=(0, 0, 0), font=font, stroke_width=3, stroke_fill=(255, 255, 255))
    im.save(path)


if __name__ == '__main__':
    main()

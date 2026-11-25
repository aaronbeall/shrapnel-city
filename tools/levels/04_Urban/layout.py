"""Level 04 Urban: the first-draft layout, written as the standard level files.

    python tools/levels/04_Urban/layout.py            # writes levels/04_Urban/*.json (not the art)
    python tools/levels/04_Urban/layout.py --preview out.png   # also a quick schematic PNG

This is a one-off tool for this level (see the level plan: each map is its own task). It
describes the map as city blocks on a street grid and writes:

- collision.json: one vector shape per building, barricade, planter and crater, so every
  piece can be moved or reshaped in the editor's shape stack
- features.json, pathNodes.json, enemies.json, boxes.json, powerups.json, doors.json
- level.json and briefing.json

collision.png is then baked from collision.json by tools/levels/bake_collision.mjs (the
editor's own bake, run in Chromium), and background.png by tools/art/bake.py.

The plan's idea for the level: city blocks, streets as patrol loops; enemy tanks on
patrol paths (their debut) and stingers; the city street art set (grey day, chasm).
Re-running this overwrites hand edits in those files, so once the level has been tuned in
the editor, don't run it again (or run it with --out to write somewhere else).
"""
import argparse
import json
import math
import os
import random

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FOLDER = '04_Urban'

W, H = 1600, 1120
B = 20          # outer wall
S = 112         # street width
COLS, ROWS = 4, 3
BW = (W - 2 * B - (COLS + 1) * S) // COLS   # block width  (250)
BH = (H - 2 * B - (ROWS + 1) * S) // ROWS   # block height (210)
CH = 10         # chamfer on building corners

rng = random.Random(404)


# ---------------------------------------------------------------- grid
def street_x(i):  # left edge of vertical street i (0..COLS)
    return B + i * (S + BW)


def street_y(j):
    return B + j * (S + BH)


def block(c, r):  # x0, y0, x1, y1 of block (c, r)
    x0, y0 = street_x(c) + S, street_y(r) + S
    return x0, y0, x0 + BW, y0 + BH


def cross(i, j):  # centre of the crossing of vertical street i and horizontal street j
    return street_x(i) + S / 2, street_y(j) + S / 2


# ---------------------------------------------------------------- shapes
def num(v):
    v = round(v, 2)
    return int(v) if float(v).is_integer() else v


def poly_d(pts):
    return 'M ' + ' L '.join(f'{num(x)} {num(y)}' for x, y in pts) + ' Z'


def chamfer_rect(x0, y0, x1, y1, c=CH):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def building(x0, y0, x1, y1, notches=2, c=CH):
    """A building footprint: a chamfered box with a few setbacks cut into its facades."""
    pts = []
    sides = [((x0, y0), (x1, y0), (0, 1)), ((x1, y0), (x1, y1), (-1, 0)), ((x1, y1), (x0, y1), (0, -1)), ((x0, y1), (x0, y0), (1, 0))]
    cut = set(rng.sample(range(4), min(notches, 4)))
    for k, ((ax, ay), (bx, by), (nx, ny)) in enumerate(sides):
        L = abs(bx - ax) + abs(by - ay)
        dx, dy = (bx - ax) / L, (by - ay) / L
        pts.append((ax + dx * c, ay + dy * c))
        if k in cut and L > 140:
            a = rng.uniform(0.2, 0.45) * L
            b = a + rng.uniform(0.25, 0.4) * L
            dep = rng.choice((12, 16, 20))
            for t, d in ((a, 0), (a, dep), (b, dep), (b, 0)):
                pts.append((ax + dx * t + nx * d, ay + dy * t + ny * d))
        pts.append((bx - dx * c, by - dy * c))
    return pts


def ring(outer, inner):
    """Even-odd path: outer outline with a hole."""
    return poly_d(outer) + ' ' + poly_d(inner)


def octagon(cx, cy, r, c=None):
    c = r * 0.41 if c is None else c
    return chamfer_rect(cx - r, cy - r, cx + r, cy + r, c)


def blob(cx, cy, rx, ry, n=14, jitter=0.18):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rng.uniform(-jitter, jitter)
        pts.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k))
    return pts


# ---------------------------------------------------------------- the map
shapes = []          # collision.json, bottom first (after the white base)


def add(name, d, mode='wall', group=None):
    s = {'name': name, 'mode': mode, 'd': d}
    if group: s['group'] = group
    shapes.append(s)


# outer wall: the city keeps going, but not for you
add('outer wall', poly_d([(0, 0), (W, 0), (W, H), (0, H)]) + ' ' + poly_d([(B, B), (B, H - B), (W - B, H - B), (W - B, B)]))

# Blocks. (c, r): 0..3 west to east, 0..2 north to south.
#   (0,0) building        (1,0) courtyard (Thermal Bomb)   (2,0) building        (3,0) exit plaza
#   (0,1) plaza           (1,1)+(2,1) the tower superblock                     (3,1) building
#   (0,2) building        (1,2) courtyard (Vertigo)        (2,2) crater          (3,2) building
for c, r in ((0, 0), (2, 0), (3, 1), (0, 2), (3, 2)):
    add(f'building {c},{r}', poly_d(building(*block(c, r))), group='buildings')

# the tower: blocks (1,1) and (2,1) joined over street 2, so the loop around it is long
x0, y0, _, y1 = block(1, 1)
_, _, x1, _ = block(2, 1)
add('tower', poly_d(building(x0, y0, x1, y1, notches=4, c=18)), group='buildings')


def courtyard(c, r, door_side):
    """A building around an open courtyard, entered by a 64 px alley through one side."""
    x0, y0, x1, y1 = block(c, r)
    t = 46                                     # building depth around the yard
    outer = chamfer_rect(x0, y0, x1, y1)
    inner = chamfer_rect(x0 + t, y0 + t, x1 - t, y1 - t, 8)
    add(f'courtyard {c},{r}', ring(outer, inner), group='buildings')
    # the alley: an open cut through the ring
    cx = (x0 + x1) / 2
    a = 32
    if door_side == 'south':
        cut = [(cx - a, y1 - t - 2), (cx + a, y1 - t - 2), (cx + a, y1 + 1), (cx - a, y1 + 1)]
        door = (cx, y1 - t / 2)
    else:
        cut = [(cx - a, y0 - 1), (cx + a, y0 - 1), (cx + a, y0 + t + 2), (cx - a, y0 + t + 2)]
        door = (cx, y0 + t / 2)
    add(f'courtyard {c},{r} alley', poly_d(cut), mode='open', group='buildings')
    return door, ((x0 + x1) / 2, (y0 + y1) / 2)


yard_s, yard_s_mid = courtyard(1, 2, 'south')    # Vertigo
yard_n, yard_n_mid = courtyard(1, 0, 'south')    # Thermal Bomb

# (0,1) plaza: planters to hide behind and a dry fountain (a chasm you can shoot across)
x0, y0, x1, y1 = block(0, 1)
pcx, pcy = (x0 + x1) / 2, (y0 + y1) / 2
add('plaza fountain', poly_d(octagon(pcx, pcy, 34)), mode='chasm', group='plaza')
add('plaza fountain rim', poly_d(octagon(pcx, pcy, 42)) + ' ' + poly_d(octagon(pcx, pcy, 34)), group='plaza')
for k, (px, py) in enumerate(((x0 + 30, y0 + 30), (x1 - 30, y0 + 30), (x0 + 30, y1 - 30), (x1 - 30, y1 - 30))):
    add(f'plaza planter {k + 1}', poly_d(chamfer_rect(px - 18, py - 18, px + 18, py + 18, 6)), group='plaza')
for k, (px, py, w, h) in enumerate(((pcx - 95, pcy, 14, 60), (pcx + 95, pcy, 14, 60))):
    add(f'plaza bench {k + 1}', poly_d(chamfer_rect(px - w / 2, py - h / 2, px + w / 2, py + h / 2, 4)), group='plaza')

# (2,2) the crater: the block fell into the subway. Shoot across it, drive around it.
x0, y0, x1, y1 = block(2, 2)
ccx, ccy = (x0 + x1) / 2, (y0 + y1) / 2 + 4
add('crater', poly_d(blob(ccx, ccy, BW / 2 - 4, BH / 2 - 4, 16, 0.12)), mode='chasm', group='crater')
for k, (fx, fy, r) in enumerate(((x0 + 14, y0 + 20, 18), (x1 - 22, y0 + 16, 22), (x1 - 10, y1 - 30, 16), (x0 + 30, y1 - 8, 20))):
    add(f'crater rubble {k + 1}', poly_d(blob(fx, fy, r, r * 0.8, 7, 0.3)), group='crater')

# (3,0) the exit square: the north-east corner is a walled compound (the square plus the streets
# round it). Its only way in is a checkpoint gate on street 3; the gate opens when the
# checkpoint terminal in the north courtyard is destroyed. A tank circles the exit pad.
x0, y0, x1, y1 = block(3, 0)
ex, ey = (x0 + x1) / 2, (y0 + y1) / 2
cw = 16                                   # checkpoint wall thickness
gap = 56                                  # the gate's opening
wy = street_y(1) + 18                     # the walls sit just inside the compound's south edge
gx0, gx1 = street_x(3), street_x(3) + S
side = (S - gap) / 2
# one wall right across the compound's south side, from the tower block's corner to the east
# edge, with the gate's opening in it
add('checkpoint wall west', poly_d(chamfer_rect(gx0 - 4, wy - cw / 2, gx0 + side, wy + cw / 2, 3)), group='checkpoint')
add('checkpoint wall east', poly_d(chamfer_rect(gx1 - side, wy - cw / 2, W - B + 4, wy + cw / 2, 3)), group='checkpoint')
gate = (gx0 + S / 2, wy)
nx = street_x(3) - cw
add('checkpoint wall north', poly_d(chamfer_rect(nx, B - 4, nx + cw, B + S + 4, 3)), group='checkpoint')
# cover in the square: two planters north of the exit pad (the blue tank drives the south edge)
for k, (px, py) in enumerate(((x0 + 34, y0 + 34), (x1 - 34, y0 + 34))):
    add(f'exit square planter {k + 1}', poly_d(chamfer_rect(px - 20, py - 16, px + 20, py + 16, 6)), group='exit square')

# Collapsed streets (chasm): close the west avenue between rows 1 and 2, and the north
# street between blocks 0 and 1, so the way on is through the middle of town.
sx = street_x(0)
cy0 = street_y(2) - 8
add('collapsed west avenue', poly_d([(sx, cy0 + 4), (sx + 40, cy0 - 6), (sx + 80, cy0 + 2), (sx + S, cy0 - 4), (sx + S, cy0 + S * 0.55), (sx + 70, cy0 + S * 0.6), (sx + 30, cy0 + S * 0.5), (sx, cy0 + S * 0.58)]), mode='chasm', group='collapsed streets')
# The spawn bay: the drop zone in the south-west corner is walled off from the two long
# streets it sits on, with a dog-leg out each way, so nothing down the streets can see you
# land. (Aaron: spawn somewhere quiet, a couple of enemies in sight at most.)
for name, (x0_, y0_, x1_, y1_) in (
        ('spawn bay avenue wall', (B - 4, street_y(3) - 94, B + 60, street_y(3) - 78)),             # gap on the east
        ('spawn bay avenue baffle', (B + 56, street_y(3) - 174, street_x(0) + S + 4, street_y(3) - 158)),  # gap on the west
        ('spawn bay street wall', (street_x(0) + S + 38, street_y(3) - 4, street_x(0) + S + 54, street_y(3) + 54)),  # gap on the south
        ('spawn bay street baffle', (street_x(0) + S + 118, street_y(3) + 58, street_x(0) + S + 134, H - B + 4))):   # gap on the north
    add(name, poly_d(chamfer_rect(x0_, y0_, x1_, y1_, 3)), group='spawn bay')
sy = street_y(0)
cx0 = street_x(1) + 6
add('collapsed north street', poly_d([(cx0, sy), (cx0 + S - 12, sy), (cx0 + S - 2, sy + 40), (cx0 + S - 14, sy + S), (cx0 + 8, sy + S), (cx0 - 4, sy + 60)]), mode='chasm', group='collapsed streets')

# Barricades: concrete barriers part-way across streets, cover for the player and the tanks' sightlines
bar = [
    (cross(1, 3)[0] + 70, street_y(3) + S / 2, 50, 14),
    (cross(2, 2)[0], street_y(2) + 30, 60, 14),
    (street_x(4) + 16, cross(4, 2)[1] + 120, 14, 50),
    (cross(2, 0)[0] - 40, street_y(0) + S - 30, 60, 14),
]
for k, (bx, by, bw, bh) in enumerate(bar):
    add(f'barrier {k + 1}', poly_d(chamfer_rect(bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2, 4)), group='barriers')


# areas paved all over in the art: the plaza, the courtyards' yards and the exit square
PAVED = [block(0, 1), block(3, 0)] + [(b[0] + 40, b[1] + 40, b[2] - 40, b[3] + 2) for b in (block(1, 2), block(1, 0))]


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


# entrance: south-west street corner, facing north (rotation as the Bridge's: clockwise degrees)
start = cross(0, 3)
features = [
    P('game objects/entrance_mc', start[0], start[1] - 10, name='entrance_mc'),
    P('game objects/exit_mc', ex, ey, name='exit_mc'),
]

# path nodes: one colour per patrol loop, pinned in loop order so a tank drives round the block
GROUPS = {'red': [255, 0, 0, 0], 'blue': [0, 0, 255, 0], 'green': [0, 200, 0, 0]}
nodes, node_n = [], [0]


def loop(group, corners):
    names = []
    for x, y in corners:
        node_n[0] += 1
        names.append(f'n{node_n[0]}')
    # every other node 1 px to the right: a vehicle never drives exactly straight down, which
    # it can't (enemyVehicle only thrusts once _rotation == targetRotation, and a target straight
    # below is 180 while _rotation reads back as -180, so it turns forever)
    corners = [(x + k % 2, y) for k, (x, y) in enumerate(corners)]
    for k, (x, y) in enumerate(corners):
        nxt, prv = names[(k + 1) % len(names)], names[k - 1]
        nodes.append(P('game objects/node', x, y, name=names[k], color={'multiply': [0, 0, 0, 1], 'add': GROUPS[group]},
                       props={'connections': [{'$ref': nxt}, {'$ref': prv}]}))
    return (GROUPS[group][0] << 16) | (GROUPS[group][1] << 8) | GROUPS[group][2]


def mid(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


# red: round the tower (streets 1 and 3, rows 1 and 2), with midpoints so the tanks hug the street centre
A = [cross(1, 1), cross(3, 1), cross(3, 2), cross(1, 2)]
red = loop('red', [A[0], mid(A[0], A[1]), A[1], A[2], mid(A[2], A[3]), A[3]])
# blue: round the exit square, inside the compound
Bq = [cross(3, 0), cross(4, 0), (cross(4, 0)[0], wy - 44), (cross(3, 0)[0], wy - 44)]
blue = loop('blue', Bq)
# green: round (3,2), the south-east block
Cq = [cross(3, 2), cross(4, 2), cross(4, 3), cross(3, 3)]
green = loop('green', Cq)

TANK = 'enemy assets/enemy tank'
SCOUT = 'enemy assets/enemy scout'
STINGER, STINGER2, STINGER3 = 'enemy assets/enemy stinger', 'enemy assets/enemy stinger2', 'enemy assets/enemy stinger3'
WOLFGUN, BATTERY = 'enemy assets/enemy wolfgun', 'enemy assets/enemy double battery'
SCURGE, BARREL = 'enemy assets/enemy scurge', 'enemy assets/enemy object fire barrel'

# Density follows the earlier levels: Bridge has about 11 enemies and 11 crates per 100k px of
# open floor, First Block about 8.5. Scurge are the filler, in small formations, packed denser
# where it should be hard (the exit compound). Every turret type is used, the buffed stingers
# (stinger2: fast bursts, stinger3: red bursts, drops health) guarding the valuable spots.
enemies = []
E = lambda sym, x, y, **kw: enemies.append(P(sym, x, y, **kw))

# tanks: two on the tower loop (opposite sides), one on each of the others
E(TANK, *mid(A[0], A[1]), props={'pathID': red}, rot=90)
E(TANK, *mid(A[2], A[3]), props={'pathID': red}, rot=-90)
E(TANK, *Bq[1], props={'pathID': blue}, rot=180)
E(TANK, mid(Cq[1], Cq[2])[0] - 3, mid(Cq[1], Cq[2])[1], props={'pathID': green, 'powerupDrop': {'type': 'health', 'item': 'health', 'quantity': 50}}, rot=180)


def corner(c, r, which, out=18):
    """A spot on the pavement just off a building's corner."""
    x0, y0, x1, y1 = block(c, r)
    return {'nw': (x0 - out, y0 - out), 'ne': (x1 + out, y0 - out), 'sw': (x0 - out, y1 + out), 'se': (x1 + out, y1 + out)}[which]


def tri(x, y, s=30, down=False):
    """Three scurge in a triangle (as on the Bridge)."""
    k = -1 if down else 1
    for dx, dy in ((0, -k * s * 0.58), (-s / 2, k * s * 0.29), (s / 2, k * s * 0.29)):
        E(SCURGE, x + dx, y + dy)


def grid(x, y, cols, rows, s=30):
    """A block of scurge centred on (x, y)."""
    for i in range(cols):
        for j in range(rows):
            E(SCURGE, x + (i - (cols - 1) / 2) * s, y + (j - (rows - 1) / 2) * s)


# --- the start (south-west): a hot start but not a crowd. Only the scurge in the
# spawn bay can see the spawn; the rest wait round its dog-legs.
E(STINGER, *corner(0, 2, 'ne'))
E(STINGER, *corner(0, 1, 'nw'))
tri(92, 948, s=26)                            # in the spawn bay: the hot start
tri(250, 720)                                 # round the corner, in the street north of the first block
tri(335, 720, down=True)
E(BARREL, 180, 700)
# the south courtyard (Vertigo): scouts and a stinger2 over the prize
E(SCOUT, yard_s_mid[0] - 50, yard_s_mid[1] - 20)
E(SCOUT, yard_s_mid[0] + 50, yard_s_mid[1] - 20)
E(STINGER2, yard_s_mid[0] + 58, yard_s_mid[1] + 36)
E(WOLFGUN, *corner(1, 2, 'se'))
# south street east of the courtyard, up to the crater
tri(760, 1042)
grid(cross(2, 3)[0] + 60, 1042, 2, 2)
E(STINGER, *corner(2, 2, 'sw'))
E(BARREL, 836, 1076)
# the crater: guns on its far rim, scurge round its edge
E(STINGER3, 981, 766)
E(STINGER, 930, 1004)
# --- the south-east block (green loop): its guns sit on the facades, clear of the tank
x0, y0, x1, y1 = block(3, 2)
E(STINGER, x0 + 60, y1 + 14)
E(STINGER, x1 - 60, y1 + 14)
E(WOLFGUN, (x0 + x1) / 2, y0 - 16)
# --- the plaza (west): scouts, a wolfgun on the fountain's north side, scurge in the corners
E(SCOUT, pcx - 60, pcy - 60)
E(SCOUT, pcx + 60, pcy + 60)
E(WOLFGUN, pcx, pcy - 82)
tri(pcx - 45, pcy + 78, s=26, down=True)
tri(pcx + 45, pcy - 78, s=26)
E(STINGER, *corner(0, 1, 'se'))
E(BARREL, pcx + 70, pcy + 40)
# west avenue north of the collapse and the north-west corner
tri(76, 470)
grid(76, 570, 2, 3)
grid(250, 70, 3, 2)
E(STINGER, *corner(0, 0, 'nw'))
E(STINGER, *corner(0, 0, 'se'))
E(STINGER2, *corner(0, 0, 'sw'))
# --- the north courtyard (Thermal Bomb, terminal): a stinger3 guards the terminal
E(SCOUT, yard_n_mid[0] - 50, yard_n_mid[1])
E(SCOUT, yard_n_mid[0] + 50, yard_n_mid[1])
E(STINGER3, yard_n_mid[0] - 58, yard_n_mid[1] + 40)
tri(cross(1, 1)[0], 250)                      # street 1 north of the tower loop
tri(cross(1, 1)[0], 170, down=True)
tri(cross(2, 1)[0], 250)
E(STINGER, *corner(2, 0, 'nw'))
E(STINGER, *corner(2, 0, 'sw'))
grid(720, 70, 3, 2)                           # north street
tri(1040, 92)
E(WOLFGUN, 980, 40)
E(BARREL, 640, 36)
# --- round the tower (red loop): guns on the corners, scurge on the kerbs
E(STINGER, *corner(3, 1, 'nw'))
E(STINGER, *corner(3, 1, 'sw'))
E(STINGER2, *corner(1, 1, 'sw'))
grid(600, 1048, 3, 2, s=28)                   # south street, west of the crater
# east avenue beside (3,1), outside the compound
grid(1524, 560, 2, 3)
E(STINGER, *corner(3, 1, 'ne'))
# --- the exit compound: the final room. A double battery and stinger3s over the exit pad,
# a packed block of scurge, scouts, and the blue tank circling
E(BATTERY, 1262, 232, rot=180)
E(STINGER3, ex - 30, 150)
E(STINGER3, ex + 30, 150)
grid(1430, 235, 3, 4, s=24)
E(SCOUT, ex - 45, ey - 50)
E(SCOUT, ex + 45, ey - 50)
E(WOLFGUN, 1560, 200)

# pickups: the new weapons in the courtyards, ammo and health along the way
pick = []


def pickup(x, y, type_, item, q, **kw):
    pick.append(P('game objects/powerup', x, y, props=dict({'type': type_, 'item': item, 'quantity': q}, **kw)))


pickup(yard_s_mid[0], yard_s_mid[1] - 30, 'primary', 'Vertigo', 120)
pickup(yard_s_mid[0] - 30, yard_s_mid[1] + 10, 'health', 'health', 50)
pickup(yard_n_mid[0], yard_n_mid[1] - 20, 'secondary', 'Thermal Bomb', 4)
pickup(yard_n_mid[0] + 30, yard_n_mid[1] + 10, 'health', 'health', 50)
pickup(150, 1080, 'primary', 'Bolter', 40)
pickup(pcx, pcy + 62, 'primary', 'Bolter', 40)
pickup(pcx + 50, pcy - 15, 'health', 'health', 25)
pickup(*cross(2, 3), 'primary', 'Vertigo', 60)
pickup(76, 300, 'secondary', 'Carbon Bomb', 2)
pickup(800, 170, 'primary', 'Plasma', 15)
pickup(1004, 76, 'health', 'health', 25)
pickup(1524, 470, 'secondary', 'Thermal Bomb', 2)
pickup(1524, 660, 'health', 'health', 50)
pickup(1090, 1050, 'primary', 'Vertigo', 40)
pickup(1343, 1004, 'secondary', 'Carbon Bomb', 2)
pickup(60, 770, 'primary', 'Bolter', 30)
pickup(ex - 43, 280, 'health', 'health', 50)    # in the final room, if you get that far
pickup(ex + 43, 280, 'primary', 'Vertigo', 40)
# the checkpoint gate, opened by the terminal in the north courtyard
doors = [P('game objects/door', *gate, rot=90, props={'id': 'door1'})]
# the courtyards' alleys have shutters that roll up as you walk up to them (like Bridge's
# doors): a trigger pad on the street side opens them, so whatever is inside waits for you
for k, (dx, dy) in enumerate((yard_s, yard_n)):
    did = f'door{k + 2}'
    d = P('game objects/door', dx, dy, props={'id': did})
    d['matrix'] = [0, 1, num(-64 / 56), 0]          # turned across the alley, stretched to its 64 px
    doors.insert(len(doors), d)
    pick.append(P('game objects/powerup', dx, dy + 62, scale=[2.2, 1.8], props={'type': 'trigger', 'item': did + ':open'}))

# boxes: crates in rows along the kerbs and in stacks, some carrying drops. Every box
# except the terminal is required: the exit opens when they're all gone.
boxes = []
brng = random.Random(4040)
DROPS = [{'type': 'health', 'item': 'health', 'quantity': 25}, {'type': 'primary', 'item': 'Bolter', 'quantity': 25},
         {'type': 'primary', 'item': 'Vertigo', 'quantity': 30}, {'type': 'secondary', 'item': 'Thermal Bomb', 'quantity': 1},
         {'type': 'secondary', 'item': 'Carbon Bomb', 'quantity': 1}, {'type': 'primary', 'item': 'Plasma', 'quantity': 10}]


def crates(x, y, n, dx=20, dy=0, drop=None):
    """A row of n crates; the middle one, a bigger crate, carries a drop."""
    for k in range(n):
        o = P('game objects/box', x + k * dx, y + k * dy)
        if drop is not False and k == n // 2 and (drop or brng.random() < 0.45):
            o['scale'] = 1.285706
            o['props'] = {'health': 25, 'powerupDrop': drop or brng.choice(DROPS)}
        boxes.append(o)


def stack(x, y):
    """A 2x2 stack of crates."""
    for dx in (0, 20):
        crates(x + dx, y, 2, 0, 20, drop=False)


def kerb_row(c, r, side, n, at=0.5, off=12):
    """A row of crates on the pavement along one side of block (c, r), centred at `at` of it."""
    x0, y0, x1, y1 = block(c, r)
    L = (n - 1) * 20
    if side in ('n', 's'):
        cx = x0 + (x1 - x0) * at - L / 2
        crates(cx, y0 - off if side == 'n' else y1 + off, n)
    else:
        cy = y0 + (y1 - y0) * at - L / 2
        crates(x0 - off if side == 'w' else x1 + off, cy, n, 0, 20)


for c, r, side, n, at in (
        (0, 2, 'e', 4, 0.5), (0, 2, 'n', 5, 0.5), (0, 2, 's', 4, 0.8),
        (1, 2, 'w', 4, 0.5), (1, 2, 'n', 4, 0.3), (1, 2, 's', 3, 0.15),
        (3, 2, 'w', 4, 0.4), (3, 2, 'e', 4, 0.8),
        (0, 0, 'e', 4, 0.6), (0, 0, 's', 5, 0.5), (0, 0, 'n', 4, 0.4),
        (1, 0, 'n', 5, 0.5), (1, 0, 'w', 3, 0.5),
        (2, 0, 'n', 4, 0.3), (2, 0, 'w', 4, 0.6),
        (1, 1, 'n', 6, 0.18), (1, 1, 's', 6, 0.75),
        (3, 1, 'w', 4, 0.5), (3, 1, 'e', 4, 0.3)):
    kerb_row(c, r, side, n, at)
# stacks in the open: courtyards, plaza, start, crater rim, north street
stack(yard_s_mid[0] - 20, yard_s_mid[1] + 20)
stack(yard_n_mid[0] + 40, yard_n_mid[1] - 40)
stack(pcx - 50, pcy - 95)
stack(pcx + 30, pcy + 75)
stack(30, 1000)
stack(1060, 990)
stack(30, 150)
crates(1220, 30, 6, drop={'type': 'health', 'item': 'health', 'quantity': 50})   # compound, north wall
crates(1560, 300, 3, 0, -20)
# the checkpoint terminal: destroy it to open the gate (not required for the exit)
boxes.append(P('game objects/box computer', yard_n_mid[0], block(1, 0)[1] + 60, props={'onDie': {'$trigger': 'door1:open'}}))


BRIEFING = {
    'title': 'URBAN',
    'body': ("Good news: the tanks now obey traffic laws. Bad news:\n"
             "you are the traffic. The robots have rezoned downtown\n"
             "as one big patrol route: sentry tanks drive loops round\n"
             "the blocks and scouts nest in the courtyards. Your way\n"
             "out is the checkpoint in the north-east. Find the\n"
             "checkpoint terminal and destroy it -- the gate opens for\n"
             "anyone, as long as nobody is asking questions."),
    'captions': [
        {'style': 'name', 'text': 'Sentry Tank', 'x': 636.45, 'y': 209.89},
        {'style': 'note', 'text': 'Patrols the streets.', 'x': 636.45, 'y': 316.6},
        {'style': 'name', 'text': 'Scout', 'x': 636.48, 'y': 359.89},
        {'style': 'note', 'text': 'Fast. Fragile. Rude.', 'x': 636.45, 'y': 426.6},
    ],
    'graphics': [
        {'symbol': 'enemy assets/enemy tank treads', 'x': 636.5, 'y': 270.5},
        {'symbol': 'enemy assets/enemy tank core', 'x': 636.5, 'y': 271},
        {'symbol': 'enemy assets/enemy tank turret', 'x': 636.55, 'y': 272.55},
        {'symbol': 'enemy assets/designs/dart', 'x': 636.5, 'y': 396, 'matrix': [-1.5, 0, 0, -1.5]},
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
        # no vision zones: enemies see by their visionRange (default 420) and line of sight
        'vision.json': '[]\n',
    }
    for name, text in files.items():
        with open(os.path.join(a.out, name), 'w', encoding='utf-8', newline='\n') as f: f.write(text)
    lj = os.path.join(a.out, 'level.json')
    settings = json.load(open(lj)) if os.path.exists(lj) else {}
    settings['size'] = {'w': W, 'h': H}
    settings.pop('sightRange', None)                # sight range is an enemy setting (visionRange) now
    # the city art kit; paved = areas with paving all over instead of road (plaza, courtyards, exit square)
    settings.setdefault('art', {'kit': 'city', 'seed': 404})
    settings['art'].setdefault('paved', [[num(v) for v in r] for r in PAVED])
    with open(lj, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n' + ',\n'.join(f'  {json.dumps(k)}: {pretty(v, "  ")}' for k, v in settings.items()) + '\n}\n')
    bj = os.path.join(a.out, 'briefing.json')
    if not os.path.exists(bj):  # written once, then edited by hand or in the editor
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
        col = {'wall': (30, 30, 30), 'chasm': (140, 140, 160), 'open': (235, 235, 235)}[s['mode']]
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
        r = {TANK: 16, SCOUT: 8, BATTERY: 18, WOLFGUN: 12}.get(e['symbol'], 9)
        col = {TANK: (200, 60, 0), SCOUT: (180, 0, 200), SCURGE: (120, 120, 0), BARREL: (255, 0, 0)}.get(e['symbol'], (220, 180, 0))
        d.ellipse([e['x'] - r, e['y'] - r, e['x'] + r, e['y'] + r], fill=col)
    for p in pick:
        col = (0, 160, 255) if p['props']['type'] != 'trigger' else (120, 220, 120)
        d.rectangle([p['x'] - 6, p['y'] - 6, p['x'] + 6, p['y'] + 6], outline=col, width=2)
    for b in boxes: d.rectangle([b['x'] - 8, b['y'] - 8, b['x'] + 8, b['y'] + 8], fill=(150, 110, 60))
    for o in doors: d.rectangle([o['x'] - 28, o['y'] - 6, o['x'] + 28, o['y'] + 6], fill=(0, 200, 200))
    for f in features: d.ellipse([f['x'] - 20, f['y'] - 20, f['x'] + 20, f['y'] + 20], outline=(0, 160, 0), width=4)
    im.save(path)


if __name__ == '__main__':
    main()

"""Level 09 Complex: the first-draft layout, written as the standard level files.

    python tools/levels/09_Complex/layout.py                     # writes levels/09_Complex/*.json (not the art)
    python tools/levels/09_Complex/layout.py --preview out.png   # also a quick schematic PNG

A one-off tool for this level (each map is its own task, see the level plan). The plan's idea:
"Lab wings climbing to a lift. Hunters on path networks. Rock and earth with metal lab rooms."

The map is a research complex dug into the rock, climbed from the bottom to the top:

    LIFT HALL          the lift platform (exit) in its shaft, the final room          y   30-260
    UPPER LABS         Server Vault (west) -- spine -- Drone Bay (east)               y  330-620
    THE CLIMB          a rock cavern round a fissure, two grottos, tunnels up        y  700-1050
    LOWER LABS         Specimen Lab (west) -- Decon Atrium -- Robotics Workshop      y 1080-1430
    DIG SITE           the rock cavern you arrive in                                  y 1500-1740

Everything starts as solid rock and the rooms, caves and tunnels are carved out of it, so
every room, wall island and tunnel is its own shape in the editor's shape stack. Lab rooms
are drawn in metal by the art bake (level.json art.metal, the rectangles listed in LABS);
the caves stay rock.

Each lab wing has its own path-node colour, so its Lab Hunters roam that wing (hunter +
wanderer) and converge on you when any of them sees you, but only while you're somewhere the
wing's nodes can see: hunters stay in their own wing. Two bulkheads gate the climb: the
Workshop's terminal opens the one out of the Atrium, the Drone Bay's opens the Lift Hall.

Re-running this overwrites hand edits in the files it writes, so once the level has been
tuned in the editor, don't run it again (or use --out to write elsewhere).
"""
import argparse
import json
import math
import os
import random

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FOLDER = '09_Complex'
W, H = 1600, 1760

rng = random.Random(909)


# ---------------------------------------------------------------- shapes
def num(v):
    v = round(v, 2)
    return int(v) if float(v).is_integer() else v


def poly_d(pts):
    return 'M ' + ' L '.join(f'{num(x)} {num(y)}' for x, y in pts) + ' Z'


def chamfer_rect(x0, y0, x1, y1, c=8):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def blob(cx, cy, rx, ry, n=16, jitter=0.12):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rng.uniform(-jitter, jitter)
        pts.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k))
    return pts


def tunnel(pts, w, jitter=6):
    """A rock tunnel along a polyline: a rough-edged band w wide (an outline, not a union)."""
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        h1 = w / 2 + rng.uniform(-jitter, jitter)
        h2 = w / 2 + rng.uniform(-jitter, jitter)
        left.append((x + nx * h1, y + ny * h1))
        right.append((x - nx * h2, y - ny * h2))
    return left + right[::-1]


shapes = []          # collision.json, bottom first (after the white base)


def add(name, pts, mode='wall', group=None, d=None):
    s = {'name': name, 'mode': mode, 'd': d or poly_d(pts)}
    if group: s['group'] = group
    shapes.append(s)


LABS = []            # lab floor rectangles, drawn as metal by the art bake


def room(name, x0, y0, x1, y1, group, c=8, metal=True):
    add(name, chamfer_rect(x0, y0, x1, y1, c), 'open', group)
    if metal: LABS.append([x0, y0, x1, y1])


def opening(name, x0, y0, x1, y1, group, metal=True):
    add(name, rect(x0, y0, x1, y1), 'open', group)
    if metal: LABS.append([x0, y0, x1, y1])


def pillar(name, cx, cy, w, h, group, c=5):
    add(name, chamfer_rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, c), 'wall', group)


def tank(name, cx, cy, r, group):
    """A round specimen tank or column: a 12-gon."""
    add(name, [(cx + r * math.cos(2 * math.pi * i / 12), cy + r * math.sin(2 * math.pi * i / 12)) for i in range(12)], 'wall', group)


# the bedrock: the whole map starts solid
add('bedrock', rect(0, 0, W, H), 'wall', 'rock')

# ---- DIG SITE (south): a rough cavern the drill broke into
G = 'dig site'
add('dig site cavern', blob(800, 1628, 470, 102, 24, 0.08), 'open', G)
add('dig site west pocket', blob(372, 1596, 118, 86, 14, 0.12), 'open', G)
add('dig site east pocket', blob(1232, 1652, 130, 78, 14, 0.12), 'open', G)
add('dig site entry', blob(800, 1700, 90, 46, 12, 0.08), 'open', G)
add('excavation pit', blob(640, 1574, 62, 26, 12, 0.15), 'chasm', G)
for k, (x, y, rx, ry) in enumerate(((560, 1660, 30, 24), (1010, 1596, 38, 28), (452, 1640, 20, 18), (1120, 1694, 24, 18), (930, 1668, 18, 15))):
    add(f'boulder {k + 1}', blob(x, y, rx, ry, 9, 0.25), 'wall', G)
# the airlock up into the lower labs
opening('airlock', 765, 1412, 835, 1545, 'lower labs')
# rock spurs either side of the entry, so the drop-in point is a quiet pocket that only looks
# north at the airlock and a gun or two, not out across the whole cavern (fixed points, so the
# shapes above keep their random outlines)
for name, sx in (('entry spur west', 690), ('entry spur east', 910)):
    add(name, [(sx + math.cos(2 * math.pi * i / 10) * 38 * (1, 0.86, 1.08, 0.92, 1.04)[i % 5],
                1702 + math.sin(2 * math.pi * i / 10) * 40 * (1, 0.86, 1.08, 0.92, 1.04)[i % 5]) for i in range(10)], 'wall', G)
ENTRANCE = (800, 1700)

# ---- LOWER LABS (y 1080-1430)
G = 'lower labs'
ATRIUM = (660, 1090, 940, 1420)
room('decon atrium', *ATRIUM, G, c=14)
for k, (x, y) in enumerate(((728, 1180), (872, 1180), (728, 1330), (872, 1330))):
    pillar(f'atrium pillar {k + 1}', x, y, 28, 28, G)
# bulkhead 1: out of the atrium to the climb, a 54 px throat for the door
opening('bulkhead 1 throat', 773, 1040, 827, 1096, G)
DOOR1 = (800, 1066)

# west wing: the Specimen Lab. A corridor with two rooms either side, all looped together
G = 'specimen lab'
opening('specimen corridor', 110, 1222, 666, 1290, G)
SL = {'R1': (110, 1082, 350, 1192), 'R2': (390, 1082, 630, 1192), 'R3': (110, 1320, 350, 1424), 'R4': (390, 1320, 630, 1424)}
for k, r in SL.items(): room(f'specimen room {k}', *r, G)
for name, r in (('R1 door', (196, 1186, 252, 1228)), ('R2 door', (484, 1186, 540, 1228)), ('R3 door', (258, 1284, 314, 1326)),
                ('R4 door', (430, 1284, 486, 1326)), ('R1-R2 door', (344, 1112, 396, 1168)), ('R3-R4 door', (344, 1346, 396, 1402))):
    opening(f'specimen {name}', *r, G)
for k, (x, y) in enumerate(((140, 1110), (180, 1110), (300, 1110), (430, 1110), (590, 1110), (140, 1396), (590, 1396), (430, 1396))):
    tank(f'specimen tank {k + 1}', x, y, 13, G)

# east wing: the Robotics Workshop. One hall with assembly lines, two store rooms below
G = 'robotics workshop'
opening('workshop corridor', 934, 1222, 1000, 1290, G)
HALL = (990, 1082, 1490, 1292)
room('workshop hall', *HALL, G, c=12)
pillar('assembly line west', 1130, 1156, 150, 16, G, 4)
pillar('assembly line east', 1350, 1156, 150, 16, G, 4)
pillar('press 1', 1100, 1236, 30, 30, G)
pillar('press 2', 1240, 1236, 30, 30, G)
pillar('press 3', 1380, 1236, 30, 30, G)
S1, S2 = (990, 1322, 1222, 1424), (1262, 1322, 1490, 1424)
room('store room 1', *S1, G)
room('store room 2', *S2, G)
for name, r in (('store 1 door', (1078, 1286, 1134, 1328)), ('store 2 door', (1398, 1286, 1454, 1328)), ('store 1-2 door', (1216, 1346, 1268, 1402))):
    opening(f'workshop {name}', *r, G)

# ---- THE CLIMB (y 700-1050): rock caverns between the two lab levels
G = 'the climb'
add('climb throat', tunnel([(800, 1046), (796, 1000), (806, 960)], 86, 4), 'open', G)
add('climb cavern', blob(800, 860, 330, 150, 26, 0.07), 'open', G)
add('the fissure', blob(800, 852, 196, 42, 18, 0.12), 'chasm', G)
add('north-west tunnel', tunnel([(560, 770), (500, 716), (430, 676), (428, 628)], 84), 'open', G)
add('north-east tunnel', tunnel([(1040, 770), (1100, 716), (1172, 676), (1172, 628)], 84), 'open', G)
add('west grotto tunnel', tunnel([(490, 900), (420, 906), (370, 900)], 74), 'open', G)
add('west grotto', blob(290, 900, 116, 82, 14, 0.12), 'open', G)
add('east grotto tunnel', tunnel([(1110, 880), (1180, 870), (1230, 874)], 74), 'open', G)
add('east grotto', blob(1310, 870, 120, 90, 14, 0.12), 'open', G)
for k, (x, y, rx, ry) in enumerate(((596, 952, 24, 20), (1006, 952, 26, 20), (640, 752, 18, 16), (990, 760, 28, 22), (300, 860, 22, 18), (1330, 920, 24, 18))):
    add(f'cave boulder {k + 1}', blob(x, y, rx, ry, 9, 0.25), 'wall', G)

# ---- UPPER LABS (y 330-620)
G = 'server vault'
VAULT = (130, 330, 690, 620)
room('server vault', *VAULT, G, c=14)
opening('vault entry', 398, 612, 458, 650, G)
RACKS = [230, 310, 390, 470, 550, 630]
for k, x in enumerate(RACKS):
    pillar(f'server rack {k + 1}', x, 470, 18, 176 if k % 2 else 150, G, 3)
G = 'drone bay'
BAY = (910, 330, 1470, 620)
room('drone bay', *BAY, G, c=14)
opening('bay entry', 1142, 612, 1202, 650, G)
pillar('cargo stack west', 1030, 436, 62, 30, G)
pillar('cargo stack east', 1356, 436, 62, 30, G)
pillar('cargo stack south', 1200, 548, 80, 28, G)
add('maintenance pit', chamfer_rect(1150, 384, 1250, 470, 10), 'chasm', G)
G = 'spine'
opening('spine corridor', 684, 440, 916, 510, G)
opening('lift corridor', 765, 286, 835, 446, G)
opening('bulkhead 2 throat', 773, 250, 827, 292, G)
DOOR2 = (800, 270)

# ---- LIFT HALL (y 30-260): the final room
G = 'lift hall'
LIFT = (320, 30, 1280, 258)
room('lift hall', *LIFT, G, c=18)
add('lift shaft', chamfer_rect(636, 52, 964, 196, 10), 'chasm', G)
for name, r in (('lift platform', (704, 84, 896, 166)), ('lift bridge south', (772, 160, 828, 202)),
                ('lift bridge west', (630, 104, 710, 146)), ('lift bridge east', (890, 104, 970, 146))):
    opening(name, *r, G)
for k, (x, y) in enumerate(((470, 96), (470, 196), (1130, 96), (1130, 196))):
    pillar(f'lift hall column {k + 1}', x, y, 30, 30, G)
EXIT = (800, 125)


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


features = [
    P('game objects/entrance_mc', *ENTRANCE, name='entrance_mc'),
    P('game objects/exit_mc', *EXIT, name='exit_mc', props={'lock': 'exit:open'}),
]

# Path nodes. One colour per lab wing; no connections listed, so the game links each node to
# every same-coloured node it can see. Hunters pick random nodes of their colour to roam to,
# and path to you over them when one of them spots you.
GROUPS = {'red': [255, 0, 0, 0], 'blue': [0, 0, 255, 0], 'green': [0, 200, 0, 0], 'purple': [160, 0, 255, 0], 'cyan': [0, 220, 220, 0]}
nodes = []


def net(group, pts):
    for x, y in pts:
        nodes.append(P('game objects/node', x + len(nodes) % 2, y, name=f'n{len(nodes) + 1}', color={'multiply': [0, 0, 0, 1], 'add': GROUPS[group]}))
    g = GROUPS[group]
    return (g[0] << 16) | (g[1] << 8) | g[2]


def cx(r): return (r[0] + r[2]) / 2


def cy(r): return (r[1] + r[3]) / 2


# specimen lab (red): the corridor, each room, each doorway from both sides
RED = net('red', [(140, 1256), (228, 1256), (370, 1256), (512, 1256), (630, 1256),
                  (228, 1150), (cx(SL['R1']), 1160), (312, 1160), (370, 1140), (420, 1150), (512, 1160), (600, 1160),
                  (140, 1360), (286, 1356), (370, 1374), (458, 1356), (cx(SL['R4']), 1370), (600, 1372)])
# robotics workshop (blue): the hall in two lanes either side of the assembly lines, the store rooms
BLUE = net('blue', [(966, 1256), (1030, 1262), (1170, 1262), (1310, 1262), (1450, 1262),
                    (1030, 1116), (1240, 1116), (1450, 1116), (1240, 1196), (1030, 1196), (1450, 1196),
                    (1106, 1350), (1040, 1380), (1180, 1390), (1242, 1374), (1300, 1390), (1426, 1350), (1450, 1394)])
# server vault (green): the cross aisles and every aisle between the racks
GREEN = net('green', [(170, 362), (170, 470), (170, 590), (428, 590)]
            + [(x, y) for x in (270, 350, 430, 510, 590, 660) for y in (362, 470, 590)] + [(700, 476), (760, 476)])
# drone bay (purple): round the pit and the cargo, plus the spine
PURPLE = net('purple', [(1172, 590), (950, 590), (950, 470), (950, 370), (1100, 362), (1300, 362), (1430, 370),
                        (1430, 480), (1430, 590), (1300, 590), (1100, 500), (1300, 500), (1100, 590), (900, 476), (840, 476)])
# lift hall (cyan): both flanks and the strip south of the shaft
CYAN = net('cyan', [(360, 60), (360, 146), (360, 228), (560, 70), (560, 146), (560, 228), (700, 228), (800, 228), (900, 228),
                    (1040, 228), (1040, 146), (1040, 70), (1240, 60), (1240, 146), (1240, 228), (800, 184)])

TURRET_SET = ('stinger', 'stinger2', 'stinger3', 'wolfgun', 'double battery')
EA = 'enemy assets/'
STINGER, STINGER2, STINGER3 = EA + 'enemy stinger', EA + 'enemy stinger2', EA + 'enemy stinger3'
WOLFGUN, BATTERY = EA + 'enemy wolfgun', EA + 'enemy double battery'
SCURGE, BARREL = EA + 'enemy scurge', EA + 'enemy object fire barrel'
HUNTER, MEDIC = EA + 'enemy lab hunter', EA + 'enemy repair drone'

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


def hunter(x, y, path, rot=0, **props):
    E(HUNTER, x, y, rot=rot, props=dict({'pathID': path}, **props))


# --- dig site: a gentle start, guns in the rock pockets
E(STINGER, 320, 1560)
E(STINGER, 1250, 1604)
E(WOLFGUN, 1010, 1550)
tri(520, 1600)
tri(1100, 1640, down=True)
tri(1240, 1632)
grid(300, 1620, 2, 2)
E(BARREL, 1180, 1610)
E(BARREL, 700, 1640)
# --- decon atrium: crossfire from the pillars, scurge on the decon grid
E(STINGER, 690, 1120)
E(STINGER, 910, 1120)
E(STINGER2, 800, 1250)
grid(800, 1380, 3, 1)
# --- specimen lab (red): three hunters roam it; a stinger3 guards the Pulse Cannon in R1
hunter(512, 1256, RED, rot=-90)
hunter(cx(SL['R3']) - 40, 1370, RED, rot=90)
hunter(cx(SL['R2']) + 40, 1140, RED, rot=180)
E(STINGER3, 140, 1162)
E(STINGER, 600, 1140)
E(STINGER, 140, 1316 + 34)
tri(cx(SL['R4']), 1380)
tri(380, 1256, down=True)
E(WOLFGUN, 130, 1256)
# --- robotics workshop (blue): hunters, a repair drone and the terminal in store room 2
hunter(1170, 1262, BLUE, rot=90)
hunter(1450, 1116, BLUE, rot=180)
hunter(1040, 1380, BLUE, rot=-90)
E(MEDIC, 1300, 1210)
E(WOLFGUN, 1240, 1116)
E(STINGER2, 1020, 1110)
E(STINGER2, 1460, 1262)
grid(1106, 1384, 3, 2)
E(STINGER3, 1460, 1396)
tri(1330, 1116)
# --- the climb: guns in the rock round the fissure, scurge on the ledges, the grottos
E(WOLFGUN, 800, 740)
E(WOLFGUN, 800, 990)
E(STINGER, 560, 820)
E(STINGER, 1040, 900)
E(STINGER2, 640, 930)
tri(700, 960)
tri(920, 960)
tri(700, 760, down=True)
tri(920, 760, down=True)
E(BARREL, 520, 880)
E(BARREL, 1080, 840)
E(STINGER2, 230, 880)
tri(300, 940)
E(STINGER3, 1370, 840)
grid(1262, 905, 2, 2)
E(STINGER, 440, 700)
E(STINGER, 1160, 700)
# --- server vault (green): four hunters in the aisles, a stinger3 on the Shock Bomb
hunter(270, 470, GREEN, rot=0)
hunter(430, 362, GREEN, rot=90)
hunter(590, 590, GREEN, rot=-90)
hunter(170, 590, GREEN, rot=0)
E(STINGER3, 160, 420)
E(STINGER, 660, 362)
E(STINGER, 350, 600)
tri(510, 470)
tri(350, 470, down=True)
# --- drone bay (purple): hunters, two repair drones, the bay's guns and its terminal
hunter(950, 470, PURPLE, rot=0)
hunter(1300, 590, PURPLE, rot=-90)
hunter(1430, 480, PURPLE, rot=180)
E(MEDIC, 1100, 540)
E(MEDIC, 1340, 380)
E(BATTERY, 1200, 362, rot=180)
E(WOLFGUN, 1350, 600)
E(STINGER2, 940, 600)
grid(1300, 500, 3, 2)
tri(1080, 380)
# spine and lift corridor
E(STINGER, 800, 420)
E(STINGER2, 800, 330)
# --- lift hall: the final room. Batteries either side of the shaft, hunters and a medic on
# both flanks, packed scurge, buffed stingers on the platform corners
E(BATTERY, 590, 236)
E(BATTERY, 1010, 236)
E(STINGER3, 720, 96)
E(STINGER3, 880, 96)
E(WOLFGUN, 360, 236)
E(WOLFGUN, 1240, 236)
hunter(560, 146, CYAN, rot=90)
hunter(1040, 146, CYAN, rot=-90)
hunter(360, 146, CYAN, rot=90)
E(MEDIC, 1180, 146)
E(MEDIC, 420, 146)
grid(400, 70, 3, 2)
grid(1200, 70, 3, 2)
grid(560, 220, 2, 1)
grid(1040, 220, 2, 1)

# pickups
pick = []


def pickup(x, y, type_, item, q, **kw):
    pick.append(P('game objects/powerup', x, y, props=dict({'type': type_, 'item': item, 'quantity': q}, **kw)))


def beacon(x, y, text):
    pick.append(P('game objects/message beacon', x, y, props={'alertMessage': text, 'persistent': True}))


beacon(800, 1650, "Lab wings ahead. Their <strong>LAB HUNTERS</strong> roam each wing and come running when one of them sees you. "
                  "The atrium bulkhead opens from the workshop terminal, east.")
beacon(800, 300, "Lift Hall sealed. The Drone Bay terminal, east, opens it.")
pickup(250, 1136, 'primary', 'Pulse', 100)          # specimen room R1, past the stinger3
pickup(170, 1240, 'health', 'health', 25)
pickup(1200, 1400, 'primary', 'Pulse', 60)
pickup(1040, 1120, 'health', 'health', 50)
pickup(200, 470, 'secondary', 'Shock Bomb', 1)   # the server vault's far end
pickup(170, 540, 'health', 'health', 50)
pickup(1440, 420, 'secondary', 'Shock Bomb', 1)
pickup(1430, 540, 'primary', 'Pulse', 60)
pickup(380, 1650, 'primary', 'Bolter', 40)
pickup(1300, 1660, 'secondary', 'Carbon Bomb', 2)
pickup(800, 1150, 'health', 'health', 25)
pickup(250, 920, 'primary', 'Bolter', 40)          # west grotto
pickup(330, 860, 'health', 'health', 50)
pickup(1320, 860, 'primary', 'Pulse', 40)           # east grotto
pickup(1250, 840, 'secondary', 'Carbon Bomb', 2)
pickup(800, 476, 'health', 'health', 50)            # the spine
pickup(800, 384, 'secondary', 'Shock Bomb', 1)      # under the lift hall bulkhead, for the final room
pickup(560, 92, 'health', 'health', 50)             # in the final room, if you get that far
pickup(1040, 92, 'primary', 'Pulse', 60)
pickup(800, 1590, 'primary', 'Bolter', 30)

# the bulkheads, opened by the terminals
doors = [P('game objects/door', *DOOR1, rot=90, props={'id': 'door1'}),
         P('game objects/door', *DOOR2, rot=90, props={'id': 'door2'})]


def lab_door(id_, x, y, width, pads):
    """A door across a vertical passage `width` px wide (the door is drawn 50 wide, so it's
    stretched to fit) that opens as the player comes up to it, as the Bridge's doors do: a
    trigger pad (an invisible pickup) at each (y, triggers) in `pads`."""
    s = (width + 2) / 50
    doors.append({'symbol': 'game objects/door', 'x': num(x), 'y': num(y), 'matrix': [0, 0.8, num(-s * 1e4) / 1e4, 0], 'props': {'id': id_}})
    for py, trig in pads:
        for t in ([trig] if isinstance(trig, str) else trig):
            pick.append(P('game objects/powerup', x, py, scale=[num(width / 26 * 1e3) / 1e3, 1.2], props={'type': 'trigger', 'item': t}))


# the airlock from the dig site into the labs cycles: the outer door opens as you come up to
# it and shuts behind you once you're inside, then the inner door opens
lab_door('door3', 800, 1510, 70, [(1556, 'door3:open')])
lab_door('door4', 800, 1430, 70, [(1462, ['door4:open', 'door3:close'])])
# the upper wings are sealed from the caves: their doors open as you come up from the tunnels
lab_door('door5', 428, 622, 60, [(664, 'door5:open'), (582, 'door5:open')])
lab_door('door6', 1172, 622, 60, [(664, 'door6:open'), (582, 'door6:open')])

# boxes: lab crates against the walls, specimen and parts stacks. Not required for the exit (the
# lift is the goal), so the crates are just cover and loot.
boxes = []
brng = random.Random(9090)
DROPS = [{'type': 'health', 'item': 'health', 'quantity': 25}, {'type': 'primary', 'item': 'Bolter', 'quantity': 25},
         {'type': 'primary', 'item': 'Pulse', 'quantity': 30}, {'type': 'secondary', 'item': 'Shock Bomb', 'quantity': 1},
         {'type': 'secondary', 'item': 'Carbon Bomb', 'quantity': 1}, {'type': 'primary', 'item': 'Plasma', 'quantity': 10},
         {'type': 'primary', 'item': 'Vertigo', 'quantity': 30}]


def crates(x, y, n, dx=20, dy=0, drop=None):
    for k in range(n):
        o = P('game objects/box', x + k * dx, y + k * dy, props={'required': False})
        if drop is not False and k == n // 2 and (drop or brng.random() < 0.45):
            o['scale'] = 1.285706
            o['props'] = {'required': False, 'health': 25, 'powerupDrop': drop or brng.choice(DROPS)}
        boxes.append(o)


def stack(x, y):
    for dx in (0, 20):
        crates(x + dx, y, 2, 0, 20, drop=False)


# dig site: mining crates
crates(470, 1678, 4)
crates(1050, 1566, 4, drop={'type': 'health', 'item': 'health', 'quantity': 25})
stack(400, 1540)
stack(1270, 1615)
crates(588, 1708, 3)
crates(972, 1706, 3)
# atrium: decon lockers along the walls
crates(688, 1250, 4, 0, 20)
crates(912, 1250, 4, 0, 20)
crates(740, 1404, 3)
# specimen lab
crates(150, 1300 - 70, 1, drop=False)
crates(410, 1176, 4)
crates(180, 1404, 3)
crates(536, 1340, 4)
stack(590, 1236 - 4)
crates(240, 1176, 3)
# workshop: parts crates along the lines and in the stores
crates(1070, 1186, 4)
crates(1290, 1186, 4)
crates(1010, 1340, 3, 0, 20)
crates(1160, 1340, 3, 0, 20)
crates(1290, 1408, 4)
stack(1460, 1340)
crates(1010, 1098, 4)
# the climb
crates(650, 984, 3)
crates(842, 742, 2)
stack(240, 940)
stack(1360, 880)
crates(790, 1010, 1, drop={'type': 'primary', 'item': 'Pulse', 'quantity': 30})
# server vault: spare drives between the racks
for x in (270, 430, 590):
    crates(x, 400, 3, 0, 22)
crates(330, 350, 3)
crates(560, 610, 3)
stack(650, 575)
# drone bay
crates(1000, 400, 3)
crates(1340, 470, 3)
crates(1160, 600, 4)
stack(1430, 344)
crates(940, 350, 2, 0, 20)
# spine
crates(700, 456, 2, 0, 22)
crates(890, 456, 2, 0, 22)
# lift hall
crates(340, 110, 3, 0, 22)
crates(1258, 110, 3, 0, 22)
crates(660, 230, 2)
crates(920, 230, 2)
# the terminals: destroy them to open the bulkheads
boxes.append(P('game objects/box computer', 1376, 1352, props={'onDie': {'$trigger': 'door1:open'}}))
boxes.append(P('game objects/box computer', 1440, 600 - 8, props={'onDie': {'$trigger': ['door2:open', 'exit:open']}}))


BRIEFING = {
    'title': 'COMPLEX',
    'body': ("You made it underground. Now climb out. The robots\n"
             "built a research complex into the rock: specimen labs,\n"
             "a robotics workshop, a server vault and a drone bay,\n"
             "stacked floor on floor up to the surface lift. Mind\n"
             "the lab staff; they have been optimized. Lab Hunters\n"
             "roam every wing and come together when one finds you.\n"
             "Two bulkheads stand in the way. Their terminals don't."),
    'captions': [
        {'style': 'name', 'text': 'Lab Hunter', 'x': 636.45, 'y': 209.89},
        {'style': 'note', 'text': 'Stun shots. Travels in packs.', 'x': 636.45, 'y': 316.6},
        {'style': 'name', 'text': 'Repair Drone', 'x': 636.48, 'y': 359.89},
        {'style': 'note', 'text': 'Fixes robots. Shoot it first.', 'x': 636.45, 'y': 426.6},
    ],
    'graphics': [
        {'symbol': 'enemy assets/designs/hauler', 'x': 636.5, 'y': 272, 'matrix': [-1.6, 0, 0, -1.6]},
        {'symbol': 'enemy assets/enemy repair drone body', 'x': 636.5, 'y': 396, 'scale': 1.3},
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
# the new weapons' intro messages are on their definitions in as2/player.as (shown on first pickup)


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
    }
    for name, text in files.items():
        with open(os.path.join(a.out, name), 'w', encoding='utf-8', newline='\n') as f: f.write(text)
    lj = os.path.join(a.out, 'level.json')
    settings = json.load(open(lj)) if os.path.exists(lj) else {}
    settings['size'] = {'w': W, 'h': H}
    # rock and earth, with the lab rooms in metal (the art bake's metal option)
    settings.setdefault('art', {'kit': 'rock', 'seed': 909})
    settings['art']['metal'] = [[num(v) for v in r] for r in LABS]
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
    """A schematic: rock, rooms, chasms, node networks, enemies and pickups."""
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
        col = {'wall': (40, 34, 30), 'chasm': (120, 110, 130), 'open': (225, 222, 215)}[s['mode']]
        for p in polys(s['d']): d.polygon(p, fill=col)
    for r in LABS: d.rectangle(r, outline=(120, 150, 180))
    for n in nodes:
        c = tuple(n['color']['add'][:3])
        d.ellipse([n['x'] - 4, n['y'] - 4, n['x'] + 4, n['y'] + 4], fill=c)
    for e in enemies:
        s = e['symbol']
        r = {HUNTER: 11, MEDIC: 9, BATTERY: 18, WOLFGUN: 12}.get(s, 8)
        col = {HUNTER: (230, 120, 30), MEDIC: (40, 200, 90), SCURGE: (120, 120, 0), BARREL: (255, 0, 0)}.get(s, (220, 180, 0))
        d.ellipse([e['x'] - r, e['y'] - r, e['x'] + r, e['y'] + r], fill=col)
    for p in pick:
        d.rectangle([p['x'] - 6, p['y'] - 6, p['x'] + 6, p['y'] + 6], outline=(0, 160, 255), width=2)
    for b in boxes: d.rectangle([b['x'] - 8, b['y'] - 8, b['x'] + 8, b['y'] + 8], fill=(150, 110, 60))
    for o in doors: d.rectangle([o['x'] - 28, o['y'] - 6, o['x'] + 28, o['y'] + 6], fill=(0, 200, 200))
    for f in features: d.ellipse([f['x'] - 20, f['y'] - 20, f['x'] + 20, f['y'] + 20], outline=(0, 160, 0), width=4)
    im.save(path)


if __name__ == '__main__':
    main()

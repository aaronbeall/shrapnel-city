"""Level 10 Interface: the first-draft layout, written as the standard level files.

    python tools/levels/10_Interface/layout.py                  # writes levels/10_Interface/*.json
    python tools/levels/10_Interface/layout.py --preview out.png   # also a schematic PNG

A one-off tool for this level (each map is its own task). The plan's idea: tight corridors
with hazard floors, hunters woken by alarms; trap tiles and alarm panels; the metal kit in a
red-alert grade with chasms. The map is the robots' network interface hub, carved out of solid
rock and steel, in six parts played roughly in order:

  Intake (SW)          the drop-off bay; the first timed floor grid on the way out
  Server Hall (W)      four rows of server racks, a sentinel walking a loop round two of them,
                       an alarm panel on the west wall, a hunter dock in the north-east corner;
                       the Arc Caster sits at the end of a rack aisle
  Data Bus (N)         one long straight corridor with three timed grids and a laser turret at
                       the far end; alcoves to duck into between its shots
  Cooling Trench (C)   a deep cooling channel crossed by two catwalks, a laser turret on a
                       pillar in the middle; its alarm (panel and sentinel) electrifies the
                       catwalks for a while
  Switching Yard (SE)  a grid of switch cabinets with timed grids in its lanes, a breaker box
                       that shuts them down, and the uplink terminal that opens the core door;
                       Pulse Bombs on the far side
  Core (NE)            the Interface itself: an octagonal chamber round a core inside a
                       cooling moat; the final fight and the exit

Every alarm (any panel or sentinel) wakes every hunter (scouts on the green path network) and
sends its own group's ":alarm" to the floor grids nearby. Kill the watchers first, or don't
be seen.

It writes collision.json (one vector shape per room, rack, cabinet and moat, so the editor can
move any of them), features, pathNodes, enemies, boxes, powerups, doors (the core door and
the hall and yard lockdown doors, every trap tile), vision (one zone per room),
level.json and briefing.json. collision.png is baked from collision.json by
tools/levels/bake_collision.mjs, background.png by tools/art/bake.py.
Re-running overwrites hand edits in those files.
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
FOLDER = '10_Interface'
W, H = 1680, 1200

rng = random.Random(1010)


# ---------------------------------------------------------------- shapes
def num(v):
    v = round(v, 2)
    return int(v) if float(v).is_integer() else v


def poly_d(pts):
    return 'M ' + ' L '.join(f'{num(x)} {num(y)}' for x, y in pts) + ' Z'


def chamfer_rect(x0, y0, x1, y1, c=8):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def rect(x0, y0, x1, y1): return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def octagon(cx, cy, r):
    return chamfer_rect(cx - r, cy - r, cx + r, cy + r, r * 0.41)


shapes = []


def add(name, pts, mode='wall', group=None, holes=()):
    d = poly_d(pts) + ''.join(' ' + poly_d(h) for h in holes)
    s = {'name': name, 'mode': mode, 'd': d}
    if group: s['group'] = group
    shapes.append(s)


# solid ground everywhere; the complex is carved out of it
add('bedrock', rect(0, 0, W, H))

# --- rooms and corridors (open floor), west to east
INTAKE = (60, 900, 380, 1140)
HALL = (60, 280, 620, 820)
DOCK = (420, 170, 620, 290)
BUS = (60, 60, 1180, 140)
TRENCH = (680, 140, 1120, 1140)
YARD = (1160, 620, 1640, 1100)
CORE = (1220, 60, 1640, 540)
add('intake', chamfer_rect(*INTAKE, 16), 'open', 'intake')
add('intake corridor', rect(280, 800, 360, 920), 'open', 'intake')
add('server hall', chamfer_rect(*HALL, 16), 'open', 'server hall')
add('hunter dock', chamfer_rect(*DOCK, 10), 'open', 'server hall')
add('hall to bus', rect(100, 120, 180, 300), 'open', 'data bus')
add('data bus', chamfer_rect(*BUS, 10), 'open', 'data bus')
# alcoves off the bus to hide from the laser turret at its east end
ALCOVES = [(240, 300, 'S'), (470, 530, 'N'), (870, 930, 'N'), (1010, 1070, 'N')]
for k, (a, b, side) in enumerate(ALCOVES):
    add(f'bus alcove {k + 1}', chamfer_rect(a, 140 - 6, b, 184, 6) if side == 'S' else chamfer_rect(a, 26, b, 66, 6), 'open', 'data bus')
add('cooling trench', chamfer_rect(*TRENCH, 12), 'open', 'cooling trench')
add('trench to yard', rect(1110, 1020, 1170, 1100), 'open', 'switching yard')
add('switching yard', chamfer_rect(*YARD, 12), 'open', 'switching yard')
add('core corridor', rect(1320, 520, 1400, 640), 'open', 'core')
add('core', chamfer_rect(*CORE, 40), 'open', 'core')

# --- the server racks: four rows of cabinets, the middle two with a crossing gap
RACKS = []
for k, x in enumerate((140, 260, 380, 500)):
    if k in (1, 2):
        RACKS += [(x, 380, x + 40, 530), (x, 590, x + 40, 720)]
    else:
        RACKS.append((x, 380, x + 40, 720))
for k, r in enumerate(RACKS):
    add(f'rack {k + 1}', chamfer_rect(*r, 5), 'wall', 'server racks')

# --- the trench: the channel (chasm), the banks blocked off in turn, two catwalks, the pillar
CH = (760, 220, 1040, 1100)
add('cooling channel', chamfer_rect(*CH, 10), 'chasm', 'cooling trench')
add('west bank end', rect(680, 920, 760, 1140), 'wall', 'cooling trench')
add('east bank end', rect(1040, 140, 1120, 470), 'wall', 'cooling trench')
CAT1, CAT2 = (760, 480, 1040, 544), (760, 840, 1040, 904)
add('catwalk north', rect(*CAT1), 'open', 'cooling trench')
add('catwalk south', rect(*CAT2), 'open', 'cooling trench')
PILLAR = (900, 692)
add('pillar', octagon(*PILLAR, 30), 'open', 'cooling trench')

# --- the yard: a grid of switch cabinets with 80 px lanes between
CABS = [(x, y, x + 80, y + 120) for x in (1240, 1400, 1560) for y in (700, 900)]
for k, r in enumerate(CABS):
    add(f'cabinet {k + 1}', chamfer_rect(r[0], r[1], min(r[2], 1640), r[3], 6), 'wall', 'switching yard')

# --- the core door's jambs (the door spans the 56 px between them)
add('core door jamb west', rect(1320, 572, 1332, 592), 'wall', 'core')
add('core door jamb east', rect(1388, 572, 1400, 592), 'wall', 'core')
# --- the lockdown doors' jambs: the hall's way up to the bus, the trench's way into the yard
add('hall lockdown jamb west', rect(100, 200, 112, 220), 'wall', 'data bus')
add('hall lockdown jamb east', rect(168, 200, 180, 220), 'wall', 'data bus')
add('yard lockdown jamb north', rect(1130, 1020, 1150, 1032), 'wall', 'switching yard')
add('yard lockdown jamb south', rect(1130, 1088, 1150, 1100), 'wall', 'switching yard')

# --- the core: the Interface (a wall octagon) inside its cooling moat (a chasm ring)
CORE_C = (1430, 300)
add('core moat', octagon(*CORE_C, 96), 'chasm', 'core')
add('the interface', octagon(*CORE_C, 50), 'wall', 'core')


# ---------------------------------------------------------------- raster (for checks and links)
def raster():
    """Rough raster of the shape stack: 0 wall, 1 chasm, 2 open (the real map is baked in the
    editor's code by bake_collision.mjs)."""
    im = Image.new('L', (W, H), 2)
    d = ImageDraw.Draw(im)
    val = {'wall': 0, 'chasm': 1, 'open': 2}
    for s in shapes:
        parts = [p for p in s['d'].split('Z') if p.strip()]
        for i, part in enumerate(parts):
            nums = [float(t) for t in part.replace('M', ' ').replace('L', ' ').split()]
            pts = list(zip(nums[0::2], nums[1::2]))
            d.polygon(pts, fill=val[s['mode']] if i == 0 else 2)
    return np.array(im)


# ---------------------------------------------------------------- placements
def P(symbol, x, y, props=None, rot=None, scale=None, name=None, color=None):
    o = {'symbol': symbol, 'x': num(x), 'y': num(y)}
    if rot is not None and rot % 360:
        a = math.radians(rot)
        o['matrix'] = [num(math.cos(a) * 1e4) / 1e4, num(math.sin(a) * 1e4) / 1e4, num(-math.sin(a) * 1e4) / 1e4, num(math.cos(a) * 1e4) / 1e4]
    if scale is not None: o['scale'] = scale
    if name: o['name'] = name
    if color: o['color'] = color
    if props: o['props'] = props
    return o


ENTRANCE = (130, 1070)
EXIT = (1568, 130)
features = [P('game objects/entrance_mc', *ENTRANCE, name='entrance_mc'), P('game objects/exit_mc', *EXIT, name='exit_mc')]

# path nodes. Green: the hunters' network, linked here by walkable line of sight (not over the
# trench: the game's own auto-linking would join nodes across a chasm). Red and blue: the
# sentinels' patrol routes, pinned in order.
GROUPS = {'green': [0, 200, 0, 0], 'red': [255, 0, 0, 0], 'blue': [0, 0, 255, 0], 'yellow': [255, 200, 0, 0]}
GREEN = 0x00C800
nodes, node_n = [], [0]


def node(group, x, y, connections=None):
    node_n[0] += 1
    n = P('game objects/node', x, y, name=f'n{node_n[0]}', color={'multiply': [0, 0, 0, 1], 'add': GROUPS[group]})
    n['_group'] = group
    if connections is not None: n['props'] = {'connections': connections}
    nodes.append(n)
    return n


def route(group, pts, loop=True):
    """A sentinel's patrol: nodes linked in order (every other one nudged 1 px in x, see 04)."""
    ns = [node(group, x + k % 2, y) for k, (x, y) in enumerate(pts)]
    for k, n in enumerate(ns):
        links = []
        if loop or k + 1 < len(ns): links.append({'$ref': ns[(k + 1) % len(ns)]['name']})
        if loop or k > 0: links.append({'$ref': ns[k - 1]['name']})
        n['props'] = {'connections': links}
    return (GROUPS[group][0] << 16) | (GROUPS[group][1] << 8) | GROUPS[group][2]


HUNT = [
    (220, 1020), (320, 960), (320, 860),                                            # intake
    (100, 330), (220, 330), (340, 330), (460, 330), (580, 330),                     # hall top aisle
    (100, 770), (220, 770), (340, 770), (460, 770), (580, 770),                     # hall bottom aisle
    (220, 560), (340, 560), (460, 560), (520, 230),                                 # rack gap, dock
    (140, 210), (140, 100), (400, 100), (720, 100), (1000, 100), (1140, 100),       # bus
    (720, 180), (720, 512), (720, 872), (900, 512), (900, 872),                     # trench west, catwalks
    (1080, 512), (1080, 700), (1080, 872), (1080, 1060), (1140, 1060),              # east bank
    (1200, 660), (1360, 660), (1520, 660), (1600, 660), (1200, 860), (1360, 860), (1520, 860), (1600, 860),
    (1200, 1060), (1360, 1060), (1520, 1060), (1600, 1060),                         # yard lanes
    (1360, 600), (1360, 480), (1270, 420), (1270, 160), (1430, 110), (1590, 180), (1590, 420), (1430, 500),  # core ring
]
green = [node('green', x, y) for x, y in HUNT]
# sentinel routes: the hall loop round racks 3 and 4, the trench's west bank, the yard loop
HALL_LOOP = [(340, 330), (580, 330), (580, 770), (340, 770)]
red = route('red', HALL_LOOP)
BANK = [(720, 180), (720, 512), (720, 872)]
blue = route('blue', BANK, loop=False)
YARD_LOOP = [(1360, 660), (1520, 660), (1520, 860), (1360, 860)]
yellow = route('yellow', YARD_LOOP)

LASER = 'enemy assets/enemy laser turret'
PANEL = 'enemy assets/enemy alarm panel'
SENTINEL = 'enemy assets/enemy alarm sentinel'
SCOUT = 'enemy assets/enemy scout'
STINGER, STINGER2, STINGER3 = 'enemy assets/enemy stinger', 'enemy assets/enemy stinger2', 'enemy assets/enemy stinger3'
WOLFGUN, BATTERY = 'enemy assets/enemy wolfgun', 'enemy assets/enemy double battery'
SCURGE, BARREL = 'enemy assets/enemy scurge', 'enemy assets/enemy object fire barrel'
LAUNCHER = 'enemy assets/enemy missile launcher'

enemies = []


def E(sym, x, y, **kw):
    enemies.append(P(sym, x, y, **kw))


def tri(x, y, s=28, down=False):
    k = -1 if down else 1
    for dx, dy in ((0, -k * s * 0.58), (-s / 2, k * s * 0.29), (s / 2, k * s * 0.29)):
        E(SCURGE, x + dx, y + dy)


def grid(x, y, cols, rows, s=28):
    for i in range(cols):
        for j in range(rows):
            E(SCURGE, x + (i - (cols - 1) / 2) * s, y + (j - (rows - 1) / 2) * s)


def line(x0, y0, x1, y1, n):
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.5
        E(SCURGE, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)


HUNTER = {'hunter': True, 'pathID': GREEN}

# --- intake: a gentle start
E(STINGER, 350, 930)
tri(250, 935)
tri(300, 1080)
E(BARREL, 360, 1120)
# --- server hall: the west panel watches aisle 1 and the bottom aisle; the sentinel walks
# its loop; stingers on the rack ends; scurge filling the aisles
HALL_LOCK = {'alarm': ['hall:alarm', 'door2:close'], 'alarmClear': 'door2:open'}
E(PANEL, 72, 600, rot=90, props=dict(HALL_LOCK))
E(SENTINEL, 340, 330, props={'pathID': red, **HALL_LOCK}, rot=90)
E(STINGER, 160, 360)
E(STINGER, 400, 740)
E(STINGER2, 520, 360)
E(WOLFGUN, 460, 560)
line(100, 420, 100, 520, 3)
line(220, 420, 220, 500, 3)
line(220, 620, 220, 700, 3)
grid(460, 640, 2, 3, s=26)
tri(220, 790, down=True)
grid(460, 450, 1, 3)
# the Arc Caster's aisle end (aisle 4, bottom) is guarded by a stinger3
E(STINGER3, 520, 742)
# hunter dock: three scouts parked, waiting for an alarm
for x in (470, 520, 570):
    E(SCOUT, x, 220, props=dict(HUNTER), rot=180)
# --- data bus: the laser turret at the far end, a stinger in an alcove, scurge in the alcoves
E(LASER, 1140, 100, props={'refireRate': 46})
E(STINGER2, 500, 44)
tri(900, 50, s=24)
grid(1040, 46, 2, 1)
line(520, 122, 580, 122, 3)
E(STINGER, 810, 122)
E(BARREL, 1160, 76)
# --- cooling trench: the north panel looks down the channel, the sentinel walks the west bank,
# the pillar's laser turret sweeps both catwalks, guns on the east bank
E(PANEL, 900, 152, rot=180, props={'alarm': 'trench:alarm', 'alarmRange': 330, 'alarmCone': 50})
E(SENTINEL, 720, 180, props={'pathID': blue, 'alarm': 'trench:alarm'}, rot=180)
E(LASER, *PILLAR, props={'turnSpeed': 1.1, 'refireRate': 60})
E(WOLFGUN, 1100, 620)
E(STINGER2, 1060, 940)
E(STINGER, 1010, 196)
tri(1080, 700, s=24)
grid(1080, 780, 2, 2, s=26)
line(820, 170, 960, 170, 3)
E(STINGER3, 1100, 1120, props={'powerupDrop': {'type': 'health', 'item': 'health', 'quantity': 25}})
# --- switching yard: a panel on the south wall, the sentinel's loop, a laser turret down the
# bottom lane, hunters in the north-west corner, guns at lane ends
YARD_LOCK = {'alarm': ['yard:alarm', 'door3:close'], 'alarmClear': 'door3:open'}
E(PANEL, 1440, 1088, props=dict(YARD_LOCK))
E(SENTINEL, 1360, 660, props={'pathID': yellow, **YARD_LOCK}, rot=90)
E(LASER, 1610, 1060, props={'refireRate': 52})
E(SCOUT, 1200, 652, props=dict(HUNTER))
E(SCOUT, 1240, 680, props=dict(HUNTER))
E(STINGER, 1180, 960)
E(STINGER2, 1620, 680)
E(WOLFGUN, 1360, 960)
E(LAUNCHER, 1290, 1040)
grid(1520, 960, 2, 3, s=26)
tri(1280, 860)
grid(1360, 1040, 2, 1)
# --- the core: the final room. A double battery and stinger3s over the exit, laser turrets
# either side of the Interface, packed scurge round the moat, a launcher and a scout pair
E(BATTERY, 1450, 110, rot=180)
E(STINGER3, 1520, 90)
E(STINGER3, 1600, 230)
E(LASER, 1260, 300, props={'turnSpeed': 1.2})
E(LASER, 1600, 360, props={'turnSpeed': 1.2})
E(LAUNCHER, 1250, 500)
E(WOLFGUN, 1610, 500)
E(SCOUT, 1300, 150, props=dict(HUNTER))
E(SCOUT, 1560, 470, props=dict(HUNTER))
grid(1300, 230, 2, 2, s=24)
grid(1560, 290, 2, 2, s=24)
grid(1430, 470, 3, 2, s=24)
tri(1350, 110, s=24)
E(PANEL, 1232, 380, rot=90, props={'alarmRange': 280})

# ---------------------------------------------------------------- pickups and messages
pick = []


def pickup(x, y, type_, item, q, **kw):
    pick.append(P('game objects/powerup', x, y, props=dict({'type': type_, 'item': item, 'quantity': q}, **kw)))


def beacon(x, y, msg):
    pick.append(P('game objects/message beacon', x, y, props={'alertMessage': msg, 'persistent': True}))


beacon(200, 960, 'Floor grids are <strong>LIVE</strong> when they crackle blue, and they warn you in amber first. Time your run.')
beacon(160, 740, '<strong>ALARM PANELS</strong> and <strong>SENTINELS</strong> don\'t shoot. They call the hunters and power the floors. Kill them first, or stay out of sight.')
beacon(140, 260, 'The data bus. The <strong>LASER TURRET</strong> at the far end turns slowly: watch its red sight line and duck into the alcoves.')
beacon(1240, 1060, 'A <strong>BREAKER</strong> in this yard powers its floor grids, and the <strong>UPLINK TERMINAL</strong> holds the core door shut.')
beacon(1360, 680 + 0, 'Core door locked. Destroy the <strong>UPLINK TERMINAL</strong> in the yard.')
pickup(600, 804, 'primary', 'Arc Caster', 80)
pickup(560, 806, 'health', 'health', 50)
pickup(1550, 1040, 'secondary', 'Pulse Bomb', 3)
pickup(1580, 1040, 'health', 'health', 50)
pickup(120, 1110, 'primary', 'Bolter', 60)
pickup(340, 1110, 'secondary', 'Carbon Bomb', 2)
pickup(130, 362, 'primary', 'Vertigo', 60)
pickup(600, 300, 'health', 'health', 25)
pickup(500, 104, 'primary', 'Arc Caster', 40)
pickup(270, 162, 'health', 'health', 25)
pickup(720, 904, 'primary', 'Plasma', 20)
pickup(1090, 600, 'secondary', 'Thermal Bomb', 2)
pickup(1080, 1100, 'primary', 'Arc Caster', 40)
pickup(1440, 636, 'primary', 'Bolter', 50)
pickup(1200, 1000, 'secondary', 'Pulse Bomb', 2)
pickup(1270, 500, 'health', 'health', 50)
pickup(1590, 320, 'primary', 'Arc Caster', 40)

# ---------------------------------------------------------------- doors and floor grids
# door1 seals the core until the uplink terminal dies; door2 and door3 stand open and slam shut
# while an alarm in their room is up (the hall's way to the bus, the trench's way into the yard)
doors = [P('game objects/door', 1360, 582, rot=90, props={'id': 'door1'}),
         P('game objects/door', 140, 210, rot=90, props={'id': 'door2', 'status': 'open'}),
         P('game objects/door', 1140, 1060, props={'id': 'door3', 'status': 'open'})]
TILE = 'game objects/trap tile'


def strip(x0, y0, x1, y1, **props):
    """Trap tiles covering the rectangle (40 px tiles; the last row/column stretched to fit)."""
    nx, ny = max(1, round((x1 - x0) / 40)), max(1, round((y1 - y0) / 40))
    tw, th = (x1 - x0) / nx, (y1 - y0) / ny
    for i in range(nx):
        for j in range(ny):
            o = P(TILE, x0 + tw * (i + .5), y0 + th * (j + .5), props=dict(props))
            if abs(tw - 40) > .01 or abs(th - 40) > .01:
                o['matrix'] = [num(tw / 40), 0, 0, num(th / 40)]
            doors.append(o)


# intake corridor: the first, slow one
strip(280, 840, 360, 880, onTime=1.2, offTime=2.0)
# hall: the top aisle by the way out to the bus wakes with the hall alarm
strip(60, 280, 180, 320, group='hall', dormant=True, offTime=0, alarmTime=10)
# data bus: three timed grids, out of step, under the laser
strip(380, 60, 420, 140, onTime=1.4, offTime=1.4, phase=0)
strip(600, 60, 640, 140, onTime=1.4, offTime=1.4, phase=0.9)
strip(940, 60, 980, 140, onTime=1.4, offTime=1.4, phase=1.8)
# trench: both catwalks go live on the trench alarm, and the north one also pulses on a timer
strip(800, 480, 1000, 544, group='trench', dormant=True, offTime=0, alarmTime=12)
strip(800, 840, 1000, 904, group='trench', onTime=1.0, offTime=2.2)
# yard: timed grids across the lanes; the breaker shuts them down, the yard alarm makes them solid
for (x0, y0, x1, y1), ph in (((1160, 760, 1240, 800), 0), ((1320, 760, 1400, 800), 1.2), ((1480, 960, 1560, 1000), 0.6),
                             ((1400, 1020, 1440, 1100), 1.8), ((1400, 820, 1480, 900), 0.3), ((1320, 960, 1400, 1000), 2.0)):
    strip(x0, y0, x1, y1, group='yard', onTime=1.3, offTime=1.7, phase=ph)

# ---------------------------------------------------------------- boxes
boxes = []
brng = random.Random(10101)
DROPS = [{'type': 'health', 'item': 'health', 'quantity': 25}, {'type': 'primary', 'item': 'Bolter', 'quantity': 25},
         {'type': 'primary', 'item': 'Arc Caster', 'quantity': 25}, {'type': 'secondary', 'item': 'Pulse Bomb', 'quantity': 1},
         {'type': 'secondary', 'item': 'Carbon Bomb', 'quantity': 1}, {'type': 'primary', 'item': 'Vertigo', 'quantity': 30}]


def crates(x, y, n, dx=20, dy=0, drop=None):
    for k in range(n):
        o = P('game objects/box', x + k * dx, y + k * dy)
        if drop is not False and k == n // 2 and (drop or brng.random() < 0.4):
            o['scale'] = 1.285706
            o['props'] = {'health': 25, 'powerupDrop': drop or brng.choice(DROPS)}
        boxes.append(o)


def stack(x, y):
    for dx in (0, 20):
        crates(x + dx, y, 2, 0, 20, drop=False)


# intake
crates(80, 920, 4, 0, 20)
crates(160, 1120, 4)
stack(240, 1000)
# hall: crates along the walls and at aisle ends
crates(80, 360, 3, 0, 20)
crates(80, 660, 4, 0, 20)
crates(200, 300, 2)
crates(310, 300, 2)
crates(430, 806, 3)
crates(244, 600, 3, 0, 20)
stack(200, 740)
crates(440, 300, 2)
# dock
crates(430, 186, 3, 0, 20)
# bus: crates in the alcoves and along the walls
crates(80, 76, 3)
crates(740, 76, 2, 0, 20)
crates(1100, 120, 3, -20, 0)
# trench banks
crates(800, 1120, 4)
crates(1060, 560, 3, 0, 20)
crates(1100, 960, 4, 0, 20)
stack(1060, 1040)
crates(860, 196, 4)
# yard: along the lanes' edges
crates(1176, 632, 3)
crates(1336, 632, 3)
crates(1500, 632, 3)
crates(1224, 916, 3, 0, 20)
crates(1340, 1084, 3)
crates(1500, 1084, 3)
crates(1384, 916, 3, 0, 20)
# core: round the walls
crates(1250, 110, 3, 0, 20)
crates(1610, 380, 3, 0, 20)
crates(1290, 520, 3)
crates(1500, 520, 3)
crates(1380, 76, 3)
stack(1540, 150)
# the uplink terminal opens the core door; the breaker shuts down the yard's floor grids
boxes.append(P('game objects/box computer', 1610, 860, props={'onDie': {'$trigger': 'door1:open'}}))
boxes.append(P('game objects/box computer', 1180, 1076, props={'onDie': {'$trigger': 'yard:off'}}))

# vision: one zone per room, overlapping where rooms meet, so an enemy fights you in its own room
# and the doorways belong to both sides. Together they cover every floor pixel, because a moving
# enemy re-registers its zones as it goes (one outside every zone would make its own).
def zone(name, x0, y0, x1, y1):
    return {'name': name, 'x': 0, 'y': 0, 'd': f'M {x0} {y0} L {x1} {y0} L {x1} {y1} L {x0} {y1} Z'}


vision = [
    zone('intake', 40, 780, 400, 1160),            # with its corridor up into the hall
    zone('server hall', 40, 260, 640, 840),
    zone('hunter dock', 400, 150, 640, 300),
    zone('hall stair', 80, 100, 200, 320),         # the way up to the bus (door2)
    zone('data bus', 40, 10, 1200, 200),
    zone('cooling trench', 660, 120, 1140, 1160),
    zone('switching yard', 1100, 600, 1660, 1120),  # with the trench door (door3)
    zone('core', 1200, 40, 1660, 660),              # with its corridor and door (door1)
]

BRIEFING = {
    'title': 'INTERFACE',
    'body': ("Alarms sound if you are detected. They also sound if\n"
             "you are not. It's a feature. This is the robots'\n"
             "network interface hub: tight corridors, electrified\n"
             "floors and a building full of snitches. Alarm panels\n"
             "and sentinels call in the hunters and power up the\n"
             "floor grids, so shoot the watchers first. Take out the\n"
             "uplink terminal to open the core, then leave."),
    'captions': [
        {'style': 'name', 'text': 'Alarm Sentinel', 'x': 636.45, 'y': 209.89},
        {'style': 'note', 'text': 'Unarmed. Tells on you.', 'x': 636.45, 'y': 316.6},
        {'style': 'name', 'text': 'Laser Turret', 'x': 636.48, 'y': 359.89},
        {'style': 'note', 'text': 'Slow to turn. Not to fire.', 'x': 636.45, 'y': 426.6},
    ],
    'graphics': [
        {'symbol': 'enemy assets/enemy alarm sentinel legs', 'x': 636.5, 'y': 268, 'scale': 1.6},
        {'symbol': 'enemy assets/enemy alarm sentinel core', 'x': 636.5, 'y': 268, 'scale': 1.6},
        {'symbol': 'enemy assets/enemy laser turret core', 'x': 636.5, 'y': 400},
        {'symbol': 'enemy assets/enemy laser turret turret body', 'x': 636.5, 'y': 400},
        {'symbol': 'screen_mc/shape 3', 'x': 0, 'y': 0},
    ],
}

INTRO = {'Arc Caster': 'ARC CASTER: chain lightning. It jumps from robot to robot, and robots hate being a conductor.',
         'Pulse Bomb': 'PULSE BOMBS: a bouncing charge that bursts into a ring of pulse shots. Roll one round a corner.'}


# ---------------------------------------------------------------- green links by walkable line of sight
def link_green(grid_):
    walk = ndi.distance_transform_edt(grid_ == 2) >= 15

    def clear(a, b):
        n = int(math.hypot(b['x'] - a['x'], b['y'] - a['y']) / 6) + 1
        for i in range(n + 1):
            t = i / n
            x, y = a['x'] + (b['x'] - a['x']) * t, a['y'] + (b['y'] - a['y']) * t
            if not walk[int(y), int(x)]: return False
        return True
    for a in green:
        a['props'] = {'connections': [{'$ref': b['name']} for b in green if b is not a and clear(a, b)]}


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


def add_intros():
    props = [o['props'] for o in pick] + [o['props']['powerupDrop'] for o in boxes + enemies if 'powerupDrop' in o.get('props', {})]
    for pr in props:
        if pr.get('type') in ('primary', 'secondary') and pr.get('item') in INTRO:
            pr.update(alertMessage=INTRO[pr['item']], alertOnce=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'levels', FOLDER))
    ap.add_argument('--preview')
    a = ap.parse_args()
    add_intros()
    grid_ = raster()
    link_green(grid_)
    for n in nodes: n.pop('_group', None)
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
    settings.setdefault('art', {'kit': 'bridge', 'seed': 1010, 'grade': 'red alert'})
    with open(lj, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n' + ',\n'.join(f'  {json.dumps(k)}: {pretty(v, "  ")}' for k, v in settings.items()) + '\n}\n')
    bj = os.path.join(a.out, 'briefing.json')
    if not os.path.exists(bj):
        with open(bj, 'w', encoding='utf-8', newline='\n') as f: f.write(json.dumps(BRIEFING, indent=2) + '\n')
    base = os.path.join(a.out, 'collision-base.png')
    if not os.path.exists(base): Image.new('RGBA', (W, H), (255, 255, 255, 255)).save(base)
    print('wrote', ', '.join(files), 'and level.json to', a.out)
    if a.preview: preview(a.preview, grid_)


def preview(path, grid_):
    im = Image.fromarray(np.choose(grid_, [np.uint8(30), np.uint8(140), np.uint8(235)])).convert('RGB')
    d = ImageDraw.Draw(im)
    for t in doors:
        if t['symbol'] == TILE:
            sx, sy = (t['matrix'][0], t['matrix'][3]) if 'matrix' in t else (1, 1)
            col = (255, 160, 0) if t['props'].get('dormant') else (60, 160, 255)
            d.rectangle([t['x'] - 20 * sx, t['y'] - 20 * sy, t['x'] + 20 * sx, t['y'] + 20 * sy], outline=col, width=2)
        else:
            d.rectangle([t['x'] - 28, t['y'] - 6, t['x'] + 28, t['y'] + 6], fill=(0, 200, 200))
    by = {n['name']: n for n in nodes}
    for n in nodes:
        c = tuple(n['color']['add'][:3])
        for ref in n['props']['connections']:
            m = by[ref['$ref']]
            d.line([(n['x'], n['y']), (m['x'], m['y'])], fill=c, width=1)
        d.ellipse([n['x'] - 4, n['y'] - 4, n['x'] + 4, n['y'] + 4], fill=c)
    for e in enemies:
        r = {BATTERY: 18, WOLFGUN: 12, LASER: 14, SENTINEL: 12, PANEL: 10}.get(e['symbol'], 8)
        col = {LASER: (255, 0, 60), PANEL: (255, 120, 0), SENTINEL: (255, 200, 0), SCOUT: (180, 0, 200), SCURGE: (120, 120, 0),
               BARREL: (255, 0, 0)}.get(e['symbol'], (220, 180, 0))
        d.ellipse([e['x'] - r, e['y'] - r, e['x'] + r, e['y'] + r], fill=col)
    for p in pick:
        col = (120, 220, 120) if 'beacon' in p['symbol'] else (0, 200, 255)
        d.rectangle([p['x'] - 6, p['y'] - 6, p['x'] + 6, p['y'] + 6], outline=col, width=2)
    for b in boxes: d.rectangle([b['x'] - 8, b['y'] - 8, b['x'] + 8, b['y'] + 8], fill=(150, 110, 60))
    for f in features: d.ellipse([f['x'] - 20, f['y'] - 20, f['x'] + 20, f['y'] + 20], outline=(0, 220, 0), width=4)
    im.save(path)


if __name__ == '__main__':
    main()

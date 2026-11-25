"""Level 10 Interface's new symbols, written as vector symbols in source/library.

    python tools/levels/10_Interface/symbols.py

New enemies (new vector designs, as the level plan asks; only the archetypes are reused):
- Laser Turret (enemy assets/enemy laser turret): a heavy emitter on an armoured base. It turns
  slowly, shows a red sight line that brightens as it charges, and fires an instant beam
  (shot_mcELaser, as2/enemyProjectileBeam.as). Strafe out of the line.
- Alarm Panel (enemy assets/enemy alarm panel): a wall-mounted siren box. Unarmed; when it sees
  you it sounds the alarm (as2/enemyAlarm.as). Mount it with its back to a wall (it faces -y).
- Alarm Sentinel (enemy assets/enemy alarm sentinel): a six-legged crawler that patrols with a
  narrow forward scanner. Unarmed; sounds the alarm when it spots you. Approach from behind.

New objects and shots:
- game objects/trap tile: a 40 x 40 floor grid that goes live (as2/trapTile.as). Placed on the
  doors layer (under everything that moves).
- weapon assets/shot MC arc: the Arc Caster's chain lightning (as2/projectileArc.as), drawn by
  script, so the symbol is empty.
- weapon assets/shot MC enemy laser: the Laser Turret's beam, the player laser's art in red.
- screen_mc frame 2: the templates shot_mcArc and shot_mcELaser (depths 3240, 3243).
- weapon icons: frame 24 of the primary weapon icons (HUD and pickups) is the Arc Caster.

Death animations reuse the double battery's (turrets) and the scout's (sentinel) with this
enemy's own parts. Symbol ids are pinned in source/ids.json in 10's range (2000-2099).
Re-running rewrites these files only.
"""
import copy
import json
import math
import os
import subprocess

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LIB = os.path.join(ROOT, 'source', 'library')
EA = 'enemy assets'
GO = 'game objects'
WA = 'weapon assets'


def r(v): return round(v, 2)


def poly(pts):
    return 'M ' + ' L '.join(f'{r(x)} {r(y)}' for x, y in pts) + ' Z'


def ngon(cx, cy, rad, n, rot=0.0):
    return [(cx + rad * math.cos(rot + 2 * math.pi * i / n), cy + rad * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]


def ellipse(cx, cy, rx, ry, n=28):
    return [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rrect(x0, y0, x1, y1, c):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def rect(x0, y0, x1, y1): return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def seg(x0, y0, x1, y1, w):
    """A straight bar of width w from (x0, y0) to (x1, y1)."""
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L * w / 2, dx / L * w / 2
    return [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]


def solid(c): return {'type': 'solid', 'color': c}


def radial(cx, cy, rad, stops):
    return {'type': 'radial gradient', 'm': [rad, 0, 0, rad, cx, cy], 'spread': 0, 'interp': 0, 'stops': stops}


def linear(x0, y0, x1, y1, stops):
    ax, ay = (x1 - x0) / 2, (y1 - y0) / 2
    return {'type': 'linear gradient', 'm': [r(ax), r(ay), r(-ay), r(ax), r((x0 + x1) / 2), r((y0 + y1) / 2)], 'spread': 0, 'interp': 0, 'stops': stops}


def shape(paths):
    """paths: [(fill, [polygon, ...]), ...] bottom first; several polygons in one path use even-odd holes."""
    fills, out, xs, ys = [], [], [], []
    for f, polys in paths:
        fills.append(f)
        out.append({'fill': len(fills) - 1, 'd': ' '.join(poly(p) for p in polys)})
        for p in polys:
            xs += [x for x, _ in p]
            ys += [y for _, y in p]
    return {'kind': 'shape', 'bounds': [r(min(xs)), r(max(xs)), r(min(ys)), r(max(ys))], 'fills': fills, 'lines': [], 'paths': out}


def sprite(changes, script=None):
    f = {'frame': 1}
    if script: f['script'] = script
    f['changes'] = changes
    return {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': 1, 'timeline': [f]}


def frames_sprite(frames):
    """frames: [[changes...], ...] one list per frame (each frame replaces depth 1)."""
    tl = [{'frame': 1, 'changes': frames[0]}]
    for i, ch in enumerate(frames[1:], 2):
        tl.append({'frame': i, 'changes': [{'remove': 1}] + ch})
    return {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': len(frames), 'timeline': tl}


written = []


def save(p, obj):
    """Write JSON, then lay it out with the source format's own pretty printer (pretty.mjs)."""
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(obj) + '\n')
    subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'pretty.mjs'), p], check=True)


def write(name, obj):
    save(os.path.join(LIB, name + '.json'), obj)
    written.append(name)


def place(sym, depth, **kw):
    c = {'place': sym, 'depth': depth, 'x': kw.pop('x', 0), 'y': kw.pop('y', 0)}
    c.update(kw)
    return c


BEVEL = {'type': 'bevel', 'shadow': '#000000', 'highlight': '#b9c6d0', 'blurX': 1, 'blurY': 1, 'angle': 0.785385, 'distance': 2,
         'strength': 0.6, 'inner': True, 'knockout': False, 'onTop': False, 'passes': 1}
SHADOW = {'type': 'dropShadow', 'color': '#00000066', 'blurX': 4, 'blurY': 4, 'angle': 0.785398, 'distance': 4, 'strength': 1,
          'inner': False, 'knockout': False, 'passes': 2}
STEEL = [[0, '#9aa6b0'], [0.5, '#56616b'], [1, '#262d33']]
DARK = [[0, '#3d454c'], [1, '#14181b']]
RED_LENS = [[0, '#ffd2c8'], [0.35, '#ff3b2a'], [0.8, '#8c0d07'], [1, '#3a0503']]
HIDDEN = ['onClipEvent (load) {', '    _visible = false;', '}', '']


def beacon(base):
    """A turning siren light: two red beams and a hot centre, all additive."""
    beam = []
    for a in (0, math.pi):
        pts = [(0, 0)] + [(math.cos(a + t) * 34, math.sin(a + t) * 34) for t in (-0.32, -0.16, 0, 0.16, 0.32)]
        beam.append(pts)
    write(f'{base} beacon/shape 1', shape([(radial(0, 0, 34, [[0, '#ff5a3cd9'], [0.6, '#ff1e0a59'], [1, '#ff000000']]), beam)]))
    write(f'{base} beacon', sprite([
        place(f'{base} beacon/shape 1', 1, blend='add'),
        place('_glow', 2, scale=0.55, color={'multiply': [0, 0, 0, 0.8], 'add': [255, 40, 20, 0]}, blend='add'),
    ]))


def double_battery_death(base, core, body, script, core_scale, live):
    """Frame 1 `live`, frames 2-15 the double battery's destruction with this enemy's parts:
    its wrecked core (darkened) on depth 1, its turret body (or nothing) on depth 3, and none
    of the double battery's own wreck pieces (depth 2)."""
    db = json.load(open(os.path.join(LIB, f'{EA}/enemy double battery.json')))
    tl = copy.deepcopy(db['timeline'])
    tl[0] = {'frame': 1, 'script': script, 'changes': live}
    tl[1]['changes'] = [{'remove': c['depth']} for c in live if c['depth'] not in (1, 5)] + tl[1]['changes']
    dark = {'multiply': [0.42, 0.42, 0.42, 1]}
    for f in tl[1:]:
        keep = []
        for c in f['changes']:
            d = c.get('depth', c.get('update', c.get('remove')))
            if d == 2 or (d == 3 and body is None):
                continue
            if c.get('place') == f'{EA}/enemy double battery/shape 1':
                c.update(place=core, color=dark)
            elif c.get('place') == f'{EA}/enemy double battery turret body':
                c.update(place=body, color=dark)
                c.pop('ratio', None)
                c.pop('filters', None)
            elif c.get('update') == 3:
                c.pop('filters', None)
            if c.get('scale') and core_scale != 1 and d in (9, 10, 11, 13):
                s = c['scale']
                c['scale'] = [v * core_scale for v in s] if isinstance(s, list) else s * core_scale
            keep.append(c)
        f['changes'] = keep
    write(base, {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': db['frames'], 'timeline': tl})


# ---------------------------------------------------------------- Laser Turret
def laser_turret():
    base = f'{EA}/enemy laser turret'
    # the base: a square armoured plinth with chamfers, bolts and a red-ticked bearing ring
    ticks = []
    for i in range(12):
        a = 2 * math.pi * i / 12
        ticks.append([(math.cos(a - .1) * 15.5, math.sin(a - .1) * 15.5), (math.cos(a + .1) * 15.5, math.sin(a + .1) * 15.5),
                      (math.cos(a + .08) * 12.5, math.sin(a + .08) * 12.5), (math.cos(a - .08) * 12.5, math.sin(a - .08) * 12.5)])
    write(f'{base} core/shape 1', shape([
        (solid('#000000'), [rrect(-21, -21, 22, 22, 7)]),
        (linear(-20, -20, 20, 20, STEEL), [rrect(-20.5, -20.5, 20.5, 20.5, 7)]),
        (linear(-16, -18, 16, 18, [[0, '#4d5760'], [1, '#1c2226']]), [rrect(-17.5, -17.5, 17.5, 17.5, 5)]),
        (solid('#11151a'), [ngon(x, y, 1.7, 8) for x, y in ((-15, -15), (15, -15), (15, 15), (-15, 15))]),
        (solid('#0d1013'), [ngon(0, 0, 16.5, 32)]),
        (solid('#b3261b'), ticks),
        (radial(3, 3, 13, DARK), [ngon(0, 0, 12, 32)]),
    ]))
    write(f'{base} core', sprite([place(f'{base} core/shape 1', 1)]))
    # the emitter: a long armoured barrel with a ruby lens, cooling fins down both flanks
    fins = []
    for k in range(4):
        y = -2 + k * 4.2
        fins += [rect(-14, y, -9.5, y + 2.2), rect(9.5, y, 14, y + 2.2)]
    write(f'{base} turret body/shape 1', shape([
        (solid('#000000'), [rrect(-11.5, -12.5, 11.5, 16.5, 5), rect(-4.2, -37.5, 4.2, -10)]),
        (solid('#2a3137'), fins),
        (linear(-10, 0, 10, 0, [[0, '#3a434a'], [0.4, '#a4b0ba'], [1, '#30383f']]), [rect(-3.4, -36.5, 3.4, -10)]),
        (solid('#15191d'), [rect(-4.6, -30, 4.6, -27.5), rect(-4.6, -21, 4.6, -18.5)]),
        (linear(-10, -12, 10, 16, [[0, '#a9b6c0'], [0.55, '#59656f'], [1, '#2a3238']]), [rrect(-10.5, -11.5, 10.5, 15.5, 4.5)]),
        (solid('#1a1f24'), [rrect(-6.5, -7.5, 6.5, 6.5, 2.5)]),
        (radial(-1, -2.5, 6, RED_LENS), [ngon(0, -0.5, 5, 6, math.pi / 6)]),
        (solid('#e8c22e'), [rect(-8.5, 10, -5.5, 13.5), rect(-2.5, 10, 0.5, 13.5), rect(3.5, 10, 6.5, 13.5)]),
        (radial(0, -37, 3.2, [[0, '#ffe1d8'], [0.5, '#ff4030'], [1, '#7a0a05']]), [ngon(0, -37, 2.6, 12)]),
    ]))
    write(f'{base} turret body', sprite([place(f'{base} turret body/shape 1', 1)]))
    write(f'{base} flash', sprite([
        place('_glow', 1, scale=[1.2, 1.2]),
        place('_glow', 3, scale=[0.6, 0.6], color={'multiply': [0, 0, 0, 1], 'add': [255, 40, 20, 0]}, blend='add'),
    ]))
    write(f'{base} turret', sprite([
        place('_blank MC', 2, name='sight_mc'),
        place(f'{base} turret body', 3, filters=[BEVEL, SHADOW]),
        place('_blank MC', 7, y=-38, name='muzzle_mc'),
        place(f'{base} flash', 11, y=-38, name='flash_mc', clipEvents=[1], script=HIDDEN),
    ]))
    script = [
        '// Laser Turret (level 10 Interface): a slow-turning emitter. A red sight line shows where it',
        '// aims and brightens as it charges; then an instant beam (shot_mcELaser). Art: a new design.',
        '',
        'if(health == undefined) health = 240;',
        'if(turnSpeed == undefined) turnSpeed = 1.4;',
        'if(shot == undefined) shot = "shot_mcELaser";',
        'if(shotSpread == undefined) shotSpread = 0;',
        'if(refireRate == undefined) refireRate = 50;',
        'if(resistence == undefined) resistence = 60;',
        'if(debrisCount == undefined) debrisCount = 10;',
        'if(blastRange == undefined) blastRange = 50;',
        'if(damage == undefined) damage = 20;',
        'if(sight == undefined) sight = true;',
        '',
        '#include "as/object/enemyTurret.as"',
        '',
        '// the sight line, drawn in the turret from the muzzle to the first wall',
        '_sightUpdate = update;',
        'update = function(time){',
        '\t_sightUpdate(time);',
        '\tvar s = turret_mc.sight_mc;',
        '\ts.clear();',
        '\tif(!sight || !attacking || stunned || dying || _currentframe != 1)',
        '\t\treturn;',
        '\tvar a = turret_mc._rotation + _rotation, v = getVector(8, a);',
        '\tvar p = {_x:_x + v.x * 4.75, _y:_y + v.y * 4.75}, d = 38;',
        '\twhile(d < 900 && !wallHitTest(p._x, p._y)){',
        '\t\tp._x += v.x;',
        '\t\tp._y += v.y;',
        '\t\td += 8;',
        '\t}',
        '\tvar charge = Math.max(0, Math.min(1, refire / refireRate));',
        '\ts.lineStyle(1 + charge * 2, 0xFF2A1A, 15 + 55 * charge * charge);',
        '\ts.moveTo(0, -38);',
        '\ts.lineTo(0, -d);',
        '}',
    ]
    live = [place(f'{base} core', 1, name='core_mc'), place(f'{base} turret', 5, name='turret_mc')]
    double_battery_death(base, f'{base} core', f'{base} turret body', script, 0.7, live)


# ---------------------------------------------------------------- Alarm Panel
def alarm_panel():
    base = f'{EA}/enemy alarm panel'
    grille = [rect(x, -3, x + 1.6, 4) for x in (-13, -10, -7, 7, 10, 13 - 1.6)]
    stripes = []
    for k in range(9):
        x = -16 + k * 4
        stripes.append([(max(-16, x), 9), (min(16, x + 2), 9), (min(16, x + 4), 6.2), (max(-16, x + 2), 6.2)])
    write(f'{base} core/shape 1', shape([
        (solid('#000000'), [rrect(-18, -10, 18.5, 10.5, 3.5)]),
        (linear(-17, -9, 17, 9, [[0, '#c3ccd3'], [0.5, '#7b8790'], [1, '#3b444b']]), [rrect(-17.5, -9.5, 17.5, 9.5, 3)]),
        (solid('#e3b52c'), [[(x, y) for x, y in s] for s in stripes]),
        (solid('#1c2126'), [rrect(-15, -6.5, 15, 5.5, 2)]),
        (solid('#4a545c'), grille),
        (radial(0, -3, 9, [[0, '#ffb3a3'], [0.3, '#ff2b1a'], [0.75, '#7a0a05'], [1, '#2a0302']]), [ngon(0, -1, 6.5, 20)]),
        (solid('#ffffffaa'), [ellipse(-1.8, -3.6, 1.6, 1.1, 10)]),
    ]))
    write(f'{base} core', sprite([place(f'{base} core/shape 1', 1, filters=[SHADOW])]))
    beacon(base)
    script = [
        '// Alarm Panel (level 10 Interface): a wall siren. Unarmed; when it sees you it sounds the alarm',
        '// (as2/enemyAlarm.as: hunters come running and its `alarm` triggers fire). It faces -y, so',
        '// mount it with its back to a wall. Art: a new design.',
        '',
        'if(health == undefined) health = 45;',
        'if(shot == undefined) shot = "";',
        'if(debrisCount == undefined) debrisCount = 4;',
        'if(blastRange == undefined) blastRange = 30;',
        'if(damage == undefined) damage = 6;',
        'if(alarmRange == undefined) alarmRange = 240;',
        'if(alarmCone == undefined) alarmCone = 80;',
        '',
        '#include "as/object/enemyTurret.as"',
        '#include "as/object/enemyAlarm.as"',
    ]
    live = [place(f'{base} core', 1, name='core_mc'), place(f'{base} beacon', 7, y=-1, name='beacon_mc')]
    double_battery_death(base, f'{base} core', None, script, 0.45, live)


# ---------------------------------------------------------------- Alarm Sentinel
def alarm_sentinel():
    base = f'{EA}/enemy alarm sentinel'
    # carapace: an elongated hexagon, plated, with a scanner bar across the front and a siren dome
    hull = [(0, -19), (10, -12), (12, 6), (6, 15), (-6, 15), (-12, 6), (-10, -12)]
    plates = [[(0, -16), (8, -10.5), (2.5, -6), (-2.5, -6), (-8, -10.5)],
              [(-10, -8), (-3.5, -3.5), (-3.5, 11), (-5.5, 12.5), (-10, 5)],
              [(10, -8), (3.5, -3.5), (3.5, 11), (5.5, 12.5), (10, 5)]]
    write(f'{base} core/shape 1', shape([
        (solid('#000000'), [[(x * 1.06 + .6, y * 1.06 + .6) for x, y in hull]]),
        (linear(-10, -15, 10, 15, [[0, '#7f8b95'], [0.5, '#3d474f'], [1, '#1b2025']]), [hull]),
        (linear(-8, -16, 8, 12, [[0, '#a8b4be'], [1, '#4b555d']]), plates),
        (solid('#0f1215'), [rrect(-7.5, -15.5, 7.5, -11.5, 1.5)]),
        (linear(-7, 0, 7, 0, [[0, '#5a0603'], [0.5, '#ff4a2a'], [1, '#5a0603']]), [rrect(-6.5, -14.8, 6.5, -12.2, 1)]),
        (solid('#15191d'), [ngon(0, 3, 5.6, 20)]),
        (radial(-1, 1.5, 6, [[0, '#ffb3a3'], [0.35, '#ff2b1a'], [0.8, '#7a0a05'], [1, '#2a0302']]), [ngon(0, 3, 4.4, 20)]),
        (solid('#ffffffaa'), [ellipse(-1.3, 1.6, 1.2, 0.8, 10)]),
        (solid('#262d33'), [rect(-0.7, 11, 0.7, 19.5)]),
        (solid('#ff3b2a'), [ngon(0, 19.5, 1.3, 8)]),
    ]))
    write(f'{base} core', sprite([place(f'{base} core/shape 1', 1)]))
    # legs: three a side, two segments each, swinging in alternating tripods over 4 frames
    roots = [(-9, -8), (-11, 1), (-9, 9), (9, -8), (11, 1), (9, 9)]
    base_ang = [-150, 180, 150, -30, 0, 30]
    frames = []
    for f in range(4):
        swing = [10, 0, -10, 0][f]
        polys_dark, polys_lite = [], []
        for i, ((x, y), a) in enumerate(zip(roots, base_ang)):
            tripod = (i in (0, 2, 4)) == (f < 2)
            s = swing if tripod else -swing
            side = -1 if x < 0 else 1
            ang = math.radians(a + s * side)
            kx, ky = x + math.cos(ang) * 8, y + math.sin(ang) * 8 - 3
            fx, fy = kx + math.cos(ang) * 7, ky + math.sin(ang) * 7 + 5
            polys_dark += [seg(x, y, kx, ky, 3.4), seg(kx, ky, fx, fy, 2.6)]
            polys_lite += [seg(x, y, kx, ky, 1.6), ngon(kx, ky, 1.3, 8)]
        write(f'{base} legs/shape {f + 1}', shape([(solid('#0e1114'), polys_dark), (solid('#6d7881'), polys_lite)]))
        frames.append([place(f'{base} legs/shape {f + 1}', 1)])
    write(f'{base} legs', frames_sprite(frames))
    beacon(base)
    script = [
        '// Alarm Sentinel (level 10 Interface): a six-legged crawler on patrol. Unarmed; its scanner',
        '// sees ahead only (alarmCone either side), and when it spots you it stops, stares and sounds',
        '// the alarm (as2/enemyAlarm.as). Sneak up behind it. Art: a new design.',
        '',
        'if(health == undefined) health = 70;',
        'if(turnSpeed == undefined) turnSpeed = 5;',
        'if(speedMax == undefined) speedMax = 1.6;',
        'if(accel == undefined) accel = .35;',
        'if(shot == undefined) shot = "";',
        'if(resistence == undefined) resistence = 8;',
        'if(blastRange == undefined) blastRange = 36;',
        'if(damage == undefined) damage = 6;',
        'if(patroller == undefined) patroller = true;',
        'if(alerter == undefined) alerter = false;',
        'if(alarmRange == undefined) alarmRange = 230;',
        'if(alarmCone == undefined) alarmCone = 50;',
        '',
        '#include "as/object/enemyVehicle.as"',
        '#include "as/object/enemyAlarm.as"',
    ]
    scout = json.load(open(os.path.join(LIB, f'{EA}/enemy scout.json')))
    tl = copy.deepcopy(scout['timeline'])
    tl[0] = {'frame': 1, 'script': script, 'changes': [
        place(f'{base} legs', 1, name='locomotion_mc'),
        place(f'{base} core', 2, name='core_mc', filters=[SHADOW]),
        place(f'{base} beacon', 8, y=3, name='beacon_mc'),
    ]}
    f2 = [c for c in tl[1]['changes'] if 'remove' not in c and c.get('place') != f'{EA}/designs/dart']
    tl[1]['changes'] = [{'remove': 1}, {'remove': 2}, {'remove': 8},
                        place(f'{base} core', 1, color={'multiply': [0.32, 0.3, 0.3, 1], 'add': [0, 0, 0, 0]})] + f2
    write(base, {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': scout['frames'], 'timeline': tl})


# ---------------------------------------------------------------- Trap tile
def trap_tile():
    base = f'{GO}/trap tile'
    # the grate: a dark frame with hazard corners and a grid of conductor bars
    bars = []
    for k in range(5):
        v = -14 + k * 7
        bars += [rect(-15, v - 0.9, 15, v + 0.9), rect(v - 0.9, -15, v + 0.9, 15)]
    corners = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            corners.append([(sx * 19.5, sy * 19.5), (sx * 12, sy * 19.5), (sx * 19.5, sy * 12)])
    write(f'{base}/shape 1', shape([
        (solid('#0a0c0e'), [rect(-20, -20, 20, 20)]),
        (linear(-20, -20, 20, 20, [[0, '#4a535b'], [1, '#1d2328']]), [rect(-19.5, -19.5, 19.5, 19.5), rect(-16, -16, 16, 16)]),
        (solid('#e0b22a'), corners),
        (solid('#07090b'), [rect(-16, -16, 16, 16)]),
        (linear(-16, -16, 16, 16, [[0, '#56616a'], [1, '#2c343a']]), bars),
    ]))
    # the live charge: bright crackling bars, three variations to flicker between
    import random
    rng = random.Random(10)
    frames = []
    for f in range(3):
        lines = []
        for k in range(5):
            v = -14 + k * 7
            for horiz in (True, False):
                pts = []
                for i in range(7):
                    t = -15 + i * 5
                    j = rng.uniform(-1.6, 1.6) if 0 < i < 6 else 0
                    pts.append((t, v + j) if horiz else (v + j, t))
                for a, b in zip(pts, pts[1:]):
                    lines.append(seg(a[0], a[1], b[0], b[1], 1.3))
        write(f'{base} live/shape {f + 1}', shape([(solid('#d8f6ff'), lines)]))
        frames.append([place(f'{base} live/shape {f + 1}', 1)])
    live = frames_sprite(frames)
    # a blue glow under the bars in every frame
    live['timeline'][0]['changes'].insert(0, place('_glow', 0, scale=[2.3, 2.3], color={'multiply': [0, 0, 0, 0.75], 'add': [40, 150, 255, 0]}, blend='add'))
    write(f'{base} live', live)
    write(f'{base} warn', sprite([
        place(f'{base} live/shape 1', 1, color={'multiply': [1, 0.7, 0.2, 0.55], 'add': [0, 0, 0, 0]}),
        place('_glow', 2, scale=[1.8, 1.8], color={'multiply': [0, 0, 0, 0.35], 'add': [255, 170, 30, 0]}, blend='add'),
    ]))
    write(f'{base}/shape 2', shape([(radial(0, 0, 2.2, [[0, '#ffd0c0'], [0.5, '#ff3020'], [1, '#600804']]), [ngon(16.8, -16.8, 1.6, 10)])]))
    write(base, sprite([
        place(f'{base}/shape 1', 1),
        place(f'{base}/shape 2', 2, name='led_mc'),
        place(f'{base} warn', 3, name='warn_mc', blend='add'),
        place(f'{base} live', 4, name='live_mc', blend='add'),
    ], script=['#include "as/object/trapTile.as"']))


# ---------------------------------------------------------------- shots
def shots():
    write(f'{WA}/shot MC arc', sprite([], script=['#include "as/object/projectileArc.as"']))
    laser = json.load(open(os.path.join(LIB, f'{WA}/shot MC laser.json')))
    f = laser['timeline'][0]
    f['script'] = '#include "as/object/enemyProjectileBeam.as"'
    for c in f['changes']:
        if c['place'] == 'graphic assets/energy beam':
            c['scale'] = [0.7, c['scale'][1]] if isinstance(c.get('scale'), list) else c.get('scale')
            if c['depth'] == 4:
                c['color'] = {'multiply': [1, 0.55, 0.45, 1], 'add': [60, 0, 0, 0]}
            else:
                c['color'] = {'multiply': [0, 0, 0, 1], 'add': [255, 30, 0, 0]}
    write(f'{WA}/shot MC enemy laser', laser)
    # the templates on screen_mc frame 2, beside the other shots
    p = os.path.join(LIB, 'screen_mc.json')
    scr = json.load(open(p))
    f2 = next(f for f in scr['timeline'] if f['frame'] == 2)
    f2['changes'] = [c for c in f2['changes'] if c.get('name') not in ('shot_mcArc', 'shot_mcELaser')]
    f2['changes'] += [
        {'place': f'{WA}/shot MC arc', 'depth': 3240, 'x': -150, 'y': 640, 'name': 'shot_mcArc', 'clipEvents': [1],
         'script': '#include "as/shots/shot_mcArc.as"'},
        {'place': f'{WA}/shot MC enemy laser', 'depth': 3243, 'x': -180, 'y': 640, 'name': 'shot_mcELaser', 'clipEvents': [1],
         'script': '#include "as/shots/shot_mcELaser.as"'},
    ]
    save(p, scr)


# ---------------------------------------------------------------- weapon icon
def arc_icon():
    """Frame 24 of the primary weapon icons (HUD and pickups): a forked lightning bolt."""
    bolt = [(-2, -11), (4, -11), (1, -3), (6, -3), (-4, 11), (-1, 1), (-6, 1)]
    fork = [(3, 1), (9, 5), (4, 4)]
    write(f'{WA}/wep icons arc caster/shape 1', shape([
        (solid('#0a2a3a'), [[(x + .8, y + .8) for x, y in bolt]]),
        (linear(0, -11, 0, 11, [[0, '#ffffff'], [0.5, '#8fe3ff'], [1, '#2f9fe0']]), [bolt, fork]),
    ]))
    write(f'{WA}/wep icons arc caster', sprite([place(f'{WA}/wep icons arc caster/shape 1', 1)]))
    for name in ('wep icons primary - guns', 'wep icons primary - projectiles'):
        p = os.path.join(LIB, f'{WA}/{name}.json')
        d = json.load(open(p))
        d['timeline'] = [f for f in d['timeline'] if f['frame'] != 24]
        # what's on stage at frame 23 goes, the bolt comes in (frames after 24 aren't used)
        shown = set()
        for f in d['timeline']:
            if f['frame'] > 23: continue
            for c in f['changes']:
                if 'remove' in c: shown.discard(c['remove'])
                elif 'place' in c: shown.add(c['depth'])
        ch = [{'remove': k} for k in sorted(shown)] + [place(f'{WA}/wep icons arc caster', 20, scale=1.1 if 'guns' in name else 0.8)]
        d['timeline'] = sorted(d['timeline'] + [{'frame': 24, 'changes': ch}], key=lambda f: f['frame'])
        d['frames'] = max(d['frames'], 24)
        save(p, d)


def pin_ids():
    """Give the new symbols ids in 10's range (2000-2099)."""
    p = os.path.join(ROOT, 'source', 'ids.json')
    ids = json.load(open(p))
    used = set(ids.values())
    nxt = 2000
    for name in written:
        if name in ids: continue
        while nxt in used: nxt += 1
        ids[name] = nxt
        used.add(nxt)
    with open(p, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(ids, indent=2) + '\n')


if __name__ == '__main__':
    laser_turret()
    alarm_panel()
    alarm_sentinel()
    trap_tile()
    shots()
    arc_icon()
    pin_ids()
    print('wrote', len(written), 'symbols')

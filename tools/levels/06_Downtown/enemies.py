"""Level 06 Downtown's new enemies, written as vector symbols in source/.

    python tools/levels/06_Downtown/enemies.py

- enemy hive: the drone hive, the enemy generator. A new design: an armoured hexagonal pod
  wired into the street, three glowing print bays, and an iris over its hot core that opens
  each time it prints an enemy. Script: as2/enemyGenerator.as (linkage enemyHive)
- enemy barrel bot: the Barrel Bot, a rolling mine that chases you and detonates. Art: the
  tentacle mine design from enemies.fw.png, spinning as it rolls (linkage enemyBarrelBot)
- the Swarmer is the recovered "enemy drone" as it is; this only gives it a linkage id
  (enemySwarmer) so a hive can print it

Symbol ids are pinned in source/ids.json in 1600-1699 (05 and 07 take other ranges).
"""
import json
import math
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LIB = os.path.join(ROOT, 'source', 'library')
EA = 'enemy assets'


def write(rel, obj):
    p = os.path.join(LIB, rel + '.json')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(obj, indent=2) + '\n')


def r2(v): return round(v, 2)


def d_of(pts):
    p = [(r2(x), r2(y)) for x, y in pts]
    return 'M ' + ' L '.join(f'{x:g} {y:g}' for x, y in p) + f' L {p[0][0]:g} {p[0][1]:g} Z'


def poly(n, r, rot=0.0):
    return [(r * math.cos(rot + 2 * math.pi * k / n), r * math.sin(rot + 2 * math.pi * k / n)) for k in range(n)]


def mix(a, b, t):
    a, b = [int(a[i:i + 2], 16) for i in (1, 3, 5)], [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(a, b))


class Shape:
    def __init__(self): self.fills, self.lines, self.paths, self.pts = [], [], [], []

    def fill(self, f):
        if isinstance(f, str): f = {'type': 'solid', 'color': f}
        if f not in self.fills: self.fills.append(f)
        return self.fills.index(f)

    def poly(self, color, pts):
        self.paths.append({'fill': self.fill(color), 'd': d_of(pts)}); self.pts += pts

    def stroke(self, color, width, d, pts):
        ln = {'width': width, 'cap': 0, 'ecap': 0, 'join': 0, 'noScale': False, 'noClose': False, 'color': color}
        if ln not in self.lines: self.lines.append(ln)
        self.paths.append({'line': self.lines.index(ln), 'd': d}); self.pts += pts

    def json(self):
        xs = [x for x, _ in self.pts]; ys = [y for _, y in self.pts]
        return {'kind': 'shape', 'bounds': [r2(min(xs)), r2(max(xs)), r2(min(ys)), r2(max(ys))],
                'fills': self.fills, 'lines': self.lines, 'paths': self.paths}


LIGHT = (-0.6, -0.8)     # lit from the top-left, as the rest of the game's art


def facet(a0, a1):
    """How lit an outward facet facing between angles a0 and a1 is (0..1)."""
    a = (a0 + a1) / 2
    return max(0.0, min(1.0, 0.5 + 0.5 * (math.cos(a) * LIGHT[0] + math.sin(a) * LIGHT[1])))


# ---------------------------------------------------------------- the hive body
DARK, MID, LIT = '#1e2025', '#3b3f47', '#7b808b'
HOT, HOTTER, WHITE = '#ff6a14', '#ffb347', '#fff2c8'
BAYS = (-90, 30, 150)    # print bay directions (degrees)


def hive_body():
    s = Shape()
    # power cables plugged into the street: dark tubes running off under the pod
    for k, a in enumerate((-150, -30, 70, 110, 200)):
        a = math.radians(a)
        bend = math.radians(18 if k % 2 else -18)
        p0 = (24 * math.cos(a), 24 * math.sin(a))
        p1 = (40 * math.cos(a + bend), 40 * math.sin(a + bend))
        p2 = (50 * math.cos(a - bend * 0.5), 50 * math.sin(a - bend * 0.5))
        d = f'M {r2(p0[0]):g} {r2(p0[1]):g} Q {r2(p1[0]):g} {r2(p1[1]):g} {r2(p2[0]):g} {r2(p2[1]):g}'
        s.stroke('#141518', 5, d, [p0, p1, p2])
        s.stroke('#3a3d44', 1.5, d, [p0, p1, p2])
        s.poly('#2a2c31', [(p2[0] + 3.5 * math.cos(a + t), p2[1] + 3.5 * math.sin(a + t)) for t in (0, 1.6, 3.2, 4.8)])
    # the armoured hexagon: an outer bevel ring of six lit facets round a darker deck
    R, r = 29, 22
    rot = math.radians(30)
    outer, inner = poly(6, R, rot), poly(6, r, rot)
    for k in range(6):
        a0 = rot + 2 * math.pi * k / 6
        a1 = rot + 2 * math.pi * (k + 1) / 6
        s.poly(mix(DARK, LIT, facet(a0, a1)), [outer[k], outer[(k + 1) % 6], inner[(k + 1) % 6], inner[k]])
    s.poly(MID, inner)
    # hazard ring on the deck: twelve stripes, yellow and black
    for k in range(12):
        a0 = 2 * math.pi * k / 12 + 0.05
        a1 = 2 * math.pi * (k + 1) / 12 - 0.05
        col = '#c9a21a' if k % 2 else '#16171a'
        s.poly(col, [(19 * math.cos(a0), 19 * math.sin(a0)), (19 * math.cos(a1), 19 * math.sin(a1)),
                     (15.5 * math.cos(a1), 15.5 * math.sin(a1)), (15.5 * math.cos(a0), 15.5 * math.sin(a0))])
    # the print bays: a dark slot in the bevel at each bay direction
    for a in BAYS:
        a = math.radians(a)
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        box = lambda r0, r1, w: [(ux * r0 + vx * w, uy * r0 + vy * w), (ux * r1 + vx * w, uy * r1 + vy * w),
                                 (ux * r1 - vx * w, uy * r1 - vy * w), (ux * r0 - vx * w, uy * r0 - vy * w)]
        s.poly('#101114', box(19.5, 29.5, 6.5))
        s.poly('#55340f', box(21, 28, 4.5))
    # the iris housing: a dark well round the core
    s.poly('#121316', poly(16, 14))
    s.poly('#2b2e34', poly(16, 13))
    return s


def hive_vents():
    """The print bays' glow (placed with a glow filter, and dimmed by the script between prints)."""
    s = Shape()
    for a in BAYS:
        a = math.radians(a)
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        s.poly(HOT, [(ux * 21.5 + vx * 3.8, uy * 21.5 + vy * 3.8), (ux * 27.5 + vx * 3.8, uy * 27.5 + vy * 3.8),
                     (ux * 27.5 - vx * 3.8, uy * 27.5 - vy * 3.8), (ux * 21.5 - vx * 3.8, uy * 21.5 - vy * 3.8)])
        s.poly(HOTTER, [(ux * 22.5 + vx * 1.6, uy * 22.5 + vy * 1.6), (ux * 26.5 + vx * 1.6, uy * 26.5 + vy * 1.6),
                        (ux * 26.5 - vx * 1.6, uy * 26.5 - vy * 1.6), (ux * 22.5 - vx * 1.6, uy * 22.5 - vy * 1.6)])
    return s


def hive_core():
    s = Shape()
    s.fills.append({'type': 'radial gradient', 'm': [12.5, 0, 0, 12.5, 0, 0], 'spread': 0, 'interp': 0,
                    'stops': [[0, WHITE], [0.35, HOTTER], [0.8, HOT], [1, '#7a1e05']]})
    s.paths.append({'fill': 0, 'd': d_of(poly(24, 12.5))}); s.pts += poly(24, 12.5)
    return s


# the iris: six blades over the core, each pivoting on the rim
BLADE_R = 13


def blade():
    s = Shape()
    a0, a1 = math.radians(-34), math.radians(34)
    rim = [(BLADE_R * math.cos(a0 + (a1 - a0) * t / 6), BLADE_R * math.sin(a0 + (a1 - a0) * t / 6)) for t in range(7)]
    s.poly('#4a4e57', [(0, 0)] + rim)
    # a lit edge on one side, a seam on the other
    s.poly('#6f7480', [(0, 0), rim[0], (rim[0][0] * 0.8 + rim[1][0] * 0.2, rim[0][1] * 0.8 + rim[1][1] * 0.2), (1.2, -0.3)])
    s.poly('#2a2d33', [(0, 0), rim[-1], (rim[-1][0] * 0.85, rim[-1][1] * 0.85 - 1.2)])
    return s


def blade_matrix(k, open_):
    """Blade k (of 6) at opening 0..1: turned about its rim pivot so the tip swings out."""
    phi = math.radians(60 * k)
    piv = math.radians(34)                       # the pivot: the blade's leading rim corner
    px, py = BLADE_R * math.cos(phi + piv), BLADE_R * math.sin(phi + piv)
    th = math.radians(-62 * open_)
    a, b = math.cos(phi + th), math.sin(phi + th)
    # x' = R(th) (R(phi) x - p) + p
    c, d = -b, a
    rpx = math.cos(th) * px - math.sin(th) * py
    rpy = math.sin(th) * px + math.cos(th) * py
    return [round(a, 5), round(b, 5), round(c, 5), round(d, 5)], (r2(px - rpx), r2(py - rpy))


def iris_sprite():
    # frame 1 closed (stopped); label "open": opens over 5 frames, holds, closes, back to 1
    curve = [0, 0.25, 0.55, 0.8, 0.95, 1, 1, 1, 1, 0.85, 0.6, 0.35, 0.12, 0]
    tl = []
    for f, o in enumerate(curve, 1):
        changes = []
        if f == 1:
            changes.append({'place': '_circle', 'depth': 1, 'x': 0, 'y': 0, 'scale': r2(BLADE_R / 13.9 * 1.0 + 0.02), 'clipDepth': 8})
        for k in range(6):
            m, (tx, ty) = blade_matrix(k, o)
            ch = {'place' if f == 1 else 'update': 'enemy assets/enemy hive blade' if f == 1 else k + 2}
            if f == 1: ch['depth'] = k + 2
            ch.update({'x': tx, 'y': ty, 'matrix': m})
            changes.append(ch)
        fr = {'frame': f, 'changes': changes}
        if f == 1: fr['script'] = 'stop();'
        if f == 2: fr['label'] = 'open'
        if f == len(curve): fr['script'] = 'gotoAndStop(1);'
        tl.append(fr)
    return {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': len(curve), 'timeline': tl}


SHADOW = {'type': 'dropShadow', 'color': '#00000040', 'blurX': 4, 'blurY': 4, 'angle': 0.785398, 'distance': 7, 'strength': 1,
          'inner': False, 'knockout': False, 'passes': 1}
VENT_GLOW = {'type': 'glow', 'color': '#ff7a1acc', 'blurX': 10, 'blurY': 10, 'strength': 1.6, 'inner': False, 'knockout': False, 'passes': 2}


def death_frames(base, body_place, scale, scorch):
    """The scout's death animation (explosion, flash, smoke), scaled up, with the body scorched."""
    out = []
    for t in base['timeline'][1:]:
        t = json.loads(json.dumps(t))
        ch = []
        for c in t['changes']:
            if c.get('place') == 'enemy assets/designs/dart':
                c = dict(body_place, depth=1, color={'multiply': [scorch, scorch * 0.93, scorch * 0.93, 1], 'add': [0, 0, 0, 0]})
            elif 'place' in c or ('update' in c and ('x' in c or 'scale' in c)):
                c['x'] = r2(c.get('x', 0) * scale); c['y'] = r2(c.get('y', 0) * scale)
                if 'scale' in c:
                    c['scale'] = [r2(v * scale) for v in c['scale']] if isinstance(c['scale'], list) else round(c['scale'] * scale, 6)
            ch.append(c)
        t['changes'] = ch
        out.append(t)
    return out


def hive_sprite(scout):
    body = {'place': f'{EA}/enemy hive body', 'x': 0, 'y': 0}
    first = {
        'frame': 1,
        'script': ['// drone hive: the enemy generator (level 06 Downtown). Prints enemies while the player is near;',
                   '// destroy it to stop it. Settings and behaviour: as2/enemyGenerator.as',
                   '', '#include "as/object/enemyGenerator.as"'],
        'changes': [
            dict(body, depth=1, name='core_mc', filters=[SHADOW]),
            {'place': f'{EA}/enemy hive vents', 'depth': 2, 'x': 0, 'y': 0, 'name': 'vents_mc', 'filters': [VENT_GLOW]},
            {'place': f'{EA}/enemy hive core', 'depth': 3, 'x': 0, 'y': 0, 'name': 'heart_mc'},
            {'place': '_glow', 'depth': 4, 'x': 0, 'y': 0, 'scale': 1.4, 'name': 'glow_mc', 'blend': 'add',
             'color': {'multiply': [0, 0, 0, 0.8], 'add': [255, 120, 30, 0]}},
            {'place': f'{EA}/enemy hive iris', 'depth': 5, 'x': 0, 'y': 0, 'name': 'iris_mc'},
        ],
    }
    frames = death_frames(scout, body, 2.4, 0.3)
    # frame 2 clears the live parts (depths 1-7 of the scout's frame 1 are cleared by its own removes)
    frames[0]['changes'] = [{'remove': 2}, {'remove': 4}, {'remove': 5}] + [c for c in frames[0]['changes'] if c.get('remove') not in (7,)]
    return {'kind': 'sprite', 'symbol': {'type': 'movie clip', 'linkage': 'enemyHive'}, 'frames': scout['frames'], 'timeline': [first] + frames}


def barrel_bot(scout):
    body = {'place': f'{EA}/designs/tentacle mine', 'x': 0, 'y': 0, 'scale': 0.6}
    first = {
        'frame': 1,
        'script': [
            '// barrel bot: a rolling mine that chases you down and detonates (level 06 Downtown).',
            '// Art: the tentacle mine design from enemies.fw.png, spinning as it rolls.',
            '',
            'if(health == undefined) health = 30;',
            'if(turnSpeed == undefined) turnSpeed = 7;',
            'if(speedMax == undefined) speedMax = 3.4;',
            'if(accel == undefined) accel = .4;',
            'if(resistence == undefined) resistence = 2;',
            'if(blastRange == undefined) blastRange = 100;',
            'if(damage == undefined) damage = 70;',
            'if(frag == undefined) frag = "frag_mc";',
            'if(fragCount == undefined) fragCount = 10;',
            'if(chaser == undefined) chaser = true;',
            'if(suicidal == undefined) suicidal = true;',
            'if(suicideDamage == undefined) suicideDamage = 20;',
            'if(suicideTimeLimit == undefined) suicideTimeLimit = 8 * frameRate;',
            'if(shakeStrength == undefined) shakeStrength = 6;',
            '',
            '#include "as/object/enemyVehicle.as"',
            '',
            '// roll: the body spins with its speed, and the warning light blinks faster as it closes in',
            '__rollUpdate = update;',
            'update = function(time){',
            '    __rollUpdate(time);',
            '    if(_currentframe != 1) return;',
            '    core_mc._rotation += speed * 9 * time;',
            '    var near = attacking ? Math.max(.15, Math.min(1, getDistance(this, _player) / 250)) : 1;',
            '    blink += time / (near * 8);',
            '    light_mc._alpha = 40 + 60 * (Math.sin(blink * Math.PI) > 0);',
            '}',
            'var blink = 0;',
        ],
        'changes': [
            dict(body, depth=1, name='core_mc', filters=[SHADOW]),
            {'place': '_glow', 'depth': 3, 'x': 0, 'y': 0, 'scale': 0.8, 'name': 'light_mc', 'blend': 'add',
             'color': {'multiply': [0, 0, 0, 1], 'add': [255, 40, 20, 0]}},
        ],
    }
    frames = death_frames(scout, body, 1.6, 0.25)
    frames[0]['changes'] = [c for c in frames[0]['changes'] if c.get('remove') not in (7,)]
    return {'kind': 'sprite', 'symbol': {'type': 'movie clip', 'linkage': 'enemyBarrelBot'}, 'frames': scout['frames'], 'timeline': [first] + frames}


IDS = {
    f'{EA}/enemy hive blade': 1600,
    f'{EA}/enemy hive iris': 1601,
    f'{EA}/enemy hive body': 1602,
    f'{EA}/enemy hive vents': 1603,
    f'{EA}/enemy hive core': 1604,
    f'{EA}/enemy hive': 1605,
    f'{EA}/enemy barrel bot': 1606,
}


def main():
    scout = json.load(open(os.path.join(LIB, EA, 'enemy scout.json')))
    write(f'{EA}/enemy hive body', hive_body().json())
    write(f'{EA}/enemy hive vents', hive_vents().json())
    write(f'{EA}/enemy hive core', hive_core().json())
    write(f'{EA}/enemy hive blade', blade().json())
    write(f'{EA}/enemy hive iris', iris_sprite())
    write(f'{EA}/enemy hive', hive_sprite(scout))
    write(f'{EA}/enemy barrel bot', barrel_bot(scout))
    # the Swarmer: the recovered scout drone, given a linkage id so a hive can print it
    dp = os.path.join(LIB, EA, 'enemy drone.json')
    drone = json.load(open(dp))
    drone['symbol']['linkage'] = 'enemySwarmer'
    text = open(dp).read()
    if '"linkage"' not in text:
        text = text.replace('"symbol": {"type": "movie clip"}', '"symbol": {"type": "movie clip", "linkage": "enemySwarmer"}', 1)
        open(dp, 'w', encoding='utf-8', newline='\n').write(text)
    ip = os.path.join(ROOT, 'source', 'ids.json')
    ids = json.load(open(ip))
    ids.update(IDS)
    with open(ip, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n' + ',\n'.join(f'  {json.dumps(k)}: {v}' for k, v in ids.items()) + '\n}\n')
    print('wrote the hive, the barrel bot and the Swarmer linkage')


if __name__ == '__main__':
    main()

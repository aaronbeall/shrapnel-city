"""Level 09 Complex's two new enemies, written as vector symbols in source/library.

    python tools/levels/09_Complex/enemies.py

- Lab Hunter (enemy assets/enemy lab hunter): the "hauler" design from enemies.fw.png (the
  plan's pairing). A crawler that hunts: it roams its wing's path-node network (hunter +
  wanderer), calls the others when it sees you (alerter), closes in (chaser) and fires
  stun shots (shot_mcEStun: the player's engines and guns cut out for a moment).
- Repair Drone (enemy assets/enemy repair drone): a new design. A small four-rotor drone in
  lab white with a green repair lens. Unarmed; it keeps near the other robots and beams
  health back into the most damaged one in reach (as2/enemyRepair.as).

Both reuse the scout's timeline (live frame, then the small-vehicle explosion) with their own
art swapped in. Symbol ids are pinned in source/ids.json in the 1900s (09's range).
Re-running rewrites these files only.
"""
import copy
import json
import math
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LIB = os.path.join(ROOT, 'source', 'library')
EA = 'enemy assets'


def r(v): return round(v, 2)


def poly(pts):
    return 'M ' + ' L '.join(f'{r(x)} {r(y)}' for x, y in pts) + ' Z'


def ngon(cx, cy, rad, n, rot=0.0):
    return [(cx + rad * math.cos(rot + 2 * math.pi * i / n), cy + rad * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]


def rrect(x0, y0, x1, y1, c):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def rot(pts, a):
    ca, sa = math.cos(a), math.sin(a)
    return [(x * ca - y * sa, x * sa + y * ca) for x, y in pts]


def solid(c): return {'type': 'solid', 'color': c}


def radial(cx, cy, rad, stops):
    return {'type': 'radial gradient', 'm': [rad, 0, 0, rad, cx, cy], 'spread': 0, 'interp': 0, 'stops': stops}


def linear(x0, y0, x1, y1, stops):
    ax, ay = (x1 - x0) / 2, (y1 - y0) / 2
    return {'type': 'linear gradient', 'm': [r(ax), r(ay), r(-ay), r(ax), r((x0 + x1) / 2), r((y0 + y1) / 2)], 'spread': 0, 'interp': 0, 'stops': stops}


def shape(paths):
    fills, out, xs, ys = [], [], [], []
    for f, polys in paths:
        fills.append(f)
        out.append({'fill': len(fills) - 1, 'd': ' '.join(poly(p) for p in polys)})
        for p in polys:
            xs += [x for x, _ in p]
            ys += [y for _, y in p]
    return {'kind': 'shape', 'bounds': [r(min(xs)), r(max(xs)), r(min(ys)), r(max(ys))], 'fills': fills, 'lines': [], 'paths': out}


def sprite(changes, frames=1, script=None):
    f = {'frame': 1}
    if script: f['script'] = script
    f['changes'] = changes
    return {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': frames, 'timeline': [f]}


written = []


def write(name, obj):
    p = os.path.join(LIB, name + '.json')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(obj, indent=2) + '\n')
    written.append(name)


SHADOW = {'type': 'dropShadow', 'color': '#00000030', 'blurX': 4, 'blurY': 4, 'angle': 0.785398, 'distance': 10, 'strength': 1,
          'inner': False, 'knockout': False, 'passes': 2}


def from_scout(name, art, matrix, muzzle_y, script, art_filters=None):
    """The scout's timeline with `art` as the body: frame 1 live, frames 2-15 the explosion with
    the body darkened underneath."""
    sc = json.load(open(os.path.join(LIB, f'{EA}/enemy scout.json')))
    tl = copy.deepcopy(sc['timeline'])
    tl[0]['script'] = script
    for t in tl:
        for c in t.get('changes', []):
            if c.get('place') == f'{EA}/designs/dart':
                c['place'] = art
                if matrix: c['matrix'] = matrix
                else: c.pop('matrix', None)
                if art_filters and t['frame'] == 1: c['filters'] = art_filters
            if t['frame'] == 1 and c.get('name') in ('flash_mc', 'muzzle_mc'):
                c['y'] = muzzle_y
    write(name, {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': sc['frames'], 'timeline': tl})


# ---------------------------------------------------------------- Lab Hunter
def lab_hunter():
    from_scout(f'{EA}/enemy lab hunter', f'{EA}/designs/hauler', [-1.05, 0, 0, -1.05], -21, [
        '// Lab Hunter (level 09 Complex): a crawler that hunts. It roams the path-node network of its',
        '// colour (hunter + wanderer: set pathID to the colour), calls every hunter when it sees you',
        '// (alerter), closes in (chaser) and fires stun shots (shot_mcEStun). Art: the hauler design',
        '// from enemies.fw.png',
        '',
        'if(health == undefined) health = 70;',
        'if(turnSpeed == undefined) turnSpeed = 7;',
        'if(speedMax == undefined) speedMax = 2.6;',
        'if(accel == undefined) accel = .4;',
        'if(shot == undefined) shot = "shot_mcEStun";',
        'if(shotSpread == undefined) shotSpread = 5;',
        'if(refireRate == undefined) refireRate = 7;',
        'if(burstCount == undefined) burstCount = 2;',
        'if(burstReload == undefined) burstReload = 50;',
        'if(resistence == undefined) resistence = 6;',
        'if(blastRange == undefined) blastRange = 45;',
        'if(damage == undefined) damage = 10;',
        'if(shakeStrength == undefined) shakeStrength = 0;',
        'if(hunter == undefined) hunter = true;',
        'if(wanderer == undefined) wanderer = true;',
        'if(chaser == undefined) chaser = true;',
        'if(chaseDistance == undefined) chaseDistance = 130;',
        '',
        '#include "as/object/enemyVehicle.as"',
    ])


# ---------------------------------------------------------------- Repair Drone
def repair_drone():
    base = f'{EA}/enemy repair drone'
    steel = [[0, '#c9d2d8'], [0.55, '#76838c'], [1, '#353d43']]
    hull = [[0, '#ffffff'], [0.45, '#dfe6ea'], [1, '#8a979f']]
    parts = []
    # four arms out to the rotors, and their rotor rings and blurred blades
    arm = [(-2.2, 0), (2.2, 0), (2.2, -17), (-2.2, -17)]
    arms = [rot(arm, math.pi / 4 + k * math.pi / 2) for k in range(4)]
    parts.append((solid('#000000'), [[(x + 0.8, y + 0.8) for x, y in a] for a in arms]))
    parts.append((linear(-2, 0, 2, 0, [[0, '#2f363b'], [0.5, '#8f9aa2'], [1, '#2f363b']]), arms))
    hubs = [(math.cos(math.pi / 4 + k * math.pi / 2) * 15.5, math.sin(math.pi / 4 + k * math.pi / 2) * 15.5) for k in range(4)]
    parts.append((solid('#1d2226'), [ngon(x, y, 7.6, 16) for x, y in hubs]))
    for x, y in hubs:
        parts.append((radial(x, y, 7, [[0, '#d8e2e899'], [0.7, '#9aa6ae55'], [1, '#5c666d33']]), [ngon(x, y, 6.6, 16)]))
        parts.append((solid('#2a3136'), [ngon(x, y, 1.8, 8)]))
    # the hull: a white octagon with a green band and a dark well
    parts.append((solid('#000000'), [ngon(0.8, 0.8, 12.4, 8, math.pi / 8)]))
    parts.append((radial(-4, -5, 17, hull), [ngon(0, 0, 11.8, 8, math.pi / 8)]))
    band = []
    for k in range(8):
        a0, a1 = math.pi / 8 + k * math.pi / 4, math.pi / 8 + (k + 1) * math.pi / 4
        if k % 2 == 0:
            band.append([(math.cos(a0) * 10.6, math.sin(a0) * 10.6), (math.cos(a1) * 10.6, math.sin(a1) * 10.6),
                         (math.cos(a1) * 8.4, math.sin(a1) * 8.4), (math.cos(a0) * 8.4, math.sin(a0) * 8.4)])
    parts.append((solid('#1fa463'), band))
    parts.append((radial(1, 1, 8, [[0, '#2b3237'], [1, '#101417']]), [ngon(0, 0, 7.2, 16)]))
    # the repair lens, and the emitter nub at the front (up)
    parts.append((radial(-0.8, -0.8, 5.5, [[0, '#eaffef'], [0.35, '#6dff9e'], [0.8, '#13a34e'], [1, '#063d1d']]), [ngon(0, 0, 4.6, 16)]))
    parts.append((linear(-2.5, 0, 2.5, 0, steel), [rrect(-2.6, -15, 2.6, -10.5, 1)]))
    parts.append((solid('#6dff9e'), [rrect(-1.4, -16.2, 1.4, -14.6, 0.5)]))
    write(f'{base} body/shape 1', shape(parts))
    write(f'{base} body', sprite([{'place': f'{base} body/shape 1', 'depth': 1, 'x': 0, 'y': 0}]))
    from_scout(base, f'{base} body', None, -15, [
        '// Repair Drone (level 09 Complex): an unarmed flyer that keeps near the other robots and',
        '// beams health back into the most damaged one in reach (as2/enemyRepair.as: healRange,',
        '// healAmount, healRate). Art: a new vector design.',
        '',
        'if(health == undefined) health = 45;',
        'if(turnSpeed == undefined) turnSpeed = 8;',
        'if(speedMax == undefined) speedMax = 2.8;',
        'if(accel == undefined) accel = .45;',
        'if(strafeAccel == undefined) strafeAccel = .25;',
        'if(shot == undefined) shot = "";',
        'if(visionRange == undefined) visionRange = 1;',
        'if(resistence == undefined) resistence = 2;',
        'if(blastRange == undefined) blastRange = 40;',
        'if(damage == undefined) damage = 8;',
        'if(shakeStrength == undefined) shakeStrength = 0;',
        '',
        '#include "as/object/enemyRepair.as"',
    ], art_filters=[SHADOW])


def pin_ids():
    """Give the new symbols ids in 09's range (1900-1999) so they don't clash with other levels'."""
    p = os.path.join(ROOT, 'source', 'ids.json')
    ids = json.load(open(p))
    used = set(ids.values())
    nxt = 1900
    for name in written:
        if name in ids: continue
        while nxt in used: nxt += 1
        ids[name] = nxt
        used.add(nxt)
    with open(p, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(ids, indent=2) + '\n')


if __name__ == '__main__':
    lab_hunter()
    repair_drone()
    pin_ids()
    print('wrote', ', '.join(written))

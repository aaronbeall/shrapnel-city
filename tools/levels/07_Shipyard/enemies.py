"""Level 07 Shipyard's two new enemies, written as vector symbols in source/library.

    python tools/levels/07_Shipyard/enemies.py

- Deck Battery (enemy assets/enemy deck battery): the objective. A heavy rocket battery bolted
  to a warship's deck; its turret is the "missile launcher blue" design from enemies.fw.png
  (the plan's pairing), on a new octagonal deck mount ringed in red and white so you can tell
  a target from the ordinary guns. Two rocket pods fire salvos of enemy rockets.
- Flak Turret (enemy assets/enemy flak turret): a new design. A quad-barrelled anti-aircraft
  mount in naval grey with a hazard band on its gun shield, firing bursts of flak shells that
  burst into shrapnel (shot_mcEOrange), so it fills an area rather than aiming at a point.

Both are enemyTurret, like the double battery, and reuse its destruction timeline with their
own parts swapped in. Symbol ids are pinned in source/ids.json in the 1700s (07's range).
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


def solid(c): return {'type': 'solid', 'color': c}


def radial(cx, cy, rad, stops):
    return {'type': 'radial gradient', 'm': [rad, 0, 0, rad, cx, cy], 'spread': 0, 'interp': 0, 'stops': stops}


def linear(x0, y0, x1, y1, stops):
    """A linear gradient from (x0, y0) to (x1, y1)."""
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


BEVEL = {'type': 'bevel', 'shadow': '#000000', 'highlight': '#9fb4c4', 'blurX': 1, 'blurY': 1, 'angle': 0.785385, 'distance': 3,
         'strength': 0.5, 'inner': True, 'knockout': False, 'onTop': False, 'passes': 1}
SHADOW = {'type': 'dropShadow', 'color': '#00000059', 'blurX': 4, 'blurY': 4, 'angle': 0.785398, 'distance': 4, 'strength': 1,
          'inner': False, 'knockout': False, 'passes': 2}


# ---------------------------------------------------------------- Deck Battery
def deck_battery():
    base = f'{EA}/enemy deck battery'
    # the deck mount: an octagonal steel plate, a red and white target ring, a dark well
    ring = []
    n = 16
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        ring.append((solid('#c8352b') if i % 2 else solid('#e6e0cf'),
                     [[(math.cos(a0) * 28, math.sin(a0) * 28), (math.cos(a1) * 28, math.sin(a1) * 28),
                       (math.cos(a1) * 23.5, math.sin(a1) * 23.5), (math.cos(a0) * 23.5, math.sin(a0) * 23.5)]]))
    bolts = [(solid('#1a1f24'), [ngon(x, y, 1.6, 8) for x, y in ngon(0, 0, 31.5, 8, math.pi / 8)])]
    write(f'{base} core/shape 1', shape([
        (solid('#000000'), [ngon(0.8, 0.8, 35.5, 8, math.pi / 8)]),
        (radial(-10, -12, 46, [[0, '#7d8a95'], [1, '#2c343b']]), [ngon(0, 0, 34.5, 8, math.pi / 8)]),
        *bolts,
        (solid('#15191d'), [ngon(0, 0, 29, 32)]),
        *ring,
        (radial(4, 4, 26, [[0, '#2a3036'], [1, '#0e1114']]), [ngon(0, 0, 23, 32)]),
    ]))
    write(f'{base} core', sprite([{'place': f'{base} core/shape 1', 'depth': 1, 'x': 0, 'y': 0}]))
    # the turret: the missile launcher blue design, turned to face up (the turret's forward) and enlarged
    write(f'{base} turret body', sprite([{'place': f'{EA}/designs/missile launcher blue', 'depth': 1, 'x': 0, 'y': 0, 'matrix': [-1.45, 0, 0, -1.45]}]))
    flash = json.load(open(os.path.join(LIB, f'{EA}/enemy double battery flash.json')))
    xs = [-21, 21, -21, 21]
    for c, x in zip(flash['timeline'][0]['changes'], xs): c['x'] = x
    write(f'{base} flash', flash)
    write(f'{base} turret', sprite([
        {'place': f'{base} turret body', 'depth': 1, 'x': 0, 'y': 0, 'filters': [SHADOW]},
        {'place': '_blank MC', 'depth': 7, 'x': -21, 'y': -22, 'name': 'muzzle_mc1'},
        {'place': '_blank MC', 'depth': 9, 'x': 21, 'y': -22, 'name': 'muzzle_mc2'},
        {'place': f'{base} flash', 'depth': 11, 'x': 0, 'y': -22, 'name': 'flash_mc', 'clipEvents': [1],
         'script': ['onClipEvent (load) {', '    _visible = false;', '}', '']},
    ]))
    script = [
        '// Deck Battery (level 07 Shipyard): the objective on each warship. Art: the missile launcher blue',
        '// design from enemies.fw.png on a red and white ringed deck mount. Set objective = true on the',
        '// ones the exit waits for (see checkExit in functionsLevel.as).',
        '',
        'if(health == undefined) health = 700;',
        'if(turnSpeed == undefined) turnSpeed = 1.2;',
        'if(shot == undefined) shot = "shot_mcERocket";',
        'if(shotSpread == undefined) shotSpread = 6;',
        'if(refireRate == undefined) refireRate = 9;',
        'if(burstCount == undefined) burstCount = 3;',
        'if(burstReload == undefined) burstReload = 85;',
        'if(debrisCount == undefined) debrisCount = 15;',
        'if(blastRange == undefined) blastRange = 90;',
        'if(damage == undefined) damage = 40;',
        'if(powerupDrop == undefined)',
        '\tpowerupDrop = {type:"health", item:"health", quantity:25};',
        '',
        '#include "as/object/enemyTurret.as"',
    ]
    death(base, f'{base} core', f'{base} turret body', script, core_scale=1)


# ---------------------------------------------------------------- Flak Turret
def flak_turret():
    base = f'{EA}/enemy flak turret'
    steel = [[0, '#a7b3bd'], [0.5, '#5d6a74'], [1, '#2a3239']]
    write(f'{base} core/shape 1', shape([
        (solid('#000000'), [ngon(0.6, 0.6, 20.5, 12, math.pi / 12)]),
        (radial(-6, -7, 28, steel), [ngon(0, 0, 19.5, 12, math.pi / 12)]),
        (solid('#1b2126'), [ngon(x, y, 1.4, 8) for x, y in ngon(0, 0, 16.5, 6, math.pi / 6)]),
        (solid('#20272d'), [ngon(0, 0, 13, 24)]),
    ]))
    write(f'{base} core', sprite([{'place': f'{base} core/shape 1', 'depth': 1, 'x': 0, 'y': 0}]))
    barrels = []
    for x in (-9, -4, 4, 9):
        barrels.append((linear(x - 1.6, 0, x + 1.6, 0, [[0, '#2b3136'], [0.45, '#a9b2b9'], [1, '#2b3136']]), [rrect(x - 1.6, -31, x + 1.6, -6, 0.6)]))
        barrels.append((solid('#1b1f23'), [rrect(x - 2.4, -35, x + 2.4, -30, 0.8)]))
    stripes = []
    for k in range(7):
        x = -13 + k * 4.4
        stripes.append([(x, 9), (x + 2.2, 9), (x + 4.4, 4), (x + 2.2, 4)])
    write(f'{base} turret body/shape 1', shape([
        (solid('#000000'), [rrect(-16.2, -13.2, 16.2, 13.2, 6)]),
        *barrels,
        (linear(-14, -12, 14, 12, [[0, '#9eacb7'], [0.55, '#56636d'], [1, '#2e373e']]), [rrect(-15, -12, 15, 12, 5.5)]),
        (solid('#181c20'), [rrect(-13.5, 3.5, 13.5, 9.5, 1.5)]),
        (solid('#e3b52c'), [[(max(-13, min(13, x)), y) for x, y in s] for s in stripes]),
        (solid('#30383f'), [rrect(-11, -9.5, 11, 0.5, 3)]),
        (radial(-1, -5, 5, [[0, '#ff7a5c'], [0.6, '#c52a1c'], [1, '#5a0d08']]), [ngon(0, -4.5, 3.6, 16)]),
    ]))
    write(f'{base} turret body', sprite([{'place': f'{base} turret body/shape 1', 'depth': 1, 'x': 0, 'y': 0}]))
    flash = json.load(open(os.path.join(LIB, f'{EA}/enemy double battery flash.json')))
    for c, x in zip(flash['timeline'][0]['changes'], [-6.5, 6.5, -6.5, 6.5]):
        c['x'] = x
        c['scale'] = [c['scale'][0] * 0.8, c['scale'][1] * 0.6] if isinstance(c.get('scale'), list) else c.get('scale', 1)
    write(f'{base} flash', flash)
    write(f'{base} turret', sprite([
        {'place': f'{base} turret body', 'depth': 1, 'x': 0, 'y': 0, 'filters': [BEVEL, SHADOW]},
        {'place': '_blank MC', 'depth': 7, 'x': -6.5, 'y': -35, 'name': 'muzzle_mc1'},
        {'place': '_blank MC', 'depth': 9, 'x': 6.5, 'y': -35, 'name': 'muzzle_mc2'},
        {'place': f'{base} flash', 'depth': 11, 'x': 0, 'y': -35, 'name': 'flash_mc', 'clipEvents': [1],
         'script': ['onClipEvent (load) {', '    _visible = false;', '}', '']},
    ]))
    script = [
        '// Flak Turret (level 07 Shipyard): a quad-barrelled anti-aircraft mount. Bursts of flak shells',
        '// that break into shrapnel, so it covers an area rather than a point. Art: a new vector design.',
        '',
        'if(health == undefined) health = 140;',
        'if(turnSpeed == undefined) turnSpeed = 4;',
        'if(shot == undefined) shot = "shot_mcEOrange";',
        'if(shotSpread == undefined) shotSpread = 26;',
        'if(refireRate == undefined) refireRate = 6;',
        'if(burstCount == undefined) burstCount = 3;',
        'if(burstReload == undefined) burstReload = 70;',
        'if(visionRange == undefined) visionRange = 360;',
        '',
        '#include "as/object/enemyTurret.as"',
    ]
    death(base, f'{base} core', f'{base} turret body', script, core_scale=0.6)


def death(base, core, body, script, core_scale):
    """The enemy itself: frame 1 live (core + turret), frames 2-15 the double battery's
    destruction with this enemy's own wrecked core and turret body."""
    db = json.load(open(os.path.join(LIB, f'{EA}/enemy double battery.json')))
    tl = copy.deepcopy(db['timeline'])
    tl[0] = {'frame': 1, 'script': script, 'changes': [
        {'place': core, 'depth': 1, 'x': 0, 'y': 0, 'name': 'core_mc'},
        {'place': f'{base} turret', 'depth': 5, 'x': 0, 'y': 0, 'name': 'turret_mc'},
    ]}
    dark = {'multiply': [0.45, 0.45, 0.45, 1]}
    for f in tl[1:]:
        for c in f['changes']:
            if c.get('place') == f'{EA}/enemy double battery/shape 1':
                c.update(place=core, color=dark)
            elif c.get('place') == f'{EA}/enemy double battery turret body':
                c['place'] = body
                c['color'] = dark
                c.pop('ratio', None)
                c.pop('filters', None)
            elif c.get('update') == 3:
                c.pop('filters', None)
            # the explosion art is sized for the double battery; scale it to this enemy
            if c.get('scale') and core_scale != 1 and c.get('depth', c.get('update')) in (9, 10, 11, 13):
                s = c['scale']
                c['scale'] = [v * core_scale for v in s] if isinstance(s, list) else s * core_scale
    write(base, {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': db['frames'], 'timeline': tl})


def pin_ids():
    """Give the new symbols ids in 07's range (1700-1799) so they don't clash with 05's and 06's."""
    p = os.path.join(ROOT, 'source', 'ids.json')
    ids = json.load(open(p))
    used = set(ids.values())
    nxt = 1700
    for name in written:
        if name in ids: continue
        while nxt in used: nxt += 1
        ids[name] = nxt
        used.add(nxt)
    with open(p, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(ids, indent=2) + '\n')


if __name__ == '__main__':
    deck_battery()
    flak_turret()
    pin_ids()
    print('wrote', len(written), 'symbols:', ', '.join(w.split('/', 1)[1] for w in written))

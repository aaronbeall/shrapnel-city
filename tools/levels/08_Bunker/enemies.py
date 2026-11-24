"""Level 08 Bunker's two new enemies, the mortar shell and the new bomb's shot, written as vector symbols in
source/library.

    python tools/levels/08_Bunker/enemies.py

- Walker (enemy assets/enemy walker): the "spider" design from enemies.fw.png (the plan's
  pairing, Aaron's note: spider IS the walker). Built like the enemy tank, an enemyVehicle
  with an independently aiming turret: its body plates (spider shape 3) are the core, its
  dome (spider shape 2) becomes the turret with a pair of new gun barrels, and four new legs
  drawn in the spider's style (black struts, olive armour, dark foot pads) walk under it.
  The legs are its locomotion_mc: like the tank's treads, enemyVehicle steps that clip on by
  the distance moved (31 frames a pixel), so the gait is keyed to the ground: diagonal pairs
  of legs alternate, each planted foot sliding back as the body walks over it while the
  other pair swings forward, lifted (a little larger).
- Bunker Mortar (enemy assets/enemy bunker mortar): the "carrier nuke" design, a squat
  tracked hull with a hazard-marked hatch, as a fixed emplacement. as2/enemyMortar.as: it
  needs no line of sight, only range, and lobs shells over walls at where you're going.
- Bunker Buster (the level's new bomb, player.as): shot_mcBuster on screen_mc, the unused
  "shot MC bomb3" art; a heavy bomb with a huge blast (as2/shots/shot_mcBuster.as).
- shot MC enemy mortar: the shell (as2/enemyProjectileMortar.as): flies an arc over
  everything to its target, with a closing red ring on the ground where it will land, and
  bursts there. Placed on screen_mc as shot_mcEMortar (params in as2/shots/shot_mcEMortar.as).

Symbol ids are pinned in source/ids.json in the 1800s (08's range). Re-running rewrites
these files only (and the shot_mcEMortar entry in screen_mc.json).
"""
import copy
import json
import math
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LIB = os.path.join(ROOT, 'source', 'library')
EA = 'enemy assets'
WA = 'weapon assets'


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


def shape(paths, lines=()):
    """paths: [(fill, [polygon, ...]), ...] bottom first; several polygons in one path use
    even-odd holes. lines: [(width, colour, [(x, y), ...]), ...] drawn on top."""
    fills, out, xs, ys, ls = [], [], [], [], []
    for f, polys in paths:
        fills.append(f)
        out.append({'fill': len(fills) - 1, 'd': ' '.join(poly(p) for p in polys)})
        for p in polys:
            xs += [x for x, _ in p]
            ys += [y for _, y in p]
    for w, c, pts in lines:
        ls.append({'width': w, 'cap': 0, 'ecap': 0, 'join': 0, 'noScale': False, 'noClose': False, 'color': c})
        out.append({'line': len(ls) - 1, 'd': 'M ' + ' L '.join(f'{r(x)} {r(y)}' for x, y in pts)})
    return {'kind': 'shape', 'bounds': [r(min(xs)), r(max(xs)), r(min(ys)), r(max(ys))], 'fills': fills, 'lines': ls, 'paths': out}


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


SHADOW = {'type': 'dropShadow', 'color': '#00000059', 'blurX': 3, 'blurY': 3, 'angle': 0.785398, 'distance': 4, 'strength': 1,
          'inner': False, 'knockout': False, 'passes': 2}
PLATE_BEVEL = {'type': 'bevel', 'shadow': '#00000040', 'highlight': '#ffffff40', 'blurX': 2, 'blurY': 2, 'angle': 0.785398, 'distance': 1,
               'strength': 1, 'inner': True, 'knockout': False, 'onTop': False, 'passes': 2}
FLIP = 1.8   # the spider design is small and faces down: shown at this scale, turned to face up
PLATES, DOME = 2.3, 1.35   # its body plates a little bigger, its dome (the turret) smaller, so both read


# ---------------------------------------------------------------- Walker
LEG = 27                                  # hip to foot, px
HIPS = [(-11, -9, 'front'), (11, -9, 'front'), (-11, 11, 'back'), (11, 11, 'back')]   # left/right, front/back
BASE = {(-1, 'front'): -140, (1, 'front'): -40, (-1, 'back'): 140, (1, 'back'): 40}    # rest angle, degrees clockwise from +x
SWING = 16                                # degrees each way from rest
STRIDE = 22                               # px walked per full gait cycle
KEY = 8                                   # a key every 8 frames (1/4 px)
FPP = 31                                  # locomotion frames per px moved (enemyVehicle: speed * frameRate)


def walker_leg():
    """One leg, hip at the origin, reaching along +x to its foot at (LEG, 0)."""
    k = LEG
    write(f'{EA}/enemy walker leg/shape 1', shape([
        # olive armour over the hip
        (linear(0, -5, 0, 5, [[0, '#625a39'], [1, '#000000']]), [[(-2, -5), (8, -4.5), (10, 0), (8, 4.5), (-2, 5)]]),
        # thigh: a black strut with a light top edge (the spider's leg gradient)
        (solid('#000000'), [[(8, -2.6), (k * 0.55, -2.2), (k * 0.55, 2.2), (8, 2.6)]]),
        (linear(0, -2.6, 0, 1, [[0, '#666666'], [1, '#000000']]), [[(8, -2.6), (k * 0.55, -2.2), (k * 0.55, -0.4), (8, -0.6)]]),
        # knee
        (radial(k * 0.55 - 0.8, -0.8, 3.6, [[0, '#5d5a4c'], [1, '#0b0b0b']]), [ngon(k * 0.55, 0, 3.2, 10)]),
        # shin, thinner, to the foot
        (solid('#0d0d0d'), [[(k * 0.55, -1.7), (k - 3, -1.4), (k - 3, 1.4), (k * 0.55, 1.7)]]),
        # foot pad: dark, with an olive gradient like the spider's feet
        (linear(k - 4, 0, k + 3, 0, [[0, '#625a39'], [1, '#000000']]), [rrect(k - 4, -4, k + 3, 4, 1.5)]),
    ], lines=[(1, '#202020', [(9, 0.4), (k * 0.55 - 3, 0.3)])]))
    write(f'{EA}/enemy walker leg', sprite([{'place': f'{EA}/enemy walker leg/shape 1', 'depth': 1, 'x': 0, 'y': 0}]))


def leg_pose(side, end, phase):
    """Angle (degrees) and size of a leg at gait phase 0..1: planted for the first half, its
    foot sliding back as the body walks forward; swung forward, lifted, for the second."""
    base = BASE[(side, end)]
    back = 1 if side > 0 else -1           # clockwise turns a right leg's foot backward (+y)
    if phase < 0.5:
        t = phase / 0.5
        off, lift = -SWING + 2 * SWING * t, 0.0
    else:
        t = (phase - 0.5) / 0.5
        off, lift = SWING - 2 * SWING * (0.5 - 0.5 * math.cos(math.pi * t)), math.sin(math.pi * t)
    return base + back * off, 1 + 0.12 * lift


def walker_legs():
    """The legs clip: STRIDE * FPP frames make one gait cycle."""
    frames = STRIDE * FPP
    tl = []
    for f in range(1, frames + 1, KEY):
        p = (f - 1) / frames
        changes = []
        for i, (hx, hy, end) in enumerate(HIPS):
            side = 1 if hx > 0 else -1
            # diagonal pairs: front-left with back-right, front-right with back-left
            pair = (side > 0) == (end == 'front')
            a, s = leg_pose(side, end, (p + (0.5 if pair else 0)) % 1)
            ca, sa = math.cos(math.radians(a)) * s, math.sin(math.radians(a)) * s
            m = [round(ca, 4), round(sa, 4), round(-sa, 4), round(ca, 4)]
            if f == 1: changes.append({'place': f'{EA}/enemy walker leg', 'depth': i + 1, 'x': hx, 'y': hy, 'matrix': m})
            else: changes.append({'update': i + 1, 'x': hx, 'y': hy, 'matrix': m})
        tl.append({'frame': f, 'changes': changes})
    write(f'{EA}/enemy walker legs', {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': frames, 'timeline': tl})


def walker():
    base = f'{EA}/enemy walker'
    walker_leg()
    walker_legs()
    # core: a dark olive belly pan under the spider's body plates
    write(f'{base} core/shape 1', shape([
        (solid('#000000'), [rrect(-11, -14, 11, 16, 5)]),
        (radial(-3, -5, 18, [[0, '#4a4636'], [1, '#141310']]), [rrect(-10, -13, 10, 15, 4.5)]),
    ]))
    write(f'{base} core', sprite([
        {'place': f'{base} core/shape 1', 'depth': 1, 'x': 0, 'y': 0},
        {'place': f'{EA}/designs/spider/shape 3', 'depth': 2, 'x': 1, 'y': 3, 'matrix': [-PLATES, 0, 0, -PLATES], 'filters': [PLATE_BEVEL]},
    ]))
    # turret: the spider's dome (its red eye slit to the front) with twin gun barrels
    write(f'{base} turret/shape 1', shape([
        (solid('#000000'), [rrect(-5.7, -24, -1.7, -5, 1), rrect(1.7, -24, 5.7, -5, 1)]),
        (linear(-6, 0, -2, 0, [[0, '#6b6b6b'], [1, '#111111']]), [rrect(-5.1, -23.4, -2.3, -6, 0.8)]),
        (linear(2, 0, 6, 0, [[0, '#6b6b6b'], [1, '#111111']]), [rrect(2.3, -23.4, 5.1, -6, 0.8)]),
        (solid('#1b1b1b'), [rrect(-6.5, -21, -1, -18, 0.6), rrect(1, -21, 6.5, -18, 0.6)]),
    ]))
    write(f'{base} turret', sprite([
        {'place': f'{base} turret/shape 1', 'depth': 1, 'x': 0, 'y': 0, 'filters': [SHADOW]},
        {'place': f'{EA}/designs/spider/shape 2', 'depth': 2, 'x': 0, 'y': 0, 'matrix': [-DOME, 0, 0, -DOME], 'filters': [SHADOW]},
        {'place': '_glow', 'depth': 3, 'x': 0, 'y': -25, 'scale': [0.9, 0.9], 'name': 'flash_mc',
         'color': {'multiply': [0.75, 0.75, 0.75, 0.3984375], 'add': [64, 40, 90, 0]}, 'blend': 'add',
         'script': ['onClipEvent (load) {', '    _visible = false;', '}', '']},
        {'place': '_blank MC', 'depth': 4, 'x': -3.7, 'y': -24, 'name': 'muzzle_mc1'},
        {'place': '_blank MC', 'depth': 5, 'x': 3.7, 'y': -24, 'name': 'muzzle_mc2'},
    ]))
    script = [
        '// Walker (level 08 Bunker): a slow, armoured patroller on four legs. Art: the spider design',
        '// from enemies.fw.png; legs walk like the tank treads roll (locomotion_mc, keyed to distance).',
        '',
        'if(health == undefined) health = 320;',
        'if(turnSpeed == undefined) turnSpeed = 2.5;',
        'if(speedMax == undefined) speedMax = 1.3;',
        'if(accel == undefined) accel = .08;',
        'if(shot == undefined) shot = "shot_mcEPurple";',
        'if(shotSpread == undefined) shotSpread = 6;',
        'if(refireRate == undefined) refireRate = 6;',
        'if(burstCount == undefined) burstCount = 4;',
        'if(burstReload == undefined) burstReload = 48;',
        'if(resistence == undefined) resistence = 80;',
        'if(patroller == undefined) patroller = true;',
        'if(pathID == undefined) pathID = "auto";',
        'if(fixed == undefined) fixed = true;',
        '',
        '#include "as/object/enemyVehicle.as"',
    ]
    # the tank's destruction, with the walker's own wreck
    tank = json.load(open(os.path.join(LIB, f'{EA}/enemy tank.json')))
    tl = copy.deepcopy(tank['timeline'])
    tl[0] = {'frame': 1, 'script': script, 'changes': [
        {'place': f'{base} legs', 'depth': 1, 'x': 0, 'y': 0, 'name': 'locomotion_mc'},
        {'place': f'{base} core', 'depth': 2, 'x': 0, 'y': 0, 'name': 'core_mc'},
        {'place': f'{base} turret', 'depth': 4, 'x': 0, 'y': 0, 'name': 'turret_mc'},
    ]}
    dark = {'multiply': [0.4, 0.38, 0.36, 1]}
    f2 = tl[1]['changes']
    for c in f2:
        if c.get('place') == f'{EA}/enemy tank/shape 1': c.update(place=f'{base} legs', x=0, y=0, color=dark)
        elif c.get('place') == f'{EA}/enemy tank/shape 2': c.update(place=f'{base} core', x=0, y=0, color=dark); c.pop('scale', None)
        elif c.get('place') == f'{EA}/enemy tank/shape 3': c.update(place=f'{EA}/designs/spider/shape 2', x=3, y=4, matrix=[-DOME * 0.9, 0.5, -0.5, -DOME * 0.9], color=dark)
    write(base, {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': tank['frames'], 'timeline': tl})


# ---------------------------------------------------------------- Bunker Mortar
def mortar():
    base = f'{EA}/enemy bunker mortar'
    S = 1.25
    write(f'{base} core', sprite([
        {'place': f'{EA}/designs/carrier nuke', 'depth': 1, 'x': 0, 'y': 0, 'scale': S},
    ]))
    # muzzle flash over the hatch (the hazard trefoil, which is where the shells come out)
    write(base + ' flash', sprite([
        {'place': '_glow', 'depth': 1, 'x': 0, 'y': 0, 'scale': [1.6, 1.6], 'color': {'multiply': [0.8, 0.7, 0.4, 0.6], 'add': [90, 60, 0, 0]}, 'blend': 'add'},
    ]))
    script = [
        '// Bunker Mortar (level 08 Bunker): a fixed emplacement that lobs shells over walls, so cover',
        '// does not help: keep moving. Art: the carrier nuke design from enemies.fw.png.',
        '',
        'if(health == undefined) health = 360;',
        'if(shot == undefined) shot = "shot_mcEMortar";',
        'if(refireRate == undefined) refireRate = 62;',
        'if(mortarRange == undefined) mortarRange = 430;',
        'if(mortarMinRange == undefined) mortarMinRange = 70;',
        'if(debrisCount == undefined) debrisCount = 12;',
        'if(resistence == undefined) resistence = 60;',
        'if(powerupDrop == undefined)',
        '\tpowerupDrop = {type:"health", item:"health", quantity:25, probability:.5};',
        '',
        '#include "as/object/enemyMortar.as"',
    ]
    db = json.load(open(os.path.join(LIB, f'{EA}/enemy double battery.json')))
    tl = copy.deepcopy(db['timeline'])
    tl[0] = {'frame': 1, 'script': script, 'changes': [
        {'place': f'{base} core', 'depth': 1, 'x': 0, 'y': 0, 'name': 'core_mc'},
        {'place': f'{base} flash', 'depth': 6, 'x': 0, 'y': -17 * S, 'name': 'flash_mc',
         'script': ['onClipEvent (load) {', '    _visible = false;', '}', '']},
        {'place': '_blank MC', 'depth': 7, 'x': 0, 'y': -17 * S, 'name': 'muzzle_mc'},
    ]}
    dark = {'multiply': [0.42, 0.4, 0.38, 1]}
    tl[1]['changes'] = [{'remove': 6}, {'remove': 7}] + tl[1]['changes']
    for f in tl[1:]:
        for c in f['changes']:
            if c.get('place') == f'{EA}/enemy double battery/shape 1':
                c.update(place=f'{base} core', color=dark)
            elif c.get('place') in (f'{EA}/enemy double battery turret body', f'{EA}/enemy double battery/shape tween 1'):
                c.update(place='_blank MC')
                for k in ('ratio', 'filters', 'color'): c.pop(k, None)
            elif c.get('update') == 3:
                c.pop('filters', None)
    write(base, {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': db['frames'], 'timeline': tl})


def mortar_shell():
    """The shell: a dark round shell with a yellow band, seen from above; frames 2+ are the
    enemy cannon shell's explosion, bigger."""
    base = f'{WA}/shot MC enemy mortar'
    write(base + '/shape 1', shape([
        (solid('#000000'), [ngon(0.6, 0.6, 5.6, 16)]),
        (radial(-1.5, -1.5, 6, [[0, '#8a8578'], [1, '#26241f']]), [ngon(0, 0, 5, 16)]),
        (solid('#c9a227'), [ngon(0, 0, 3.6, 16), ngon(0, 0, 2.6, 16)]),
        (radial(-0.5, -0.5, 2.4, [[0, '#ff9c5a'], [1, '#7a1d0b']]), [ngon(0, 0, 1.8, 10)]),
    ]))
    sh = json.load(open(os.path.join(LIB, f'{WA}/shot MC enemy shell.json')))
    tl = copy.deepcopy(sh['timeline'])
    tl[0] = {'frame': 1, 'script': '#include "as/object/enemyProjectileMortar.as"', 'changes': [
        {'place': base + '/shape 1', 'depth': 2, 'x': 0, 'y': 0, 'filters': [SHADOW]}]}
    for f in tl[1:]:
        for c in f['changes']:
            s = c.get('scale')
            if s is not None: c['scale'] = [r(v * 1.7) for v in s] if isinstance(s, list) else r(s * 1.7)
            elif 'place' in c: c['scale'] = 1.7
            for k in ('x', 'y'):
                if k in c: c[k] = r(c[k] * 1.7)
    write(base, {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': sh['frames'], 'timeline': tl})
    # the shot instance on screen_mc's frame 2, where every other shot template lives
    p = os.path.join(LIB, 'screen_mc.json')
    scr = json.load(open(p))
    f2 = next(f for f in scr['timeline'] if f['frame'] == 2)
    f2['changes'] = [c for c in f2['changes'] if c.get('name') not in ('shot_mcEMortar', 'shot_mcBuster')]
    f2['changes'].append({'place': base, 'depth': 3241, 'x': -300, 'y': 425, 'name': 'shot_mcEMortar', 'clipEvents': [1],
                          'script': '#include "as/shots/shot_mcEMortar.as"'})
    # and the level's new bomb, the Bunker Buster (player.as weapons2): the unused "shot MC bomb3"
    # art (a black ball with a ring of charges), a bit bigger, params in as2/shots/shot_mcBuster.as
    f2['changes'].append({'place': f'{WA}/shot MC bomb3', 'depth': 3245, 'x': -320, 'y': 425, 'scale': 1.3, 'name': 'shot_mcBuster',
                          'clipEvents': [1], 'script': '#include "as/shots/shot_mcBuster.as"'})
    with open(p, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(scr, indent=2) + '\n')


def pin_ids():
    """Give the new symbols ids in 08's range (1800-1899) so they don't clash with the other levels'."""
    p = os.path.join(ROOT, 'source', 'ids.json')
    ids = json.load(open(p))
    used = set(ids.values())
    nxt = 1800
    for name in written:
        if name in ids: continue
        while nxt in used: nxt += 1
        ids[name] = nxt
        used.add(nxt)
    with open(p, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(ids, indent=2) + '\n')


if __name__ == '__main__':
    walker()
    mortar()
    mortar_shell()
    pin_ids()
    print('wrote', len(written), 'symbols:', ', '.join(w.split('/', 1)[1] for w in written))

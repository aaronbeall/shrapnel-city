"""Check 10 Interface's placements against its collision map.

    python tools/levels/10_Interface/check.py

Reads the level files (so it checks hand edits too) and reports:
- anything placed in or too close to a wall or chasm (the laser turret on the trench pillar is
  meant to be out of reach: it is only checked for being shootable)
- crates, turrets or pickups on a sentinel's patrol lane
- things placed on top of each other, pickups under a floor grid
- anything the player can't reach from the entrance with the core door open, and whether the
  exit is shut off while it is closed
- density per 100k px of open floor, to compare with the earlier levels
"""
import json
import math
import os
from collections import Counter

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'levels', '10_Interface')
PLAYER_R = 19
LANE = 26
ISLANDS = {(900, 692)}   # the pillar in the trench


def load(name):
    p = os.path.join(D, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []


def main():
    c = np.array(Image.open(os.path.join(D, 'collision.png')).convert('L'))
    solid = c <= 0x99
    wall = c == 0
    clear = ndi.distance_transform_edt(~solid)
    feats, enemies, boxes, pick, doors, nodes = (load(f) for f in ('features.json', 'enemies.json', 'boxes.json', 'powerups.json', 'doors.json', 'pathNodes.json'))
    tiles = [d for d in doors if d['symbol'] == 'game objects/trap tile']
    gates = [d for d in doors if d['symbol'] == 'game objects/door']
    problems = []
    by = {n['name']: n for n in nodes}
    # sentinel lanes: links between non-green nodes
    lanes = []
    for n in nodes:
        if n['color']['add'][:3] == [0, 200, 0]: continue
        for ref in n['props']['connections']:
            m = by[ref['$ref']]
            lanes.append(((n['x'], n['y']), (m['x'], m['y'])))

    def lane_d(x, y):
        best = 1e9
        for (ax, ay), (bx, by_) in lanes:
            dx, dy = bx - ax, by_ - ay
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy or 1)))
            best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
        return best

    things = []
    for kind, items, need in (('enemy', enemies, 8), ('box', boxes, 8), ('pickup', [p for p in pick if 'beacon' not in p['symbol']], 6)):
        for o in items:
            x, y = o['x'], o['y']
            name = f"{kind} {o['symbol'].split('/')[-1]} at ({x}, {y})"
            if (x, y) in ISLANDS: things.append((x, y, name, need, True)); continue
            if not (0 <= x < c.shape[1] and 0 <= y < c.shape[0]): problems.append(name + ': off the map'); continue
            n2 = need if 'alarm panel' not in o['symbol'] else 4   # panels sit against walls
            if clear[int(y), int(x)] < n2: problems.append(name + f': {clear[int(y), int(x)]:.0f} px from a wall (needs {n2})')
            if kind != 'pickup' and 'sentinel' not in o['symbol'] and lane_d(x, y) < LANE: problems.append(name + f': on a sentinel lane ({lane_d(x, y):.0f} px)')
            if kind == 'pickup':
                for t in tiles:
                    sx, sy = (t['matrix'][0], t['matrix'][3]) if 'matrix' in t else (1, 1)
                    if abs(x - t['x']) < 20 * sx + 6 and abs(y - t['y']) < 20 * sy + 6: problems.append(name + ': under a floor grid')
            things.append((x, y, name, need, False))
    for i, (x, y, n, r, _) in enumerate(things):
        for x2, y2, n2, r2, _ in things[i + 1:]:
            if math.hypot(x - x2, y - y2) < 14: problems.append(f'{n} overlaps {n2}')
    # reachability (door open), then with the door shut
    walk = clear >= PLAYER_R
    lab, _ = ndi.label(walk)
    ent = next(f for f in feats if f['symbol'].endswith('entrance_mc'))
    ext = next(f for f in feats if f['symbol'].endswith('exit_mc'))
    home = lab[int(ent['y']), int(ent['x'])]
    reach = lab == home
    seen = ndi.binary_dilation(reach, iterations=40)
    for x, y, n, _, island in things:
        if island:
            # shootable from somewhere reachable: a straight wall-free line to reachable floor
            ok = any(reach[int(y + math.sin(a) * d), int(x + math.cos(a) * d)] for a in np.linspace(0, 2 * math.pi, 24, endpoint=False) for d in range(60, 260, 20)
                     if 0 <= int(y + math.sin(a) * d) < c.shape[0] and 0 <= int(x + math.cos(a) * d) < c.shape[1])
            if not ok: problems.append(n + ': island enemy with nowhere to shoot it from')
            continue
        if not seen[int(y), int(x)]: problems.append(n + ': not reachable from the entrance')
    w2 = walk.copy()
    for dr in gates[:1]:  # the core door; the lockdown doors stand open
        w2[int(dr['y']) - 14:int(dr['y']) + 14, int(dr['x']) - 40:int(dr['x']) + 40] = False
    lab2, _ = ndi.label(w2)
    if lab2[int(ent['y']), int(ent['x'])] == lab2[int(ext['y']), int(ext['x'])]: problems.append('the exit is reachable with the core door shut')
    # vision zones (rectangles here) must cover every open pixel: a moving enemy outside every zone
    # would build its own
    cover = np.zeros_like(solid)
    for z in load('vision.json'):
        xs, ys = zip(*[tuple(map(float, p.split())) for p in z['d'].strip('M Z').split(' L ')])
        cover[int(min(ys)):int(max(ys)), int(min(xs)):int(max(xs))] = True
    gap = ~solid & ~cover
    if gap.sum():
        ys, xs = np.nonzero(gap)
        problems.append(f'{gap.sum()} open px outside every vision zone, e.g. ({xs[0]}, {ys[0]})')
    print('\n'.join(problems) if problems else 'no problems found')
    open_px = (~solid).sum() / 1e5
    req = sum(1 for b in boxes if b['symbol'] == 'game objects/box')
    print(f'\nopen floor {open_px * 100:.0f}k px: {len(enemies)} enemies ({len(enemies) / open_px:.1f} per 100k), '
          f'{len(boxes)} boxes ({len(boxes) / open_px:.1f}), {req} required for the exit, '
          f'{sum(1 for p in pick if "beacon" not in p["symbol"])} pickups, {len(tiles)} trap tiles')
    print(dict(Counter(e['symbol'].split('/')[-1] for e in enemies)))


if __name__ == '__main__':
    main()

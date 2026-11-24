"""Check 04 Urban's placements against its collision map and patrol loops.

    python tools/levels/04_Urban/check.py

Reads the level files (so it checks hand edits too) and reports:
- anything placed in or too close to a wall or chasm
- crates, turrets or pickups on a tank's patrol lane (the tank would grind into them)
- things placed on top of each other
- anything the player can't reach from the entrance (with the checkpoint gate open), and
  whether the exit is shut off while the gate is closed
- density per 100k px of open floor, to compare with the earlier levels
- how many enemies can see the spawn (within level.json sightRange, line of sight over
  chasms): a couple is a hot start, more is a crowd
"""
import json
import math
import os
from collections import Counter

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'levels', '04_Urban')
PLAYER_R = 19
LANE = 34  # keep this far from a patrol lane's centre line


def load(name):
    p = os.path.join(D, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []


def main():
    c = np.array(Image.open(os.path.join(D, 'collision.png')).convert('L'))
    solid = c <= 0x99
    clear = ndi.distance_transform_edt(~solid)
    feats, enemies, boxes, pick, doors, nodes = (load(f) for f in ('features.json', 'enemies.json', 'boxes.json', 'powerups.json', 'doors.json', 'pathNodes.json'))
    problems = []
    # patrol lanes: each node to its first connection
    by = {n['name']: n for n in nodes}
    lanes = [((n['x'], n['y']), (by[n['props']['connections'][0]['$ref']]['x'], by[n['props']['connections'][0]['$ref']]['y'])) for n in nodes]

    def lane_d(x, y):
        best = 1e9
        for (ax, ay), (bx, by_) in lanes:
            dx, dy = bx - ax, by_ - ay
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy or 1)))
            best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
        return best

    things = []
    for kind, items, need in (('enemy', enemies, 9), ('box', boxes, 8), ('pickup', [p for p in pick if p['props'].get('type') != 'trigger'], 6)):
        for o in items:
            x, y = o['x'], o['y']
            name = f"{kind} {o['symbol'].split('/')[-1]} at ({x}, {y})"
            if not (0 <= x < c.shape[1] and 0 <= y < c.shape[0]): problems.append(name + ': off the map'); continue
            if clear[int(y), int(x)] < need: problems.append(name + f': {clear[int(y), int(x)]:.0f} px from a wall (needs {need})')
            if 'enemy tank' not in o['symbol'] and lane_d(x, y) < LANE: problems.append(name + f': on a patrol lane ({lane_d(x, y):.0f} px from its centre)')
            things.append((x, y, name, need))
    for i, (x, y, n, r) in enumerate(things):
        for x2, y2, n2, r2 in things[i + 1:]:
            if math.hypot(x - x2, y - y2) < 14: problems.append(f'{n} overlaps {n2}')
    # reachability
    walk = clear >= PLAYER_R
    lab, _ = ndi.label(walk)
    ent = next(f for f in feats if f['symbol'].endswith('entrance_mc'))
    ext = next(f for f in feats if f['symbol'].endswith('exit_mc'))

    def region(x, y, L=lab, r=30):
        v = L[max(0, int(y) - r):int(y) + r, max(0, int(x) - r):int(x) + r]
        return set(v[v > 0].tolist())
    home = lab[int(ent['y']), int(ent['x'])]
    for x, y, n, _ in things:
        if home not in region(x, y): problems.append(n + ': not reachable from the entrance')
    w2 = walk.copy()
    for dr in doors:
        w2[int(dr['y']) - 14:int(dr['y']) + 14, int(dr['x']) - 32:int(dr['x']) + 32] = False
    lab2, _ = ndi.label(w2)
    if lab2[int(ent['y']), int(ent['x'])] == lab2[int(ext['y']), int(ext['x'])]: problems.append('the exit is reachable with the gate shut')
    # the spawn: a couple of enemies in sight is a hot start, more is a crowd
    rng_ = json.load(open(os.path.join(D, 'level.json'))).get('sightRange', 420)
    wall = c <= 0x10   # chasm doesn't block sight

    def sees(x, y):
        n = int(math.hypot(x - ent['x'], y - ent['y']) / 3) + 1
        return not any(wall[int(ent['y'] + (y - ent['y']) * i / n), int(ent['x'] + (x - ent['x']) * i / n)] for i in range(n + 1))
    seen = [e for e in enemies if math.hypot(e['x'] - ent['x'], e['y'] - ent['y']) <= rng_ and sees(e['x'], e['y'])]
    if len(seen) > 3: problems.append(f'{len(seen)} enemies can see the spawn (a couple is a hot start): ' + ', '.join(f"{e['symbol'].split('/')[-1]} ({e['x']}, {e['y']})" for e in seen))
    print('\n'.join(problems) if problems else 'no problems found')
    print(f'{len(seen)} enemies can see the spawn')
    # density
    open_px = (~solid).sum() / 1e5
    req = sum(1 for b in boxes if b['symbol'] == 'game objects/box')
    print(f'\nopen floor {open_px * 100:.0f}k px: {len(enemies)} enemies ({len(enemies) / open_px:.1f} per 100k), '
          f'{len(boxes)} boxes ({len(boxes) / open_px:.1f}), {req} required for the exit, '
          f'{sum(1 for p in pick if p["props"].get("type") != "trigger")} pickups')
    print(dict(Counter(e['symbol'].split('/')[-1] for e in enemies)))


if __name__ == '__main__':
    main()

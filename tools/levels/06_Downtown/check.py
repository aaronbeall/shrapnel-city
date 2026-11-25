"""Check 06 Downtown's placements against its collision map.

    python tools/levels/06_Downtown/check.py

Reads the level files (so it checks hand edits too) and reports:
- anything placed in or too close to a wall or chasm
- things placed on top of each other
- anything the player can't reach from the entrance (with the shutters open), and that
  each shutter really seals its district: with both shut, only the Market is reachable;
  with shutter 1 open, not the Old Town
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
D = os.path.join(ROOT, 'levels', '06_Downtown')
PLAYER_R = 19


def load(name):
    p = os.path.join(D, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []


MAX_WATCHERS = 2   # Aaron: a couple in sight of the spawn is a hot start; more is too many


def main():
    c = np.array(Image.open(os.path.join(D, 'collision.png')).convert('L'))
    solid = c <= 0x99
    clear = ndi.distance_transform_edt(~solid)
    feats, enemies, boxes, pick, doors, nodes = (load(f) for f in ('features.json', 'enemies.json', 'boxes.json', 'powerups.json', 'doors.json', 'pathNodes.json'))
    problems = []
    things = []
    for kind, items, need in (('enemy', [e for e in enemies if not e['symbol'].endswith('enemy hive')], 9), ('hive', [e for e in enemies if e['symbol'].endswith('enemy hive')], 30), ('box', boxes, 8), ('pickup', [p for p in pick if p['props'].get('type') != 'trigger'], 6)):
        for o in items:
            x, y = o['x'], o['y']
            name = f"{kind} {o['symbol'].split('/')[-1]} at ({x}, {y})"
            if not (0 <= x < c.shape[1] and 0 <= y < c.shape[0]): problems.append(name + ': off the map'); continue
            if clear[int(y), int(x)] < need: problems.append(name + f': {clear[int(y), int(x)]:.0f} px from a wall (needs {need})')
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
    def shut(ids):
        w2 = walk.copy()
        for dr in doors:
            if dr['props']['id'] in ids:
                w2[int(dr['y']) - 36:int(dr['y']) + 36, int(dr['x']) - 36:int(dr['x']) + 36] = False
        return ndi.label(w2)[0]
    hive = [e for e in enemies if e['symbol'].endswith('enemy hive')]
    l2 = shut({'door1', 'door2'})
    if l2[int(ent['y']), int(ent['x'])] != l2[int(hive[0]['y']), int(hive[0]['x'])]: problems.append('hive 1 is not reachable before shutter 1')
    if l2[int(ent['y']), int(ent['x'])] == l2[int(hive[1]['y']), int(hive[1]['x'])]: problems.append('hive 2 is reachable with shutter 1 shut')
    l3 = shut({'door2'})
    if l3[int(ent['y']), int(ent['x'])] != l3[int(hive[1]['y']), int(hive[1]['x'])]: problems.append('hive 2 is not reachable with shutter 1 open')
    if l3[int(ent['y']), int(ent['x'])] == l3[int(ext['y']), int(ext['x'])]: problems.append('the exit is reachable with shutter 2 shut')
    l4 = shut({'door3'})
    if l4[int(ent['y']), int(ent['x'])] != l4[int(hive[2]['y']), int(hive[2]['x'])]: problems.append('hive 3 is not reachable with the gate square shut')
    if l4[int(ent['y']), int(ent['x'])] == l4[int(ext['y']), int(ext['x'])]: problems.append('the exit is reachable with the gate square shut')
    # a quiet spawn: within sight range, at most a couple of enemies see the entrance (line of
    # sight through anything but black wall, as the game's wallHitTest)
    sight = 420  # enemyTurret.as visionRange default
    wall = c == 0
    def seen(x0, y0, x1, y1):
        n = int(math.hypot(x1 - x0, y1 - y0) / 3) + 1
        return not any(wall[int(y0 + (y1 - y0) * k / n), int(x0 + (x1 - x0) * k / n)] for k in range(n + 1))
    watchers = [e for e in enemies if not e['symbol'].endswith('fire barrel') and math.hypot(e['x'] - ent['x'], e['y'] - ent['y']) < (e.get('props') or {}).get('visionRange', sight) and seen(e['x'], e['y'], ent['x'], ent['y'])]
    print(f"spawn: {len(watchers)} enemies see it: " + ', '.join(f"{e['symbol'].split('/')[-1]} ({e['x']:.0f}, {e['y']:.0f})" for e in watchers))
    if len(watchers) > MAX_WATCHERS: problems.append(f'{len(watchers)} enemies see the spawn (at most {MAX_WATCHERS})')
    print('\n'.join(problems) if problems else 'no problems found')
    # density
    open_px = (~solid).sum() / 1e5
    req = sum(1 for b in boxes if b['symbol'] == 'game objects/box')
    print(f'\nopen floor {open_px * 100:.0f}k px: {len(enemies)} enemies ({len(enemies) / open_px:.1f} per 100k), '
          f'{len(boxes)} boxes ({len(boxes) / open_px:.1f}), {req} required for the exit, '
          f'{sum(1 for p in pick if p["props"].get("type") != "trigger")} pickups')
    print(dict(Counter(e['symbol'].split('/')[-1] for e in enemies)))


if __name__ == '__main__':
    main()

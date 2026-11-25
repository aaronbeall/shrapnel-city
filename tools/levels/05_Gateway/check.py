"""Check 05 Gateway's placements against its collision map, patrol routes and keycard order.

    python tools/levels/05_Gateway/check.py

Reads the level files (so it checks hand edits too) and reports:
- anything placed in or too close to a wall or chasm
- crates, turrets or pickups on a tank's patrol lane (the tank would grind into them)
- things placed on top of each other
- the keycard order: with every door shut only band A (and Warden 1, the yellow key) is
  reachable; each door opened in turn reaches its band's key (or the warden carrying it),
  and the exit only once all three are open; every lock pad sits on the side you arrive from
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
D = os.path.join(ROOT, 'levels', '05_Gateway')
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
    lanes = [((n['x'], n['y']), (by[n['props']['connections'][0]['$ref']]['x'], by[n['props']['connections'][0]['$ref']]['y'])) for n in nodes if (n.get('props') or {}).get('connections')]

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
            if not any(t in o['symbol'] for t in ('enemy tank', 'enemy warden')) and not (o.get('props') or {}).get('hunter') and lane_d(x, y) < LANE: problems.append(name + f': on a patrol lane ({lane_d(x, y):.0f} px from its centre)')
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
    order = ['yellowKey', 'blueKey', 'redKey']
    locks = {p['props']['item']: p for p in pick if p['props'].get('type') == 'lock'}
    door_of = {d['props']['id']: d for d in doors}
    keyspots = {}
    for p in pick:
        if p['props'].get('type') == 'key': keyspots[p['props']['item']] = [(p['x'], p['y'])]
    for e in enemies:
        dr = (e.get('props') or {}).get('powerupDrop') or {}
        if dr.get('type') == 'key':
            pid = e['props'].get('pathID')
            # a warden can drop its key anywhere on its route: check every node of its colour
            pts = [(n['x'], n['y']) for n in nodes if ((n['color']['add'][0] << 16) | (n['color']['add'][1] << 8) | n['color']['add'][2]) == pid]
            keyspots[dr['item']] = pts or [(e['x'], e['y'])]

    def labels(open_ids):
        w2 = walk.copy()
        for d in doors:
            if d['props']['id'] in open_ids: continue
            w2[int(d['y']) - 30:int(d['y']) + 30, int(d['x']) - 32:int(d['x']) + 32] = False
        return ndi.label(w2)[0]
    opened = []
    for key in order + [None]:
        L = labels(opened)
        home = L[int(ent['y']), int(ent['x'])]
        if key is None:
            if home not in region(ext['x'], ext['y'], L): problems.append('the exit is not reachable with every door open')
            break
        if home in region(ext['x'], ext['y'], L): problems.append(f'the exit is reachable before the {key} door opens')
        for x, y in keyspots.get(key, []):
            if home not in region(x, y, L): problems.append(f'{key} at ({x}, {y}) is not reachable with doors {opened or "all shut"}')
        lk = locks.get(key)
        if not lk: problems.append(f'no lock for {key}'); break
        if home not in region(lk['x'], lk['y'], L): problems.append(f'the {key} lock pad is not on the reachable side')
        opened.append(lk['props']['unlock'].split(':')[0])
    print('\n'.join(problems) if problems else 'no problems found')
    # density
    open_px = (~solid).sum() / 1e5
    req = sum(1 for b in boxes if b['symbol'] == 'game objects/box')
    print(f'\nopen floor {open_px * 100:.0f}k px: {len(enemies)} enemies ({len(enemies) / open_px:.1f} per 100k), '
          f'{len(boxes)} boxes ({len(boxes) / open_px:.1f}), {req} required for the exit, '
          f'{sum(1 for p in pick if p["props"].get("type") not in ("trigger", "lock"))} pickups')
    print(dict(Counter(e['symbol'].split('/')[-1] for e in enemies)))


if __name__ == '__main__':
    main()

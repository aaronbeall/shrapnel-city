"""Check 09 Complex's placements against its collision map.

    python tools/levels/09_Complex/check.py

Reads the level files (so it checks hand edits too) and reports:
- anything placed in or too close to a wall or chasm
- things placed on top of each other
- anything the player can't reach from the entrance with both bulkheads open
- the bulkhead order: with both shut, only the dig site, lower labs and their terminal are
  reachable; with door1 open (workshop terminal) the drone bay terminal is reachable but the
  exit is not; with both open the exit is
- path nodes: each node sees at least one node of its colour, every network is one connected
  piece (as the game links them, by line of sight), and every hunter starts in sight of a
  node of its own colour
- the spawn is quiet: at most three enemies in sight of it
- every door has a trigger that opens it (a terminal or a trigger pad)
- density per 100k px of open floor, to compare with the earlier levels
"""
import json
import math
import os
from collections import Counter, defaultdict

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'levels', '09_Complex')
PLAYER_R = 19


def load(name):
    p = os.path.join(D, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []


def main():
    c = np.array(Image.open(os.path.join(D, 'collision.png')).convert('L'))
    solid = c <= 0x99
    black = c == 0
    clear = ndi.distance_transform_edt(~solid)
    feats, enemies, boxes, pick, doors, nodes = (load(f) for f in ('features.json', 'enemies.json', 'boxes.json', 'powerups.json', 'doors.json', 'pathNodes.json'))
    problems = []
    things = []
    for kind, items, need in (('enemy', enemies, 9), ('box', boxes, 8), ('pickup', pick, 6)):
        for o in items:
            x, y = o['x'], o['y']
            name = f"{kind} {o['symbol'].split('/')[-1]} at ({x}, {y})"
            if not (0 <= x < c.shape[1] and 0 <= y < c.shape[0]): problems.append(name + ': off the map'); continue
            if clear[int(y), int(x)] < need: problems.append(name + f': {clear[int(y), int(x)]:.0f} px from a wall (needs {need})')
            things.append((x, y, name, need, kind))
    pads = {(o['x'], o['y']) for o in pick if o.get('props', {}).get('type') == 'trigger'}  # stacked pads are fine
    for i, (x, y, n, r, _) in enumerate(things):
        for x2, y2, n2, r2, _ in things[i + 1:]:
            if math.hypot(x - x2, y - y2) < 14 and not (n.startswith('pickup') and n2.startswith('pickup') and (x, y) in pads):
                problems.append(f'{n} overlaps {n2}')

    # reachability with the doors open / shut
    walk = clear >= PLAYER_R
    ent = next(f for f in feats if f['symbol'].endswith('entrance_mc'))
    ext = next(f for f in feats if f['symbol'].endswith('exit_mc'))

    def labels(shut):
        w = walk.copy()
        for dr in doors:
            if dr['props']['id'] in shut:
                w[int(dr['y']) - 14:int(dr['y']) + 14, int(dr['x']) - 40:int(dr['x']) + 40] = False
        return ndi.label(w)[0]

    def reach(L, x, y, r=30):
        home = L[int(ent['y']), int(ent['x'])]
        v = L[max(0, int(y) - r):int(y) + r, max(0, int(x) - r):int(x) + r]
        return home in set(v[v > 0].tolist())

    L0 = labels(set())
    for x, y, n, _, kind in things:
        if kind != 'enemy' and not reach(L0, x, y): problems.append(n + ': not reachable from the entrance')
    first = lambda t: (t if isinstance(t, str) else t[0]).split(':')[0]
    terms = {first(b['props']['onDie']['$trigger']): b for b in boxes if 'onDie' in b.get('props', {})}
    L2 = labels({'door1', 'door2'})
    L1 = labels({'door2'})
    if not reach(L2, terms['door1']['x'], terms['door1']['y']): problems.append('door1 terminal not reachable with both doors shut')
    if reach(L2, terms['door2']['x'], terms['door2']['y']): problems.append('door2 terminal reachable before door1 opens')
    if not reach(L1, terms['door2']['x'], terms['door2']['y']): problems.append('door2 terminal not reachable with door1 open')
    if reach(L1, ext['x'], ext['y']): problems.append('exit reachable with door2 shut')
    if not reach(L0, ext['x'], ext['y']): problems.append('exit not reachable')

    # node networks, linked as the game does (line of sight over black only, 10 px samples)
    def los(a, b):
        n = max(1, int(math.hypot(a[0] - b[0], a[1] - b[1]) / 10))
        for k in range(n + 1):
            x = a[0] + (b[0] - a[0]) * k / n
            y = a[1] + (b[1] - a[1]) * k / n
            if black[int(y), int(x)]: return False
        return True
    groups = defaultdict(list)
    for n in nodes: groups[tuple(n['color']['add'][:3])].append((n['x'], n['y'], n['name']))
    for g, ns in groups.items():
        adj = {k: [j for j in range(len(ns)) if j != k and los(ns[k], ns[j])] for k in range(len(ns))}
        for k, a in adj.items():
            if not a: problems.append(f'node {ns[k][2]} {g} sees no node of its colour')
        seen, todo = {0}, [0]
        while todo:
            for j in adj[todo.pop()]:
                if j not in seen: seen.add(j); todo.append(j)
        if len(seen) != len(ns): problems.append(f'network {g} is in {len(ns) - len(seen) + 1}+ pieces: ' + ', '.join(ns[k][2] for k in range(len(ns)) if k not in seen))
    col = {(g[0] << 16) | (g[1] << 8) | g[2]: g for g in groups}
    for e in enemies:
        pid = e.get('props', {}).get('pathID')
        if isinstance(pid, int):
            ns = groups.get(col.get(pid), [])
            if not any(los((e['x'], e['y']), (x, y)) for x, y, _ in ns): problems.append(f"{e['symbol'].split('/')[-1]} at ({e['x']}, {e['y']}) sees no node of its path colour")

    # a quiet spawn: only a couple of enemies (a hot start) in sight of the entrance within the
    # enemies' default visionRange (closed doors block the view, so only the dig site counts)
    sight = 420
    seen = [e for e in enemies if 'barrel' not in e['symbol'] and e['y'] > 1440 and math.hypot(e['x'] - ent['x'], e['y'] - ent['y']) <= sight
            and los((e['x'], e['y']), (ent['x'], ent['y']))]
    if len(seen) > 3: problems.append(f'{len(seen)} enemies can see the spawn (a couple at most)')
    print(f'{len(seen)} enemies in sight of the spawn')
    # doors: each opened by something
    sent = set()
    for o in boxes + pick + enemies:
        pr = o.get('props', {})
        if pr.get('type') == 'trigger': sent.add(pr['item'])
        t = pr.get('onDie', {}).get('$trigger') if isinstance(pr.get('onDie'), dict) else None
        if t: sent.update([t] if isinstance(t, str) else t)
    for dr in doors:
        if dr['props']['id'] + ':open' not in sent: problems.append(f"{dr['props']['id']}: nothing opens it")
    print('\n'.join(problems) if problems else 'no problems found')
    print(f'{len(doors)} doors')
    open_px = (~solid).sum() / 1e5
    print(f'\nopen floor {open_px * 100:.0f}k px: {len(enemies)} enemies ({len(enemies) / open_px:.1f} per 100k), '
          f'{len(boxes)} boxes ({len(boxes) / open_px:.1f}), {len(pick)} pickups')
    print(dict(Counter(e['symbol'].split('/')[-1] for e in enemies)))
    print('(Bridge: 11.1 enemies and 10.8 boxes per 100k; Urban: 10.4 and 10.2)')


if __name__ == '__main__':
    main()

"""Generate a level's placements from its collision map, one stage (one file) at a time.

    python tools/levels/generate.py 04_Street features   # entrance + exit       -> features.json
    python tools/levels/generate.py 04_Street boxes      # crates along walls    -> boxes.json
    python tools/levels/generate.py 04_Street paths      # path node network     -> pathNodes.json
    python tools/levels/generate.py 04_Street enemies    # turrets, tanks, drones -> enemies.json
    python tools/levels/generate.py 04_Street doors      # doors at chokepoints  -> doors.json (+ their trigger pads in powerups.json)
    python tools/levels/generate.py 04_Street boxes --seed 7 --replace

A stage only writes a file that is empty or missing, unless --replace is given, so hand
edits are never lost by accident. Options come from tools/levels/generate.json, overridden
per level in level.json "generate": {"boxes": {"count": 30}, ...}; the seed from
"generate": {"seed": N} (default 1). Needs numpy, scipy and Pillow, like the art bake.

How it reads the map: black is wall (blocks movement and shots), #999 is a gap (blocks
movement, not shots), white is floor. The player is a circle of radius 19, so floor is
walkable where it is at least `radius` px from anything solid; everything is placed on
the biggest connected piece of walkable floor, measured in walking distance.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'art'))
from collision import coverage  # noqa: E402

OPTIONS = json.load(open(os.path.join(os.path.dirname(__file__), 'generate.json')))
STAGES = ('features', 'boxes', 'paths', 'enemies', 'doors')
FILES = {'features': 'features.json', 'boxes': 'boxes.json', 'paths': 'pathNodes.json', 'enemies': 'enemies.json', 'doors': 'doors.json'}
CELL = 4  # px per cell of the walking-distance grid

NODE = 'game objects/node'
RED_GROUP = {'multiply': [0, 0, 0, 1], 'add': [255, 0, 0, 0]}
TURRETS = {  # option -> (symbol, clearance px it needs)
    'scurge': ('enemy assets/enemy scurge', 16), 'stinger': ('enemy assets/enemy stinger', 16),
    'wolfgun': ('enemy assets/enemy wolfgun', 30), 'battery': ('enemy assets/enemy double battery', 27),
    'launcher': ('enemy assets/enemy missile launcher', 24),
}
VEHICLES = {'tanks': 'enemy assets/enemy tank', 'drones': 'enemy assets/enemy drone', 'gnats': 'enemy assets/enemy gnat'}


# ---------------------------------------------------------------- level + options
def options(settings):
    given = settings.get('generate') or {}
    return {g: {k: (given.get(g) or {}).get(k, v['default']) for k, v in spec['options'].items()} for g, spec in OPTIONS.items()}


def read(d, name):
    p = os.path.join(d, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []


def num(v):
    if isinstance(v, float):
        v = round(v, 2)
        if v.is_integer(): return int(v)
    return v


def pretty(v, indent='', width=110):
    """JSON laid out like the editor and build write it (tools/flash-source/format.mjs pretty)."""
    def spaced(x):
        if isinstance(x, dict): return '{' + ', '.join(json.dumps(k) + ': ' + spaced(y) for k, y in x.items()) + '}'
        if isinstance(x, list): return '[' + ', '.join(spaced(y) for y in x) + ']'
        return json.dumps(num(x))
    flat = spaced(v)
    if not isinstance(v, (dict, list)): return flat
    if len(indent) + len(flat.replace(', ', ',').replace(': ', ':')) <= width or (isinstance(v, list) and all(isinstance(x, (int, float)) for x in v)):
        return flat
    inner = indent + '  '
    if isinstance(v, list): return '[\n' + ',\n'.join(inner + pretty(x, inner, width) for x in v) + '\n' + indent + ']'
    return '{\n' + ',\n'.join(inner + json.dumps(k) + ': ' + pretty(x, inner, width) for k, x in v.items()) + '\n' + indent + '}'


def write(d, name, data):
    with open(os.path.join(d, name), 'w', encoding='utf-8', newline='\n') as f: f.write(pretty(data) + '\n')


# ---------------------------------------------------------------- the map
class Map:
    def __init__(self, d, settings, opts):
        size = settings.get('size') or {}
        W, H = size.get('w'), size.get('h')
        if not (W and H):
            with Image.open(os.path.join(d, 'collision.png')) as im: W, H = im.size
        self.W, self.H = W, H
        wall, gap = coverage(os.path.join(d, 'collision.png'), W, H)
        self.wall = wall > 0.5                       # blocks shots and movement
        self.solid = self.wall | (gap > 0.5)         # blocks movement
        self.clear = ndi.distance_transform_edt(~self.solid).astype(np.float32)  # px to the nearest solid
        R = opts['general']['radius']
        walk = self.clear >= R
        lab, n = ndi.label(walk)
        if not n: sys.exit('no walkable floor: every open area is narrower than twice the player radius')
        sizes = ndi.sum(walk, lab, range(1, n + 1))
        self.walk = lab == (1 + int(np.argmax(sizes)))  # the biggest connected floor
        # walking-distance graph over CELL px cells
        gw, gh = W // CELL, H // CELL
        cells = self.walk[CELL // 2::CELL, CELL // 2::CELL][:gh, :gw]
        self.gw, self.gh, self.cells = gw, gh, cells
        idx = -np.ones(cells.shape, int)
        idx[cells] = np.arange(cells.sum())
        self.idx = idx
        rows, cols, w = [], [], []
        for dy, dx, c in ((0, 1, 1.0), (1, 0, 1.0), (1, 1, 1.4142), (1, -1, 1.4142)):
            a = idx[max(0, -dy):gh - max(0, dy), max(0, -dx):gw - max(0, dx)]
            b = idx[max(0, dy):, max(0, dx):][:a.shape[0], :a.shape[1]] if dx >= 0 else idx[dy:, :gw + dx][:a.shape[0], :a.shape[1]]
            if dx < 0: a = idx[:gh - dy, -dx:]
            m = (a >= 0) & (b >= 0)
            rows += [a[m]]; cols += [b[m]]; w += [np.full(m.sum(), c * CELL)]
        r, c, w = np.concatenate(rows), np.concatenate(cols), np.concatenate(w)
        n = int(cells.sum())
        self.graph = coo_matrix((np.concatenate([w, w]), (np.concatenate([r, c]), np.concatenate([c, r]))), shape=(n, n)).tocsr()

    def cell(self, x, y):
        """Graph node nearest (x, y) on the walkable floor, or -1."""
        gx, gy = int(x // CELL), int(y // CELL)
        best, bd = -1, 1e9
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                cx, cy = gx + dx, gy + dy
                if 0 <= cx < self.gw and 0 <= cy < self.gh and self.idx[cy, cx] >= 0 and dx * dx + dy * dy < bd:
                    best, bd = self.idx[cy, cx], dx * dx + dy * dy
        return best

    def walking(self, points, graph=None):
        """Walking distance (px) from the nearest of points to every pixel cell, as a (gh, gw) grid."""
        src = [c for c in (self.cell(x, y) for x, y in points) if c >= 0]
        out = np.full((self.gh, self.gw), np.inf, np.float32)
        if not src: return out
        dist = dijkstra(graph if graph is not None else self.graph, indices=src, min_only=True)
        out[self.cells] = dist
        return out

    def at(self, grid, x, y):
        gx, gy = min(self.gw - 1, max(0, int(x // CELL))), min(self.gh - 1, max(0, int(y // CELL)))
        return grid[gy, gx]

    def sees(self, a, b, step=3.0):
        """Line of sight: no wall pixel between a and b (gaps don't block)."""
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        xs = np.linspace(a[0], b[0], n + 1).astype(int); ys = np.linspace(a[1], b[1], n + 1).astype(int)
        ok = (xs >= 0) & (ys >= 0) & (xs < self.W) & (ys < self.H)
        return bool(ok.all() and not self.wall[ys, xs].any())

    def view(self, x, y, rng_px, rays=40):
        """How much floor a turret at (x, y) sees: total ray length out to rng_px."""
        total = 0.0
        for i in range(rays):
            a = 2 * math.pi * i / rays
            dx, dy = math.cos(a) * 4, math.sin(a) * 4
            px, py, d = x, y, 0.0
            while d < rng_px:
                px += dx; py += dy; d += 4
                ix, iy = int(px), int(py)
                if ix < 0 or iy < 0 or ix >= self.W or iy >= self.H or self.wall[iy, ix]: break
            total += d
        return total

    def normal(self, x, y):
        """Unit vector pointing away from the nearest solid."""
        ix, iy = int(x), int(y)
        r = 6
        patch = self.clear[max(0, iy - r):iy + r + 1, max(0, ix - r):ix + r + 1]
        gy, gx = np.gradient(patch)
        cy, cx = min(r, iy), min(r, ix)
        vx, vy = float(gx[cy, cx]), float(gy[cy, cx])
        n = math.hypot(vx, vy) or 1
        return vx / n, vy / n


def pick(rng, mask, n):
    """n random pixel positions where mask is true."""
    ys, xs = np.nonzero(mask)
    if not len(xs): return []
    k = rng.choice(len(xs), size=min(n, len(xs)), replace=False)
    return [(float(xs[i]), float(ys[i])) for i in k]


def far_enough(p, taken, d):
    return all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= d * d for q in taken)


def entrance_exit(feats):
    ent = next(((e['x'], e['y']) for e in feats if str(e.get('symbol', '')).endswith('entrance_mc')), None)
    ex = next(((e['x'], e['y']) for e in feats if str(e.get('symbol', '')).endswith('exit_mc')), None)
    return ent, ex


def drop_pool():
    """Drops the existing levels use: (type, item) -> typical quantity, and how often."""
    seen = {}
    for folder in sorted(os.listdir(os.path.join(ROOT, 'levels'))):
        d = os.path.join(ROOT, 'levels', folder)
        if not os.path.isdir(d): continue
        for f in ('boxes.json', 'enemies.json'):
            for e in read(d, f):
                p = (e.get('props') or {}).get('powerupDrop')
                if isinstance(p, dict) and p.get('type') and p.get('item'):
                    seen.setdefault((p['type'], p['item']), []).append(p.get('quantity', 1))
    return [(t, i, sorted(q)[len(q) // 2], len(q)) for (t, i), q in sorted(seen.items())]


def a_drop(rng, pool):
    if not pool: return None
    w = np.array([n for *_, n in pool], float)
    t, i, q, _ = pool[rng.choice(len(pool), p=w / w.sum())]
    return {'type': t, 'item': i, 'quantity': q}


def rotation(e, deg):
    """Set a placement's rotation (degrees clockwise on screen) as its matrix."""
    r = math.radians(deg)
    c, s = round(math.cos(r), 6), round(math.sin(r), 6)
    if abs(s) > 1e-6 or c < 0: e['matrix'] = [c, s, -s, c]
    return e


# ---------------------------------------------------------------- stages
def gen_features(m, o, rng, d):
    keep = [e for e in read(d, 'features.json') if not str(e.get('symbol', '')).endswith(('entrance_mc', 'exit_mc'))]
    roomy = m.walk & (m.clear >= o['features']['clearance'])
    if not roomy.any(): roomy = m.walk
    start = pick(rng, roomy, 1)[0]
    far = lambda pts: m.walking(pts)
    grid = far([start])
    roomy_c = roomy[CELL // 2::CELL, CELL // 2::CELL][:m.gh, :m.gw]
    def farthest(g):
        g = np.where(roomy_c & np.isfinite(g), g, -1)
        gy, gx = np.unravel_index(int(np.argmax(g)), g.shape)
        return (gx * CELL + CELL / 2, gy * CELL + CELL / 2)
    a = farthest(grid)
    b = farthest(far([a]))
    # the entrance is the end nearer the level's left/bottom, like the originals start out
    ent, ex = (a, b) if a[0] - a[1] <= b[0] - b[1] else (b, a)
    out = [{'symbol': 'game objects/entrance_mc', 'x': num(ent[0]), 'y': num(ent[1]), 'name': 'entrance_mc'},
           {'symbol': 'game objects/exit_mc', 'x': num(ex[0]), 'y': num(ex[1]), 'name': 'exit_mc'}] + keep
    walk_len = m.at(far([ent]), *ex)
    return out, f'entrance ({ent[0]:.0f}, {ent[1]:.0f}), exit ({ex[0]:.0f}, {ex[1]:.0f}), {walk_len:.0f} px apart on foot'


def gen_boxes(m, o, rng, d):
    bo, R = o['boxes'], o['general']['radius']
    ent, ex = entrance_exit(read(d, 'features.json'))
    keep_clear = [p for p in (ent, ex) if p]
    near_ends = m.walking(keep_clear) if keep_clear else None
    # along walls: about one box half-width off the wall, with room left to walk past
    roomy = ndi.maximum_filter(m.clear, size=60) >= R + 16  # the passage stays 2R wide beside a box
    cand = (m.clear >= 15) & (m.clear <= 19) & roomy & ndi.binary_dilation(m.walk, iterations=20)
    pool = drop_pool()
    out, taken = [], []
    for p in pick(rng, cand, 4000):
        if len(out) >= bo['count']: break
        if near_ends is not None and m.at(near_ends, *p) < 120: continue
        if not far_enough(p, taken, 70): continue
        nx, ny = m.normal(*p)
        tx, ty = -ny, nx                                   # along the wall
        angle = math.degrees(math.atan2(ty, tx))
        r = rng.random()
        if r < bo['reactors']: kind, n = 'game objects/box reactor', 1
        elif r < bo['reactors'] + bo['computers']: kind, n = 'game objects/box computer', 1
        else: kind, n = 'game objects/box', int(rng.integers(1, bo['group'] + 1))
        n = min(n, bo['count'] - len(out))
        for i in range(n):
            big = kind == 'game objects/box' and rng.random() < bo['big']
            s = round(float(rng.uniform(1.25, 1.8)), 2) if big else 1
            off = (i - (n - 1) / 2) * 32
            x, y = p[0] + tx * off + nx * (s - 1) * 15, p[1] + ty * off + ny * (s - 1) * 15
            ix, iy = int(x), int(y)
            if not (0 <= ix < m.W and 0 <= iy < m.H) or m.clear[iy, ix] < 14 * s: continue
            e = {'symbol': kind, 'x': num(x), 'y': num(y)}
            if kind == 'game objects/box computer': rotation(e, round(angle / 90) * 90)  # long side along the wall
            if s != 1: e['scale'] = s
            props = {}
            if big: props['health'] = int(round(25 * s * s / 5) * 5)
            if rng.random() < bo['drops']:
                dr = a_drop(rng, pool)
                if dr: props['powerupDrop'] = dr
            if props: e['props'] = props
            out.append(e)
            taken.append((x, y))
    return out, f'{len(out)} boxes'


def gen_paths(m, o, rng, d):
    po = o['paths']
    cand = m.walk & (m.clear >= po['clearance'])
    nodes = []
    for p in pick(rng, cand, 6000):
        if far_enough(p, nodes, po['spacing']): nodes.append(p)
    # a node that sees no other node links to nothing: drop it
    nodes = [p for p in nodes if any(q is not p and m.sees(p, q) for q in nodes)]
    out = [{'symbol': NODE, 'x': num(x), 'y': num(y), 'color': RED_GROUP} for x, y in nodes]
    return out, f'{len(out)} path nodes (one group, red; they link by line of sight when the level starts)'


def gen_enemies(m, o, rng, d):
    eo, R = o['enemies'], o['general']['radius']
    ent, _ = entrance_exit(read(d, 'features.json'))
    safe = m.walking([ent]) if ent else None
    pool = drop_pool()
    # turret spots: on or beside the floor, scored by how much floor they see
    near_floor = ndi.binary_dilation(m.walk, iterations=R)
    weights = {k: eo[k] for k in TURRETS if eo[k] > 0}
    out, taken, notes = [], [], []
    if weights and eo['turrets'] > 0:
        cand = near_floor & (m.clear >= 16)
        scored = []
        for p in pick(rng, cand, 900):
            if safe is not None and m.at(safe, *p) < o['general']['safe']: continue
            scored.append((m.view(p[0], p[1], eo['range']) * (0.85 + 0.3 * rng.random()), p))
        scored.sort(key=lambda t: -t[0])
        keys = list(weights)
        w = np.array([weights[k] for k in keys], float)
        for _, p in scored:
            if len(taken) >= eo['turrets']: break
            if not far_enough(p, taken, eo['spacing']): continue
            k = keys[rng.choice(len(keys), p=w / w.sum())]
            sym, need = TURRETS[k]
            if m.clear[int(p[1]), int(p[0])] < need: k, (sym, need) = 'scurge', TURRETS['scurge']
            nx, ny = m.normal(*p)
            e = rotation({'symbol': sym, 'x': num(p[0]), 'y': num(p[1])}, round(math.degrees(math.atan2(ny, nx)) / 15) * 15)
            if rng.random() < eo['drops']:
                dr = a_drop(rng, pool)
                if dr: e['props'] = {'powerupDrop': dr}
            out.append(e)
            taken.append(p)
        notes.append(f'{len(taken)} turrets')
    # vehicles start on path nodes, away from the entrance
    nodes = [(e['x'], e['y']) for e in read(d, 'pathNodes.json')]
    want = {k: int(eo[k]) for k in VEHICLES if eo[k] > 0}
    if want and not nodes: notes.append('no path nodes, so no tanks or drones (run the paths stage first)')
    elif want:
        spots = [p for p in nodes if safe is None or m.at(safe, *p) >= o['general']['safe'] * 1.5] or nodes
        rng.shuffle(spots)
        i = 0
        for k, n in want.items():
            for _ in range(n):
                x, y = spots[i % len(spots)]; i += 1
                out.append({'symbol': VEHICLES[k], 'x': num(x + rng.uniform(-8, 8)), 'y': num(y + rng.uniform(-8, 8))})
            notes.append(f'{n} {k}')
    return out, ', '.join(notes)


def gen_doors(m, o, rng, d):
    do, R = o['doors'], o['general']['radius']
    ent, ex = entrance_exit(read(d, 'features.json'))
    if not (ent and ex): return None, 'needs an entrance and an exit (run the features stage first)'
    from_ent, from_ex = m.walking([ent]), m.walking([ex])
    total = m.at(from_ent, *ex)
    # candidate spots: the middle of passages narrow enough to close (ridge of the clearance)
    ridge = (m.clear == ndi.maximum_filter(m.clear, size=5)) & m.walk & (m.clear * 2 <= do['maxWidth'])
    # on the way from entrance to exit: walking distances nearly add up
    cells_on_route = np.isfinite(from_ent) & ((from_ent + from_ex) <= total * 1.15)
    route = np.zeros_like(m.walk)
    route[:m.gh * CELL, :m.gw * CELL] = np.repeat(np.repeat(cells_on_route, CELL, 0), CELL, 1)
    cand = pick(rng, ridge & route, 600)
    n_cells = int(m.cells.sum())
    doors, pads, placed = [], [], []
    feats = [p for p in (ent, ex) if p]
    for p in sorted(cand, key=lambda q: m.at(from_ent, *q)):
        if len(doors) >= do['count']: break
        if not far_enough(p, placed, 120) or not far_enough(p, feats, 90): continue
        # the passage direction and width at p
        nx, ny = m.normal(p[0] + 0.5, p[1] + 0.5)
        across = (-ny, nx) if abs(nx) + abs(ny) else (0, 1)
        # measure the gap across the passage (wall to wall through p, perpendicular to its run)
        def reach(sx, sy):
            t = 0
            while t < 200:
                x, y = int(p[0] + sx * t), int(p[1] + sy * t)
                if not (0 <= x < m.W and 0 <= y < m.H) or m.solid[y, x]: return t
                t += 1
            return t
        # the passage runs along the direction where the walls are farthest
        best = None
        for deg in range(0, 180, 15):
            a = math.radians(deg); ux, uy = math.cos(a), math.sin(a)
            wdt = reach(ux, uy) + reach(-ux, -uy)
            if best is None or wdt < best[0]: best = (wdt, ux, uy)
        width, ux, uy = best
        if width > do['maxWidth'] or width < 2 * R: continue
        # does closing the gap split the floor in two big parts?
        g = m.graph.tolil(copy=True) if False else None
        blocked = set()
        for t in range(-width // 2 - 6, width // 2 + 7, 2):
            for s in (-4, 0, 4):
                x, y = p[0] + ux * t - uy * s, p[1] + uy * t + ux * s
                c = m.cell(x, y) if 0 <= x < m.W and 0 <= y < m.H else -1
                if c >= 0 and abs(t) <= width / 2 + 6: blocked.add(c)
        keep = np.ones(n_cells, bool); keep[list(blocked)] = False
        sub = m.graph[keep][:, keep]
        dist = np.full(n_cells, np.inf)
        si = m.cell(*ent)
        if si < 0 or not keep[si]: continue
        remap = -np.ones(n_cells, int); remap[keep] = np.arange(keep.sum())
        dist[keep] = dijkstra(sub, indices=[remap[si]], min_only=True)
        near_side = np.isfinite(dist).sum() / n_cells
        ei = m.cell(*ex)
        if ei < 0 or np.isfinite(dist[ei]) or near_side < do['minSide'] or 1 - near_side - len(blocked) / n_cells < do['minSide']: continue
        k = len(doors) + 1
        door_id = f'door{k}'
        # the door's long side (59 px tall unscaled) spans the gap
        deg = math.degrees(math.atan2(uy, ux)) - 90
        e = rotation({'symbol': 'game objects/door', 'x': num(p[0]), 'y': num(p[1])}, round(deg / 5) * 5)
        sy = round((width + 8) / 59, 3)
        if 'matrix' in e: e['matrix'] = [e['matrix'][0], e['matrix'][1], round(e['matrix'][2] * sy, 6), round(e['matrix'][3] * sy, 6)]
        elif abs(sy - 1) > 0.02: e['scale'] = [1, sy]
        e['props'] = {'id': door_id}
        # its trigger pad: on the side the player is already on, as far from the door as that side allows
        reach_grid = np.full((m.gh, m.gw), np.inf, np.float32); reach_grid[m.cells] = dist
        prev = [q for q in placed]
        side = np.isfinite(reach_grid) & (m.clear[CELL // 2::CELL, CELL // 2::CELL][:m.gh, :m.gw] >= R + 6)
        from_door = m.walking([p])
        score = np.where(side, np.minimum(from_door, 700) + rng.random(side.shape) * 60, -1)
        if prev: score = np.where(side & (np.minimum.reduce([m.walking([q]) for q in prev]) < 60), -1, score)
        gy, gx = np.unravel_index(int(np.argmax(score)), score.shape)
        pad = (gx * CELL + CELL / 2, gy * CELL + CELL / 2)
        doors.append(e)
        pads.append({'symbol': 'game objects/powerup', 'x': num(pad[0]), 'y': num(pad[1]), 'props': {'type': 'trigger', 'item': door_id + ':open'}})
        placed.append(p)
    return (doors, pads), f'{len(doors)} doors, each with a trigger pad on the side you reach it from'


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('level', help='level folder, e.g. 03_Bridge')
    ap.add_argument('stage', choices=STAGES)
    ap.add_argument('--seed', type=int, help='random seed (default: level.json generate.seed, else 1)')
    ap.add_argument('--replace', action='store_true', help='overwrite the stage file even if it has placements')
    args = ap.parse_args()
    d = os.path.join(ROOT, 'levels', args.level)
    if not os.path.isdir(d): sys.exit(f'no level folder levels/{args.level}')
    settings = json.load(open(os.path.join(d, 'level.json'))) if os.path.exists(os.path.join(d, 'level.json')) else {}
    o = options(settings)
    seed = args.seed if args.seed is not None else int((settings.get('generate') or {}).get('seed', 1))
    rng = np.random.default_rng([seed, STAGES.index(args.stage)])
    target = FILES[args.stage]
    old = read(d, target)
    mine = [e for e in old if not str(e.get('symbol', '')).endswith(('entrance_mc', 'exit_mc'))] if args.stage == 'features' else old
    if args.stage == 'features': mine = [e for e in old if str(e.get('symbol', '')).endswith(('entrance_mc', 'exit_mc'))]
    if mine and not args.replace:
        sys.exit(f'levels/{args.level}/{target} already has {len(mine)} placements; pass --replace to overwrite them')
    m = Map(d, settings, o)
    data, note = globals()['gen_' + args.stage](m, o, rng, d)
    if data is None: sys.exit(note)
    if args.stage == 'doors':
        doors, pads = data
        ids = {e['props']['id'] for e in old if e.get('props', {}).get('id')}
        # drop the trigger pads of the doors being replaced, keep everything else
        powerups = [e for e in read(d, 'powerups.json') if not ((e.get('props') or {}).get('type') == 'trigger'
                    and str((e.get('props') or {}).get('item', '')).split(':')[0] in ids | {x['props']['id'] for x in doors})]
        write(d, 'doors.json', doors)
        write(d, 'powerups.json', powerups + pads)
    else:
        write(d, target, data)
    print(f'levels/{args.level}/{target}: {note}')


if __name__ == '__main__':
    main()

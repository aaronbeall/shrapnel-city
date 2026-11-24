"""09 Complex's vision zones: one per room or cave, written to levels/09_Complex/vision.json.

    python tools/levels/09_Complex/vision.py

An enemy attacks when it and the player are in the same zone and it can see the player. An
enemy outside every zone makes its own zone from where it starts, and keeps it however far it
moves, so a Lab Hunter roaming its wing would fire on whatever its spawn point could see. With
zones it re-registers as it moves (as2/enemyTurret.as), like the Bridge's.

Each zone is the outline of a set of collision.json's open shapes (by name), grown by GROW px so
it reaches through the doorways into the next room: a player standing in a doorway is in both
rooms' zones. Line of sight still decides who fires. Running it again rewrites vision.json, so
zones hand-edited in the editor are lost; check.py reports an enemy outside every zone.
"""
import json
import math
import os
import re

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'levels', '09_Complex')
GROW = 26
CELL = 2

# zone: the open shapes it covers (name prefixes)
ZONES = [
    ('dig site', ['dig site']),
    ('airlock', ['airlock']),
    ('decon atrium', ['decon atrium', 'bulkhead 1 throat']),
    ('specimen corridor', ['specimen corridor']),
    ('specimen R1', ['specimen room R1', 'specimen R1 door', 'specimen R1-R2 door']),
    ('specimen R2', ['specimen room R2', 'specimen R2 door', 'specimen R1-R2 door']),
    ('specimen R3', ['specimen room R3', 'specimen R3 door', 'specimen R3-R4 door']),
    ('specimen R4', ['specimen room R4', 'specimen R4 door', 'specimen R3-R4 door']),
    ('workshop hall', ['workshop hall', 'workshop corridor']),
    ('store room 1', ['store room 1', 'workshop store 1 door', 'workshop store 1-2 door']),
    ('store room 2', ['store room 2', 'workshop store 2 door', 'workshop store 1-2 door']),
    ('climb cavern', ['climb cavern', 'climb throat']),
    ('north-west tunnel', ['north-west tunnel', 'vault entry']),
    ('north-east tunnel', ['north-east tunnel', 'bay entry']),
    ('west grotto', ['west grotto']),
    ('east grotto', ['east grotto']),
    ('server vault', ['server vault', 'vault entry']),
    ('drone bay', ['drone bay', 'bay entry']),
    ('spine', ['spine corridor', 'lift corridor', 'bulkhead 2 throat']),
    ('lift hall', ['lift hall', 'lift platform', 'lift bridge']),
]


def polys(d):
    out = []
    for part in re.split(r'(?=M)', d):
        nums = [float(t) for t in re.findall(r'-?\d+(?:\.\d+)?', part)]
        if len(nums) >= 6: out.append(list(zip(nums[0::2], nums[1::2])))
    return out


def outline(mask):
    """The outer boundary of a filled mask, as a polygon of cell corners."""
    m = np.pad(mask, 1)
    nxt = {}
    h, w = m.shape
    ys, xs = np.nonzero(m[1:-1, 1:-1])
    for y, x in zip(ys + 1, xs + 1):
        # edges with the inside on the right (clockwise in screen space)
        if not m[y - 1, x]: nxt[(x, y)] = (x + 1, y)
        if not m[y, x + 1]: nxt[(x + 1, y)] = (x + 1, y + 1)
        if not m[y + 1, x]: nxt[(x + 1, y + 1)] = (x, y + 1)
        if not m[y, x - 1]: nxt[(x, y + 1)] = (x, y)
    start = min(nxt, key=lambda p: (p[1], p[0]))
    pts, p = [start], nxt[start]
    while p != start:
        pts.append(p)
        p = nxt[p]
    return [(int(x) - 1, int(y) - 1) for x, y in pts]


def simplify(pts, eps):
    """Ramer-Douglas-Peucker on a closed ring."""
    def rdp(seg):
        if len(seg) < 3: return seg
        (x0, y0), (x1, y1) = seg[0], seg[-1]
        L = math.hypot(x1 - x0, y1 - y0) or 1e-9
        dmax, k = 0, 0
        for i in range(1, len(seg) - 1):
            x, y = seg[i]
            dd = abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / L
            if dd > dmax: dmax, k = dd, i
        return rdp(seg[:k + 1])[:-1] + rdp(seg[k:]) if dmax > eps else [seg[0], seg[-1]]
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    return rdp(pts[:far + 1])[:-1] + rdp(pts[far:] + [pts[0]])[:-1]


def main():
    size = json.load(open(os.path.join(D, 'level.json')))['size']
    W, H = size['w'] // CELL, size['h'] // CELL
    shapes = [s for s in json.load(open(os.path.join(D, 'collision.json'))) if 'd' in s and s.get('mode') == 'open' and not s.get('hidden')]
    grow = np.hypot(*np.mgrid[-GROW // CELL:GROW // CELL + 1, -GROW // CELL:GROW // CELL + 1]) <= GROW / CELL
    zones, used = [], set()
    for zname, names in ZONES:
        im = Image.new('L', (W, H), 0)
        dr = ImageDraw.Draw(im)
        for s in shapes:
            if any(s['name'].startswith(n) for n in names):
                used.add(s['name'])
                for p in polys(s['d']): dr.polygon([(x / CELL + s.get('x', 0) / CELL, y / CELL + s.get('y', 0) / CELL) for x, y in p], fill=255)
        mask = ndi.binary_fill_holes(ndi.binary_dilation(np.array(im) > 0, grow))
        lab, n = ndi.label(mask)
        if n != 1: raise SystemExit(f'zone {zname}: its shapes make {n} pieces')
        pts = [(x * CELL, y * CELL) for x, y in simplify(outline(mask), 1.5)]
        cx = round(sum(x for x, _ in pts) / len(pts))
        cy = round(sum(y for _, y in pts) / len(pts))
        zones.append({'x': cx, 'y': cy, 'points': [[x - cx, y - cy] for x, y in pts]})
    missing = [s['name'] for s in shapes if s['name'] not in used]
    if missing: print('open shapes in no zone:', ', '.join(missing))
    with open(os.path.join(D, 'vision.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('[\n' + ',\n'.join('  ' + json.dumps(z, separators=(', ', ': ')) for z in zones) + '\n]\n')
    print(f'vision.json: {len(zones)} zones, {sum(len(z["points"]) for z in zones)} points')


if __name__ == '__main__':
    main()

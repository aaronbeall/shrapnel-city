"""09 Complex's own decor, added to the decor the art kits place.

    python tools/art/bake.py 09_Complex place          # rock kit decor in the caves, metal kit decor in the labs
    python tools/levels/09_Complex/decor.py            # + the labs' own fittings (replaces only its own)
    python tools/art/bake.py 09_Complex bake

Read from collision.json's named shapes (so they follow the shapes if they're moved in the
editor), using the metal kit's light and panel sprites:
- the specimen tanks glow blue from inside
- the server racks get rows of blue status lights, the workshop presses a work lamp each
- the lift platform is a big floor plate with red warning lamps at its corners, and the lift
  hall's columns carry red lamps
- every door (doors.json) gets a lamp either side

Entries with "of": "complex" are this tool's: running it again replaces them (and drops any
kit decor sitting where they go) and leaves the rest of decor.json alone. A full bake.py
place drops them, so run this again after one.
"""
import json
import math
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'levels', '09_Complex')
sys.path.insert(0, os.path.join(ROOT, 'tools', 'art'))
from bake import write_decor  # noqa: E402

SIZES = {it['file']: (it['w'], it['h']) for its in json.load(open(os.path.join(ROOT, 'tools', 'art', 'parts', 'decor', 'index.json'))).values() for it in its}
BLUE_ROUND, BLUE_STRIP, BLUE_SQUARE, RED_ROUND, WARM_SQUARE = 'lights/15.png', 'lights/23.png', 'lights/08.png', 'lights/04.png', 'lights/11.png'
PLATE = 'panels/03.png'


def bounds(d):
    nums = [float(t) for t in re.findall(r'-?\d+(?:\.\d+)?', d)]
    xs, ys = nums[0::2], nums[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def size_of(sprite):
    if sprite in SIZES: return SIZES[sprite]
    from PIL import Image
    with Image.open(os.path.join(ROOT, 'tools', 'art', 'parts', 'decor', sprite)) as im: return im.size


def put(out, sprite, x, y, length, rotation=0, effect='glow', strength=0.9):
    w, h = size_of(sprite)
    e = {'sprite': sprite, 'x': round(x), 'y': round(y), 'scale': round(length / max(w, h), 4), 'rotation': rotation, 'of': 'complex'}
    if effect: e['effect'] = effect
    if effect in ('glow', 'shadow'): e['strength'] = strength
    out.append(e)


def main():
    shapes = {s['name']: s for s in json.load(open(os.path.join(D, 'collision.json'))) if 'd' in s}
    out = []
    for name, s in shapes.items():
        x0, y0, x1, y1 = bounds(s['d'])
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if name.startswith('specimen tank'):
            put(out, BLUE_ROUND, cx, cy, (x1 - x0) * 0.9, strength=1.0)
        elif name.startswith('server rack'):
            n = int((y1 - y0) // 34)
            for k in range(n):
                put(out, BLUE_STRIP, cx, y0 + 17 + k * (y1 - y0 - 34) / max(1, n - 1), 22, rotation=90, strength=0.7)
        elif name.startswith('press'):
            put(out, WARM_SQUARE, cx, cy, (x1 - x0) * 0.6, strength=0.6)
        elif name.startswith('lift hall column'):
            put(out, RED_ROUND, cx, cy, (x1 - x0) * 0.55, strength=0.8)
        elif name == 'lift platform':
            put(out, PLATE, cx, cy, min(x1 - x0, (y1 - y0) * 2) - 6, rotation=0, effect='emboss')
            for fx in (-1, 1):
                for fy in (-1, 1):
                    put(out, RED_ROUND, cx + fx * ((x1 - x0) / 2 - 10), cy + fy * ((y1 - y0) / 2 - 10), 12, strength=0.9)
    for dr in json.load(open(os.path.join(D, 'doors.json'))):
        a, b, c, d = dr.get('matrix', [1, 0, 0, 1])
        hx, hy = 25 * -c, 25 * d  # the door's span (local y, 50 px) in level space
        L = math.hypot(hx, hy)
        for f in (-1, 1):
            put(out, BLUE_SQUARE, dr['x'] + f * hx * (1 + 9 / L), dr['y'] + f * hy * (1 + 9 / L), 11, strength=0.8)
    p = os.path.join(D, 'decor.json')
    old = json.load(open(p)) if os.path.exists(p) else []
    mine = [(e['x'], e['y']) for e in out]
    keep = [e for e in old if e.get('of') != 'complex' and not any(math.hypot(e['x'] - x, e['y'] - y) < 16 for x, y in mine)]
    write_decor(p, keep + out)
    print(f'decor.json: {len(old) - len(keep)} replaced, {len(out)} lab fittings added ({len(keep) + len(out)} placements)')


if __name__ == '__main__':
    main()

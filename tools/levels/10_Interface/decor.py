"""10 Interface's own decor, added to the decor the metal kit places.

    python tools/art/bake.py 10_Interface place          # the metal kit's decor (replaces decor.json)
    python tools/levels/10_Interface/decor.py            # + Interface's own (replaces only its own)
    python tools/art/bake.py 10_Interface bake

Interface's sprites are drawn here (tools/art/parts/decor/interface/, registered in index.json
so the editor can place them too), not generated: server rack lids with status LEDs on the hall's
racks, switchgear lids on the yard's cabinets, the glowing Interface on the core, red emergency
lamps along the corridor walls (they light the floor red), and yellow high-voltage stencils
beside every floor grid strip. The racks, cabinets and core are read from collision.json and the
grids from doors.json, so the decor follows them if they're moved in the editor.

Entries with an interface/ sprite are this tool's: running it again replaces them and leaves
the rest of decor.json alone. Kit decor that would sit on the racks, cabinets or core is dropped.
"""
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'levels', '10_Interface')
DECOR = os.path.join(ROOT, 'tools', 'art', 'parts', 'decor')
CAT = 'interface'
sys.path.insert(0, os.path.join(ROOT, 'tools', 'art'))
from bake import write_decor  # noqa: E402

SS = 4  # supersampling for the drawings


# ---------------------------------------------------------------- sprites
def canvas(w, h):
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def done(im, name):
    w, h = im.size
    im = im.resize((w // SS, h // SS), Image.LANCZOS)
    os.makedirs(os.path.join(DECOR, CAT), exist_ok=True)
    im.save(os.path.join(DECOR, CAT, name))
    return f'{CAT}/{name}', im.size


def R(*v): return [int(round(x * SS)) for x in v]


def rack_lid(n, w, h, seed):
    """A server rack's lid: gunmetal, vent slots, a column of status LEDs, cable ports."""
    rng = random.Random(seed)
    im, d = canvas(w, h)
    d.rounded_rectangle(R(0, 0, w, h), 3 * SS, fill=(58, 64, 70, 255), outline=(20, 23, 26, 255), width=SS)
    d.rounded_rectangle(R(2, 2, w - 2, h - 2), 2 * SS, outline=(110, 118, 126, 255), width=SS)
    # vent slots in blocks
    y = 8
    while y < h - 14:
        blk = rng.randint(4, 8)
        for k in range(blk):
            yy = y + k * 3
            if yy > h - 10: break
            d.rectangle(R(6, yy, w - 11, yy + 1.2), fill=(24, 27, 30, 255))
        y += blk * 3 + 6
    # LED column along the right edge
    for yy in range(6, h - 6, 4):
        c = rng.choice([(90, 230, 255), (90, 230, 255), (90, 230, 255), (255, 60, 40), (120, 255, 140), (40, 60, 70)])
        d.rectangle(R(w - 7, yy, w - 4.5, yy + 1.8), fill=c + (255,))
    # cable ports at the ends
    for x in range(6, w - 8, 5):
        d.rectangle(R(x, 2.5, x + 3, 4.5), fill=(15, 17, 19, 255))
        d.rectangle(R(x, h - 4.5, x + 3, h - 2.5), fill=(15, 17, 19, 255))
    return done(im, f'rack{n}.png')


def cabinet_lid(n, w, h, seed):
    """A switchgear cabinet's lid: steel plates, hazard band, a small glowing panel."""
    rng = random.Random(seed)
    im, d = canvas(w, h)
    d.rounded_rectangle(R(0, 0, w, h), 4 * SS, fill=(88, 95, 102, 255), outline=(22, 25, 28, 255), width=SS)
    d.rectangle(R(4, 4, w - 4, h * 0.45), fill=(70, 76, 82, 255), outline=(40, 44, 48, 255), width=SS)
    d.rectangle(R(4, h * 0.45 + 3, w - 4, h - 16), fill=(74, 80, 86, 255), outline=(40, 44, 48, 255), width=SS)
    for x in range(0, w, 8):  # hazard band
        d.polygon(R(x, h - 12, x + 4, h - 12, x + 8, h - 5, x + 4, h - 5), fill=(220, 175, 40, 255))
    d.rectangle(R(0, h - 12, 3, h - 5), fill=(88, 95, 102, 255))
    px, py = rng.uniform(10, w - 30), rng.uniform(10, h * 0.45 - 16)
    d.rectangle(R(px, py, px + 20, py + 10), fill=(12, 16, 18, 255))
    for k in range(4):
        c = rng.choice([(90, 230, 255), (255, 70, 40), (120, 255, 140)])
        d.rectangle(R(px + 2 + k * 4.5, py + 3, px + 5 + k * 4.5, py + 7), fill=c + (255,))
    for x, y in ((6, 6), (w - 8, 6), (6, h - 18), (w - 8, h - 18)):
        d.ellipse(R(x, y, x + 2.5, y + 2.5), fill=(30, 33, 36, 255))
    return done(im, f'cabinet{n}.png')


def core_lid(size):
    """The Interface: an octagonal lid of circuit traces round a glowing red eye."""
    im, d = canvas(size, size)
    c = size / 2

    def oct_(r):
        k = r * 0.41
        return R(c - r + k, c - r, c + r - k, c - r, c + r, c - r + k, c + r, c + r - k, c + r - k, c + r, c - r + k, c + r, c - r, c + r - k, c - r, c - r + k)
    d.polygon(oct_(c - 1), fill=(50, 55, 60, 255), outline=(16, 18, 20, 255))
    d.polygon(oct_(c - 6), outline=(120, 128, 136, 255))
    rng = random.Random(7)
    for k in range(28):  # traces from the eye outward
        a = 2 * math.pi * k / 28 + rng.uniform(-.05, .05)
        r0, r1 = 14, c - 9 - rng.uniform(0, 8)
        x0, y0, x1, y1 = c + math.cos(a) * r0, c + math.sin(a) * r0, c + math.cos(a) * r1, c + math.sin(a) * r1
        col = (90, 230, 255, 255) if k % 3 else (255, 80, 50, 255)
        d.line(R(x0, y0, x1, y1), fill=col, width=SS)
        d.ellipse(R(x1 - 1.4, y1 - 1.4, x1 + 1.4, y1 + 1.4), fill=col)
    d.ellipse(R(c - 13, c - 13, c + 13, c + 13), fill=(20, 8, 8, 255), outline=(140, 30, 20, 255), width=SS)
    d.ellipse(R(c - 9, c - 9, c + 9, c + 9), fill=(200, 30, 20, 255))
    d.ellipse(R(c - 5, c - 5, c + 5, c + 5), fill=(255, 170, 140, 255))
    d.ellipse(R(c - 2, c - 3, c + 1, c), fill=(255, 245, 240, 255))
    return done(im, 'core.png')


def lamp():
    """A red emergency lamp: a capsule with a hot core (glows and lights the floor red)."""
    im, d = canvas(8, 16)
    d.rounded_rectangle(R(0, 0, 8, 16), 3 * SS, fill=(40, 16, 14, 255))
    d.rounded_rectangle(R(1.5, 2, 6.5, 14), 2.4 * SS, fill=(255, 70, 50, 255))
    d.rounded_rectangle(R(3, 4, 5, 12), 1 * SS, fill=(255, 225, 210, 255))
    return done(im, 'lamp.png')


def stencil():
    """High-voltage stencil: a yellow lightning bolt in a triangle (painted on the floor)."""
    im, d = canvas(34, 30)
    d.polygon(R(17, 1, 33, 29, 1, 29), fill=(235, 190, 40, 255))
    d.polygon(R(17, 6, 29, 26.5, 5, 26.5), fill=(30, 30, 30, 255))
    d.polygon(R(18.5, 9, 13, 19, 16.5, 19, 14.5, 25, 21, 15, 17.5, 15, 20, 9), fill=(235, 190, 40, 255))
    return done(im, 'stencil.png')


# ---------------------------------------------------------------- placement
def shapes_by_group(group):
    out = []
    for s in json.load(open(os.path.join(D, 'collision.json'))):
        if s.get('group') == group and 'd' in s and s['mode'] == 'wall':
            nums = [float(t) for t in s['d'].split('Z')[0].replace('M', ' ').replace('L', ' ').split()]
            xs, ys = nums[0::2], nums[1::2]
            out.append((s['name'], min(xs), min(ys), max(xs), max(ys)))
    return out


def main():
    sprites = {}
    for n, (w, h, seed) in enumerate(((32, 300, 1), (32, 300, 2), (32, 120, 3), (32, 120, 4), (32, 120, 5))):
        sprites[f'rack{n}'] = rack_lid(n, w, h, seed)
    for n in range(3):
        sprites[f'cabinet{n}'] = cabinet_lid(n, 70, 110, 10 + n)
    sprites['core'] = core_lid(88)
    sprites['lamp'] = lamp()
    sprites['stencil'] = stencil()
    # register the category for the editor's decor palette
    ip = os.path.join(DECOR, 'index.json')
    index = json.load(open(ip))
    index[CAT] = [{'file': f, 'w': s[0], 'h': s[1]} for f, s in sorted(sprites.values())]
    with open(ip, 'w', newline='\n') as fh: json.dump(index, fh, indent=1); fh.write('\n')

    path = os.path.join(D, 'decor.json')
    decor = json.load(open(path))
    racks, cabs = shapes_by_group('server racks'), shapes_by_group('switching yard')
    core = [s for s in shapes_by_group('core') if s[0] == 'the interface']
    covered = [(x0 - 2, y0 - 2, x1 + 2, y1 + 2) for _, x0, y0, x1, y1 in racks + cabs + core]

    def on_covered(e):
        return any(x0 <= e['x'] <= x1 and y0 <= e['y'] <= y1 for x0, y0, x1, y1 in covered)
    decor = [e for e in decor if not e['sprite'].startswith(CAT + '/') and not on_covered(e)]
    mine = []
    rng = random.Random(1010)
    for k, (_, x0, y0, x1, y1) in enumerate(racks):
        long_ = (y1 - y0) > 200
        name = f'rack{k % 2}' if long_ else f'rack{2 + k % 3}'
        sh = sprites[name][1][1]
        mine.append({'sprite': sprites[name][0], 'x': (x0 + x1) / 2, 'y': (y0 + y1) / 2, 'scale': round(min((y1 - y0 - 8) / sh, 1.1), 4),
                     'rotation': 0 if k % 2 else 180, 'effect': 'shadow', 'strength': 0.35})
    for k, (_, x0, y0, x1, y1) in enumerate(cabs):
        mine.append({'sprite': sprites[f'cabinet{k % 3}'][0], 'x': (x0 + min(x1, 1640)) / 2, 'y': (y0 + y1) / 2,
                     'scale': round(min((min(x1, 1640) - x0 - 8) / 70, (y1 - y0 - 8) / 110), 4), 'rotation': 0 if k % 2 else 180,
                     'effect': 'shadow', 'strength': 0.35})
    for _, x0, y0, x1, y1 in core:
        mine.append({'sprite': sprites['core'][0], 'x': (x0 + x1) / 2, 'y': (y0 + y1) / 2, 'scale': round((x1 - x0 - 6) / 88, 4),
                     'rotation': 0, 'effect': 'glow', 'strength': 1.2})
    # red emergency lamps on the wall faces along the corridors: every ~150 px of wall edge
    from scipy import ndimage as ndi
    col = np.array(Image.open(os.path.join(D, 'collision.png')).convert('L'))
    wall = col == 0
    edge = wall & ndi.binary_dilation(col > 0x99, iterations=5) & ~ndi.binary_dilation(col > 0x99, iterations=2)
    pts = np.argwhere(edge)
    rng2 = np.random.default_rng(1010)
    rng2.shuffle(pts)
    taken = []
    for y, x in pts:
        if any((x - a) ** 2 + (y - b) ** 2 < 150 ** 2 for a, b in taken): continue
        if any(x0 - 6 <= x <= x1 + 6 and y0 - 6 <= y <= y1 + 6 for _, x0, y0, x1, y1 in racks + cabs + core): continue
        # face the lamp along the wall: the open side's direction
        win = col[max(0, y - 6):y + 7, max(0, x - 6):x + 7] > 0x99
        gy, gx = np.argwhere(win).mean(0) - np.array([min(6, y), min(6, x)])
        ang = math.degrees(math.atan2(gy, gx))
        taken.append((x, y))
        mine.append({'sprite': sprites['lamp'][0], 'x': int(x), 'y': int(y), 'scale': 1, 'rotation': round(-ang, 1) % 360,
                     'effect': 'glow', 'strength': 1.0})
    # high-voltage stencils beside the floor grid strips (one per strip, on the floor before it)
    doors = json.load(open(os.path.join(D, 'doors.json')))
    tiles = [t for t in doors if t['symbol'] == 'game objects/trap tile']
    strips = []
    for t in tiles:
        for s in strips:
            if abs(s[-1]['x'] - t['x']) <= 41 and abs(s[-1]['y'] - t['y']) <= 41: s.append(t); break
        else: strips.append([t])
    clear = ndi.distance_transform_edt(col > 0x99)
    for s in strips:
        xs, ys = [t['x'] for t in s], [t['y'] for t in s]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        horiz = (max(xs) - min(xs)) >= (max(ys) - min(ys))
        for off in (40, -40, 54, -54):  # beside the strip, across its short side
            if horiz: x, y = (cx, max(ys) + abs(off)) if off > 0 else (cx, min(ys) - abs(off))
            else: x, y = (max(xs) + abs(off), cy) if off > 0 else (min(xs) - abs(off), cy)
            if 0 <= x < col.shape[1] and 0 <= y < col.shape[0] and clear[int(y), int(x)] > 16:
                mine.append({'sprite': sprites['stencil'][0], 'x': int(x), 'y': int(y), 'scale': 0.8, 'rotation': 0, 'effect': 'paint'})
                break
    write_decor(path, decor + mine)
    print(f'interface decor: {len(mine)} placements ({sum(1 for e in mine if "lamp" in e["sprite"])} lamps); decor.json now {len(decor) + len(mine)}')


if __name__ == '__main__':
    main()

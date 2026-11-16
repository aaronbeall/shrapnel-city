"""Make the floor panel sprites: tools/art/parts/decor/panels/<n>.png.

Floor panels are drawn by the bake as an emboss on the floor (effect "emboss"), like
the start pads and plated areas in backgrounds 0-3: the sprite is a height map, grey
128 = floor level, lighter = raised, darker = recessed, alpha = the panel's extent.
The bake lights it from the top-left, so it takes the floor's own texture.

    python3 tools/art/make_panels.py

Adds the "panels" category to tools/art/parts/decor/index.json.
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

D = os.path.join(os.path.dirname(__file__), 'parts', 'decor')

# w, h, border style, sub-panels across x down, chamfer, rivets
DESIGNS = [
    (160, 160, 'groove', 1, 1, 0, True),
    (160, 160, 'raised', 2, 2, 0, True),
    (200, 200, 'groove', 2, 2, 24, True),
    (240, 120, 'groove', 2, 1, 0, True),
    (240, 120, 'raised', 3, 1, 16, False),
    (300, 100, 'groove', 3, 1, 0, True),
    (120, 120, 'raised', 1, 1, 18, True),
    (180, 120, 'recessed', 1, 1, 0, True),
    (220, 160, 'recessed', 2, 1, 20, False),
    (140, 140, 'groove', 1, 1, 30, False),
    (320, 160, 'raised', 4, 2, 0, True),
    (100, 100, 'recessed', 1, 1, 0, True),
]


def chamfer_mask(w, h, c):
    yy, xx = np.mgrid[0:h, 0:w]
    m = np.ones((h, w), bool)
    if c:
        for cx, cy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            m &= (np.abs(xx - cx) + np.abs(yy - cy)) >= c
    return m


def rect(h, w, x0, y0, x1, y1):
    m = np.zeros((h, w), bool); m[int(y0):int(y1), int(x0):int(x1)] = True
    return m


def panel(w, h, style, nx, ny, ch, rivets):
    hgt = np.zeros((h, w), np.float32)
    m = chamfer_mask(w, h, ch)
    inner = ndi.binary_erosion(m, iterations=5)
    edge = m & ~inner
    if style == 'groove':      # flush plate with a cut line around it
        hgt[edge] = 0.0; hgt[m & ~ndi.binary_erosion(m, iterations=2)] = -0.25; hgt[edge & ndi.binary_erosion(m, iterations=2) & ~ndi.binary_erosion(m, iterations=3)] = -0.35
    elif style == 'raised':    # plate standing a little proud, bevelled rim
        d = ndi.distance_transform_edt(m)
        hgt = np.clip(d / 4, 0, 1) * 0.3
    else:                      # recessed well with a rim
        d = ndi.distance_transform_edt(m)
        hgt = np.where(d < 4, 0.15, -0.2).astype(np.float32) * m
    # seams between sub-panels
    for i in range(1, nx):
        x = w * i / nx; hgt[inner & rect(h, w, x - 1, 0, x + 1, h)] -= 0.3
    for j in range(1, ny):
        y = h * j / ny; hgt[inner & rect(h, w, 0, y - 1, w, y + 1)] -= 0.3
    # rivets: small domes in the corners of each sub-panel
    if rivets:
        yy, xx = np.mgrid[0:h, 0:w]
        for i in range(nx):
            for j in range(ny):
                for fx, fy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                    cx = w * (i + fx) / nx + (10 if fx == 0 else -10)
                    cy = h * (j + fy) / ny + (10 if fy == 0 else -10)
                    r2 = (xx - cx) ** 2 + (yy - cy) ** 2
                    dome = np.clip(1 - r2 / 9, 0, 1) ** 0.5 * 0.35
                    hgt = np.maximum(hgt, np.where(m, dome + hgt * (dome == 0), hgt))
    alpha = ndi.gaussian_filter(m.astype(np.float32), 0.6)
    grey = np.clip(128 + hgt * 160, 0, 255)
    return np.dstack([grey, grey, grey, alpha * 255]).astype(np.uint8)


def main():
    out = os.path.join(D, 'panels'); os.makedirs(out, exist_ok=True)
    items = []
    for k, d in enumerate(DESIGNS):
        im = panel(*d)
        Image.fromarray(im, 'RGBA').save(os.path.join(out, f'{k:02d}.png'))
        items.append({'file': f'panels/{k:02d}.png', 'w': d[0], 'h': d[1]})
    ip = os.path.join(D, 'index.json')
    index = json.load(open(ip))
    index['panels'] = items
    json.dump(index, open(ip, 'w'), indent=1)
    print('panels', len(items), 'sprites')


if __name__ == '__main__':
    main()

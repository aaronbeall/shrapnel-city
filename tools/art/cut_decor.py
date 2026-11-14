"""Cut the decor sprite sheets into separate sprites.

    python3 tools/art/cut_decor.py

Reads tools/art/parts/decor/sheet_<category>.png (items on flat magenta),
keys out the magenta, splits connected items and writes
tools/art/parts/decor/<category>/<n>.png (RGBA, trimmed) plus index.json with
each sprite's size. Sprites from floorpaint/wallmarks keep a soft feathered edge
so they blend into the floor or wall they're placed on.
"""
import glob, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

D = os.path.join(os.path.dirname(__file__), 'parts', 'decor')
index = {}
for sheet in sorted(glob.glob(os.path.join(D, 'sheet_*.png'))):
    cat = os.path.basename(sheet)[6:-4]
    a = np.array(Image.open(sheet).convert('RGB'), np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # distance from magenta: how much green there is relative to red/blue
    key = np.clip(((r + b) / 2 - g - 40) / 80, 0, 1) * (np.minimum(r, b) > 120)
    alpha = 1 - key
    solid = ndi.binary_opening(alpha > 0.5, iterations=2)
    solid = ndi.binary_fill_holes(ndi.binary_closing(solid, iterations=3))
    lab, n = ndi.label(solid)
    out = os.path.join(D, cat); os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, '*.png')): os.remove(f)
    # despill: pull magenta fringe back toward neutral
    spill = np.clip(np.minimum(r, b) - g, 0, None) * np.clip(key * 3, 0, 1)
    a2 = a.copy(); a2[..., 0] -= spill * 0.8; a2[..., 2] -= spill * 0.8
    items = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h * w < 400 or min(h, w) < 10: continue
        m = (lab[sl] == i + 1)
        al = np.clip(alpha[sl], 0, 1) * ndi.binary_dilation(m, iterations=2)
        if cat in ('floorpaint', 'wallmarks'):  # feather the patch edge
            d = ndi.distance_transform_edt(m)
            al = al * np.clip(d / 6, 0, 1)
        if cat == 'floorpaint':  # keep only the paint, not the patch of floor it was drawn on
            px = a[sl]; med = np.median(px[m], axis=0)
            al = al * np.clip((np.abs(px - med).sum(-1) - 25) / 60, 0, 1)
        rgba = np.dstack([np.clip(a2[sl], 0, 255), al * 255]).astype(np.uint8)
        k = len(items)
        Image.fromarray(rgba, 'RGBA').save(os.path.join(out, f'{k:02d}.png'))
        items.append({'file': f'{cat}/{k:02d}.png', 'w': int(w), 'h': int(h)})
    index[cat] = items
    print(cat, len(items), 'sprites')
json.dump(index, open(os.path.join(D, 'index.json'), 'w'), indent=1)

"""Warp an AI-repainted level image so its walls line up with the collision art.

    python3 tools/art/align.py <generated.png> <reference.png> <out.png>

The reference is the collision-accurate base (from paint_bridge.py). Both are
reduced to wall masks (bright pixels); a displacement is estimated per tile by
cross-correlation, smoothed into a field, and the generated image is resampled
along it. Prints how well the walls agree before and after.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.signal import fftconvolve

gen_p, ref_p, out_p = sys.argv[1:4]
ref = Image.open(ref_p).convert('RGB'); W, H = ref.size
gen = np.array(Image.open(gen_p).convert('RGB').resize((W, H), Image.LANCZOS), np.float32)
refm = np.array(ref.convert('L'), np.float32) > 120


def mask(img):
    return (img @ np.array([0.299, 0.587, 0.114], np.float32)) > 120


def agree(a):
    return (a == refm).mean()


def field(genm, step=40, win=120, R=36):
    A, B = ndi.gaussian_filter(genm.astype(np.float32), 2), ndi.gaussian_filter(refm.astype(np.float32), 2)
    ys, xs = np.arange(0, H, step), np.arange(0, W, step)
    dx = np.full((len(ys), len(xs)), np.nan, np.float32); dy = dx.copy()
    for i, cy in enumerate(ys):
        for j, cx in enumerate(xs):
            y0, y1, x0, x1 = max(cy - win // 2, 0), min(cy + win // 2, H), max(cx - win // 2, 0), min(cx + win // 2, W)
            b = B[y0:y1, x0:x1]
            if b.std() < 0.15: continue  # nothing to align on
            ay0, ay1, ax0, ax1 = max(y0 - R, 0), min(y1 + R, H), max(x0 - R, 0), min(x1 + R, W)
            a = A[ay0:ay1, ax0:ax1]
            c = fftconvolve(a - a.mean(), (b - b.mean())[::-1, ::-1], mode='valid')
            k = np.unravel_index(np.argmax(c), c.shape)
            dy[i, j], dx[i, j] = ay0 + k[0] - y0, ax0 + k[1] - x0  # where ref tile sits in gen
    for f in (dx, dy):  # fill holes, then smooth
        m = np.isnan(f)
        if m.all(): f[:] = 0; continue
        idx = ndi.distance_transform_edt(m, return_distances=False, return_indices=True)
        f[:] = f[tuple(idx)]
        f[:] = ndi.median_filter(f, 3)
        f[:] = ndi.gaussian_filter(f, 1.0)
    zy, zx = H / len(ys), W / len(xs)
    up = lambda f: ndi.zoom(f, (zy, zx), order=1)[:H, :W]
    return up(dx), up(dy)


print('agreement before', round(agree(mask(gen)), 4))
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
for it in range(3):
    DX, DY = field(mask(gen))
    gen = np.stack([ndi.map_coordinates(gen[..., c], [yy + DY, xx + DX], order=1, mode='nearest') for c in range(3)], -1)
    print('agreement after pass', it + 1, round(agree(mask(gen)), 4))
Image.fromarray(np.clip(gen, 0, 255).astype(np.uint8)).save(out_p)

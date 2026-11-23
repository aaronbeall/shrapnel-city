"""Docks for the city art kit (first used by 07 Shipyard): harbour water, ship decks, gangways,
a dry dock and shipping containers. Opt-in through level.json:

    "art": {"kit": "city", ..., "docks": {
        "pits": [[x0, y0, x1, y1], ...],        chasm inside these is a dry dock pit, not water
        "decks": [[[x, y], ...], ...],          ship hull outlines: open floor inside is deck
        "gangways": [[x0, y0, x1, y1], ...],    open floor inside is a steel gangway or gantry
        "containers": [[x0, y0, x1, y1], ...]   walls inside are shipping containers
    }}

Without "docks" the city kit draws chasms as collapsed road (04 Urban). With it, every chasm is
water except the pits. Like the rest of the kit it reads the collision map for what is wall,
chasm and floor; the lists above only say what kind of floor or wall a place is, so editing
the collision shapes in the editor and re-baking keeps working (move a hull and its outline
here with it).

Textures: tools/art/parts/city/water.png and deck.png (tools/art/gen_city.sh water deck).
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

PALETTE = np.array([[0.55, 0.2, 0.14], [0.16, 0.27, 0.42], [0.14, 0.38, 0.38], [0.62, 0.46, 0.16],
                    [0.36, 0.38, 0.4], [0.24, 0.36, 0.2], [0.5, 0.3, 0.18]], np.float32)


def blur(a, s): return ndi.gaussian_filter(a.astype(np.float32), s, mode='nearest')


def raster(W, H, polys=(), rects=()):
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    for p in polys: d.polygon([tuple(map(float, q)) for q in p], fill=255)
    for x0, y0, x1, y1 in rects: d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=255)
    return np.array(im) > 127


class Docks:
    def __init__(self, g, art):
        d = art.get('docks') or {}
        W, H = g.W, g.H
        self.on = bool(art.get('docks'))
        self.pit = raster(W, H, rects=d.get('pits', [])) & g.chasmb
        self.water = g.chasmb & ~self.pit
        self.waterf = g.chasm * (1 - ndi.binary_dilation(self.pit, iterations=2))
        open_ = ~(g.wallb | g.chasmb)
        self.hulls = [raster(W, H, polys=[p]) for p in d.get('decks', [])]
        hull_any = raster(W, H, polys=d.get('decks', []))
        self.hull = hull_any
        self.deck = hull_any & open_
        self.gang = raster(W, H, rects=d.get('gangways', [])) & open_ & ~hull_any
        self.gang_rects = d.get('gangways', [])
        self.cont_rects = d.get('containers', [])
        self.cont = raster(W, H, rects=self.cont_rects) & g.wrb
        # walls standing on a deck: the ships' superstructures
        lab, n = ndi.label(g.wrb)
        on_deck = np.unique(lab[ndi.binary_dilation(self.deck, iterations=3) & g.wrb])
        self.super = np.isin(lab, on_deck[on_deck > 0]) & ~self.cont
        self.quay = open_ & ~self.deck & ~self.gang   # the rest of the floor: landside, piers


def surfaces_mask(dk):
    """Where the city kit's street decor may NOT go."""
    return dk.deck | dk.gang | ndi.binary_dilation(dk.cont, iterations=2)


def water(g, dk, rng, load, tiled):
    """The harbour: dark water, darker in the shade of quays and hulls, a lighter ripple line
    along every waterline."""
    W, H = g.W, g.H
    t = tiled(g, load('water'), 0.5, off=(13, 29))
    t = t / max(t.mean(), 1e-3) * 0.2
    t *= np.array([0.92, 1.0, 1.0], np.float32)
    land = ~g.chasmb
    land_d = ndi.distance_transform_edt(~land).astype(np.float32)
    # shade cast by the land onto the water, light from the top-left
    sh = blur(ndi.shift(land.astype(np.float32), (7, 6), order=0), 4)
    t *= (1 - 0.45 * sh * ~land)[..., None]
    t *= (0.88 + 0.16 * np.clip(land_d / 120, 0, 1))[..., None]
    # waterline: broken foam a couple of px off every edge
    n = blur(rng.random((H, W)), 1.2)
    n = (n - n.mean()) / (n.std() + 1e-6)
    foam = np.clip(1 - np.abs(land_d - 3 - 0.8 * n) / 1.4, 0, 1) * (n > -0.6) * 0.35
    t = t + foam[..., None] * np.array([0.75, 0.8, 0.8], np.float32)
    return t


def pit(g, dk, rng, conc):
    """The dry dock: a deep stepped concrete pit, wet at the bottom, keel blocks down the middle."""
    inside = ndi.distance_transform_edt(dk.pit).astype(np.float32)
    p = conc / conc.mean() * 0.3
    depth = np.clip(inside / 40, 0, 1)
    p *= (1 - 0.55 * depth)[..., None]
    # altar steps: light lines at fixed depths down the walls
    for k in (5, 11, 17, 23):
        line = np.clip(1 - np.abs(inside - k) / 1.0, 0, 1)
        p += 0.08 * line[..., None]
        p *= (1 - 0.25 * np.clip(1 - np.abs(inside - k - 1.5) / 1.0, 0, 1))[..., None]
    # wet floor
    wet = blur(rng.random(dk.pit.shape) > 0.55, 6) * (inside > 26)
    p *= (1 - 0.25 * wet)[..., None]
    return p


def keel_blocks(img, g, dk):
    """Timber keel blocks under each ship in the pit, visible beside the hull."""
    yy, xx = g.yy, g.xx
    for h in dk.hulls:
        if not (h & dk.pit).any() and not (ndi.binary_dilation(h, iterations=40) & dk.pit).any(): continue
        ys, xs = np.nonzero(h)
        cx = xs.mean()
        y0, y1 = ys.min() + 30, ys.max() - 20
        for y in np.arange(y0, y1, 34):
            for side in (-1, 1):
                x = cx + side * ((xs.max() - xs.min()) / 2 + 10)
                m = (np.abs(xx - x) < 8) & (np.abs(yy - y) < 4) & dk.pit
                img[m] = img[m] * 0.4 + np.array([0.3, 0.22, 0.14], np.float32) * 0.6
    return img


def hull_sides(img, g, dk, sd, n=8, scale=0.006):
    """The ships' hulls below deck level, seen at the slight angle the walls' sides are: copies
    of each hull shrunk step by step toward the camera point (the map's centre). Dark grey
    steel with a lighter sheer line under the deck edge and a rust-red boot top at the water."""
    cx, cy = g.W * sd['cx'], g.H * sd['cy']
    hullf = dk.hull.astype(np.float32)
    side = np.zeros(dk.hull.shape, np.float32)
    level = np.zeros(dk.hull.shape, np.float32)
    for i in range(1, n + 1):
        f = 1 + scale * i
        coords = [cy + f * (g.yy - cy), cx + f * (g.xx - cx)]
        m = ndi.map_coordinates(hullf, coords, order=1, mode='constant')
        new = np.clip(m - side - hullf, 0, 1)
        level += new * i
        side += new
    side = np.clip(side, 0, 1) * (1 - g.wall) * (1 - hullf)
    f = np.clip(level / np.maximum(side, 1e-3) / n, 0, 1)        # 0 at the deck edge, 1 at the water
    grey = np.array([0.36, 0.38, 0.41], np.float32) * (1 - 0.45 * f)[..., None]
    red = np.array([0.36, 0.13, 0.1], np.float32)
    col = np.where((f > 0.75)[..., None], red, grey)
    col = col + 0.12 * (f < 0.2)[..., None]
    a = np.clip(side * 1.3, 0, 1)[..., None]
    return img * (1 - a) + col * a


def deck(g, dk, load, tiled):
    """Ship decks: haze grey steel plates, the plates running along each ship, with a raised
    gunwale and a guard rail round the edge."""
    W, H = g.W, g.H
    t_v = tiled(g, load('deck'), 0.42, 0.0, off=(3, 7))
    t_h = tiled(g, load('deck'), 0.42, np.pi / 2, off=(11, 5))
    out = np.zeros((H, W, 3), np.float32)
    for h in dk.hulls:
        ys, xs = np.nonzero(h)
        if not len(xs): continue
        horiz = (xs.max() - xs.min()) > (ys.max() - ys.min())
        out[h] = (t_h if horiz else t_v)[h]
    m = dk.hull
    out = out / max(out[m].mean(), 1e-3) * 0.4 * np.array([0.95, 0.98, 1.03], np.float32)
    # edge: gunwale (light), rail (dark line), a soft shadow inboard of the rail
    e = ndi.distance_transform_edt(m).astype(np.float32)
    out *= (1 + 0.35 * np.clip(1 - np.abs(e - 1.5) / 1.5, 0, 1))[..., None]
    out *= (1 - 0.55 * np.clip(1 - np.abs(e - 4) / 0.9, 0, 1))[..., None]
    out *= (1 - 0.2 * np.clip(1 - (e - 5) / 5, 0, 1) * (e > 4.5))[..., None]
    return out


def gangways(img, g, dk, rng):
    """Steel gangways and gantries: dark grating between light handrails, shadow on the water."""
    yy, xx = g.yy, g.xx
    for x0, y0, x1, y1 in dk.gang_rects:
        m = dk.gang & (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        if not m.any(): continue
        along_x = (x1 - x0) >= (y1 - y0)
        u = xx if along_x else yy
        v = yy if along_x else xx
        v0, v1 = (y0, y1) if along_x else (x0, x1)
        grate = 0.2 + 0.08 * ((u % 5) < 1.2) + 0.05 * ((v % 9) < 1.2)
        col = np.stack([grate * 0.95, grate, grate * 1.05], -1)
        rail = (np.abs(v - (v0 + 3)) < 2) | (np.abs(v - (v1 - 4)) < 2)
        col = np.where(rail[..., None], np.array([0.62, 0.6, 0.52], np.float32), col)
        post = rail & ((u % 24) < 3)
        col = np.where(post[..., None], np.array([0.3, 0.3, 0.3], np.float32), col)
        img[m] = col[m]
    # shadow under the gangways on the water
    sh = blur(ndi.shift(dk.gang.astype(np.float32), (6, 5), order=0), 3) * dk.water
    img *= (1 - 0.5 * sh)[..., None]
    return img


def containers(top, g, dk, rng):
    """Shipping container stacks: corrugated tops in faded colours, each stack one or two boxes."""
    yy, xx = g.yy, g.xx
    for k, (x0, y0, x1, y1) in enumerate(dk.cont_rects):
        m = dk.cont & (xx >= x0 - 1) & (xx < x1 + 1) & (yy >= y0 - 1) & (yy < y1 + 1)
        if not m.any(): continue
        w, h = x1 - x0, y1 - y0
        long_x = w >= h
        c = PALETTE[rng.integers(len(PALETTE))] * (0.85 + 0.3 * rng.random())
        u = (xx - x0) if long_x else (yy - y0)
        v = (yy - y0) if long_x else (xx - x0)
        L, S = (w, h) if long_x else (h, w)
        rib = 0.88 + 0.12 * np.cos(u * 2 * np.pi / 3.2)
        col = c[None, None, :] * rib[..., None]
        # two boxes side by side when the stack is wide
        if S >= 34:
            col *= (1 - 0.6 * (np.abs(v - S / 2) < 1.2))[..., None]
        # end frames and corner castings
        endf = (u < 3) | (u > L - 3)
        col = np.where(endf[..., None], c * 0.6, col)
        corner = endf & ((v < 3) | (v > S - 3) | (np.abs(v - S / 2) < 2.5))
        col = np.where(corner[..., None], np.array([0.12, 0.12, 0.12], np.float32), col)
        # weathering
        col *= (0.9 + 0.2 * blur(rng.random(col.shape[:2]), 2))[..., None]
        top[m] = col[m]
    return top

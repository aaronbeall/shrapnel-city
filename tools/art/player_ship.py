# Generates the vector player ship: source/library/player assets/player ship*.json
# (wings + hull bevelled as separate parts, flat facet fills, muzzle-lit variant for
# the attack frames). Edit the polygons/palette here, then: python3 tools/art/player_ship.py
import json, os, sys
REPO = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..')
LIB = os.path.join(REPO, 'source/library/player assets')
CX = -0.2  # the original silhouette (and the damage mask) is centred ~0.2px left

def mirror(pts):  # right-half points -> left-half, reversed so winding stays consistent
    return [(-x, y) for x, y in reversed(pts)]

def d(pts):
    p = [(round(CX + x, 2), round(y, 2)) for x, y in pts]
    return 'M ' + ' L '.join(f'{x:g} {y:g}' for x, y in p) + f' L {p[0][0]:g} {p[0][1]:g} Z'

def sym(pts):  # a symmetric polygon from its right half (listed top to bottom along x>=0)
    return pts + mirror(pts)

class Shape:
    def __init__(self): self.fills, self.paths, self.pts = [], [], []
    def fill(self, f):
        if isinstance(f, str): f = {'type': 'solid', 'color': f}
        if f not in self.fills: self.fills.append(f)
        return self.fills.index(f)
    def poly(self, color, pts, both=False, lcolor=None):
        """pts in right-half coordinates; both=True adds the mirrored copy (lcolor for it)."""
        self.paths.append({'fill': self.fill(color), 'd': d(pts)}); self.pts += pts
        if both:
            self.paths.append({'fill': self.fill(lcolor or color), 'd': d(mirror(pts))}); self.pts += mirror(pts)
    def json(self):
        xs = [CX + x for x, _ in self.pts] + [CX - x for x, _ in self.pts]; ys = [y for _, y in self.pts]
        return {'kind': 'shape', 'bounds': [round(min(xs), 2), round(max(xs), 2), round(min(ys), 2), round(max(ys), 2)],
                'fills': self.fills, 'lines': [], 'paths': self.paths}

# ---- palette (sampled from the original render: dark gunmetal hull, pale lavender-grey wings, bronze nozzles)
WING_LEAD = '#e2dfe6'; WING_FRONT = '#c7c3cc'; WING_BACK = '#a39fa9'; WING_TIP = '#77727d'; WING_ROOT = '#8d8893'
HULL_TOP = '#6d6b70'; HULL_SIDE = '#4b494d'; HULL_EDGE = '#333134'; HULL_NOSE = '#636166'; HULL_CHEEK = '#3e3c40'
DARK = '#1d1c1e'; GLASS = '#0e1013'; GLINT = '#56636f'
NOZZLE = '#2c2a2c'; NOZZLE_RIM = '#6b503a'; NOZZLE_HOT = '#c9772f'; ACCENT = '#be1b1b'

# ---- wings (one shape, bevelled as a part)
wings = Shape()
LEAD_ROOT, TIP_F, TIP_B, TRAIL_ROOT = (5.4, 2.4), (17.9, -2.3), (17.8, 4.1), (5.6, 15.2)
CREASE_ROOT, CREASE_TIP = (5.4, 8.2), (17.85, 1.3)
wings.poly(WING_FRONT, [LEAD_ROOT, TIP_F, CREASE_TIP, CREASE_ROOT], both=True)
wings.poly(WING_BACK, [CREASE_ROOT, CREASE_TIP, TIP_B, TRAIL_ROOT], both=True)
# leading-edge chamfer and the dark wingtip fence
wings.poly(WING_LEAD, [LEAD_ROOT, TIP_F, (17.9, -1.1), (5.4, 3.9)], both=True)
wings.poly(WING_TIP, [(16.5, -1.6), TIP_F, TIP_B, (16.5, 5.5)], both=True)
# root fillet where the wing meets the hull
wings.poly(WING_ROOT, [(5.4, 3.9), (7.4, 3.6), (7.6, 13.0), (5.6, 15.2)], both=True)
# red accent stripe near each tip
wings.poly(ACCENT, [(12.6, 0.0), (15.9, -1.3), (15.9, -0.4), (12.6, 0.9)], both=True)

# ---- hull (fuselage + engine block, bevelled as a part)
hull = Shape()
OUTLINE = [(1.3, -15.7), (3.4, -11.2), (4.5, -6.0), (3.7, -3.6), (4.6, 0.4), (5.8, 2.6), (5.8, 12.0), (4.6, 13.6), (0, 13.6)]
hull.poly(HULL_SIDE, OUTLINE[:-1] + mirror(OUTLINE[:-1]))
# nose cone facets: centre plate and darker cheeks
hull.poly(HULL_CHEEK, [(1.3, -15.7), (3.4, -11.2), (4.5, -6.0), (3.7, -3.6), (2.3, -4.2), (2.4, -12.5)], both=True)
hull.poly(HULL_NOSE, sym([(1.3, -15.7), (2.4, -12.5), (2.3, -4.2)]))
# outer side chamfers along the fuselage
hull.poly(HULL_EDGE, [(4.6, 0.4), (5.8, 2.6), (5.8, 12.0), (4.6, 13.6), (4.1, 12.0), (4.1, 2.8), (3.3, 0.6)], both=True)
# dorsal spine
hull.poly(HULL_TOP, sym([(1.6, -3.2), (2.2, -1.0), (2.2, 11.6), (1.2, 13.0)]))
# twin engine pods + nozzles
hull.poly(NOZZLE, sym([(0.6, 12.6), (0.6, 13.6)]))
hull.poly(HULL_SIDE, [(0.9, 12.2), (4.3, 12.2), (4.5, 15.4), (3.9, 16.4), (1.3, 16.4), (0.7, 15.4)], both=True)
hull.poly(HULL_EDGE, [(3.9, 12.6), (4.3, 12.2), (4.5, 15.4), (3.9, 16.4), (3.4, 15.6)], both=True)
hull.poly(NOZZLE_RIM, [(1.2, 16.0), (4.0, 16.0), (3.6, 17.9), (1.6, 17.9)], both=True)
hull.poly(NOZZLE, [(1.6, 16.6), (3.6, 16.6), (3.3, 17.9), (1.9, 17.9)], both=True)
hull.poly(NOZZLE_HOT, [(2.1, 17.1), (3.1, 17.1), (3.0, 17.9), (2.2, 17.9)], both=True)

# ---- details on top, unbevelled: canopy, intakes, spine seam
det = Shape()
det.poly(HULL_EDGE, sym([(0.9, -12.9), (2.0, -10.4), (2.1, -6.0), (1.2, -4.6)]))
det.poly(GLASS, sym([(0.7, -12.3), (1.5, -10.2), (1.6, -6.4), (0.9, -5.3)]))
det.poly(GLINT, [(-0.3, -12.0), (-1.2, -10.1), (-1.2, -8.0), (-0.7, -8.0), (-0.4, -10.1)])
det.poly(HULL_TOP, sym([(0.9, -15.6), (1.5, -14.3), (0.7, -13.4)]))
det.poly(DARK, [(3.7, -3.6), (4.6, 0.4), (3.3, 0.6), (2.6, -2.6)], both=True)
det.poly(HULL_EDGE, sym([(0.3, -2.0), (0.3, 12.2)]))

BEVEL = {'type': 'bevel', 'shadow': '#00000070', 'highlight': '#ffffff70', 'blurX': 2, 'blurY': 2,
         'angle': 0.785398, 'distance': 1, 'strength': 1, 'inner': True, 'knockout': False, 'onTop': False, 'passes': 2}

# muzzle light for the "attack" frames, like the original lit render: a warm wash on the nose
lit = Shape()
LIT = {'type': 'radial gradient', 'm': [10, 0, 0, 10, round(CX, 2), -16.5], 'spread': 0, 'interp': 0,
       'stops': [[0, '#fff0c8b0'], [0.45, '#ffe0a050'], [1, '#ffd08000']]}
lit.poly(LIT, OUTLINE[:4] + [(2.6, -2.8)] + mirror([(2.6, -2.8)] ) + mirror(OUTLINE[:4]))

def write(rel, obj):
    p = os.path.join(LIB, rel + '.json'); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f: json.dump(obj, f, indent=2); f.write('\n')

for i, s in enumerate([wings, hull, det, lit], 1): write(f'player ship/shape {i}', s.json())

def sprite(extra=()):
    ch = [{'place': 'player assets/player ship/shape 1', 'depth': 1, 'x': 0, 'y': 0, 'filters': [BEVEL]},
          {'place': 'player assets/player ship/shape 2', 'depth': 2, 'x': 0, 'y': 0, 'filters': [BEVEL]},
          {'place': 'player assets/player ship/shape 3', 'depth': 3, 'x': 0, 'y': 0}] + list(extra)
    return {'kind': 'sprite', 'symbol': {'type': 'movie clip'}, 'frames': 1, 'timeline': [{'frame': 1, 'changes': ch}]}

write('player ship', sprite())
write('player ship firing', sprite([{'place': 'player assets/player ship/shape 4', 'depth': 4, 'x': 0, 'y': 0, 'blend': 'add'}]))
print('ok')

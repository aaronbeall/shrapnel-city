"""05 Gateway's vision zones (levels/05_Gateway/vision.json), one per part of the checkpoint.

    python tools/levels/05_Gateway/vision.py

A turret only fires at the player while both stand in one of its zones and it has line of sight
(as2/enemyTurret.as); a turret outside every zone builds its own from where it stands, a few
seconds into the level. The zones keep each part of the checkpoint to itself, the way Bridge's
rooms do: the gate hall's guns don't open up on the strip through the red door once it's open,
the strip's launchers don't fire into the customs yard, and so on. Each zone runs to the middle
of the walls round it, so a turret set against a wall still belongs to its side.

Only vision.json is written; the bands are read off the walls in collision.png and checked.
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'levels', '05_Gateway')

# (name, x0, y0, x1, y1), in level pixels; the walls between them: y 300-340 (red door),
# 680-720 (blue door), the customs hall 1100-1180 (yellow door), the office's east wall x 560-582
ZONES = [
    ('gate hall', 0, 0, 1440, 320),
    ('the strip', 0, 320, 1440, 700),
    ('records office', 0, 700, 571, 1140),
    ('customs yard and impound lot', 571, 700, 1440, 1140),
    ('queue and barracks', 0, 1140, 1440, 1660),
]


def main():
    wall = np.array(Image.open(os.path.join(D, 'collision.png')).convert('RGB')).astype(int).sum(-1) < 60
    for y in (320, 700, 1140):       # each band edge runs through a wall, but for its doors
        share = wall[y - 2:y + 3, 20:1420].any(0).mean()
        assert share > 0.85, f'zone edge y={y} is not along a wall ({share:.0%})'
    out = [{'x': x0, 'y': y0, 'd': f'M 0 0 L {x1 - x0} 0 L {x1 - x0} {y1 - y0} L 0 {y1 - y0} Z'} for _, x0, y0, x1, y1 in ZONES]
    enemies = json.load(open(os.path.join(D, 'enemies.json')))
    turrets = [e for e in enemies if any(t in e['symbol'] for t in ('stinger', 'wolfgun', 'battery', 'launcher'))]
    for e in turrets:
        if not any(x0 <= e['x'] < x1 and y0 <= e['y'] < y1 for _, x0, y0, x1, y1 in ZONES):
            print('outside every zone:', e['symbol'], e['x'], e['y'])
    with open(os.path.join(D, 'vision.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('[\n' + ',\n'.join('  ' + json.dumps(z) for z in out) + '\n]\n')
    for name, x0, y0, x1, y1 in ZONES:
        n = sum(x0 <= e['x'] < x1 and y0 <= e['y'] < y1 for e in turrets)
        print(f'{name}: {n} turrets')


if __name__ == '__main__':
    main()

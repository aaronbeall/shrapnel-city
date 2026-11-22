"""One-time import of the original levels' collision sources into levels/NN/collision.json.

collision.json is the list of shapes, bottom first, that the editor bakes into collision.png
(see levels/README.md, "Collision shapes"). Every level gets the same stack:

  collision map   a pixel layer: the level's collision.png itself, copied to collision-base.png
                  (locked). Shown, it alone bakes to exactly the current collision.png.
  vector walls    the original vector walls the map was made from, all hidden. Show them to
                  bake from them instead.

Where the vectors come from:
  00-02  the "walls" layer of original/art/level/levelN.fw.png, which was exported as
         levelN.walls.png and imported into the FLA as the collision bitmap (2008). DropZone's
         walls layer also has two bitmap posts: they come in as a hidden pixel layer.
  03     The Bridge's collision vector shape in the SWF ("level assets/level3/shape 1", before
         868783b rasterised it): fills and outlines exactly as Flash stored them.

  python3 tools/levels/import_collision.py            writes all four, refusing to overwrite
  python3 tools/levels/import_collision.py --force    overwrites existing collision.json files
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'flash-source'))
import fwpng  # noqa: E402

FOLDERS = ['00_Training', '01_DropZone', '02_FirstBlock', '03_Bridge']
# where the walls sit on the map: DropZone's walls bitmap landed 1 px left of its vectors (measured:
# shifted so, the vectors bake to the map with no wall/open differences, only anti-aliased edges)
OFFSET = {1: -1}
SWF_SHAPE = ('868783b^', 'source/library/level assets/level3/shape 1.json')


def num(v):
    r = round(v, 4)
    return str(int(r)) if r == int(r) else repr(r)


def mode_of(grey):
    # as the game reads a pixel (wallHitTest): exactly black is wall, #999999 or darker blocks
    # movement but not shots, lighter is open
    return 'wall' if grey == 0 else 'chasm' if grey <= 0x99 else 'open'


GREYS = {'wall': 0, 'chasm': 0x99, 'open': 0xff}


def fw_d(contours):
    """Fireworks contours (anchor, in-handle, out-handle per point) -> d with exact C curves"""
    out = []
    P = lambda p: '%s %s' % (num(p[0]), num(p[1]))
    for closed, pts in contours:
        if len(pts) < 2:
            continue
        s = ['M ' + P(pts[0][0])]
        segs = list(zip(pts, pts[1:])) + ([(pts[-1], pts[0])] if closed else [])
        for a, b in segs:
            p0, c1, c2, p3 = a[0], a[2], b[1], b[0]
            s.append('L ' + P(p3) if c1 == p0 and c2 == p3 else 'C %s %s %s' % (P(c1), P(c2), P(p3)))
        if closed:
            s.append('Z')
        out.append(' '.join(s))
    return ' '.join(out)


def fw_walls(i):
    doc = fwpng.Doc(os.path.join(ROOT, 'original/art/level/level%d.fw.png' % i))
    layer = next(l for l in doc.layers if l['name'] == 'walls')
    shapes, images = [], []

    def walk(n):
        if n['kind'] == 'path' and n.get('fill') and n['contours']:
            r, g, b, a = n['fill']['color']
            d = fw_d(n['contours'])
            if d:
                # art greys (#333333 walls), not collision colours: dark is meant as wall
                shapes.append({'mode': 'wall' if (r + g + b) / 3 < 128 else 'open', 'd': d})
        if n['kind'] == 'image':
            images.append((n, doc.image(n)))
        for c in n.get('children', []):
            walk(c)
    # Fireworks lists elements top first; collision.json is bottom first
    for c in reversed(layer['children']):
        walk(c)
    names, out = {}, []
    for s in shapes:
        names[s['mode']] = names.get(s['mode'], 0) + 1
        out.append({'name': '%s %d' % (s['mode'], names[s['mode']]), **s})
    return out, images


def bitmap_walls(folder, images):
    """bitmaps in a walls layer -> one pixel layer, black where they're opaque"""
    from PIL import Image
    w, h = Image.open(os.path.join(ROOT, 'levels', folder, 'collision.png')).size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for n, rgba in images:
        x0, y0 = int(round(n['x'] + n['xo'])), int(round(n['y'] + n['yo']))
        for j in range(rgba.shape[0]):
            for i in range(rgba.shape[1]):
                if rgba[j, i, 3] > 127 and 0 <= x0 + i < w and 0 <= y0 + j < h:
                    out.putpixel((x0 + i, y0 + j), (0, 0, 0, 255))
    out.save(os.path.join(ROOT, 'levels', folder, 'collision-bitmap-walls.png'))
    return {'name': 'bitmap walls', 'pixels': 'collision-bitmap-walls.png'}


def swf_bridge():
    src = subprocess.run(['git', 'show', '%s:%s' % SWF_SHAPE], cwd=ROOT, capture_output=True, check=True).stdout
    shape = json.loads(src)
    out, count = [], {}
    for p in shape['paths']:
        if 'fill' in p:
            grey = int(shape['fills'][p['fill']]['color'][1:3], 16)
            mode = mode_of(grey)
            s = {'mode': mode, 'd': p['d']}
        else:  # a hairline outline round a wall (#333333: by the game's reading, impassable)
            line = shape['lines'][p['line']]
            grey = int(line['color'][1:3], 16)
            mode = mode_of(grey)
            s = {'mode': mode, 'd': p['d'], 'outline': line['width']}
        if grey != GREYS[mode]:
            s['grey'] = grey
        count[mode] = count.get(mode, 0) + 1
        s = {'name': ('%s %d' % (mode, count[mode])) + (' outline' if 'outline' in s else ''), **s}
        out.append(s)
    # the first fill is the white floor under everything: keep it, locked, so clicks go to walls
    if out and out[0]['mode'] == 'open':
        out[0]['name'] = 'floor'
        out[0]['locked'] = True
    # the map is 601 px tall: its last row, under the shape, is the border's soft edge (#191919)
    from PIL import Image
    im = Image.open(os.path.join(ROOT, 'levels/03_Bridge/collision.png')).convert('L')
    w, h = im.size
    if h > 600:
        grey = im.getpixel((0, 600))
        row = {'name': 'bottom row', 'mode': mode_of(grey), 'd': 'M 0 600 L %d 600 L %d %d L 0 %d Z' % (w, w, h, h), 'locked': True}
        if grey != GREYS[row['mode']]:
            row['grey'] = grey
        out.append(row)
    return out



def shape_line(s):
    return json.dumps(s, separators=(', ', ': '))


def write(folder, shapes):
    f = os.path.join(ROOT, 'levels', folder, 'collision.json')
    with open(f, 'w') as fh:
        fh.write('[\n' + ',\n'.join('  ' + shape_line(s) for s in shapes) + '\n]\n')
    print('wrote', os.path.relpath(f, ROOT), '(%d shapes)' % len(shapes))


def main():
    force = '--force' in sys.argv
    for i, folder in enumerate(FOLDERS):
        if os.path.exists(os.path.join(ROOT, 'levels', folder, 'collision.json')) and not force:
            print('levels/%s/collision.json exists; --force overwrites it' % folder)
            continue
        shutil.copyfile(os.path.join(ROOT, 'levels', folder, 'collision.png'), os.path.join(ROOT, 'levels', folder, 'collision-base.png'))
        if i < 3:
            vectors, images = fw_walls(i)
            if images:
                vectors.append(bitmap_walls(folder, images))
        else:
            vectors = swf_bridge()
        for s in vectors:
            if OFFSET.get(i):
                s['x'] = OFFSET[i]
            s['hidden'] = True
            s['group'] = 'wall shapes'
        write(folder, [{'name': 'collision map', 'pixels': 'collision-base.png', 'locked': True}] + vectors)


if __name__ == '__main__':
    main()

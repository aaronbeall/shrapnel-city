#!/usr/bin/env python3
"""Map XFL (FLA source) library symbols onto SWF character ids.

Usage: python3 tools/xflmap.py <xfl dir> <swf.json> <out symbols.json>

The SWF only knows numeric character ids, while the FLA knows the symbol
names, linkage ids, frame scripts and per-instance onClipEvent scripts.  We
walk both timelines in parallel starting from the main timeline and the
exported (linkage) symbols, matching each XFL instance to the SWF placement on
the same frame with the same instance name or the same transform.

Output:
  symbols: {charId: {name, linkage, frames: {frame: script}}}
  instances: {"parentId:depth:frame": script}   (frame = placement frame, 1-based)
"""
import sys, os, re, glob, json
import xml.etree.ElementTree as ET

NS = '{http://ns.adobe.com/xfl/2008/}'


def load_xfl(root):
    syms = {}
    for f in sorted(glob.glob(os.path.join(root, 'LIBRARY', '**', '*.xml'), recursive=True)):
        t = ET.parse(f).getroot()
        if t.tag != NS + 'DOMSymbolItem':
            continue
        syms[t.get('name')] = {
            'name': t.get('name'),
            'linkage': t.get('linkageIdentifier'),
            'type': t.get('symbolType') or 'movie clip',
            'timeline': t.find(NS + 'timeline/' + NS + 'DOMTimeline'),
        }
    doc = ET.parse(os.path.join(root, 'DOMDocument.xml')).getroot()
    main = doc.find(NS + 'timelines/' + NS + 'DOMTimeline')
    return syms, main


def mat(el):
    m = el.find(NS + 'matrix/' + NS + 'Matrix')
    g = (lambda k, d: float(m.get(k, d))) if m is not None else (lambda k, d: d)
    return [g('a', 1.0), g('b', 0.0), g('c', 0.0), g('d', 1.0), g('tx', 0.0), g('ty', 0.0)]


def iter_instances(elements):
    for el in elements:
        if el.tag == NS + 'DOMSymbolInstance':
            yield el
        elif el.tag == NS + 'DOMGroup':
            m = el.find(NS + 'members')
            if m is not None:
                yield from iter_instances(list(m))


def xfl_count(tl):
    n = 1
    for fr in tl.iter(NS + 'DOMFrame'):
        n = max(n, int(fr.get('index')) + int(fr.get('duration', 1)))
    return n


def xfl_frames(tl):
    """frame index (0-based) -> list of (inst element, layer idx, keyframe start)"""
    frames = {}
    scripts = {}
    labels = {}
    layers = tl.findall(NS + 'layers/' + NS + 'DOMLayer')
    for li, layer in enumerate(layers):
        if layer.get('layerType') in ('guide', 'folder'):
            continue
        for fr in layer.findall(NS + 'frames/' + NS + 'DOMFrame'):
            idx = int(fr.get('index'))
            dur = int(fr.get('duration', 1))
            if fr.get('name') and fr.get('labelType', 'name') == 'name':
                labels[fr.get('name')] = idx + 1
            for scr in fr.findall(NS + 'Actionscript/' + NS + 'script'):
                scripts.setdefault(idx + 1, []).append(scr.text or '')
            els = fr.find(NS + 'elements')
            if els is None:
                continue
            insts = list(iter_instances(list(els)))
            for f in range(idx, idx + dur):
                for ei, inst in enumerate(insts):
                    frames.setdefault(f, []).append((inst, li, idx, ei))
    nl = len(layers)
    for f in frames:
        # bottom-most layer first, then element order: matches SWF depth order
        frames[f].sort(key=lambda t: (nl - t[1], t[3]))
    return frames, scripts, labels


def swf_displaylists(sprite):
    """per frame: dict depth -> (id, matrix, name, placeFrame(1-based))"""
    out = []
    dl = {}
    for fi, ops in enumerate(sprite['frames']):
        for op in ops:
            if op['op'] == 'remove':
                dl.pop(op['depth'], None)
                continue
            d = op['depth']
            cur = dl.get(d)
            if op.get('new') or cur is None:
                if 'id' not in op:
                    continue
                cur = {'id': op['id'], 'matrix': op.get('matrix', [1, 0, 0, 1, 0, 0]),
                       'name': op.get('name'), 'placed': fi + 1}
                if op.get('move') and d in dl and 'matrix' not in op:
                    cur['matrix'] = dl[d]['matrix']
            else:
                cur = dict(cur)
                if 'id' in op:
                    cur['id'] = op['id']
                if 'matrix' in op:
                    cur['matrix'] = op['matrix']
                if 'name' in op:
                    cur['name'] = op['name']
            dl[d] = cur
        out.append(dict(dl))
    return out


def close(m1, m2, tol=0.06):
    return abs(m1[4] - m2[4]) < tol and abs(m1[5] - m2[5]) < tol and \
        abs(m1[0] - m2[0]) < 0.02 and abs(m1[3] - m2[3]) < 0.02 and \
        abs(m1[1] - m2[1]) < 0.02 and abs(m1[2] - m2[2]) < 0.02


def main():
    xfl, swfjson, outp = sys.argv[1:4]
    syms, main_tl = load_xfl(xfl)
    swf = json.load(open(swfjson))
    chars = {int(k): v for k, v in swf['chars'].items()}
    chars[0] = swf['root']
    name2id = {}
    id2name = {0: '__main__'}
    instances = {}
    conflicts = []
    unmatched = []
    queue = [(main_tl, 0)]
    for lname, cid in swf['exports'].items():
        for s in syms.values():
            if s['linkage'] == lname:
                name2id[s['name']] = cid
                id2name[cid] = s['name']
                queue.append((s['timeline'], cid))
    seen = set()
    while queue:
        tl, cid = queue.pop()
        if cid in seen or tl is None:
            continue
        seen.add(cid)
        ch = chars[cid]
        if ch.get('type', 'sprite') != 'sprite' and cid != 0:
            continue
        xf, _, _ = xfl_frames(tl)
        sdl = swf_displaylists(ch)
        for f in range(len(sdl)):
            used = set()
            last = -1
            for inst, li, kf, ei in xf.get(f, []):
                if kf != f:
                    continue
                lib = inst.get('libraryItemName')
                nm = inst.get('name')
                m = mat(inst)
                cand = None
                for d, e in sorted(sdl[f].items()):
                    if d in used or d <= last:
                        continue
                    if nm and e.get('name') == nm and close(m, e['matrix'], 0.5):
                        cand = d
                        break
                if cand is None:
                    for d, e in sorted(sdl[f].items()):
                        if d in used or d <= last:
                            continue
                        if inst.get('symbolType') != 'graphic' and \
                                chars.get(e['id'], {}).get('type') not in ('sprite', 'button'):
                            continue
                        ch2 = chars.get(e['id'], {})
                        if lib in syms and ch2.get('type') == 'sprite' and \
                                ch2.get('frameCount') != xfl_count(syms[lib]['timeline']):
                            continue
                        if (not nm or e.get('name') in (None, nm)) and close(m, e['matrix']):
                            if lib in name2id and name2id[lib] != e['id'] and \
                                    chars.get(name2id[lib], {}).get('type') == 'sprite':
                                continue
                            cand = d
                            break
                if cand is None:
                    unmatched.append((id2name.get(cid), f + 1, lib, nm))
                    continue
                used.add(cand)
                last = cand
                e = sdl[f][cand]
                sid = e['id']
                if lib in name2id and name2id[lib] != sid and \
                        chars.get(name2id[lib], {}).get('type') != 'sprite' and chars.get(sid, {}).get('type') == 'sprite':
                    name2id[lib] = sid
                    id2name[sid] = lib
                    queue.append((syms[lib]['timeline'], sid))
                elif lib in name2id and name2id[lib] != sid:
                    conflicts.append((lib, name2id[lib], sid))
                elif lib not in name2id:
                    if sid in id2name and id2name[sid] != lib:
                        conflicts.append((lib, id2name[sid], sid))
                    name2id[lib] = sid
                    id2name.setdefault(sid, lib)
                    if lib in syms:
                        queue.append((syms[lib]['timeline'], sid))
                if True:
                    for scr in inst.findall(NS + 'Actionscript/' + NS + 'script'):
                        key = '%d:%d:%d' % (cid, cand, e['placed'])
                        instances[key] = (scr.text or '').replace('\r\n', '\n').replace('\r', '\n')
    out = {'symbols': {}, 'instances': instances}
    for name, cid in name2id.items():
        s = syms.get(name)
        if not s:
            continue
        _, scripts, labels = xfl_frames(s['timeline'])
        out['symbols'][cid] = {
            'name': name, 'linkage': s['linkage'], 'type': s['type'],
            'scripts': {f: '\n'.join(v).replace('\r\n', '\n').replace('\r', '\n') for f, v in scripts.items()},
            'labels': labels,
        }
    _, scripts, labels = xfl_frames(main_tl)
    out['symbols'][0] = {'name': '__main__', 'linkage': None, 'type': 'movie clip',
                         'scripts': {f: '\n'.join(v).replace('\r\n', '\n') for f, v in scripts.items()},
                         'labels': labels}
    json.dump(out, open(outp, 'w'), indent=1, sort_keys=True)
    mc = [n for n, s in syms.items() if n not in name2id and s['type'] != 'graphic']
    print('mapped', len(name2id), 'of', len(syms), 'symbols;', len(instances), 'instance scripts')
    print('conflicts', len(conflicts), [c for c in conflicts if syms.get(c[0], {}).get('type') != 'graphic'])
    print('unmatched instances', len(unmatched), unmatched[:15])
    print('unmapped non-graphic symbols', len(mc), mc[:40])


if __name__ == '__main__':
    main()

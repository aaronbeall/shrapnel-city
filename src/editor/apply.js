// Recompile edited level data in the browser and swap it into the running game, so a
// level can be restarted from the editor's data without a rebuild. Uses the same
// compiler as the build (tools/levels/compile.mjs) and the same source decoder
// (tools/flash-source/format.mjs).
import { decodeChar, decodeTimeline, decodeScript } from '../../tools/flash-source/format.mjs';
import { levelSymbols, composeScreen, propsScript, isRef } from '../../tools/levels/compile.mjs';

export class LevelApplier {
  constructor(rt, data) {
    this.rt = rt;
    this.ids = data.ids;
    this.screen = data.screen;
    // compiled instance handlers from the build, by source text, so instances whose
    // script didn't change keep working after they move to another depth
    this.compiled = new Map();
    for (const [key, text] of Object.entries(rt.lib.instanceScripts)) {
      const fn = rt.instanceScripts[key];
      if (fn && !this.compiled.has(text)) this.compiled.set(text, fn);
    }
  }

  id(name) {
    if (name === null) return 65535;
    const v = this.ids[name];
    if (v === undefined) throw new Error(`unknown symbol "${name}"`);
    return v;
  }

  // handler for an instance script; props scripts are applied directly, others reuse the build's compiled code
  handlerFor(text, propsByText) {
    if (this.compiled.has(text)) return this.compiled.get(text);
    const props = propsByText.get(text);
    if (props) {
      return {
        'clip:load': ($c) => {
          for (const [k, v] of Object.entries(props)) $c[k] = materialize(v, $c);
        },
      };
    }
    if (text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim()) console.warn('[editor] no compiled code for instance script:\n' + text);
    return null;
  }

  // replace a library character in place (live clips keep a reference to the object)
  setChar(cid, c) {
    const lib = this.rt.lib;
    const old = lib.chars.get(cid);
    c.id = cid;
    if (old) {
      for (const k of Object.keys(old)) delete old[k];
      Object.assign(old, c);
      lib.prepare(old);
    } else {
      lib.chars.set(cid, c);
      lib.prepare(c);
    }
  }

  setSprite(name, o, propsByText) {
    const cid = this.id(name);
    const t = decodeTimeline(o, (n) => this.id(n));
    this.setChar(cid, { type: 'sprite', frames: t.frames, labels: t.labels, scriptFrames: t.scriptFrames, frameCount: o.frames });
    const lib = this.rt.lib;
    // forget this sprite's old instance scripts, then add the new ones
    for (const key of Object.keys(lib.instanceScripts)) if (key.startsWith(cid + ':')) { delete lib.instanceScripts[key]; delete this.rt.instanceScripts[key]; }
    for (const [k, text] of Object.entries(t.instances)) {
      const key = cid + ':' + k;
      lib.instanceScripts[key] = text;
      const h = this.handlerFor(text, propsByText);
      if (h) this.rt.instanceScripts[key] = h;
    }
  }

  // levels: every level (the editor's copy); images: {index: canvas} collision maps to use
  apply(levels, images = {}) {
    const propsByText = new Map();
    const collect = (list) => {
      for (const inst of list || []) if (inst.props) propsByText.set(decodeScript(propsScript(inst.props)), inst.props);
    };
    for (const L of levels) for (const k of ['boxes', 'powerups', 'enemies', 'doors', 'features']) collect(L[k]);
    for (const L of levels) {
      for (const [name, o] of levelSymbols(L)) {
        if (o.kind === 'sprite') this.setSprite(name, o, propsByText);
        else this.setChar(this.id(name), decodeChar(o, (n) => this.id(n)));
      }
      const img = images[L.index];
      if (img) this.rt.lib.images.set(this.id(`level assets/level${L.index}/shape 1/bitmap 1`), img);
    }
    this.setSprite('screen_mc', composeScreen(this.screen, levels), propsByText);
  }
}

function materialize(v, clip) {
  if (Array.isArray(v)) return v.map((x) => materialize(x, clip));
  if (isRef(v)) return clip._parent ? clip._parent[v.$ref] : undefined;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, materialize(x, clip)]));
  return v;
}

// Leave whatever is running and start level i from its (edited) data, stopped on its first frame.
export function restartLevel(rt, i) {
  const G = rt.env.G;
  const s = rt.root.screen_mc;
  if (s && s._currentframe % 2 === 0 && typeof G.endLevel === 'function') G.endLevel();
  G.gotoLevel(i);
  rt.flush();
  const scr = rt.root.screen_mc;
  scr.gotoAndStop(i * 2 + 1);
  rt.flush();
  G.continueLevel();
  rt.flush();
  return scr;
}

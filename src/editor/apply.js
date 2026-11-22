// Recompile edited level data in the browser and swap it into the running game, so a
// level can be restarted from the editor's data without a rebuild. Uses the same
// compiler as the build (tools/levels/compile.mjs) and the same source decoder
// (tools/flash-source/format.mjs).
import { decodeChar, decodeTimeline, decodeScript } from '../../tools/flash-source/format.mjs';
import { levelSymbols, composeScreen, instanceScript, stripProps, PROPS_BEGIN, PROPS_END, isRef, isTrigger, triggerNames } from '../../tools/levels/compile.mjs';

export class LevelApplier {
  constructor(rt, data) {
    this.rt = rt;
    this.ids = data.ids;
    this.screen = data.screen;
    this.nextId = Math.max(0, ...Object.values(this.ids)) + 1;
    // compiled instance handlers from the build, by source text, so instances whose
    // script didn't change keep working after they move to another depth
    this.compiled = new Map();
    for (const [key, text] of Object.entries(rt.lib.instanceScripts)) {
      const fn = rt.instanceScripts[key];
      if (fn && !this.compiled.has(text)) this.compiled.set(text, fn);
    }
    // the same, by script part: a scripted instance whose props change still runs its compiled script.
    // That code starts by setting the props it was built with (one `name = value;` line each), so
    // keep their names: the handler skips those first writes and the edited props stand.
    this.compiledCore = new Map();
    for (const [text, fn] of this.compiled) if (text.includes(PROPS_BEGIN)) this.compiledCore.set(stripProps(text), { fn, keys: builtPropNames(text) });
  }

  id(name) {
    if (name === null) return 65535;
    let v = this.ids[name];
    // a symbol the editor's data adds, such as a new vision zone, gets the next free id
    if (v === undefined && /^level assets\/(vision\d+-\d+(\/shape 1)?|briefing\d+\/text \d+)$/.test(name)) v = this.ids[name] = this.nextId++;
    if (v === undefined) throw new Error(`unknown symbol "${name}"`);
    return v;
  }

  // handler for an instance script: the build's compiled code when the text is unchanged; else props are
  // applied directly, followed by the compiled code of the script part (the text without its props)
  handlerFor(text, propsByText) {
    if (this.compiled.has(text)) return this.compiled.get(text);
    const props = propsByText.get(text);
    // a props-only instance has no script part (its text has no props markers: it is all props)
    const core = props ? (text.includes(PROPS_BEGIN) ? stripProps(text) : '') : text;
    let compiled = {}, builtKeys = [];
    if (core && core.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim()) {
      const hit = this.compiledCore.get(core);
      compiled = this.compiled.get(core) || (hit && hit.fn);
      if (hit && !this.compiled.has(core)) builtKeys = hit.keys;
      if (!compiled) console.warn('[editor] no compiled code for instance script (save to rebuild it):\n' + core);
    }
    if (!props) return compiled || null;
    const G = this.rt.env.G;
    const load = compiled && compiled['clip:load'];
    return {
      ...compiled,
      'clip:load': function ($c) {
        for (const [k, v] of Object.entries(props)) $c[k] = materialize(v, $c, G);
        if (!load) return;
        const release = skipFirstWrites($c, builtKeys);
        try { return load.call(this, $c); } finally { release(); }
      },
    };
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
      for (const inst of list || []) if (inst.props) propsByText.set(decodeScript(instanceScript(inst.props, inst.script)), inst.props);
    };
    for (const L of levels) for (const k of ['boxes', 'powerups', 'enemies', 'doors', 'features', 'pathNodes']) collect(L[k]);
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

function materialize(v, clip, G) {
  if (Array.isArray(v)) return v.map((x) => materialize(x, clip, G));
  if (isRef(v)) return clip._parent ? clip._parent[v.$ref] : undefined;
  if (isTrigger(v)) { const names = triggerNames(v); return function () { for (const n of names) G.trigger.call(clip, n); }; }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, materialize(x, clip, G)]));
  return v;
}

// the prop names in a built instance script's props block (propsScript writes one `name = value;` per line)
function builtPropNames(text) {
  const a = text.indexOf(PROPS_BEGIN), b = text.indexOf(PROPS_END, a);
  if (a < 0 || b < 0) return [];
  return [...text.slice(a, b).matchAll(/^\s*([A-Za-z_]\w*)\s*=/gm)].map((m) => m[1]);
}

// While old compiled code runs, ignore its first write to each of these names (the props it was
// built with) and keep what the clip has now: the edited value, or nothing for a removed prop.
// Later writes, by the script itself, go through. Returns a function that undoes any guard left.
function skipFirstWrites($c, keys) {
  const left = new Map();
  const settle = (k) => {
    const { had, val } = left.get(k);
    left.delete(k);
    delete $c[k];
    if (had) $c[k] = val;
  };
  for (const k of keys) {
    if (left.has(k)) continue;
    const had = Object.prototype.hasOwnProperty.call($c, k), val = $c[k];
    left.set(k, { had, val });
    Object.defineProperty($c, k, { configurable: true, enumerable: true, get: () => val, set: () => settle(k) });
  }
  return () => { for (const k of [...left.keys()]) settle(k); };
}

// open level i's briefing screen (its Play mission button starts the level)
export function showBriefing(rt, i) {
  const G = rt.env.G;
  const s = rt.root.screen_mc;
  if (s && s._currentframe % 2 === 0 && typeof G.endLevel === 'function') G.endLevel();
  G.gotoLevel(i);
  rt.flush();
  rt.root.screen_mc.gotoAndStop(i * 2 + 1);
  rt.flush();
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

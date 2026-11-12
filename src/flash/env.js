// The AS2 global environment the compiled scripts run in: _global (G), the
// built-in functions/classes (AS), and the small helpers the compiler emits
// to keep AVM1 semantics ($v scope lookup, $keys for..in order, ...).
import { DisplayObject, MovieClip, TextField, SimpleButton } from './display.js';
import { BitmapData, Matrix, Point, Rectangle, ColorTransform } from './bitmapdata.js';

export function createEnv(rt) {
  const G = {};
  G._global = G;
  const SINK = {};

  // ---- filters (mutable, like flash.filters.*) ----
  class GlowFilter {
    constructor(color = 0xff0000, alpha = 1, blurX = 6, blurY = 6, strength = 2, quality = 1, inner = false, knockout = false) {
      Object.assign(this, { type: 'glow', color, alpha, blurX, blurY, strength, quality, inner, knockout });
    }
  }
  class BlurFilter {
    constructor(blurX = 4, blurY = 4, quality = 1) { Object.assign(this, { type: 'blur', blurX, blurY, quality }); }
  }
  class DropShadowFilter {
    constructor(distance = 4, angle = 45, color = 0, alpha = 1, blurX = 4, blurY = 4, strength = 1, quality = 1, inner = false, knockout = false) {
      Object.assign(this, { type: 'dropShadow', distance, angle: angle * Math.PI / 180, color, alpha, blurX, blurY, strength, quality, inner, knockout });
    }
  }

  class FlashBitmapData extends BitmapData {
    constructor(w, h, transparent = true, fill = 0xffffffff) { super(rt, w, h, transparent, fill); }
  }

  class Color {
    constructor(mc) { this.mc = mc; }
    setRGB(c) {
      if (!this.mc) return;
      const cx = this.mc.cx ? this.mc.cx.slice() : [1, 1, 1, 1, 0, 0, 0, 0];
      cx[0] = cx[1] = cx[2] = 0;
      cx[4] = c >> 16 & 255; cx[5] = c >> 8 & 255; cx[6] = c & 255;
      this.mc.cx = cx;
      this.mc.scripted = true;
    }
    getRGB() {
      const cx = this.mc && this.mc.cx;
      if (!cx) return 0;
      return (Math.round(cx[4]) << 16) | (Math.round(cx[5]) << 8) | Math.round(cx[6]);
    }
    setTransform(t) {
      if (!this.mc) return;
      const cx = this.mc.cx ? this.mc.cx.slice() : [1, 1, 1, 1, 0, 0, 0, 0];
      if ('ra' in t) cx[0] = t.ra / 100; if ('ga' in t) cx[1] = t.ga / 100; if ('ba' in t) cx[2] = t.ba / 100; if ('aa' in t) cx[3] = t.aa / 100;
      if ('rb' in t) cx[4] = t.rb; if ('gb' in t) cx[5] = t.gb; if ('bb' in t) cx[6] = t.bb; if ('ab' in t) cx[7] = t.ab;
      this.mc.cx = cx;
    }
    getTransform() {
      const cx = (this.mc && this.mc.cx) || [1, 1, 1, 1, 0, 0, 0, 0];
      return { ra: cx[0] * 100, ga: cx[1] * 100, ba: cx[2] * 100, aa: cx[3] * 100, rb: cx[4], gb: cx[5], bb: cx[6], ab: cx[7] };
    }
  }

  // SharedObject backed by localStorage (Infinity survives the round trip)
  const sharedObjects = {};
  const SharedObject = {
    getLocal(name) {
      if (sharedObjects[name]) return sharedObjects[name];
      const key = 'shrapnel-city:so:' + name;
      let data = {};
      try {
        const raw = localStorage.getItem(key);
        if (raw) data = JSON.parse(raw, (k, v) => (v === '__Infinity__' ? Infinity : v === '__-Infinity__' ? -Infinity : v));
      } catch (e) { /* storage unavailable */ }
      const so = {
        data,
        flush() {
          try {
            localStorage.setItem(key, JSON.stringify(so.data, (k, v) => (v === Infinity ? '__Infinity__' : v === -Infinity ? '__-Infinity__' : v)));
          } catch (e) { /* ignore */ }
          return true;
        },
        clear() { so.data = {}; try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
      };
      sharedObjects[name] = so;
      return so;
    },
  };

  const Key = {
    BACKSPACE: 8, TAB: 9, ENTER: 13, SHIFT: 16, CONTROL: 17, ALT: 18, CAPSLOCK: 20, ESCAPE: 27, SPACE: 32,
    PGUP: 33, PGDN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, INSERT: 45, DELETEKEY: 46,
    isDown: (code) => rt.keys.has(code),
    getCode: () => rt.lastKey,
    getAscii: () => rt.lastAscii,
    isToggled: () => false,
    addListener: (o) => { if (!rt.keyListeners.includes(o)) rt.keyListeners.push(o); },
    removeListener: (o) => { const i = rt.keyListeners.indexOf(o); if (i >= 0) rt.keyListeners.splice(i, 1); return i >= 0; },
  };
  const Mouse = {
    addListener: (o) => { if (!rt.mouseListeners.includes(o)) rt.mouseListeners.push(o); },
    removeListener: (o) => { const i = rt.mouseListeners.indexOf(o); if (i >= 0) rt.mouseListeners.splice(i, 1); },
    hide: () => { rt.canvas.style.cursor = 'none'; },
    show: () => { rt.canvas.style.cursor = 'default'; },
  };

  const wrap = (fn, args) => () => {
    if (typeof fn !== 'function') return;
    try { fn.apply(undefined, args); } catch (e) { console.error(e); }
    rt.flush();
  };

  const AS = {
    trace: (...a) => { if (rt.debug) console.log('[trace]', ...a); },
    int: (x) => (Number(x) | 0),
    random: (n) => Math.floor(Math.random() * (Number(n) | 0)) | 0,
    getTimer: () => rt.getTimer(),
    setTimeout: (fn, delay, ...args) => rt.setTimer(window.setTimeout, wrap(fn, args), delay),
    clearTimeout: (id) => window.clearTimeout(id),
    setInterval: (fn, delay, ...args) => rt.setTimer(window.setInterval, wrap(fn, args), delay),
    clearInterval: (id) => window.clearInterval(id),
    Key, Mouse, SharedObject, Color,
    Stage: { scaleMode: 'noScale', align: 'tl', width: 800, height: 600, addListener() {}, removeListener() {} },
    flash: {
      geom: { Matrix, Point, Rectangle, ColorTransform },
      display: { BitmapData: FlashBitmapData },
      filters: { GlowFilter, BlurFilter, DropShadowFilter },
    },
    TextField: { StyleSheet: class { parseCSS(css) { this.css = css; return true; } } },
    ASSetPropFlags: (obj, names, flags) => {
      if (!obj || !(flags & 1)) return;
      for (const n of String(names).split(',')) {
        const d = Object.getOwnPropertyDescriptor(obj, n);
        if (d) Object.defineProperty(obj, n, { ...d, enumerable: false });
      }
    },
    MovieClip,
    escape: (s) => encodeURIComponent(String(s)),
    unescape: (s) => decodeURIComponent(String(s)),
    getVersion: () => 'WIN 8,0,0,0',
    Sound: class { attachSound() {} start() {} stop() {} setVolume() {} },
    System: { capabilities: {} },
  };

  // keys present on freshly built display objects are runtime internals,
  // hidden from AS2 for..in
  const INTERNAL = new Set();
  const probe = [new MovieClip(rt, null)];
  for (const o of probe) for (const k of Object.keys(o)) INTERNAL.add(k);

  function $v(c, k) {
    if (c != null && typeof c === 'object' && k in c) return c[k];
    if (k in G) return G[k];
    return AS[k];
  }
  function $call(c, k, ...args) {
    const f = $v(c, k);
    return typeof f === 'function' ? f.apply(c, args) : undefined;
  }
  function $o(x) { return x === null || x === undefined || typeof x !== 'object' && typeof x !== 'function' ? SINK : x; }
  function $keys(o) {
    if (o === null || o === undefined || typeof o !== 'object' && typeof o !== 'function') return [];
    const own = Object.keys(o);
    if (Array.isArray(o)) {
      // AS2 enumerates array slots newest-first
      return own.reverse();
    }
    if (o instanceof DisplayObject) return own.filter((k) => !INTERNAL.has(k) && k[0] !== '$').reverse();
    return own.reverse();
  }
  function $inc(c, k, d, prefix) {
    const old = Number($v(c, k));
    c[k] = old + d;
    return prefix ? old + d : old;
  }
  function $typeof(v) {
    if (v instanceof MovieClip) return 'movieclip';
    if (v === null) return 'null';
    if (v instanceof TextField || v instanceof SimpleButton) return 'object';
    return typeof v;
  }

  return { G, AS, $v, $call, $o, $keys, $inc, $typeof };
}

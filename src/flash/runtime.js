// The "Flash Player": owns the library, display list root, frame loop, action
// queue (frame scripts run after the display list is updated, like AVM1), and
// keyboard / mouse input.
import { Library } from './library.js';
import { Renderer } from './renderer.js';
import { MovieClip, Shape, MorphShape, StaticText, TextField, SimpleButton, DisplayObject } from './display.js';
import { mul, invert, apply } from './geom.js';
import { BitmapData } from './bitmapdata.js';
import { createEnv } from './env.js';

export class Runtime {
  constructor(canvas, { base = 'assets/', scale = 1 } = {}) {
    this.canvas = canvas;
    this.lib = new Library(base);
    this.initialScale = scale;
    this.queue = [];
    this.behaviors = new Map();   // char id -> {init, frames:{n:fn}}
    this.instanceInits = {};       // "parent:depth:frame" -> fn(clip)
    this.clips = new Set();
    this.fontsByName = new Map();
    this.keys = new Set();
    this.lastKey = 0;
    this.lastAscii = 0;
    this.keyListeners = [];
    this.mouseListeners = [];
    this.mouseX = 0;
    this.mouseY = 0;
    this.hover = null;
    this.pressed = null;
    this.paused = false;
    this.frameHooks = [];
    this.warned = new Set();
    this.time0 = performance.now();
  }

  async load(onProgress) {
    await this.lib.load(onProgress);
    this.width = this.lib.stage[1] - this.lib.stage[0];
    this.height = this.lib.stage[3] - this.lib.stage[2];
    this.frameRate = this.lib.frameRate;
    const bg = this.lib.background;
    this.bgColor = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    for (const c of this.lib.chars.values()) {
      if (c.type === 'font' && c.glyphs.length && !this.fontsByName.has(c.name)) this.fontsByName.set(c.name, c);
    }
    this.renderer = new Renderer(this, this.canvas, this.initialScale);
    this.env = createEnv(this);
    const mod = await import('../generated/scripts.js');
    const compiled = mod.default(this.env);
    this.frameScripts = compiled.frames;
    this.instanceScripts = compiled.instances;
    this.keyClips = new Set();
    this.keyPress = [];
  }

  get quality() { return (this.renderer.quality || 'high').toUpperCase(); }
  setQuality(v) { this.renderer.quality = String(v || 'HIGH').toLowerCase(); }

  // AS2 timers keep running on wall-clock time; track them so a reset can clear them
  setTimer(kind, fn, delay) {
    const id = kind(fn, Math.max(0, +delay || 0));
    return id;
  }

  fontByName(name) { return this.fontsByName.get(name); }

  getTimer() { return Math.round(performance.now() - this.time0); }

  // ---- instances ----
  createInstance(id) {
    const c = this.lib.get(id);
    if (!c) return null;
    switch (c.type) {
      case 'sprite': return new MovieClip(this, c);
      case 'shape': return new Shape(this, c);
      case 'morph': return new MorphShape(this, c);
      case 'text': return new StaticText(this, c);
      case 'edittext': return new TextField(this, c);
      case 'button': return new SimpleButton(this, c);
      default: return null;
    }
  }

  createRoot() {
    this.root = new MovieClip(this, this.lib.get(0));
    this.root.__name = '_level0';
    this.queueInit(this.root, null);
    this.root._initTimeline();
    this.flush();
    return this.root;
  }

  _trackClip(c) { this.clips.add(c); }
  _forgetClip(c) {
    this.clips.delete(c);
    if (this.hover === c) this.hover = null;
    if (this.pressed === c) this.pressed = null;
  }
  bindTextField() {}

  // ---- behaviours (the ported ActionScript) ----
  // define(symbolNameOrLinkageOrId, {init(clip), frames: {n: fn(clip)}})
  define(key, beh) {
    const id = typeof key === 'number' ? key : this.lib.idFor(key);
    if (id === undefined) { console.warn('define: unknown symbol', key); return; }
    const cur = this.behaviors.get(id) || { frames: {} };
    if (beh.init) cur.init = beh.init;
    if (beh.frames) Object.assign(cur.frames, beh.frames);
    this.behaviors.set(id, cur);
  }

  queueFrameScript(clip, n) {
    const f = this.frameScripts[clip.charId];
    if (f && f[n]) this.queue.push({ clip, fn: f[n] });
  }

  queueInit(clip, key) {
    this.queue.push({ clip, init: true, key });
  }

  runInit(e) {
    const clip = e.clip;
    if (clip.removed || clip.$inited) return;
    clip.$inited = true;
    // onClipEvent(load) first, then the clip's frame 1 actions
    if (e.key) this.attachHandlers(clip, e.key);
    const f = this.frameScripts[clip.charId];
    if (f && f[1]) this.call(f[1], clip);
  }

  // instance scripts: onClipEvent(...) and on(...) handlers
  attachHandlers(clip, key) {
    const inst = this.instanceScripts[key];
    clip.$instKey = key;
    if (!inst) return;
    // on() handlers on a Button symbol run in the parent timeline's scope
    const scope = clip instanceof SimpleButton ? clip._parent : clip;
    for (const [k, fn] of Object.entries(inst)) {
      const [kind, ev] = k.split(':');
      if (kind === 'clip') {
        if (ev === 'load') this.call(fn, clip);
        else if (ev === 'keyDown' || ev === 'keyUp') {
          (clip.$clipEvents ||= {})[ev] = fn;
          this.keyClips.add(clip);
        } else if (ev === 'enterFrame') (clip.$clipEvents ||= {}).enterFrame = fn;
      } else if (ev.startsWith('key')) {
        this.keyPress.push({ clip, code: +ev.slice(3), fn, scope });
      } else {
        (clip.$on ||= {})[ev] = { fn, scope };
      }
    }
  }

  call(fn, clip) {
    try { fn.call(clip, clip); } catch (err) { console.error(err); }
  }

  flush() {
    let guard = 0;
    while (this.queue.length && guard++ < 100000) {
      const e = this.queue.shift();
      if (e.init) { this.runInit(e); continue; }
      if (e.clip.removed) continue;
      this.call(e.fn, e.clip);
    }
  }

  // ---- frame loop ----
  tick() {
    if (!this.root) return;
    // actions queued outside the frame loop (timers, devtools) run before anything advances
    this.flush();
    // 1. advance playheads (snapshot so new clips don't advance this frame)
    const list = [];
    collect(this.root, list);
    for (const c of list) if (!c.removed) c._advance();
    this.flush();
    // 2. onEnterFrame handlers
    const efs = [];
    collect(this.root, efs);
    for (const c of efs) {
      if (c.removed) continue;
      if (c.$clipEvents && c.$clipEvents.enterFrame) this.call(c.$clipEvents.enterFrame, c);
      if (typeof c.onEnterFrame === 'function') {
        try { c.onEnterFrame(); } catch (err) { console.error(err); }
        this.flush();
      }
    }
    for (const h of this.frameHooks.slice()) h();
    this.flush();
  }

  render() {
    this.renderer.render(this.root, this.bgColor);
  }

  start() {
    const step = 1000 / this.frameRate;
    let acc = 0, last = performance.now();
    const loop = (now) => {
      acc += Math.min(250, now - last);
      last = now;
      let n = 0;
      while (acc >= step && n < 4) {
        if (!this.paused) this.tick();
        acc -= step;
        n++;
      }
      if (n) this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---- input ----
  attachInput(el) {
    window.addEventListener('keydown', (e) => {
      const code = flashKeyCode(e);
      if ([32, 37, 38, 39, 40, 9, 8, 112].includes(code) || (e.ctrlKey && code !== 82)) e.preventDefault();
      this.lastKey = code;
      this.lastAscii = e.key && e.key.length === 1 ? e.key.charCodeAt(0) : (code === 13 ? 13 : code === 27 ? 27 : 0);
      const repeat = this.keys.has(code);
      this.keys.add(code);
      if (e.shiftKey) this.keys.add(16); else this.keys.delete(16);
      if (e.ctrlKey) this.keys.add(17); else this.keys.delete(17);
      this.dispatchKey('onKeyDown', repeat);
    });
    window.addEventListener('keyup', (e) => {
      const code = flashKeyCode(e);
      this.lastKey = code;
      this.keys.delete(code);
      if (!e.shiftKey) this.keys.delete(16);
      if (!e.ctrlKey) this.keys.delete(17);
      this.dispatchKey('onKeyUp');
    });
    window.addEventListener('blur', () => this.keys.clear());
    const pos = (e) => {
      const r = el.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * this.width / r.width;
      this.mouseY = (e.clientY - r.top) * this.height / r.height;
    };
    el.addEventListener('mousemove', (e) => { pos(e); this.updateHover(); this.dispatchMouse('onMouseMove'); });
    el.addEventListener('mousedown', (e) => {
      pos(e); this.updateHover();
      el.focus && el.focus();
      const t = this.hover;
      this.pressed = t;
      if (t) {
        if (t instanceof SimpleButton) t.$state = 4;
        this.fire(t, 'onPress');
      }
      this.dispatchMouse('onMouseDown');
    });
    window.addEventListener('mouseup', (e) => {
      pos(e); this.updateHover();
      const t = this.pressed;
      this.pressed = null;
      if (t) {
        if (t instanceof SimpleButton) t.$state = this.hover === t ? 2 : 1;
        if (this.hover === t) this.fire(t, 'onRelease'); else this.fire(t, 'onReleaseOutside');
      }
      this.dispatchMouse('onMouseUp');
    });
  }

  fire(target, ev) {
    const fn = target[ev];
    if (typeof fn === 'function') {
      try { fn.call(target); } catch (err) { console.error(err); }
    }
    const h = target.$on && target.$on[ev.charAt(2).toLowerCase() + ev.slice(3)];
    if (h) this.call(h.fn, h.scope);
    this.flush();
  }

  dispatchKey(ev, repeat) {
    for (const l of this.keyListeners.slice()) {
      if (typeof l[ev] === 'function') {
        try { l[ev](repeat); } catch (err) { console.error(err); }
      }
    }
    const ce = ev === 'onKeyDown' ? 'keyDown' : 'keyUp';
    for (const c of [...this.keyClips]) {
      if (c.removed) { this.keyClips.delete(c); continue; }
      const fn = c.$clipEvents && c.$clipEvents[ce];
      if (fn) this.call(fn, c);
    }
    if (ev === 'onKeyDown' && !repeat) {
      this.keyPress = this.keyPress.filter((k) => !k.clip.removed);
      for (const k of this.keyPress.slice()) if (k.code === this.lastKey && !k.clip.removed) this.call(k.fn, k.scope);
    }
    this.flush();
  }

  dispatchMouse(ev) {
    for (const l of this.mouseListeners.slice()) {
      if (typeof l[ev] === 'function') {
        try { l[ev](); } catch (err) { console.error(err); }
      }
    }
    this.flush();
  }

  updateHover() {
    const t = this.findInteractive(this.root, [1, 0, 0, 1, 0, 0]);
    if (t !== this.hover) {
      const old = this.hover;
      this.hover = t;
      if (old && !old.removed) {
        if (old instanceof SimpleButton) old.$state = 1;
        this.fire(old, this.pressed === old ? 'onDragOut' : 'onRollOut');
      }
      if (t) {
        if (t instanceof SimpleButton) t.$state = this.pressed === t ? 4 : 2;
        this.fire(t, this.pressed === t ? 'onDragOver' : 'onRollOver');
      }
    }
    const hand = t && t.useHandCursor !== false;
    this.canvas.style.cursor = hand ? 'pointer' : 'default';
  }

  findInteractive(node, pm) {
    if (!node.__visible || node.maskOf) return null;
    const m = mul(pm, node.m);
    const kids = node.children || [];
    if (node instanceof MovieClip) {
      if (isInteractive(node) && node !== this.root) {
        return this.renderer.hitNode(node, pm, this.mouseX, this.mouseY, true) ? node : null;
      }
      for (let i = kids.length - 1; i >= 0; i--) {
        const r = this.findInteractive(kids[i], m);
        if (r) return r;
      }
      return null;
    }
    if (node instanceof SimpleButton && node.enabled !== false) {
      return this.renderer.hitNode(node, pm, this.mouseX, this.mouseY, true) ? node : null;
    }
    return null;
  }
}

function isInteractive(c) {
  return c.enabled !== false && (typeof c.onRelease === 'function' || typeof c.onPress === 'function' ||
    typeof c.onRollOver === 'function' || typeof c.onRollOut === 'function' || !!c.$on);
}

function collect(node, out) {
  if (node instanceof MovieClip) {
    out.push(node);
    for (const k of node.children) if (k instanceof MovieClip) collect(k, out);
  }
}

function trivial(s) {
  if (s === 'stop();') return function () { this.stop(); };
  if (s === 'play();') return function () { this.play(); };
  if (s === 'this.removeMovieClip();' || s === 'removeMovieClip();' || s === 'removeMovieClip(this);') return function () { this.removeMovieClip(); };
  let m = /^(gotoAndPlay|gotoAndStop)\((\d+|"[^"]*"|'[^']*')\);$/.exec(s);
  if (m) {
    const f = /^\d+$/.test(m[2]) ? +m[2] : m[2].slice(1, -1);
    return function () { this[m[1]](f); };
  }
  m = /^stop\(\); ?(this\.)?_visible ?= ?false;$/.exec(s);
  if (m) return function () { this.stop(); this._visible = false; };
  return null;
}

// Flash key codes equal Windows virtual key codes
export function flashKeyCode(e) {
  const k = e.keyCode || 0;
  if (k === 59) return 186;
  if (k === 61) return 187;
  if (k === 173) return 189;
  return k;
}

export const Key = {
  BACKSPACE: 8, TAB: 9, ENTER: 13, SHIFT: 16, CONTROL: 17, CAPSLOCK: 20, ESCAPE: 27, SPACE: 32,
  PGUP: 33, PGDN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, INSERT: 45, DELETEKEY: 46,
};

export { BitmapData, DisplayObject };

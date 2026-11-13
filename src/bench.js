// Frame-time benchmark: open index.html?bench (optionally &only=heatray,bombs).
// Drives scripted heavy scenarios frame by frame, timing the game logic (tick)
// and drawing (render) of every frame, and shows a table when done. The result
// is also left on window.benchResult for tools/bench.mjs.

const FRAME_BUDGET = 1000 / 31;

const KEY = { left: 37, up: 38, right: 39, down: 40, space: 32, ctrl: 17, shift: 16, esc: 27, enter: 13 };

export async function run(rt) {
  cancelAnimationFrame(rt.raf);
  rt.start = () => {};
  const G = rt.env.G;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { rt.tick(); rt.render(); await raf(); } };
  const press = (code) => { rt.keys.add(code); rt.lastKey = code; rt.lastAscii = code === 13 ? 13 : code === 27 ? 27 : 0; rt.dispatchKey('onKeyDown', false); };
  const release = (code) => { rt.keys.delete(code); rt.lastKey = code; rt.dispatchKey('onKeyUp'); };
  const tap = async (code) => { press(code); await step(1); release(code); await step(1); };
  const screen = () => rt.root.screen_mc;
  const player = () => screen() && screen().player_mc;

  async function startLevel(n) {
    rt.keys.clear();
    for (let i = 0; i < 600 && typeof G.gotoLevel !== 'function'; i++) await step(1); // preloader + title
    G.gotoLevel(n);
    await step(45);
    await tap(KEY.enter);
    await step(90);
    if (params.get('quality')) { G.currentQuality = params.get('quality').toUpperCase(); rt.setQuality(G.currentQuality); } // as the HUD toggle does
    const p = player();
    p.health = Infinity;
    for (const w of p.weapons1.concat(p.weapons2)) w.ammo = Infinity;
    return p;
  }
  const arm = (p, slot, name) => {
    const ws = p['weapons' + slot];
    p.changeWep(slot, ws.findIndex((w) => w.name === name));
  };

  const scenarios = {
    'idle-dropzone': { level: 1, frames: 90, setup() {}, frame() {} },
    heatray: {
      level: 1, frames: 90,
      setup(p) { arm(p, 1, 'Heat Ray'); p._x = 330; p._y = 470; p._rotation = -60; press(KEY.space); press(KEY.left); },
      frame() {},
    },
    flamer: {
      level: 1, frames: 90,
      setup(p) { arm(p, 1, 'Flamer'); p._x = 330; p._y = 470; p._rotation = -60; press(KEY.space); press(KEY.right); },
      frame() {},
    },
    'cluster-bombs': {
      level: 1, frames: 120,
      setup(p) { arm(p, 2, 'Cluster Bomb'); p._x = 400; p._y = 440; },
      frame(p, i) { if (i % 12 === 0) { p.refire2 = 1e9; press(KEY.ctrl); } else if (i % 12 === 2) release(KEY.ctrl); },
    },
    'shrapnel-storm': {
      level: 2, frames: 90,
      setup() {
        const r = rt.root;
        for (const b of r.boxes.slice()) b.hit(999, 0);
        for (const e of r.enemies.slice()) e.hit(999, 0);
      },
      frame() {},
    },
    'bridge-firefight': {
      level: 3, frames: 120,
      setup(p) { arm(p, 1, 'Gatling'); press(KEY.space); press(KEY.up); },
      frame(p, i) { if (i === 20) release(KEY.up); if (i % 30 === 0) { release(KEY.left); press(KEY.right); } if (i % 30 === 15) { release(KEY.right); press(KEY.left); } },
    },
    'esc-menu': {
      level: 1, frames: 60,
      setup() { press(KEY.esc); release(KEY.esc); },
      frame() {},
    },
  };

  const params = new URLSearchParams(location.search);
  const only = params.get('only') ? params.get('only').split(',') : Object.keys(scenarios);
  const results = [];
  const status = overlay();
  for (const name of only) {
    const sc = scenarios[name];
    if (!sc) continue;
    seedRandom(1234); // same debris, sparks and AI rolls every run, so numbers compare
    status.textContent = `bench: ${name}…`;
    const p = await startLevel(sc.level);
    sc.setup(p);
    await step(5); // let the scenario get going
    const ticks = [], renders = [];
    const stats = params.has('stats') ? (rt.renderer.stats = { kinds: {} }) : null;
    for (let i = 0; i < sc.frames; i++) {
      sc.frame(player(), i);
      const t0 = performance.now();
      rt.tick();
      const t1 = performance.now();
      rt.render();
      const t2 = performance.now();
      ticks.push(t1 - t0); renders.push(t2 - t1);
      await raf();
    }
    rt.keys.clear();
    rt.renderer.stats = null;
    const total = ticks.map((t, i) => t + renders[i]);
    results.push({
      scenario: name,
      scale: +rt.renderer.scale.toFixed(2),
      quality: rt.quality,
      tick: +avg(ticks).toFixed(2),
      render: +avg(renders).toFixed(2),
      p95: +pct(total, 0.95).toFixed(2),
      max: +Math.max(...total).toFixed(2),
      fps: +Math.min(31, 1000 / pct(total, 0.95)).toFixed(1),
      worst: total.map((t, i) => [i, +ticks[i].toFixed(1), +renders[i].toFixed(1)]).sort((a, b) => (b[1] + b[2]) - (a[1] + a[2])).slice(0, 6),
      ...(stats ? { layers: Object.fromEntries(Object.entries(stats.kinds).map(([k, v]) => [k || 'other', {
        perFrame: +(v.n / sc.frames).toFixed(1), missPerFrame: +(v.miss / sc.frames).toFixed(1),
        missKpx: Math.round(v.missPx / sc.frames / 1000), drawKpx: Math.round(v.drawPx / sc.frames / 1000), ms: +(v.ms / sc.frames).toFixed(2) }])) } : {}),
    });
  }
  window.benchResult = results;
  status.innerHTML = table(results);
  return results;
}

function seedRandom(seed) {
  let a = seed >>> 0; // mulberry32
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function avg(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function pct(a, p) { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

function overlay() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;background:rgba(0,0,0,.8);color:#cfe;font:12px/1.4 monospace;padding:8px;white-space:pre';
  document.body.appendChild(d);
  return d;
}

function table(rows) {
  const head = 'scenario          scale  tick ms  render ms  p95 ms  max ms  fps(p95)';
  const lines = rows.map((r) => [r.scenario.padEnd(17), String(r.scale).padStart(5), String(r.tick).padStart(8), String(r.render).padStart(10),
    String(r.p95).padStart(7), String(r.max).padStart(7), String(r.fps).padStart(9) + (r.p95 > FRAME_BUDGET ? '  <-- over budget' : '')].join(' '));
  return [head, ...lines].join('\n');
}

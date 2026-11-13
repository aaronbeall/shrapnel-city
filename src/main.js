// Boots the Flash-style runtime and plays the original SWF timeline.
import { Runtime } from './flash/runtime.js';

const canvas = document.getElementById('stage');
const loading = document.getElementById('loading');
const params = new URLSearchParams(location.search);

const rt = new Runtime(canvas, { base: 'assets/' });
rt.debug = params.has('debug');
window.rt = rt; // handy for debugging from the console

// Render resolution follows the game's own quality toggle (HUD button):
//   HIGH   - sharp: CSS size x device pixel ratio, capped at 2x the 800x600 stage
//   MEDIUM - one canvas pixel per CSS pixel (no extra retina resolution)
//   LOW    - the native 800x600, scaled up as hard pixels like Flash's unsmoothed LOW
// ?scale=N forces a resolution (benchmarks).
const MAX_SCALE = 2;
function fit() {
  // keep 4:3 and fill the window
  const sw = window.innerWidth, sh = window.innerHeight;
  const s = Math.min(sw / 800, sh / 600);
  const cssW = Math.floor(800 * s), cssH = Math.floor(600 * s);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  if (!rt.renderer) return;
  const q = rt.renderer.quality || 'high';
  let scale;
  if (params.has('scale')) scale = +params.get('scale');
  else if (q === 'low') scale = 1;
  else if (q === 'medium') scale = Math.max(1, Math.min(MAX_SCALE, s));
  else scale = Math.max(1, Math.min(MAX_SCALE, s * (window.devicePixelRatio || 1)));
  canvas.style.imageRendering = q === 'low' ? 'pixelated' : 'auto';
  if (Math.abs(scale - rt.renderer.scale) > 0.01) rt.renderer.setScale(scale);
}

await rt.load((p) => { loading.textContent = `loading… ${Math.round(p * 100)}%`; });
loading.remove();
fit();
window.addEventListener('resize', fit);
rt.onQualityChange = fit;
rt.createRoot();
rt.attachInput(canvas);
canvas.focus();
rt.start();
if (params.has('bench')) import('./bench.js').then((m) => m.run(rt));

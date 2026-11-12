// Boots the Flash-style runtime and plays the original SWF timeline.
import { Runtime } from './flash/runtime.js';

const canvas = document.getElementById('stage');
const loading = document.getElementById('loading');
const params = new URLSearchParams(location.search);

const rt = new Runtime(canvas, { base: 'assets/' });
rt.debug = params.has('debug');
window.rt = rt; // handy for debugging from the console

function fit() {
  // keep 4:3, fill the window, render at device resolution
  const sw = window.innerWidth, sh = window.innerHeight;
  const s = Math.min(sw / 800, sh / 600);
  const cssW = Math.floor(800 * s), cssH = Math.floor(600 * s);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  if (rt.renderer) {
    const scale = Math.max(1, Math.min(3, s * (window.devicePixelRatio || 1)));
    if (Math.abs(scale - rt.renderer.scale) > 0.01) rt.renderer.setScale(scale);
  }
}

await rt.load((p) => { loading.textContent = `loading… ${Math.round(p * 100)}%`; });
loading.remove();
fit();
window.addEventListener('resize', fit);
rt.createRoot();
rt.attachInput(canvas);
canvas.focus();
rt.start();

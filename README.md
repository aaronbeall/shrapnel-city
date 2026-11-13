# Shrapnel City (browser port)

A faithful HTML5 canvas port of the Flash AS2 game *Shrapnel City* (v14). The original
ActionScript runs unchanged: it is compiled to JavaScript and executed on a small
Flash-like runtime, so the hand-crafted pixel collision, line of sight, timeline state
and blend-mode lighting behave as they did in Flash Player.

## Play

Online: https://aaronbeall.github.io/shrapnel-city/ (GitHub Pages serves `main` as is; there is no build step).

## Run locally

No build step. Serve the folder and open it:

```sh
npm run serve        # python3 -m http.server 8123
# open http://localhost:8123/
```

Controls: arrows to maneuver, Z/X strafe, Space primary, Ctrl secondary,
Ins / Shift+Ins and Del / Shift+Del to switch weapons, Esc menu, H help.

## Benchmark

Open `index.html?bench` to run seven scripted heavy scenes (Heat Ray, Flamer, cluster bombs, a whole level exploding at once, a Bridge firefight, the Esc menu) with seeded randomness. A table of game-logic (tick) and drawing (render) times per frame is shown when it finishes. `&only=heatray,flamer`, `&quality=low|medium|high`, `&scale=2` and `&stats` (per-layer counts) narrow it down. `node tools/bench.mjs scale=2` runs the same thing headless.

## Layout

| Path | What |
| --- | --- |
| `as2/` | Original AS2 sources (`#include`d by the FLA's frame and instance scripts) |
| `assets/swf.json`, `assets/bitmaps/` | Shapes, morphs, sprites, fonts, bitmaps extracted from the v14 SWF |
| `assets/symbols.json` | FLA (XFL) symbol names, linkage ids, frame scripts and instance scripts mapped onto SWF character ids |
| `src/generated/scripts.js` | Compiled game scripts. Regenerate with `npm run build:scripts`; never hand-edit |
| `src/flash/` | Runtime: display list and timeline, renderer (blend modes, glow/blur filters, masks), AS2 environment and builtins, BitmapData |
| `tools/swf2json.py` | SWF parser that produces `assets/swf.json` and `assets/bitmaps/` |
| `tools/xflmap.py` | Maps the FLA's XFL library onto SWF character ids, producing `assets/symbols.json` |
| `tools/as2js.mjs` | AS2 to JS compiler (acorn + astring) that keeps AVM1 scoping rules |
| `tools/gallery.html` | Symbol contact sheet for checking extracted art |

## How the compiler keeps AS2 semantics

- Unqualified names resolve as function locals, then the defining timeline, then `_global`.
- Assigning an unknown name creates a timeline variable. Top-level `var`s and functions become timeline properties, and functions are hoisted.
- A `var x` local does not exist until its declaration runs, so `var x = f(x)` reads the outer `x`.
- Reading a property of `undefined` is silent, as in AVM1.
- `for..in` iterates newest-first.
- `onClipEvent` and `on()` handlers are supported. Frame actions of attached or duplicated clips run through the AS2 action queue.

Fix behaviour in the runtime or the compiler, not in the generated code.

## Known differences from the original

- No sound yet.
- The Bridge level's background is flat placeholder art in the v14 SWF itself.

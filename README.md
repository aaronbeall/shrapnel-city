# Shrapnel City (browser port)

A faithful HTML5 canvas port of the Flash AS2 game *Shrapnel City* (v14). The original
ActionScript runs unchanged: it is compiled to JavaScript and executed on a small
Flash-like runtime, so the hand-crafted pixel collision, line of sight, timeline state
and blend-mode lighting behave as they did in Flash Player.

## Play

Online: https://aaronbeall.github.io/shrapnel-city/. Every push to `main` is built and deployed by GitHub Actions (`.github/workflows/pages.yml`); pull requests are built too, so a broken change fails before it's merged.

## Run locally

Build once, then serve the folder and open it:

```sh
npm install
npm run build        # source/ -> assets/, as2/ -> src/generated/scripts.js
npm run serve        # python3 -m http.server 8123
# open http://localhost:8123/
```

Controls: arrows to maneuver, Z/X strafe, Space primary, Ctrl secondary,
Ins / Shift+Ins and Del / Shift+Del to switch weapons, Esc menu, H help.

## Asset explorer

Open `tools/explorer.html` (online: https://aaronbeall.github.io/shrapnel-city/tools/explorer.html) to browse every game asset drawn by the port's own renderer: all 48 weapons with their HUD icon, pickup and projectile (in flight and impact), the 8 enemies with stats read from their frame scripts, boxes, level gear, pickups and keys, the player ship, effects, the four level maps as the game dresses them, and the whole symbol library. Timelines play without running the game's ActionScript. Click any preview to open the inspector: play, step and scrub frames, jump to labels, zoom and pan, see bounds, the children on the current frame and the symbol's scripts. `#tab=enemies&inspect=<char id>` links straight to a symbol.

## Benchmark

Open `index.html?bench` to run seven scripted heavy scenes (Heat Ray, Flamer, cluster bombs, a whole level exploding at once, a Bridge firefight, the Esc menu) with seeded randomness. A table of game-logic (tick) and drawing (render) times per frame is shown when it finishes. `&only=heatray,flamer`, `&quality=low|medium|high`, `&scale=2` and `&stats` (per-layer counts) narrow it down. `node tools/bench.mjs scale=2` runs the same thing headless.

## Editing the game

Art, animation, timelines and the scripts attached to them live in `source/` (see [source/README.md](source/README.md)); game code lives in `as2/`. After changing either:

```sh
npm run build        # source/ -> assets/, then as2/ + scripts -> src/generated/scripts.js
```

The build output (`assets/swf.json`, `assets/symbols.json`, `assets/bitmaps/`, `src/generated/`) is not committed: commit only `source/` and `as2/` changes, and the Pages workflow rebuilds and deploys on push.

## Layout

| Path | What |
| --- | --- |
| `source/` | **The editable source for art and timelines**: the FLA as one readable file per library symbol, plus the main timeline. See [source/README.md](source/README.md) |
| `as2/` | ActionScript 2 sources. `as2/*.as` are the original files; `as2/frames/` and `as2/shots/` hold the larger frame scripts and the 66 projectile templates moved out of the FLA, `#include`d from `source/` |
| `assets/swf.json`, `assets/symbols.json`, `assets/bitmaps/` | What the runtime loads. Build output of `npm run build:assets`; not committed |
| `original/` | The untouched v14 `shrapnel.fla` and `shrapnel.swf` (July 2012) that `source/` was converted from |
| `src/generated/scripts.js` | Compiled game scripts. Build output of `npm run build:scripts`; not committed |
| `tools/flash-source/` | `build.mjs` turns `source/` into `assets/`; `export.mjs` did the one-time conversion |
| `.github/workflows/pages.yml` | Builds on every push and pull request, and deploys `main` to GitHub Pages |
| `src/flash/` | Runtime: display list and timeline, renderer (blend modes, glow/blur filters, masks), AS2 environment and builtins, BitmapData |
| `tools/swf2json.py` | SWF parser used for the original extraction from `original/shrapnel.swf` |
| `tools/xflmap.py` | Mapped the FLA's library names and scripts onto the SWF for the original extraction |
| `tools/as2js.mjs` | AS2 to JS compiler (acorn + astring) that keeps AVM1 scoping rules |
| `tools/explorer.html` | Asset explorer: weapons, enemies, objects, items, player, effects, level maps and the full library, animated by the runtime, with a frame-by-frame inspector |
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

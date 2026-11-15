# Shrapnel City (browser port)

A faithful HTML5 canvas port of the Flash AS2 game *Shrapnel City* (v14). The original
ActionScript runs unchanged: it is compiled to JavaScript and executed on a small
Flash-like runtime, so the hand-crafted pixel collision, line of sight, timeline state
and blend-mode lighting behave as they did in Flash Player.

The game was built between 2004 and 2012 and never finished. [HISTORY.md](HISTORY.md) has the full timeline, the evidence behind it and an estimate of the hours that went into it.

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

Open `tools/explorer.html` (online: https://aaronbeall.github.io/shrapnel-city/tools/explorer.html) to browse every game asset drawn by the port's own renderer. It opens on **Files**, which mirrors the source folders: `source/library/`, `levels/` and the art bake's parts in `tools/art/parts/` (textures, decor sheets and sprites, and their prompts) as a tree, each folder shown as a grid of its files, every `.json` drawn as the symbol or shape it builds (each level file drawn on its own: files the build places straight onto screen_mc, like `doors.json` or `briefing.json`, get a clip of just their contents; PNGs as images). A symbol's own pieces (`shape 1.json`…) live in a folder named after it, linked from its card. Every file shows its kind (movie clip, graphic, shape, shape tween, bitmap, level layer…) with its own icon; the **?** button explains each one. Typing in the filter searches every file path at once and lays the matches out as a contact sheet (400 at a time, "Show all" for the rest). The frame box holds every preview on one frame (a number, `mid` or `last`) and the size menu sets the cell size. The build writes the file list to `assets/files.json`. The other tabs are curated views: all 48 weapons with their HUD icon, pickup and projectile (in flight and impact), the 8 enemies with stats read from their frame scripts (plus the 3 unused enemies recovered from the FLA and the new vector enemy designs), boxes, level gear, pickups and keys, the player ship, effects, and the level maps as the game dresses them (with collision map and vision zone toggles, and links to each level's files and the level editor). Timelines play without running the game's ActionScript. Click any preview to open the inspector: play, step and scrub frames, jump to labels, zoom and pan, see bounds, the children on the current frame, the symbol's scripts and its source file (with its JSON, a link to its folder and to GitHub). `#tab=enemies&inspect=<char id>` links straight to a symbol, `#tab=files&dir=<folder>` to a folder, and `#tab=files&q=<text>&frame=<n>&size=m` or `#tab=files&ids=<id>,<id>` to a contact sheet.

## Benchmark

Open `index.html?bench` to run seven scripted heavy scenes (Heat Ray, Flamer, cluster bombs, a whole level exploding at once, a Bridge firefight, the Esc menu) with seeded randomness. A table of game-logic (tick) and drawing (render) times per frame is shown when it finishes. `&only=heatray,flamer`, `&quality=low|medium|high`, `&scale=2` and `&stats` (per-layer counts) narrow it down. `node tools/bench.mjs scale=2` runs the same thing headless.

## Editing the game

Art, animation, timelines and the scripts attached to them live in `source/` (see [source/README.md](source/README.md)); each level's collision map, art and placements live in `levels/` (see [levels/README.md](levels/README.md)); game code lives in `as2/`. After changing any of them:

```sh
npm run build        # source/ + levels/ -> assets/, then as2/ + scripts -> src/generated/scripts.js
```

Levels have an in-game editor: press backtick (`` ` ``) or open `?edit`. Run `npm run edit` to serve the game with saving into `levels/` (see [levels/README.md](levels/README.md#level-editor)).

The build output (`assets/swf.json`, `assets/symbols.json`, `assets/bitmaps/`, `src/generated/`) is not committed: commit only `source/`, `levels/` and `as2/` changes, and the Pages workflow rebuilds and deploys on push.

## Layout

| Path | What |
| --- | --- |
| `source/` | **The editable source for art and timelines**: the FLA as one readable file per library symbol, plus the main timeline. See [source/README.md](source/README.md) |
| `levels/` | **One folder per level**: collision map, background art, briefing, and the placement lists for boxes, pickups, enemies, doors and other features. See [levels/README.md](levels/README.md) |
| `as2/` | ActionScript 2 sources. `as2/*.as` are the original files; `as2/frames/` and `as2/shots/` hold the larger frame scripts and the 66 projectile templates moved out of the FLA, `#include`d from `source/` |
| `assets/swf.json`, `assets/symbols.json`, `assets/bitmaps/` | What the runtime loads. Build output of `npm run build:assets`; not committed |
| `original/` | The untouched v14 `shrapnel.fla` and `shrapnel.swf` (July 2012) that `source/` was converted from |
| `src/generated/scripts.js` | Compiled game scripts. Build output of `npm run build:scripts`; not committed |
| `tools/flash-source/` | `build.mjs` turns `source/` and `levels/` into `assets/`; `export.mjs` did the one-time conversion |
| `tools/levels/` | `levels.mjs` reads the level folders and `compile.mjs` turns them into library symbols and `screen_mc` frames (shared with the editor); `serve.mjs` is `npm run edit` |
| `src/editor/` | The in-game level editor |
| `.github/workflows/pages.yml` | Builds on every push and pull request, and deploys `main` to GitHub Pages |
| `src/flash/` | Runtime: display list and timeline, renderer (blend modes, glow/blur filters, masks), AS2 environment and builtins, BitmapData |
| `tools/swf2json.py` | SWF parser used for the original extraction from `original/shrapnel.swf` |
| `tools/xflmap.py` | Mapped the FLA's library names and scripts onto the SWF for the original extraction |
| `tools/as2js.mjs` | AS2 to JS compiler (acorn + astring) that keeps AVM1 scoping rules |
| `tools/explorer.html` | Asset explorer: every source file by folder, plus weapons, enemies, objects, items, player, effects and level maps, animated by the runtime, with a frame-by-frame inspector |

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

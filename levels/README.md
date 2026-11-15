# Levels

Each level is a folder of plain data files. `npm run build` compiles them into the game: the collision map becomes `level_mc`, the art becomes `background_mc`, each placement list becomes a clip on `screen_mc`, and every level gets a briefing frame and a game frame on `screen_mc`. `tools/levels/levels.mjs` does this, called from `tools/flash-source/build.mjs`.

The folder is named like the level's entry in the `levels` array in `as2/functionsLevel.as` (for example `03_Bridge`), and folders are numbered from `00` without gaps. To add a level, add its folder and make sure its entry in that array isn't commented out.

| File | What |
| --- | --- |
| `level.json` | Level settings. All optional: `"fadeIn": false` skips the fade-in when the level starts (the original Bridge has none) |
| `collision.png` | The collision map, pixel for pixel what the game hit-tests: black is wall, `#999999` is impassable but can be shot over (chasms), white is open floor. Its size is the level's size |
| `background.png` | The level art, the same size as the collision map |
| `briefing.json` | The briefing screen, as `{"changes": [...]}` in the timeline format of [source/README.md](../source/README.md) |
| `boxes.json` | Boxes, placed inside `boxes_mc` |
| `powerups.json` | Pickups and message beacons, placed inside `powerups_mc` |
| `enemies.json` | Enemies, placed inside `enemies_mc` |
| `doors.json` | Doors and gates, placed on `screen_mc` under the level |
| `features.json` | Everything else on `screen_mc`: `vision_mc`, `entrance_mc`, `exit_mc`, path nodes |
| `decor.json` | Decor placements for the art bake. The game doesn't read it |

A missing placement file means an empty list.

## Placements

Every placement file is a list of instances, drawn in list order (later ones on top):

```json
[
  {"symbol": "game objects/box", "x": 722, "y": 62},
  {"symbol": "enemy assets/enemy wolfgun", "x": 246.95, "y": 475.75, "props": {"health": 200, "powerupDrop": {"type": "primary", "item": "Plasma", "quantity": 10}}},
  {"symbol": "game objects/door", "x": 1009.9, "y": 50.4, "props": {"id": "door2"}}
]
```

- `symbol` is a library name from `source/library`.
- `x`, `y`, `scale`, `matrix` (for rotation), `name`, `color`, `filters` and `blend` work as in the timeline format.
- `props` are the instance's variables, set when it loads (they become its `onClipEvent (load)` script). Values are numbers, strings, `true`/`false`, lists and objects, and `{"$ref": "a2"}` for the sibling clip named `a2` (path nodes list their linked nodes this way: `"connections": [{"$ref": "a2"}, {"$ref": "a4"}]`).
- `script` is used instead of `props` when the load code is more than plain variables, such as a door trigger's `onPickup` function. It's kept as written.

## Levels 00 to 03

These came out of the original `screen_mc` and `level assets/*` symbols unchanged. Their collision maps and backgrounds are the bitmaps the original game used (the Bridge's collision map was rendered from its vector shape exactly as the game rasterised it). `tools/art/assemble_bridge.py` reads `03_Bridge/collision.png` and writes `03_Bridge/background.png`.

## Level editor

Press backtick (`` ` ``) in the game, or open the page with `?edit` (`?edit=3` for the Bridge). The game pauses and the editor shows the level as it starts, drawn by the game itself, with a panel on the right. Backtick again (or **Play**) goes back to the game, restarted from the edited level.

- **Layers:** number keys 1 to 9 show and hide background art, collision, vision zones, enemies, boxes, pickups, doors, entrance/exit/player and path nodes. Tab picks the layer that Select and Place work on.
- **Select (V):** click to select, drag to move (Shift snaps to the grid), R rotates by 15°, Delete removes, Ctrl+D duplicates. The panel edits position, rotation, scale, name and the load variables (`props`) as JSON. Instances with a load `script` show it read-only.
- **Place (P):** pick a symbol from the palette (everything already used in a level for that layer, plus the recovered enemies), then click. New instances copy the variables of an existing one of the same symbol; doors get the next free `id`.
- **Path links (N):** click a path node, then another, to link or unlink them.
- **Collision:** Rectangle (B) snaps to the grid (Alt for free); Polygon (G) snaps each side to an angle step (Shift for free) and closes on the first corner or Enter; Pencil (D) and Eraser (E) paint single pixels or bigger brushes (`[` `]`); Fill (F) flood-fills. W, C and O pick wall, chasm or open floor. Everything is drawn aliased in exactly the three collision colours. Scroll to zoom (pixel grid from 1200%), drag with Space, the right or the middle button to pan, 0 to fit.
- **Undo/redo:** Ctrl+Z, Ctrl+Shift+Z.
- **Balance:** enemy, box and pickup counts, health on the map and ammo per weapon, counting box and enemy drops at their probability.

**Saving.** Run `npm run edit` and open http://localhost:8123/?edit: Save (Ctrl+S) writes only the changed files into `levels/<NN_name>/` and rebuilds. Anywhere else (for example the GitHub Pages site) Save downloads the changed files instead. After changing the collision map, re-bake the background art, which the editor reminds you about.

The editor recompiles levels in the browser with the same code as the build (`tools/levels/compile.mjs`). Load variables apply directly; instance scripts reuse the build's compiled code, so a changed `script` needs `npm run build`.

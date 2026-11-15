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
- `props` are the instance's variables, set when it loads (they become its `onClipEvent (load)` script). Values are numbers, strings, `true`/`false`, lists and objects.
- `script` is used instead of `props` when the load code is more than plain variables, such as a door trigger's `onPickup` function or a path node's `connections`. It's kept as written.

## Levels 00 to 03

These came out of the original `screen_mc` and `level assets/*` symbols unchanged. Their collision maps and backgrounds are the bitmaps the original game used (the Bridge's collision map was rendered from its vector shape exactly as the game rasterised it). `tools/art/assemble_bridge.py` reads `03_Bridge/collision.png` and writes `03_Bridge/background.png`.

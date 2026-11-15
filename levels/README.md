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
| `features.json` | Everything else on `screen_mc`: `entrance_mc`, `exit_mc` |
| `paths.json` | Path nodes, placed on `screen_mc` right after the features |
| `vision.json` | Vision zones, the clips inside `vision_mc`, which the build places on `screen_mc` (see below) |
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
- `{"$trigger": "door2:open"}` (or a list of names) is a function that sends those triggers, for a pickup's `onPickup` or a box's or enemy's `onDie`: `"props": {"onPickup": {"$trigger": "door2:open"}}`.
- `script` is used instead of `props` when the load code is more than plain variables, such as the Bridge's battery computers, whose `onDie` also throws shrapnel. It's kept as written.

## Triggers

Triggers are names sent with `trigger("name")` to every clip that registered for them. A door with `"id": "door2"` listens for `door2:open` and `door2:close`. An area that sends a trigger when the player walks into it is a trigger pad: an invisible pickup with `"type": "trigger", "item": "door2:open"`, sized with `scale`. Boxes and enemies send one when destroyed with an `onDie` `$trigger` handler as above. A load script can also call `trigger()`.

## Path nodes

A node with no `connections` links itself, when the level starts, to every other node of the same colour that it has line of sight to (`as2/pathNode.as`). The colour (`color.add`) is the node's path group, and an enemy follows the group of the node nearest to it unless it sets `pathID`. To pin a node's links by hand, give it `"connections": [{"$ref": "a2"}, ...]` naming other nodes.

## Vision zones

An enemy attacks when it and the player are in the same zone and it can see the player. An enemy that isn't in any zone, or has `autoVision`, makes its own zone from 90 rays when the level starts, so a level works without any zones. Each zone in `vision.json` is `{x, y, scale|matrix, color, d}` with `d` a path (`M`, `L`, `Q`, `Z`, absolute) in the zone's own coordinates, or `{x, y, color, points: [[x, y], ...]}` for a plain polygon. The colour only tells zones apart in the editor.

## Levels 00 to 03

These came out of the original `screen_mc` and `level assets/*` symbols unchanged. Their collision maps and backgrounds are the bitmaps the original game used (the Bridge's collision map was rendered from its vector shape exactly as the game rasterised it). `tools/art/assemble_bridge.py` reads `03_Bridge/collision.png` and writes `03_Bridge/background.png`.

## Level editor

Press backtick (`` ` ``) in the game, or open the page with `?edit` (`?edit=3` for the Bridge). The game pauses and the editor shows the level as it starts, drawn by the game itself, with a panel on the right. Backtick again (or **Play**) goes back to the game, restarted from the edited level.

- **Layers:** number keys 1 to 9 show and hide background art, collision, vision zones, enemies, boxes, pickups, doors, entrance/exit/player and path nodes. Tab (or clicking a layer's name) picks the layer that the tools work on.
- **Art preview (A):** fills the collision map with the Bridge kit's floor, wall and chasm textures (`tools/art/parts`), with rough wall sides, bevels and chasm lips, and redraws it as you edit collision. It's a guide, not the bake.
- **Select (V):** click to select, drag to move (Shift snaps to the grid), R rotates by 15°, Delete removes, Ctrl+D duplicates. The panel edits position, rotation, scale, name and the load variables (`props`) as JSON. Instances with a load `script` show it read-only.
- **Place (P):** pick a symbol from the palette (everything already used in a level for that layer, plus the recovered enemies, plus a ready-made trigger pad), then click. New instances copy the variables of an existing one of the same symbol; doors get the next free `id`.
- **Hidden things:** anything the game doesn't show (trigger pads, alpha-0 areas like Training's `triggerNewWep_mc`, enemies hidden at the start) is outlined and named when its layer is on, so it can be seen and selected.
- **Triggers (T):** an overlay, independent of the layers: every sender is labelled on the map with what it sends, and dashed lines show which door each one opens (green) or closes (red). The **Triggers** list in the panel shows every door and sender in the level; click one to select it. A selected pickup, box or enemy has a field for the triggers it sends when picked up, destroyed or killed, and a trigger pad for the one it sends; both suggest the level's door triggers.
- **Path nodes:** their own layer (Tab or click "Path nodes"). A new node joins the selected node's path group (or the level's first) and links itself by line of sight; these links show dashed, computed the same way as the game. A selected node's panel sets the group colour and lists its links, each with an **unlink** button. **Path links (N):** click a node, then another, to add the link (or remove it if they were linked). A node whose links you change keeps them pinned (solid); **Back to automatic** in the panel unpins them.
- **Vision zones:** pick the Vision layer (Tab). Select moves, rotates and deletes zones and drags a polygon zone's corners; zones with curves get an **Edit corners** button that turns them into a polygon. Polygon (G) draws a zone, and Auto zone (Z) makes one from the spot you click, with the same rays the game uses.
- **Collision:** Rectangle (B) snaps to the grid (Alt for free); Polygon (G) snaps each side to an angle step (Shift for free) and closes on the first corner or Enter; Pencil (D) and Eraser (E) paint single pixels or bigger brushes (`[` `]`); Fill (F) flood-fills. W, C and O pick wall, chasm or open floor. Everything is drawn aliased in exactly the three collision colours. Scroll to zoom (pixel grid from 1200%), drag with Space, the right or the middle button to pan, 0 to fit.
- **Undo/redo:** Ctrl+Z, Ctrl+Shift+Z.
- **Balance:** enemy, box and pickup counts, health on the map and ammo per weapon, counting box and enemy drops at their probability.

**Saving.** Run `npm run edit` and open http://localhost:8123/?edit: Save (Ctrl+S) writes only the changed files into `levels/<NN_name>/` and rebuilds. Anywhere else (for example the GitHub Pages site) Save downloads the changed files instead. After changing the collision map, re-bake the background art, which the editor reminds you about.

The editor recompiles levels in the browser with the same code as the build (`tools/levels/compile.mjs`). Load variables apply directly; instance scripts reuse the build's compiled code, so a changed `script` needs `npm run build`.

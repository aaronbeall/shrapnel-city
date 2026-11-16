# Readable Flash source

This folder is the editable source for the game's art, animation and timelines: everything that used to live only in `shrapnel.fla`. It's a straight transpilation of the v14 FLA and SWF: one file per library symbol, under the symbol's FLA library name, with nothing reinterpreted.

`npm run build:assets` turns it into what the runtime loads (`assets/swf.json`, `assets/symbols.json`, `assets/bitmaps/`), and `npm run build` also recompiles the ActionScript. That output isn't committed; GitHub Actions builds it on every push. `node tools/flash-source/build.mjs --check` compares the source with an existing build in `assets/` without writing anything.

## Layout

| Path | What |
| --- | --- |
| `movie.json` | Stage size, frame rate, background colour and the main timeline |
| `library/<FLA library path>.json` | One library symbol, e.g. `library/enemy assets/enemy stinger.json` |
| `library/<symbol>/shape 1.json`, `shape tween 1.json`, `text 1.json`, `bitmap 1.png` … | Shapes, shape tweens, static text and bitmaps that only exist inside that symbol (in the FLA these sit directly on its timeline) |
| `library/_shared/…` | Unnamed pieces used by more than one symbol |
| `library/fonts/…` | Embedded fonts |
| `library/_main timeline/…` | Pieces drawn directly on the main timeline |
| `ids.json` | The character id of every symbol. The compiled scripts refer to these, so existing ids never change; a new file gets the next free id automatically |

The levels aren't here: `screen_mc.json` holds only the clips that stay on screen for the whole game (the player, the projectile templates and so on) and has `"levels": "levels/"`, and the build adds each level's briefing and game frames and its `level assets/level<N>`, `background<N>`, `boxes<N>`, `powerups<N>` and `enemies<N>` symbols from [levels/](../levels/README.md).

Symbols refer to each other by these names. Characters that aren't portable in file names are written as `%XX`, e.g. `btn %3C%3F%3E.json` is the button `btn <?>`.

## Symbol files

Every file has a `kind`. Library symbols also have a `symbol` block with the FLA symbol type and linkage id:

```json
{
  "kind": "sprite",
  "symbol": {"type": "movie clip", "linkage": "helpScreen"},
  "frames": 30,
  "timeline": [ … ]
}
```

### Timelines (`sprite`, and `movie.json`)

`frames` is the frame count. `timeline` lists only the frames where something happens, numbered from 1 like the Flash timeline:

```json
{
  "frame": 1,
  "label": "idle",
  "script": "stop();",
  "changes": [
    {"place": "enemy assets/enemy stinger core - circle", "depth": 1, "x": 0, "y": 0, "name": "core_mc"},
    {"update": 5, "x": 10, "y": 4, "color": {"alpha": 0.5}},
    {"remove": 2}
  ]
}
```

These are the four kinds of change, applied in order:

- `place` puts a symbol on a depth.
- `replace` swaps the symbol on a depth but keeps the instance.
- `update` changes an existing instance. A motion tween is a run of `update`s, one per frame.
- `remove` clears a depth.

Instance properties:

| Property | What |
| --- | --- |
| `x`, `y` | Position. |
| `scale` | A number, or `[scaleX, scaleY]`. |
| `matrix` | `[a, b, c, d]`, used instead of `scale` when the instance is rotated or skewed. |
| `name` | The instance name. |
| `color` | `{"alpha": 0.5}`, or `{"multiply": [r, g, b, a], "add": [r, g, b, a]}`. |
| `filters` | Glow, blur, drop shadow and bevel, with colours as hex. |
| `blend` | The blend mode. |
| `clipDepth` | Makes the instance a mask for the depths up to that number. |
| `ratio` | The position within a shape tween, from 0 to 1. |
| `script` | The instance's `onClipEvent`/`on()` code. |

`script` (frame actions and instance scripts) is a single string, or an array of lines for longer code. Indentation is shown as 4 spaces per tab. Big scripts are kept in `as2/` and pulled in with `#include`, exactly as the original FLA did with `as/object/*.as`. For example, every projectile template on `screen_mc` is `#include "as/shots/shot_mcPlasma.as"` and so on, and those files hold that weapon's tuning and behaviour.

### Shapes (`shape`, `shape tween`)

- **`fills`:** `{"type": "solid", "color": "#ff9900"}`, `linear gradient` / `radial gradient` / `focal gradient` with a matrix `m` and `stops` of `[ratio, "#rrggbbaa"]`, or a bitmap fill naming a bitmap file. `null` is Flash's empty bitmap.
- **`lines`:** stroke styles (`width`, `color`, caps and joins).
- **`paths`:** each one names the fill and/or line it uses (an index into the lists above), plus SVG-style path data `d` (`M`, `L`, `Q`, `Z`; coordinates in pixels).
- **Shape tweens:** these add `fills`/`lines` `…1` fields and `d1` for the end shape.

### Other kinds

- `static text`: text records naming a font, with glyph indices and advances.
- `text field`: a dynamic or input text field.
- `button`: its state records (`up`, `over`, `down`, `hit`).
- `font`: glyph outlines as path strings.
- **Bitmaps:** plain PNG files.

## Adding things

- **A new symbol:** add a JSON file under `library/` and `place` it by name, or give it `"symbol": {"type": "movie clip", "linkage": "myThing"}` and `attachMovie("myThing", …)` it from code.
- **A new frame script or instance script:** add it in the timeline, or as an `.as` file in `as2/` that the script `#include`s.
- **After any edit:** run `npm run build`.

## Symbols recovered from the FLA

Most of `source/` came from the compiled SWF. Three enemies were finished in the FLA but only placed on guide layers, so the SWF never contained them: the **enemy tank**, **enemy drone** and **enemy missile launcher**. They were converted straight from the FLA, with all their parts, by `tools/flash-source/fla2source.py`. Deprecated and obsolete library items (old exits, the old HUD, unused bitmaps and so on) were deliberately left out.

Two things to know when reading these files:

- Flash flattens **graphic** symbol instances into the timeline that uses them, so the SWF never had a standalone copy of a graphic symbol. The converter does the same. A recovered symbol that uses a graphic symbol therefore has that graphic's pieces placed directly on its own timeline.
- The same flattening means some names that came from the SWF point at only the first piece of a flattened graphic. For example, `graphic assets/explosion` is really just the explosion's shockwave ring.

To convert another symbol: `python3 tools/flash-source/fla2source.py <unzipped FLA folder> --only "<library name>" ...` (list every part the symbol uses). It only adds files and never overwrites an existing one. `--calibrate <symbol>` converts a symbol that already exists into a scratch folder, so you can compare it with the SWF version.

## Generated art

- `levels/03_Bridge/background.png` (the Bridge floor and walls) replaces the original placeholder art. `tools/art/bake.py` builds it from parts in `tools/art/parts/` (wall-top, floor and chasm textures generated with OpenAI `gpt-image-2`, using only backgrounds 0-2 as style references; prompts are next to each part). Decor (vents, greebles, lights, floor paint, wall markings, railings and pipes) comes from AI-generated sprite sheets: `tools/art/gen_decor.sh` makes the sheets (prompts in `tools/art/parts/decor/`), `tools/art/cut_decor.py` cuts them into sprites, and `bake.py place` places them, each fitted inside its wall or floor area and not overlapping, writing the placements to `levels/03_Bridge/decor.json` (hand-editable in the level editor). The parts are laid onto the Bridge's collision map, `levels/03_Bridge/collision.png`, so the art lines up with `level_mc` exactly. Re-run it (`python tools/art/bake.py 03_Bridge bake`, needs numpy, scipy and Pillow), or use the editor's Art pipeline buttons, after changing the level or a part.

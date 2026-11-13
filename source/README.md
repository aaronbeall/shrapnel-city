# Readable Flash source

This folder is the editable source for the game's art, animation and timelines: everything that used to live only in `shrapnel.fla`. It's a straight transpilation of the v14 FLA and SWF: one file per library symbol, under the symbol's FLA library name, with nothing reinterpreted.

`npm run build:assets` turns it into what the runtime loads (`assets/swf.json`, `assets/symbols.json`, `assets/bitmaps/`). `npm run build` also recompiles the ActionScript. `node tools/flash-source/build.mjs --check` confirms the source rebuilds to exactly the current assets.

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

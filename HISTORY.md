# History

*Shrapnel City* was made in Flash by one person over eight years, from August 2004 to August 2012. It was never finished. This page records how it was built, based on the files that survived. The last chapter is left open for the 2026 browser port and the push to finish the game.

## Where the dates come from

The original project lives in a Google Drive folder with one subfolder per version (`v1-9`, `v10` to `v14`, `v15-as3`), plus `assets/` and three notes files. The Drive folders show the December 2023 upload date, but the **files** still carry their original save dates. Those dates are the evidence used here.

- About 560 dated files survive. They fall on **70 different days**.
- Each file only records the **last** day it was saved, so 70 days is a minimum. Short visits, and files that were later overwritten, leave no trace.
- Dates are UTC and were shifted a few hours to group late-night saves with the evening they belong to. The original time zone isn't recorded.
- `shrapnel1.swf` is dated December 2010. It was re-exported later; its FLA is from August 2004.

## Timeline

### 2004: the prototype (v1 to v5)

- **Aug 11 to Sep 1, 2004.** Five versions in three weeks (`shrapnel1.fla` to `shrapnel5.fla`). v1 was already 1.4 MB on its first save, so some work came before it.
- **Oct 12, 2004.** 3D-rendered player ship sprites (`ship.png`, `ship50.png`, `ship38x37_shadow.png` and others).

### 2005: a summer pass (v6 and v7)

- **Jul 23, 2005** (v6) and **Aug 4, 2005** (v7). v6 and v7 already had cheat keys (Home for god mode and infinite ammo).
- Then nothing for almost three years.

### 2008: the revival (v8 to v12)

The busiest stretch of the project, with 15 saved days in August alone.

- **Jul 3 to 4, 2008.** v7 is re-saved and v8 is built.
- **Jul 30 to Aug 8, 2008.** Title screen. Levels 0 to 2 are painted in Fireworks, each with a separate walls image for collision. Doodads, blasts and smoke art are added.
- **Aug 5, 2008: v10.** Code moves out of the FLA into `#include`d `.as` files: `player.as`, `core.as`, `functionsGame.as`, projectiles, boxes, turrets and others.
- **Aug 10, 2008: v11.** Notifications, messages, smoke and enemy objects. The SWF grows from 0.3 MB to 1 MB.
- **Aug 15 to 20, 2008: v12.** Doors, level switches, enemy seeker missiles and the Bridge level (`level3.fw.png`, Aug 18). Two experimental builds test enemy vision: `shrapnel12-autoVision.swf` and `shrapnel12-visionMap.swf`.

### 2009 and 2010: tinkering (v12)

- **Jun 7 and Dec 18, 2009.** Small edits to helpers, the exit and powerups.
- **Apr 4 to May 6, 2010.** Rework of enemy turrets, projectiles, the player and the game and level functions.
- **Apr 30, 2010.** 256 rendered ship rotation frames (`rotation sprites/`).
- **Aug 27, 2010.** New v12 SWF build.
- **Dec 24 to 31, 2010.** Last v12 FLA, then a new weapons art sheet (`weps.fw.png`).

### Winter 2010 to 2011: the UI overhaul (v13)

- **Dec 27, 2010 to Feb 6, 2011.** About 10 saved days in January. The screens and menus are redesigned: briefing, dialog, HUD, logo, scanlines, buttons, tooltips, messages and inventory items (`hud.fw.png`, `briefing.fw.png`, `dialog.fw.png`, `logo.png`).
- New level mechanics: doors and level gates (Jan 17), and pathfinding nodes for hunter enemies (`pathNode.as`, Feb 6).
- The project moves to Flash CS5 (`shrapnel - CS5.fla`, Feb 6, 2011).
- Reference photos of debris, wrecked tanks and sci-fi interfaces are collected in January 2011.

### Summer 2011: v13 final

- **Jul 28 to Aug 10, 2011.** Keycard inventory, the doors art sheet, the enemy art sheet (`enemies.fw.png`), the reactor box, the enemy tank (`enemyVehicle.as`), particles, smoke columns and the mission select panel.
- **Aug 10, 2011.** New title screen (`titlescreen.fw.png`, 10 MB) and the final v13 FLA and SWF (2 MB).
- **Sep 6, 2011.** "History" screenshots of the game's progress.

### Late 2011 to mid 2012: v14

- **Aug 2011.** The code moves into `as/object`, `as/level` and `as/ui` folders, the layout this repo's `as2/` folder comes from.
- **Dec 31, 2011 to Jan 1, 2012.** Bomb and reactor changes, plus a time-scale experiment in `assets/tests/`.
- **Feb 24, 2012.** Changes to enemy turrets, enemy objects and projectiles.
- **Jul 18 to 20, 2012.** A FlashDevelop project, a Windows EXE build and the **final v14 FLA and SWF** (Jul 20). This is the version the browser port runs.
- **Aug 3, 2012.** Last save of the design notes, `shrapnel.rtf`.

### Summer 2012: the AS3 rewrite (v15)

- **Jul 18 to Aug 7, 2012.** The game is rewritten in ActionScript 3 as classes: `Game`, `SystemManager`, `LevelManager`, `Player`, base shot, projectile and enemy classes, about 20 player shot classes, dialogs and a HUD. `shrapnel-as3.rtf` lists the conversion plan step by step.
- **Aug 7, 2012.** Last save of `Shrapnel.fla` in `v15-as3`. This is the **last activity anywhere in the original project**.

## How big it got

- **Final v14 game:** about 5,500 lines of ActionScript 2 (about 4,200 in the `.as` files, plus about 1,250 in instance scripts on the stage). It has 66 projectile templates and roughly 1,000 library symbols. There are 4 playable levels with layered Fireworks art (Training, Drop Zone, First Block and Bridge), plus a title screen, briefings, menus and a HUD.
- **AS3 rewrite:** about the same amount of code again, written in three weeks.
- **Design notes** (`shrapnel.rtf`, 33 KB): 23 planned levels, from Training to Terminate. About 30 weapons, 40 bombs and 20 powerups. Enemy behaviours (chaser, patroller, wanderer, hunter-killer, flyer), cheat codes, a bug list and an optimisation backlog. `sounds.rtf` lists 25 sound effects that were planned but never added.

## How much time went into it

The hours below are an **estimate**: no file records time spent. Two independent methods give the same range.

1. **Counting sessions.** 70 dated days is the minimum. Busy months like August 2008 were probably close to daily, so the real number of work days is likely two to three times that. At 3 to 4 hours a session, that comes to roughly 500 to 800 hours.
2. **Counting output.** About 10,000 lines of game code across the AS2 and AS3 versions, earlier versions that were thrown away, 4 painted levels, the menus and HUD art, and the rendered sprites.

| Phase | Dates | Estimated hours |
|---|---|---|
| Prototype, v1 to v5 | Aug to Oct 2004 | 30 to 70 |
| v6 and v7 | Jul to Aug 2005 | 15 to 40 |
| Revival, v8 to v12 | Jul to Aug 2008 | 120 to 220 |
| Tinkering, v12 | 2009 to 2010 | 30 to 70 |
| UI overhaul, v13 | Dec 2010 to Feb 2011 | 80 to 160 |
| v13 final | Jul to Sep 2011 | 50 to 100 |
| v14 | Dec 2011 to Jul 2012 | 25 to 55 |
| AS3 rewrite, v15 | Jul to Aug 2012 | 60 to 120 |
| **Total** | **2004 to 2012** | **about 400 to 850, best guess about 600** |

## 2026: the browser port, and finishing the game

*This chapter is still being written.*

- **Nov 12, 2026.** The port starts. The v14 SWF is extracted to JSON and PNGs, the original ActionScript 2 is compiled to JavaScript unchanged, and it runs on a small Flash-like canvas runtime.
- **Nov 13 to 14, 2026.** All four levels play in the browser. The FLA is converted into editable source in `source/`. Unused enemies (a tank, a drone and a missile launcher) are recovered from the FLA, and the unused enemy designs in `enemies.fw.png` are converted to vector symbols.
- **Next:** build out the remaining 19 levels from the 2012 plan, Urban through Terminate.

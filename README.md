# Gravity Guy — AthenaENV / PS2

A PlayStation 2 port of Gravity Guy written in JavaScript on top of [AthenaENV](https://github.com/DanielSant0s/AthenaEnv). `athena.elf` runs the game's JavaScript; it is not a Flash emulator. The simulation, physics and level data were reconstructed from the original Flash game.

## Running

Copy the whole repository to a folder (disc, USB or OPL) and launch `athena.elf`, keeping `athena.ini`, `main.js`, `game`, `tests` and `assets` together. In PCSX2, open `athena.elf` with the game folder as the working directory.

To keep your checkpoint, best score and audio options, use a memory card in slot 1 (data is stored in `mc0:/GRAVITYGUY`). The game also works without a card.

| Action | DualShock 2 |
|---|---|
| Flip gravity | X or R1 |
| Pause / confirm | START |
| Retry checkpoint | SELECT |
| Navigate | D-pad |
| Back | Circle |

Gravity flips when the character touches a surface; a mid-air press is buffered for up to 0.35 s. Running is automatic. Multiplayer supports 2 to 4 players on three tracks; three or four controllers require a multitap, and each player uses X or R1 on their own pad.

## Features

- Scenery is drawn with the native `TileMap` module (VU1): one resident texture atlas per level plus a sprite list, so nothing streams during play (`tools/build_scenery_atlas.py`; the credits still use baked 512 px pages).
- Campaign with five sections, 21 checkpoints, accelerators and a chaser; the "Don't get caught" tutorial is shown on a new game.
- Local multiplayer with player-to-player collision, elimination and a results screen.
- Armor Games opening (swords, logo and fade, 40 fps, not skippable like the original) before the main menu.
- Main menu, continue prompt, pause, credits and ending built from the original bitmaps and coordinates.
- Fixed 40 Hz simulation with interpolated NTSC presentation; pre-composited scenery and indexed textures to cut draw cost and VRAM use.
- Online services and ads from the original were not ported.

## Tests

`tests/checks.js` holds the simulation checks (run with `node` on the desktop or in the PS2's QuickJS). The runtime imports it, so the file is part of the game.

## Credits

Original game: Miniclip; programming by Vasco Freitas. Art, sound and music belong to the original authors and were extracted from the supplied game; this repository does not license them. PS2 port: Gibran Khalil, using AthenaENV. The AthenaENV license is in `LICENSE.Athena.txt`.

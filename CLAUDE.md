# InfiniClick

An **infinite clicker** built on the HTML5 Canvas, inspired by *ZenShards*. Balls
bounce around a grid of destructible blocks; every impact cracks a block, and
every broken block releases **shards** you spend on upgrades. The twist is a
**fractal, infinite zoom**: every board is one block of the board above it, and
every block hides a whole board of its own.

## Game loop

1. One or more balls bounce off the walls and the blocks of the current board.
2. Each bounce (or each click) removes hit points from a block; the damage dealt
   and the remaining HP are shown on the block.
3. A block at 0 HP shatters and pours out shards.
4. When the **whole board** is cleared, the camera **zooms out one notch**: the
   board you just finished was a single block of a larger *meta-board*, and that
   block is now destroyed. A shard bonus is awarded and the balls spill out at
   the destroyed block's location.
5. On the meta-board the balls drift until one **touches another block** (or you
   click one); the camera **zooms into** that block, which contains a fresh board
   to clear. (Clearing every block of a meta-board zooms out again, forever.)
6. Shards buy upgrades that speed up the harvest.
7. Back to step 1, one level deeper or higher.

## Infinity, without an infinite stack

Only **two boards** are ever loaded at once: the one on screen and its immediate
parent. You can only zoom out once the current board is fully cleared, so at any
moment there are just two "notches" in play — never a growing stack. When a whole
meta-board is finished, its grandparent is generated on the spot (a fresh, tougher
board with one block pre-destroyed), so the climb upward is endless but memory is
constant. The meta phase uses the exact same board, blocks, balls and rendering as
the normal phase — it *is* the same game, only zoomed.

## Balls & levels

Balls come in **levels**. A level-N ball deals N times the base damage. Buying the
*Extra Ball* upgrade always adds a **level-1** ball — the only ones you can buy.
Collect ten balls of the same level and **merge** them (button in the ball bar
above the shop) into a single ball of the next level, ZenShards-style. Higher-level
balls are bigger, brighter, and stamped with their level.

## Running the game

No dependencies, no build step. Just open `index.html` in a browser. For a local
server:

```bash
python3 -m http.server 8000
# then http://localhost:8000
```

## Project layout

| File         | Role                                                              |
|--------------|-------------------------------------------------------------------|
| `index.html` | Page structure: stat bar, canvas, shop.                           |
| `style.css`  | Dark "zen" theme, layout and shop styling.                        |
| `game.js`    | All the logic: physics, rendering, economy, upgrades, saving.     |
| `CLAUDE.md`  | This document.                                                    |

## Architecture of `game.js`

The code lives inside an IIFE (no global variables) and is split into sections:

- **`state`** — persisted progress (shards, depth counter, ball counts per level, upgrade levels, multipliers). `DEFAULT_STATE()` is the single source of truth for a fresh game, used both at boot and by the reset button.
- **`runtime`** — ephemeral, unsaved data: the active `board`, its `parent` meta-board, the current `phase`, an in-flight zoom `anim`, plus balls, particles, floating texts and the banner.
- **Grid** (`layoutGrid`, `makeBlock`, `makeBoard`, `pickPortal`, `blockRect`, `cellRectOf`) — lays out blocks responsively and builds whole boards.
- **Boards & phases** (`ensureBoards`, `boardCleared`, `startZoomOut`/`completeZoomOut`, `startZoomIn`/`completeZoomIn`) — the fractal state machine (`play` → `zoomOut` → `hunt` → `zoomIn` → `play`).
- **Balls** (`makeBall`, `syncBalls`, `placeBalls`, `mergeBalls`, `ballDamageOf`) — levelled balls, merging, and repositioning after a zoom.
- **Physics** (`collideBallBlocks`, `blockUnderCircle`) — circle/rectangle collision resolved on the axis of least penetration; the second finds the block a ball enters while hunting.
- **Economy** (`breakBlock`, `damageBlock`) — damage, shard rewards, visual effects.
- **Update** (`update`, `updatePlay`, `updateHunt`, `updateZoom`, `updateEffects`) — one branch per phase.
- **Rendering** (`render`, `drawBoard`, `cellFillRect`, `lerpRect`) — draws a board mapped into any screen rect, so the zoom is just an interpolated camera between "full screen" and "one cell fills the screen".
- **Shop** (`UPGRADES`, `costOf`, `buy`, `renderShop`, `renderBallBar`) — geometric-cost upgrades and the ball banner.
- **Persistence** (`save`, `load`, `resetGame`) — auto-saves to `localStorage` (key `infiniclick.save.v1`); `resetGame` wipes the save *and* every scrap of live state before rebuilding.
- **Loop** (`frame`) — `requestAnimationFrame` with a clamped `dt` to stay stable after a tab switch.

## Upgrades

| Upgrade          | Effect                                    |
|------------------|-------------------------------------------|
| Ball Power       | +1 damage per bounce.                     |
| Sharp Finger     | +1 damage per click.                      |
| Momentum         | +8% ball speed (capped).                  |
| Extra Ball       | Adds a level-1 ball.                       |
| Precious Shards  | +50% shards per block broken.             |

Each purchase raises the upgrade's cost by a `growth` factor, keeping the
exponential progression typical of clickers.

## Quick customization

- **Palette / theme**: CSS variables in `:root` of `style.css`.
- **Block colors**: `BLOCK_COLORS` in `game.js`. **Ball colors**: `BALL_COLORS`.
- **Balance**: `baseCost` / `growth` of `UPGRADES`, block HP in `makeBlock`,
  reward in `breakBlock`, ball damage in `ballDamageOf`, merge cost via `MERGE_REQUIRED`.
- **Grid size**: the `target` constant in `layoutGrid`.
- **Zoom feel**: `ZOOM_DUR` (transition length) and `HUNT_GRACE` (how long balls
  drift on the meta-board before they may dive into a block).

## Conventions

- Vanilla JavaScript (ES2020+), no framework and no build tool.
- A single logic file; keep the sections commented and separated.
- Nothing blocks the thread: everything runs through the `requestAnimationFrame` loop.

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
5. On the meta-board the balls **roam for a couple of seconds** (bouncing off its
   blocks so it feels alive), then the next block one touches — or one you click —
   is the one the camera **zooms into**, revealing a fresh board to clear.
6. Clearing **every** block of a meta-board **ascends** you to the next universe:
   a black "accessing upper universe level N…" interlude, then a fresh board one
   whole rank tougher (10× the HP), with one block pre-destroyed.
7. Shards buy upgrades that speed up the harvest. Back to step 1, deeper or higher.

## Infinity, without an infinite stack

Only **two boards** are ever loaded at once: the one on screen and its immediate
parent. You can only zoom out once the current board is fully cleared, so at any
moment there are just two "notches" in play — never a growing stack. When a whole
meta-board is finished, the next universe is generated on the spot (a fresh, tougher
board with one block pre-destroyed), so the climb upward is endless but memory is
constant. The meta phase uses the exact same board, blocks, balls and rendering as
the normal phase — it *is* the same game, only zoomed.

## Meta ranks, difficulty & big numbers

Difficulty is measured in **meta ranks**. A board of rank *R* has blocks with
**10× the HP** of a board of rank *R−1* (`HP_PER_META`), so every notch up the
fractal is ten times tougher. The `Meta` stat in the HUD is your current universe
(`state.metaLevel`) — the true progression — and it only advances when you finish a
whole meta-board and **ascend** through the "accessing upper universe" interlude.
A sub-board you clear sits at rank `metaLevel − 1`; the meta-board above it is rank
`metaLevel`.

Because HP (and therefore shard rewards) grow 10× per rank, the numbers get large
quickly. They are plain JS **floats** (exact to ~1e15, valid to ~1e308), rendered by
`formatNum` as integers → `K`/`M`/`B` → scientific (`1.23e18`). No BigInt: for a
clicker the lost integer precision past a quadrillion is invisible on screen. See
`docs/idle-game-tuning.md` for the growth math and how to rebalance the ratios.

## Balls & levels

Balls come in **levels**. A level-N ball deals N times the base damage. Buying the
*Extra Ball* upgrade always adds a **level-1** ball — the only ones you can buy —
and you may hold at most **ten** of them (`LEVEL1_CAP`); past that you must merge.
Collect ten balls of the same level and **merge** them (button in the ball banner
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
| `docs/`      | `idle-game-tuning.md`: incremental-game balance theory & knobs.   |
| `CLAUDE.md`  | This document.                                                    |

## Architecture of `game.js`

The code lives inside an IIFE (no global variables) and is split into sections:

- **`state`** — persisted progress (shards, `metaLevel`, ball counts per level, upgrade levels, multipliers). `DEFAULT_STATE()` is the single source of truth for a fresh game, used both at boot and by the reset button.
- **`runtime`** — ephemeral, unsaved data: the active `board`, its `parent` meta-board, the current `phase`, an in-flight zoom `anim`, the ascension `interlude`/`pending`, plus balls, particles, floating texts and the banner.
- **Formatting** (`formatNum`, `paletteFor`) — big-number display and the per-rank colour palette.
- **Grid** (`layoutGrid`, `makeBlock`, `makeBoard`, `pickPortal`, `blockRect`, `cellRectOf`) — lays out blocks responsively and builds whole boards of a given **rank** (HP scales 10× per rank).
- **Boards & phases** (`ensureBoards`, `boardCleared`, `startZoomOut`/`completeZoomOut`, `startZoomIn`/`completeZoomIn`, `startAscension`/`completeAscension`) — the fractal state machine (`play` → `zoomOut` → `hunt` → `zoomIn` → `play`, plus `ascend` between universes).
- **Balls** (`makeBall`, `syncBalls`, `placeBalls`, `mergeBalls`, `ballDamageOf`) — levelled balls, merging, and repositioning after a zoom.
- **Physics** (`ballHitsBlock`) — circle/rectangle collision resolved on the axis of least penetration; reflects the ball and, when asked, chips the block (during a hunt it just reports which block was touched so the game can dive in).
- **Economy** (`breakBlock`, `damageBlock`) — damage, shard rewards, visual effects.
- **Update** (`update`, `updatePlay`, `updateHunt`, `updateZoom`, `updateAscension`, `updateEffects`) — one branch per phase.
- **Rendering** (`render`, `drawBoard`, `drawInterlude`, `cellFillRect`, `lerpRect`) — draws a board mapped into any screen rect (the zoom is just an interpolated camera between "full screen" and "one cell fills the screen"), plus the between-universe interlude.
- **Shop** (`UPGRADES`, `costOf`, `buy`, `renderShop`, `renderBallBar`) — geometric-cost upgrades (Extra Ball priced by current level-1 count) and the ball banner.
- **Persistence** (`save`, `load`, `resetGame`) — auto-saves to `localStorage` (key `infiniclick.save.v2`); `resetGame` wipes the save *and* every scrap of live state before rebuilding.
- **Loop** (`frame`) — `requestAnimationFrame` with a clamped `dt` to stay stable after a tab switch.

## Upgrades

| Upgrade          | Effect                                              |
|------------------|-----------------------------------------------------|
| Ball Power       | +8% ball damage (multiplicative).                   |
| Sharp Finger     | +8% click damage (multiplicative).                  |
| Momentum         | +8% ball speed (capped).                            |
| Extra Ball       | Adds a level-1 ball (max 10, priced by how many you hold). |
| Precious Shards  | +50% shards per block broken.                       |

The damage upgrades are **multiplicative by a few percent** so they can chase the
10×-per-rank HP curve without ever "finishing". Each purchase raises the upgrade's
cost by a `growth` factor. *Extra Ball* is priced by your current level-1 count, so
the cost resets after each merge — keeping the buy-ten-then-merge loop affordable.

## Quick customization

- **Palette / theme**: CSS variables in `:root` of `style.css`.
- **Block colors**: `PALETTES` in `game.js` (one per meta rank, cycling). **Ball
  colors**: `BALL_COLORS`.
- **Balance**: `baseCost` / `growth` of `UPGRADES`, per-rank block HP in `makeBlock`
  and the `HP_PER_META` step, reward in `breakBlock`, ball damage in `ballDamageOf`,
  ball cap via `LEVEL1_CAP`, merge cost via `MERGE_REQUIRED`. See
  `docs/idle-game-tuning.md` for the theory behind these ratios.
- **Grid size**: the `target` constant in `layoutGrid`.
- **Zoom / meta feel**: `ZOOM_DUR` (transition length), `HUNT_GRACE` (how long balls
  roam the meta-board before diving into a block), `ASCEND_DUR` (interlude length).

## Conventions

- Vanilla JavaScript (ES2020+), no framework and no build tool.
- A single logic file; keep the sections commented and separated.
- Nothing blocks the thread: everything runs through the `requestAnimationFrame` loop.

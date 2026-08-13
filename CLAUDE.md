# InfiniClick

An **infinite clicker** built on the HTML5 Canvas, inspired by *ZenShards*. A ball
bounces around a grid of destructible blocks; every impact cracks a block, and
every broken block releases **shards** you spend on upgrades. The grid regenerates
endlessly — the game loop never stops, it only grows.

## Game loop

1. One or more balls bounce off the walls and the blocks.
2. Each bounce (or each click) removes hit points from a block; the damage dealt
   and the remaining HP are shown on the block.
3. A block at 0 HP shatters and pours out shards.
4. When the **whole board** is cleared, a new (tougher) board is generated and a
   shard bonus is awarded.
5. Shards buy upgrades that speed up the harvest.
6. Back to step 1, forever.

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

- **`state`** — persisted progress (shards, current board, ball counts per level, upgrade levels, multipliers).
- **`runtime`** — ephemeral, unsaved data (balls, blocks, particles, floating texts, banner).
- **Grid** (`layoutGrid`, `buildBlocks`, `makeBlock`, `blockRect`) — lays out the blocks and computes their geometry responsively.
- **Balls** (`makeBall`, `syncBalls`, `mergeBalls`, `ballDamageOf`) — levelled balls and merging.
- **Physics** (`collideBallBlocks`) — circle/rectangle collision resolved on the axis of least penetration.
- **Economy** (`breakBlock`, `damageBlock`, `nextBoard`) — damage, shard rewards, advancing to the next board, visual effects.
- **Shop** (`UPGRADES`, `costOf`, `buy`, `renderShop`, `renderBallBar`) — geometric-cost upgrades and the ball bar.
- **Rendering** (`render`) — draws blocks, cracks, particles, balls and floating texts.
- **Persistence** (`save`, `load`) — auto-saves to `localStorage` (key `infiniclick.save.v1`).
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

## Conventions

- Vanilla JavaScript (ES2020+), no framework and no build tool.
- A single logic file; keep the sections commented and separated.
- Nothing blocks the thread: everything runs through the `requestAnimationFrame` loop.

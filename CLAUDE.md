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
   a black "accessing upper universe level N…" interlude and a bonus, then a fresh
   board with one block pre-destroyed.
7. Shards buy **balls** (and merges make them stronger), which speed up the
   harvest. Back to step 1, deeper or higher.

## Infinity, without an infinite stack

Only **two boards** are ever loaded at once: the one on screen and its immediate
parent. You can only zoom out once the current board is fully cleared, so at any
moment there are just two "notches" in play — never a growing stack. When a whole
meta-board is finished, the next universe is generated on the spot (a fresh, tougher
board with one block pre-destroyed), so the climb upward is endless but memory is
constant. The meta phase uses the exact same board, blocks, balls and rendering as
the normal phase — it *is* the same game, only zoomed.

## One economy, two shared files

All the tunable numbers live in **`config.js`** and all the formulas that turn them
into HP / rewards / damage live in **`economy.js`**. Both the game (`game.js`) and
the economy dashboard (`stats.html`) read these same two files, so the charts always
plot exactly what the game charges. To rebalance, edit `config.js` — nothing else.

## Difficulty: one growth law, cost split across blocks

Progression is a single **global level index** `state.level` — every board you clear
bumps it by one. A board's **total** HP is one number,

```
boardCost(L) = HP_BASE · COST_GROWTH^L
```

and that total is **divided across its blocks by weight** (so the sum of the block
HP equals `boardCost`). The reward for a whole board (`boardReward = REWARD_RATIO ·
boardCost`) is split the same way. This decouples the metrics from the *number and
shape* of the blocks — you can change the grid freely without touching the balance.

There is **no hard-coded "×10 per universe"** any more. A universe spans one
meta-board (≈ `blocks` levels), so its difficulty multiplier vs the one below is
simply `COST_GROWTH^blocks` — with `1.1` and ~24 blocks that lands near ×10 on its
own. `universeCost` / `universeMultiplier` in `economy.js` derive it. The `Meta` stat
in the HUD is `state.universe` (how many you have finished); it advances only on
**ascension**, which also grants a bonus (`ascendBonus`).

Because costs grow exponentially the numbers get large; they are plain JS **floats**
(exact to ~1e15, valid to ~1e308), rendered by `economy.formatNum` as integers →
`K`/`M`/`B` → scientific (`1.23e18`). No BigInt — the lost integer precision past a
quadrillion is invisible on screen. Open `stats.html` to see the curves and tune the
ratios live; `docs/idle-game-tuning.md` explains the math.

## Balls & tiers

Balls come in **tiers**. Buying an **Extra Ball** always adds a **tier-1** ball — the
only ones you can buy — and you may hold at most **ten** (`LEVEL1_CAP`); past that you
must merge. Ten balls of a tier **merge** (button in the ball banner) into one of the
next tier. Damage rises steeply per tier,

```
ballDamage(T) = DMG_BASE · (MERGE_REQUIRED · MERGE_DAMAGE_MULT)^(T-1)   // 10, 300, 9000, …
```

so a merged ball is worth 3× the ten balls it consumed (ZenShards-style) — merging is
always the right move. The next tier-1 ball is priced `BALL_BASE_COST ·
BALL_COST_GROWTH^(balls ever bought)`.

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
| `config.js`  | Every tunable knob (`IC.config`) — the one place to rebalance.     |
| `economy.js` | Pure formulas (`IC.economy`) shared by the game and the stats page.|
| `game.js`    | The game itself: physics, rendering, the fractal state machine, saving. |
| `stats.html` | Economy dashboard: live cost/reward curves from `economy.js`.     |
| `docs/`      | `idle-game-tuning.md`: incremental-game balance theory & knobs.   |
| `CLAUDE.md`  | This document.                                                    |

## Architecture

`config.js` sets `window.IC.config` (data) and `economy.js` sets `window.IC.economy`
(pure formulas) — loaded, in that order, before `game.js`. The game reads both as
`C` and `E`. `stats.html` loads the same two files and nothing else of the game.

`game.js` lives inside an IIFE (no globals of its own) and is split into sections:

- **`state`** — persisted progress: `fragments`, the global `level`, the `universe` count, `ballCounts` per tier, and `ballsBought`. `DEFAULT_STATE()` is the single source of truth for a fresh game, used at boot and by reset.
- **`runtime`** — ephemeral, unsaved data: the active `board`, its `parent` meta-board, the current `phase`, an in-flight zoom `anim`, the ascension `interlude`/`pending`, plus balls, particles, floating texts and the banner.
- **Grid** (`layoutGrid`, `makeBoard`, `pickPortal`, `blockRect`, `cellRectOf`) — lays out blocks responsively and builds whole boards, splitting `E.boardCost(level)` and `E.boardReward(level)` across the blocks by weight.
- **Boards & phases** (`ensureBoards`, `boardCleared`, `startZoomOut`/`completeZoomOut`, `startZoomIn`/`completeZoomIn`, `startAscension`/`completeAscension`) — the fractal state machine (`play` → `zoomOut` → `hunt` → `zoomIn` → `play`, plus `ascend` between universes).
- **Balls** (`makeBall`, `syncBalls`, `placeBalls`, `mergeBalls`, `ballDamageOf`) — tiered balls, merging, and repositioning after a zoom.
- **Physics** (`ballHitsBlock`) — circle/rectangle collision on the axis of least penetration; reflects the ball and, when asked, chips the block (during a hunt it just reports which block was touched so the game can dive in).
- **Economy** (`breakBlock`, `damageBlock`) — applies damage and pays out each block's pre-computed reward share; all the *numbers* come from `E`.
- **Update / Rendering** — one update branch per phase; `drawBoard` maps a board into any screen rect (the zoom is an interpolated camera), plus `drawInterlude` for the between-universe screen.
- **Shop** (`buyBall`, `renderShop`, `renderBallBar`) — the single Extra-Ball purchase and the ball banner with merge buttons.
- **Persistence** (`save`, `load`, `resetGame`) — auto-saves to `localStorage` (`C.SAVE_KEY`, currently `…v3`); `resetGame` wipes the save *and* every scrap of live state.
- **Loop** (`frame`) — `requestAnimationFrame` with a clamped `dt`.

## Shop

For now the only purchase is **Extra Ball** (a tier-1 ball, capped at ten), and the
only other action is **merging** ten balls of a tier into one of the next. Everything
else — damage, income — is derived from balls, merges and how deep you have climbed.
More upgrades can be re-introduced later; they belong in `config.js`/`economy.js`.

## Quick customization

- **Everything balance-related**: `config.js`. Board HP curve (`HP_BASE`,
  `COST_GROWTH`), reward (`REWARD_RATIO`), ascension bonus (`ASCEND_BONUS_MULT`), ball
  damage/merge (`DMG_BASE`, `MERGE_REQUIRED`, `MERGE_DAMAGE_MULT`), ball price
  (`BALL_BASE_COST`, `BALL_COST_GROWTH`), cap (`LEVEL1_CAP`), feel (`ZOOM_DUR`,
  `HUNT_GRACE`, `ASCEND_DUR`), grid density (`GRID_TARGET`). Open `stats.html` to see
  the effect of any change on the cost/reward curves before committing it.
- **Formulas** (the *shape* of the curves): `economy.js`.
- **Palette / theme**: CSS variables in `:root` of `style.css`. **Block palettes**
  (one per universe) and **ball colours**: `PALETTES` / `BALL_COLORS` in `config.js`.

## Conventions

- Vanilla JavaScript (ES2020+), no framework and no build tool.
- Config and formulas are split out of the game so both it and `stats.html` share
  them; keep `game.js` free of magic numbers — put them in `config.js`.
- Nothing blocks the thread: everything runs through the `requestAnimationFrame` loop.

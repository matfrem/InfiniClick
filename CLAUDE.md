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
the normal phase — it *is* the same game, only zoomed — but the meta-board is themed
as the **universe above** (its palette and layout), a tease of what you are climbing
into.

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

There is **no hard-coded "×10 per universe"** any more. The grid is a **fixed
`GRID_COLS × GRID_ROWS` (6×4 = 24 blocks) on every device** — the mobile layout —
so a universe always spans exactly 24 levels. On top of the smooth `COST_GROWTH^24`
(≈9.85, near ×10) per universe, each universe's `boardCost` is multiplied by an
explicit **per-universe difficulty factor**: the first few are hand-tuned in
`UNIVERSE_COST_STEPS` (to shape the opening ramp), then each further universe
multiplies by `UNIVERSE_COST_MULT`. Because ball power grows only ~logarithmically
with income (ball prices inflate) while cost grows with it, these factors make each
universe take progressively **longer** than the last. `economy.universeFactor(u)`
computes it. A **90%-off sale on the first `BALL_SALE_COUNT` balls** (`BALL_SALE_OFF`)
softens the cold open instead of handing out free balls.

Separately, each universe has a **brick-HP percentage** (`UNIVERSE_HP_PERCENT`, default
100% for the opening universes) that scales **only the HP**, never the reward: dropping
a universe to 20% makes its bricks break ~5× faster (great with manual clicks) while the
reward curve stays put. `economy.boardHp(level) = boardCost(level) · hpPercent`, whereas
`boardReward` is always paid on the full nominal `boardCost`. The HUD stat reads the current
**era** — the universe's name and how far through it you are (e.g. `28%` under
`QUARK ERA`); it advances only on **ascension**, which grants a bonus (`ascendBonus`,
scaled to your ball price so it always buys ~`ASCEND_BONUS_MULT` more balls) and shows
an interlude naming the next scale and the shards awarded (`UNIVERSE_NAMES`: Quark →
Nucleon → Atom → …). A fresh game opens on an intro panel introducing the Quark you
start inside.

Each universe has its **own palette and a dark background** (`PALETTES` /
`BACKGROUNDS`) that fills the whole screen; the panels (top bar, shop) float over it,
and the play-field is a plain square outline, not a rounded panel. Block HP is shared
across the grid by **random weights** (that still sum to `boardCost`), so bricks start
visibly varied, and each brick's **colour tracks its remaining HP** within the palette.

Because costs grow exponentially the numbers get large; they are plain JS **floats**
(exact to ~1e15, valid to ~1e308), rendered by `economy.formatNum` as integers →
`K`/`M`/`B` → scientific (`1.23e18`). No BigInt — the lost integer precision past a
quadrillion is invisible on screen. Open `stats.html` to see the curves and tune the
ratios live; `docs/idle-game-tuning.md` explains the math.

## Balls & tiers

Balls come in **tiers**. Buying an **Extra Ball** always adds a **tier-1** ball — the
only ones you can buy — and you may hold up to **`LEVEL1_CAP` (20)**. Merging only
**unlocks at `MERGE_UNLOCK` (15)** even though a merge still consumes only ten, so it
never collapses you from a bare ten down to one (which felt punishing).
Ten balls of a tier **merge** (button in the ball banner) into one of the next tier.
(The stats model assumes you merge at `SIM_MERGE_AT` = 15, i.e. 15→6, for a smoother
curve.) Damage rises steeply per tier,

```
ballDamage(T) = DMG_BASE · (MERGE_REQUIRED · MERGE_DAMAGE_MULT)^(T-1)   // 1, 30, 900, …
```

so a merged ball out-damages the ten it consumed by `MERGE_DAMAGE_MULT` (default 3×,
ZenShards-style) — though you trade ten balls for one, which costs board coverage.
Each ball's damage is shown in the banner. The next tier-1 ball is priced
`BALL_BASE_COST · BALL_COST_GROWTH^(balls ever bought)`.

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
| `layout.js`  | Shared brick geometry (`IC.layout`): per-universe board **layouts** in a normalised square field. |
| `game.js`    | The game itself: physics, rendering, the fractal state machine, saving. |
| `simul.html` | Physics simulator: measures each layout's damaging-hit rate + suggests its HP %. |
| `stats.js`   | Baked output of `simul.html` (`IC.sim.layouts`) — the measured per-layout ratios. |
| `stats.html` | Economy dashboard: cost/reward, ball power and **time-per-level** curves. |
| `docs/`      | `idle-game-tuning.md`: incremental-game balance theory & knobs.   |
| `CLAUDE.md`  | This document.                                                    |

## Architecture

`config.js` (`IC.config`, data), `economy.js` (`IC.economy`, formulas) and
`layout.js` (`IC.layout`, brick geometry) load in that order before `game.js`, which
reads them as `C`, `E`, `LAY`. `stats.html` loads config + economy (+ `stats.js`);
`simul.html` loads config + economy + layout.

**Coordinates.** Bricks and balls live in `layout.js`'s **normalised square field**
(`FIELD × FIELD` units); the balls bounce in the whole square. All physics runs in
field units, so it is identical on every device and matches the simulator exactly. The
game keeps a `view` transform (a centred square scaled to the canvas) and draws
everything through it; the fractal zoom is a camera *inside* the field. Screen taps are
mapped back to field units (`toField`).

**Layouts.** `layout.js` holds several board **layouts** (`grid`, `staggered`, `ring`,
`pyramid`), one per universe via `layoutForUniverse(u)` (cycling, like palettes).
`cells(i)` returns that layout's brick rects; every layout keeps the **same 24 blocks**
so `blocksPerBoard`, the economy and the clear-time metrics stay put — only the shape
and brick sizes change, and each brick carries its own `rect`. The **meta-board teases
the universe above**: `ensureBoards`/`startAscension` build the parent with
`state.universe + 1`, so zooming out shows the next universe's palette *and* layout —
and while playing, the play-field is framed thickly in that parent block's colour (a
faint wash of it too), so "you dived into this block" reads clearly. `simul.html`
measures **one number per layout** (its damaging-hit rate) and bakes it to `stats.js`;
each layout's `LAYOUT_HP_PERCENT` (= its rate ÷ the grid's, folded into `boardHp`)
normalises clear time so swapping a universe's shape doesn't move its clock.

`game.js` lives inside an IIFE (no globals of its own) and is split into sections:

- **`state`** — persisted progress: `fragments`, the global `level`, the `universe` count, `ballCounts` per tier, `ballsBought`, `powerLevel` and `clickLevel`. `DEFAULT_STATE()` is the single source of truth for a fresh game, used at boot and by reset.
- **`runtime`** — ephemeral, unsaved data: the active `board`, its `parent` meta-board, the current `phase`, an in-flight zoom `anim`, the ascension `interlude`/`pending`, plus balls, particles, floating texts and the banner.
- **Grid** (`layoutGrid`, `makeBoard`, `pickPortal`, `blockRect`, `cellRectOf`) — lays out blocks responsively and builds whole boards, splitting `E.boardCost(level)` and `E.boardReward(level)` across the blocks by weight.
- **Boards & phases** (`ensureBoards`, `boardCleared`, `startZoomOut`/`completeZoomOut`, `startZoomIn`/`completeZoomIn`, `startAscension`/`completeAscension`) — the fractal state machine (`play` → `zoomOut` → `hunt` → `zoomIn` → `play`, plus `ascend` between universes).
- **Balls** (`makeBall`, `syncBalls`, `placeBalls`, `mergeBalls`, `ballDamageOf`) — tiered balls, merging, and repositioning after a zoom.
- **Physics** (`ballHitsBlock`) — circle/rectangle collision on the axis of least penetration; reflects the ball and, when asked, chips the block (during a hunt it just reports which block was touched so the game can dive in).
- **Economy** (`breakBlock`, `damageBlock`) — applies damage and pays out each block's pre-computed reward share; all the *numbers* come from `E`.
- **Update / Rendering** — one update branch per phase; `drawBoard` maps a board into any screen rect (the zoom is an interpolated camera), plus `drawInterlude` for the between-universe screen.
- **Shop** (`buyBall`, `buyPower`, `buyClickPower`, `renderShop`, `renderBallBar`) — the Extra-Ball, Power and Click-Power purchases and the ball banner with merge buttons.
- **Persistence** (`save`, `load`, `resetGame`) — auto-saves to `localStorage` (`C.SAVE_KEY`, currently `…v3`); `resetGame` wipes the save *and* every scrap of live state.
- **Loop** (`frame`) — `requestAnimationFrame` with a clamped `dt`.

## Shop

Three purchases: **Extra Ball** (a tier-1 ball, capped at twenty), **Power**, a
global multiplicative damage upgrade (`×POWER_MULT` per buy, geometric cost), and
**Click Power**, the same multiplier applied to manual taps but **capped at
`CLICK_POWER_CAP` (10)** buys (it reuses `POWER_MULT` and `POWER_COST_GROWTH`, with
its own cheaper `CLICK_POWER_BASE_COST`). Plus
**merging** ten balls of a tier into one of the next.

**Power is the exponential lever, and it is not optional maths.** Board cost grows
exponentially in the level; balls alone give only *polynomial* damage (ball prices
inflate, so you afford ~linearly many, and merge tiers grow logarithmically) — so a
balls-only economy diverges: cost outruns power forever. A multiplicative upgrade
bought ~linearly in the level makes `POWER_MULT^level` **exponential**, matching the
cost curve (see `stats.html`: the "ball power" line then runs parallel to the cost
line). Tune `POWER_MULT` / `POWER_COST_GROWTH` so power tracks cost; then
`UNIVERSE_COST_MULT` sets how much *harder* each successive universe is.

## Quick customization

- **Everything balance-related**: `config.js`. Board HP curve (`HP_BASE`,
  `COST_GROWTH`, `UNIVERSE_COST_STEPS`, `UNIVERSE_COST_MULT`), per-universe brick-HP %
  (`UNIVERSE_HP_PERCENT`, HP-only, reward untouched) and per-layout brick-HP %
  (`LAYOUT_HP_PERCENT`, normalises clear time across shapes — `simul.html` suggests it),
  reward (`REWARD_RATIO`), ascension
  bonus (`ASCEND_BONUS_MULT`), the Power upgrade (`POWER_MULT`, `POWER_BASE_COST`,
  `POWER_COST_GROWTH`), the Click-Power upgrade (`CLICK_POWER_CAP`,
  `CLICK_POWER_BASE_COST`), ball
  damage/merge (`DMG_BASE`, `MERGE_REQUIRED`, `MERGE_UNLOCK`, `MERGE_DAMAGE_MULT`,
  `SIM_MERGE_AT`), ball
  price (`BALL_BASE_COST`, `BALL_COST_GROWTH`), ball sale (`BALL_SALE_COUNT`,
  `BALL_SALE_OFF`), cap (`LEVEL1_CAP`), feel (`ZOOM_DUR`,
  `HUNT_GRACE`, `ASCEND_DUR`), grid (`GRID_COLS`, `GRID_ROWS`) and board **layouts**
  (`layout.js`'s `LAYOUTS` / `layoutForUniverse`), ball speed
  (`BALL_SPEED`, in field units), palettes/backgrounds (`PALETTES`, `BACKGROUNDS`),
  universe names (`UNIVERSE_NAMES`). Open `stats.html` to see the effect of any change
  on the cost/reward curves before committing it.
- **Formulas** (the *shape* of the curves): `economy.js`.
- **Time-per-level / how long a universe takes**: `stats.html`'s time chart uses
  `stats.js` — geometric clear-time ratios measured by `simul.html`. If you change
  the grid or the physics, re-run `simul.html` (it has a stage-size box for
  desktop vs mobile) and copy its output into `stats.js`.
- **Palette / theme**: CSS variables in `:root` of `style.css`. **Block palettes**
  (one per universe) and **ball colours**: `PALETTES` / `BALL_COLORS` in `config.js`.

## Conventions

- Vanilla JavaScript (ES2020+), no framework and no build tool.
- Config and formulas are split out of the game so both it and `stats.html` share
  them; keep `game.js` free of magic numbers — put them in `config.js`.
- Nothing blocks the thread: everything runs through the `requestAnimationFrame` loop.

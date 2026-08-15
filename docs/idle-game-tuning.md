# Idle / incremental game math — a tuning reference

A short, practical reference for balancing InfiniClick's ratios (HP curve, upgrade
costs, damage growth, ball economy). The goal of an incremental game is a steady
sense of progress: the player should always be a short, satisfying wait away from
the next purchase, and each purchase should feel like it *matters* for a while
before the next wall appears.

## The two curves that decide everything

Every incremental economy is a race between two exponential curves:

- **Cost curve** — what the next upgrade costs. Almost always geometric:
  `cost(n) = baseCost · growth^n`. *Cookie Clicker* famously uses `growth = 1.15`.
  InfiniClick's upgrades use `growth` ≈ `1.27–1.5` (see `UPGRADES` in `game.js`).
- **Production / power curve** — how fast you earn (or how much damage you deal).

Balance is the *ratio* of these two. If production outruns cost growth, the game
trivialises (everything is instantly affordable). If cost outruns production, the
player hits a hard wall and quits. You want production to *slightly* lag cost so
each upgrade is a small reach.

### Bulk-buy / time-to-afford

The total cost of buying levels `a … b` of a geometric upgrade is a geometric sum:

```
total(a, b) = baseCost · (growth^b − growth^a) / (growth − 1)
```

Time-to-afford at income `I` per second is `total / I`. Keep this in a comfortable
band (a few seconds early, tens of seconds mid-game). If it balloons, lower
`growth` or raise income; if it collapses, do the opposite.

## InfiniClick's specific structure

All of these live in `config.js`; the formulas are in `economy.js`; `stats.html`
charts them live. There is a single growth law, not a special per-universe rule.

- **HP curve.** A board (one "level") has a total cost `boardCost(L) = HP_BASE ·
  COST_GROWTH^L`, split across its blocks by weight so the *count and shape* of the
  blocks are free to change without moving the metric. `L` is the global level index,
  bumped by one every board you clear.
- **No hard ×10.** A universe is one meta-board spanning `blocks` levels, so its
  difficulty multiplier vs the one below is `COST_GROWTH^blocks` (≈ 9.85 at 1.1 / 24)
  **times `UNIVERSE_COST_MULT`**, an explicit per-universe jump on top. Ball power
  grows only ~logarithmically with income (prices inflate) while cost grows with it,
  so `UNIVERSE_COST_MULT > 1` makes each universe take **longer** than the last. The
  ramp only bites once you stop one-shotting bricks — early universes stay fast
  because they are geometry-limited, then times climb steeply (minutes → hours → days
  by a handful of universes). `economy.universeMultiplier` reports the combined
  factor; the “Universe difficulty ×” slider in `stats.html` shows it live.
- **Shard income** tracks cost: `boardReward(L) = REWARD_RATIO · boardCost(L)`, split
  across the blocks the same way. So income rises at the same `COST_GROWTH^L` rate as
  difficulty; the *ratio* (default 0.6) is the dial for how fast shards accumulate.
- **Damage MUST grow exponentially too — this is the whole game.** Board cost is
  exponential in the level. Balls alone give only *polynomial* power: ball prices
  inflate (`BALL_COST_GROWTH`), so you afford ~linearly many balls in the level, and
  merge tiers grow only logarithmically — `power ≈ level^~1.3`. On a log axis cost is
  a straight line and balls-only power is a *log curve*: the gap widens forever and
  the game becomes unwinnable. The fix (Pecorella's rule: production must be
  exponential) is the **Power upgrade** — a multiplicative `×POWER_MULT` with a
  geometric cost. You buy ~linearly many in the level, so `POWER_MULT^level` is
  exponential and tracks the cost line. **Tune `POWER_MULT` / `POWER_COST_GROWTH` so
  the "ball power" line in `stats.html` runs parallel to cost** — then times are a
  choice (via `UNIVERSE_COST_MULT`) instead of a runaway. Merging (a tier-T ball is
  `DMG_BASE · (MERGE_REQUIRED · MERGE_DAMAGE_MULT)^(T-1)`, ~20× per tier by default)
  is a secondary, ZenShards-flavour lever on top; its jumps are the time-per-level
  sawtooth.
- **Prestige = ascension.** Finishing a meta-board grants `ascendBonus =
  ASCEND_BONUS_MULT · ballCost(ballsBought)` — deliberately tied to your *ball price*
  rather than to board reward, so the bonus is always worth ~`ASCEND_BONUS_MULT` more
  balls no matter how deep you are (a reliably useful boost). Classic prestige math
  (Pecorella, Part III) applies: make it worth roughly the time the universe took.

### Knobs, and which direction to turn them (all in `config.js`)

| Symptom                                   | Turn this                                            |
|-------------------------------------------|------------------------------------------------------|
| Early game too slow / grindy              | ↓ `HP_BASE`, ↓ `COST_GROWTH`, ↓ `BALL_BASE_COST`     |
| Shards pile up too fast / too slow        | `REWARD_RATIO`                                        |
| Merging feels weak / mandatory-but-dull   | `MERGE_DAMAGE_MULT` (payoff per merge)               |
| Universes fall too fast (no wall)         | ↑ `COST_GROWTH`, or a bigger grid (`GRID_COLS`/`ROWS`) |
| Universes are an impossible wall          | ↓ `COST_GROWTH`, ↓ `BALL_COST_GROWTH`                |
| Ascension feels unrewarding               | ↑ `ASCEND_BONUS_MULT`                                |
| Numbers explode past readability          | already handled by `formatNum`; tune, don't fear it  |
| Meta phase flashes by                     | ↑ `HUNT_GRACE`                                        |

`stats.html` *is* the spreadsheet: it plots board cost, board reward, ball damage and
ball price straight from `economy.js`, and lets you drag the knobs before you commit
them to `config.js`. Pecorella's worksheets (below) inspired the approach.

## The clear-time model (two regimes) — and a physics gotcha

A level's time is `max(geometry, damage)`:

- **Geometry-limited** — when bricks die in a hit or two, the wall is *how fast the
  balls physically reach every brick*. Measured directly by `simul.html`
  (`clearSecondsByBallCount`) and dominates low-HP boards (e.g. a universe at 8% HP).
- **Damage-limited** — when bricks out-HP your DPS, time is `boardHp / (rate · ball
  power)`, where `rate = hitsPerSecondPerBall` is the **effective damaging-hit rate
  per ball** on a *full* board.

That `rate` used to be measured as "count every frame one ball overlaps a brick on a
frozen full board" — which gave a wildly wrong **~40 hits/s** and made the time chart
optimistic by ~100×. The reason it was wrong is a real property of the layout worth
knowing when you tune HP: **the corridors between grid bricks are narrower than a
ball's diameter** (gap ≈ 27 vs diameter ≈ 53 units). So a ball *cannot cross the
grid*: it bounces off the outside face and is confined below it, only ever hitting the
perimeter — a full high-HP board is a slow **perimeter grind** that peels inward as
bricks fall, and manual clicks matter a lot. The frozen-board measurement instead
trapped a ball *inside* a pocket where it registered a contact almost every frame.

`simul.html` now measures `rate` the honest way: a genuine damage-limited clear (real
brick HP, balls placed as in game) with `rate = totalHP / (clearTime · balls)`. It
comes out around **0.4 hits/s per ball** on the grid, ~100× lower than the old number,
and the time chart now matches what you actually experience. Hits scale linearly with
ball count, so **one number per layout** is enough — the whole model is
`time = max(BLOCKS / (rate·N), boardHp / (rate·power))` (a geometry floor vs the
damage-limited time), plus the parallel click path.

**Layouts clear at very different speeds** — the open `ring` lets balls reach bricks
freely and lands ~1.5 hits/s/ball vs the grid's ~0.4 (nearly 4×). To keep the *time*
from lurching when a universe's shape changes, each layout carries an **HP %**
(`config.LAYOUT_HP_PERCENT`) equal to `its rate ÷ the grid's rate` — `simul.html`
prints the suggested array. `economy.boardHp` multiplies it in **on top of**
`UNIVERSE_HP_PERCENT` (reward untouched), so a 4×-faster layout gets 4× the HP and
clears in the same time as the grid would. Net: `UNIVERSE_HP_PERCENT` is your time
dial per universe; `LAYOUT_HP_PERCENT` just normalises the shapes so swapping one
doesn't move the clock. Drag the sliders in `stats.html` — the "Time per universe"
row is now trustworthy and layout-invariant.

## References

- Anthony Pecorella, **The Math of Idle Games** — the canonical series:
  [Part I](https://www.gamedeveloper.com/design/the-math-of-idle-games-part-i) ·
  [Part III](https://www.gamedeveloper.com/design/the-math-of-idle-games-part-iii)
- Pecorella, **Quest for Progress: The Math and Design of Idle Games** (GDC Europe
  2016) — [slides PDF](https://media.gdcvault.com/gdceurope2016/presentations/Pecorella_Anthony_Quest%20for%20Progress.pdf)
  · [GDC Vault talk](https://www.gdcvault.com/play/1023876/Quest-for-Progress-The-Math)
- Pecorella, **Idle game models & worksheets** (the balancing spreadsheets):
  [Internet Archive](https://archive.org/details/idlegameworksheets)
- Dik Medvešček Murovec, **Math — the backbone of Idle Games**:
  [Medium](https://medvescekmurovec.medium.com/math-the-backbone-of-idle-games-part-1-f46b54706cf1)
- **Incremental game** overview: [Wikipedia](https://en.wikipedia.org/wiki/Incremental_game)

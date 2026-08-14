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
  difficulty multiplier vs the one below is `COST_GROWTH^blocks`. With `1.1` and ~24
  blocks that is ≈ 9.85 — the old “×10 per universe” now *emerges* from the growth
  law. `economy.universeMultiplier(blocks)` reports it; `stats.html` shows it live.
- **Shard income** tracks cost: `boardReward(L) = REWARD_RATIO · boardCost(L)`, split
  across the blocks the same way. So income rises at the same `COST_GROWTH^L` rate as
  difficulty; the *ratio* (default 0.6) is the dial for how fast shards accumulate.
- **Damage growth** comes only from balls right now: buying tier-1 balls (up to ten)
  and merging. A tier-T ball deals `DMG_BASE · (MERGE_REQUIRED · MERGE_DAMAGE_MULT)
  ^(T-1)` — with the defaults 10 → 200 → 4000 …, i.e. **`MERGE_REQUIRED ·
  MERGE_DAMAGE_MULT` = 20× per tier**. Because a board's cost grows only `COST_GROWTH`
  per level, a single merge (20×) buys you ~`ln 20 / ln 1.1 ≈ 31` levels of headroom.
  That interplay of `COST_GROWTH` vs `MERGE_DAMAGE_MULT` and the ball price is the core
  of the balance — a smaller `MERGE_DAMAGE_MULT` makes the time-per-level sawtooth
  (each tooth is a forced merge) shallower.
- **Prestige = ascension.** Finishing a meta-board grants `ascendBonus(L) =
  ASCEND_BONUS_MULT · boardReward(L)`. Classic prestige math (Pecorella, Part III)
  applies: make the bonus worth roughly the time the universe took.

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

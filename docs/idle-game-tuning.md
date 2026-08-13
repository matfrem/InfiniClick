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

- **HP curve.** A board of rank *R* has blocks with `base · HP_PER_META^R` HP
  (`HP_PER_META = 10`). So difficulty is **×10 per meta rank** — a deliberately
  steep, prestige-like wall between universes.
- **Shard income** scales with the HP you destroy (`reward = maxHp · 2 · yieldMul`),
  so income *also* rises ~10× per rank. That means upgrade costs (which grow only
  by `growth^n`) become relatively cheap at higher ranks — the intended pressure
  valve that lets you buy many small upgrades to break the next wall.
- **Damage growth** is multiplicative and small (Ball Power ×1.08/level). To gain a
  full 10× (one rank) you need ~`ln 10 / ln 1.08 ≈ 30` levels of Ball Power — plus
  ball merges (a level-N ball deals N× damage) and more balls. That ~30-level reach
  per rank is the core grind knob: raise the 1.08 to soften it, lower it to harden.
- **Prestige = ascension.** Finishing a whole meta-board and climbing a rank is the
  prestige loop. Classic prestige math (Pecorella, Part III) applies: the reward for
  ascending should be worth roughly the time it took, so each universe feels like a
  fresh, faster run rather than a slog.

### Knobs, and which direction to turn them

| Symptom                                   | Turn this                                            |
|-------------------------------------------|------------------------------------------------------|
| Early game too slow / grindy              | ↓ `makeBlock` base HP, ↑ starting balls, ↓ `growth`  |
| Upgrades feel pointless                   | ↑ damage step (1.08 → 1.12), ↑ merge payoff          |
| Ranks fall too fast (no wall)             | ↑ `HP_PER_META`, ↑ meta grid size (`target` in `layoutGrid`) |
| Ranks are an impossible wall             | ↓ `HP_PER_META`, ↓ damage-upgrade `growth`           |
| Numbers explode past readability          | already handled by `formatNum`; tune, don't fear it  |
| Meta phase flashes by                     | ↑ `HUNT_GRACE`                                        |

A spreadsheet beats intuition here: put rank on rows, and columns for block HP,
board clear-time at a given DPS, shard income, and cumulative upgrade cost. Pecorella
ships exactly such worksheets (linked below) — copy their structure.

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

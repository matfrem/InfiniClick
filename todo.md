# InfiniClick — TODO (parked ideas)

## 1. Tease the upper universe when zoomed out — *partly done*

When you zoom **out** onto the meta-board (the `hunt` phase) it should feel like
you have stepped up into the **next** universe.

**Done:** the meta-board is themed as `state.universe + 1` — it uses the upper
universe's **palette** and **layout** (see `ensureBoards` / `startAscension`,
which build the parent with `state.universe + 1`). So while you clear a sub-board
you see the current universe's colours/shape, and the moment you pop out to the
meta you see the universe above's colours/shape.

**Still parked:**
- Show the upper universe's **name** in the HUD (and optionally its background)
  while hunting, not just on the bricks.
- Make ascension read as "the above becomes your new here" (a smooth theme swap).

## 2. Layout types (per-universe board shapes) — *done*

**Done:** `layout.js` owns several **layouts** (`grid`, `staggered`, `ring`,
`pyramid`), assigned per universe by `layoutForUniverse(u)` (cycling), exactly
like palettes/backgrounds. `cells(i)` returns each layout's brick rects. Every
layout keeps the **same 24 blocks** so `blocksPerBoard`, the economy and the
clear-time metrics don't move — only the shape and brick sizes change. Bricks
carry their own `rect` (no more `r,c` grid coupling in `game.js`).

**Done — per-layout clear-time stats:** `simul.html` now measures **every** layout
(a dropdown picks which to view) and bakes `stats.js` as `IC.sim.layouts[i]` with
each layout's `hitsPerSecondPerBall` and `clearSecondsByBallCount`. `stats.html`'s
time model picks a universe's ratios by its layout — and the shapes DO differ a lot
(e.g. the open `ring` clears ~3–4× faster than the packed `grid`), so this matters.

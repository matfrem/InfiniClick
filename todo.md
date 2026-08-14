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

## 2. Layout types (per-universe board shapes) — *done (shapes), stats parked*

**Done:** `layout.js` now owns several **layouts** (`grid`, `staggered`, `ring`,
`pyramid`), assigned per universe by `layoutForUniverse(u)` (cycling), exactly
like palettes/backgrounds. `cells(i)` returns each layout's brick rects. Every
layout keeps the **same 24 blocks** so `blocksPerBoard`, the economy and the
clear-time metrics don't move — only the shape and brick sizes change. Bricks
carry their own `rect` now (no more `r,c` grid coupling in `game.js`).

**Still parked — per-layout clear-time stats:**
- The `simul.html` ratios in `stats.js` are still measured on the **grid** only.
  Non-grid layouts reuse those numbers (the times are approximate for them).
- To make times exact per shape: extend `simul.html` to measure **each** layout
  and bake a `stats.js` keyed by layout, then have `stats.html`'s time model pick
  the layout's ratios by universe. Only worth doing if the shapes turn out to
  clear at meaningfully different speeds.

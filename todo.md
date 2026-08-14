# InfiniClick — TODO (parked ideas)

Deferred while balancing. Two related features, both about making the fractal
**tease the universe above** and vary the boards.

## 1. Tease the upper universe when zoomed out

When you zoom **out** onto the meta-board (the `hunt` phase), it should feel like
you have stepped up into the **next** universe, not the current one:

- The upper universe has **its own name, its own theme (palette + background), and
  its own layout**.
- So while you are clearing a sub-board you are in, say, the *Quark* (its palette /
  bg), but the moment you pop out to the meta you should see/feel the *Nucleon*
  above — its name in the HUD, its palette on the meta bricks, its background.
- Net: two universes are "visible" at once — the one you're inside (sub) and the
  one above (meta) — and crossing between them (zoom in/out) swaps name + theme +
  layout accordingly. Ascension is then just "the above becomes your new here".

Implementation sketch: give a board an explicit `universe` used for name/theme, set
the meta's universe to `state.universe + 1` and the sub's to `state.universe`;
drive the HUD "era" + the screen background off whichever board is on screen.

## 2. Layout types (per-universe board shapes)

Introduce a **Layout** abstraction (a small class/object) that owns:

- the **brick placement** (where each brick sits in the normalised field), and
- its **own simulated clear-time stats** (the `simul.html` ratios are per-layout,
  since the geometry differs).

Assign a layout to each universe, the same way palettes/backgrounds are assigned
(cycling or a per-universe list). Starter set:

- **`grid6x4`** — the current 6×4 = 24 bricks.
- **`border1`** — bricks only on the border of a 6×4 (24 − 4 corners = 20), hollow
  centre.
- **`grid2x2`** — 4 bricks in the centre, each twice as big.

Open question the user raised: a universe whose layout has only 4 bricks means each
of those 4 bricks is a whole board below — so the brick counts stop matching 24.
Simplest resolution: **always arrange for ~24 bricks per layout** (e.g. subdivide),
so `blocksPerBoard` stays constant and the economy/metrics don't move. Revisit if we
want genuinely different brick counts (then `economy`/`stats` must treat
`blocksPerBoard` as per-universe, and `simul.html` must bake a table per layout).

Notes:
- `simul.html` already measures one layout; extend it to measure each layout and
  bake a `stats.js` keyed by layout name.
- The time-per-level model in `stats.html` then picks the layout's ratios by
  universe.

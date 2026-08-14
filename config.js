/*
 * InfiniClick — tunable configuration.
 *
 * Every knob that shapes the economy or the feel of the game lives here, and
 * nowhere else. Both the game (game.js) and the stats dashboard (stats.html)
 * read from this same object, so tweaking a number here re-balances both at
 * once. The pure formulas that turn these knobs into HP / rewards / damage
 * live next door in economy.js.
 */
window.IC = window.IC || {};

IC.config = {
  SAVE_KEY: "infiniclick.save.v3",

  // --- Board economy ---------------------------------------------------------
  // A board (one "level") has a single total HP cost that is split across its
  // blocks by weight, so the NUMBER or SHAPE of the blocks can change without
  // moving the metrics. Difficulty is one smooth exponential in the global level
  // index L:
  //
  //     boardCost(L) = HP_BASE * COST_GROWTH ^ L
  //
  // A whole universe spans `blocksPerBoard` levels, so the cost multiplier from
  // one universe to the next is COST_GROWTH ^ blocksPerBoard. The old hard-coded
  // "x10 per universe" now emerges from the growth law instead of being fixed —
  // e.g. 1.1 ^ 24 ≈ 9.85, roughly ten.
  HP_BASE: 200,
  COST_GROWTH: 1.1,
  REWARD_RATIO: 0.6,        // shards earned for clearing a whole board = ratio * cost
  ASCEND_BONUS_MULT: 4,     // universe-up bonus = this * boardReward(level)

  // --- Balls -----------------------------------------------------------------
  // A tier-T ball deals DMG_BASE * (MERGE_REQUIRED * MERGE_DAMAGE_MULT) ^ (T-1).
  // With 10 and 3 that is 10 → 300 → 9000 → … : a merged ball is worth 3x the ten
  // balls it consumed, so merging is always the right move (ZenShards-style).
  DMG_BASE: 10,
  MERGE_REQUIRED: 10,       // balls of a tier needed to merge into the next
  MERGE_DAMAGE_MULT: 3,     // a merged ball is worth this * the balls it consumed
  LEVEL1_CAP: 10,           // max level-1 balls you may hold before you must merge
  BALL_BASE_COST: 100,      // cost of your very first bought level-1 ball
  BALL_COST_GROWTH: 1.12,   // the next level-1 ball costs this^(total ever bought)
  MAX_BALLS: 60,            // hard cap on simultaneous balls (performance)
  BALL_SPEED: 200,          // base ball speed in px/s

  // --- Feel ------------------------------------------------------------------
  ZOOM_DUR: 0.55,           // seconds a zoom transition lasts
  HUNT_GRACE: 2.5,          // seconds balls roam a meta-board before diving in
  ASCEND_DUR: 5,            // seconds the "upper universe" interlude lasts

  // --- Grid ------------------------------------------------------------------
  // A FIXED block count (the mobile layout) on every device, so the metrics and
  // the simulator never depend on screen size. The cell just scales to fit.
  GRID_COLS: 6,
  GRID_ROWS: 4,
  CELL_MAX: 96,             // cap the cell size so a wide desktop stays mobile-ish

  // --- Universe names (the fractal scale, smallest first) --------------------
  // You start inside a quark and zoom outward. Beyond the list it falls back to
  // "Universe N".
  UNIVERSE_NAMES: [
    "Quark", "Nucleon", "Atom", "Molecule", "Cell", "Organism", "Planet",
    "Star", "Solar System", "Nebula", "Galaxy", "Galaxy Cluster", "Supercluster",
    "Cosmic Web", "Universe",
  ],

  // --- Visuals ---------------------------------------------------------------
  // One palette per universe (chosen by universe index, cycling).
  PALETTES: [
    ["#56d3c9", "#8a7dff", "#ffcf6b", "#ff8fab", "#7bd88f"], // aqua & violet
    ["#ff9f68", "#ffd66b", "#ff6b6b", "#c44dff", "#ff8fab"], // warm ember
    ["#6bd0ff", "#5b8cff", "#8a7dff", "#63f2d9", "#a0e8ff"], // deep ocean
    ["#7bd88f", "#b8e986", "#ffe66b", "#63d0a8", "#4fd1c5"], // meadow
    ["#ff8fab", "#ff6bd0", "#c44dff", "#8a7dff", "#ff9fe0"], // magenta bloom
    ["#ffd66b", "#ffb347", "#ff8c42", "#ff6b6b", "#f9e784"], // amber sun
    ["#a0a0ff", "#c9b8ff", "#8affd6", "#7bd8ff", "#d0b0ff"], // pastel nebula
  ],
  BALL_COLORS: ["#56d3c9", "#8a7dff", "#ffcf6b", "#ff8fab", "#7bd88f", "#f5f5f5"],
};

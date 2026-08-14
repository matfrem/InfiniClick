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
  // On top of the smooth per-level growth (COST_GROWTH^24 ≈ 10× per universe), each
  // universe multiplies board HP by this again. Your ball power grows only
  // ~logarithmically with income (ball prices inflate) while cost grows with it, so
  // a factor > 1 makes each universe take steadily LONGER than the last. The ramp
  // only bites once you stop one-shotting bricks (early universes stay fast because
  // they are geometry-limited); tune it live in stats.html.
  UNIVERSE_COST_MULT: 2,
  REWARD_RATIO: 0.6,        // shards earned for clearing a whole board = ratio * cost
  ASCEND_BONUS_MULT: 8,     // universe-up bonus = this * the cost of your next ball
                            // (i.e. ≈ enough shards to buy this many more balls)

  // --- Balls -----------------------------------------------------------------
  // A tier-T ball deals DMG_BASE * (MERGE_REQUIRED * MERGE_DAMAGE_MULT) ^ (T-1).
  // With 10 and 3 that is 10 → 300 → 9000 → … : a merged ball is worth 3x the ten
  // balls it consumed, so merging is always the right move (ZenShards-style).
  // The exponential power source. A shop upgrade that multiplies ALL ball damage.
  // Its cost is geometric while income is exponential, so you buy ~linearly many
  // in the global level L — and POWER_MULT^(that) grows EXPONENTIALLY, matching the
  // exponential board cost (the way an idle economy must). Without it, balls-only
  // power is only polynomial and the cost line runs away. Tune against the cost
  // curve in stats.html so "ball power" tracks it.
  POWER_MULT: 1.08,         // damage ×multiplier per Power upgrade bought
  POWER_BASE_COST: 50,
  POWER_COST_GROWTH: 1.3,

  DMG_BASE: 10,
  MERGE_REQUIRED: 10,       // balls consumed by one merge (10 -> 1 of the next tier)
  MERGE_DAMAGE_MULT: 2,     // a merged ball is worth this * the balls it consumed
  LEVEL1_CAP: 20,           // max tier-1 balls you may hold (merge is optional from 10)
  SIM_MERGE_AT: 15,         // the stats greedy model merges once a tier reaches this,
                            // so it never drops from 10 balls to 1 (a smoother curve)
  BALL_BASE_COST: 100,      // cost of your very first bought level-1 ball
  BALL_COST_GROWTH: 1.12,   // the next level-1 ball costs this^(total ever bought)
  MAX_BALLS: 60,            // hard cap on simultaneous balls (performance)
  BALL_SPEED: 520,          // base ball speed in FIELD units/s (see layout.js)

  // --- Feel ------------------------------------------------------------------
  ZOOM_DUR: 0.55,           // seconds a zoom transition lasts
  HUNT_GRACE: 2.5,          // seconds balls roam a meta-board before diving in
  ASCEND_DUR: 5,            // seconds the "upper universe" interlude lasts

  // --- Grid ------------------------------------------------------------------
  // A FIXED block count on every device. Bricks are laid out in a normalised
  // square FIELD (see layout.js), full width, and the game scales that square to
  // the screen — so the metrics and the simulator never depend on resolution.
  GRID_COLS: 6,
  GRID_ROWS: 4,

  // --- Universe names (the fractal scale, smallest first) --------------------
  // You start inside a quark and zoom outward. Beyond the list it falls back to
  // "Universe N".
  UNIVERSE_NAMES: [
    "Quark", "Nucleon", "Atom", "Molecule", "Cell", "Organism", "Planet",
    "Star", "Solar System", "Nebula", "Galaxy", "Galaxy Cluster", "Supercluster",
    "Cosmic Web", "Universe",
  ],

  // --- Visuals ---------------------------------------------------------------
  // One palette per universe (chosen by universe index, cycling). Each palette
  // has a matching dark BACKGROUND that fills the whole screen for that universe.
  PALETTES: [
    ["#56d3c9", "#8a7dff", "#ffcf6b", "#ff8fab", "#7bd88f"], // aqua & violet
    ["#ff9f68", "#ffd66b", "#ff6b6b", "#c44dff", "#ff8fab"], // warm ember
    ["#6bd0ff", "#5b8cff", "#8a7dff", "#63f2d9", "#a0e8ff"], // deep ocean
    ["#7bd88f", "#b8e986", "#ffe66b", "#63d0a8", "#4fd1c5"], // meadow
    ["#ff8fab", "#ff6bd0", "#c44dff", "#8a7dff", "#ff9fe0"], // magenta bloom
    ["#ffd66b", "#ffb347", "#ff8c42", "#ff6b6b", "#f9e784"], // amber sun
    ["#a0a0ff", "#c9b8ff", "#8affd6", "#7bd8ff", "#d0b0ff"], // pastel nebula
  ],
  BACKGROUNDS: [
    "#08161a", // aqua & violet
    "#180d08", // warm ember
    "#080e1c", // deep ocean
    "#0a1610", // meadow
    "#160814", // magenta bloom
    "#171006", // amber sun
    "#100e1a", // pastel nebula
  ],
  BALL_COLORS: ["#56d3c9", "#8a7dff", "#ffcf6b", "#ff8fab", "#7bd88f", "#f5f5f5"],
};

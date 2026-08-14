/*
 * InfiniClick — economy formulas.
 *
 * Pure functions of the numbers in config.js. No game state, no DOM, no side
 * effects — just the maths that turns the tunable knobs into board costs, shard
 * rewards, ball damage and prices. Shared verbatim by game.js (to run the game)
 * and stats.html (to chart it), so the dashboard always plots exactly what the
 * game charges.
 */
window.IC = window.IC || {};

IC.economy = {
  // Blocks per board = levels per universe (fixed grid).
  blocksPerBoard() {
    return IC.config.GRID_COLS * IC.config.GRID_ROWS;
  },

  // Which universe (0-indexed) a global level belongs to.
  universeOfLevel(level) {
    return Math.floor(level / IC.economy.blocksPerBoard());
  },

  // The absolute difficulty factor for universe `u` (0-indexed): the hand-tuned
  // step for the opening universes, then UNIVERSE_COST_MULT compounding beyond.
  universeFactor(u) {
    const c = IC.config;
    const steps = c.UNIVERSE_COST_STEPS || [1];
    if (u < steps.length) return steps[u];
    const last = steps[steps.length - 1];
    return last * Math.pow(c.UNIVERSE_COST_MULT, u - (steps.length - 1));
  },

  // Total HP of the board at global level L (split across its blocks by weight).
  // Grows smoothly per level AND jumps per universe, so higher universes take
  // progressively longer to clear.
  boardCost(level) {
    const c = IC.config;
    return c.HP_BASE * Math.pow(c.COST_GROWTH, level) * IC.economy.universeFactor(IC.economy.universeOfLevel(level));
  },

  // Shards awarded for clearing the whole board at level L (split across blocks).
  boardReward(level) {
    return this.boardCost(level) * IC.config.REWARD_RATIO;
  },

  // Cost of a whole universe = the `blocks` consecutive levels it contains,
  // starting at `level`. A geometric sum under the same growth law that prices a
  // single level — this is how "one universe up" is derived instead of hard-coded.
  universeCost(level, blocks) {
    const g = IC.config.COST_GROWTH;
    if (g === 1) return this.boardCost(level) * blocks;
    return this.boardCost(level) * (Math.pow(g, blocks) - 1) / (g - 1);
  },

  // Multiplier in difficulty from one universe to the next: the smooth growth over
  // its levels, times the explicit per-universe jump.
  universeMultiplier(blocks) {
    return Math.pow(IC.config.COST_GROWTH, blocks) * IC.config.UNIVERSE_COST_MULT;
  },

  // Base damage of a single tier-T ball (before the global Power multiplier).
  ballDamage(tier) {
    const c = IC.config;
    return c.DMG_BASE * Math.pow(c.MERGE_REQUIRED * c.MERGE_DAMAGE_MULT, tier - 1);
  },

  // The global damage multiplier from `n` Power upgrades — the exponential lever.
  powerMultiplier(n) {
    return Math.pow(IC.config.POWER_MULT, n);
  },

  // Cost of the next Power upgrade (geometric).
  powerCost(n) {
    const c = IC.config;
    return c.POWER_BASE_COST * Math.pow(c.POWER_COST_GROWTH, n);
  },

  // Price of the next level-1 ball, given how many you have ever bought.
  ballCost(bought) {
    const c = IC.config;
    return c.BALL_BASE_COST * Math.pow(c.BALL_COST_GROWTH, bought);
  },

  // Bonus shards for ascending to the next universe — scaled to your ball price,
  // so it is always worth roughly ASCEND_BONUS_MULT more balls (a real boost).
  ascendBonus(ballsBought) {
    return this.ballCost(ballsBought) * IC.config.ASCEND_BONUS_MULT;
  },

  // The colour palette for a given universe index (cycles).
  paletteFor(index) {
    const p = IC.config.PALETTES;
    return p[((index % p.length) + p.length) % p.length];
  },

  // The dark screen background for a given universe index (cycles).
  backgroundFor(index) {
    const b = IC.config.BACKGROUNDS;
    return b[((index % b.length) + b.length) % b.length];
  },

  // Name of a universe (1-based). Falls back to "Universe N" past the list.
  universeName(u) {
    const names = IC.config.UNIVERSE_NAMES;
    return names[u - 1] || ("Universe " + u);
  },

  // Big-number display: integers, then K / M / B, then scientific.
  formatNum(n) {
    if (!isFinite(n)) return "∞";
    n = Math.max(0, n);
    if (n < 1000) return String(Math.floor(n));
    if (n < 1e12) {
      const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
      for (const [v, s] of units) {
        if (n >= v) {
          const x = n / v;
          const str = x >= 100 ? String(Math.round(x)) : x.toFixed(x >= 10 ? 1 : 2);
          return str.replace(/\.?0+$/, "") + s;
        }
      }
    }
    const exp = Math.floor(Math.log10(n));
    return (n / Math.pow(10, exp)).toFixed(2) + "e" + exp;
  },
};

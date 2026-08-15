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

  // The nominal "value" of the board at level L — drives the reward and is the
  // 100%-HP reference. Grows smoothly per level AND jumps per universe.
  boardCost(level) {
    const c = IC.config;
    return c.HP_BASE * Math.pow(c.COST_GROWTH, level) * IC.economy.universeFactor(IC.economy.universeOfLevel(level));
  },

  // Per-universe brick-HP fraction (UNIVERSE_HP_PERCENT / 100). Only the HP is
  // scaled by this — the reward is always paid on the full nominal value. Each
  // listed universe is INDEPENDENT: beyond the list a universe defaults to 100%
  // (not the last entry), so tuning e.g. universe 4 never moves 5, 6, …
  hpPercentFor(u) {
    const arr = IC.config.UNIVERSE_HP_PERCENT || [];
    const pct = u < arr.length ? arr[u] : 100;
    return pct / 100;
  },

  // Actual HP to destroy on the board at level L (nominal value × the universe's
  // HP%). Lowering the % makes bricks break faster without changing the reward.
  boardHp(level) {
    return IC.economy.boardCost(level) * IC.economy.hpPercentFor(IC.economy.universeOfLevel(level));
  },

  // Shards awarded for clearing the whole board at level L — always on the full
  // nominal value, independent of the HP%.
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

  // Cost of the next Click Power upgrade — its own cheaper base, same growth.
  clickPowerCost(n) {
    const c = IC.config;
    return c.CLICK_POWER_BASE_COST * Math.pow(c.POWER_COST_GROWTH, n);
  },

  // Price of the next level-1 ball, given how many you have ever bought. The first
  // BALL_SALE_COUNT balls are discounted by BALL_SALE_OFF to soften the cold open.
  ballCost(bought) {
    const c = IC.config;
    const base = c.BALL_BASE_COST * Math.pow(c.BALL_COST_GROWTH, bought);
    return bought < (c.BALL_SALE_COUNT || 0) ? base * (1 - (c.BALL_SALE_OFF || 0)) : base;
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

  // Big-number display: one decimal under 10 (so 9.7 ≠ 9.9 to the player, and a
  // brick never reads "0" while still alive), integers to 1000, then K / M / B,
  // then scientific. Floored, never rounded up, so a value under a threshold never
  // displays as if it had reached it (e.g. 9.99 shows "9.9", not "10.0").
  formatNum(n) {
    if (!isFinite(n)) return "∞";
    n = Math.max(0, n);
    if (n < 10) return (Math.floor(n * 10) / 10).toFixed(1);
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

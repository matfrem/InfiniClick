/*
 * InfiniClick — board layout (shared geometry).
 *
 * Bricks live in a NORMALISED square play-field, FIELD × FIELD units. The balls
 * bounce inside that square; the brick grid uses the full width and sits at the
 * top, leaving the lower part open for the balls to roam. Nothing here knows
 * about pixels — the game scales this square onto the screen, and the simulator
 * measures it directly, so both agree on the exact same geometry regardless of
 * device or resolution. Change the grid here (or in config) and everything —
 * game, simulator, stats — follows.
 */
window.IC = window.IC || {};

IC.layout = {
  FIELD: 1000,                       // side of the square play-field, in units

  cols() { return IC.config.GRID_COLS; },
  rows() { return IC.config.GRID_ROWS; },

  // Square cell that makes the grid span the full width of the field.
  cell() { return IC.layout.FIELD / IC.config.GRID_COLS; },

  // Height the brick grid occupies (from the top of the field).
  gridHeight() { return IC.layout.rows() * IC.layout.cell(); },

  // Rect of the brick at row r, col c — in field units.
  brickRect(r, c) {
    const cell = IC.layout.cell();
    const pad = cell * 0.08;
    return { x: c * cell + pad, y: r * cell + pad, w: cell - pad * 2, h: cell - pad * 2 };
  },

  // Ball radius for a given tier (slightly bigger per tier), in field units.
  ballRadius(tier) {
    return IC.layout.cell() * 0.16 * (1 + (tier - 1) * 0.12);
  },

  // Ball speed, in field units per second.
  ballSpeed() { return IC.config.BALL_SPEED; },
};

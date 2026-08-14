/*
 * InfiniClick — board layout (shared geometry).
 *
 * Bricks live in a NORMALISED square play-field, FIELD × FIELD units. The balls
 * bounce inside that square; nothing here knows about pixels — the game scales
 * this square onto the screen, and the simulator measures it directly, so both
 * agree on the exact same geometry regardless of device or resolution.
 *
 * There are several LAYOUTS (grid, staggered, ring, pyramid), one assigned per
 * universe (cycling), so the board *shape* changes as you climb. Every layout
 * keeps the SAME block count (GRID_COLS × GRID_ROWS = 24) so the economy and the
 * clear-time metrics stay comparable — only the arrangement varies. `cells(i)`
 * returns that layout's 24 brick rects; `brickRect(r,c)` is the plain grid the
 * simulator still measures.
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

  // Rect of the brick at row r, col c — the plain grid (layout 0 / simulator).
  brickRect(r, c) {
    const cell = IC.layout.cell();
    const pad = cell * 0.08;
    return { x: c * cell + pad, y: r * cell + pad, w: cell - pad * 2, h: cell - pad * 2 };
  },

  // How many distinct layouts exist, and which one a universe (1-based) uses.
  LAYOUT_COUNT: 4,
  layoutForUniverse(u) {
    const n = IC.layout.LAYOUT_COUNT;
    return (((u - 1) % n) + n) % n;
  },

  // The 24 brick rects (field units) for a given layout index. All layouts yield
  // the same count (E.blocksPerBoard) so the metrics never move; only the shape
  // changes. Rects may fill any part of the square and vary in size.
  cells(layoutIndex) {
    const F = IC.layout.FIELD;
    const cols = IC.config.GRID_COLS, rows = IC.config.GRID_ROWS;
    const out = [];
    const push = (x, y, w, h) => out.push({ x, y, w, h });
    const sq = (cx, cy, s) => push(cx - s / 2, cy - s / 2, s, s);

    switch ((((layoutIndex % 4) + 4) % 4)) {
      // 1 — Staggered brick-wall: rows offset by half a cell, filling the top.
      case 1: {
        const cw = F / (cols + 0.5), ch = cw, pad = cw * 0.08, top = F * 0.05;
        for (let r = 0; r < rows; r++) {
          const off = (r % 2) * cw * 0.5;
          for (let c = 0; c < cols; c++) push(off + c * cw + pad, top + r * ch + pad, cw - 2 * pad, ch - 2 * pad);
        }
        break;
      }
      // 2 — Concentric rings: 16 outer + 8 inner around the centre, open middle.
      case 2: {
        const cx = F / 2, cy = F / 2;
        const rings = [{ n: 16, R: F * 0.37, s: F * 0.115 }, { n: 8, R: F * 0.19, s: F * 0.12 }];
        for (const ring of rings) {
          for (let i = 0; i < ring.n; i++) {
            const a = (i / ring.n) * Math.PI * 2 - Math.PI / 2;
            sq(cx + Math.cos(a) * ring.R, cy + Math.sin(a) * ring.R, ring.s);
          }
        }
        break;
      }
      // 3 — Centred pyramid: rows of 3, 5, 7, 9 widening downward (24 total).
      case 3: {
        const lens = [3, 5, 7, 9];
        const cw = F / 9.8, pad = cw * 0.08, rowH = cw * 1.12, top = F * 0.08, cx = F / 2;
        for (let r = 0; r < lens.length; r++) {
          const n = lens[r], x0 = cx - (n * cw) / 2;
          for (let c = 0; c < n; c++) push(x0 + c * cw + pad, top + r * rowH + pad, cw - 2 * pad, cw - 2 * pad);
        }
        break;
      }
      // 0 — Plain grid (the simulator's reference layout).
      default: {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const b = IC.layout.brickRect(r, c);
          push(b.x, b.y, b.w, b.h);
        }
      }
    }
    return out;
  },

  // Ball radius for a given tier (slightly bigger per tier), in field units.
  ballRadius(tier) {
    return IC.layout.cell() * 0.16 * (1 + (tier - 1) * 0.12);
  },

  // Ball speed, in field units per second.
  ballSpeed() { return IC.config.BALL_SPEED; },
};

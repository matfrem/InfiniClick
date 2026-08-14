/*
 * InfiniClick — a zen infinite clicker inspired by ZenShards.
 *
 * The world is a fractal. Every board is one block of the board above it, and
 * every block hides a whole board of its own. You clear a board, zoom out one
 * notch to reveal the meta-board it lived inside (the block you just finished is
 * now destroyed), watch the balls drift across the meta-board, dive into the
 * next block, and clear the board waiting there. Finish a whole meta-board and
 * you ascend to the next universe.
 *
 * Difficulty is one smooth exponential in a global level index: each board costs
 * `HP_BASE * COST_GROWTH^level` in HP, split across its blocks by weight — so the
 * number or shape of the blocks can change freely without moving the metrics.
 * All those knobs live in config.js; the formulas live in economy.js. Both are
 * shared with the stats dashboard (stats.html).
 *
 * Only two boards are ever loaded at once — the one you play and its parent — so
 * the infinite stack costs nothing to keep alive.
 */
(() => {
  "use strict";

  const C = window.IC.config;
  const E = window.IC.economy;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------
  // Game state (persisted)
  //
  //  - `level`    : the global level index L. Every board you clear bumps it by
  //                 one, and it drives boardCost / boardReward. It never resets.
  //  - `universe` : how many universes you have finished (shown as "Meta"); it is
  //                 the cosmetic grouping / palette selector and only advances on
  //                 ascension.
  //  - `ballsBought` : total level-1 balls ever bought, which prices the next one.
  // ---------------------------------------------------------------------------
  const DEFAULT_STATE = () => ({
    fragments: 0,
    level: 0,
    universe: 1,
    ballCounts: { 1: 1 }, // tier -> number of balls owned
    ballsBought: 0,
  });

  const state = DEFAULT_STATE();

  // ---------------------------------------------------------------------------
  // Runtime-only data (not persisted). Only two boards ever exist: `board` (on
  // screen) and `parent` (the meta-board it lives inside, or null while hunting).
  // ---------------------------------------------------------------------------
  const runtime = {
    board: null,        // { blocks, portalIndex, universe } — active, full-screen
    parent: null,       // the meta-board above, or null
    phase: "play",      // "play" | "hunt" | "zoomOut" | "zoomIn" | "ascend"
    anim: null,         // active zoom transition
    interlude: null,    // active "upper universe" screen
    pending: null,      // board to reveal once the interlude ends
    huntGrace: 0,       // countdown before balls may dive into a meta block

    balls: [],
    particles: [],
    floaters: [],
    announce: null,

    cols: 0,
    rows: 0,
    cell: 0,
    marginX: 0,
    marginTop: 0,
    fragTimestamps: [],
  };

  // ---------------------------------------------------------------------------
  // Canvas setup
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutGrid();
  }

  // ---------------------------------------------------------------------------
  // Grid geometry. The block COUNT is fixed (the mobile layout) on every device
  // so the metrics never depend on screen size; only the cell scales to fit.
  // The grid sits in the upper half so the balls have room to roam below it.
  // ---------------------------------------------------------------------------
  function layoutGrid() {
    const cols = C.GRID_COLS;
    const rows = C.GRID_ROWS;
    const cell = Math.max(24, Math.min(C.CELL_MAX, Math.floor(W / cols), Math.floor((H * 0.5) / rows)));

    runtime.cols = cols;
    runtime.rows = rows;
    runtime.cell = cell;
    runtime.marginX = (W - cols * cell) / 2;
    runtime.marginTop = cell * 0.5;

    if (!runtime.board) ensureBoards(true);
  }

  function blockRect(r, c) {
    const pad = runtime.cell * 0.08;
    return {
      x: runtime.marginX + c * runtime.cell + pad,
      y: runtime.marginTop + r * runtime.cell + pad,
      w: runtime.cell - pad * 2,
      h: runtime.cell - pad * 2,
    };
  }

  function cellRectOf(board, index) {
    const b = board.blocks[index];
    return blockRect(b.r, b.c);
  }

  // Build a whole board for the given global level and universe. The board's
  // total HP cost (from economy.boardCost) is split across the blocks by weight,
  // and its total shard reward the same way, so both are independent of how many
  // blocks there happen to be.
  function makeBoard(level, universe) {
    const cost = E.boardCost(level);
    const reward = E.boardReward(level);

    // Random per-block weights (with a gentle bottom-heavier bias) that still sum
    // to the board's cost — so blocks start visibly different but the total HP
    // (the metric) is unchanged no matter the grid or randomness.
    const cells = [];
    for (let r = 0; r < runtime.rows; r++) {
      for (let c = 0; c < runtime.cols; c++) {
        cells.push({ r, c, w: 0.55 + r * 0.12 + Math.random() * 0.9 });
      }
    }
    const sum = cells.reduce((a, b) => a + b.w, 0) || 1;

    const blocks = cells.map((cell) => {
      const share = cell.w / sum;
      const hp = cost * share;
      return {
        r: cell.r,
        c: cell.c,
        hp,
        maxHp: hp,
        reward: reward * share,
        hit: 0,
        alive: true,
      };
    });
    const maxBlockHp = blocks.reduce((m, b) => Math.max(m, b.maxHp), 0) || 1;
    return { blocks, portalIndex: null, universe, maxBlockHp };
  }

  // A block's colour tracks its REMAINING HP within the universe's palette, so a
  // tough/fresh brick and a nearly-broken one read differently, and the varied
  // starting HP already spreads the fresh board across the palette.
  function blockColor(board, block) {
    const pal = E.paletteFor(board.universe);
    const ratio = clamp01(block.hp / board.maxBlockHp);
    const idx = Math.round((1 - ratio) * (pal.length - 1));
    return pal[clamp(idx, 0, pal.length - 1)];
  }

  function pickPortal(board) {
    const alive = [];
    board.blocks.forEach((b, i) => { if (b.alive) alive.push(i); });
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : 0;
  }

  function boardCleared(board) {
    return board.blocks.length > 0 && board.blocks.every((b) => !b.alive);
  }

  // (Re)create the starting pair of boards: the meta-board of the current
  // universe and the fresh sub-board we clear inside one of its blocks.
  function ensureBoards(force) {
    if (!force && runtime.board) return;
    runtime.parent = makeBoard(state.level, state.universe);
    runtime.parent.portalIndex = pickPortal(runtime.parent);
    runtime.board = makeBoard(state.level, state.universe);
    runtime.phase = "play";
    runtime.anim = null;
    runtime.interlude = null;
    runtime.pending = null;
    runtime.huntGrace = 0;
    placeBalls(W / 2, H * 0.7, Math.min(W, H) * 0.3);
  }

  // ---------------------------------------------------------------------------
  // Balls (tiered: a tier-T ball deals economy.ballDamage(T))
  // ---------------------------------------------------------------------------
  function ballRadius(tier) {
    return Math.max(7, runtime.cell * 0.16) * (1 + (tier - 1) * 0.12);
  }

  function ballDamageOf(ball) {
    return E.ballDamage(ball.level);
  }

  function makeBall(tier) {
    const angle = Math.random() * TAU;
    return {
      x: W / 2,
      y: H * 0.75,
      vx: Math.cos(angle) * C.BALL_SPEED,
      vy: -Math.abs(Math.sin(angle)) * C.BALL_SPEED - 60,
      r: ballRadius(tier),
      level: tier,
    };
  }

  function syncBalls() {
    const desired = [];
    Object.keys(state.ballCounts)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach((lvl) => {
        for (let i = 0; i < state.ballCounts[lvl]; i++) desired.push(lvl);
      });
    if (desired.length > C.MAX_BALLS) desired.length = C.MAX_BALLS;
    if (desired.length === 0) desired.push(1);

    while (runtime.balls.length < desired.length) runtime.balls.push(makeBall(1));
    runtime.balls.length = desired.length;
    for (let i = 0; i < desired.length; i++) {
      runtime.balls[i].level = desired[i];
      runtime.balls[i].r = ballRadius(desired[i]);
    }
  }

  function placeBalls(cx, cy, spread) {
    for (const b of runtime.balls) {
      const a = Math.random() * TAU;
      const rr = Math.random() * spread * 0.5;
      b.x = clamp(cx + Math.cos(a) * rr, b.r, Math.max(b.r, W - b.r));
      b.y = clamp(cy + Math.sin(a) * rr, b.r, Math.max(b.r, H - b.r));
      const va = Math.random() * TAU;
      b.vx = Math.cos(va) * C.BALL_SPEED;
      b.vy = Math.sin(va) * C.BALL_SPEED;
    }
  }

  function ballCount1() { return state.ballCounts[1] || 0; }

  // Merge MERGE_REQUIRED balls of `tier` into one ball of `tier + 1`.
  function mergeBalls(tier) {
    const count = state.ballCounts[tier] || 0;
    if (count < C.MERGE_REQUIRED) return;
    state.ballCounts[tier] = count - C.MERGE_REQUIRED;
    if (state.ballCounts[tier] === 0) delete state.ballCounts[tier];
    state.ballCounts[tier + 1] = (state.ballCounts[tier + 1] || 0) + 1;
    syncBalls();
    save();
    renderBallBar();
    renderShop();  // capping level-1 balls may have unlocked buying again
    updateHud();
  }

  // ---------------------------------------------------------------------------
  // Shard economy
  // ---------------------------------------------------------------------------
  function breakBlock(block) {
    block.alive = false;
    state.fragments += block.reward;
    runtime.fragTimestamps.push(performance.now());

    const rect = blockRect(block.r, block.c);
    spawnParticles(rect.x + rect.w / 2, rect.y + rect.h / 2, blockColor(runtime.board, block));
    runtime.floaters.push({
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
      text: "+" + E.formatNum(block.reward),
      life: 1,
      color: "#ffcf6b",
      size: 16,
    });
    updateHud();
  }

  function damageBlock(block, dmg, cx, cy) {
    if (!block.alive) return;
    block.hp -= dmg;
    block.hit = 1;
    spawnParticles(cx, cy, blockColor(runtime.board, block), 4);
    runtime.floaters.push({
      x: cx,
      y: cy - 6,
      text: "-" + E.formatNum(dmg),
      life: 0.7,
      color: "#ffffff",
      size: 13,
    });
    if (block.hp <= 0) breakBlock(block);
  }

  // ---------------------------------------------------------------------------
  // Zoom transitions & universe ascension
  // ---------------------------------------------------------------------------
  function startZoomOut() {
    const meta = runtime.parent;
    runtime.anim = { kind: "out", t: 0, meta, child: runtime.board, cellIndex: meta.portalIndex };
    runtime.phase = "zoomOut";
  }

  function completeZoomOut() {
    const { meta, cellIndex } = runtime.anim;
    meta.blocks[cellIndex].alive = false; // the block we just cleared

    state.level += 1;                      // one more level down the fractal

    runtime.board = meta;
    runtime.parent = null;
    runtime.anim = null;
    runtime.phase = "hunt";
    runtime.huntGrace = C.HUNT_GRACE;

    const rc = cellRectOf(meta, cellIndex);
    placeBalls(rc.x + rc.w / 2, rc.y + rc.h / 2, Math.max(rc.w, rc.h));
    save();
    updateHud();
  }

  function startZoomIn(index) {
    const child = makeBoard(state.level, state.universe);
    runtime.anim = { kind: "in", t: 0, meta: runtime.board, child, cellIndex: index };
    runtime.phase = "zoomIn";
  }

  function completeZoomIn() {
    const { meta, child, cellIndex } = runtime.anim;
    runtime.parent = meta;
    runtime.parent.portalIndex = cellIndex;
    runtime.board = child;
    runtime.anim = null;
    runtime.phase = "play";
    placeBalls(W / 2, H * 0.5, Math.min(W, H) * 0.3);
  }

  function startAscension() {
    const bonus = E.ascendBonus(state.level);
    state.fragments += bonus;
    state.universe += 1;

    const meta = makeBoard(state.level, state.universe);
    const portal = pickPortal(meta);
    meta.blocks[portal].alive = false;
    runtime.pending = { meta, portal };

    runtime.interlude = { life: C.ASCEND_DUR, total: C.ASCEND_DUR, name: E.universeName(state.universe) };
    runtime.phase = "ascend";
    save();
    updateHud();
  }

  function completeAscension() {
    const { meta, portal } = runtime.pending;
    runtime.board = meta;
    runtime.parent = null;
    runtime.pending = null;
    runtime.interlude = null;
    runtime.phase = "hunt";
    runtime.huntGrace = C.HUNT_GRACE;

    const rc = cellRectOf(meta, portal);
    placeBalls(rc.x + rc.w / 2, rc.y + rc.h / 2, Math.max(rc.w, rc.h));
  }

  // ---------------------------------------------------------------------------
  // Particles & juice
  // ---------------------------------------------------------------------------
  function spawnParticles(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 160;
      runtime.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4,
        max: 0.9,
        color,
        size: 1 + Math.random() * 3,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Physics: circle vs axis-aligned block, resolved per axis. Returns the block
  // index it touched (or -1) so the hunt phase can decide to dive in.
  // ---------------------------------------------------------------------------
  function ballHitsBlock(ball, doDamage) {
    const blocks = runtime.board.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block.alive) continue;
      const rect = blockRect(block.r, block.c);
      const nearestX = clamp(ball.x, rect.x, rect.x + rect.w);
      const nearestY = clamp(ball.y, rect.y, rect.y + rect.h);
      const dx = ball.x - nearestX;
      const dy = ball.y - nearestY;
      if (dx * dx + dy * dy <= ball.r * ball.r) {
        const overlapX = ball.r - Math.abs(dx);
        const overlapY = ball.r - Math.abs(dy);
        if (overlapX < overlapY) {
          ball.vx = -ball.vx;
          ball.x += ball.vx > 0 ? overlapX : -overlapX;
        } else {
          ball.vy = -ball.vy;
          ball.y += ball.vy > 0 ? overlapY : -overlapY;
        }
        if (doDamage) damageBlock(block, ballDamageOf(ball), nearestX, nearestY);
        return i;
      }
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------------
  function update(dt) {
    if (runtime.phase === "ascend") { updateAscension(dt); return; }

    if (runtime.phase === "play") updatePlay(dt);
    else if (runtime.phase === "hunt") updateHunt(dt);
    else updateZoom(dt);

    updateEffects(dt);
  }

  function moveBallsInWalls(dt) {
    for (const ball of runtime.balls) {
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
      if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
      if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
      if (ball.y + ball.r > H) { ball.y = H - ball.r; ball.vy = -Math.abs(ball.vy); }
    }
  }

  function updatePlay(dt) {
    moveBallsInWalls(dt);
    for (const ball of runtime.balls) ballHitsBlock(ball, true);
    if (boardCleared(runtime.board)) startZoomOut();
  }

  function updateHunt(dt) {
    if (boardCleared(runtime.board)) { startAscension(); return; }

    moveBallsInWalls(dt);

    let dive = -1;
    const canDive = runtime.huntGrace <= 0;
    for (const ball of runtime.balls) {
      const hit = ballHitsBlock(ball, false);
      if (canDive && hit >= 0 && dive < 0) dive = hit;
    }
    runtime.huntGrace -= dt;
    if (dive >= 0) startZoomIn(dive);
  }

  function updateZoom(dt) {
    const a = runtime.anim;
    a.t += dt / C.ZOOM_DUR;
    if (a.t >= 1) {
      if (a.kind === "out") completeZoomOut();
      else completeZoomIn();
    }
  }

  function updateAscension(dt) {
    const it = runtime.interlude;
    it.life -= dt;
    if (it.life <= 0) completeAscension();
  }

  function updateEffects(dt) {
    for (const block of runtime.board.blocks) {
      if (block.hit > 0) block.hit = Math.max(0, block.hit - dt * 6);
    }

    if (runtime.announce) {
      runtime.announce.life -= dt;
      if (runtime.announce.life <= 0) runtime.announce = null;
    }

    for (let i = runtime.particles.length - 1; i >= 0; i--) {
      const p = runtime.particles[i];
      p.life -= dt;
      if (p.life <= 0) { runtime.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.vx *= 0.98;
    }

    for (let i = runtime.floaters.length - 1; i >= 0; i--) {
      const f = runtime.floaters[i];
      f.life -= dt;
      f.y -= 26 * dt;
      if (f.life <= 0) runtime.floaters.splice(i, 1);
    }

    const cutoff = performance.now() - 1000;
    while (runtime.fragTimestamps.length && runtime.fragTimestamps[0] < cutoff) {
      runtime.fragTimestamps.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const FULL_RECT = () => ({ x: 0, y: 0, w: W, h: H });

  function cellFillRect(cell) {
    const sx = W / cell.w;
    const sy = H / cell.h;
    return { x: -cell.x * sx, y: -cell.y * sy, w: W * sx, h: H * sy };
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    if (runtime.phase === "ascend") { drawInterlude(runtime.interlude); return; }

    if (runtime.phase === "play" || runtime.phase === "hunt") {
      const hint = runtime.phase === "hunt";
      drawBoard(runtime.board, FULL_RECT(), 1, true, hint);
      drawParticles();
      drawFloaters();
    } else {
      const a = runtime.anim;
      const cell = cellRectOf(a.meta, a.cellIndex);
      const e = smoothstep(clamp01(a.t));
      const full = FULL_RECT();
      const zoomed = cellFillRect(cell);

      if (a.kind === "out") {
        drawBoard(a.meta, lerpRect(zoomed, full, e), clamp01(e * 1.6), false, true);
        drawBoard(a.child, lerpRect(full, cell, e), clamp01((1 - e) * 1.6), true, false);
      } else {
        drawBoard(a.meta, lerpRect(full, zoomed, e), clamp01((1 - e) * 1.6), true, false);
        drawBoard(a.child, lerpRect(cell, full, e), clamp01(e * 1.6), false, false);
      }
    }

    drawAnnounce();
  }

  function drawBoard(board, dest, alpha, withBalls, portalHint) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    ctx.translate(dest.x, dest.y);
    ctx.scale(dest.w / W, dest.h / H);
    drawBlocks(board, alpha, portalHint);
    if (withBalls) drawBalls(alpha);
    ctx.restore();
  }

  function drawBlocks(board, baseAlpha, portalHint) {
    const pulse = portalHint ? 0.5 + 0.5 * Math.sin(performance.now() / 260) : 0;
    for (const block of board.blocks) {
      if (!block.alive) continue;
      const rect = blockRect(block.r, block.c);
      const hpRatio = block.hp / block.maxHp;
      const r = Math.min(10, rect.w * 0.18);

      const col = blockColor(board, block);
      ctx.save();
      ctx.globalAlpha = baseAlpha * (0.35 + 0.65 * hpRatio);
      roundRect(rect.x, rect.y, rect.w, rect.h, r);
      const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      grad.addColorStop(0, col);
      grad.addColorStop(1, shade(col, -0.35));
      ctx.fillStyle = grad;
      ctx.fill();

      if (block.hit > 0) {
        ctx.globalAlpha = baseAlpha * block.hit * 0.7;
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      ctx.restore();

      if (portalHint) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * (0.25 + 0.4 * pulse);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        roundRect(rect.x, rect.y, rect.w, rect.h, r);
        ctx.stroke();
        ctx.restore();
      }

      if (hpRatio < 1) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * (1 - hpRatio) * 0.5;
        ctx.strokeStyle = "#0d1117";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rect.x + rect.w * 0.3, rect.y);
        ctx.lineTo(rect.x + rect.w * 0.5, rect.y + rect.h * 0.6);
        ctx.lineTo(rect.x + rect.w * 0.35, rect.y + rect.h);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.fillStyle = "#0d1117";
        ctx.font = `800 ${Math.round(rect.h * 0.32)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(E.formatNum(block.hp), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        ctx.restore();
      }
    }
  }

  function drawBalls(baseAlpha) {
    for (const ball of runtime.balls) {
      const color = C.BALL_COLORS[(ball.level - 1) % C.BALL_COLORS.length];
      const g = ctx.createRadialGradient(
        ball.x - ball.r * 0.3, ball.y - ball.r * 0.3, ball.r * 0.2,
        ball.x, ball.y, ball.r
      );
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, color);
      ctx.globalAlpha = baseAlpha;
      ctx.fillStyle = g;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (ball.level > 1) {
        ctx.fillStyle = "#0d1117";
        ctx.font = `800 ${Math.round(ball.r)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(ball.level), ball.x, ball.y + 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of runtime.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const f of runtime.floaters) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.font = `700 ${f.size || 15}px Inter, system-ui, sans-serif`;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawAnnounce() {
    if (!runtime.announce) return;
    const a = runtime.announce;
    ctx.save();
    ctx.globalAlpha = Math.min(1, a.life * 1.4);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#56d3c9";
    ctx.font = "800 34px Inter, system-ui, sans-serif";
    ctx.fillText(a.text, W / 2, H * 0.36);
    if (a.sub) {
      ctx.fillStyle = "#ffcf6b";
      ctx.font = "700 18px Inter, system-ui, sans-serif";
      ctx.fillText(a.sub, W / 2, H * 0.36 + 32);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawInterlude(it) {
    const now = performance.now() / 1000;
    const p = clamp01(1 - it.life / it.total);
    let a = 1;
    if (it.life > it.total - 0.4) a = (it.total - it.life) / 0.4;
    else if (it.life < 0.4) a = it.life / 0.4;
    a = clamp01(a);

    const cx = W / 2, cy = H * 0.42;
    const R = Math.min(W, H);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, W, H);

    for (let k = 0; k < 3; k++) {
      const rp = (now * 0.5 + k / 3) % 1;
      ctx.globalAlpha = a * (1 - rp) * 0.5;
      ctx.strokeStyle = "#8a7dff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rp * R * 0.42, 0, TAU);
      ctx.stroke();
    }

    const pr = R * 0.05 * (1 + 0.18 * Math.sin(now * 4));
    const orb = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr * 2.4);
    orb.addColorStop(0, "#ffffff");
    orb.addColorStop(0.5, "#8a7dff");
    orb.addColorStop(1, "rgba(138,125,255,0)");
    ctx.globalAlpha = a;
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 2.4, 0, TAU);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = "#8b98a5";
    ctx.font = "700 14px Inter, system-ui, sans-serif";
    ctx.fillText("ACCESSING UPPER UNIVERSE", cx, cy + R * 0.2);

    const dots = ".".repeat(1 + Math.floor((now * 2) % 3));
    ctx.globalAlpha = a;
    ctx.fillStyle = "#56d3c9";
    ctx.font = "800 30px Inter, system-ui, sans-serif";
    ctx.fillText(it.name.toUpperCase() + " " + dots, cx, cy + R * 0.2 + 34);

    const bw = Math.min(W * 0.5, 320), bh = 6;
    const bx = cx - bw / 2, by = cy + R * 0.2 + 64;
    ctx.globalAlpha = a * 0.3;
    ctx.fillStyle = "#223041";
    roundRect(bx, by, bw, bh, 3);
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.fillStyle = "#56d3c9";
    roundRect(bx, by, bw * p, bh, 3);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Canvas & math helpers
  // ---------------------------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpRect(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      w: lerp(a.w, b.w, t),
      h: lerp(a.h, b.h, t),
    };
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp(Math.round(r + r * amt), 0, 255);
    g = clamp(Math.round(g + g * amt), 0, 255);
    b = clamp(Math.round(b + b * amt), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  // ---------------------------------------------------------------------------
  // Input: click / tap
  // ---------------------------------------------------------------------------
  function onPointer(clientX, clientY) {
    if (runtime.phase !== "play" && runtime.phase !== "hunt") return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    for (let i = 0; i < runtime.board.blocks.length; i++) {
      const block = runtime.board.blocks[i];
      if (!block.alive) continue;
      const b = blockRect(block.r, block.c);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (runtime.phase === "play") damageBlock(block, E.ballDamage(1), x, y);
        else startZoomIn(i);
        hideHint();
        return;
      }
    }
  }

  canvas.addEventListener("pointerdown", (e) => onPointer(e.clientX, e.clientY));

  // Intro overlay — shown only on a brand-new game (or after a reset), naming the
  // universe you begin inside (a Quark) and how to play.
  const introEl = document.getElementById("intro");
  function showIntro() {
    const name = E.universeName(state.universe);
    introEl.querySelector(".intro-name").textContent = name;
    introEl.querySelector(".intro-body").textContent =
      `the smallest speck there is. Shatter every brick to zoom out and discover what contains it.`;
    introEl.classList.remove("hidden");
  }
  function hideIntro() { introEl.classList.add("hidden"); }
  if (introEl) introEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); hideIntro(); });

  let hintHidden = false;
  function hideHint() {
    if (hintHidden) return;
    hintHidden = true;
    const hint = document.getElementById("hint");
    hint.style.opacity = "0";
    setTimeout(() => (hint.style.display = "none"), 700);
  }

  // ---------------------------------------------------------------------------
  // Shop — buying level-1 balls (the only purchase for now; merging is in the
  // ball banner). Everything else is derived from balls + merges.
  // ---------------------------------------------------------------------------
  const shopEl = document.getElementById("upgrades");

  function buyBall() {
    if (ballCount1() >= C.LEVEL1_CAP) return;
    const cost = E.ballCost(state.ballsBought);
    if (state.fragments < cost) return;
    state.fragments -= cost;
    state.ballsBought += 1;
    state.ballCounts[1] = (state.ballCounts[1] || 0) + 1;
    syncBalls();
    save();
    renderShop();
    renderBallBar();
    updateHud();
  }

  function renderShop() {
    shopEl.innerHTML = "";
    const count = ballCount1();
    const capped = count >= C.LEVEL1_CAP;
    const cost = E.ballCost(state.ballsBought);
    const affordable = !capped && state.fragments >= cost;

    const btn = document.createElement("button");
    btn.className = "upgrade" + (affordable ? " affordable" : "");
    btn.disabled = !affordable;
    btn.innerHTML = `
      <div class="u-head">
        <span class="u-name">Extra Ball</span>
        <span class="u-level">${count} / ${C.LEVEL1_CAP}</span>
      </div>
      <div class="u-desc">A level-1 ball dealing ${E.formatNum(E.ballDamage(1))} damage. Merge ten into a stronger one.</div>
      <div class="u-cost">${capped ? "Max 10 — merge them" : E.formatNum(cost)}</div>
    `;
    btn.addEventListener("click", buyBall);
    shopEl.appendChild(btn);
  }

  function refreshShop() {
    const card = shopEl.firstElementChild;
    if (!card) return;
    const capped = ballCount1() >= C.LEVEL1_CAP;
    const affordable = !capped && state.fragments >= E.ballCost(state.ballsBought);
    card.disabled = !affordable;
    card.classList.toggle("affordable", affordable);
  }

  // ---------------------------------------------------------------------------
  // Ball banner: per-tier counts + merge buttons.
  // ---------------------------------------------------------------------------
  const ballbarEl = document.getElementById("ballbar");

  function renderBallBar() {
    ballbarEl.innerHTML = "";
    const tiers = Object.keys(state.ballCounts)
      .map(Number)
      .filter((l) => state.ballCounts[l] > 0)
      .sort((a, b) => a - b);

    for (const tier of tiers) {
      const count = state.ballCounts[tier];
      const color = C.BALL_COLORS[(tier - 1) % C.BALL_COLORS.length];

      const chip = document.createElement("div");
      chip.className = "ballchip";
      chip.innerHTML = `
        <span class="dot" style="background:${color}; color:${color}"></span>
        <span class="lv">Lv ${tier}</span>
        <span class="ct">×${count}</span>
      `;

      if (count >= C.MERGE_REQUIRED) {
        const btn = document.createElement("button");
        btn.className = "merge";
        btn.textContent = `Merge 10 → Lv ${tier + 1}`;
        btn.addEventListener("click", () => mergeBalls(tier));
        chip.appendChild(btn);
      }
      ballbarEl.appendChild(chip);
    }
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const fragEl = document.getElementById("fragments");
  const fpsEl = document.getElementById("fps");
  const boardEl = document.getElementById("board");

  // "2.4" = universe 2, four levels deep into it.
  function metaLabel() {
    const per = E.blocksPerBoard();
    const sub = clamp(state.level - (state.universe - 1) * per, 0, per);
    return state.universe + "." + sub;
  }

  function updateHud() {
    fragEl.textContent = E.formatNum(state.fragments);
    if (boardEl) boardEl.textContent = metaLabel();
    refreshShop();
  }

  // Debug: clicking the game title doubles your shards.
  const brandEl = document.querySelector(".brand");
  if (brandEl) {
    brandEl.style.cursor = "pointer";
    brandEl.title = "Debug: double your shards";
    brandEl.addEventListener("click", () => {
      state.fragments = Math.max(1, state.fragments) * 2;
      save();
      updateHud();
    });
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(C.SAVE_KEY, JSON.stringify({
        fragments: state.fragments,
        level: state.level,
        universe: state.universe,
        ballCounts: state.ballCounts,
        ballsBought: state.ballsBought,
      }));
    } catch (_) { /* storage unavailable — play unsaved */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(C.SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      Object.assign(state, {
        fragments: data.fragments ?? 0,
        level: data.level ?? 0,
        universe: data.universe ?? 1,
        ballsBought: data.ballsBought ?? 0,
      });
      if (data.ballCounts && Object.keys(data.ballCounts).length) {
        state.ballCounts = {};
        for (const k of Object.keys(data.ballCounts)) state.ballCounts[k] = data.ballCounts[k];
      }
    } catch (_) { /* corrupt save — start fresh */ }
  }

  function resetGame() {
    try { localStorage.removeItem(C.SAVE_KEY); } catch (_) {}

    Object.assign(state, DEFAULT_STATE());

    runtime.balls.length = 0;
    runtime.particles.length = 0;
    runtime.floaters.length = 0;
    runtime.announce = null;
    runtime.parent = null;
    runtime.board = null;
    runtime.anim = null;
    runtime.interlude = null;
    runtime.pending = null;
    runtime.phase = "play";
    runtime.huntGrace = 0;

    syncBalls();
    ensureBoards(true);
    renderShop();
    renderBallBar();
    updateHud();
    save();
    showIntro();
  }

  document.getElementById("reset").addEventListener("click", () => {
    if (!confirm("Reset all progress?")) return;
    resetGame();
  });

  setInterval(save, 5000);
  window.addEventListener("beforeunload", save);

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let last = performance.now();
  let hudTimer = 0;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    update(dt);
    render();

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      fpsEl.textContent = runtime.fragTimestamps.length;
    }

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function init() {
    load();
    resize();
    syncBalls();
    renderShop();
    renderBallBar();
    updateHud();
    // Greet new players (fresh game only, not every reload).
    if (state.level === 0 && state.universe === 1 && state.ballsBought === 0) showIntro();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    requestAnimationFrame((t) => { last = t; frame(t); });
  }

  init();
})();

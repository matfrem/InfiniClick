/*
 * InfiniClick — a zen infinite clicker inspired by ZenShards.
 *
 * The world is a fractal. Every board is one block of the board above it, and
 * every block hides a whole board of its own. You clear a board, zoom out one
 * notch to reveal the meta-board it lived inside (the block you just finished is
 * now destroyed), watch the balls drift to the next block, zoom into it, and
 * clear the board waiting there. The loop never ends — it only nests.
 *
 * Balls come in levels: ten balls of a level can be merged into one stronger
 * ball of the next level. Breaking blocks scatters shards you spend on upgrades.
 *
 * Only two boards are ever loaded at once — the one you are playing and its
 * immediate parent — so the infinite stack costs nothing to keep alive.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constants & palette
  // ---------------------------------------------------------------------------
  const SAVE_KEY = "infiniclick.save.v1";
  const BLOCK_COLORS = ["#56d3c9", "#8a7dff", "#ffcf6b", "#ff8fab", "#7bd88f"];
  const BALL_COLORS = ["#56d3c9", "#8a7dff", "#ffcf6b", "#ff8fab", "#7bd88f", "#f5f5f5"];
  const TAU = Math.PI * 2;
  const MERGE_REQUIRED = 10;   // balls of level N needed to make one level N+1
  const MAX_BALLS = 60;        // hard cap on simultaneous balls (performance)
  const ZOOM_DUR = 0.55;       // seconds a zoom transition lasts
  const HUNT_GRACE = 0.18;     // seconds balls drift before they can enter a block
  const BALL_SPEED = 190;      // base ball speed in px/s

  // ---------------------------------------------------------------------------
  // Upgrade definitions. Each has a base cost that scales geometrically.
  // ---------------------------------------------------------------------------
  const UPGRADES = [
    {
      id: "damage",
      name: "Ball Power",
      desc: "+1 damage per bounce.",
      baseCost: 15,
      growth: 1.6,
      apply: (s) => { s.ballDamage += 1; },
    },
    {
      id: "click",
      name: "Sharp Finger",
      desc: "+1 damage per click.",
      baseCost: 20,
      growth: 1.55,
      apply: (s) => { s.clickDamage += 1; },
    },
    {
      id: "speed",
      name: "Momentum",
      desc: "Balls move 8% faster.",
      baseCost: 30,
      growth: 1.5,
      max: 25,
      apply: (s) => { s.speedMul *= 1.08; },
    },
    {
      id: "ball",
      name: "Extra Ball",
      desc: "Add a level-1 ball.",
      baseCost: 120,
      growth: 1.9,
      apply: (s) => { s.ballCounts[1] = (s.ballCounts[1] || 0) + 1; },
    },
    {
      id: "yield",
      name: "Precious Shards",
      desc: "+50% shards per block broken.",
      baseCost: 80,
      growth: 1.7,
      apply: (s) => { s.yieldMul += 0.5; },
    },
  ];

  // ---------------------------------------------------------------------------
  // Game state (persisted)
  // ---------------------------------------------------------------------------
  const DEFAULT_STATE = () => ({
    fragments: 0,
    board: 1,          // monotonic depth counter (drives difficulty & rewards)
    ballDamage: 1,     // base damage a level-1 ball deals per bounce
    clickDamage: 1,
    speedMul: 1,
    yieldMul: 1,
    ballCounts: { 1: 1 }, // level -> number of balls owned
    levels: {},           // upgradeId -> purchased count
  });

  const state = DEFAULT_STATE();
  UPGRADES.forEach((u) => (state.levels[u.id] = 0));

  // ---------------------------------------------------------------------------
  // Runtime-only data (not persisted)
  //
  // Only two boards ever exist: `board` (the one on screen, full size) and
  // `parent` (the meta-board it lives inside). `parent.portalIndex` is the block
  // in the parent that we entered through — the one destroyed when we zoom back
  // out. During the "hunt" phase `board` IS the meta-board and `parent` is null;
  // the grandparent is generated on the fly only if we need to climb again.
  // ---------------------------------------------------------------------------
  const runtime = {
    board: null,        // { blocks, portalIndex } — active, full-screen board
    parent: null,       // { blocks, portalIndex } — the meta-board above, or null
    phase: "play",      // "play" | "hunt" | "zoomOut" | "zoomIn"
    anim: null,         // active zoom transition, see startZoom* below
    huntGrace: 0,       // countdown before balls may enter a block while hunting

    balls: [],
    particles: [],
    floaters: [],       // floating "+N" / "-N" texts
    announce: null,     // central banner (e.g. "Board 3")

    cols: 0,
    rows: 0,
    cell: 0,
    marginX: 0,
    marginTop: 0,
    fragTimestamps: [], // for the "shards/s" readout
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
  // Grid geometry. Every board shares the same layout because every board is
  // drawn full-screen (the zoom is a camera effect, not a change in grid size).
  // ---------------------------------------------------------------------------
  function layoutGrid() {
    const target = 56;                       // desired block size in px
    const cols = Math.max(6, Math.floor(W / target));
    const cell = Math.min(72, Math.floor(W / cols));
    const rows = Math.max(4, Math.floor((H * 0.55) / cell));

    // Only rebuild when the COLUMN count changes (width / rotation). Ignoring
    // height changes avoids wiping the board when the mobile URL bar shows/hides.
    const colsChanged = cols !== runtime.cols;
    runtime.cols = cols;
    runtime.rows = rows;
    runtime.cell = cell;
    runtime.marginX = (W - cols * cell) / 2;
    runtime.marginTop = cell * 0.6;

    if (!runtime.board || colsChanged) ensureBoards(true);
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

  // Screen rect of a block, addressed by its index inside a board.
  function cellRectOf(board, index) {
    const b = board.blocks[index];
    return blockRect(b.r, b.c);
  }

  function makeBlock(r, c) {
    // Lower rows are a bit tougher, and every depth level adds HP: a gentle but
    // endless ramp.
    const maxHp = 2 + Math.floor(r / 2) + Math.floor(Math.random() * 2) + (state.board - 1);
    return {
      r, c,
      hp: maxHp,
      maxHp,
      color: BLOCK_COLORS[(r + c) % BLOCK_COLORS.length],
      hit: 0,            // hit-flash timer
      alive: true,
    };
  }

  // A fresh board: a full grid of live blocks.
  function makeBoard() {
    const blocks = [];
    for (let r = 0; r < runtime.rows; r++) {
      for (let c = 0; c < runtime.cols; c++) blocks.push(makeBlock(r, c));
    }
    return { blocks, portalIndex: null };
  }

  // Index of a random living block — used to pick where a meta-board is entered.
  function pickPortal(board) {
    const alive = [];
    board.blocks.forEach((b, i) => { if (b.alive) alive.push(i); });
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : 0;
  }

  function boardCleared(board) {
    return board.blocks.length > 0 && board.blocks.every((b) => !b.alive);
  }

  // (Re)create the starting pair of boards: a meta-board we came from and the
  // fresh board we are clearing inside one of its blocks.
  function ensureBoards(force) {
    if (!force && runtime.board) return;
    runtime.parent = makeBoard();
    runtime.parent.portalIndex = pickPortal(runtime.parent);
    runtime.board = makeBoard();
    runtime.phase = "play";
    runtime.anim = null;
    runtime.huntGrace = 0;
    placeBalls(W / 2, H * 0.7, Math.min(W, H) * 0.3);
  }

  // ---------------------------------------------------------------------------
  // Balls (levelled: higher level = more damage)
  // ---------------------------------------------------------------------------
  function ballRadius(level) {
    return Math.max(7, runtime.cell * 0.16) * (1 + (level - 1) * 0.12);
  }

  function ballDamageOf(ball) {
    // A level-L ball hits for L times the base ball damage.
    return state.ballDamage * ball.level;
  }

  function makeBall(level) {
    const angle = Math.random() * TAU;
    return {
      x: W / 2,
      y: H * 0.75,
      vx: Math.cos(angle) * BALL_SPEED,
      vy: -Math.abs(Math.sin(angle)) * BALL_SPEED - 60,
      r: ballRadius(level),
      level,
    };
  }

  // Rebuild the live ball list from ballCounts, keeping existing balls in motion
  // and simply relabelling their levels where possible.
  function syncBalls() {
    const desired = [];
    Object.keys(state.ballCounts)
      .map(Number)
      .sort((a, b) => b - a) // keep the strongest when capping
      .forEach((lvl) => {
        for (let i = 0; i < state.ballCounts[lvl]; i++) desired.push(lvl);
      });
    if (desired.length > MAX_BALLS) desired.length = MAX_BALLS;
    if (desired.length === 0) desired.push(1);

    while (runtime.balls.length < desired.length) runtime.balls.push(makeBall(1));
    runtime.balls.length = desired.length;
    for (let i = 0; i < desired.length; i++) {
      runtime.balls[i].level = desired[i];
      runtime.balls[i].r = ballRadius(desired[i]);
    }
  }

  // Scatter the balls around a point and send them off in random directions.
  function placeBalls(cx, cy, spread) {
    for (const b of runtime.balls) {
      const a = Math.random() * TAU;
      const rr = Math.random() * spread * 0.5;
      b.x = clamp(cx + Math.cos(a) * rr, b.r, Math.max(b.r, W - b.r));
      b.y = clamp(cy + Math.sin(a) * rr, b.r, Math.max(b.r, H - b.r));
      const va = Math.random() * TAU;
      b.vx = Math.cos(va) * BALL_SPEED;
      b.vy = Math.sin(va) * BALL_SPEED;
    }
  }

  // Merge MERGE_REQUIRED balls of `level` into one ball of `level + 1`.
  function mergeBalls(level) {
    const count = state.ballCounts[level] || 0;
    if (count < MERGE_REQUIRED) return;
    state.ballCounts[level] = count - MERGE_REQUIRED;
    if (state.ballCounts[level] === 0) delete state.ballCounts[level];
    state.ballCounts[level + 1] = (state.ballCounts[level + 1] || 0) + 1;
    syncBalls();
    save();
    renderBallBar();
    updateHud();
  }

  // ---------------------------------------------------------------------------
  // Shard economy
  // ---------------------------------------------------------------------------
  function breakBlock(block) {
    block.alive = false;
    const reward = Math.round(block.maxHp * 2 * state.yieldMul);
    state.fragments += reward;
    runtime.fragTimestamps.push(performance.now());

    const rect = blockRect(block.r, block.c);
    spawnParticles(rect.x + rect.w / 2, rect.y + rect.h / 2, block.color);
    runtime.floaters.push({
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
      text: "+" + reward,
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
    spawnParticles(cx, cy, block.color, 4);
    // Show the damage dealt on every hit.
    runtime.floaters.push({
      x: cx,
      y: cy - 6,
      text: "-" + dmg,
      life: 0.7,
      color: "#ffffff",
      size: 13,
    });
    if (block.hp <= 0) breakBlock(block);
  }

  // ---------------------------------------------------------------------------
  // Zoom transitions — the heart of the infinite mechanic.
  //
  // Zoom OUT: the finished board shrinks into one block of its parent meta-board
  // while the camera pulls back to reveal the whole meta-board. Called both when
  // a normal board is cleared and when a whole meta-board is finished (in which
  // case the grandparent is generated on the spot).
  //
  // Zoom IN: the camera dives into a chosen block of the current meta-board and a
  // fresh board grows out of it to fill the screen.
  // ---------------------------------------------------------------------------
  function startZoomOut() {
    let meta, cellIndex;
    if (runtime.parent) {
      // Normal case: fall back into the block we entered from.
      meta = runtime.parent;
      cellIndex = runtime.parent.portalIndex;
    } else {
      // The whole meta-board is done — climb one level into a brand-new
      // grandparent board. We never keep the grandparent around until now.
      meta = makeBoard();
      cellIndex = pickPortal(meta);
    }
    runtime.anim = { kind: "out", t: 0, meta, child: runtime.board, cellIndex };
    runtime.phase = "zoomOut";
  }

  function completeZoomOut() {
    const { meta, cellIndex } = runtime.anim;
    meta.blocks[cellIndex].alive = false; // the block we just cleared, destroyed

    runtime.board = meta;
    runtime.parent = null;
    runtime.anim = null;
    runtime.phase = "hunt";
    runtime.huntGrace = HUNT_GRACE;

    // Reward for clearing a board and advance the endless difficulty ramp.
    state.board += 1;
    const bonus = Math.round(20 * state.board * state.yieldMul);
    state.fragments += bonus;
    runtime.announce = { text: "Board " + state.board, sub: "+" + bonus + " shards", life: 1.6 };

    // Balls pour out of the block that was just destroyed.
    const rc = cellRectOf(meta, cellIndex);
    placeBalls(rc.x + rc.w / 2, rc.y + rc.h / 2, Math.max(rc.w, rc.h));

    save();
    updateHud();
  }

  function startZoomIn(index) {
    runtime.anim = { kind: "in", t: 0, meta: runtime.board, child: makeBoard(), cellIndex: index };
    runtime.phase = "zoomIn";
  }

  function completeZoomIn() {
    const { meta, child, cellIndex } = runtime.anim;
    runtime.parent = meta;
    runtime.parent.portalIndex = cellIndex; // destroyed when we climb back out
    runtime.board = child;
    runtime.anim = null;
    runtime.phase = "play";
    placeBalls(W / 2, H * 0.5, Math.min(W, H) * 0.3);
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
  // Physics: circle vs axis-aligned block, resolved per axis.
  // ---------------------------------------------------------------------------
  function collideBallBlocks(ball) {
    const blocks = runtime.board.blocks;
    for (const block of blocks) {
      if (!block.alive) continue;
      const rect = blockRect(block.r, block.c);
      const nearestX = clamp(ball.x, rect.x, rect.x + rect.w);
      const nearestY = clamp(ball.y, rect.y, rect.y + rect.h);
      const dx = ball.x - nearestX;
      const dy = ball.y - nearestY;
      if (dx * dx + dy * dy <= ball.r * ball.r) {
        // Reflect off the shallower penetration axis.
        const overlapX = ball.r - Math.abs(dx);
        const overlapY = ball.r - Math.abs(dy);
        if (overlapX < overlapY) {
          ball.vx = -ball.vx;
          ball.x += ball.vx > 0 ? overlapX : -overlapX;
        } else {
          ball.vy = -ball.vy;
          ball.y += ball.vy > 0 ? overlapY : -overlapY;
        }
        damageBlock(block, ballDamageOf(ball), nearestX, nearestY);
        return; // one block per step keeps it stable
      }
    }
  }

  // Index of the first living block the circle overlaps, or -1. Used while
  // hunting: the block a ball touches is the one we zoom into.
  function blockUnderCircle(board, x, y, r) {
    for (let i = 0; i < board.blocks.length; i++) {
      const block = board.blocks[i];
      if (!block.alive) continue;
      const rect = blockRect(block.r, block.c);
      const nearestX = clamp(x, rect.x, rect.x + rect.w);
      const nearestY = clamp(y, rect.y, rect.y + rect.h);
      const dx = x - nearestX;
      const dy = y - nearestY;
      if (dx * dx + dy * dy <= r * r) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------------
  function update(dt) {
    if (runtime.phase === "play") updatePlay(dt);
    else if (runtime.phase === "hunt") updateHunt(dt);
    else updateZoom(dt); // zoomOut / zoomIn

    updateEffects(dt);
  }

  // Bounce the balls off the four walls (shared by play and hunt).
  function moveBallsInWalls(dt) {
    const speed = state.speedMul;
    for (const ball of runtime.balls) {
      ball.x += ball.vx * speed * dt;
      ball.y += ball.vy * speed * dt;
      if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
      if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
      if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
      if (ball.y + ball.r > H) { ball.y = H - ball.r; ball.vy = -Math.abs(ball.vy); }
    }
  }

  // Clearing the current board: balls chip blocks; an empty board zooms out.
  function updatePlay(dt) {
    moveBallsInWalls(dt);
    for (const ball of runtime.balls) collideBallBlocks(ball);
    if (boardCleared(runtime.board)) startZoomOut();
  }

  // Meta-board is on screen: balls drift until one touches a block, then dive in.
  function updateHunt(dt) {
    // If every block of the meta-board has been cleared, climb another level.
    if (boardCleared(runtime.board)) { startZoomOut(); return; }

    moveBallsInWalls(dt);

    runtime.huntGrace -= dt;
    if (runtime.huntGrace > 0) return;

    for (const ball of runtime.balls) {
      const idx = blockUnderCircle(runtime.board, ball.x, ball.y, ball.r);
      if (idx >= 0) { startZoomIn(idx); break; }
    }
  }

  // Advance a zoom transition and hand off when it finishes.
  function updateZoom(dt) {
    const a = runtime.anim;
    a.t += dt / ZOOM_DUR;
    if (a.t >= 1) {
      if (a.kind === "out") completeZoomOut();
      else completeZoomIn();
    }
  }

  // Timers that tick regardless of phase: hit-flash, banner, particles, floaters.
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
      p.vy += 260 * dt; // gravity
      p.vx *= 0.98;
    }

    for (let i = runtime.floaters.length - 1; i >= 0; i--) {
      const f = runtime.floaters[i];
      f.life -= dt;
      f.y -= 26 * dt;
      if (f.life <= 0) runtime.floaters.splice(i, 1);
    }

    // Prune the shards-per-second window to the last second.
    const cutoff = performance.now() - 1000;
    while (runtime.fragTimestamps.length && runtime.fragTimestamps[0] < cutoff) {
      runtime.fragTimestamps.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const FULL_RECT = () => ({ x: 0, y: 0, w: W, h: H });

  // The screen rect a board must be drawn into so that one of its cells fills the
  // whole viewport (the "zoomed all the way in" camera).
  function cellFillRect(cell) {
    const sx = W / cell.w;
    const sy = H / cell.h;
    return { x: -cell.x * sx, y: -cell.y * sy, w: W * sx, h: H * sy };
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

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
        // Meta-board pulls back from the cell to full; child shrinks into it.
        drawBoard(a.meta, lerpRect(zoomed, full, e), clamp01(e * 1.6), false, true);
        drawBoard(a.child, lerpRect(full, cell, e), clamp01((1 - e) * 1.6), true, false);
      } else {
        // Camera dives into the cell; child grows out of it to fill the screen.
        drawBoard(a.meta, lerpRect(full, zoomed, e), clamp01((1 - e) * 1.6), true, false);
        drawBoard(a.child, lerpRect(cell, full, e), clamp01(e * 1.6), false, false);
      }
    }

    drawAnnounce();
  }

  // Draw a whole board mapped into `dest`, at overall opacity `alpha`. Optionally
  // draws the balls riding this layer, and a portal-hint pulse on live blocks.
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

      ctx.save();
      ctx.globalAlpha = baseAlpha * (0.35 + 0.65 * hpRatio);
      roundRect(rect.x, rect.y, rect.w, rect.h, r);
      const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      grad.addColorStop(0, block.color);
      grad.addColorStop(1, shade(block.color, -0.35));
      ctx.fillStyle = grad;
      ctx.fill();

      if (block.hit > 0) {
        ctx.globalAlpha = baseAlpha * block.hit * 0.7;
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      ctx.restore();

      // A soft pulsing outline hints that a block can be entered while hunting.
      if (portalHint) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * (0.25 + 0.4 * pulse);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        roundRect(rect.x, rect.y, rect.w, rect.h, r);
        ctx.stroke();
        ctx.restore();
      }

      // Cracks + remaining HP once the block has taken a hit.
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
        ctx.font = `800 ${Math.round(rect.h * 0.42)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(block.hp), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        ctx.restore();
      }
    }
  }

  function drawBalls(baseAlpha) {
    for (const ball of runtime.balls) {
      const color = BALL_COLORS[(ball.level - 1) % BALL_COLORS.length];
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
  //   - while clearing a board, a click chips the block under the pointer;
  //   - while hunting the meta-board, a click dives into the block you pick.
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
        if (runtime.phase === "play") damageBlock(block, state.clickDamage, x, y);
        else startZoomIn(i);
        hideHint();
        return;
      }
    }
  }

  canvas.addEventListener("pointerdown", (e) => onPointer(e.clientX, e.clientY));

  let hintHidden = false;
  function hideHint() {
    if (hintHidden) return;
    hintHidden = true;
    const hint = document.getElementById("hint");
    hint.style.opacity = "0";
    setTimeout(() => (hint.style.display = "none"), 700);
  }

  // ---------------------------------------------------------------------------
  // Shop / upgrades UI
  // ---------------------------------------------------------------------------
  function costOf(u) {
    return Math.round(u.baseCost * Math.pow(u.growth, state.levels[u.id]));
  }

  function isMaxed(u) {
    return u.max != null && state.levels[u.id] >= u.max;
  }

  function buy(u) {
    if (isMaxed(u)) return;
    const cost = costOf(u);
    if (state.fragments < cost) return;
    state.fragments -= cost;
    state.levels[u.id] += 1;
    u.apply(state);
    syncBalls();
    save();
    renderShop();
    renderBallBar();
    updateHud();
  }

  const shopEl = document.getElementById("upgrades");

  function renderShop() {
    shopEl.innerHTML = "";
    for (const u of UPGRADES) {
      const maxed = isMaxed(u);
      const cost = costOf(u);
      const affordable = !maxed && state.fragments >= cost;

      const btn = document.createElement("button");
      btn.className = "upgrade" + (affordable ? " affordable" : "");
      btn.disabled = maxed || !affordable;
      btn.innerHTML = `
        <div class="u-head">
          <span class="u-name">${u.name}</span>
          <span class="u-level">Lv. ${state.levels[u.id]}${u.max ? " / " + u.max : ""}</span>
        </div>
        <div class="u-desc">${u.desc}</div>
        <div class="u-cost">${maxed ? "Maxed out" : cost.toLocaleString("en-US")}</div>
      `;
      btn.addEventListener("click", () => buy(u));
      shopEl.appendChild(btn);
    }
  }

  // Refresh only affordability styling each frame (cheap) without rebuilding DOM.
  function refreshShopAffordability() {
    const nodes = shopEl.children;
    for (let i = 0; i < UPGRADES.length; i++) {
      const u = UPGRADES[i];
      const node = nodes[i];
      if (!node) continue;
      const maxed = isMaxed(u);
      const affordable = !maxed && state.fragments >= costOf(u);
      node.disabled = maxed || !affordable;
      node.classList.toggle("affordable", affordable);
    }
  }

  // ---------------------------------------------------------------------------
  // Ball banner: a strip of per-level ball counts + merge buttons.
  // Only level-1 balls can be bought (Extra Ball); higher levels come from
  // merging ten of the level below into one.
  // ---------------------------------------------------------------------------
  const ballbarEl = document.getElementById("ballbar");

  function renderBallBar() {
    ballbarEl.innerHTML = "";
    const levels = Object.keys(state.ballCounts)
      .map(Number)
      .filter((l) => state.ballCounts[l] > 0)
      .sort((a, b) => a - b);

    for (const lvl of levels) {
      const count = state.ballCounts[lvl];
      const color = BALL_COLORS[(lvl - 1) % BALL_COLORS.length];

      const chip = document.createElement("div");
      chip.className = "ballchip";
      chip.innerHTML = `
        <span class="dot" style="background:${color}; color:${color}"></span>
        <span class="lv">Lv ${lvl}</span>
        <span class="ct">×${count}</span>
      `;

      if (count >= MERGE_REQUIRED) {
        const btn = document.createElement("button");
        btn.className = "merge";
        btn.textContent = `Merge 10 → Lv ${lvl + 1}`;
        btn.addEventListener("click", () => mergeBalls(lvl));
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

  function updateHud() {
    fragEl.textContent = Math.floor(state.fragments).toLocaleString("en-US");
    if (boardEl) boardEl.textContent = state.board;
    refreshShopAffordability();
  }

  // Debug: clicking the game title doubles your shards.
  const brandEl = document.querySelector(".brand");
  if (brandEl) {
    brandEl.style.cursor = "pointer";
    brandEl.title = "Debug: double your shards";
    brandEl.addEventListener("click", () => {
      state.fragments = Math.max(1, Math.floor(state.fragments)) * 2;
      save();
      updateHud();
    });
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        fragments: state.fragments,
        board: state.board,
        ballDamage: state.ballDamage,
        clickDamage: state.clickDamage,
        speedMul: state.speedMul,
        yieldMul: state.yieldMul,
        ballCounts: state.ballCounts,
        levels: state.levels,
      }));
    } catch (_) { /* storage unavailable — play unsaved */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      Object.assign(state, {
        fragments: data.fragments ?? 0,
        board: data.board ?? 1,
        ballDamage: data.ballDamage ?? 1,
        clickDamage: data.clickDamage ?? 1,
        speedMul: data.speedMul ?? 1,
        yieldMul: data.yieldMul ?? 1,
      });
      if (data.ballCounts && Object.keys(data.ballCounts).length) {
        state.ballCounts = {};
        for (const k of Object.keys(data.ballCounts)) state.ballCounts[k] = data.ballCounts[k];
      }
      if (data.levels) Object.assign(state.levels, data.levels);
    } catch (_) { /* corrupt save — start fresh */ }
  }

  // Full reset: wipe the save AND every scrap of live state (shards, board,
  // upgrades, balls, and the boards themselves), then rebuild from scratch.
  function resetGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch (_) {}

    Object.assign(state, DEFAULT_STATE());
    UPGRADES.forEach((u) => (state.levels[u.id] = 0));

    runtime.balls.length = 0;
    runtime.particles.length = 0;
    runtime.floaters.length = 0;
    runtime.announce = null;
    runtime.parent = null;
    runtime.board = null;
    runtime.anim = null;
    runtime.phase = "play";
    runtime.huntGrace = 0;

    syncBalls();          // rebuild the single starting level-1 ball
    ensureBoards(true);   // fresh boards + placed balls
    renderShop();
    renderBallBar();
    updateHud();
    save();
  }

  document.getElementById("reset").addEventListener("click", () => {
    if (!confirm("Reset all progress?")) return;
    resetGame();
  });

  // Autosave periodically.
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
    if (dt > 0.05) dt = 0.05; // clamp after tab switches

    update(dt);
    render();

    // The "shards/s" readout updates a few times a second.
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
    resize();          // lays out the grid and builds the first pair of boards
    syncBalls();
    renderShop();
    renderBallBar();
    updateHud();
    window.addEventListener("resize", resize);
    // Re-measure whenever the canvas box changes (mobile URL bar, rotation,
    // layout settling once the shop is in place) — keeps the balls perfectly round.
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    requestAnimationFrame((t) => { last = t; frame(t); });
  }

  init();
})();

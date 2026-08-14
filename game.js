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
 * The balls bounce inside a NORMALISED square play-field (see layout.js); the
 * game just scales that square onto the screen. All physics runs in field units
 * so it is identical everywhere and matches the simulator exactly. Every tunable
 * lives in config.js and every formula in economy.js — both shared with the
 * stats dashboard.
 */
(() => {
  "use strict";

  const C = window.IC.config;
  const E = window.IC.economy;
  const LAY = window.IC.layout;
  const FIELD = LAY.FIELD;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------
  // Game state (persisted)
  // ---------------------------------------------------------------------------
  const DEFAULT_STATE = () => ({
    fragments: 0,
    level: 0,             // global level index; every board cleared bumps it
    universe: 1,          // universes finished (HUD "Meta"); advances on ascension
    ballCounts: { 1: 1 }, // tier -> number of balls owned
    ballsBought: 0,       // total tier-1 balls ever bought (prices the next one)
    powerLevel: 0,        // Power upgrades bought (global damage multiplier)
    clickLevel: 0,        // Click Power upgrades bought (manual-tap multiplier, capped)
  });

  const state = DEFAULT_STATE();

  // ---------------------------------------------------------------------------
  // Runtime-only data (not persisted). Only two boards ever exist: `board` (on
  // screen) and `parent` (the meta-board it lives inside, or null while hunting).
  // ---------------------------------------------------------------------------
  const runtime = {
    board: null,
    parent: null,
    phase: "play",        // "play" | "hunt" | "zoomOut" | "zoomIn" | "ascend"
    anim: null,
    interlude: null,
    pending: null,
    huntGrace: 0,
    paused: false,        // true while the intro overlay is up

    balls: [],
    particles: [],
    floaters: [],
    announce: null,

    // Field -> screen transform (a centred square), computed on resize.
    view: { D: 1, offX: 0, offY: 0, scale: 1 },
    shardEvents: [],      // {t, amount} of recent breaks — smooths the shards/s HUD
  };

  const RATE_WINDOW = 10;  // seconds over which shards/s is averaged (smooth HUD)

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

    // The play-field is a square, as large as fits, centred in the canvas.
    const D = Math.min(W, H);
    runtime.view = { D, offX: (W - D) / 2, offY: (H - D) / 2, scale: D / FIELD };

    if (!runtime.board) ensureBoards(true);
  }

  // ---------------------------------------------------------------------------
  // Boards. Geometry comes from the shared layout; only the HP/reward split and
  // the fractal bookkeeping live here.
  // ---------------------------------------------------------------------------
  function cellRectOf(board, index) {
    return board.blocks[index].rect;
  }

  function makeBoard(level, universe) {
    // HP is scaled by the universe's HP%, but the reward is always paid on the
    // full nominal value — so a low-HP universe breaks faster without touching
    // the reward curve.
    const hpTotal = E.boardHp(level);
    const reward = E.boardReward(level);

    // Brick positions come from this universe's LAYOUT (grid / staggered / ring /
    // pyramid) — every layout has the same 24 blocks so the metrics don't move.
    // Random per-block weights (lower bricks heavier) still sum to the board HP,
    // so bricks start visibly varied but the total HP (the metric) is unchanged.
    const rects = LAY.cells(LAY.layoutForUniverse(universe));
    const cells = rects.map((rect) => ({ rect, w: 0.55 + (rect.y / FIELD) * 0.5 + Math.random() * 0.9 }));
    const sum = cells.reduce((a, b) => a + b.w, 0) || 1;

    const blocks = cells.map((cell) => {
      const share = cell.w / sum;
      const hp = hpTotal * share;
      return { rect: cell.rect, hp, maxHp: hp, reward: reward * share, hit: 0, label: 0, alive: true };
    });
    const maxBlockHp = blocks.reduce((m, b) => Math.max(m, b.maxHp), 0) || 1;
    return { blocks, portalIndex: null, universe, maxBlockHp };
  }

  // A brick's colour tracks its REMAINING HP within the universe's palette.
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

  function ensureBoards(force) {
    if (!force && runtime.board) return;
    // The meta-board (what you zoom OUT to) teases the universe ABOVE: its own
    // palette and layout (universe + 1). The board you actually play is the
    // current universe.
    runtime.parent = makeBoard(state.level, state.universe + 1);
    runtime.parent.portalIndex = pickPortal(runtime.parent);
    runtime.board = makeBoard(state.level, state.universe);
    runtime.phase = "play";
    runtime.anim = null;
    runtime.interlude = null;
    runtime.pending = null;
    runtime.huntGrace = 0;
    placeBalls(FIELD / 2, FIELD * 0.82, FIELD * 0.3);
  }

  // ---------------------------------------------------------------------------
  // Balls (tiered: a tier-T ball deals economy.ballDamage(T))
  // ---------------------------------------------------------------------------
  function ballDamageOf(ball) { return E.ballDamage(ball.level) * E.powerMultiplier(state.powerLevel); }

  // A manual tap deals a tier-1 hit boosted by BOTH the global Power upgrade and
  // the dedicated (capped) Click Power upgrade.
  function clickDamage() {
    return E.ballDamage(1) * E.powerMultiplier(state.powerLevel) * E.powerMultiplier(state.clickLevel);
  }

  function makeBall(tier) {
    const angle = Math.random() * TAU;
    const sp = LAY.ballSpeed();
    return {
      x: FIELD / 2,
      y: FIELD * 0.82,
      vx: Math.cos(angle) * sp,
      vy: -Math.abs(Math.sin(angle)) * sp,
      r: LAY.ballRadius(tier),
      level: tier,
    };
  }

  function syncBalls() {
    const desired = [];
    Object.keys(state.ballCounts)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach((lvl) => { for (let i = 0; i < state.ballCounts[lvl]; i++) desired.push(lvl); });
    if (desired.length > C.MAX_BALLS) desired.length = C.MAX_BALLS;
    if (desired.length === 0) desired.push(1);

    while (runtime.balls.length < desired.length) runtime.balls.push(makeBall(1));
    runtime.balls.length = desired.length;
    for (let i = 0; i < desired.length; i++) {
      runtime.balls[i].level = desired[i];
      runtime.balls[i].r = LAY.ballRadius(desired[i]);
    }
  }

  function placeBalls(cx, cy, spread) {
    for (const b of runtime.balls) {
      const a = Math.random() * TAU;
      const rr = Math.random() * spread * 0.5;
      b.x = clamp(cx + Math.cos(a) * rr, b.r, FIELD - b.r);
      b.y = clamp(cy + Math.sin(a) * rr, b.r, FIELD - b.r);
      const va = Math.random() * TAU;
      const sp = LAY.ballSpeed();
      b.vx = Math.cos(va) * sp;
      b.vy = Math.sin(va) * sp;
    }
  }

  function ballCount1() { return state.ballCounts[1] || 0; }

  function mergeBalls(tier) {
    const count = state.ballCounts[tier] || 0;
    // Merging is only unlocked once you hold MERGE_UNLOCK (15), but a merge still
    // consumes only MERGE_REQUIRED (10) — so you never collapse from 10 down to 1.
    if (count < C.MERGE_UNLOCK) return;
    state.ballCounts[tier] = count - C.MERGE_REQUIRED;
    if (state.ballCounts[tier] === 0) delete state.ballCounts[tier];
    state.ballCounts[tier + 1] = (state.ballCounts[tier + 1] || 0) + 1;
    syncBalls();
    save();
    renderBallBar();
    renderShop();
    updateHud();
  }

  // ---------------------------------------------------------------------------
  // Shard economy
  // ---------------------------------------------------------------------------
  function breakBlock(block) {
    block.alive = false;
    state.fragments += block.reward;
    runtime.shardEvents.push({ t: performance.now(), amount: block.reward });

    const rect = block.rect;
    spawnParticles(rect.x + rect.w / 2, rect.y + rect.h / 2, blockColor(runtime.board, block));
    runtime.floaters.push({
      x: rect.x + rect.w / 2, y: rect.y + rect.h / 2,
      text: "+" + E.formatNum(block.reward), life: 1, color: "#ffcf6b", size: 40,
    });
    updateHud();
  }

  function damageBlock(block, dmg, cx, cy) {
    if (!block.alive) return;
    block.hp -= dmg;
    block.hit = 1;
    block.label = 1;   // show this brick's HP number for ~1s after it's touched
    spawnParticles(cx, cy, blockColor(runtime.board, block), 4);
    runtime.floaters.push({ x: cx, y: cy - 14, text: "-" + E.formatNum(dmg), life: 0.7, color: "#ffffff", size: 32 });
    // Break at display-zero (< 0.05 rounds to "0.0"), so a brick never sits
    // visibly at 0 waiting for one more click — the fractional remainder is
    // invisible against the reward, which is fixed per brick anyway.
    if (block.hp < 0.05) breakBlock(block);
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
    meta.blocks[cellIndex].alive = false;
    state.level += 1;

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
    placeBalls(FIELD / 2, FIELD * 0.5, FIELD * 0.3);
  }

  function startAscension() {
    const bonus = E.ascendBonus(state.ballsBought);
    state.fragments += bonus;
    state.universe += 1;

    // The new meta-board again teases one universe further up.
    const meta = makeBoard(state.level, state.universe + 1);
    const portal = pickPortal(meta);
    meta.blocks[portal].alive = false;
    runtime.pending = { meta, portal };

    runtime.interlude = { life: C.ASCEND_DUR, total: C.ASCEND_DUR, name: E.universeName(state.universe), bonus };
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
  // Particles & juice (field units)
  // ---------------------------------------------------------------------------
  function spawnParticles(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = 100 + Math.random() * 400;
      runtime.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4, max: 0.9, color,
        size: 3 + Math.random() * 8,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Physics (field units): circle vs axis-aligned brick, resolved per axis.
  // ---------------------------------------------------------------------------
  function ballHitsBlock(ball, doDamage) {
    const blocks = runtime.board.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block.alive) continue;
      const rect = block.rect;
      const nearestX = clamp(ball.x, rect.x, rect.x + rect.w);
      const nearestY = clamp(ball.y, rect.y, rect.y + rect.h);
      const dx = ball.x - nearestX;
      const dy = ball.y - nearestY;
      if (dx * dx + dy * dy <= ball.r * ball.r) {
        const overlapX = ball.r - Math.abs(dx);
        const overlapY = ball.r - Math.abs(dy);
        if (overlapX < overlapY) { ball.vx = -ball.vx; ball.x += ball.vx > 0 ? overlapX : -overlapX; }
        else { ball.vy = -ball.vy; ball.y += ball.vy > 0 ? overlapY : -overlapY; }
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
    if (runtime.paused) return;
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
      if (ball.x + ball.r > FIELD) { ball.x = FIELD - ball.r; ball.vx = -Math.abs(ball.vx); }
      if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
      if (ball.y + ball.r > FIELD) { ball.y = FIELD - ball.r; ball.vy = -Math.abs(ball.vy); }
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
    if (a.t >= 1) { if (a.kind === "out") completeZoomOut(); else completeZoomIn(); }
  }

  function updateAscension(dt) {
    const it = runtime.interlude;
    it.life -= dt;
    if (it.life <= 0) completeAscension();
  }

  function updateEffects(dt) {
    for (const block of runtime.board.blocks) {
      if (block.hit > 0) block.hit = Math.max(0, block.hit - dt * 6);
      if (block.label > 0) block.label = Math.max(0, block.label - dt);
    }
    if (runtime.announce) {
      runtime.announce.life -= dt;
      if (runtime.announce.life <= 0) runtime.announce = null;
    }
    for (let i = runtime.particles.length - 1; i >= 0; i--) {
      const p = runtime.particles[i];
      p.life -= dt;
      if (p.life <= 0) { runtime.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 650 * dt; p.vx *= 0.98;
    }
    for (let i = runtime.floaters.length - 1; i >= 0; i--) {
      const f = runtime.floaters[i];
      f.life -= dt; f.y -= 65 * dt;
      if (f.life <= 0) runtime.floaters.splice(i, 1);
    }
    const cutoff = performance.now() - RATE_WINDOW * 1000;
    while (runtime.shardEvents.length && runtime.shardEvents[0].t < cutoff) runtime.shardEvents.shift();
  }

  // ---------------------------------------------------------------------------
  // Render. Everything above works in field units; here we drop into the centred
  // square (translate+scale) and draw, so the fractal zoom is a camera within it.
  // ---------------------------------------------------------------------------
  const FULL_RECT = () => ({ x: 0, y: 0, w: FIELD, h: FIELD });

  function cellFillRect(cell) {
    const sx = FIELD / cell.w, sy = FIELD / cell.h;
    return { x: -cell.x * sx, y: -cell.y * sy, w: FIELD * sx, h: FIELD * sy };
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    if (runtime.phase === "ascend") { drawInterlude(runtime.interlude); return; }

    const v = runtime.view;
    ctx.save();
    ctx.translate(v.offX, v.offY);
    ctx.scale(v.scale, v.scale);

    if (runtime.phase === "play" || runtime.phase === "hunt") {
      drawBoard(runtime.board, FULL_RECT(), 1, true, runtime.phase === "hunt");
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

    // A light square outline marks the play-field (no rounded panel here).
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, FIELD, FIELD);

    ctx.restore();
    drawAnnounce();
  }

  function drawBoard(board, dest, alpha, withBalls, portalHint) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, FIELD, FIELD);
    ctx.clip();
    ctx.translate(dest.x, dest.y);
    ctx.scale(dest.w / FIELD, dest.h / FIELD);
    drawBlocks(board, alpha, portalHint);
    if (withBalls) drawBalls(alpha);
    ctx.restore();
  }

  function drawBlocks(board, baseAlpha, portalHint) {
    const pulse = portalHint ? 0.5 + 0.5 * Math.sin(performance.now() / 260) : 0;
    for (const block of board.blocks) {
      if (!block.alive) continue;
      const rect = block.rect;
      const hpRatio = block.hp / block.maxHp;
      const r = Math.min(16, rect.w * 0.18);
      const col = blockColor(board, block);

      ctx.save();
      ctx.globalAlpha = baseAlpha * (0.35 + 0.65 * hpRatio);
      roundRect(rect.x, rect.y, rect.w, rect.h, r);
      const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      grad.addColorStop(0, col);
      grad.addColorStop(1, shade(col, -0.35));
      ctx.fillStyle = grad;
      ctx.fill();
      if (block.hit > 0) { ctx.globalAlpha = baseAlpha * block.hit * 0.7; ctx.fillStyle = "#ffffff"; ctx.fill(); }
      ctx.restore();

      if (portalHint) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * (0.25 + 0.4 * pulse);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        roundRect(rect.x, rect.y, rect.w, rect.h, r);
        ctx.stroke();
        ctx.restore();
      }

      if (hpRatio < 1) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * (1 - hpRatio) * 0.5;
        ctx.strokeStyle = "#0d1117";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(rect.x + rect.w * 0.3, rect.y);
        ctx.lineTo(rect.x + rect.w * 0.5, rect.y + rect.h * 0.6);
        ctx.lineTo(rect.x + rect.w * 0.35, rect.y + rect.h);
        ctx.stroke();
        ctx.restore();
      }

      // The HP number shows only for ~1s after the brick is touched, then fades.
      if (block.label > 0) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * 0.9 * clamp01(block.label * 3);
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
        ball.x - ball.r * 0.3, ball.y - ball.r * 0.3, ball.r * 0.2, ball.x, ball.y, ball.r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, color);
      ctx.globalAlpha = baseAlpha;
      ctx.fillStyle = g;
      ctx.shadowColor = color;
      ctx.shadowBlur = 26;
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
      ctx.font = `700 ${f.size || 34}px Inter, system-ui, sans-serif`;
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

    const cx = W / 2, cy = H * 0.42, R = Math.min(W, H);
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

    if (it.bonus) {
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffcf6b";
      ctx.font = "700 18px Inter, system-ui, sans-serif";
      ctx.fillText("+" + E.formatNum(it.bonus) + " shards", cx, cy + R * 0.2 + 64);
    }

    const bw = Math.min(W * 0.5, 320), bh = 6;
    const bx = cx - bw / 2, by = cy + R * 0.2 + 88;
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
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp(Math.round(r + r * amt), 0, 255);
    g = clamp(Math.round(g + g * amt), 0, 255);
    b = clamp(Math.round(b + b * amt), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  // Screen point -> field point (inverse of the view transform).
  function toField(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const v = runtime.view;
    return { x: (clientX - rect.left - v.offX) / v.scale, y: (clientY - rect.top - v.offY) / v.scale };
  }

  // ---------------------------------------------------------------------------
  // Input: click / tap
  // ---------------------------------------------------------------------------
  function onPointer(clientX, clientY) {
    if (runtime.paused) return;
    if (runtime.phase !== "play" && runtime.phase !== "hunt") return;
    const pt = toField(clientX, clientY);
    for (let i = 0; i < runtime.board.blocks.length; i++) {
      const block = runtime.board.blocks[i];
      if (!block.alive) continue;
      const b = block.rect;
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) {
        if (runtime.phase === "play") damageBlock(block, clickDamage(), pt.x, pt.y);
        else startZoomIn(i);
        hideHint();
        return;
      }
    }
  }

  canvas.addEventListener("pointerdown", (e) => onPointer(e.clientX, e.clientY));

  // ---------------------------------------------------------------------------
  // Intro overlay — shown on a fresh game / reset, and pauses the game.
  // ---------------------------------------------------------------------------
  const introEl = document.getElementById("intro");
  function showIntro() {
    runtime.paused = true;
    if (!introEl) return;
    introEl.querySelector(".intro-name").textContent = E.universeName(state.universe);
    introEl.querySelector(".intro-body").textContent =
      "the smallest speck there is. Shatter every brick to zoom out and discover what contains it.";
    introEl.classList.remove("hidden");
  }
  function hideIntro() {
    runtime.paused = false;
    if (introEl) introEl.classList.add("hidden");
  }
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
  // Shop — buying tier-1 balls (the only purchase; merging is in the banner).
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

  function buyPower() {
    const cost = E.powerCost(state.powerLevel);
    if (state.fragments < cost) return;
    state.fragments -= cost;
    state.powerLevel += 1;
    save();
    renderShop();
    renderBallBar();
    updateHud();
  }

  function buyClickPower() {
    if (state.clickLevel >= C.CLICK_POWER_CAP) return;
    const cost = E.clickPowerCost(state.clickLevel);
    if (state.fragments < cost) return;
    state.fragments -= cost;
    state.clickLevel += 1;
    save();
    renderShop();
    updateHud();
  }

  // A compact card: name + level/meta + cost all on one line, a one-line desc
  // below. The whole card gets a gold border when you can afford it.
  function shopCard(name, meta, desc, costText, affordable, onClick) {
    const btn = document.createElement("button");
    btn.className = "upgrade" + (affordable ? " affordable" : "");
    btn.disabled = !affordable;
    btn.innerHTML = `
      <div class="u-line">
        <span class="u-name">${name}</span>
        <span class="u-meta">${meta}</span>
        <span class="u-cost">${costText}</span>
      </div>
      <div class="u-desc">${desc}</div>
    `;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function renderShop() {
    shopEl.innerHTML = "";

    const count = ballCount1();
    const capped = count >= C.LEVEL1_CAP;
    const ballCost = E.ballCost(state.ballsBought);
    const onSale = state.ballsBought < (C.BALL_SALE_COUNT || 0);
    const ball1dmg = E.ballDamage(1) * E.powerMultiplier(state.powerLevel);
    shopEl.appendChild(shopCard(
      "Extra Ball", `${count}/${C.LEVEL1_CAP}`,
      `Tier-1 ball · ${E.formatNum(ball1dmg)} dmg` + (onSale ? ` · ${Math.round(C.BALL_SALE_OFF * 100)}% off!` : ""),
      capped ? "Max — merge" : E.formatNum(ballCost),
      !capped && state.fragments >= ballCost, buyBall));

    const pCost = E.powerCost(state.powerLevel);
    shopEl.appendChild(shopCard(
      "Power", `×${E.powerMultiplier(state.powerLevel).toFixed(2)}`,
      `+${Math.round((C.POWER_MULT - 1) * 100)}% damage to every ball`,
      E.formatNum(pCost),
      state.fragments >= pCost, buyPower));

    const cCapped = state.clickLevel >= C.CLICK_POWER_CAP;
    const cCost = E.clickPowerCost(state.clickLevel);
    shopEl.appendChild(shopCard(
      "Click Power", cCapped ? `×${E.powerMultiplier(state.clickLevel).toFixed(2)} max` : `${state.clickLevel}/${C.CLICK_POWER_CAP}`,
      `+${Math.round((C.POWER_MULT - 1) * 100)}% damage when you tap a brick`,
      cCapped ? "Maxed" : E.formatNum(cCost),
      !cCapped && state.fragments >= cCost, buyClickPower));
  }

  function refreshShop() {
    const cards = shopEl.children;
    if (cards.length < 3) return;
    const capped = ballCount1() >= C.LEVEL1_CAP;
    const ballAff = !capped && state.fragments >= E.ballCost(state.ballsBought);
    cards[0].disabled = !ballAff;
    cards[0].classList.toggle("affordable", ballAff);
    const pAff = state.fragments >= E.powerCost(state.powerLevel);
    cards[1].disabled = !pAff;
    cards[1].classList.toggle("affordable", pAff);
    const cAff = state.clickLevel < C.CLICK_POWER_CAP && state.fragments >= E.clickPowerCost(state.clickLevel);
    cards[2].disabled = !cAff;
    cards[2].classList.toggle("affordable", cAff);
  }

  // ---------------------------------------------------------------------------
  // Ball banner: per-tier counts, per-ball damage, and merge buttons.
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

      const dmg = E.ballDamage(tier) * E.powerMultiplier(state.powerLevel);
      const chip = document.createElement("div");
      chip.className = "ballchip";
      chip.innerHTML = `
        <span class="dot" style="background:${color}; color:${color}"></span>
        <span class="lv">Lv ${tier}</span>
        <span class="ct">×${count}</span>
        <span class="dmg">${E.formatNum(dmg)} dmg</span>
      `;
      if (count >= C.MERGE_UNLOCK) {
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
  const metaLabelEl = document.getElementById("metaLabel");
  const brandTitleEl = document.querySelector(".brand h1");
  const appEl = document.getElementById("app");

  // How far through the current universe (its 24 sub-levels), 0..100%.
  function eraProgress() {
    const per = E.blocksPerBoard();
    const sub = clamp(state.level - (state.universe - 1) * per, 0, per);
    return Math.round((sub / per) * 100);
  }

  // Paint the whole page in the current universe's dark backdrop.
  let themedUniverse = -1;
  function applyTheme() {
    if (state.universe === themedUniverse) return;
    themedUniverse = state.universe;
    const bg = E.backgroundFor(state.universe);
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
  }

  function updateHud() {
    fragEl.textContent = E.formatNum(state.fragments);
    if (boardEl) boardEl.textContent = eraProgress() + "%";
    if (metaLabelEl) metaLabelEl.textContent = E.universeName(state.universe) + " era";
    if (brandTitleEl) brandTitleEl.textContent = E.universeName(state.universe) + " Era";
    applyTheme();
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
        powerLevel: state.powerLevel,
        clickLevel: state.clickLevel,
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
        powerLevel: data.powerLevel ?? 0,
        clickLevel: data.clickLevel ?? 0,
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
      let sum = 0;
      for (const e of runtime.shardEvents) sum += e.amount;
      fpsEl.textContent = E.formatNum(sum / RATE_WINDOW);
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
    if (state.level === 0 && state.universe === 1 && state.ballsBought === 0) showIntro();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    requestAnimationFrame((t) => { last = t; frame(t); });
  }

  init();
})();

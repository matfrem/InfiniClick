/*
 * InfiniClick — a zen infinite clicker inspired by ZenShards.
 *
 * One or more balls bounce around a grid of destructible blocks. Every hit
 * chips away at a block's health; breaking one scatters shards you spend on
 * upgrades. Clearing the whole grid generates a tougher board. Balls come in
 * levels: ten balls of a level can be merged into one stronger ball of the
 * next level (ZenShards-style). The loop never ends — it only grows.
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
  const state = {
    fragments: 0,
    board: 1,          // current board (endless progression)
    ballDamage: 1,     // base damage a level-1 ball deals per bounce
    clickDamage: 1,
    speedMul: 1,
    yieldMul: 1,
    ballCounts: { 1: 1 }, // level -> number of balls owned
    levels: {},        // upgradeId -> purchased count
  };
  UPGRADES.forEach((u) => (state.levels[u.id] = 0));

  // Runtime-only (not persisted)
  const runtime = {
    balls: [],
    blocks: [],
    particles: [],
    floaters: [],     // floating "+N" / "-N" texts
    announce: null,   // central banner (e.g. "Board 3")
    boardTimer: 0.6,  // delay before generating the next board
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
  // Grid of destructible blocks
  // ---------------------------------------------------------------------------
  function buildBlocks() {
    runtime.blocks = [];
    for (let r = 0; r < runtime.rows; r++) {
      for (let c = 0; c < runtime.cols; c++) runtime.blocks.push(makeBlock(r, c));
    }
    runtime.boardTimer = 0.6;
  }

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

    if (runtime.blocks.length === 0 || colsChanged) buildBlocks();
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

  function makeBlock(r, c) {
    // Lower rows are a bit tougher, and every board adds HP: a gentle but
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

  // ---------------------------------------------------------------------------
  // Balls (levelled: higher level = more damage)
  // ---------------------------------------------------------------------------
  function ballRadius(level) {
    return Math.max(7, runtime.cell * 0.16) * (1 + (level - 1) * 0.12);
  }

  function ballDamageOf(ball) {
    // A level-L ball hits for L times the base ball damage. Tunable.
    return state.ballDamage * ball.level;
  }

  function makeBall(level) {
    const angle = Math.random() * TAU;
    const base = 190;
    return {
      x: W / 2,
      y: H * 0.75,
      vx: Math.cos(angle) * base,
      vy: -Math.abs(Math.sin(angle)) * base - 60,
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

  function totalBalls() {
    return Object.values(state.ballCounts).reduce((a, b) => a + b, 0);
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

  // Whole board cleared -> generate a new, slightly tougher one.
  function nextBoard() {
    state.board += 1;
    const bonus = Math.round(20 * state.board * state.yieldMul);
    state.fragments += bonus;
    buildBlocks();
    runtime.announce = { text: "Board " + state.board, sub: "+" + bonus + " shards", life: 1.8 };
    save();
    updateHud();
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
    for (const block of runtime.blocks) {
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

  // ---------------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------------
  function update(dt) {
    const speed = state.speedMul;

    for (const ball of runtime.balls) {
      ball.x += ball.vx * speed * dt;
      ball.y += ball.vy * speed * dt;

      // Walls
      if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
      if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
      if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
      if (ball.y + ball.r > H) { ball.y = H - ball.r; ball.vy = -Math.abs(ball.vy); }

      collideBallBlocks(ball);
    }

    // Hit-flash decay.
    for (const block of runtime.blocks) {
      if (block.hit > 0) block.hit = Math.max(0, block.hit - dt * 6);
    }

    // Board progression: clearing every block generates the next board.
    if (runtime.blocks.length && runtime.blocks.every((b) => !b.alive)) {
      runtime.boardTimer -= dt;
      if (runtime.boardTimer <= 0) nextBoard();
    } else {
      runtime.boardTimer = 0.6;
    }

    // Central banner fade.
    if (runtime.announce) {
      runtime.announce.life -= dt;
      if (runtime.announce.life <= 0) runtime.announce = null;
    }

    // Particles
    for (let i = runtime.particles.length - 1; i >= 0; i--) {
      const p = runtime.particles[i];
      p.life -= dt;
      if (p.life <= 0) { runtime.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt; // gravity
      p.vx *= 0.98;
    }

    // Floating texts
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
  function render() {
    ctx.clearRect(0, 0, W, H);

    // Blocks
    for (const block of runtime.blocks) {
      if (!block.alive) continue;
      const rect = blockRect(block.r, block.c);
      const hpRatio = block.hp / block.maxHp;
      const r = Math.min(10, rect.w * 0.18);

      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * hpRatio;
      roundRect(rect.x, rect.y, rect.w, rect.h, r);
      const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      grad.addColorStop(0, block.color);
      grad.addColorStop(1, shade(block.color, -0.35));
      ctx.fillStyle = grad;
      ctx.fill();

      // Hit flash overlay
      if (block.hit > 0) {
        ctx.globalAlpha = block.hit * 0.7;
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      ctx.restore();

      // Cracks + remaining HP once the block has taken a hit.
      if (hpRatio < 1) {
        ctx.save();
        ctx.globalAlpha = (1 - hpRatio) * 0.5;
        ctx.strokeStyle = "#0d1117";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rect.x + rect.w * 0.3, rect.y);
        ctx.lineTo(rect.x + rect.w * 0.5, rect.y + rect.h * 0.6);
        ctx.lineTo(rect.x + rect.w * 0.35, rect.y + rect.h);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#0d1117";
        ctx.font = `800 ${Math.round(rect.h * 0.42)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(block.hp), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        ctx.restore();
      }
    }

    // Particles
    for (const p of runtime.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Balls (colour + glow scale with level)
    for (const ball of runtime.balls) {
      const color = BALL_COLORS[(ball.level - 1) % BALL_COLORS.length];
      const g = ctx.createRadialGradient(
        ball.x - ball.r * 0.3, ball.y - ball.r * 0.3, ball.r * 0.2,
        ball.x, ball.y, ball.r
      );
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, color);
      ctx.fillStyle = g;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Level number on balls above level 1.
      if (ball.level > 1) {
        ctx.fillStyle = "#0d1117";
        ctx.font = `800 ${Math.round(ball.r)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(ball.level), ball.x, ball.y + 1);
      }
    }

    // Floating texts ("+N" shards, "-N" damage)
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const f of runtime.floaters) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.font = `700 ${f.size || 15}px Inter, system-ui, sans-serif`;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // Central banner ("Board N")
    if (runtime.announce) {
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
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Canvas drawing helpers
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

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp(Math.round(r + r * amt), 0, 255);
    g = clamp(Math.round(g + g * amt), 0, 255);
    b = clamp(Math.round(b + b * amt), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  // ---------------------------------------------------------------------------
  // Input: click / tap to damage a block
  // ---------------------------------------------------------------------------
  function onPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const block of runtime.blocks) {
      if (!block.alive) continue;
      const b = blockRect(block.r, block.c);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        damageBlock(block, state.clickDamage, x, y);
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
  // Ball bar: per-level ball counts + merge buttons
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
        <span class="dot" style="background:${color}"></span>
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
  let resetting = false;

  function save() {
    if (resetting) return; // don't resurrect a wiped save on reload
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

  document.getElementById("reset").addEventListener("click", () => {
    if (!confirm("Reset all progress?")) return;
    resetting = true;                       // block the beforeunload autosave
    try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
    location.reload();
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
    resize();
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

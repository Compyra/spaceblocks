// House of Cards — core game. Requires matter.js, audio.js, particles.js, levels.js.
(() => {
  'use strict';

  const hintEl = document.getElementById('hint');
  if (typeof Matter === 'undefined') {
    hintEl.textContent = 'Could not load the physics engine (matter.js). Check your internet connection and reload.';
    return;
  }

  const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

  // ---------- constants ----------
  const W = 1600;
  const H = 900;
  const GROUND_TOP = 850;
  const STEP = 1000 / 60;
  const LAUNCH_POS = { x: 180, y: 610 };
  const MAX_DRAG = 320;
  const MIN_SPEED = 7;
  const MAX_SPEED = 34;
  const PALETTE = ['#ff5d73', '#ffb347', '#ffe15a', '#6dff8f', '#4fc3f7', '#b388ff', '#ff7ad9'];

  // Material tuning: 'break' is the impact speed needed to shatter the block.
  const MAT = {
    wood: { break: 13, density: 0.0016, friction: 0.9, restitution: 0.02 },
    glass: { break: 5.5, density: 0.0012, friction: 0.7, restitution: 0.02 },
    stone: { break: 19, density: 0.0028, friction: 0.95, restitution: 0.01 },
  };

  // Ball arsenal: 'unlock' is the level (1-based) at which it becomes available,
  // 'breakMul' scales how easily its impacts shatter blocks (push comes from mass).
  const BALLS = {
    cannon: { name: 'Cannon', r: 15, density: 0.006, restitution: 0.35, speedMul: 1, breakMul: 1.3, unlock: 1, color: '#49d7ff', desc: 'Reliable all-rounder' },
    bowling: { name: 'Bowling', r: 24, density: 0.012, restitution: 0.12, speedMul: 0.92, breakMul: 0.4, unlock: 5, color: '#b388ff', desc: 'Heavy \u2014 shoves towers over' },
    bullet: { name: 'Bullet', r: 9, density: 0.008, restitution: 0.2, speedMul: 1.3, breakMul: 2.3, unlock: 9, color: '#ffe15a', desc: 'Fast \u2014 shatters what it touches' },
    bomb: { name: 'Bomb', r: 16, density: 0.005, restitution: 0.3, speedMul: 1, breakMul: 0.9, unlock: 13, color: '#ff5da2', desc: 'Explodes on impact' },
  };
  const BALL_ORDER = ['cannon', 'bowling', 'bullet', 'bomb'];

  // Chapter play-modes: gravity vector, launcher spot and the kill zone that destroys blocks.
  const KILL_TOP = 60;
  const KILL_RIGHT = 1560;
  const MODES = {
    'side-down': { gravity: { x: 0, y: 1 }, launch: { x: 180, y: 610 }, kill: 'bottom', blockAir: 0.01, ballAir: 0, sleep: true },
    'void': { gravity: { x: 0, y: 0 }, launch: { x: 800, y: 805 }, kill: 'ring', ring: { x: 800, y: 430, r: 385 }, blockAir: 0, ballAir: 0, sleep: false },
    'deck': { gravity: { x: 0, y: 0 }, launch: { x: 950, y: 812 }, kill: 'deck', deck: { x0: 500, y0: 150, x1: 1400, y1: 740 }, blockAir: 0.05, ballAir: 0.012, sleep: true },
    'side-up': { gravity: { x: 0, y: -1 }, launch: { x: 180, y: 560 }, kill: 'top', blockAir: 0.01, ballAir: 0, sleep: true },
    'side-right': { gravity: { x: 1, y: 0 }, launch: { x: 170, y: 430 }, kill: 'right', blockAir: 0.01, ballAir: 0, sleep: true },
  };
  let mode = MODES['side-down'];

  // ---------- canvas / view ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let view = { dpr: 1, scale: 1, ox: 0, oy: 0 };
  let vignette = null;
  let bgGrad = null;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    const scale = Math.min(innerWidth / W, innerHeight / H);
    view = { dpr, scale, ox: (innerWidth - W * scale) / 2, oy: (innerHeight - H * scale) / 2 };
    vignette = null;
  }
  addEventListener('resize', resize);
  resize();

  const toWorld = (cx, cy) => ({ x: (cx - view.ox) / view.scale, y: (cy - view.oy) / view.scale });

  // ---------- physics ----------
  const engine = Engine.create({ enableSleeping: true });
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  const world = engine.world;
  // Per-step gravity delta (velocity units are px per 16.67ms step) — used for the aim preview.
  let gStepX = 0;
  let gStepY = 0;
  let killBody = null;

  // ---------- state ----------
  let levelIndex = 0;
  let blocks = [];
  let balls = [];
  let statics = [];
  let shots = 0;
  let state = 'play'; // 'play' | 'won'
  let winTimer = -1;
  let settling = 0;
  let combo = 0;
  let comboTimer = 0;
  let hintShown = true;
  let aim = null; // { sx, sy, cx, cy } in world coords
  let trauma = 0;
  let shakeX = 0;
  let shakeY = 0;
  let selectedBall = 'cannon';
  let freezeMs = 0; // hit-stop pause
  let slowmo = 0; // level-clear slow motion (seconds remaining)
  let lastKill = { x: W / 2, y: H / 2 };
  const toRemove = new Set();
  const explodeQueue = [];

  // ---------- save data ----------
  const SAVE_KEY = 'houseofcards_save_v2';
  function loadSave() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY)) || { unlocked: 1, best: {} };
    } catch {
      return { unlocked: 1, best: {} };
    }
  }
  const save = loadSave();
  if (save.ball && BALLS[save.ball]) selectedBall = save.ball;
  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch { /* storage unavailable */ }
  }

  // ---------- HUD / UI elements ----------
  const el = {
    levelName: document.getElementById('level-name'),
    levelSub: document.getElementById('level-sub'),
    shots: document.getElementById('shots'),
    par: document.getElementById('par'),
    blocks: document.getElementById('blocks'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalStars: document.getElementById('modal-stars'),
    modalSub: document.getElementById('modal-sub'),
    levelsOverlay: document.getElementById('levels-overlay'),
    levelsGrid: document.getElementById('levels-grid'),
    modalUnlock: document.getElementById('modal-unlock'),
    ballBar: document.getElementById('ball-bar'),
    banner: document.getElementById('chapter-banner'),
    startOverlay: document.getElementById('start-overlay'),
    startGrid: document.getElementById('start-grid'),
    spLevels: document.getElementById('sp-levels'),
    spStars: document.getElementById('sp-stars'),
    spFill: document.getElementById('sp-fill'),
    btnStart: document.getElementById('btn-start'),
  };

  function updateHUD() {
    const def = LEVELS[levelIndex];
    const ch = CHAPTERS[def.chapter];
    el.levelName.textContent = def.name;
    el.levelSub.textContent = `Chapter ${def.chapter + 1} \u00b7 ${ch.name} \u00b7 ${def.inChapter + 1}/${ch.levels.length}`;
    el.shots.textContent = shots;
    el.par.textContent = def.par;
    el.blocks.textContent = blocks.length;
  }

  const overlayOpen = () =>
    !el.modal.classList.contains('hidden') ||
    !el.levelsOverlay.classList.contains('hidden') ||
    !el.startOverlay.classList.contains('hidden');

  function hideOverlays() {
    el.modal.classList.add('hidden');
    el.levelsOverlay.classList.add('hidden');
    el.startOverlay.classList.add('hidden');
  }

  // ---------- level lifecycle ----------
  function colorFor(i, mat) {
    if (mat === 'glass') return '#aee6ff';
    if (mat === 'stone') return '#767ea8';
    return PALETTE[i % PALETTE.length];
  }

  function loadLevel(i) {
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
    const lv = LEVELS[levelIndex];
    mode = MODES[CHAPTERS[lv.chapter].mode];
    engine.gravity.x = mode.gravity.x;
    engine.gravity.y = mode.gravity.y;
    gStepX = engine.gravity.x * engine.gravity.scale * STEP * STEP;
    gStepY = engine.gravity.y * engine.gravity.scale * STEP * STEP;
    LAUNCH_POS.x = mode.launch.x;
    LAUNCH_POS.y = mode.launch.y;

    Composite.clear(world, false);
    killBody = null;
    if (mode.kill === 'bottom') killBody = Bodies.rectangle(W / 2, GROUND_TOP + 25, W * 2, 50, { isStatic: true });
    else if (mode.kill === 'top') killBody = Bodies.rectangle(W / 2, KILL_TOP - 25, W * 2, 50, { isStatic: true });
    else if (mode.kill === 'right') killBody = Bodies.rectangle(KILL_RIGHT + 25, H / 2, 50, H * 2, { isStatic: true });
    if (killBody) {
      killBody.hoc = { type: 'ground' };
      Composite.add(world, killBody);
    }
    blocks = [];
    balls = [];
    statics = [];
    toRemove.clear();
    shots = 0;
    combo = 0;
    comboTimer = 0;
    state = 'play';
    winTimer = -1;
    settling = mode.sleep ? 45 : 8;
    FX.clear();

    let ci = 0;
    for (const it of LEVELS[levelIndex].items()) {
      if (it.kind === 'static') {
        const b = Bodies.rectangle(it.x, it.y, it.w, it.h, { isStatic: true });
        b.hoc = { type: 'static', w: it.w, h: it.h };
        statics.push(b);
        Composite.add(world, b);
      } else {
        const m = MAT[it.mat];
        const opts = {
          density: m.density,
          friction: m.friction,
          frictionStatic: 1,
          restitution: m.restitution,
          frictionAir: mode.blockAir,
          // Default Matter threshold; lower values made slow-toppling blocks
          // fall asleep in mid-motion ("stops falling halfway").
          sleepThreshold: mode.sleep ? 60 : Infinity,
        };
        const hoc = { type: 'block', mat: it.mat, color: colorFor(ci++, it.mat) };
        let b;
        if (it.kind === 'ball') {
          b = Bodies.circle(it.x, it.y, it.r, opts);
          hoc.shape = 'circle';
          hoc.r = it.r;
        } else if (it.kind === 'tri') {
          // apex up by default, apex down when flipped
          b = Bodies.polygon(it.x, it.y, 3, it.r, { ...opts, angle: it.flip ? Math.PI / 6 : (-Math.PI * 5) / 6, chamfer: { radius: 3 } });
          hoc.shape = 'poly';
          hoc.r = it.r;
        } else if (it.kind === 'hex') {
          // flat top/bottom by default, flat left/right when 'side'
          b = Bodies.polygon(it.x, it.y, 6, it.r, { ...opts, angle: it.side ? 0 : -Math.PI / 6, chamfer: { radius: 3 } });
          hoc.shape = 'poly';
          hoc.r = it.r;
        } else {
          b = Bodies.rectangle(it.x, it.y, it.w, it.h, {
            ...opts,
            chamfer: { radius: Math.min(5, it.w / 5, it.h / 5) },
          });
          hoc.shape = 'rect';
          hoc.w = it.w;
          hoc.h = it.h;
        }
        b.hoc = hoc;
        blocks.push(b);
        Composite.add(world, b);
      }
    }
    explodeQueue.length = 0;
    freezeMs = 0;
    slowmo = 0;
    if (hintShown) hintEl.classList.remove('fade');
    hideOverlays();
    refreshBallBar();
    updateHUD();
    if (lv.chapter !== bannerChapter) {
      bannerChapter = lv.chapter;
      showBanner(lv.chapter);
    }
  }

  let bannerChapter = -1;
  let bannerTimer = 0;
  function showBanner(ci) {
    const ch = CHAPTERS[ci];
    el.banner.innerHTML =
      `<div class="cb-inner"><div class="cb-kicker">CHAPTER ${ci + 1}</div>` +
      `<div class="cb-title">${ch.name.toUpperCase()}</div>` +
      `<div class="cb-tag">${ch.tagline}</div></div>`;
    el.banner.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.add('hidden'), 3500);
  }

  // ---------- shooting ----------
  function computeAim() {
    if (!aim) return null;
    const dx = aim.sx - aim.cx;
    const dy = aim.sy - aim.cy;
    const len = Math.hypot(dx, dy);
    if (len < 2) return null;
    const p01 = Math.min(1, len / MAX_DRAG);
    return {
      dir: { x: dx / len, y: dy / len },
      speed: (MIN_SPEED + p01 * (MAX_SPEED - MIN_SPEED)) * BALLS[selectedBall].speedMul,
      p01,
    };
  }

  function fire(a) {
    const cfg = BALLS[selectedBall];
    const ball = Bodies.circle(LAUNCH_POS.x, LAUNCH_POS.y, cfg.r, {
      density: cfg.density,
      friction: 0.3,
      frictionAir: mode.ballAir,
      restitution: cfg.restitution,
    });
    ball.hoc = {
      type: 'ball',
      kind: selectedBall,
      breakMul: cfg.breakMul,
      age: 0,
      slow: 0,
      trail: [],
      fuse: selectedBall === 'bomb' ? 3500 : Infinity,
    };
    Body.setVelocity(ball, { x: a.dir.x * a.speed, y: a.dir.y * a.speed });
    Composite.add(world, ball);
    balls.push(ball);
    if (balls.length > 4) removeBall(balls[0], false);
    shots++;
    settling = 0;
    Sound.launch(a.p01, selectedBall);
    FX.ring(LAUNCH_POS.x, LAUNCH_POS.y, '#7af7ff', 50);
    addTrauma(0.1);
    if (hintShown) {
      hintShown = false;
      hintEl.classList.add('fade');
    }
    updateHUD();
  }

  function removeBall(b, fx) {
    const i = balls.indexOf(b);
    if (i >= 0) balls.splice(i, 1);
    Composite.remove(world, b);
    wakeNear(b.position.x, b.position.y, 140);
    if (fx && b.position.x > 0 && b.position.x < W && b.position.y < H) {
      FX.ring(b.position.x, b.position.y, '#49d7ff', 28);
    }
  }

  // Wake sleeping blocks near a removed body, then chain-wake any sleeping block
  // touching a woken one. Without the chain, blocks high up a tall tower stayed
  // asleep (floating) when their support was destroyed below.
  function wakeNear(x, y, r) {
    const woken = [];
    for (const b of blocks) {
      if (!b.isSleeping) continue;
      const dx = b.position.x - x;
      const dy = b.position.y - y;
      if (dx * dx + dy * dy < r * r) {
        Sleeping.set(b, false);
        woken.push(b);
      }
    }
    for (let i = 0; i < woken.length; i++) {
      const w = woken[i].bounds;
      for (const b of blocks) {
        if (!b.isSleeping) continue;
        const bb = b.bounds;
        if (w.min.x - 6 < bb.max.x && w.max.x + 6 > bb.min.x &&
            w.min.y - 6 < bb.max.y && w.max.y + 6 > bb.min.y) {
          Sleeping.set(b, false);
          woken.push(b);
        }
      }
    }
  }

  // Safety net: wake any sleeping block that has nothing beneath it in the
  // gravity direction, so nothing ever hangs frozen in mid-air.
  function wakeUnsupported() {
    const gx = engine.gravity.x;
    const gy = engine.gravity.y;
    if (!gx && !gy) return;
    for (const b of blocks) {
      if (!b.isSleeping) continue;
      // Probe box: the block's AABB nudged 4px along gravity, shrunk slightly
      // perpendicular to it so side-by-side neighbours don't count as support.
      const sx = gx * 4;
      const sy = gy * 4;
      const px = gy !== 0 ? 3 : 0;
      const py = gx !== 0 ? 3 : 0;
      const minX = b.bounds.min.x + sx + px;
      const maxX = b.bounds.max.x + sx - px;
      const minY = b.bounds.min.y + sy + py;
      const maxY = b.bounds.max.y + sy - py;
      let supported = false;
      for (const o of statics) {
        const ob = o.bounds;
        if (minX < ob.max.x && maxX > ob.min.x && minY < ob.max.y && maxY > ob.min.y) {
          supported = true;
          break;
        }
      }
      if (!supported) {
        for (const o of blocks) {
          if (o === b) continue;
          const ob = o.bounds;
          if (minX < ob.max.x && maxX > ob.min.x && minY < ob.max.y && maxY > ob.min.y) {
            supported = true;
            break;
          }
        }
      }
      if (!supported) Sleeping.set(b, false);
    }
  }

  // ---------- destruction ----------
  const relSpeed = (a, b) =>
    Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);

  function killBlock(b) {
    const h = b.hoc;
    if (!h || h.dead) return;
    h.dead = true;
    toRemove.add(b);

    const { x, y } = b.position;
    const glass = h.mat === 'glass';
    lastKill = { x, y };
    FX.shards(x, y, h.color, glass ? 16 : 11, 1, glass);
    FX.sparks(x, y, glass ? '#d6f4ff' : h.color, glass ? 14 : 8, 1);
    FX.ring(x, y, h.color, glass ? 55 : 45);
    FX.flash(x, y, glass ? 42 : 34, glass ? '#d6f4ff' : h.color);
    Sound.shatter(h.mat);
    addTrauma(h.mat === 'stone' ? 0.3 : glass ? 0.18 : 0.24);
    hitStop(h.mat === 'stone' ? 40 : 26);

    combo = comboTimer > 0 ? combo + 1 : 1;
    comboTimer = 1.4;
    if (combo >= 2) {
      FX.text(x, y - 34, '\u00d7' + combo, '#ffd76a', 24 + Math.min(26, combo * 3));
      Sound.combo(combo);
    }
  }

  function impact(target, other, s) {
    const h = target.hoc;
    if (!h || h.type !== 'block' || h.dead) return;
    const o = other.hoc;
    let eff = s;
    if (o.type === 'ball') eff *= o.breakMul;
    else if (o.type === 'block') eff *= 0.75;
    else eff *= 0.85; // static structure
    if (eff >= MAT[h.mat].break) {
      killBlock(target);
      return;
    }
    if (s > 3) {
      Sound.thud(h.mat, s / 18);
      h.flash = Math.min(1, s / 16);
      if (o.type === 'ball' && s > 8) {
        FX.sparks(target.position.x, target.position.y, h.color, 6, 0.6);
        FX.flash(target.position.x, target.position.y, 20, '#ffffff');
      }
    }
  }

  Events.on(engine, 'collisionStart', (e) => {
    for (const pair of e.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ha = a.hoc;
      const hb = b.hoc;
      if (!ha || !hb) continue;

      // The glowing floor destroys any block that touches it.
      if (ha.type === 'ground' && hb.type === 'block') { killBlock(b); continue; }
      if (hb.type === 'ground' && ha.type === 'block') { killBlock(a); continue; }

      // bombs detonate on their first contact with anything
      if (ha.type === 'ball' && ha.kind === 'bomb' && !ha.boom) { ha.boom = true; explodeQueue.push(a); }
      if (hb.type === 'ball' && hb.kind === 'bomb' && !hb.boom) { hb.boom = true; explodeQueue.push(b); }

      if (settling > 0) continue;
      const s = relSpeed(a, b);
      impact(a, b, s);
      impact(b, a, s);

      const ballVs =
        (ha.type === 'ball' && (hb.type === 'static' || hb.type === 'ground')) ||
        (hb.type === 'ball' && (ha.type === 'static' || ha.type === 'ground'));
      if (ballVs && s > 5) {
        Sound.bounce(s / 25);
        addTrauma(Math.min(0.15, s / 180));
      }
    }
  });

  function hitStop(ms) {
    freezeMs = Math.max(freezeMs, Math.min(90, ms));
  }

  // ---------- bomb ----------
  function explode(ball) {
    const { x, y } = ball.position;
    const RADIUS = 175;
    removeBall(ball, false);

    for (const b of blocks) {
      const dx = b.position.x - x;
      const dy = b.position.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > RADIUS) continue;
      const fall = 1 - d / RADIUS;
      if (30 * fall >= MAT[b.hoc.mat].break) {
        killBlock(b);
      } else {
        Sleeping.set(b, false);
        Body.setVelocity(b, {
          x: b.velocity.x + (dx / d) * 15 * fall,
          y: b.velocity.y + (dy / d) * 15 * fall - 4 * fall,
        });
      }
    }
    for (const ob of balls) {
      const dx = ob.position.x - x;
      const dy = ob.position.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > RADIUS) continue;
      const fall = 1 - d / RADIUS;
      Body.setVelocity(ob, {
        x: ob.velocity.x + (dx / d) * 12 * fall,
        y: ob.velocity.y + (dy / d) * 12 * fall,
      });
    }

    FX.flash(x, y, 160, '#ffffff');
    FX.flash(x, y, 100, '#ffb347');
    FX.ring(x, y, '#ffb347', 180);
    FX.ring(x, y, '#ff5da2', 120);
    FX.sparks(x, y, '#ffb347', 34, 1.7);
    FX.sparks(x, y, '#ff5da2', 16, 1.2);
    FX.shards(x, y, '#3a3344', 16, 1.5);
    FX.shards(x, y, '#ff8a5c', 10, 1.3);
    Sound.explosion();
    addTrauma(0.6);
    hitStop(80);
  }

  // ---------- simulation step ----------
  let supportTick = 0;

  function physicsStep() {
    Engine.update(engine, STEP);

    while (explodeQueue.length) explode(explodeQueue.shift());

    // Periodically make sure no sleeping block is left hanging in mid-air.
    if (mode.sleep && settling === 0) {
      supportTick = (supportTick + 1) % 10;
      if (supportTick === 0) wakeUnsupported();
    }

    if (settling > 0) {
      settling--;
      // Force everything to sleep once settled so towers start perfectly still.
      if (settling === 0 && balls.length === 0 && mode.sleep) {
        for (const b of blocks) Sleeping.set(b, true);
      }
    }

    if (toRemove.size) {
      for (const b of toRemove) {
        Composite.remove(world, b);
        const bi = blocks.indexOf(b);
        if (bi >= 0) blocks.splice(bi, 1);
        wakeNear(b.position.x, b.position.y, 170);
      }
      toRemove.clear();
      updateHUD();
      if (blocks.length === 0 && state === 'play') {
        state = 'won';
        winTimer = 1.25;
        slowmo = 1.0;
        FX.confetti(lastKill.x, lastKill.y, 60);
        FX.confetti(W * 0.35, 260, 40);
        FX.confetti(W * 0.72, 220, 40);
      }
    }

    // Blocks shoved out of the arena count as fallen.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const p = blocks[i].position;
      if (p.x < -80 || p.x > W + 80 || p.y > H + 100 || p.y < -140) killBlock(blocks[i]);
    }

    // Chapter-specific kill zones without a physical body.
    if (mode.kill === 'ring') {
      const rg = mode.ring;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const p = blocks[i].position;
        const dx = p.x - rg.x;
        const dy = p.y - rg.y;
        if (dx * dx + dy * dy > rg.r * rg.r) killBlock(blocks[i]);
      }
      for (let i = balls.length - 1; i >= 0; i--) {
        const p = balls[i].position;
        if (Math.hypot(p.x - rg.x, p.y - rg.y) > rg.r + 90) removeBall(balls[i], true);
      }
    } else if (mode.kill === 'deck') {
      const d = mode.deck;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const p = blocks[i].position;
        if (p.x < d.x0 - 4 || p.x > d.x1 + 4 || p.y < d.y0 - 4 || p.y > d.y1 + 4) killBlock(blocks[i]);
      }
      for (let i = balls.length - 1; i >= 0; i--) {
        const p = balls[i].position;
        if (p.x < d.x0 - 170 || p.x > d.x1 + 170 || p.y < d.y0 - 170 || p.y > d.y1 + 190) {
          removeBall(balls[i], true);
        }
      }
    }

    // Ball lifecycle: fade out stopped, old or out-of-bounds balls.
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      const h = b.hoc;
      h.age += STEP;
      h.trail.push({ x: b.position.x, y: b.position.y });
      if (h.trail.length > (h.kind === 'bullet' ? 22 : 14)) h.trail.shift();
      if (h.kind === 'bomb') {
        h.fuse -= STEP;
        if (Math.random() < 0.5) FX.sparks(b.position.x, b.position.y - BALLS.bomb.r, '#ffb347', 1, 0.35);
        if (h.fuse <= 0 && !h.boom) {
          h.boom = true;
          explodeQueue.push(b);
        }
      }
      const sp = Math.hypot(b.velocity.x, b.velocity.y);
      h.slow = sp < 0.4 ? h.slow + STEP : 0;
      const p = b.position;
      if (h.slow > 1000 || h.age > 10000 || p.x < -80 || p.x > W + 80 || p.y > H + 100 || p.y < -140) {
        if (h.kind === 'bomb' && !h.boom && p.y < H + 60 && p.x > -60 && p.x < W + 60) {
          h.boom = true;
          explodeQueue.push(b);
        } else {
          removeBall(b, true);
        }
      }
    }
  }

  // ---------- win / progress ----------
  function starsFor(sh, par) {
    return sh <= par ? 3 : sh <= par + 2 ? 2 : 1;
  }

  function showWin() {
    const def = LEVELS[levelIndex];
    const stars = starsFor(shots, def.par);
    const key = String(levelIndex);
    const prev = save.best[key];
    save.best[key] = {
      shots: prev ? Math.min(prev.shots, shots) : shots,
      stars: Math.max(stars, prev ? prev.stars : 0),
    };
    const prevUnlocked = save.unlocked;
    save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, levelIndex + 2));
    persist();

    const newBalls = BALL_ORDER.filter(
      (k) => BALLS[k].unlock > prevUnlocked && BALLS[k].unlock <= save.unlocked
    );
    el.modalUnlock.classList.toggle('hidden', newBalls.length === 0);
    if (newBalls.length) {
      el.modalUnlock.textContent =
        'NEW BALL UNLOCKED \u2014 ' + newBalls.map((k) => BALLS[k].name.toUpperCase()).join(' & ');
      refreshBallBar();
    }

    const isLast = levelIndex === LEVELS.length - 1;
    el.modalTitle.textContent = isLast ? 'CAMPAIGN COMPLETE' : 'WRECKAGE CLEARED';
    el.modalStars.innerHTML = [1, 2, 3]
      .map(
        (n) =>
          `<span class="modal-star ${n <= stars ? '' : 'dim'}" style="animation-delay:${0.1 + n * 0.14}s">\u2605</span>`
      )
      .join('');
    el.modalSub.textContent =
      `${shots} shot${shots === 1 ? '' : 's'} \u00b7 par ${def.par} \u00b7 best ${save.best[key].shots}`;
    document.getElementById('btn-next').textContent = isLast ? 'Level Select' : 'Next Level';
    el.modal.classList.remove('hidden');
    Sound.win();
  }

  function nextFromModal() {
    Sound.click();
    if (levelIndex + 1 < LEVELS.length) loadLevel(levelIndex + 1);
    else {
      hideOverlays();
      openLevels();
    }
  }

  // ---------- level select ----------
  const MODE_TAG = {
    'side-down': 'GRAVITY \u2193',
    'void': 'ZERO-G',
    'deck': 'TOP-DOWN',
    'side-up': 'GRAVITY \u2191',
    'side-right': 'GRAVITY \u2192',
  };

  function buildLevelsGrid(container, fromStart) {
    container.innerHTML = '';
    let gi = 0;
    CHAPTERS.forEach((ch, ci) => {
      const head = document.createElement('div');
      head.className = 'ch-title';
      head.innerHTML =
        `<b>CH ${ci + 1}</b> ${ch.name}<span class="ch-grav">${MODE_TAG[ch.mode]}</span>`;
      container.appendChild(head);
      const rowEl = document.createElement('div');
      rowEl.className = 'ch-tiles';
      ch.levels.forEach((def, li) => {
        const i = gi++;
        const tile = document.createElement('button');
        tile.className = 'tile';
        if (i + 1 > save.unlocked) tile.classList.add('locked');
        if (i === levelIndex) tile.classList.add('current');
        const best = save.best[String(i)];
        const stars = best ? best.stars : 0;
        tile.innerHTML =
          `<span class="num">${li + 1}</span>` +
          `<span class="tstars">` +
          [1, 2, 3].map((n) => `<span class="${n <= stars ? '' : 'off'}">\u2605</span>`).join('') +
          `</span>`;
        tile.title = def.name;
        tile.addEventListener('click', () => {
          Sound.click();
          loadLevel(i);
          // Coming from the start page, always re-show the chapter gravity banner.
          if (fromStart) showBanner(LEVELS[levelIndex].chapter);
        });
        rowEl.appendChild(tile);
      });
      container.appendChild(rowEl);
    });
  }

  function openLevels() {
    buildLevelsGrid(el.levelsGrid, false);
    el.modal.classList.add('hidden');
    el.levelsOverlay.classList.remove('hidden');
  }

  // ---------- start page ----------
  function progressStats() {
    let stars = 0;
    let cleared = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      const b = save.best[String(i)];
      if (b) {
        cleared++;
        stars += b.stars;
      }
    }
    return { stars, cleared, total: LEVELS.length, maxStars: LEVELS.length * 3 };
  }

  function openStart() {
    const st = progressStats();
    el.spLevels.textContent = `${st.cleared} / ${st.total} LEVELS CLEARED`;
    el.spStars.textContent = `\u2605 ${st.stars} / ${st.maxStars}`;
    el.spFill.style.width = (st.maxStars ? (100 * st.stars) / st.maxStars : 0) + '%';
    el.btnStart.textContent = st.cleared === 0 ? 'Start Game' : 'Continue';
    buildLevelsGrid(el.startGrid, true);
    el.modal.classList.add('hidden');
    el.levelsOverlay.classList.add('hidden');
    el.startOverlay.classList.remove('hidden');
  }

  // ---------- ball selection ----------
  const ballUnlocked = (kind) => save.unlocked >= BALLS[kind].unlock;

  function selectBall(kind) {
    if (!ballUnlocked(kind)) return;
    selectedBall = kind;
    save.ball = kind;
    persist();
    refreshBallBar();
  }

  function refreshBallBar() {
    if (!ballUnlocked(selectedBall)) selectedBall = 'cannon';
    el.ballBar.innerHTML = '';
    BALL_ORDER.forEach((kind, i) => {
      const cfg = BALLS[kind];
      const unlocked = ballUnlocked(kind);
      const btn = document.createElement('button');
      btn.className =
        'ball-btn' + (kind === selectedBall ? ' selected' : '') + (unlocked ? '' : ' locked');
      const unlockCh = LEVELS[Math.min(cfg.unlock, LEVELS.length) - 1].chapter + 1;
      btn.title = unlocked
        ? `${cfg.name} (${i + 1}) \u2014 ${cfg.desc}`
        : `Unlocks in chapter ${unlockCh}`;
      const orb = document.createElement('span');
      orb.className = 'orb';
      orb.style.width = orb.style.height = Math.round(14 + cfg.r * 0.8) + 'px';
      orb.style.background = `radial-gradient(circle at 35% 30%, #ffffff, ${cfg.color} 55%, rgba(0,0,0,0.5))`;
      orb.style.boxShadow = `0 0 10px ${cfg.color}66`;
      btn.appendChild(orb);
      const label = document.createElement('span');
      label.textContent = unlocked ? cfg.name : `Ch ${unlockCh}`;
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        Sound.click();
        selectBall(kind);
      });
      el.ballBar.appendChild(btn);
    });
  }

  // ---------- input ----------
  canvas.addEventListener('pointerdown', (e) => {
    Sound.unlock();
    if (state !== 'play' || overlayOpen()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    aim = { sx: p.x, sy: p.y, cx: p.x, cy: p.y };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!aim) return;
    const p = toWorld(e.clientX, e.clientY);
    aim.cx = p.x;
    aim.cy = p.y;
  });

  canvas.addEventListener('pointerup', () => {
    const a = computeAim();
    aim = null;
    if (a && a.p01 > 0.04 && state === 'play' && !overlayOpen()) fire(a);
  });

  canvas.addEventListener('pointercancel', () => { aim = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      Sound.click();
      loadLevel(levelIndex);
    } else if (e.key === 'm' || e.key === 'M') {
      toggleSound();
    } else if (e.key === 'Escape') {
      el.levelsOverlay.classList.add('hidden');
      if (!el.startOverlay.classList.contains('hidden')) {
        el.startOverlay.classList.add('hidden');
        showBanner(LEVELS[levelIndex].chapter);
      }
    } else if ((e.key === 'n' || e.key === 'N' || e.key === 'Enter') && !el.modal.classList.contains('hidden')) {
      nextFromModal();
    } else if (e.key >= '1' && e.key <= String(BALL_ORDER.length)) {
      const kind = BALL_ORDER[+e.key - 1];
      if (ballUnlocked(kind)) {
        Sound.click();
        selectBall(kind);
      }
    }
  });

  // ---------- UI buttons ----------
  document.getElementById('btn-restart').addEventListener('click', () => {
    Sound.click();
    loadLevel(levelIndex);
  });
  document.getElementById('btn-levels').addEventListener('click', () => {
    Sound.click();
    openLevels();
  });
  document.getElementById('btn-close-levels').addEventListener('click', () => {
    Sound.click();
    el.levelsOverlay.classList.add('hidden');
  });
  document.getElementById('btn-replay').addEventListener('click', () => {
    Sound.click();
    loadLevel(levelIndex);
  });
  document.getElementById('btn-next').addEventListener('click', nextFromModal);
  el.btnStart.addEventListener('click', () => {
    Sound.click();
    el.startOverlay.classList.add('hidden');
    showBanner(LEVELS[levelIndex].chapter);
  });

  const soundBtn = document.getElementById('btn-sound');
  function toggleSound() {
    const on = Sound.toggle();
    soundBtn.textContent = on ? 'Sound On' : 'Sound Off';
    soundBtn.classList.toggle('off', !on);
  }
  soundBtn.addEventListener('click', toggleSound);

  // ---------- screen shake ----------
  function addTrauma(x) {
    trauma = Math.min(1, trauma + x);
  }
  function updateShake(dt) {
    trauma = Math.max(0, trauma - dt * 1.6);
    const m = trauma * trauma * 16;
    shakeX = (Math.random() * 2 - 1) * m;
    shakeY = (Math.random() * 2 - 1) * m;
  }

  // ---------- rendering ----------
  const stars = Array.from({ length: 140 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (H * 0.8),
    r: Math.random() * 1.6 + 0.3,
    tw: Math.random() * 3 + 0.5,
    ph: Math.random() * Math.PI * 2,
  }));

  // Core/edge colors per ball kind for the radial sheen.
  const BALL_SKIN = {
    cannon: { mid: '#8ff0ff', edge: '#2aa7e8', glow: '#49d7ff' },
    bowling: { mid: '#9a7fe8', edge: '#4a3794', glow: '#b388ff' },
    bullet: { mid: '#ffe98c', edge: '#d9a614', glow: '#ffe15a' },
    bomb: { mid: '#6b5d7a', edge: '#231c30', glow: '#ff5da2' },
  };

  function drawBall(x, y, kind, ghost = false, angle = 0, tSec = 0) {
    const skin = BALL_SKIN[kind];
    const r = BALLS[kind].r;
    ctx.save();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, skin.mid);
    g.addColorStop(1, skin.edge);
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = ghost ? 10 : 20;
    ctx.globalAlpha = ghost ? 0.85 : 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (kind === 'bowling') {
      ctx.fillStyle = 'rgba(15,10,35,0.8)';
      for (let i = 0; i < 3; i++) {
        const a = angle + i * 0.55 - 0.55;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, r * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'bomb') {
      // fuse nub and blinking warning light
      ctx.fillStyle = 'rgba(20,14,30,0.9)';
      ctx.fillRect(x - 2.5, y - r - 5, 5, 6);
      const blink = 0.5 + 0.5 * Math.sin(tSec * 18);
      ctx.globalAlpha = (ghost ? 0.6 : 1) * blink;
      ctx.fillStyle = '#ff5da2';
      ctx.shadowColor = '#ff5da2';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function tracePath(vs) {
    ctx.beginPath();
    ctx.moveTo(vs[0].x, vs[0].y);
    for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x, vs[i].y);
    ctx.closePath();
  }

  function drawBlock(b) {
    const h = b.hoc;
    ctx.save();
    if (h.mat === 'glass') {
      ctx.fillStyle = 'rgba(174,230,255,0.22)';
      ctx.strokeStyle = 'rgba(205,240,255,0.9)';
      ctx.shadowColor = '#9fdcff';
      ctx.shadowBlur = 10;
    } else if (h.mat === 'stone') {
      ctx.fillStyle = '#3d4367';
      ctx.strokeStyle = '#8089c0';
      ctx.shadowColor = '#555c82';
      ctx.shadowBlur = 6;
    } else {
      ctx.fillStyle = h.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.shadowColor = h.color;
      ctx.shadowBlur = 12;
    }
    ctx.lineWidth = 2;
    if (h.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(b.position.x, b.position.y, h.r, 0, Math.PI * 2);
    } else {
      tracePath(b.vertices);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    if (h.flash > 0) {
      ctx.globalAlpha = h.flash * 0.55;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = 1;
      h.flash = Math.max(0, h.flash - 0.08);
    }

    // material detailing
    ctx.translate(b.position.x, b.position.y);
    ctx.lineWidth = 1.5;
    if (h.shape === 'circle') {
      // fixed light highlight, plus a marker that shows the ball rolling
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(-h.r * 0.2, -h.r * 0.2, h.r * 0.6, Math.PI * 0.85, Math.PI * 1.55);
      ctx.stroke();
      ctx.rotate(b.angle);
      ctx.fillStyle = h.mat === 'glass' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(h.r * 0.55, 0, Math.max(2, h.r * 0.14), 0, Math.PI * 2);
      ctx.fill();
    } else if (h.shape === 'poly') {
      ctx.rotate(b.angle);
      if (h.mat === 'glass') {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(-h.r * 0.3, -h.r * 0.25);
        ctx.lineTo(h.r * 0.15, h.r * 0.35);
        ctx.moveTo(-h.r * 0.1, -h.r * 0.3);
        ctx.lineTo(h.r * 0.3, h.r * 0.2);
        ctx.stroke();
      } else if (h.mat === 'stone') {
        ctx.strokeStyle = 'rgba(8,10,22,0.55)';
        ctx.beginPath();
        ctx.moveTo(-h.r * 0.4, -h.r * 0.1);
        ctx.lineTo(h.r * 0.4, -h.r * 0.1);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.arc(0, 0, h.r * 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.rotate(b.angle);
      if (h.mat === 'glass') {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(-h.w * 0.28, -h.h * 0.34);
        ctx.lineTo(h.w * 0.1, h.h * 0.34);
        ctx.moveTo(-h.w * 0.08, -h.h * 0.34);
        ctx.lineTo(h.w * 0.24, h.h * 0.34);
        ctx.stroke();
      } else if (h.mat === 'stone') {
        ctx.strokeStyle = 'rgba(8,10,22,0.55)';
        ctx.beginPath();
        ctx.moveTo(-h.w * 0.5 + 4, -h.h * 0.16);
        ctx.lineTo(h.w * 0.5 - 4, -h.h * 0.16);
        ctx.moveTo(-h.w * 0.16, -h.h * 0.16);
        ctx.lineTo(-h.w * 0.16, h.h * 0.5 - 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(-h.w / 2 + 5, -h.h / 2 + 5, h.w - 10, h.h - 10);
      }
    }
    ctx.restore();
  }

  function drawStatic(b) {
    const h = b.hoc;
    ctx.fillStyle = '#12162b';
    ctx.strokeStyle = 'rgba(110,130,220,0.35)';
    ctx.lineWidth = 2;
    tracePath(b.vertices);
    ctx.fill();
    ctx.stroke();
    // glowing top edge
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.strokeStyle = 'rgba(122,247,255,0.35)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-h.w / 2 + 3, -h.h / 2 + 1.5);
    ctx.lineTo(h.w / 2 - 3, -h.h / 2 + 1.5);
    ctx.stroke();
    ctx.restore();
  }

  function killLine(x0, y0, x1, y1, pulse) {
    ctx.save();
    ctx.shadowColor = '#ff4aa0';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = `rgba(255,96,178,${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  function drawKillZone(tSec) {
    const pulse = 0.55 + Math.sin(tSec * 2.4) * 0.15;
    if (mode.kill === 'bottom') {
      ctx.fillStyle = '#080a16';
      ctx.fillRect(-220, GROUND_TOP, W + 440, H - GROUND_TOP + 220);
      const g = ctx.createLinearGradient(0, GROUND_TOP - 70, 0, GROUND_TOP);
      g.addColorStop(0, 'rgba(255,70,160,0)');
      g.addColorStop(1, `rgba(255,70,160,${0.1 * pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, GROUND_TOP - 70, W, 70);
      killLine(-220, GROUND_TOP, W + 220, GROUND_TOP, pulse);
    } else if (mode.kill === 'top') {
      ctx.fillStyle = '#080a16';
      ctx.fillRect(-220, -220, W + 440, KILL_TOP + 220);
      const g = ctx.createLinearGradient(0, KILL_TOP + 70, 0, KILL_TOP);
      g.addColorStop(0, 'rgba(255,70,160,0)');
      g.addColorStop(1, `rgba(255,70,160,${0.1 * pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, KILL_TOP, W, 70);
      killLine(-220, KILL_TOP, W + 220, KILL_TOP, pulse);
    } else if (mode.kill === 'right') {
      ctx.fillStyle = '#080a16';
      ctx.fillRect(KILL_RIGHT, -220, W - KILL_RIGHT + 440, H + 440);
      const g = ctx.createLinearGradient(KILL_RIGHT - 70, 0, KILL_RIGHT, 0);
      g.addColorStop(0, 'rgba(255,70,160,0)');
      g.addColorStop(1, `rgba(255,70,160,${0.1 * pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(KILL_RIGHT - 70, 0, 70, H);
      killLine(KILL_RIGHT, -220, KILL_RIGHT, H + 220, pulse);
    } else if (mode.kill === 'ring') {
      const rg = mode.ring;
      ctx.save();
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -tSec * 26;
      ctx.shadowColor = '#ff4aa0';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = `rgba(255,96,178,${pulse})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r - 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (mode.kill === 'deck') {
      const d = mode.deck;
      ctx.save();
      ctx.fillStyle = '#0e1328';
      ctx.beginPath();
      ctx.roundRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,140,255,0.08)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let gx = d.x0 + 75; gx < d.x1; gx += 75) {
        ctx.moveTo(gx, d.y0 + 8);
        ctx.lineTo(gx, d.y1 - 8);
      }
      for (let gy = d.y0 + 75; gy < d.y1; gy += 75) {
        ctx.moveTo(d.x0 + 8, gy);
        ctx.lineTo(d.x1 - 8, gy);
      }
      ctx.stroke();
      ctx.shadowColor = '#ff4aa0';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = `rgba(255,96,178,${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, 18);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawLauncher(tSec) {
    const { x, y } = LAUNCH_POS;
    ctx.save();
    ctx.strokeStyle = 'rgba(122,247,255,0.75)';
    ctx.shadowColor = '#7af7ff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 26 + Math.sin(tSec * 2.2) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, 38 + Math.sin(tSec * 2.2 + 1) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (!aim) drawBall(x, y, selectedBall, true, 0, tSec);
  }

  function previewStop(x, y) {
    if (x > W + 30 || x < -30 || y < -30 || y > H + 30) return true;
    if (mode.kill === 'bottom') return y > GROUND_TOP - 6;
    if (mode.kill === 'top') return y < KILL_TOP + 6;
    if (mode.kill === 'right') return x > KILL_RIGHT - 6;
    if (mode.kill === 'ring') {
      const rg = mode.ring;
      const dx = x - rg.x;
      const dy = y - rg.y;
      return dx * dx + dy * dy > rg.r * rg.r;
    }
    return false;
  }

  function drawAim() {
    const a = computeAim();
    if (!a) return;
    const { x, y } = LAUNCH_POS;

    // pulled-back ghost ball and rubber band
    const pull = 18 + a.p01 * 46;
    const px = x - a.dir.x * pull;
    const py = y - a.dir.y * pull;
    ctx.strokeStyle = 'rgba(122,247,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(px, py);
    ctx.stroke();
    drawBall(px, py, selectedBall, true);

    // power ring around the launcher
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = a.p01 > 0.85 ? '#ff5da2' : '#7af7ff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, 48, -Math.PI / 2, -Math.PI / 2 + a.p01 * Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // trajectory preview (gravity only, matches the real launch)
    let sx = x;
    let sy = y;
    let vx = a.dir.x * a.speed;
    let vy = a.dir.y * a.speed;
    ctx.fillStyle = BALL_SKIN[selectedBall].glow;
    for (let i = 0; i < 90; i++) {
      sx += vx;
      sy += vy;
      vx += gStepX;
      vy += gStepY;
      if (previewStop(sx, sy)) break;
      if (i % 4 === 2) {
        ctx.globalAlpha = Math.max(0.08, 0.7 - i * 0.008);
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(2, 5 - i * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Per-chapter scenery: a planet and a nebula tint.
  const CH_THEMES = [
    { px: 1380, py: 160, pr: 64, c1: '#4b3b7a', c2: '#191343', ring: true, neb: 'rgba(130,90,255,0.05)', nx: 420, ny: 260 },
    { px: 240, py: 170, pr: 92, c1: '#1d3f72', c2: '#0b1530', ring: false, neb: 'rgba(70,160,255,0.05)', nx: 1220, ny: 630 },
    { px: 1430, py: 120, pr: 54, c1: '#6b2f55', c2: '#241026', ring: true, neb: 'rgba(255,110,190,0.045)', nx: 320, ny: 520 },
    { px: 260, py: 680, pr: 76, c1: '#2f5a4c', c2: '#0f241e', ring: false, neb: 'rgba(110,255,200,0.04)', nx: 1260, ny: 210 },
    { px: 1220, py: 640, pr: 112, c1: '#5a2f2f', c2: '#1d0f0f', ring: true, neb: 'rgba(255,140,110,0.045)', nx: 500, ny: 190 },
  ];

  function drawSpace(t) {
    let g = ctx.createRadialGradient(t.nx, t.ny, 40, t.nx, t.ny, 420);
    g.addColorStop(0, t.neb);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(t.nx - 430, t.ny - 430, 860, 860);
    g = ctx.createRadialGradient(t.px - t.pr * 0.35, t.py - t.pr * 0.4, t.pr * 0.2, t.px, t.py, t.pr);
    g.addColorStop(0, t.c1);
    g.addColorStop(1, t.c2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(t.px, t.py, t.pr, 0, Math.PI * 2);
    ctx.fill();
    if (t.ring) {
      ctx.save();
      ctx.translate(t.px, t.py);
      ctx.rotate(-0.35);
      ctx.strokeStyle = 'rgba(190,200,255,0.22)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(0, 0, t.pr * 1.65, t.pr * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- gravity field background ----------
  // Ambient motes that make the gravity field readable at a glance: they stream
  // along the gravity vector, or float freely when there is no gravity.
  const FIELD_MOTES = Array.from({ length: 56 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    s: 0.5 + Math.random(),
    ph: Math.random() * Math.PI * 2,
  }));

  function drawGravityField(tSec) {
    const gx = mode.gravity.x;
    const gy = mode.gravity.y;
    ctx.save();
    if (gx || gy) {
      // streaks of dust falling with gravity
      ctx.strokeStyle = '#7af7ff';
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.4;
      for (const m of FIELD_MOTES) {
        const d = tSec * 60 * m.s;
        const x = (((m.x + gx * d) % W) + W) % W;
        const y = (((m.y + gy * d) % H) + H) % H;
        const len = 10 + 14 * m.s;
        ctx.globalAlpha = 0.05 + 0.06 * m.s;
        ctx.beginPath();
        ctx.moveTo(x - gx * len, y - gy * len);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      // faint chevron wave travelling in the gravity direction
      const ang = Math.atan2(gy, gx);
      const SP = 230;
      ctx.lineWidth = 3;
      for (let yy = SP / 2; yy < H; yy += SP) {
        for (let xx = SP / 2; xx < W; xx += SP) {
          const along = xx * gx + yy * gy;
          const wave = 0.5 + 0.5 * Math.sin((along - tSec * 130) * 0.012);
          ctx.globalAlpha = 0.03 + 0.09 * wave;
          ctx.save();
          ctx.translate(xx, yy);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(-9, -14);
          ctx.lineTo(5, 0);
          ctx.lineTo(-9, 14);
          ctx.moveTo(-23, -14);
          ctx.lineTo(-9, 0);
          ctx.lineTo(-23, 14);
          ctx.stroke();
          ctx.restore();
        }
      }
    } else {
      // zero gravity: dust drifts aimlessly in tiny loops
      ctx.fillStyle = '#9fd8ff';
      for (const m of FIELD_MOTES) {
        const x = m.x + Math.cos(tSec * 0.3 * m.s + m.ph) * 16;
        const y = m.y + Math.sin(tSec * 0.24 * m.s + m.ph) * 16;
        ctx.globalAlpha = 0.07 + 0.05 * Math.sin(tSec * m.s + m.ph);
        ctx.beginPath();
        ctx.arc(x, y, 1.1 + m.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function render(tSec) {
    // letterbox background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04050b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const s = view.dpr * view.scale;
    ctx.setTransform(s, 0, 0, s,
      view.dpr * (view.ox + shakeX * view.scale),
      view.dpr * (view.oy + shakeY * view.scale));

    // sky
    if (!bgGrad) {
      bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#0c1126');
      bgGrad.addColorStop(0.65, '#070a18');
      bgGrad.addColorStop(1, '#04050c');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(-220, -120, W + 440, H + 340);

    // stars
    for (const st of stars) {
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(tSec * st.tw + st.ph);
      ctx.fillStyle = '#cfe2ff';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawSpace(CH_THEMES[LEVELS[levelIndex].chapter]);
    drawGravityField(tSec);

    for (const b of statics) drawStatic(b);
    drawKillZone(tSec);
    drawLauncher(tSec);
    for (const b of blocks) drawBlock(b);

    for (const b of balls) {
      const h = b.hoc;
      const skin = BALL_SKIN[h.kind];
      const tr = h.trail;
      if (h.kind === 'bullet' && tr.length > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 1; i < tr.length; i++) {
          const k = i / tr.length;
          ctx.globalAlpha = k * 0.5;
          ctx.strokeStyle = skin.glow;
          ctx.lineWidth = 1 + 5 * k;
          ctx.beginPath();
          ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
          ctx.lineTo(tr[i].x, tr[i].y);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        for (let i = 0; i < tr.length; i++) {
          const k = (i + 1) / tr.length;
          ctx.globalAlpha = k * (h.kind === 'bowling' ? 0.14 : 0.22);
          ctx.fillStyle = skin.glow;
          ctx.beginPath();
          ctx.arc(tr[i].x, tr[i].y, 2 + BALLS[h.kind].r * 0.65 * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      drawBall(b.position.x, b.position.y, h.kind, false, b.angle, tSec);
    }

    drawAim();
    FX.draw(ctx);

    // vignette (screen space)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!vignette) {
      vignette = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.35,
        canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.72
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(1,2,8,0.55)');
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ---------- main loop ----------
  let lastT = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dtMs = now - lastT;
    lastT = now;
    if (dtMs > 100) dtMs = 100;

    const dt = dtMs / 1000;
    if (freezeMs > 0) {
      // hit-stop: the world pauses for a beat on big impacts
      freezeMs -= dtMs;
      FX.update(dt * 0.12);
      updateShake(dt);
      render(now / 1000);
      return;
    }
    const ts = slowmo > 0 ? 0.3 : 1;
    if (slowmo > 0) slowmo = Math.max(0, slowmo - dt);
    acc += dtMs * ts;
    while (acc >= STEP) {
      physicsStep();
      acc -= STEP;
    }

    FX.update(dt * ts);
    updateShake(dt);
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 0;
    }
    if (state === 'won' && winTimer > 0) {
      winTimer -= dt;
      if (winTimer <= 0) {
        winTimer = -1;
        showWin();
      }
    }

    render(now / 1000);
  }

  // ---------- start ----------
  const firstIndex = Math.min(save.unlocked, LEVELS.length) - 1;
  bannerChapter = LEVELS[firstIndex].chapter; // suppress the banner behind the start page
  loadLevel(firstIndex);
  openStart();
  requestAnimationFrame(frame);
})();

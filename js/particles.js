// House of Cards — lightweight particle/FX system (purely visual, not part of the physics world).
const FX = (() => {
  const parts = [];
  const rings = [];
  const texts = [];
  const flashes = [];
  const GRAV = 1500; // px/s^2
  const R = (a, b) => a + Math.random() * (b - a);

  // Debris chunks that tumble with gravity (block fragments).
  function shards(x, y, color, count, power = 1, glass = false) {
    for (let i = 0; i < count; i++) {
      const a = R(0, Math.PI * 2);
      const sp = R(60, 420) * power;
      parts.push({
        kind: 'shard',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - R(60, 240) * power,
        rot: R(0, Math.PI),
        vr: R(-9, 9),
        w: glass ? R(3, 9) : R(4, 13),
        h: glass ? R(2, 5) : R(3, 8),
        life: R(0.5, glass ? 0.9 : 1.2),
        t: 0,
        color,
        glass,
      });
    }
  }

  // Additive glowing dots that burst outward.
  function sparks(x, y, color, count, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = R(0, Math.PI * 2);
      const sp = R(40, 520) * power;
      parts.push({
        kind: 'spark',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: R(1, 3.5),
        life: R(0.2, 0.55),
        t: 0,
        color,
      });
    }
  }

  function ring(x, y, color, maxR = 60) {
    rings.push({ x, y, color, maxR, t: 0, life: 0.35 });
  }

  // Bright expanding glow pop, drawn additively.
  function flash(x, y, maxR, color) {
    flashes.push({ x, y, maxR, color, t: 0, life: 0.17 });
  }

  const CONFETTI = ['#ff5d73', '#ffb347', '#ffe15a', '#6dff8f', '#4fc3f7', '#b388ff', '#ff7ad9'];

  function confetti(x, y, count) {
    for (let i = 0; i < count; i++) {
      parts.push({
        kind: 'shard',
        light: true,
        x: x + R(-30, 30),
        y: y + R(-20, 20),
        vx: R(-280, 280),
        vy: R(-560, -140),
        rot: R(0, Math.PI),
        vr: R(-14, 14),
        w: R(5, 10),
        h: R(3, 6),
        life: R(1.2, 2.3),
        t: 0,
        color: CONFETTI[(Math.random() * CONFETTI.length) | 0],
        glass: false,
      });
    }
  }

  function text(x, y, str, color = '#ffd76a', size = 30) {
    texts.push({ x, y, str, color, size, t: 0, life: 0.95 });
  }

  function update(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t >= p.life) {
        parts.splice(i, 1);
        continue;
      }
      if (p.kind === 'shard') {
        p.vy += GRAV * (p.light ? 0.4 : 1) * dt;
        if (p.light) {
          p.vx *= 0.995;
          p.vy *= 0.995;
        }
        p.rot += p.vr * dt;
      } else {
        p.vx *= 0.96;
        p.vy *= 0.96;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t >= rings[i].life) rings.splice(i, 1);
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      flashes[i].t += dt;
      if (flashes[i].t >= flashes[i].life) flashes.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const tx = texts[i];
      tx.t += dt;
      tx.y -= 42 * dt;
      if (tx.t >= tx.life) texts.splice(i, 1);
    }
  }

  function draw(ctx) {
    for (const p of parts) {
      const a = 1 - p.t / p.life;
      if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = a * (p.glass ? 0.85 : 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      } else {
        ctx.globalAlpha = a;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    for (const r of rings) {
      const k = r.t / r.life;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6 + r.maxR * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const f of flashes) {
      const k = f.t / f.life;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.maxR * (0.35 + 0.65 * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const tx of texts) {
      const k = tx.t / tx.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = tx.color;
      ctx.font = `800 ${tx.size}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tx.str, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  function clear() {
    parts.length = 0;
    rings.length = 0;
    texts.length = 0;
    flashes.length = 0;
  }

  return { shards, sparks, ring, flash, confetti, text, update, draw, clear };
})();

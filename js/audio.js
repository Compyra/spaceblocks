// House of Cards — synthesized sound effects via Web Audio API (no audio assets needed).
const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  const last = Object.create(null);

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function throttled(key, ms) {
    const now = performance.now();
    if (last[key] && now - last[key] < ms) return true;
    last[key] = now;
    return false;
  }

  function noiseBuffer(dur) {
    const n = Math.max(1, Math.floor(dur * ctx.sampleRate));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function envGain(t, peak, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    return g;
  }

  // Filtered noise burst.
  function burst(t, dur, peak, filterType, f0, f1, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    src.connect(f);
    f.connect(envGain(t, peak, dur));
    src.start(t);
    src.stop(t + dur + 0.06);
  }

  // Pitched oscillator blip.
  function tone(t, dur, peak, type, f0, f1) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(envGain(t, peak, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const R = (a, b) => a + Math.random() * (b - a);

  return {
    unlock() {
      ensure();
    },

    toggle() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      return !muted;
    },

    get on() {
      return !muted;
    },

    launch(p, kind = 'cannon') {
      if (muted || !ensure()) return;
      const t = ctx.currentTime;
      if (kind === 'bowling') {
        burst(t, 0.32, 0.26 + 0.2 * p, 'bandpass', 260, 80, 1.1);
        tone(t, 0.2, 0.3, 'sine', 120, 42);
      } else if (kind === 'bullet') {
        burst(t, 0.15, 0.24 + 0.2 * p, 'bandpass', 1600 + 600 * p, 320, 1.6);
        tone(t, 0.09, 0.12, 'square', 880, 220);
      } else if (kind === 'bomb') {
        burst(t, 0.28, 0.2 + 0.22 * p, 'bandpass', 500 + 900 * p, 140, 1.4);
        burst(t, 0.4, 0.07, 'highpass', 3200, 1800, 0.6); // fuse hiss
        tone(t, 0.14, 0.16, 'sine', 150, 55);
      } else {
        burst(t, 0.28, 0.2 + 0.25 * p, 'bandpass', 500 + 900 * p, 140, 1.4);
        tone(t, 0.14, 0.18, 'sine', 170 + 60 * p, 58);
      }
    },

    thud(mat, k) {
      if (muted || !ensure() || throttled('thud' + mat, 45)) return;
      const t = ctx.currentTime;
      const v = Math.min(1, k);
      if (mat === 'glass') {
        tone(t, 0.05, 0.04 + 0.1 * v, 'sine', R(1500, 2200), 900);
      } else if (mat === 'stone') {
        tone(t, 0.1, 0.1 + 0.24 * v, 'sine', 85, 40);
        burst(t, 0.08, 0.09 * v, 'lowpass', 260, 90);
      } else {
        tone(t, 0.07, 0.08 + 0.22 * v, 'triangle', R(95, 150), 55);
      }
    },

    bounce(k) {
      if (muted || !ensure() || throttled('bounce', 60)) return;
      tone(ctx.currentTime, 0.08, 0.05 + 0.12 * Math.min(1, k), 'sine', 140, 70);
    },

    shatter(mat) {
      if (muted || !ensure() || throttled('shatter' + mat, 30)) return;
      const t = ctx.currentTime;
      if (mat === 'glass') {
        burst(t, 0.24, 0.28, 'highpass', 1800, 2600, 0.7);
        for (let i = 0; i < 4; i++) {
          tone(t + i * 0.016, R(0.08, 0.2), 0.11, 'sine', R(1600, 4200), R(900, 1400));
        }
      } else if (mat === 'stone') {
        tone(t, 0.24, 0.4, 'sine', 62, 28);
        burst(t, 0.3, 0.28, 'lowpass', 420, 90);
      } else {
        burst(t, 0.16, 0.28, 'highpass', 500, 900, 0.8);
        tone(t, 0.12, 0.24, 'triangle', 160, 60);
        burst(t, 0.1, 0.14, 'lowpass', 300, 100);
      }
    },

    explosion() {
      if (muted || !ensure() || throttled('boom', 80)) return;
      const t = ctx.currentTime;
      tone(t, 0.5, 0.5, 'sine', 95, 24);
      burst(t, 0.45, 0.4, 'lowpass', 700, 60);
      burst(t + 0.02, 0.22, 0.18, 'highpass', 900, 2600, 0.6);
      tone(t, 0.08, 0.28, 'square', 60, 38);
    },

    // Rising ping for each extra block in a combo chain.
    combo(n) {
      if (muted || !ensure() || throttled('combo', 50)) return;
      const steps = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
      const f = 660 * Math.pow(2, steps[Math.min(n - 2, steps.length - 1)] / 12);
      tone(ctx.currentTime, 0.14, 0.1, 'sine', f, f);
      tone(ctx.currentTime, 0.1, 0.05, 'triangle', f * 2, f * 2);
    },

    win() {
      if (muted || !ensure()) return;
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone(t + i * 0.09, 0.35, 0.15, 'triangle', f, f);
      });
    },

    click() {
      if (muted || !ensure()) return;
      tone(ctx.currentTime, 0.05, 0.08, 'sine', 700, 500);
    },
  };
})();

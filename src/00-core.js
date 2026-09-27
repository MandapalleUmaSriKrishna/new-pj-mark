/* ================================================================
   CHEESE CHASE — core: utils, save, input, sound  (fully offline)
   ================================================================ */
'use strict';
const CC = window.CC = {};

CC.TAU = Math.PI * 2;
CC.clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
CC.lerp = (a, b, t) => a + (b - a) * t;
CC.rand = (a, b) => a + Math.random() * (b - a);
CC.randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
CC.choice = arr => arr[Math.floor(Math.random() * arr.length)];
CC.dist2d = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);
CC.fmtTime = s => {
  if (s == null || !isFinite(s)) return '—';
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
};
CC.$ = id => document.getElementById(id);

CC.show = id => CC.$(id).classList.add('active');
CC.hide = id => CC.$(id).classList.remove('active');

let toastTimer = null;
CC.toast = (msg, ms = 2200) => {
  const t = CC.$('toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
};

CC.flash = (txt, ms = 900) => {
  const f = CC.$('flash');
  f.querySelector('.txt').textContent = txt;
  f.classList.add('active');
  const inner = f.querySelector('.txt');
  inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = '';
  clearTimeout(f._t);
  f._t = setTimeout(() => f.classList.remove('active'), ms);
};

/* ---------------- Save (localStorage, safe on file://) ---------------- */
CC.Save = {
  KEY: 'cheeseChase.save.v1',
  data: { unl3: 1, unl2: 1, best: {}, muted: false, music: true },
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          this.data.unl3 = Math.max(1, d.unl3 | 0);
          this.data.unl2 = Math.max(1, d.unl2 | 0);
          this.data.best = d.best || {};
          this.data.muted = !!d.muted;
          this.data.music = d.music !== false;
        }
      }
    } catch (e) { /* private mode / file:// restriction — play without saving */ }
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) {} },
  unlock(mode, idx) { // mode: '3d' | '2d'; idx is the NEXT level index unlocked (count)
    const k = mode === '3d' ? 'unl3' : 'unl2';
    if (idx > this.data[k]) { this.data[k] = idx; this.save(); }
  },
  unlocked(mode) { return mode === '3d' ? this.data.unl3 : this.data.unl2; },
  setBest(id, sec) {
    if (this.data.best[id] == null || sec < this.data.best[id]) {
      this.data.best[id] = sec; this.save(); return true;
    }
    return false;
  },
  getBest(id) { return this.data.best[id]; }
};

/* ---------------- Input (keyboard + touch) ---------------- */
CC.Input = {
  keys: {},
  touch: false,
  joy: { x: 0, y: 0, active: false },
  _jumpQueued: false,
  _jumpHeld: false,
  sprintTouch: false,

  init() {
    addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      const k = e.key.toLowerCase();
      if (!this.keys[k]) { // fresh press
        if (k === ' ') this._jumpQueued = true;
        if (k === 'p' || k === 'escape') CC.onKeyPause && CC.onKeyPause();
        if (k === 'r') CC.onKeyRestart && CC.onKeyRestart();
        if (k === 'm') CC.onKeyMute && CC.onKeyMute();
      }
      this.keys[k] = true;
    });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { this.keys = {}; this.joy.active = false; this.joy.x = this.joy.y = 0; });

    // touch detection + controls
    const setTouch = () => {
      if (!this.touch) {
        this.touch = true;
        if (CC.playing) CC.$('touch').classList.add('active');
      }
    };
    addEventListener('touchstart', setTouch, { once: true, passive: true });
    if (matchMedia && matchMedia('(pointer:coarse)').matches) setTouch();

    this._bindJoy();
    this._bindBtn('tb-jump', down => { if (down) this._jumpQueued = true; this._jumpHeld = down; });
    this._bindBtn('tb-sprint', down => { this.sprintTouch = down; });
  },

  _bindJoy() {
    const joy = CC.$('tjoy'), knob = CC.$('tjoy-knob');
    let id = null, cx = 0, cy = 0;
    const R = 46;
    const move = t => {
      const dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy) || 1, m = Math.min(d, R);
      const nx = dx / d * m, ny = dy / d * m;
      knob.style.transform = `translate(${nx}px,${ny}px)`;
      this.joy.x = nx / R; this.joy.y = ny / R;
      this.joy.active = Math.hypot(this.joy.x, this.joy.y) > 0.18;
    };
    joy.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0]; id = t.identifier;
      const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(t);
    }, { passive: false });
    joy.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) move(t);
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) if (t.identifier === id) {
        id = null; this.joy.x = this.joy.y = 0; this.joy.active = false;
        knob.style.transform = 'translate(0,0)';
      }
    };
    joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end);
  },

  _bindBtn(id, cb) {
    const el = CC.$(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); cb(true); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); cb(false); }, { passive: false });
    el.addEventListener('touchcancel', () => cb(false));
  },

  /* movement axis, screen-relative: x right, z "down screen" */
  axis() {
    let x = 0, z = 0;
    if (this.keys['a'] || this.keys['arrowleft']) x -= 1;
    if (this.keys['d'] || this.keys['arrowright']) x += 1;
    if (this.keys['w'] || this.keys['arrowup']) z -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) z += 1;
    if (this.joy.active) { x = this.joy.x; z = this.joy.y; }
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    return { x, z, len: Math.min(1, l) };
  },
  jumpHeld() { return !!this.keys[' '] || this._jumpHeld; },
  consumeJump() { const j = this._jumpQueued; this._jumpQueued = false; return j; },
  sprint() { return !!(this.keys['shift'] || this.sprintTouch); }
};

/* ---------------- SFX: procedural WebAudio (no files!) ---------------- */
CC.SFX = {
  ctx: null, master: null, musicGain: null,
  muted: false, musicOn: true, _musicTimer: null, _musicStep: 0, _nextNote: 0,

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
    } catch (e) { this.ctx = null; }
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  },

  tone(type, f0, f1, t0, dur, vol, dest) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime + (t0 || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise(t0, dur, vol, hp) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime + (t0 || 0);
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = vol;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 500;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },

  play(name) {
    this.ensure();
    if (!this.ctx) return;
    switch (name) {
      case 'squeak':  this.tone('sine', 900, 1500, 0, 0.09, 0.35); break;
      case 'jump':    this.tone('square', 300, 640, 0, 0.12, 0.12); break;
      case 'land':    this.noise(0, 0.05, 0.10, 300); break;
      case 'pickup':  this.tone('triangle', 740, 740, 0, 0.07, 0.30); this.tone('triangle', 1180, 1180, 0.07, 0.10, 0.30); break;
      case 'trap':    this.noise(0, 0.08, 0.5, 1200); this.tone('square', 180, 90, 0, 0.15, 0.30); break;
      case 'meow':    this.tone('sawtooth', 520, 210, 0, 0.42, 0.22); this.tone('sawtooth', 780, 300, 0.05, 0.35, 0.10); break;
      case 'hiss':    this.noise(0, 0.30, 0.16, 2500); break;
      case 'caught':  this.tone('square', 300, 120, 0, 0.3, 0.25); this.noise(0, 0.2, 0.2, 200); break;
      case 'win':     [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, i * 0.11, 0.16, 0.30)); break;
      case 'lose':    [392, 330, 262, 196].forEach((f, i) => this.tone('square', f, f, i * 0.14, 0.2, 0.20)); break;
      case 'click':   this.tone('sine', 600, 500, 0, 0.05, 0.20); break;
      case 'open':    this.tone('triangle', 400, 900, 0, 0.25, 0.25); break;
      case 'check':   this.tone('triangle', 620, 620, 0, 0.08, 0.25); this.tone('triangle', 930, 930, 0.08, 0.12, 0.25); break;
    }
  },

  /* tiny looping cartoon tune — 16-step sequencer */
  startMusic() {
    this.ensure();
    if (!this.ctx || this._musicTimer) return;
    const BPM = 108, stepDur = 60 / BPM / 2; // 8th notes
    const bass = [130.8, 0, 130.8, 0, 98.0, 0, 98.0, 0, 110.0, 0, 110.0, 0, 98.0, 0, 116.5, 0];
    const lead = [
      523.3, 0, 659.3, 523.3, 0, 392.0, 0, 440.0,
      523.3, 0, 587.3, 523.3, 0, 392.0, 0, 349.2
    ];
    const lead2 = [
      659.3, 0, 784.0, 659.3, 0, 523.3, 0, 587.3,
      698.5, 0, 659.3, 587.3, 523.3, 0, 493.9, 0
    ];
    let bar = 0;
    this._musicStep = 0; this._nextNote = this.ctx.currentTime + 0.1;
    const schedule = () => {
      if (!this.ctx) return;
      while (this._nextNote < this.ctx.currentTime + 0.25) {
        const s = this._musicStep % 16;
        const dt = this._nextNote - this.ctx.currentTime;
        if (!this.muted && this.musicOn) {
          if (bass[s]) this.tone('square', bass[s], bass[s], dt, stepDur * 0.9, 0.20, this.musicGain);
          const L = (bar % 2 === 1) ? lead2[s] : lead[s];
          if (L) this.tone('triangle', L, L, dt, stepDur * 0.8, 0.30, this.musicGain);
          if (s % 4 === 2) this.noise(dt, 0.03, 0.05, 6000);
        }
        this._nextNote += stepDur;
        this._musicStep++;
        if (this._musicStep % 16 === 0) bar++;
      }
    };
    this._musicTimer = setInterval(schedule, 90);
  },
  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  },
  setMusic(on) { this.musicOn = on; }
};

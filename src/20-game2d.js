/* ================================================================
   CHEESE CHASE — 2D platformer worlds (Canvas 2D, vector cartoon art)
   ================================================================ */
'use strict';
(() => {
  const G2 = CC.G2 = {};
  const clamp = CC.clamp, lerp = CC.lerp;
  const T = 40; // tile size (world px)

  /* ---------------- Level maps ----------------
     #  solid block        =  thin platform (one-way)
     C  cheese             T  mousetrap
     F  checkpoint flag    S  start
     H  exit mouse hole    .  empty                    */
  const MAPS = {};

  MAPS.living = {
    id: '2d-living', name: 'Living Room Run', icon: '🛋️', theme: 'room',
    desc: 'Hop the furniture — the cat is coming!',
    map: [
      '........................................................................................................................',
      '........................................................................................................................',
      '..................C.C..........................C..C.C.......................................C..C.C...................',
      '.................====..........................======.................................============..................',
      '........................................................................................................................',
      '..........C..........................C.C.......................C.C..................C.C..........................',
      '.......======.......................=====......................=====.................=====..........................',
      '..................................................................................C..................................',
      '.................................................................................===..................................',
      '......C...........................C..........................C....................................C.C...............',
      '...............................===========..................................============................====........',
      '........................................................................................................................',
      '..S.........T..............F......................T..................C.C..........F.......................T......H.',
      '####################...##############...####################...#############...######################...#############',
      '####################...##############...####################...#############...######################...#############'
    ]
  };

  MAPS.kitchen = {
    id: '2d-kitchen', name: 'Kitchen Climb', icon: '🍳', theme: 'kitchen',
    desc: 'Climb the counters, dodge the traps.',
    map: [
      '.........................................................................................................................',
      '.......................................................C.C.............................................................',
      '......................................................=====.............................................................',
      '...............C.C.................................................C.C................................................',
      '..............=====......................C.C......................======...............................................',
      '........................................=====.................................C.C......................................',
      '.............................................................................=====.....................................',
      '.......C.C...................................C.......................................C.................................',
      '......=====................................=====...............................................C.C.....................',
      '............................................................................................====.........................',
      '....C...................................................................................................................',
      '..=====...............C.C.....................C.C..................C.C..................C.C................................',
      '..................................................................................................................H......',
      '..S...........T...............F...........T...................T..............F...........T....................T..........',
      '####################...##################...##################...################...##################...##############',
      '####################...##################...##################...################...##################...##############'
    ]
  };

  MAPS.garden = {
    id: '2d-garden', name: 'Garden Gala', icon: '🌳', theme: 'garden',
    desc: 'Trees, hedges & a sunset sprint!',
    map: [
      '...................................................................................................................................',
      '..........................C.C.......................................C.C..........................................................',
      '..........................=====.....................................=====..........................................................',
      '.......................C......................................C...........................................C.C......................',
      '......................====..................................=====..........................................=====....................',
      '...........C.C..............................................................C.C..................................................',
      '..........=====............................................................=====..................................................',
      '......................C.......................C.............................................C.....................................',
      '.....................====.....................====...........................................====...............................',
      '........C..............................................C.C.......................C.............................................',
      '.......====...........................................=====......................====...........................................',
      '....C...............................C...........................C.......................C......................F...............',
      '.............................................................................................................................H.',
      '..S.........T.............F...................T..........................T......................T....................T...........',
      '####################...#############...##################...##############...################...#####################...###########',
      '####################...#############...##################...##############...################...#####################...###########'
    ]
  };

  G2.DEFS = [MAPS.living, MAPS.kitchen, MAPS.garden];

  /* ---------------- utils ---------------- */
  function rr(c, x, y, w, h, r) { // rounded rect path
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ---------------- Game ---------------- */
  class Game2D {
    constructor(canvas, def, opts = {}) {
      this.cv = canvas; this.c = canvas.getContext('2d');
      this.def = def; this.demo = !!opts.demo;
      this.onEvent = opts.onEvent || function () {};
      this.rows = def.map.map(r => r); // copy
      this.H = this.rows.length; this.W = Math.max(...this.rows.map(r => r.length));
      // pad rows
      this.rows = this.rows.map(r => r.padEnd(this.W, '.'));
      this.grid = [];
      this.cheese = []; this.traps = []; this.checkpoints = []; this.exit = null;
      for (let y = 0; y < this.H; y++) {
        this.grid.push([]);
        for (let x = 0; x < this.W; x++) {
          const ch = this.rows[y][x];
          let g = 0;
          if (ch === '#') g = 1;
          else if (ch === '=') g = 2;
          else if (ch === 'C') this.cheese.push({ x: x * T + T / 2, y: y * T + T / 2, taken: false, ph: Math.random() * 6 });
          else if (ch === 'T') this.traps.push({ x: x * T + T / 2, y: y * T + T - 6, sprung: false });
          else if (ch === 'F') this.checkpoints.push({ x: x * T + T / 2, y: y * T, on: false });
          else if (ch === 'S') this.start = { x: x * T + T / 2, y: y * T + T - 20 };
          else if (ch === 'H') this.exit = { x: x * T + T / 2, y: y * T + T - 20 };
          this.grid[y].push(g);
        }
      }
      this.lives = 3; this.deaths = 0; this.status = 'play';
      this.time = 0; this.cheeseGot = 0;
      this.particles = []; this.shake = 0;
      this.cam = { x: 0, y: 0 };
      this.pw = 26; this.ph = 24;
      this._reset(true);
    }

    _reset(full) {
      const p = this.p = {
        x: this.start.x, y: this.start.y, vx: 0, vy: 0,
        onGround: false, coyote: 0, jumps: 0, face: 1, phase: 0,
        invuln: 1.6, dead: 0, squash: 0, stun: 0
      };
      this.catBoostT = 0;
      this.checkpoint = full ? { x: this.start.x, y: this.start.y } : this.checkpoint;
      if (full) { this.catSpawnT = 1.6; this.time = 0; }
      else this.catSpawnT = 2.6;
      this.cat = null;
      this.catOn = false;
      if (full) { for (const c of this.cheese) c.taken = false; this.cheeseGot = 0; for (const t of this.traps) t.sprung = false; for (const f of this.checkpoints) f.on = false; }
      this.cam.x = p.x - 300; this.cam.y = 0;
    }

    _tile(tx, ty) {
      if (ty < 0 || ty >= this.H) return 0;
      if (tx < 0 || tx >= this.W) return 1; // walls at level edges
      return this.grid[ty][tx];
    }

    _solidAt(px, py) {
      return this._tile(Math.floor(px / T), Math.floor(py / T)) === 1;
    }

    update(dt) {
      if (this.status !== 'play') return;
      this.time += dt;
      const p = this.p, c = this.c;

      /* ---------- player ---------- */
      let ix = 0;
      if (!this.demo) {
        const a = CC.Input.axis();
        ix = a.x;
      }
      if (p.stun > 0) { p.stun -= dt; ix = 0; }
      const ACC = 2300, MAXV = 330;
      p.vx += ix * ACC * dt;
      p.vx = clamp(p.vx, -MAXV, MAXV);
      if (Math.abs(ix) < 0.15) p.vx *= Math.pow(0.0008, dt);
      if (ix !== 0 && Math.abs(ix) > 0.2) p.face = ix > 0 ? 1 : -1;

      // jump: buffer + coyote + double
      if (!this.demo && p.stun <= 0 && CC.Input.consumeJump()) {
        if (p.onGround || p.coyote > 0) { p.vy = -700; p.jumps = 1; p.coyote = 0; CC.SFX.play('jump'); this._puff(p.x, p.y + 12, 4); }
        else if (p.jumps < 2) { p.vy = -620; p.jumps = 2; CC.SFX.play('squeak'); this._puff(p.x, p.y + 10, 5); }
      }
      if (!CC.Input.jumpHeld() && p.vy < -260) p.vy = -260; // variable jump

      p.vy += 2050 * dt;
      p.vy = Math.min(p.vy, 900);

      // X move + collide
      p.x += p.vx * dt;
      {
        const x0 = p.x - this.pw / 2, x1 = p.x + this.pw / 2;
        const y0 = p.y - this.ph + 3, y1 = p.y;
        if (p.vx > 0 && (this._solidAt(x1, y0) || this._solidAt(x1, y1) || this._solidAt(x1, (y0 + y1) / 2))) {
          p.x = Math.floor(x1 / T) * T - this.pw / 2 - 0.1; p.vx = 0;
        } else if (p.vx < 0 && (this._solidAt(x0, y0) || this._solidAt(x0, y1) || this._solidAt(x0, (y0 + y1) / 2))) {
          p.x = (Math.floor(x0 / T) + 1) * T + this.pw / 2 + 0.1; p.vx = 0;
        }
      }
      // Y move + collide
      p.y += p.vy * dt;
      const wasG = p.onGround;
      p.onGround = false;
      {
        const x0 = p.x - this.pw / 2 + 3, x1 = p.x + this.pw / 2 - 3;
        const y0 = p.y - this.ph + 3, y1 = p.y;
        if (p.vy >= 0) {
          const ty = Math.floor(y1 / T);
          const solid = (px) => { const g = this._tile(Math.floor(px / T), ty); return g === 1 || g === 2; };
          const thinOk = (px) => { const g = this._tile(Math.floor(px / T), ty); return g === 2 && (y1 - p.vy * dt) <= ty * T + 1; };
          if ((solid(x0) && (this._tile(Math.floor(x0 / T), ty) === 1 || thinOk(x0))) || (solid(x1) && (this._tile(Math.floor(x1 / T), ty) === 1 || thinOk(x1)))) {
            if (this._tile(Math.floor(x0 / T), ty) === 1 || this._tile(Math.floor(x1 / T), ty) === 1 || thinOk(x0) || thinOk(x1)) {
              p.y = ty * T - 0.1; p.vy = 0; p.onGround = true;
            }
          }
        }
        if (p.vy < 0 && (this._solidAt(x0, y0) || this._solidAt(x1, y0))) {
          p.y = (Math.floor(y0 / T) + 1) * T + this.ph - 3 + 0.1; p.vy = 0;
        }
      }
      p.coyote = p.onGround ? 0.09 : Math.max(0, p.coyote - dt);
      if (p.onGround) { p.jumps = 0; if (!wasG && Math.abs(p.vy) < 10) { p.squash = 0.22; this._puff(p.x, p.y, 3); } }
      p.squash = Math.max(0, p.squash - dt * 2.4);
      p.phase += dt * (Math.abs(p.vx) / MAXV) * 13 + dt * 1.2;
      if (p.invuln > 0) p.invuln -= dt;

      /* ---------- cheese ---------- */
      for (const ch of this.cheese) {
        if (ch.taken) continue;
        if (Math.abs(p.x - ch.x) < 26 && Math.abs((p.y - 12) - ch.y) < 30) {
          ch.taken = true; this.cheeseGot++;
          CC.SFX.play('pickup');
          this._sparkle(ch.x, ch.y);
          this.onEvent('cheese', { got: this.cheeseGot, total: this.cheese.length });
          if (this.cheeseGot === this.cheese.length) {
            this.onEvent('toast', '🧀 All cheese! Reach the mouse hole! 🏠');
            CC.SFX.play('open');
          }
        }
      }

      /* ---------- traps: stun + the cat HEARS the snap ---------- */
      for (const tr of this.traps) {
        if (tr.sprung) continue;
        if (Math.abs(p.x - tr.x) < 16 && p.y > tr.y - 26 && p.y < tr.y + 14 && p.invuln <= 0 && p.stun <= 0) {
          tr.sprung = true;
          p.stun = 1.15; p.vx = 0;
          this.shake = 0.7;
          CC.SFX.play('trap');
          this._puff(tr.x, tr.y - 8, 8);
          this.onEvent('toast', 'SNAP! 😣 A mousetrap — Whiskers heard that!');
          this.catBoostT = 4.5;
          if (!this.catOn) this._spawnCat();
        }
      }

      /* ---------- checkpoints ---------- */
      for (const f of this.checkpoints) {
        if (!f.on && Math.abs(p.x - f.x) < 24 && Math.abs(p.y - f.y) < 70) {
          f.on = true; this.checkpoint = { x: f.x, y: f.y - 4 };
          CC.SFX.play('check');
          this.onEvent('toast', '🚩 Checkpoint!');
          this._sparkle(f.x, f.y - 30);
        }
      }

      /* ---------- the cat ---------- */
      this.catSpawnT -= dt;
      if (!this.catOn && this.catSpawnT <= 0 && p.x > this.start.x + 260) this._spawnCat();
      if (this.catBoostT > 0) this.catBoostT -= dt;
      if (this.catOn && this.cat) this._updateCat(dt);

      /* ---------- exit ---------- */
      if (this.exit && this.cheeseGot >= this.cheese.length &&
          Math.abs(p.x - this.exit.x) < 34 && Math.abs(p.y - this.exit.y) < 75) {
        this.status = 'complete';
        CC.SFX.play('win');
        this.onEvent('complete', { time: this.time, deaths: this.deaths });
        return;
      }

      /* ---------- fall out ---------- */
      if (p.y > this.H * T + 140) this._hurt('You fell! 😵');

      /* ---------- particles ---------- */
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const q = this.particles[i];
        q.life -= dt;
        if (q.life <= 0) { this.particles.splice(i, 1); continue; }
        q.vy += (q.grav || 0) * dt;
        q.x += q.vx * dt; q.y += q.vy * dt;
      }
      this.shake = Math.max(0, this.shake - dt * 2.2);

      /* ---------- camera ---------- */
      const tx = p.x + p.face * 90 - 300;
      this.cam.x = lerp(this.cam.x, clamp(tx, 0, this.W * T - 620), 1 - Math.exp(-dt * 4));
      const ty2 = clamp(p.y - 330, -80, Math.max(0, this.H * T - 540));
      this.cam.y = lerp(this.cam.y, ty2, 1 - Math.exp(-dt * 3));

      this.onEvent('tick', { time: this.time });
    }

    _spawnCat() {
      this.catOn = true;
      this.cat = { x: (this.cam ? this.cam.x : this.p.x) - 130, y: this.p.y - 60, vx: 0, vy: 0, phase: 0, wait: 0 };
      this.onEvent('toast', '😾 HERE COMES WHISKERS! RUN!');
      CC.SFX.play('hiss');
    }

    _updateCat(dt) {
      const p = this.p, k = this.cat;
      const chaseV = 300 + clamp((p.x - k.x) / 900, -0.4, 1) * 130 + (this.catBoostT > 0 ? 170 : 0); // rubber-band
      k.vx = lerp(k.vx, chaseV, 1 - Math.exp(-dt * 2));
      // simple ground follow: raycast tiles under cat
      let gy = null;
      for (let y = Math.floor(k.y / T); y < this.H; y++) {
        const g = this._tile(Math.floor((k.x - 20) / T), y) === 1 || this._tile(Math.floor((k.x + 20) / T), y) === 1 ? 1 : 0;
        const g2 = this._tile(Math.floor((k.x - 20) / T), y) === 2 || this._tile(Math.floor((k.x + 20) / T), y) === 2 ? 1 : 0;
        if (g || g2) { gy = y * T; break; }
      }
      if (gy != null) {
        if (k.y < gy - 130) { // gap ahead? hop
          k.y = Math.min(gy - 4, k.y + 480 * dt + (gy - k.y) * 3 * dt);
        } else k.y = lerp(k.y, gy - 4, 1 - Math.exp(-dt * 12));
      } else {
        k.y += 520 * dt; // falling into a pit
        if (k.y > this.H * T + 200) { // landed on its feet off-screen — reappears behind
          k.y = p.y - 40; k.x = Math.max(this.cam.x - 200, p.x - 900); k.vx = 0;
        }
      }
      k.phase += dt * (4 + k.vx / 60);
      // catch
      if (this.p.invuln <= 0 && Math.abs(p.x - k.x) < 46 && Math.abs((p.y - 14) - (k.y - 46)) < 66) {
        this._hurt('WHISKERS GOT YOU! 😾');
      }
    }

    _hurt(msg) {
      const p = this.p;
      this.lives--; this.deaths++;
      this.shake = 1;
      CC.SFX.play('meow'); CC.SFX.play('caught');
      this.onEvent('caught', { lives: this.lives });
      for (let i = 0; i < 14; i++) this._sparkle(p.x + CC.rand(-30, 30), p.y - CC.rand(0, 50));
      if (this.lives <= 0) {
        this.status = 'over';
        CC.SFX.play('lose');
        this.onEvent('over', { deaths: this.deaths });
        return;
      }
      this.onEvent('toast', msg);
      p.x = this.checkpoint.x; p.y = this.checkpoint.y;
      p.vx = p.vy = 0; p.invuln = 2.4;
      this.catOn = false; this.cat = null; this.catSpawnT = 3.2;
    }

    _puff(x, y, n) {
      for (let i = 0; i < n; i++)
        this.particles.push({ x: x + CC.rand(-8, 8), y: y + CC.rand(-4, 2), vx: CC.rand(-40, 40), vy: CC.rand(-60, -10),
          life: 0.4 + Math.random() * 0.3, max: 0.7, s: 3 + Math.random() * 4, col: 'rgba(255,250,240,0.75)', grav: -40 });
    }
    _sparkle(x, y) {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * 6.28, r = CC.rand(40, 190);
        this.particles.push({ x, y, vx: Math.cos(a) * r, vy: Math.sin(a) * r - 60,
          life: 0.5 + Math.random() * 0.35, max: 0.85, s: 2 + Math.random() * 3.5, col: '#ffe36b', grav: 320 });
      }
    }

    /* ================= RENDER ================= */
    render() {
      const c = this.c, cv = this.cv, th = this.def.theme;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = 620 * 2, h = 540 * 2; // internal render size (fixed logical 620x540 @2x? keep simple: css pixels)
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.floor(W * dpr) || cv.height !== Math.floor(H * dpr)) {
        cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const VW = W, VH = H;
      const sx = this.shake > 0 ? CC.rand(-1, 1) * this.shake * 7 : 0;
      const sy = this.shake > 0 ? CC.rand(-1, 1) * this.shake * 5 : 0;
      const camX = this.cam.x, camY = this.cam.y;
      const view = { x: camX - sx, y: camY - sy, w: VW, h: VH };
      this._scale = VH / 540;
      // world→screen: we render at world scale zoomed so 540px world ≈ screen height
      c.save();
      c.scale(this._scale, this._scale);
      const vw = VW / this._scale, vh = 540;
      view.x = camX - sx; view.y = camY - sy;

      this._bg(c, th, view, vw, vh);
      this._tiles(c, th, view, vw, vh);
      this._objects(c, th, view);
      this._cat(c, view);
      this._mouse(c, view);
      this._particles(c);
      c.restore();
    }

    /* --- parallax backgrounds --- */
    _bg(c, th, view, vw, vh) {
      const t = this.time || 0;
      if (th === 'room' || th === 'kitchen') {
        const wallTop = th === 'room' ? '#e8d9b8' : '#dfe8e2';
        const wallBot = th === 'room' ? '#d8c39a' : '#c8d6ce';
        const g = c.createLinearGradient(0, 0, 0, vh);
        g.addColorStop(0, wallTop); g.addColorStop(1, wallBot);
        c.fillStyle = g; c.fillRect(0, 0, vw, vh);
        // wallpaper stripes (parallax .25)
        c.save();
        const px = -(view.x * 0.25) % 90;
        c.fillStyle = th === 'room' ? 'rgba(190,150,95,0.18)' : 'rgba(120,150,135,0.16)';
        for (let x = px - 90; x < vw + 90; x += 90) c.fillRect(x, 0, 34, vh);
        c.restore();
        // wainscot
        c.fillStyle = th === 'room' ? '#b98d54' : '#9db8a8';
        c.fillRect(0, vh * 0.72, vw, vh * 0.28);
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillRect(0, vh * 0.72, vw, 6);
        // windows (parallax .5)
        const wx = -(view.x * 0.5) % 620;
        for (let x = wx - 620; x < vw + 200; x += 620) {
          c.fillStyle = '#7ec8e8'; c.fillRect(x + 60, 90, 130, 110);
          c.strokeStyle = '#8a6b45'; c.lineWidth = 10; c.strokeRect(x + 60, 90, 130, 110);
          c.beginPath(); c.moveTo(x + 125, 90); c.lineTo(x + 125, 200); c.moveTo(x + 60, 145); c.lineTo(x + 190, 145); c.stroke();
          c.fillStyle = 'rgba(255,255,255,0.5)';
          c.beginPath(); c.moveTo(x + 70, 190); c.lineTo(x + 110, 90); c.lineTo(x + 130, 90); c.lineTo(x + 90, 190); c.fill();
        }
        // furniture silhouettes (parallax .65)
        const fx = -(view.x * 0.65) % 500;
        c.fillStyle = 'rgba(70,50,35,0.20)';
        for (let x = fx - 500; x < vw + 300; x += 500) {
          rr(c, x + 300, 300, 210, 70, 18); c.fill();      // sofa
          rr(c, x + 285, 268, 240, 46, 16); c.fill();
          rr(c, x + 40, 320, 46, 110, 8); c.fill();        // lamp
          c.beginPath(); c.arc(x + 63, 300, 26, 0, 6.29); c.fill();
          rr(c, x + 130, 250, 90, 70, 8); c.fill();        // shelf
        }
        if (th === 'kitchen') {
          const hx = -(view.x * 0.65) % 420;
          c.fillStyle = 'rgba(80,90,90,0.22)';
          for (let x = hx - 420; x < vw + 300; x += 420) {
            rr(c, x + 100, 240, 130, 14, 6); c.fill();
            c.beginPath(); c.arc(x + 130, 268, 16, 0, 6.29); c.fill();
            c.beginPath(); c.arc(x + 190, 268, 13, 0, 6.29); c.fill();
          }
        }
      } else { // garden sunset
        const g = c.createLinearGradient(0, 0, 0, vh);
        g.addColorStop(0, '#ff9a5c'); g.addColorStop(0.45, '#ffd98a'); g.addColorStop(0.75, '#c9e88a'); g.addColorStop(1, '#8fc46a');
        c.fillStyle = g; c.fillRect(0, 0, vw, vh);
        // sun
        c.fillStyle = 'rgba(255,240,180,0.9)';
        c.beginPath(); c.arc(vw * 0.72, 150, 55, 0, 6.29); c.fill();
        // clouds (parallax .15)
        const cx = -(view.x * 0.15) % 480;
        c.fillStyle = 'rgba(255,235,220,0.8)';
        for (let x = cx - 480; x < vw + 200; x += 480) {
          c.beginPath();
          c.arc(x + 80, 90, 26, 0, 6.29); c.arc(x + 120, 78, 32, 0, 6.29); c.arc(x + 165, 92, 24, 0, 6.29);
          c.fill();
        }
        // hills (parallax .3)
        const hx = -(view.x * 0.3) % 700;
        c.fillStyle = '#7aad60';
        for (let x = hx - 700; x < vw + 400; x += 700) {
          c.beginPath(); c.ellipse(x + 180, 430, 260, 120, 0, Math.PI, 0); c.fill();
          c.beginPath(); c.ellipse(x + 520, 460, 320, 150, 0, Math.PI, 0); c.fill();
        }
        // trees (parallax .55)
        const tx = -(view.x * 0.55) % 380;
        c.fillStyle = 'rgba(60,110,55,0.75)';
        for (let x = tx - 380; x < vw + 200; x += 380) {
          c.beginPath(); c.arc(x + 60, 330, 52, 0, 6.29); c.arc(x + 105, 360, 40, 0, 6.29); c.arc(x + 20, 365, 38, 0, 6.29); c.fill();
          c.fillStyle = 'rgba(80,55,35,0.75)'; c.fillRect(x + 55, 380, 12, 60); c.fillStyle = 'rgba(60,110,55,0.75)';
        }
      }
    }

    /* --- tiles --- */
    _tiles(c, th, view, vw, vh) {
      const x0 = Math.max(0, Math.floor(view.x / T) - 1), x1 = Math.min(this.W - 1, Math.ceil((view.x + vw) / T) + 1);
      const y0 = Math.max(0, Math.floor(view.y / T) - 1), y1 = Math.min(this.H - 1, Math.ceil((view.y + vh) / T) + 1);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const g = this.grid[ty][tx];
        if (!g) continue;
        const X = tx * T - view.x, Y = ty * T - view.y;
        if (g === 2) { // thin platform
          if (th === 'garden') {
            c.fillStyle = '#7a5230'; rr(c, X + 1, Y, T - 2, 14, 6); c.fill();
            c.fillStyle = '#5d3d20'; c.fillRect(X + 4, Y + 9, T - 8, 4);
            c.fillStyle = '#6fae4e'; rr(c, X - 1, Y - 5, T + 2, 8, 4); c.fill();
          } else {
            c.fillStyle = th === 'room' ? '#b5651d' : '#94a8b8'; rr(c, X + 1, Y, T - 2, 13, 5); c.fill();
            c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(X + 4, Y + 2, T - 8, 3);
          }
          continue;
        }
        // solid block, themed
        if (th === 'room') {
          c.fillStyle = '#a8703a'; rr(c, X + 1, Y + 1, T - 2, T - 2, 7); c.fill();
          c.fillStyle = '#8a5728'; c.fillRect(X + 4, Y + T - 9, T - 8, 5);
          c.fillStyle = 'rgba(255,220,160,0.35)'; c.fillRect(X + 4, Y + 4, T - 8, 5);
          // cushion tuft
          c.fillStyle = 'rgba(0,0,0,0.10)';
          c.beginPath(); c.arc(X + T / 2, Y + T / 2 + 4, 5, 0, 6.29); c.fill();
        } else if (th === 'kitchen') {
          c.fillStyle = '#e8e4da'; rr(c, X + 1, Y + 1, T - 2, T - 2, 5); c.fill();
          c.fillStyle = '#b8c4cc'; c.fillRect(X + 1, Y + 1, T - 2, 7);
          c.strokeStyle = 'rgba(90,110,120,0.5)'; c.lineWidth = 2;
          c.strokeRect(X + 6, Y + 10, T - 12, T - 16);
        } else {
          c.fillStyle = '#6d4a2b'; rr(c, X + 1, Y + 1, T - 2, T - 2, 8); c.fill();
          c.fillStyle = '#598a3c'; rr(c, X - 1, Y - 6, T + 2, 18, 8); c.fill();
          c.fillStyle = '#6fae4e'; rr(c, X + 2, Y - 4, T - 4, 9, 5); c.fill();
          c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(X + 4, Y + 16, T - 8, 5);
        }
      }
    }

    /* --- cheese, traps, flags, exit --- */
    _objects(c, th, view) {
      const t = this.time || 0;
      for (const ch of this.cheese) {
        if (ch.taken) continue;
        const X = ch.x - view.x, Y = ch.y - view.y + Math.sin(t * 3 + ch.ph) * 5;
        if (X < -50 || X > 1400) continue;
        c.save(); c.translate(X, Y); c.rotate(Math.sin(t * 2 + ch.ph) * 0.12);
        c.fillStyle = '#f7c531';
        c.beginPath(); c.moveTo(-14, 10); c.lineTo(16, 10); c.lineTo(16, -9); c.closePath(); c.fill();
        c.fillStyle = '#ffdf7e';
        c.beginPath(); c.moveTo(-14, 10); c.lineTo(-14, -2); c.lineTo(16, -9); c.lineTo(16, 10); c.closePath(); c.fill();
        c.fillStyle = '#d9a41f';
        c.beginPath(); c.arc(-3, 3, 3.2, 0, 6.29); c.arc(7, 5, 2.4, 0, 6.29); c.fill();
        c.restore();
        if (Math.random() < 0.03) this._sparkle(ch.x + CC.rand(-12, 12), ch.y + CC.rand(-10, 10));
      }
      for (const tr of this.traps) {
        const X = tr.x - view.x, Y = tr.y - view.y;
        if (X < -50 || X > 1400) continue;
        c.fillStyle = '#8a5a28'; rr(c, X - 17, Y - 7, 34, 9, 3); c.fill();
        c.fillStyle = '#6d451e'; rr(c, X - 17, Y - 7, 34, 4, 2); c.fill();
        c.strokeStyle = '#c8ccd4'; c.lineWidth = 4; c.lineCap = 'round';
        c.beginPath();
        if (tr.sprung) { c.moveTo(X - 14, Y - 5); c.lineTo(X + 12, Y - 16); }
        else { c.moveTo(X - 14, Y - 5); c.lineTo(X - 12, Y - 26); }
        c.stroke();
        if (!tr.sprung) { c.fillStyle = '#f7c531'; c.beginPath(); c.arc(X + 3, Y - 9, 3.4, 0, 6.29); c.fill(); }
      }
      for (const f of this.checkpoints) {
        const X = f.x - view.x, Y = f.y - view.y;
        if (X < -50 || X > 1400) continue;
        c.strokeStyle = '#7a6a50'; c.lineWidth = 4;
        c.beginPath(); c.moveTo(X, Y); c.lineTo(X, Y - 52); c.stroke();
        c.fillStyle = f.on ? '#57d968' : '#e85d4a';
        const wave = Math.sin((this.time || 0) * 6) * 4;
        c.beginPath(); c.moveTo(X, Y - 52); c.lineTo(X + 30 + wave, Y - 44); c.lineTo(X, Y - 34); c.closePath(); c.fill();
      }
      if (this.exit) {
        const X = this.exit.x - view.x, Y = this.exit.y - view.y;
        const open = this.cheeseGot >= this.cheese.length;
        c.fillStyle = '#3a2418';
        c.beginPath();
        c.moveTo(X - 24, Y + 4); c.lineTo(X - 24, Y - 24);
        c.arc(X, Y - 24, 24, Math.PI, 0);
        c.lineTo(X + 24, Y + 4); c.closePath(); c.fill();
        c.strokeStyle = '#a97b4a'; c.lineWidth = 5; c.stroke();
        if (open) {
          const g = 0.5 + Math.sin((this.time || 0) * 5) * 0.3;
          c.fillStyle = `rgba(255,220,110,${g})`;
          c.beginPath();
          c.moveTo(X - 16, Y + 2); c.lineTo(X - 16, Y - 22);
          c.arc(X, Y - 22, 16, Math.PI, 0);
          c.lineTo(X + 16, Y + 2); c.closePath(); c.fill();
          c.fillStyle = '#fff3c0'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center';
          c.fillText('HOME!', X, Y - 34 + Math.sin((this.time || 0) * 4) * 3);
        } else {
          c.fillStyle = 'rgba(255,255,255,0.85)'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
          c.fillText('🔒 ' + (this.cheese.length - this.cheeseGot) + ' 🧀 left', X, Y - 36);
        }
      }
    }

    /* --- Cheddar the mouse --- */
    _mouse(c, view) {
      const p = this.p;
      if (p.invuln > 0 && Math.floor((this.time || 0) * 9) % 2 === 0 && this.status === 'play') return;
      const X = p.x - view.x, Y = p.y - view.y;
      const run = clamp(Math.abs(p.vx) / 330, 0, 1);
      const sq = 1 - p.squash * 0.7, st = 1 + p.squash * 0.5;
      const air = !p.onGround;
      c.save();
      c.translate(X, Y);
      if (p.stun > 0) c.rotate(Math.sin((this.time || 0) * 24) * 0.18);
      c.scale(p.face, 1);
      c.scale(st, sq);
      // tail
      c.strokeStyle = '#e6a0a8'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-10, -10);
      const tw = Math.sin((this.time || 0) * 9) * 7;
      c.quadraticCurveTo(-24, -14 + tw * 0.4, -30, -2 + tw);
      c.stroke();
      // legs
      c.strokeStyle = '#8a5a2b'; c.lineWidth = 5;
      if (air) {
        c.beginPath(); c.moveTo(-4, -6); c.lineTo(-9, -1); c.moveTo(5, -6); c.lineTo(9, -2); c.stroke();
      } else {
        const ph = p.phase;
        for (let i = 0; i < 2; i++) {
          const lx = i ? 7 : -5, sw = Math.sin(ph + i * Math.PI) * 7 * run;
          c.beginPath(); c.moveTo(lx, -7); c.lineTo(lx + sw, -1); c.stroke();
        }
      }
      // body
      c.fillStyle = '#c07830';
      c.beginPath(); c.ellipse(0, -15, 13, 11, 0, 0, 6.29); c.fill();
      c.fillStyle = '#e8b26a';
      c.beginPath(); c.ellipse(2, -12, 8, 6, 0, 0, 6.29); c.fill();
      // head
      c.fillStyle = '#c07830';
      c.beginPath(); c.arc(11, -22, 8.5, 0, 6.29); c.fill();
      // ears
      c.fillStyle = '#b56a28';
      c.beginPath(); c.arc(5, -31, 6.5, 0, 6.29); c.fill();
      c.beginPath(); c.arc(15, -32, 6, 0, 6.29); c.fill();
      c.fillStyle = '#f0a0aa';
      c.beginPath(); c.arc(5, -31, 3.6, 0, 6.29); c.fill();
      c.beginPath(); c.arc(15, -32, 3.3, 0, 6.29); c.fill();
      // face
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(15, -23, 3.4, 0, 6.29); c.fill();
      c.fillStyle = '#221510';
      c.beginPath(); c.arc(16.2, -23, 1.8, 0, 6.29); c.fill();
      c.fillStyle = '#e86a7a';
      c.beginPath(); c.arc(19.5, -20.5, 1.8, 0, 6.29); c.fill();
      // whiskers
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(18, -20); c.lineTo(27, -22); c.moveTo(18, -19); c.lineTo(27, -17);
      c.stroke();
      c.restore();
      // ground shadow
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.beginPath(); c.ellipse(X, Y + 2, 13, 4, 0, 0, 6.29); c.fill();
    }

    /* --- Whiskers the cat (big!) --- */
    _cat(c, view) {
      const k = this.cat;
      if (!this.catOn || !k) return;
      const X = k.x - view.x, Y = k.y - view.y;
      if (X < -260 || X > 1600) return;
      const run = clamp(k.vx / 380, 0, 1);
      c.save(); c.translate(X, Y);
      // tail
      c.strokeStyle = '#5d6878'; c.lineWidth = 10; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-42, -46);
      c.quadraticCurveTo(-70, -50 + Math.sin((this.time || 0) * 7) * 10, -74, -78 + Math.sin((this.time || 0) * 7) * 8);
      c.stroke();
      // legs (gallop)
      c.strokeStyle = '#4a5462'; c.lineWidth = 11;
      const ph = k.phase;
      for (let i = 0; i < 4; i++) {
        const lx = -30 + i * 20, sw = Math.sin(ph + i * 1.7) * 13 * run;
        c.beginPath(); c.moveTo(lx, -40); c.lineTo(lx + sw, -2); c.stroke();
      }
      // body
      c.fillStyle = '#67727f';
      c.beginPath(); c.ellipse(-12, -56, 42, 27, -0.06, 0, 6.29); c.fill();
      c.fillStyle = '#9aa3ad';
      c.beginPath(); c.ellipse(-4, -46, 28, 16, 0, 0, 6.29); c.fill();
      // head
      c.fillStyle = '#67727f';
      c.beginPath(); c.arc(38, -76, 22, 0, 6.29); c.fill();
      // ears
      c.fillStyle = '#67727f';
      c.beginPath(); c.moveTo(22, -90); c.lineTo(18, -110); c.lineTo(36, -96); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(50, -92); c.lineTo(58, -110); c.lineTo(60, -90); c.closePath(); c.fill();
      c.fillStyle = '#e88a96';
      c.beginPath(); c.moveTo(25, -93); c.lineTo(22, -104); c.lineTo(32, -96); c.closePath(); c.fill();
      // angry face
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(46, -80, 5.5, 0, 6.29); c.arc(32, -80, 5, 0, 6.29); c.fill();
      c.fillStyle = '#1b1e24';
      c.beginPath(); c.arc(47.5, -80, 2.6, 0, 6.29); c.arc(33.5, -80, 2.4, 0, 6.29); c.fill();
      c.strokeStyle = '#3c4550'; c.lineWidth = 3.4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(26, -89); c.lineTo(38, -85); c.moveTo(54, -89); c.lineTo(44, -85); c.stroke();
      c.fillStyle = '#e8707e';
      c.beginPath(); c.moveTo(40, -73); c.lineTo(46, -73); c.lineTo(43, -68); c.closePath(); c.fill();
      // whiskers
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(52, -72); c.lineTo(70, -75); c.moveTo(52, -69); c.lineTo(70, -65);
      c.stroke();
      // dust puffs behind
      if (run > 0.4 && Math.random() < 0.3) this._puff(k.x - 40, k.y, 1);
      c.restore();
    }

    _particles(c) {
      const vx = this._viewX || this.cam.x, vy = this._viewY || this.cam.y;
      for (const q of this.particles) {
        const a = clamp(q.life / q.max, 0, 1);
        c.globalAlpha = a;
        c.fillStyle = q.col;
        c.beginPath(); c.arc(q.x - vx, q.y - vy, q.s * a + 0.5, 0, 6.29); c.fill();
      }
      c.globalAlpha = 1;
    }
  }
  G2.Game2D = Game2D;
})();

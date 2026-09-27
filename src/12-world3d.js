/* ================================================================
   CHEESE CHASE — 3D worlds: characters, levels, gameplay
   (original characters: Whiskers the cat, Cheddar the mouse)
   ================================================================ */
'use strict';
(() => {
  const W3 = CC.W3 = {};
  const { Mesh, FaceSink } = CC.R3;
  const clamp = CC.clamp, lerp = CC.lerp, TAU = CC.TAU;

  const srand = (i, j) => { const x = Math.sin(i * 127.1 + j * 311.7 + 13.37) * 43758.5453; return x - Math.floor(x); };

  /* ============ CHARACTER PUPPETS ============ */
  function part(mesh, off, base) {
    return Object.assign({ mesh, off, dx: 0, dy: 0, dz: 0, ry: 0, rx: 0, s: 1 }, base || {});
  }

  function flushPuppet(sink, parts, px, py, pz, yaw, S) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (const P of parts) {
      if (P.anim) P.anim(P, S);
      const ox = P.off[0] + P.dx, oy = P.off[1] + P.dy, oz = P.off[2] + P.dz;
      sink.meshTRS(P.mesh, px + ox * cs + oz * sn, py + oy, pz - ox * sn + oz * cs, yaw + P.ry, P.rx, P.s);
    }
  }

  /* ---- Cheddar the mouse (faces +Z) ---- */
  function makeMouse() {
    const FUR = [0.80, 0.52, 0.26], FURD = [0.62, 0.38, 0.18], PINK = [0.99, 0.62, 0.70],
          CREAM = [0.97, 0.88, 0.72], WHITE = [0.99, 0.99, 0.99], BLACK = [0.07, 0.06, 0.06];
    const M = {};
    M.body   = new Mesh().sphere(0, 0, 0, 0.40, FUR, 9, 6, 1, 0.82, 1.22);
    M.head   = new Mesh().sphere(0, 0, 0, 0.30, FUR, 9, 6, 1.04, 0.95, 1);
    M.muzzle = new Mesh().sphere(0, 0, 0, 0.15, CREAM, 6, 4, 1, 0.8, 1.1);
    M.nose   = new Mesh().sphere(0, 0, 0, 0.05, PINK, 5, 4);
    M.earL   = new Mesh().sphere(0, 0, 0, 0.17, FUR, 6, 4, 1, 1.05, 0.32);
    M.earR   = new Mesh().sphere(0, 0, 0, 0.17, FUR, 6, 4, 1, 1.05, 0.32);
    M.earLin = new Mesh().sphere(0, 0, 0, 0.115, PINK, 5, 4, 1, 1.05, 0.4);
    M.earRin = new Mesh().sphere(0, 0, 0, 0.115, PINK, 5, 4, 1, 1.05, 0.4);
    M.eye    = new Mesh().sphere(0, 0, 0, 0.068, WHITE, 5, 4);
    M.pupil  = new Mesh().sphere(0, 0, 0, 0.032, BLACK, 4, 3);
    M.whisk  = new Mesh().box(0, 0, 0, 0.32, 0.012, 0.014, WHITE);
    M.foot   = new Mesh().sphere(0, 0, 0, 0.095, FURD, 5, 4);
    M.tail   = new Mesh().sphere(0, 0, 0, 0.078, PINK, 5, 4);

    const P = [];
    P.push(part(M.body, [0, 0.46, 0], { anim: (p, S) => { p.dy = Math.sin(S.phase * 2) * 0.035 * S.sp + (S.vy > 0.5 ? 0.04 : 0); } }));
    P.push(part(M.head, [0, 0.63, 0.36], { anim: (p, S) => {
      p.dy = Math.sin(S.phase * 2 + 0.5) * 0.04 * S.sp;
      p.ry = Math.sin(S.phase) * 0.07 * S.sp;
      p.rx = S.stun > 0 ? Math.sin(S.t * 22) * 0.22 : 0;
    } }));
    P.push(part(M.muzzle, [0, 0.55, 0.62]));
    P.push(part(M.nose, [0, 0.575, 0.745]));
    P.push(part(M.earL, [-0.175, 0.87, 0.29], { ry: -0.5, anim: (p, S) => { p.rx = -0.3 * S.sp + Math.sin(S.t * 1.7) * 0.07 * (1 - S.sp); } }));
    P.push(part(M.earR, [ 0.175, 0.87, 0.29], { ry:  0.5, anim: (p, S) => { p.rx = -0.3 * S.sp + Math.sin(S.t * 1.7 + 1) * 0.07 * (1 - S.sp); } }));
    P.push(part(M.earLin, [-0.168, 0.89, 0.315], { ry: -0.5, anim: (p, S) => { p.rx = -0.3 * S.sp; } }));
    P.push(part(M.earRin, [ 0.168, 0.89, 0.315], { ry:  0.5, anim: (p, S) => { p.rx = -0.3 * S.sp; } }));
    P.push(part(M.eye, [-0.115, 0.70, 0.60]));
    P.push(part(M.eye, [ 0.115, 0.70, 0.60]));
    P.push(part(M.pupil, [-0.118, 0.705, 0.66]));
    P.push(part(M.pupil, [ 0.118, 0.705, 0.66]));
    for (let s = -1; s <= 1; s += 2) for (let w = 0; w < 3; w++)
      P.push(part(M.whisk, [s * 0.16, 0.55 + (w - 1) * 0.045, 0.56], { ry: s * (1.35 + w * 0.12), rx: (w - 1) * 0.16 }));
    const feet = [[-0.16, 0.09, 0.30], [0.16, 0.09, 0.30], [-0.17, 0.09, -0.20], [0.17, 0.09, -0.20]];
    feet.forEach((f, k) => P.push(part(M.foot, f, { anim: (p, S) => {
      const ph = S.phase + (k < 2 ? 0 : Math.PI) + (k % 2) * 0.55;
      p.dz = Math.sin(ph) * 0.17 * S.sp;
      p.dy = Math.max(0, Math.sin(ph + 0.6)) * 0.13 * S.sp;
    } })));
    for (let i = 0; i < 5; i++) P.push(part(M.tail, [0, 0.36 + i * 0.05, -(0.44 + i * 0.145)], { s: 1 - i * 0.13, anim: (p, S) => {
      p.dx = Math.sin(S.t * 4.2 - i * 0.85) * (0.02 + 0.15 * (1 - S.sp));
      p.dy = (1 - S.sp) * i * 0.022 - S.sp * i * 0.008;
    } }));
    return P;
  }

  /* ---- Whiskers the cat (faces +Z) ---- */
  function makeCat() {
    const FUR = [0.52, 0.56, 0.66], FURD = [0.35, 0.39, 0.50], CREAM = [0.93, 0.93, 0.96],
          PINK = [0.95, 0.56, 0.62], GREEN = [0.28, 0.74, 0.42], BLACK = [0.06, 0.05, 0.05], WHITE = [0.98, 0.98, 0.98];
    const M = {};
    M.body   = new Mesh().sphere(0, 0, 0, 0.62, FUR, 10, 7, 1, 0.95, 1.32);
    M.chest  = new Mesh().sphere(0, 0, 0, 0.44, CREAM, 8, 5, 1, 0.9, 1);
    M.head   = new Mesh().sphere(0, 0, 0, 0.44, FUR, 10, 7);
    M.muzzle = new Mesh().sphere(0, 0, 0, 0.235, CREAM, 7, 5, 1, 0.78, 1.05);
    M.nose   = new Mesh().sphere(0, 0, 0, 0.065, PINK, 5, 4);
    M.earL   = new Mesh().cyl(0, 0.21, 0, 0.23, 0.03, 0.42, FUR, 6);
    M.earR   = new Mesh().cyl(0, 0.21, 0, 0.23, 0.03, 0.42, FUR, 6);
    M.earLin = new Mesh().cyl(0, 0.19, 0.02, 0.15, 0.02, 0.30, PINK, 5);
    M.earRin = new Mesh().cyl(0, 0.19, 0.02, 0.15, 0.02, 0.30, PINK, 5);
    M.eye    = new Mesh().sphere(0, 0, 0, 0.095, GREEN, 5, 4);
    M.pupil  = new Mesh().sphere(0, 0, 0, 0.045, BLACK, 4, 3);
    M.whisk  = new Mesh().box(0, 0, 0, 0.46, 0.014, 0.016, WHITE);
    M.stripe = new Mesh().box(0, 0, 0, 0.74, 0.34, 0.14, FURD);
    M.leg    = new Mesh().cyl(0, -0.30, 0, 0.10, 0.085, 0.60, FUR, 6).merge(new Mesh().sphere(0, -0.62, 0.02, 0.125, FURD, 5, 4));
    M.tail   = new Mesh().sphere(0, 0, 0, 0.125, FUR, 5, 4);
    M.tailD  = new Mesh().sphere(0, 0, 0, 0.125, FURD, 5, 4);

    const P = [];
    P.push(part(M.body, [0, 1.02, 0], { anim: (p, S) => { p.dy = Math.sin(S.phase * 2) * 0.045 * S.sp; } }));
    P.push(part(M.chest, [0, 0.90, 0.50]));
    P.push(part(M.head, [0, 1.66, 0.44], { anim: (p, S) => {
      p.dy = Math.sin(S.phase * 2 + 0.6) * 0.05 * S.sp;
      p.ry = Math.sin(S.phase) * 0.06 * S.sp;
      p.rx = S.pounce ? 0.28 : 0;
    } }));
    P.push(part(M.muzzle, [0, 1.53, 0.83]));
    P.push(part(M.nose, [0, 1.585, 1.05]));
    P.push(part(M.earL, [-0.27, 2.06, 0.38], { ry: -0.32, rx: -0.12, anim: (p, S) => { p.rx = -0.12 - 0.35 * S.sp + Math.sin(S.t * 2.3) * 0.08 * (1 - S.sp); } }));
    P.push(part(M.earR, [ 0.27, 2.06, 0.38], { ry:  0.32, rx: -0.12, anim: (p, S) => { p.rx = -0.12 - 0.35 * S.sp + Math.sin(S.t * 2.3 + 1) * 0.08 * (1 - S.sp); } }));
    P.push(part(M.earLin, [-0.26, 2.09, 0.44], { ry: -0.32 }));
    P.push(part(M.earRin, [ 0.26, 2.09, 0.44], { ry:  0.32 }));
    P.push(part(M.eye, [-0.165, 1.76, 0.80]));
    P.push(part(M.eye, [ 0.165, 1.76, 0.80]));
    P.push(part(M.pupil, [-0.168, 1.762, 0.885]));
    P.push(part(M.pupil, [ 0.168, 1.762, 0.885]));
    for (let s = -1; s <= 1; s += 2) for (let w = 0; w < 3; w++)
      P.push(part(M.whisk, [s * 0.23, 1.50 + (w - 1) * 0.06, 0.86], { ry: s * (1.42 + w * 0.1), rx: (w - 1) * 0.14 }));
    [[0, 1.34, -0.12], [0, 1.42, -0.42], [0, 1.36, -0.72]].forEach(o => P.push(part(M.stripe, o)));
    const legs = [[-0.30, 0.66, 0.42], [0.30, 0.66, 0.42], [-0.30, 0.66, -0.44], [0.30, 0.66, -0.44]];
    legs.forEach((l, k) => P.push(part(M.leg, l, { anim: (p, S) => {
      const ph = S.phase + (k < 2 ? 0 : Math.PI) + (k % 2) * 0.35;
      p.rx = Math.sin(ph) * 0.62 * S.sp;
    } })));
    for (let i = 0; i < 6; i++) P.push(part(i % 2 ? M.tailD : M.tail, [0, 0.95 + i * 0.14, -(0.80 + i * 0.21)], { s: 1 - i * 0.10, anim: (p, S) => {
      p.dx = Math.sin(S.t * 2.6 - i * 0.8) * (0.05 + 0.12 * (1 - S.sp)) - S.sp * 0.02;
      p.dy = S.sp * i * 0.02;
    } }));
    return P;
  }

  /* ---- cheese wedge / mousetrap / particles ---- */
  function makeCheese() {
    const m = new Mesh().wedge(0, 0, 0, 0.62, 0.5, 0.42, [0.99, 0.80, 0.28]);
    const spots = new Mesh();
    spots.sphere(-0.08, 0.30, 0.09, 0.065, [0.90, 0.66, 0.18], 5, 4);
    spots.sphere(0.13, 0.24, -0.07, 0.05, [0.90, 0.66, 0.18], 5, 4);
    spots.sphere(-0.14, 0.22, -0.08, 0.045, [0.88, 0.64, 0.17], 5, 4);
    return m.merge(spots);
  }
  function makeTrap() {
    const base = new Mesh().box(0, 0.03, 0, 0.54, 0.06, 0.54, [0.52, 0.38, 0.24]);
    base.box(0, 0.065, -0.20, 0.46, 0.02, 0.10, [0.42, 0.30, 0.18]);       // back plate
    base.sphere(0, 0.09, 0.02, 0.055, [0.99, 0.80, 0.28], 5, 4);           // bait
    const bar = new Mesh().box(0, 0, 0, 0.48, 0.05, 0.09, [0.78, 0.80, 0.88]);
    return { base, bar };
  }
  const cubeMesh = new Mesh().box(0, 0, 0, 1, 1, 1, [1, 1, 1]);

  /* ============ LEVEL BUILD HELPERS ============ */
  function Builder(sink) {
    this.S = sink; this.cols = [];
    this._m = new Mesh(); // scratch mesh for shape calls
  }
  Builder.prototype = {
    _flush() { this.S.mesh(this._m, null); this._m.faces.length = 0; },
    box(cx, cy, cz, sx, sy, sz, col, ry, opt) {
      this._m.box(cx, cy, cz, sx, sy, sz, col, ry || 0);
      this._flush();
      if (opt !== false && !ry) this.col(cx, cz, sx, sz, opt && opt.h, opt && opt.catOnly);
      return this;
    },
    col(cx, cz, sx, sz, h, catOnly) {
      this.cols.push({ x0: cx - sx / 2, z0: cz - sz / 2, x1: cx + sx / 2, z1: cz + sz / 2, h: h == null ? 3 : h, catOnly: !!catOnly });
      return this;
    },
    sphere(cx, cy, cz, r, col, su, sv, sx, sy, sz, collide) {
      this._m.sphere(cx, cy, cz, r, col, su || 8, sv || 6, sx || 1, sy || 1, sz || 1);
      this._flush();
      if (collide) this.col(cx, cz, r * 2 * (sx || 1) * 0.8, r * 2 * (sz || 1) * 0.8, collide === true ? 3 : collide);
      return this;
    },
    cyl(cx, cy, cz, r0, r1, h, col, seg, collide) {
      this._m.cyl(cx, cy, cz, r0, r1, h, col, seg || 8);
      this._flush();
      if (collide) this.col(cx, cz, r0 * 2 * 0.9, r0 * 2 * 0.9, collide === true ? 3 : collide);
      return this;
    },
    disc(cx, cy, cz, r, col, seg, rx, rz) {
      this._m.disc(cx, cy, cz, r, col, seg, rx, rz);
      this._flush();
      return this;
    },
    mesh(m) { this.S.mesh(m, null); return this; }
  };

  function wallsAndFloor(B, theme) {
    const W = 12, D = 9, H = 2.6, T = 0.6;
    // floor
    if (theme.floor === 'wood') {
      for (let j = 0; j < 12; j++) {
        const z = -D + j * 1.5 + 0.75;
        let x = -W;
        while (x < W - 0.01) {
          const len = 3 + Math.floor(srand(j, x) * 3);
          const x2 = Math.min(x + len, W);
          const sh = 0.72 + srand(j * 3, x) * 0.18;
          B.box((x + x2) / 2, -0.02, z, x2 - x, 0.06, 1.44, [0.52 * sh, 0.36 * sh, 0.20 * sh], 0, false);
          x = x2;
        }
      }
    } else if (theme.floor === 'tile') {
      for (let j = 0; j < 9; j++) for (let i = 0; i < 12; i++) {
        const a = (i + j) % 2 === 0;
        B.box(-W + i * 2 + 1, -0.02, -D + j * 2 + 1, 1.96, 0.06, 1.96,
          a ? [0.93, 0.90, 0.84] : [0.62, 0.72, 0.78], 0, false);
      }
    } else { // grass
      for (let j = 0; j < 9; j++) for (let i = 0; i < 12; i++) {
        const s = srand(i, j);
        B.box(-W + i * 2 + 1, -0.02, -D + j * 2 + 1, 1.98, 0.06, 1.98,
          [0.28 + s * 0.10, 0.55 + s * 0.12, 0.26 + s * 0.08], 0, false);
      }
    }
    const wc = theme.wall, bc = theme.base || [0.45, 0.32, 0.18];
    // walls (short, dollhouse style)
    B.box(0, H / 2, -D - T / 2, W * 2 + T * 2, H, T, wc, 0, { h: 99 }); // north
    B.box(0, H / 2,  D + T / 2, W * 2 + T * 2, H, T, wc, 0, { h: 99 }); // south
    B.box(-W - T / 2, H / 2, 0, T, H, D * 2, wc, 0, { h: 99 });         // west
    B.box( W + T / 2, H / 2, 0, T, H, D * 2, wc, 0, { h: 99 });         // east
    // baseboards + top trim
    const tb = [0, 0.22, -D + 0.06, W * 2, 0.44, 0.12, bc, 0, false];
    B.box(0, 0.22, -D + 0.06, W * 2, 0.44, 0.12, bc, 0, false);
    B.box(0, 0.22,  D - 0.06, W * 2, 0.44, 0.12, bc, 0, false);
    B.box(-W + 0.06, 0.22, 0, 0.12, 0.44, D * 2, bc, 0, false);
    B.box( W - 0.06, 0.22, 0, 0.12, 0.44, D * 2, bc, 0, false);
    const tc = theme.trim || [1, 0.94, 0.82];
    B.box(0, H + 0.05, -D + 0.05, W * 2, 0.10, 0.10, tc, 0, false);
    B.box(0, H + 0.05,  D - 0.05, W * 2, 0.10, 0.10, tc, 0, false);
    B.box(-W + 0.05, H + 0.05, 0, 0.10, 0.10, D * 2, tc, 0, false);
    B.box( W - 0.05, H + 0.05, 0, 0.10, 0.10, D * 2, tc, 0, false);
  }

  function windowOn(B, x, z, ry, w, h, paneCol) {
    // low cottage window on a wall (z near -9 or ±12 walls via ry)
    const f = [0.85, 0.68, 0.42];
    B.box(x, 1.0 + h / 2, z, w + 0.3, 0.14, 0.16, f, 0, false);          // sill
    const mk = (dx, dy, sx, sy) => {
      const wx = x + Math.cos(ry) * dx, wz = z + Math.sin(ry) * dx;
      B.box(wx, dy, wz, Math.abs(Math.cos(ry)) * sx + Math.abs(Math.sin(ry)) * 0.14,
            sy, Math.abs(Math.sin(ry)) * sx + Math.abs(Math.cos(ry)) * 0.14, f, 0, false);
    };
    mk(0, 1.0 + h + 0.07, w + 0.3, 0.14);
    mk(-w / 2 - 0.08, 1.0 + h / 2, 0.14, h);
    mk( w / 2 + 0.08, 1.0 + h / 2, 0.14, h);
    mk(0, 1.0 + h / 2, 0.10, h);
    mk(0, 1.0 + h / 2, w, 0.10);
    // glass
    const glass = new Mesh();
    const gx = x, gz = z;
    glass.box(gx, 1.0 + h / 2, gz, w, h, 0.06, paneCol);
    B.mesh(glass);
  }

  function buildHole(B, x, z, dirX, dirZ) {
    // arch opening facing INTO the room
    const R = 0.78, depth = 0.14;
    const rx = -dirZ, rz = dirX; // right vector along wall
    const dark = [0.06, 0.045, 0.04], darker = [0.035, 0.028, 0.026], wood = [0.50, 0.35, 0.18];
    const pt = (u, r) => [x + rx * Math.cos(u) * r, Math.max(0.02, Math.sin(u) * r * 1.12), z + rz * Math.cos(u) * r];
    const m = new Mesh();
    for (let i = 0; i < 10; i++) {
      const u0 = i / 10 * Math.PI, u1 = (i + 1) / 10 * Math.PI;
      m.quad(pt(u0, R), pt(u1, R), [pt(u1, R)[0] + dirX * depth, pt(u1, R)[1], pt(u1, R)[2] + dirZ * depth],
             [pt(u0, R)[0] + dirX * depth, pt(u0, R)[1], pt(u0, R)[2] + dirZ * depth], dark);
      // wooden trim band just outside arch
      m.quad(pt(u0, R + 0.16), pt(u1, R + 0.16), pt(u1, R + 0.02), pt(u0, R + 0.02), wood);
    }
    // back fill (fan)
    for (let i = 0; i < 10; i++) {
      const u0 = i / 10 * Math.PI, u1 = (i + 1) / 10 * Math.PI;
      const c = [x + dirX * depth, 0.02, z + dirZ * depth];
      m.quad(c, [pt(u1, R)[0] + dirX * depth, pt(u1, R)[1], pt(u1, R)[2] + dirZ * depth],
             [pt(u0, R)[0] + dirX * depth, pt(u0, R)[1], pt(u0, R)[2] + dirZ * depth], c, darker);
    }
    // doormat
    B.disc(x + dirX * 0.95, 0.025, z + dirZ * 0.95, 0.8, [0.68, 0.48, 0.30], 12, Math.abs(dirX) * 0.65 + Math.abs(dirZ), Math.abs(dirZ) * 0.65 + Math.abs(dirX));
    B.mesh(m);
  }

  /* ============ LEVEL DEFINITIONS ============ */
  W3.DEFS = [];

  /* ---- Level 1: Living Room ---- */
  W3.DEFS.push({
    id: '3d-living', name: 'Living Room', icon: '🛋️', desc: 'Sofas, rugs & one sneaky cat.',
    time: 150, sky: [0.14, 0.11, 0.19], fog: [0.14, 0.11, 0.19], fogRange: [26, 44],
    light: [0.42, 0.8, 0.42], ambient: 0.46,
    start: [-10.4, 7.4], hole: { x: -11.9, z: 3.2, dx: 1, dz: 0 },
    waypoints: [[-8, -6.5], [0, -4.5], [8, -6.5], [9.5, 1], [3, 5.5], [-6, 5], [-10, -1]],
    build(S) {
      const B = new Builder(S);
      wallsAndFloor(B, { floor: 'wood', wall: [0.87, 0.80, 0.66], base: [0.45, 0.32, 0.18], trim: [1, 0.95, 0.85] });
      windowOn(B, -4, -8.85, 0, 3.2, 1.3, [0.62, 0.80, 0.95]);
      windowOn(B, 5, -8.85, 0, 2.4, 1.3, [0.62, 0.80, 0.95]);
      // rug
      B.disc(0, 0.015, 0.5, 4.4, [0.72, 0.25, 0.22], 20, 1, 0.72);
      B.disc(0, 0.02, 0.5, 3.9, [0.88, 0.78, 0.55], 20, 1, 0.66);
      B.disc(0, 0.025, 0.5, 3.3, [0.72, 0.25, 0.22], 20, 1, 0.58);
      B.disc(0, 0.03, 0.5, 1.1, [0.88, 0.78, 0.55], 14, 1, 0.24);
      // sofa (against north side, facing south)
      const sofa = [0.55, 0.20, 0.26], sofaL = [0.66, 0.32, 0.38];
      B.box(0, 0.65, -6.3, 4.6, 1.1, 2.0, sofa, 0, { h: 1.6 });
      B.box(0, 1.55, -7.35, 4.6, 1.5, 0.55, sofa, 0, false);
      B.box(-2.45, 1.05, -6.3, 0.75, 1.9, 2.0, sofaL, 0, false);
      B.box( 2.45, 1.05, -6.3, 0.75, 1.9, 2.0, sofaL, 0, false);
      for (let i = -1; i <= 1; i++) B.box(i * 1.45, 1.28, -6.15, 1.3, 0.35, 1.7, [0.72, 0.30, 0.34], 0, false);
      // coffee table (low — mouse slips under, cat can't!)
      const wood = [0.55, 0.38, 0.22];
      B.box(0, 1.02, -2.6, 2.7, 0.14, 1.6, wood, 0, { h: 1.0, catOnly: true });
      for (const [lx, lz] of [[-1.15, -0.6], [1.15, -0.6], [-1.15, 0.6], [1.15, 0.6]])
        B.box(lx, 0.5, -2.6 + lz, 0.14, 1.0, 0.14, wood, 0, false);
      B.box(-0.3, 1.16, -2.7, 0.55, 0.12, 0.4, [0.85, 0.30, 0.30], 0, false);   // book
      B.box(0.05, 1.16, -2.45, 0.5, 0.12, 0.35, [0.30, 0.45, 0.80], 0, false);  // book
      B.cyl(0.9, 1.28, -2.6, 0.14, 0.10, 0.35, [0.55, 0.60, 0.65], 7, false);   // vase
      B.sphere(0.9, 1.62, -2.6, 0.28, [0.30, 0.60, 0.30], 6, 5, 1, 0.8, 1, false);
      // TV console + TV (south side, facing north)
      B.box(0, 0.55, 7.0, 3.4, 1.1, 1.3, [0.42, 0.30, 0.24], 0, { h: 1.4 });
      B.box(0, 2.05, 7.35, 2.9, 1.7, 0.25, [0.13, 0.13, 0.15], 0, false);
      B.box(0, 2.05, 7.2, 2.55, 1.4, 0.06, [0.25, 0.32, 0.45], 0, false);
      B.box(-0.7, 2.6, 7.16, 0.8, 0.25, 0.05, [0.4, 0.5, 0.65], 0, false);
      // bookshelf (east wall)
      const shelfW = [0.44, 0.31, 0.19];
      B.box(10.6, 2.0, -3, 1.0, 4.0, 4.6, shelfW, 0, { h: 4 });
      const bookCols = [[0.8, 0.3, 0.3], [0.3, 0.5, 0.8], [0.9, 0.75, 0.3], [0.4, 0.7, 0.4], [0.7, 0.4, 0.75], [0.9, 0.9, 0.7]];
      for (let r = 0; r < 4; r++) {
        const y = 0.65 + r * 0.95;
        B.box(10.6, y - 0.04, -3, 0.9, 0.08, 4.4, [0.36, 0.25, 0.14], 0, false);
        let z = -5.0;
        while (z < -1.2) {
          const bw = 0.22 + srand(r, z) * 0.3, bh = 0.55 + srand(r + 4, z) * 0.25;
          if (srand(r + 8, z) > 0.18)
            B.box(10.6, y + bh / 2, z + bw / 2, 0.7, bh, bw * 0.92, bookCols[Math.floor(srand(r, z * 3) * 6)], 0, false);
          z += bw + 0.05;
        }
      }
      // floor lamp
      B.cyl(-6.5, 0.06, -6.2, 0.42, 0.5, 0.12, [0.35, 0.3, 0.28], 8, false);
      B.cyl(-6.5, 1.7, -6.2, 0.05, 0.05, 3.2, [0.35, 0.3, 0.28], 6, true);
      B.cyl(-6.5, 3.45, -6.2, 0.22, 0.55, 0.6, [1.0, 0.92, 0.7], 8, false);
      // plant (west)
      B.cyl(-9.6, 0.45, 6.6, 0.48, 0.38, 0.9, [0.70, 0.36, 0.26], 8, true);
      B.cyl(-9.6, 1.0, 6.6, 0.07, 0.06, 0.5, [0.4, 0.3, 0.2], 5, false);
      B.sphere(-9.6, 1.55, 6.6, 0.62, [0.25, 0.55, 0.28], 7, 5, 1, 0.85, 1, false);
      B.sphere(-9.95, 1.35, 6.35, 0.4, [0.30, 0.60, 0.30], 6, 5, 1, 0.8, 1, false);
      B.sphere(-9.25, 1.4, 6.9, 0.42, [0.22, 0.50, 0.26], 6, 5, 1, 0.8, 1, false);
      // wall pictures
      for (const [px, pz, ry] of [[-3, -8.85, 0], [7.5, -8.85, 0], [-11.85, -2, Math.PI / 2]]) {
        B.box(px, 1.75, pz, 1.15, 0.9, 0.08, [0.62, 0.45, 0.26], ry, false);
        B.box(px + (ry ? 0.06 : 0), 1.75, pz + (ry ? 0 : 0.06), 0.95, 0.7, 0.05, [0.75, 0.82, 0.9], ry, false);
      }
      // floor cushions
      B.disc(6.8, 0.10, 3.6, 0.75, [0.85, 0.62, 0.25], 10, 1, 0.75);
      B.disc(-5.6, 0.10, 2.4, 0.7, [0.4, 0.55, 0.75], 10, 1, 0.75);
      buildHole(B, this.hole.x, this.hole.z, this.hole.dx, this.hole.dz);
      return {
        cols: B.cols,
        cheese: [[-8.5, -5], [8.8, -6.8], [10.0, 1.8], [4.5, 5.8], [-4.2, 6.8], [-10.6, -7.6], [1.6, -4.4], [7.6, 6.9], [-6.9, 0.4], [0.4, 2.2]],
        traps: [[-2.0, 0.8], [6.0, -3.6]]
      };
    }
  });

  /* ---- Level 2: Kitchen ---- */
  W3.DEFS.push({
    id: '3d-kitchen', name: 'Kitchen', icon: '🍳', desc: 'Counters, a fridge & snap traps.',
    time: 160, sky: [0.11, 0.12, 0.19], fog: [0.11, 0.12, 0.19], fogRange: [26, 44],
    light: [0.40, 0.8, 0.5], ambient: 0.48,
    start: [-10.4, 7.2], hole: { x: 4, z: 8.9, dx: 0, dz: -1 },
    waypoints: [[-8, -5.5], [0, -5], [8, -5.5], [9.5, 1.5], [0, 5], [-8, 5.5], [-10.5, 0]],
    build(S) {
      const B = new Builder(S);
      wallsAndFloor(B, { floor: 'tile', wall: [0.84, 0.86, 0.74], base: [0.5, 0.38, 0.26], trim: [0.95, 0.95, 0.9] });
      windowOn(B, -4, -8.85, 0, 3.0, 1.1, [0.65, 0.85, 0.6]);
      // counters along north wall
      const cab = [0.55, 0.42, 0.34], top = [0.88, 0.86, 0.82];
      B.box(-5.5, 0.6, -7.6, 9.0, 1.2, 1.8, cab, 0, { h: 1.5 });
      B.box(-5.5, 1.28, -7.7, 9.4, 0.16, 2.0, top, 0, false);
      B.box(5.5, 0.6, -7.6, 5.0, 1.2, 1.8, cab, 0, { h: 1.5 });
      B.box(5.5, 1.28, -7.7, 5.4, 0.16, 2.0, top, 0, false);
      B.box(-5.5, 0.25, -7.0, 8.6, 0.5, 0.7, [0.35, 0.26, 0.2], 0, false);
      B.box(5.5, 0.25, -7.0, 4.6, 0.5, 0.7, [0.35, 0.26, 0.2], 0, false);
      // sink
      B.box(-7.5, 1.34, -7.6, 1.7, 0.10, 1.1, [0.62, 0.66, 0.72], 0, false);
      B.cyl(-7.5, 1.75, -8.1, 0.05, 0.05, 0.8, [0.65, 0.68, 0.74], 6, false);
      B.cyl(-7.5, 2.1, -7.95, 0.045, 0.04, 0.4, [0.65, 0.68, 0.74], 6, false);
      // stove
      B.box(3.4, 0.65, -7.6, 2.6, 1.3, 1.9, [0.80, 0.80, 0.84], 0, { h: 1.5 });
      for (const [bx, bz] of [[-0.6, -0.45], [0.6, -0.45], [-0.6, 0.45], [0.6, 0.45]])
        B.disc(3.4 + bx, 1.315, -7.6 + bz, 0.28, [0.16, 0.16, 0.18], 10);
      B.box(3.4, 0.65, -6.6, 2.2, 0.7, 0.08, [0.35, 0.45, 0.55], 0, false);
      // fridge (east wall)
      B.box(10.6, 1.85, -4.5, 1.7, 3.7, 1.8, [0.90, 0.90, 0.93], 0, { h: 4 });
      B.box(9.68, 2.1, -4.1, 0.08, 1.1, 0.12, [0.65, 0.68, 0.75], 0, false);
      B.box(9.68, 1.2, -4.1, 0.08, 0.8, 0.12, [0.65, 0.68, 0.75], 0, false);
      B.box(9.7, 3.1, -4.9, 0.06, 0.25, 0.25, [0.9, 0.35, 0.35], 0, false);
      B.box(9.7, 2.6, -4.1, 0.06, 0.2, 0.3, [0.35, 0.55, 0.9], 0, false);
      B.box(9.7, 3.3, -4.2, 0.06, 0.18, 0.18, [0.95, 0.85, 0.35], 0, false);
      // kitchen table + chairs (low → mouse-only zone)
      const wood = [0.60, 0.42, 0.26];
      B.box(0.5, 1.0, 1.2, 2.6, 0.14, 1.8, wood, 0, { h: 1.0, catOnly: true });
      for (const [lx, lz] of [[-1.1, -0.65], [1.1, -0.65], [-1.1, 0.65], [1.1, 0.65]])
        B.box(0.5 + lx, 0.48, 1.2 + lz, 0.13, 0.96, 0.13, wood, 0, false);
      B.sphere(0.1, 1.24, 1.2, 0.22, [0.9, 0.55, 0.5], 6, 5, 1, 0.7, 1, false); // fruit bowl-ish
      B.sphere(0.7, 1.26, 1.05, 0.14, [0.95, 0.75, 0.3], 5, 4, 1, 0.85, 1, false);
      for (const [cx2, cz2, ry] of [[-1.9, 1.2, Math.PI / 2], [2.9, 1.2, -Math.PI / 2]]) {
        B.box(cx2, 0.55, cz2, 0.9, 0.12, 0.9, wood, 0, { h: 0.95, catOnly: true });
        B.box(cx2, 1.05, cz2 + (ry > 0 ? -0.38 : 0.38), 0.9, 1.0, 0.12, wood, 0, false);
        for (const [lx, lz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]])
          B.box(cx2 + lx, 0.27, cz2 + lz, 0.1, 0.55, 0.1, wood, 0, false);
      }
      // trash bin + broom
      B.cyl(-10.6, 0.55, 6.8, 0.45, 0.38, 1.1, [0.45, 0.52, 0.48], 9, true);
      B.cyl(-10.6, 1.15, 6.8, 0.5, 0.42, 0.12, [0.35, 0.42, 0.38], 9, false);
      B.box(-11.6, 1.1, 1.5, 0.09, 2.4, 0.09, [0.65, 0.45, 0.25], 0, false);
      B.box(-11.45, 0.15, 1.5, 0.4, 0.35, 0.12, [0.95, 0.75, 0.35], 0, false);
      // hanging pans (decor)
      B.cyl(-2, 2.35, -8.75, 0.28, 0.28, 0.22, [0.4, 0.42, 0.48], 8, false);
      B.cyl(0, 2.35, -8.75, 0.24, 0.24, 0.2, [0.45, 0.47, 0.53], 8, false);
      B.box(-1, 2.5, -8.85, 3.0, 0.08, 0.08, [0.4, 0.42, 0.48], 0, false);
      buildHole(B, this.hole.x, this.hole.z, this.hole.dx, this.hole.dz);
      return {
        cols: B.cols,
        cheese: [[-9.5, -5.6], [-4, -5.8], [1.5, -6], [8.2, -6], [8.9, 0.5], [0.5, 3.4], [-3.2, 6.6], [5.5, 6.5], [-10.8, 4.5], [0.5, 1.2], [-7.8, 3.8]],
        traps: [[-1.2, -5.2], [6.4, 3.2], [9.9, 6.8]]
      };
    }
  });

  /* ---- Level 3: Garden ---- */
  W3.DEFS.push({
    id: '3d-garden', name: 'Garden', icon: '🌳', desc: 'Trees, a pond & flower beds.',
    time: 170, sky: [0.55, 0.78, 0.95], fog: [0.62, 0.78, 0.92], fogRange: [30, 52],
    light: [0.35, 0.85, 0.3], ambient: 0.55,
    start: [-10.4, 7.4], hole: { x: -3, z: 8.9, dx: 0, dz: -1 },
    waypoints: [[-8, -6], [0, -6.5], [7, -6], [9, 0], [6, 5], [-1, 6], [-8, 5.5], [-10.5, 0]],
    build(S) {
      const B = new Builder(S);
      wallsAndFloor(B, { floor: 'grass', wall: [0.30, 0.58, 0.30], base: [0.35, 0.30, 0.22], trim: [0.42, 0.62, 0.38] });
      // hedge texture bumps on walls
      for (let i = 0; i < 24; i++) {
        const x = -11 + i;
        B.sphere(x, 2.4 + srand(i, 1) * 0.3, -8.8, 0.55, [0.24 + srand(i, 2) * 0.1, 0.5 + srand(i, 3) * 0.12, 0.24], 5, 4, 1, 0.7, 1, false);
        B.sphere(x, 2.2 + srand(i, 4) * 0.3, 8.8, 0.55, [0.26 + srand(i, 5) * 0.1, 0.52 + srand(i, 6) * 0.12, 0.26], 5, 4, 1, 0.7, 1, false);
      }
      // picket fence cap over grass walls (south hole side gets gap at hole)
      for (let i = -5; i < 5; i++)
        B.box(i * 2.2 + 0.5, 2.75, -8.8, 0.28, 0.5, 0.28, [0.85, 0.8, 0.7], 0, false);
      // dirt path + stepping stones
      B.box(0, 0.012, 2.5, 21, 0.05, 2.4, [0.52, 0.40, 0.28], 0, false);
      B.box(-3, 0.014, 6.3, 2.6, 0.05, 4.6, [0.52, 0.40, 0.28], 0, false);
      for (let i = 0; i < 9; i++) B.disc(-9.5 + i * 2.3, 0.05, 2.5 + Math.sin(i * 1.1) * 0.7, 0.55, [0.72, 0.72, 0.74], 8, 1.25, 0.9);
      // trees
      const tree = (x, z, s) => {
        B.cyl(x, 1.3 * s, z, 0.38 * s, 0.30 * s, 2.6 * s, [0.42, 0.30, 0.20], 8, 2.6 * s);
        B.sphere(x, 3.1 * s, z, 1.5 * s, [0.24, 0.52, 0.24], 8, 6, 1, 0.85, 1, false);
        B.sphere(x - 0.9 * s, 2.7 * s, z + 0.6 * s, 1.0 * s, [0.28, 0.58, 0.26], 7, 5, 1, 0.85, 1, false);
        B.sphere(x + 0.9 * s, 2.8 * s, z - 0.5 * s, 1.05 * s, [0.22, 0.48, 0.24], 7, 5, 1, 0.85, 1, false);
        B.sphere(x + 0.3 * s, 3.9 * s, z + 0.3 * s, 0.9 * s, [0.30, 0.60, 0.28], 7, 5, 1, 0.85, 1, false);
      };
      tree(-7, -4.5, 1.05); tree(6.5, -5, 1.2); tree(8.2, 6, 0.95);
      // bushes
      const bush = (x, z, s, c) => B.sphere(x, 0.55 * s, z, 0.75 * s, c, 7, 5, 1, 0.8, 1, 1.4 * s);
      bush(-10.2, -7.4, 1, [0.25, 0.55, 0.25]); bush(10.3, -7.2, 1.1, [0.30, 0.58, 0.25]);
      bush(10.4, 2.8, 0.9, [0.26, 0.52, 0.28]); bush(-1.5, -7.6, 1.2, [0.28, 0.56, 0.24]);
      bush(3.2, 7.6, 0.85, [0.24, 0.54, 0.3]);
      // pond
      B.disc(-6, 0.02, 4.6, 3.0, [0.78, 0.72, 0.55], 18, 1, 0.8);
      B.disc(-6, 0.04, 4.6, 2.6, [0.25, 0.55, 0.75], 18, 1, 0.72);
      B.disc(-6.7, 0.06, 4.3, 0.45, [0.35, 0.65, 0.35], 8, 1.3, 1);
      B.disc(-5.4, 0.06, 5.0, 0.38, [0.32, 0.62, 0.32], 8, 1.3, 1);
      B.col(-6, 4.6, 4.6, 3.4, 0.8); // pond collider (visual approx)
      // flowers
      const petals = [[0.95, 0.35, 0.35], [0.98, 0.8, 0.3], [0.95, 0.55, 0.75], [0.95, 0.95, 0.9], [0.6, 0.45, 0.85]];
      for (let i = 0; i < 14; i++) {
        const fx = -10.5 + srand(i, 7) * 21, fz = -7.5 + srand(i + 5, 9) * 15;
        if (Math.abs(fz - 2.5) < 2.2 && fx > -10) continue; // keep off path
        B.cyl(fx, 0.3, fz, 0.035, 0.03, 0.6, [0.3, 0.55, 0.3], 5, false);
        B.sphere(fx, 0.66, fz, 0.14, petals[Math.floor(srand(i, 11) * 5)], 5, 4, 1, 0.6, 1, false);
        B.sphere(fx, 0.70, fz, 0.06, [0.98, 0.85, 0.3], 4, 3, 1, 0.6, 1, false);
      }
      // birdhouse
      B.cyl(2.2, 1.0, 7.6, 0.07, 0.06, 2.0, [0.55, 0.4, 0.25], 6, true);
      B.box(2.2, 2.35, 7.6, 0.8, 0.7, 0.8, [0.75, 0.55, 0.35], 0, false);
      B.cyl(2.2, 2.85, 7.6, 0.05, 0.75, 0.5, [0.6, 0.35, 0.25], 6, false);
      B.disc(2.2, 2.42, 7.22, 0.12, [0.15, 0.12, 0.1], 8);
      // watering can + pot
      B.cyl(-10.4, 0.25, -2.5, 0.3, 0.24, 0.5, [0.55, 0.35, 0.3], 8, false);
      B.cyl(-10.1, 0.45, -2.2, 0.05, 0.04, 0.5, [0.55, 0.35, 0.3], 5, false);
      buildHole(B, this.hole.x, this.hole.z, this.hole.dx, this.hole.dz);
      return {
        cols: B.cols,
        cheese: [[-9.8, -6.5], [-2.5, -6.8], [4.5, -6.9], [9.7, -3], [10.2, 7.6], [5.2, 6.9], [0.8, 6.9], [-9.9, 6.7], [-6, 0.6], [2.2, 0.4], [-0.5, -2.6]],
        traps: [[-4.4, 3.4], [3.4, 0.9], [-8.6, -1.4]]
      };
    }
  });

  /* ============ COLLISION / LOS ============ */
  function resolveCircle(px, pz, r, cols, includeCatOnly) {
    for (const b of cols) {
      if (b.catOnly && !includeCatOnly) continue;
      const cx = clamp(px, b.x0, b.x1), cz = clamp(pz, b.z0, b.z1);
      const dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = (r - d) / d;
          px += dx * push; pz += dz * push;
        } else {
          const l = px - b.x0, rr = b.x1 - px, tt = pz - b.z0, bo = b.z1 - pz;
          const m = Math.min(l, rr, tt, bo);
          if (m === l) px = b.x0 - r; else if (m === rr) px = b.x1 + r;
          else if (m === tt) pz = b.z0 - r; else pz = b.z1 + r;
        }
      }
    }
    return [px, pz];
  }
  function segHitsBox(x0, z0, x1, z1, b) {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dz = z1 - z0;
    const p = [-dx, dx, -dz, dz], q = [x0 - b.x0, b.x1 - x0, z0 - b.z0, b.z1 - z0];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return false; }
      else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return true;
  }
  function losFree(x0, z0, x1, z1, cols) {
    for (const b of cols) {
      if (b.h < 1.15 || b.catOnly) continue;
      if (segHitsBox(x0, z0, x1, z1, b)) return false;
    }
    return true;
  }

  /* ============ GAME ============ */
  class Game3D {
    constructor(renderer, def, opts = {}) {
      this.R = renderer; this.def = def; this.demo = !!opts.demo;
      this.onEvent = opts.onEvent || function () {};
      const S = new FaceSink();
      const L = def.build(S);
      this.colliders = L.cols;
      this.cheese = L.cheese.map(c => ({ x: c[0], z: c[1], taken: false }));
      this.traps = L.traps.map(t => ({ x: t[0], z: t[1], sprung: false, t: 0 }));
      this.R.setStatic(S);
      this.mouseParts = makeMouse();
      this.catParts = makeCat();
      this.cheeseMesh = makeCheese();
      this.trapMesh = makeTrap();
      this.particles = [];
      this.lives = 3; this.deaths = 0;
      this.status = 'play';
      this.timeLeft = def.time;
      this.timeUsed = 0;
      this.cam = { eye: [0, 9.6, 12], yaw: 0, pitch: -0.75 };
      this.shake = 0;
      this.cheeseGot = 0;
      this._resetActors();
      // theme
      this.R.light = def.light; this.R.ambient = def.ambient;
      this.R.fogColor = def.fog; this.R.fogRange = def.fogRange;
    }

    _resetActors() {
      const d = this.def;
      this.pl = { x: d.start[0], z: d.start[1], y: 0, vx: 0, vz: 0, vy: 0, yaw: Math.PI / 2 + Math.PI / 2, phase: 0, stamina: 1, stun: 0, invuln: 2, sp: 0 };
      this.pl.yaw = Math.atan2(-d.start[0], -d.start[1]) + Math.PI; // face room center
      this.cat = { x: 0, z: -2, vx: 0, vz: 0, yaw: Math.PI, phase: 0, state: 'patrol', wp: 0, pause: 1, lastSeen: null, loseT: 0, sp: 0, stuckT: 0, detour: null, detourT: 0, pounce: false };
      // put cat at waypoint far from start
      let best = 0, bd = -1;
      d.waypoints.forEach((w, i) => { const dd = CC.dist2d(w[0], w[1], d.start[0], d.start[1]); if (dd > bd) { bd = dd; best = i; } });
      this.cat.x = d.waypoints[best][0]; this.cat.z = d.waypoints[best][1]; this.cat.wp = best;
      if (this.demo) this._demoPickTarget();
    }

    burst(x, y, z, col, n, spread, up) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, r = Math.random() * spread;
        this.particles.push({ x, y, z, vx: Math.cos(a) * r, vy: Math.random() * up + up * 0.4, vz: Math.sin(a) * r,
          life: 0.55 + Math.random() * 0.4, max: 0.9, col, s: 0.07 + Math.random() * 0.07, grav: -6 });
      }
    }

    update(dt) {
      if (this.status !== 'play' && this.status !== 'demo') return;
      const t = this.t = (this.t || 0) + dt;
      const pl = this.pl, cat = this.cat, D = this.def;

      /* ---- player input / demo brain ---- */
      let ix = 0, iz = 0, wantSprint = false, wantJump = false;
      if (this.demo) {
        const b = this._demoBrain(dt);
        ix = b.x; iz = b.z; wantSprint = b.sprint; wantJump = b.jump;
      } else {
        const a = CC.Input.axis();
        ix = a.x; iz = a.z;
        wantSprint = CC.Input.sprint() && a.len > 0.1;
        wantJump = CC.Input.consumeJump();
      }
      if (pl.stun > 0) { ix = iz = 0; wantSprint = false; }

      const canSprint = wantSprint && pl.stamina > 0.02 && pl.stun <= 0;
      const maxSp = canSprint ? 7.8 : 5.2;
      pl.stamina = clamp(pl.stamina + (canSprint ? -0.34 : 0.30) * dt, 0, 1);

      const tvx = ix * maxSp, tvz = iz * maxSp;
      const acc = 1 - Math.exp(-dt * 10);
      pl.vx = lerp(pl.vx, tvx, acc); pl.vz = lerp(pl.vz, tvz, acc);
      pl.x += pl.vx * dt; pl.z += pl.vz * dt;

      // jump
      if (wantJump && pl.y <= 0.001 && pl.stun <= 0) {
        pl.vy = 8.4; this._sfx('jump');
      }
      pl.vy -= 24 * dt; pl.y += pl.vy * dt;
      if (pl.y < 0) { if (pl.vy < -6) this._sfx('land'); pl.y = 0; pl.vy = 0; }

      // collisions (mouse ignores catOnly furniture = slips under!)
      [pl.x, pl.z] = resolveCircle(pl.x, pl.z, 0.42, this.colliders, false);
      pl.x = clamp(pl.x, -11.4, 11.4); pl.z = clamp(pl.z, -8.4, 8.4);

      const spd = Math.hypot(pl.vx, pl.vz);
      pl.sp = clamp(spd / 7.8, 0, 1);
      if (spd > 0.4) {
        const ty = Math.atan2(pl.vx, pl.vz);
        let dy = ty - pl.yaw;
        while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
        pl.yaw += dy * (1 - Math.exp(-dt * 14));
      }
      pl.phase += dt * (2.2 + spd * 2.1);
      if (pl.stun > 0) pl.stun -= dt;
      if (pl.invuln > 0) pl.invuln -= dt;

      // dust puffs while sprinting
      if (canSprint && spd > 6 && Math.random() < dt * 14)
        this.burst(pl.x, 0.08, pl.z, [0.85, 0.8, 0.7], 1, 0.6, 1.4);

      /* ---- cheese ---- */
      for (const c of this.cheese) {
        if (c.taken) continue;
        if (pl.y < 0.5 && CC.dist2d(pl.x, pl.z, c.x, c.z) < 0.95) {
          c.taken = true; this.cheeseGot++;
          this.burst(c.x, 0.5, c.z, [1, 0.85, 0.3], 14, 2.2, 3.2);
          this._sfx('pickup');
          this.onEvent('cheese', { got: this.cheeseGot, total: this.cheese.length });
          if (this.cheeseGot === this.cheese.length) {
            this.onEvent('toast', '🧀 All cheese grabbed — RUN to your mouse hole! 🏠');
            this._sfx('open');
          }
        }
      }

      /* ---- traps ---- */
      for (const tr of this.traps) {
        if (tr.sprung) { tr.t = Math.min(1, tr.t + dt * 12); continue; }
        if (pl.y < 0.32 && CC.dist2d(pl.x, pl.z, tr.x, tr.z) < 0.6 && pl.stun <= 0) {
          tr.sprung = true; tr.t = 0;
          pl.stun = 1.25; pl.vx = pl.vz = 0;
          this.shake = 0.5;
          this.burst(tr.x, 0.25, tr.z, [0.7, 0.65, 0.6], 10, 2, 2);
          this._sfx('trap');
          this.onEvent('toast', 'OUCH! A mousetrap — Whiskers heard that! 😾');
          // cat hears the snap
          if (CC.dist2d(cat.x, cat.z, tr.x, tr.z) < 26) {
            cat.state = 'chase'; cat.lastSeen = [tr.x, tr.z]; cat.loseT = 0;
          }
        }
      }

      /* ---- cat AI ---- */
      this._updateCat(dt);

      /* ---- caught? ---- */
      const dcat = CC.dist2d(cat.x, cat.z, pl.x, pl.z);
      if (dcat < 1.18 && cat.pause < 1.2 && pl.invuln <= 0) {
        if (this.demo) {
          this.burst(pl.x, 0.8, pl.z, [1, 0.9, 0.4], 16, 3, 4);
          pl.x = CC.choice([[-10.4, 7.4], [10.4, -7.4], [-10.4, -7.4], [10.4, 7.4]])[0];
          pl.z = CC.choice([[-10.4, 7.4], [10.4, -7.4], [-10.4, -7.4], [10.4, 7.4]])[1];
          pl.vx = pl.vz = 0; cat.pause = 2;
        } else {
          this.lives--; this.deaths++;
          this.shake = 0.85;
          this._sfx('meow'); setTimeout(() => this._sfx('caught'), 120);
          this.onEvent('caught', { lives: this.lives });
          this.burst(pl.x, 0.8, pl.z, [1, 0.85, 0.3], 20, 3.4, 4.4);
          if (this.lives <= 0) {
            this.status = 'over';
            this.onEvent('over', { deaths: this.deaths });
            return;
          }
          pl.x = D.start[0]; pl.z = D.start[1]; pl.vx = pl.vz = 0; pl.stun = 0; pl.invuln = 2.6;
          cat.pause = 2.4; cat.state = 'patrol';
          let best = 0, bd = -1;
          D.waypoints.forEach((w, i) => { const dd = CC.dist2d(w[0], w[1], pl.x, pl.z); if (dd > bd) { bd = dd; best = i; } });
          cat.x = D.waypoints[best][0]; cat.z = D.waypoints[best][1]; cat.wp = best;
        }
      }

      /* ---- exit hole ---- */
      if (!this.demo && this.cheeseGot >= this.cheese.length) {
        const hx = D.hole.x + D.hole.dx * 0.8, hz = D.hole.z + D.hole.dz * 0.8;
        if (CC.dist2d(pl.x, pl.z, hx, hz) < 1.35) {
          this.status = 'complete';
          this.timeUsed = D.time - this.timeLeft;
          this.burst(hx, 0.6, hz, [1, 0.9, 0.4], 24, 3, 4.5);
          this._sfx('win');
          this.onEvent('complete', { time: this.timeUsed, deaths: this.deaths });
          return;
        }
      }

      /* ---- timer ---- */
      if (!this.demo) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0; this.status = 'over';
          this._sfx('lose');
          this.onEvent('over', { timeout: true, deaths: this.deaths });
          return;
        }
      }

      /* ---- particles ---- */
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.vy += (p.grav || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.03) { p.y = 0.03; p.vy *= -0.3; p.vx *= 0.8; p.vz *= 0.8; }
      }

      /* ---- camera ---- */
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.6);
      if (this.demo) {
        const a = t * 0.11;
        this.cam.eye = [Math.sin(a) * 12.5, 8.2, Math.cos(a) * 12.5];
        const dx = -this.cam.eye[0], dz = -this.cam.eye[2], dl = Math.hypot(dx, dz);
        this.cam.yaw = Math.atan2(dx, -dz);
        this.cam.pitch = Math.asin(clamp((0.5 - this.cam.eye[1]) / Math.hypot(dl, 0.5 - this.cam.eye[1]), -1, 1));
      } else {
        const tx = clamp(pl.x + pl.vx * 0.28, -10.9, 10.9);
        const tz = clamp(pl.z + pl.vz * 0.28 + 8.4, -8.4, 8.55);
        const k = 1 - Math.exp(-dt * 5);
        this.cam.eye[0] = lerp(this.cam.eye[0], tx, k);
        this.cam.eye[1] = lerp(this.cam.eye[1], 9.6, k);
        this.cam.eye[2] = lerp(this.cam.eye[2], tz, k);
        this.cam.yaw = 0; this.cam.pitch = -0.73;
      }
      if (this.shake > 0) {
        const s = this.shake * 0.5;
        this.cam.eye[0] += CC.rand(-s, s); this.cam.eye[1] += CC.rand(-s, s) * 0.5; this.cam.eye[2] += CC.rand(-s, s);
      }
    }

    _updateCat(dt) {
      const cat = this.cat, pl = this.pl, D = this.def;
      const d = CC.dist2d(cat.x, cat.z, pl.x, pl.z);
      const sees = d < 11.5 && losFree(cat.x, cat.z, pl.x, pl.z, this.colliders);
      const hears = (pl.sp > 0.55 && d < 15) || (pl.stun > 0 && d < 18);
      cat.pounce = false;

      if (cat.state === 'patrol') {
        if ((sees || hears) && cat.pause <= 0) {
          cat.state = 'chase'; cat.loseT = 0;
          this._sfx('hiss');
          if (!this.demo) this.onEvent('toast', '😾 Whiskers spotted you!');
        }
      } else if (cat.state === 'chase') {
        cat.lastSeen = [pl.x, pl.z];
        if (!sees && !hears && d > 7) {
          cat.loseT += dt;
          if (cat.loseT > 2.4 || d > 20) { cat.state = 'search'; cat.loseT = 0; }
        } else cat.loseT = 0;
      } else if (cat.state === 'search') {
        if (sees || hears) { cat.state = 'chase'; cat.loseT = 0; }
        cat.loseT += dt;
        if (cat.loseT > 2.6) { cat.state = 'patrol'; cat.loseT = 0; }
      }

      let tx, tz, speed;
      if (cat.state === 'chase') {
        tx = pl.x + pl.vx * 0.22; tz = pl.z + pl.vz * 0.22;
        speed = 5.55; cat.pounce = d < 3.5;
      } else if (cat.state === 'search' && cat.lastSeen) {
        tx = cat.lastSeen[0]; tz = cat.lastSeen[1]; speed = 3.6;
        if (CC.dist2d(cat.x, cat.z, tx, tz) < 1.2) { cat.yaw += dt * 2.6; tx = cat.x; tz = cat.z; speed = 0; }
      } else {
        const w = D.waypoints[cat.wp];
        tx = w[0]; tz = w[1]; speed = 2.4;
        if (CC.dist2d(cat.x, cat.z, tx, tz) < 1.0) {
          if (cat.pause > 0) { cat.pause -= dt; speed = 0; tx = cat.x; tz = cat.z; cat.yaw += Math.sin(this.t * 1.4) * dt * 1.2; }
          else { cat.wp = (cat.wp + 1) % D.waypoints.length; cat.pause = CC.rand(0.3, 1.2); }
        }
      }

      // stuck detection → detour
      if (cat.detourT > 0) {
        cat.detourT -= dt;
        tx = cat.detour[0]; tz = cat.detour[1];
      }
      let dx = tx - cat.x, dz = tz - cat.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      if (speed > 0 && cat.pause <= 0.01 && cat.state !== 'search') {
        const moved = Math.hypot(cat.vx, cat.vz);
        if (moved < speed * 0.25) cat.stuckT += dt; else cat.stuckT = Math.max(0, cat.stuckT - dt * 2);
        if (cat.stuckT > 0.7 && cat.detourT <= 0) {
          const side = Math.random() < 0.5 ? 1 : -1;
          cat.detour = [cat.x + -dz * side * 3.2, cat.z + dx * side * 3.2];
          cat.detourT = 1.0; cat.stuckT = 0;
        }
      }
      if (cat.pause > 0 && cat.state === 'patrol') cat.pause -= dt;

      const acc = 1 - Math.exp(-dt * 7);
      cat.vx = lerp(cat.vx, dx * speed, acc);
      cat.vz = lerp(cat.vz, dz * speed, acc);
      cat.x += cat.vx * dt; cat.z += cat.vz * dt;
      [cat.x, cat.z] = resolveCircle(cat.x, cat.z, 0.72, this.colliders, true);
      cat.x = clamp(cat.x, -11.2, 11.2); cat.z = clamp(cat.z, -8.2, 8.2);
      const cspd = Math.hypot(cat.vx, cat.vz);
      cat.sp = clamp(cspd / 5.5, 0, 1);
      if (cspd > 0.35) {
        const ty = Math.atan2(cat.vx, cat.vz);
        let dy = ty - cat.yaw;
        while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
        cat.yaw += dy * (1 - Math.exp(-dt * 10));
      }
      cat.phase += dt * (1.6 + cspd * 1.9);
    }

    /* demo brain: wander, flee cat */
    _demoPickTarget() {
      for (let i = 0; i < 12; i++) {
        const x = CC.rand(-9.5, 9.5), z = CC.rand(-6.5, 6.5);
        const [rx, rz] = resolveCircle(x, z, 0.5, this.colliders, false);
        if (Math.abs(rx - x) < 0.05 && Math.abs(rz - z) < 0.05) { this._demoT = [x, z]; return; }
      }
      this._demoT = [0, 0];
    }
    _demoBrain(dt) {
      const pl = this.pl, cat = this.cat;
      this._demoTimer = (this._demoTimer || 0) - dt;
      const dcat = CC.dist2d(pl.x, pl.z, cat.x, cat.z);
      if (dcat < 6.5) {
        const dx = pl.x - cat.x, dz = pl.z - cat.z, l = Math.hypot(dx, dz) || 1;
        this._demoT = [clamp(pl.x + dx / l * 6, -10, 10), clamp(pl.z + dz / l * 6, -7, 7)];
        this._demoTimer = 0.6;
        return { x: dx / l, z: dz / l, sprint: true, jump: Math.random() < dt * 2.5 };
      }
      if (this._demoTimer <= 0 || !this._demoT || CC.dist2d(pl.x, pl.z, this._demoT[0], this._demoT[1]) < 0.8) {
        this._demoPickTarget(); this._demoTimer = CC.rand(2, 4.5);
      }
      const dx = this._demoT[0] - pl.x, dz = this._demoT[1] - pl.z, l = Math.hypot(dx, dz) || 1;
      return { x: dx / l, z: dz / l, sprint: false, jump: false };
    }

    _sfx(n) { if (!this.demo) CC.SFX.play(n); }

    /* objective for HUD arrow: nearest cheese, or hole */
    objective() {
      if (this.cheeseGot < this.cheese.length) {
        let best = null, bd = 1e9;
        for (const c of this.cheese) {
          if (c.taken) continue;
          const d = CC.dist2d(this.pl.x, this.pl.z, c.x, c.z);
          if (d < bd) { bd = d; best = c; }
        }
        return best ? { x: best.x, z: best.z, d: bd, type: 'cheese' } : null;
      }
      const D = this.def;
      const hx = D.hole.x + D.hole.dx * 0.8, hz = D.hole.z + D.hole.dz * 0.8;
      return { x: hx, z: hz, d: CC.dist2d(this.pl.x, this.pl.z, hx, hz), type: 'home' };
    }

    render() {
      const R = this.R, pl = this.pl, cat = this.cat, t = this.t || 0;
      R.beginFrame(this.cam, this.def.sky);
      const dyn = R.dyn, shad = R.shadow, trans = R.trans;

      /* cheese wedges */
      for (let i = 0; i < this.cheese.length; i++) {
        const c = this.cheese[i];
        if (c.taken) continue;
        const bob = Math.sin(t * 2.4 + i * 1.3) * 0.09;
        dyn.meshTRS(this.cheeseMesh, c.x, 0.12 + bob, c.z, t * 1.1 + i, 0, 1);
        shad.disc(c.x, 0.028, c.z, 0.34, [0.1, 0.08, 0.06], 10);
      }

      /* traps */
      for (const tr of this.traps) {
        dyn.meshTRS(this.trapMesh.base, tr.x, 0, tr.z, 0, 0, 1);
        const rx = tr.sprung ? lerp(-1.25, 0, tr.t) : -1.25 + Math.sin(t * 9) * 0.04;
        dyn.meshTRS(this.trapMesh.bar, tr.x, 0.10, tr.z + (tr.sprung ? 0.02 : -0.2), 0, rx, 1);
        shad.disc(tr.x, 0.026, tr.z, 0.34, [0.1, 0.08, 0.06], 8);
      }

      /* characters */
      const S_pl = { t, phase: pl.phase, sp: pl.sp, stun: pl.stun > 0 ? 1 : 0, vy: pl.vy };
      const blink = pl.invuln > 0 && Math.floor(t * 9) % 2 === 0;
      if (!blink) {
        flushPuppet(dyn, this.mouseParts, pl.x, pl.y, pl.z, pl.yaw, S_pl);
        shad.disc(pl.x, 0.03, pl.z, 0.5 - clamp(pl.y * 0.16, 0, 0.3), [0.08, 0.06, 0.05], 12);
      }
      const S_cat = { t, phase: cat.phase, sp: cat.sp, stun: 0, pounce: cat.pounce };
      flushPuppet(dyn, this.catParts, cat.x, 0, cat.z, cat.yaw, S_cat);
      shad.disc(cat.x, 0.03, cat.z, 0.95, [0.08, 0.06, 0.05], 14);

      /* hole glow + flag when active */
      const active = this.cheeseGot >= this.cheese.length;
      const D = this.def, H = D.hole;
      if (active) {
        const pulse = 0.75 + Math.sin(t * 5) * 0.25;
        trans.disc(H.x + H.dx * 0.9, 0.045, H.z + H.dz * 0.9, 1.05 * pulse, [1, 0.85, 0.3], 16,
          Math.abs(H.dx) * 0.7 + Math.abs(H.dz), Math.abs(H.dz) * 0.7 + Math.abs(H.dx));
        // little flag
        const fx = H.x + H.dx * 0.3 - H.dz * 1.1, fz = H.z + H.dz * 0.3 + H.dx * 1.1;
        dyn.meshTRS(this._flagPole || (this._flagPole = new Mesh().cyl(0, 0.8, 0, 0.05, 0.04, 1.6, [0.55, 0.4, 0.25], 6)), fx, 0, fz, 0, 0, 1);
        const flag = new Mesh();
        const w = Math.sin(t * 6) * 0.08;
        flag.quad([0, 1.45, 0], [0.55 + w, 1.5, 0.05], [0.5 + w, 1.18, 0.04], [0, 1.15, 0], [0.95, 0.3, 0.3]);
        flag.quad([0, 1.15, 0], [0.5 + w, 1.18, 0.04], [0.55 + w, 1.5, 0.05], [0, 1.45, 0], [0.95, 0.3, 0.3]);
        const cs = Math.cos(Math.atan2(H.dx, H.dz)), sn = Math.sin(Math.atan2(H.dx, H.dz));
        dyn.mesh(flag, CC.R3.m4Mul(CC.R3.m4T(fx, 0, fz), CC.R3.m4RY(Math.atan2(H.dx, H.dz))));
        if (Math.random() < 0.09) this.burst(H.x + H.dx * 0.8, 0.3, H.z + H.dz * 0.8, [1, 0.9, 0.4], 1, 0.8, 2.4);
      }

      /* particles */
      for (const p of this.particles) {
        const a = clamp(p.life / p.max, 0, 1);
        dyn.meshTRS(cubeMesh, p.x, p.y, p.z, p.life * 5, 0, p.s * a + 0.02);
      }

      R.flushDynamic();
    }
  }
  W3.Game3D = Game3D;
})();

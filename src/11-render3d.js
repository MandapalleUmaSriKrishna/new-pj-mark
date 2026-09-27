/* ================================================================
   CHEESE CHASE — hand-rolled WebGL 3D engine (no libraries!)
   Column-major mat4, flat-shaded colored faces, fog, blob shadows.
   ================================================================ */
'use strict';
(() => {
  const R3 = CC.R3 = {};

  /* ---------------- mat4 (column-major, WebGL layout) ---------------- */
  R3.m4Ident = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  R3.m4Mul = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
    return o;
  };
  R3.m4T = (x,y,z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
  R3.m4S = (x,y,z) => [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1];
  R3.m4RX = a => { const c=Math.cos(a), s=Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; };
  R3.m4RY = a => { const c=Math.cos(a), s=Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; };
  R3.m4Persp = (fov, asp, n, f) => {
    const t = 1 / Math.tan(fov / 2);
    return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)/(n-f),-1, 0,0,2*f*n/(n-f),0];
  };
  R3.m4View = (eye, yaw, pitch) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = sy * cp, fy = sp, fz = -cy * cp;          // forward
    let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl; // right
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // up = cross(r,f)
    return [
      rx, ux, -fx, 0,
      0,  uy, -fy, 0,
      rz, uz, -fz, 0,
      -(rx*eye[0] + 0*eye[1] + rz*eye[2]),
      -(ux*eye[0] + uy*eye[1] + uz*eye[2]),
       (fx*eye[0] + fy*eye[1] + fz*eye[2]), 1
    ];
  };
  R3.applyM4 = (m, v) => [
    m[0]*v[0] + m[4]*v[1] + m[8]*v[2] + m[12],
    m[1]*v[0] + m[5]*v[1] + m[9]*v[2] + m[13],
    m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14]
  ];

  /* ---------------- Mesh: colored quads in local space ---------------- */
  class Mesh {
    constructor() { this.faces = []; }
    quad(a, b, c, d, col) { this.faces.push({ v: [a, b, c, d], c: col }); }
    /* axis box centered at (cx,cy,cz), size (sx,sy,sz), optional rotY */
    box(cx, cy, cz, sx, sy, sz, col, ry = 0) {
      const hx = sx/2, hy = sy/2, hz = sz/2, cs = Math.cos(ry), sn = Math.sin(ry);
      const P = (x, y, z) => [cx + x*cs + z*sn, cy + y, cz - x*sn + z*cs];
      const v000 = P(-hx,-hy,-hz), v100 = P(hx,-hy,-hz), v110 = P(hx,hy,-hz), v010 = P(-hx,hy,-hz);
      const v001 = P(-hx,-hy,hz), v101 = P(hx,-hy,hz), v111 = P(hx,hy,hz), v011 = P(-hx,hy,hz);
      this.quad(v000, v100, v110, v010, col); // -z
      this.quad(v101, v001, v011, v111, col); // +z
      this.quad(v010, v110, v111, v011, col); // +y
      this.quad(v001, v101, v100, v000, col); // -y
      this.quad(v100, v101, v111, v110, col); // +x
      this.quad(v001, v000, v010, v011, col); // -x
      return this;
    }
    /* uv-sphere, squashable, segments (su x sv) */
    sphere(cx, cy, cz, r, col, su = 8, sv = 6, sx = 1, sy = 1, sz = 1) {
      const pt = (i, j) => {
        const u = i / su * CC.TAU, v = j / sv * Math.PI;
        return [cx + Math.sin(v)*Math.cos(u)*r*sx, cy + Math.cos(v)*r*sy, cz + Math.sin(v)*Math.sin(u)*r*sz];
      };
      for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
        const a = pt(i, j), b = pt(i+1, j), c = pt(i+1, j+1), d = pt(i, j+1);
        if (j === 0) this.quad(a, a, c, d, col);
        else if (j === sv-1) this.quad(a, b, d, d, col);
        else this.quad(a, b, c, d, col);
      }
      return this;
    }
    /* cylinder / cone (r1=0 → cone), centered at cy, height h */
    cyl(cx, cy, cz, r0, r1, h, col, seg = 8) {
      const y0 = cy - h/2, y1 = cy + h/2;
      for (let i = 0; i < seg; i++) {
        const a0 = i/seg*CC.TAU, a1 = (i+1)/seg*CC.TAU;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        this.quad([cx + c0*r0, y0, cz + s0*r0], [cx + c1*r0, y0, cz + s1*r0],
                  [cx + c1*r1, y1, cz + s1*r1], [cx + c0*r1, y1, cz + s0*r1], col);
        if (r1 > 0.001) this.quad([cx, y1, cz], [cx + c1*r1, y1, cz + s1*r1], [cx + c0*r1, y1, cz + s0*r1], [cx, y1, cz], col);
        if (r0 > 0.001) this.quad([cx, y0, cz], [cx + c0*r0, y0, cz + s0*r0], [cx + c1*r0, y0, cz + s1*r0], [cx, y0, cz], col);
      }
      return this;
    }
    /* flat disc on floor (upward), squashed ellipse via rx/rz */
    disc(cx, cy, cz, r, col, seg = 14, rx = 1, rz = 1) {
      for (let i = 0; i < seg; i++) {
        const a0 = i/seg*CC.TAU, a1 = (i+1)/seg*CC.TAU;
        this.quad([cx, cy, cz],
          [cx + Math.cos(a0)*r*rx, cy, cz + Math.sin(a0)*r*rz],
          [cx + Math.cos(a1)*r*rx, cy, cz + Math.sin(a1)*r*rz],
          [cx, cy, cz], col);
      }
      return this;
    }
    /* triangular prism — the cheese wedge (points +x) */
    wedge(cx, cy, cz, len, wid, h, col) {
      const hl = len/2, hw = wid/2;
      const a = [cx - hl, cy, cz - hw], b = [cx + hl, cy, cz], c = [cx - hl, cy, cz + hw];
      const a2 = [cx - hl, cy + h, cz - hw], b2 = [cx + hl, cy + h, cz], c2 = [cx - hl, cy + h, cz + hw];
      this.quad(a, c, b, b, col);            // bottom
      this.quad(a2, b2, c2, c2, col);        // top slant
      this.quad(a, b, b2, a2, col);          // side 1
      this.quad(b, c, c2, b2, col);          // side 2
      this.quad(c, a, a2, c2, col);          // back
      return this;
    }
    merge(m) { for (const f of m.faces) this.faces.push(f); return this; }
  }
  R3.Mesh = Mesh;

  /* ---------------- Face sink: accumulate triangles ---------------- */
  class FaceSink {
    constructor() { this.pos = []; this.col = []; this.count = 0; }
    _tri(p0, p1, p2, col) {
      // face normal from cross product
      const ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
      const vx = p2[0]-p0[0], vy = p2[1]-p0[1], vz = p2[2]-p0[2];
      let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx/=l; ny/=l; nz/=l;
      const P = this.pos, C = this.col;
      P.push(p0[0],p0[1],p0[2], nx,ny,nz, p1[0],p1[1],p1[2], nx,ny,nz, p2[0],p2[1],p2[2], nx,ny,nz);
      for (let i = 0; i < 3; i++) C.push(col[0], col[1], col[2]);
      this.count += 3;
    }
    quad(a, b, c, d, col) { this._tri(a, b, c, col); this._tri(a, c, d, col); }
    /* flat disc on the floor (blob shadows, glows) */
    disc(cx, cy, cz, r, col, seg = 12, rx = 1, rz = 1) {
      if (!this._scratch) this._scratch = new Mesh();
      this._scratch.disc(cx, cy, cz, r, col, seg, rx, rz);
      this.mesh(this._scratch, null);
      this._scratch.faces.length = 0;
    }
    /* push a whole mesh through a transform matrix */
    mesh(m, mat) {
      if (!mat) { for (const f of m.faces) this.quad(f.v[0], f.v[1], f.v[2], f.v[3], f.c); return; }
      const p = [[0,0,0],[0,0,0],[0,0,0],[0,0,0]];
      for (const f of m.faces) {
        for (let i = 0; i < 4; i++) p[i] = R3.applyM4(mat, f.v[i]);
        this.quad(p[0], p[1], p[2], p[3], f.c);
      }
    }
    /* push mesh with simple T*Ry*Rx*S — fast path for character parts */
    meshTRS(m, px, py, pz, ry, rx, s) {
      const cs = Math.cos(ry), sn = Math.sin(ry), cx2 = Math.cos(rx), sx2 = Math.sin(rx);
      const P = (v) => {
        let x = v[0]*s, y = v[1]*s, z = v[2]*s;
        let y2 = y*cx2 - z*sx2, z2 = y*sx2 + z*cx2;      // RX
        let x3 = x*cs + z2*sn, z3 = -x*sn + z2*cs;       // RY
        return [px + x3, py + y2, pz + z3];
      };
      const p = [[0,0,0],[0,0,0],[0,0,0],[0,0,0]];
      for (const f of m.faces) {
        for (let i = 0; i < 4; i++) p[i] = P(f.v[i]);
        this.quad(p[0], p[1], p[2], p[3], f.c);
      }
    }
    build() {
      const inter = new Float32Array(this.count * 6); // pos+normal then color? -> we store interleaved pos(3)+nrm(3), colors separate
      // simpler: two buffers
      return { geom: new Float32Array(this.pos), col: new Float32Array(this.col), n: this.count };
    }
  }
  R3.FaceSink = FaceSink;

  /* ---------------- Renderer ---------------- */
  const VSH = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol;
    uniform mat4 uPV; uniform vec3 uEye;
    varying vec3 vCol; varying vec3 vNrm; varying float vDist;
    void main() {
      gl_Position = uPV * vec4(aPos, 1.0);
      vCol = aCol; vNrm = aNrm;
      vDist = distance(aPos, uEye);
    }`;
  const FSH = `
    precision mediump float;
    varying vec3 vCol; varying vec3 vNrm; varying float vDist;
    uniform vec3 uLight; uniform float uAmbient; uniform float uAlpha;
    uniform vec3 uFogCol; uniform vec2 uFogRange;
    void main() {
      float diff = abs(dot(normalize(vNrm), uLight));
      vec3 col = vCol * (uAmbient + diff * (1.0 - uAmbient));
      float f = clamp((vDist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
      col = mix(col, uFogCol, f * 0.85);
      gl_FragColor = vec4(col, uAlpha);
    }`;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = this.gl = canvas.getContext('webgl', { antialias: true }) ||
                            canvas.getContext('experimental-webgl', { antialias: true });
      if (!gl) throw new Error('WebGL unavailable');
      const mk = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = this.prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VSH));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FSH));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);

      this.aPos = gl.getAttribLocation(prog, 'aPos');
      this.aNrm = gl.getAttribLocation(prog, 'aNrm');
      this.aCol = gl.getAttribLocation(prog, 'aCol');
      this.uPV = gl.getUniformLocation(prog, 'uPV');
      this.uEye = gl.getUniformLocation(prog, 'uEye');
      this.uLight = gl.getUniformLocation(prog, 'uLight');
      this.uAmbient = gl.getUniformLocation(prog, 'uAmbient');
      this.uAlpha = gl.getUniformLocation(prog, 'uAlpha');
      this.uFogCol = gl.getUniformLocation(prog, 'uFogCol');
      this.uFogRange = gl.getUniformLocation(prog, 'uFogRange');

      this.vboG = gl.createBuffer();
      this.vboC = gl.createBuffer();
      this.dynG = gl.createBuffer();
      this.dynC = gl.createBuffer();

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.light = [0.44, 0.78, 0.44];
      this.ambient = 0.44;
      this.fogColor = [0.08, 0.06, 0.16];
      this.fogRange = [26, 46];
      this.dyn = new FaceSink();      // opaque dynamic geometry
      this.trans = new FaceSink();    // translucent (glows)
      this.shadow = new FaceSink();   // blob shadows
      this._staticN = 0;
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = Math.floor(this.canvas.clientWidth * dpr) || 640;
      const h = Math.floor(this.canvas.clientHeight * dpr) || 360;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
      }
      this.gl.viewport(0, 0, w, h);
      this.aspect = w / h;
    }

    setStatic(sink) {
      const gl = this.gl;
      const data = sink.build();
      this._staticN = data.n;
      if (!data.n) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vboG);
      gl.bufferData(gl.ARRAY_BUFFER, data.geom, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vboC);
      gl.bufferData(gl.ARRAY_BUFFER, data.col, gl.STATIC_DRAW);
    }

    _bindAndDraw(gbuf, cbuf, n, alpha) {
      const gl = this.gl;
      if (!n) return;
      gl.uniform1f(this.uAlpha, alpha);
      if (alpha < 1) { gl.enable(gl.BLEND); gl.depthMask(false); }
      gl.bindBuffer(gl.ARRAY_BUFFER, gbuf);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aNrm, 3, gl.FLOAT, false, 24, 12);
      gl.enableVertexAttribArray(this.aNrm);
      gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
      gl.vertexAttribPointer(this.aCol, 3, gl.FLOAT, false, 12, 0);
      gl.enableVertexAttribArray(this.aCol);
      gl.drawArrays(gl.TRIANGLES, 0, n);
      if (alpha < 1) { gl.disable(gl.BLEND); gl.depthMask(true); }
    }

    /* camera: {eye:[x,y,z], yaw, pitch} */
    beginFrame(cam, sky) {
      const gl = this.gl;
      this.resize();
      gl.clearColor(sky[0], sky[1], sky[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const proj = R3.m4Persp(0.92, this.aspect, 0.1, 120);
      const view = R3.m4View(cam.eye, cam.yaw, cam.pitch);
      this.pv = R3.m4Mul(proj, view);
      gl.uniformMatrix4fv(this.uPV, false, new Float32Array(this.pv));
      gl.uniform3fv(this.uEye, cam.eye);
      gl.uniform3fv(this.uLight, this.light);
      gl.uniform1f(this.uAmbient, this.ambient);
      gl.uniform3fv(this.uFogCol, this.fogColor);
      gl.uniform2fv(this.uFogRange, this.fogRange);

      // static pass
      this._uploadStatic();
    }

    _uploadStatic() {
      const gl = this.gl, n = this._staticN;
      if (!n) return;
      gl.uniform1f(this.uAlpha, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vboG);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aNrm, 3, gl.FLOAT, false, 24, 12);
      gl.enableVertexAttribArray(this.aNrm);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vboC);
      gl.vertexAttribPointer(this.aCol, 3, gl.FLOAT, false, 12, 0);
      gl.enableVertexAttribArray(this.aCol);
      gl.drawArrays(gl.TRIANGLES, 0, n);
    }

    /* draw accumulated dynamic faces + shadows; call between beginFrame/endDynamic */
    flushDynamic() {
      const gl = this.gl;
      const d = this.dyn.build();
      if (d.n) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynG);
        gl.bufferData(gl.ARRAY_BUFFER, d.geom, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynC);
        gl.bufferData(gl.ARRAY_BUFFER, d.col, gl.DYNAMIC_DRAW);
      }
      const s = this.shadow.build();
      if (s.n) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sG || (this.sG = gl.createBuffer()));
        gl.bufferData(gl.ARRAY_BUFFER, s.geom, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sC || (this.sC = gl.createBuffer()));
        gl.bufferData(gl.ARRAY_BUFFER, s.col, gl.DYNAMIC_DRAW);
      }
      const tr = this.trans.build();
      if (tr.n) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tG || (this.tG = gl.createBuffer()));
        gl.bufferData(gl.ARRAY_BUFFER, tr.geom, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tC || (this.tC = gl.createBuffer()));
        gl.bufferData(gl.ARRAY_BUFFER, tr.col, gl.DYNAMIC_DRAW);
      }
      // opaque dynamics
      if (d.n) this._bindAndDraw(this.dynG, this.dynC, d.n, 1);
      // translucent glows
      if (tr.n) this._bindAndDraw(this.tG, this.tC, tr.n, 0.5);
      // blob shadows
      if (s.n) this._bindAndDraw(this.sG, this.sC, s.n, 0.34);
      this.dyn = new FaceSink();
      this.trans = new FaceSink();
      this.shadow = new FaceSink();
    }
  }
  R3.Renderer = Renderer;
})();

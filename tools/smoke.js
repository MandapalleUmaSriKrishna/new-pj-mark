/* ============================================================
   Headless smoke test: runs the whole game with stubbed
   DOM + WebGL + Canvas2D, and drives real gameplay paths.
   Usage: node tools/smoke.js
   ============================================================ */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓ ' + name);
  else { console.error('  ✗ FAIL: ' + name); failures++; }
}

/* ---------- stubs ---------- */
function fake2D() {
  const store = {};
  return new Proxy({ _canvas: null }, {
    get(t, k) {
      if (k === '_canvas') return t._canvas;
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in store) return store[k];
      return () => {};
    },
    set(t, k, v) { store[k] = v; return true; }
  });
}
function fakeGL() {
  const consts = { DEPTH_TEST: 1, CULL_FACE: 1, BLEND: 1, LEQUAL: 1, BACK: 1, SRC_ALPHA: 1, ONE_MINUS_SRC_ALPHA: 1, ARRAY_BUFFER: 1, STATIC_DRAW: 1, DYNAMIC_DRAW: 1, TRIANGLES: 1, FLOAT: 1, COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 1, COMPILE_STATUS: 1, LINK_STATUS: 1 };
  return new Proxy({}, {
    get(t, k) {
      if (k in consts) return consts[k];
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
      if (k === 'getAttribLocation') return () => 0;
      if (k === 'getUniformLocation') return () => ({});
      if (k === 'getShaderInfoLog' || k === 'getProgramInfoLog') return () => '';
      return () => ({});
    }
  });
}
function makeEl(id) {
  const el = {
    id, children: [], onclick: null,
    style: new Proxy({}, { get: () => '', set: () => true }),
    classList: { _s: new Set(), add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    appendChild(ch) { this.children.push(ch); return ch; },
    querySelector() { return makeChild(); },
    addEventListener() {}, removeEventListener() {},
    clientWidth: 960, clientHeight: 540, width: 0, height: 0, offsetWidth: 10,
    getContext(type) {
      if (type === '2d') { const c = fake2D(); c._canvas = { clientWidth: 960, clientHeight: 540 }; return c; }
      if (type === 'webgl' || type === 'experimental-webgl') return fakeGL();
      return null;
    }
  };
  const child = makeChild();
  function makeChild() {
    return { style: new Proxy({}, { get: () => '', set: () => true }), textContent: '', classList: el.classList };
  }
  Object.defineProperty(el, 'innerHTML', { get() { return this._h || ''; }, set(v) { this._h = v; } });
  Object.defineProperty(el, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; } });
  Object.defineProperty(el, 'firstElementChild', { get() { return child; } });
  return el;
}
const elements = {};
const documentStub = {
  getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
  createElement() { return makeEl('created'); },
  addEventListener() {},
  hidden: false
};

let simTime = 0;
const rafQueue = [];
const sandbox = {
  console, Math, JSON,
  performance: { now: () => simTime },
  document: documentStub,
  requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
  setTimeout(fn) { try { fn(); } catch (e) { console.error('  setTimeout threw:', e.message); } return 0; },
  clearTimeout() {},
  setInterval() { return 0; }, clearInterval() {},
  addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false }; },
  devicePixelRatio: 1,
  localStorage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function pump(frames, dtMs = 16.7) {
  for (let i = 0; i < frames; i++) {
    simTime += dtMs;
    const q = rafQueue.splice(0);
    for (const cb of q) cb(simTime);
  }
}

/* ---------- load game ---------- */
const root = path.join(__dirname, '..');
const code = ['src/00-core.js', 'src/11-render3d.js', 'src/12-world3d.js', 'src/20-game2d.js', 'src/30-main.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');

console.log('— loading game code —');
vm.runInContext(code + '\n;globalThis.__CC = CC;', sandbox, { filename: 'game-bundle.js' });
const CC2 = sandbox.__CC;
check('CC namespace exists', !!CC2);
check('menu state after boot', CC2.debug.state === 'menu');
check('3D demo running behind menu', CC2.debug.game && CC2.debug.game.demo === true);

console.log('— menu attract (3D demo, 300 frames) —');
pump(300);
check('demo still alive', CC2.debug.game.status !== undefined);
check('demo cat exists', !!CC2.debug.game.cat);

console.log('— 3D level 1: Living Room —');
CC2.debug.openSelect('3d');
check('select screen', CC2.debug.state === 'select');
CC2.debug.startLevel(0);
check('playing 3D', CC2.debug.state === 'play' && CC2.debug.mode === '3d');
let g = CC2.debug.game;
check('cheese count', g.cheese.length >= 9);
check('lives = 3', g.lives === 3);

// run right + sprint for a while
CC2.Input.keys['d'] = true; CC2.Input.keys['shift'] = true;
pump(240);
CC2.Input.keys['shift'] = false;
check('player moved', Math.abs(g.pl.x - g.def.start[0]) > 1 || Math.abs(g.pl.z - g.def.start[1]) > 1);
check('player inside room', g.pl.x > -12.5 && g.pl.x < 12.5 && g.pl.z > -9.5 && g.pl.z < 9.5);

// hop
CC2.Input.keys[' '] = true; CC2.Input._jumpQueued = true;
pump(10);
check('jump gained height', g.pl.y > 0.2);
pump(60);
check('landed again', g.pl.y === 0);

// collect all cheese by teleporting to each
for (const c of g.cheese) { g.pl.x = c.x; g.pl.z = c.z; g.pl.y = 0; pump(4); }
check('all cheese collected', g.cheeseGot === g.cheese.length);

// exit
g.pl.x = g.def.hole.x + g.def.hole.dx * 0.8;
g.pl.z = g.def.hole.z + g.def.hole.dz * 0.8;
pump(6);
check('level complete', CC2.debug.state === 'complete');
check('next level unlocked', CC2.Save.unlocked('3d') >= 2);
check('best time saved', CC2.Save.getBest('3d-living') != null);

console.log('— 3D level 1 again: getting caught / game over —');
CC2.Input.keys = {};
CC2.debug.startLevel(0);
g = CC2.debug.game;
g.pl.invuln = 0;
g.cat.x = g.pl.x; g.cat.z = g.pl.z; g.cat.pause = 0; g.cat.state = 'chase';
pump(5);
check('lost a life', g.lives === 2);
check('respawned at start', Math.abs(g.pl.x - g.def.start[0]) < 0.01);
g.lives = 1; g.pl.invuln = 0;
g.cat.x = g.pl.x; g.cat.z = g.pl.z; g.cat.pause = 0; g.cat.state = 'chase';
pump(5);
check('game over', CC2.debug.state === 'over');

console.log('— 3D trap test —');
CC2.debug.startLevel(0);
g = CC2.debug.game;
const tr = g.traps[0];
g.pl.x = tr.x; g.pl.z = tr.z; g.pl.y = 0;
pump(4);
check('trap sprung + stunned', tr.sprung === true && g.pl.stun > 0);
check('trap alerted cat', g.cat.state === 'chase');

console.log('— 3D level 2 + 3 quick boot —');
for (const idx of [1, 2]) {
  CC2.debug.startLevel(idx);
  g = CC2.debug.game;
  CC2.Input.keys['d'] = true; CC2.Input.keys['w'] = true;
  pump(300);
  check('level ' + (idx + 1) + ' runs', CC2.debug.state === 'play' || CC2.debug.state === 'complete' || CC2.debug.state === 'over');
  check('level ' + (idx + 1) + ' player valid', isFinite(g.pl.x) && isFinite(g.pl.z) && isFinite(g.pl.y));
  check('level ' + (idx + 1) + ' cat valid', isFinite(g.cat.x) && isFinite(g.cat.z));
}
CC2.Input.keys['d'] = false; CC2.Input.keys['w'] = false; CC2.Input.keys[' '] = false;

console.log('— 2D level 1: Living Room Run —');
CC2.debug.toMenu();
CC2.debug.openSelect('2d');
CC2.debug.startLevel(0);
check('playing 2D', CC2.debug.state === 'play' && CC2.debug.mode === '2d');
g = CC2.debug.game;
check('2D cheese parsed', g.cheese.length >= 10);
check('2D exit exists', !!g.exit);
check('2D checkpoints', g.checkpoints.length >= 1);

// run right with periodic held jumps (like a real player), long run so the cat spawns
CC2.Input.keys['d'] = true;
function hop() { CC2.Input.keys[' '] = true; CC2.Input._jumpQueued = true; }
function release() { CC2.Input.keys[' '] = false; }
pump(80);
hop(); pump(8); hop(); pump(4); release(); pump(6);
check('double jump available', g.p.jumps >= 1 || g.p.vy !== 0);
for (let k = 0; k < 42; k++) { pump(14); hop(); pump(9); release(); } // ~15s, hop often
check('2D player alive-ish', CC2.debug.state === 'play' || CC2.debug.state === 'over');
check('2D cat spawned', g.catOn === true);
check('2D player x advanced', g.p.x > g.start.x + 200 || g.lives < 3);
check('2D no NaN', isFinite(g.p.x) && isFinite(g.p.y) && isFinite(g.p.vy));

// finish: collect all cheese then reach exit
if (CC2.debug.state === 'play') {
  for (const c of g.cheese) { c.taken = true; }
  g.cheeseGot = g.cheese.length;
  g.p.x = g.exit.x; g.p.y = g.exit.y; g.p.vy = 0;
  pump(6);
  check('2D level complete', CC2.debug.state === 'complete');
}

console.log('— 2D levels 2 + 3 quick run —');
for (const idx of [1, 2]) {
  CC2.debug.startLevel(idx);
  g = CC2.debug.game;
  CC2.Input.keys['d'] = true;
  pump(1200);
  check('2D level ' + (idx + 1) + ' runs', CC2.debug.state === 'play' || CC2.debug.state === 'over' || CC2.debug.state === 'complete');
  check('2D level ' + (idx + 1) + ' no NaN', isFinite(g.p.x) && isFinite(g.p.y));
}
CC2.Input.keys['d'] = false;

console.log('— 2D trap behavior (stun, not death) —');
CC2.debug.startLevel(0);
g = CC2.debug.game;
const tr2 = g.traps[0];
g.p.x = tr2.x; g.p.y = tr2.y + 2; g.p.vy = 0; g.p.invuln = 0;
const livesBefore = g.lives;
pump(4);
check('2D trap stuns', g.p.stun > 0);
check('2D trap not lethal', g.lives === livesBefore);
check('2D trap summoned cat', g.catOn === true);
pump(120);

console.log('— pause / resume / restart —');
CC2.debug.startLevel(0);
CC2.debug.pauseGame();
check('paused', CC2.debug.state === 'pause');
const g0 = CC2.debug.game;
const px = g0.p ? g0.p.x : g0.pl.x;
pump(60);
check('frozen while paused', (g0.p ? g0.p.x : g0.pl.x) === px);
CC2.debug.resumeGame();
check('resumed', CC2.debug.state === 'play');

console.log('— long menu attract stability (1500 frames) —');
CC2.debug.toMenu();
pump(1500);
check('attract stable', !!CC2.debug.game && isFinite(CC2.debug.game.pl.x) && isFinite(CC2.debug.game.cat.x));

console.log('');
if (failures) { console.error(failures + ' FAILURES'); process.exit(1); }
console.log('ALL SMOKE TESTS PASSED ✅');

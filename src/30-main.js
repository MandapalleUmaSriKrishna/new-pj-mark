/* ================================================================
   CHEESE CHASE — main: state machine, menus, HUD, game loop
   ================================================================ */
'use strict';
(() => {
  /* ---------- boot ---------- */
  CC.Save.load();
  CC.SFX.muted = CC.Save.data.muted;
  CC.SFX.musicOn = CC.Save.data.music;
  CC.Input.init();

  const $ = CC.$;
  let state = 'menu';          // menu | select | play | pause | complete | over | help
  let mode = null;             // '3d' | '2d'
  let levelIdx = 0;
  let game = null;             // Game3D or Game2D instance
  let renderer = null;
  let glOK = true;
  let lastT = performance.now();
  let accTick = 0;
  let playing = false;         // mirrored for CC.playing (touch UI)
  Object.defineProperty(CC, 'playing', { get: () => playing });

  const c3d = $('c3d'), c2d = $('c2d');

  try {
    renderer = new CC.R3.Renderer(c3d);
  } catch (e) {
    glOK = false;
    console.warn('WebGL unavailable:', e);
  }

  /* ---------- screens ---------- */
  const SCREENS = ['scr-menu', 'scr-select', 'scr-help', 'scr-pause', 'scr-complete', 'scr-over'];
  function showScreen(id) {
    SCREENS.forEach(s => CC.hide(s));
    if (id) CC.show(id);
    $('menu-badge').style.display = (id === 'scr-menu' && glOK) ? '' : 'none';
  }

  function setCanvases(which) {
    c3d.classList.toggle('active', which === '3d');
    c2d.classList.toggle('active', which === '2d');
  }

  function startAttract() {
    if (!glOK) return;
    if (!game || !(game instanceof CC.W3.Game3D) || !game.demo) {
      game = new CC.W3.Game3D(renderer, CC.W3.DEFS[0], { demo: true });
    }
  }

  function toMenu() {
    state = 'menu'; playing = false;
    $('touch').classList.remove('active');
    CC.hide('hud');
    showScreen('scr-menu');
    setCanvases('3d');
    startAttract();
    CC.SFX.stopMusic();
  }

  function openSelect(m) {
    if (m === '3d' && !glOK) {
      CC.toast(' WebGL is unavailable on this device — enjoy the 2D worlds instead! ');
      return;
    }
    mode = m;
    state = 'select';
    playing = false;
    $('touch').classList.remove('active');
    CC.hide('hud');
    const defs = m === '3d' ? CC.W3.DEFS : CC.G2.DEFS;
    const unl = CC.Save.unlocked(m);
    $('sel-title').textContent = m === '3d' ? '🕹️ 3D Worlds' : '🏃 2D Worlds';
    const grid = $('sel-grid');
    grid.innerHTML = '';
    defs.forEach((d, i) => {
      const locked = i >= unl;
      const best = CC.Save.getBest(d.id);
      const el = document.createElement('div');
      el.className = 'lvl-card' + (locked ? ' locked' : '');
      el.innerHTML = `<div class="ico">${locked ? '🔒' : d.icon}</div>
        <div class="nm">${i + 1}. ${d.name}</div>
        <div class="bd">${d.desc}</div>
        <div class="bs">${best != null ? '⏱ best ' + CC.fmtTime(best) : (locked ? 'complete previous level' : 'no record yet')}</div>`;
      if (!locked) el.onclick = () => { CC.SFX.play('click'); startLevel(i); };
      grid.appendChild(el);
    });
    showScreen('scr-select');
  }

  /* ---------- gameplay ---------- */
  function startLevel(i) {
    levelIdx = i;
    CC.Input._jumpQueued = false;
    const def = (mode === '3d' ? CC.W3.DEFS : CC.G2.DEFS)[i];
    game = null;
    if (mode === '3d') {
      setCanvases('3d');
      game = new CC.W3.Game3D(renderer, def, { demo: false, onEvent: onGameEvent });
    } else {
      setCanvases('2d');
      game = new CC.G2.Game2D(c2d, def, { demo: false, onEvent: onGameEvent });
    }
    state = 'play'; playing = true;
    showScreen(null);
    CC.show('hud');
    $('hud-stam').classList.toggle('hide', mode === '2d');
    $('hud-arrow').classList.toggle('hide', mode === '2d');
    $('hud-level').textContent = def.icon + ' ' + def.name + (mode === '3d' ? ' — 3D' : ' — 2D');
    updateHUD(game);
    if (CC.Input.touch) $('touch').classList.add('active');
    CC.SFX.ensure();
    CC.SFX.startMusic();
  }

  function starsFor(def, ev) {
    let s = 3;
    if (ev.deaths > 0) s--;
    if (ev.deaths > 2) s--;
    if (mode === '3d' && ev.time > def.time * 0.62) s--;
    if (mode === '2d' && ev.time > 150) s--;
    return Math.max(1, s);
  }

  function onGameEvent(type, data) {
    if (!game) return;
    if (type === 'cheese') {
      CC.toast(`🧀 ${data.got} / ${data.total}`, 1100);
    } else if (type === 'caught') {
      CC.flash(data.lives > 0 ? 'CAUGHT!' : 'GOTCHA!');
    } else if (type === 'complete') {
      state = 'complete'; playing = false;
      $('touch').classList.remove('active');
      const def = (mode === '3d' ? CC.W3.DEFS : CC.G2.DEFS)[levelIdx];
      const isBest = CC.Save.setBest(def.id, data.time);
      const nextIdx = levelIdx + 1;
      const defs = mode === '3d' ? CC.W3.DEFS : CC.G2.DEFS;
      const hasNext = nextIdx < defs.length;
      if (hasNext) CC.Save.unlock(mode, nextIdx + 1);
      const st = starsFor(def, data);
      $('cmp-stars').textContent = '⭐'.repeat(st) + '☆'.repeat(3 - st);
      $('cmp-stats').innerHTML =
        `Time: <b>${CC.fmtTime(data.time)}</b> ${isBest ? ' — <b>NEW BEST!</b> 🏆' : ''}<br>` +
        `Cheese: 🧀 ${game.cheeseGot}/${game.cheese.length} &nbsp;•&nbsp; Falls: ${data.deaths}`;
      $('bt-next').style.display = hasNext ? '' : 'none';
      showScreen('scr-complete');
    } else if (type === 'over') {
      state = 'over'; playing = false;
      $('touch').classList.remove('active');
      $('over-stats').innerHTML = data.timeout
        ? '⏱ Time ran out! Whiskers wins this round…'
        : '😿 All lives lost — but a good mouse always tries again!';
      showScreen('scr-over');
    } else if (type === 'toast') {
      CC.toast(data, 2600);
    }
    if (type === 'cheese' || type === 'caught') updateHUD(game);
  }

  function updateHUD(g) {
    if (!g) return;
    $('hud-cheese').textContent = `🧀 ${g.cheeseGot}/${g.cheese.length}`;
    const lives = g.lives == null ? 3 : g.lives;
    $('hud-lives').textContent = '❤️'.repeat(Math.max(0, lives)) + '🤍'.repeat(Math.max(0, 3 - lives));
  }

  /* ---------- pause ---------- */
  function pauseGame() {
    if (state !== 'play') return;
    state = 'pause';
    showScreen('scr-pause');
    CC.SFX.stopMusic();
  }
  function resumeGame() {
    if (state !== 'pause') return;
    state = 'play';
    showScreen(null);
    if (CC.Input.touch) $('touch').classList.add('active');
    CC.SFX.startMusic();
  }
  CC.onKeyPause = () => {
    if (state === 'play') pauseGame();
    else if (state === 'pause') resumeGame();
  };
  CC.onKeyRestart = () => { if (state === 'play' || state === 'pause' || state === 'complete' || state === 'over') startLevel(levelIdx); };
  CC.onKeyMute = () => {
    const m = !CC.SFX.muted;
    CC.SFX.setMuted(m);
    CC.Save.data.muted = m; CC.Save.save();
    syncSoundBtn();
    CC.toast(m ? '🔇 Sound off' : '🔊 Sound on', 1200);
  };
  function syncSoundBtn() {
    $('bt-sound').textContent = CC.SFX.muted ? '🔇 Sound: OFF' : '🔊 Sound: ON';
  }

  /* ---------- buttons ---------- */
  $('bt-3d').onclick = () => { CC.SFX.ensure(); CC.SFX.play('click'); openSelect('3d'); };
  $('bt-2d').onclick = () => { CC.SFX.ensure(); CC.SFX.play('click'); openSelect('2d'); };
  $('bt-help').onclick = () => { CC.SFX.ensure(); CC.SFX.play('click'); state = 'help'; showScreen('scr-help'); };
  $('bt-help-back').onclick = () => { CC.SFX.play('click'); toMenu(); };
  $('bt-sel-back').onclick = () => { CC.SFX.play('click'); toMenu(); };
  $('bt-resume').onclick = () => { CC.SFX.play('click'); resumeGame(); };
  $('bt-restart').onclick = () => { CC.SFX.play('click'); startLevel(levelIdx); };
  $('bt-quit').onclick = () => { CC.SFX.play('click'); toMenu(); };
  $('bt-next').onclick = () => { CC.SFX.play('click'); startLevel(levelIdx + 1); };
  $('bt-replay').onclick = () => { CC.SFX.play('click'); startLevel(levelIdx); };
  $('bt-cmp-menu').onclick = () => { CC.SFX.play('click'); toMenu(); };
  $('bt-retry').onclick = () => { CC.SFX.play('click'); startLevel(levelIdx); };
  $('bt-over-menu').onclick = () => { CC.SFX.play('click'); toMenu(); };
  $('bt-sound').onclick = () => CC.onKeyMute();
  syncSoundBtn();

  if (!glOK) {
    $('bt-3d').textContent = '🕹️ 3D WORLDS (needs WebGL)';
    $('bt-3d').onclick = () => CC.toast('This browser has no WebGL — try the 2D worlds!', 2600);
  }

  /* ---------- main loop ---------- */
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.06) dt = 0.06;
    if (dt <= 0) return;

    if (state === 'play' && game) {
      game.update(dt);
      if (state === 'play') { // may have changed
        updateHUD(game);
        // timer + stamina + objective arrow
        if (mode === '3d') {
          $('hud-time').textContent = CC.fmtTime(Math.ceil(game.timeLeft));
          const bar = $('hud-stam').firstElementChild;
          bar.style.width = (game.pl.stamina * 100).toFixed(0) + '%';
          const o = game.objective();
          if (o) {
            $('hud-arrow').classList.remove('hide');
            const dx = o.x - game.pl.x, dz = o.z - game.pl.z;
            const ang = Math.atan2(dx, -dz) * 180 / Math.PI;
            const arw = $('hud-arrow');
            arw.querySelector('.arw').style.transform = `rotate(${ang}deg)`;
            arw.querySelector('.arw').textContent = o.type === 'cheese' ? '🧀' : '🏠';
            arw.querySelector('.dst').textContent = Math.round(o.d) + 'm';
          }
        } else {
          $('hud-time').textContent = CC.fmtTime(game.time);
        }
      }
    }

    // render
    if (game) {
      if (mode === '3d' || state === 'menu' || (state === 'select' && game.demo) || (state === 'help' && game.demo)) {
        if (state === 'menu' || (state !== 'play' && state !== 'pause' && state !== 'complete' && state !== 'over' && game.demo)) {
          game.update(dt); // attract demo keeps running behind menus
        }
        game.render();
      } else if (mode === '2d') {
        game.render();
      }
    }
  }

  // attract demo behind the menu
  toMenu();
  requestAnimationFrame(frame);

  // tiny debug/testing hook
  CC.debug = {
    startLevel, toMenu, openSelect, pauseGame, resumeGame,
    get state() { return state; }, get mode() { return mode; }, get game() { return game; }
  };

  // pause music/tab when hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { CC.SFX.stopMusic(); if (state === 'play') pauseGame(); }
  });
})();

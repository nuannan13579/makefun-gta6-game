// Boot and the one loop. The world advances in fixed 1/60 s steps (several in a slow frame,
// none in a fast one); the renderer paints what is there; event names the world leaves in
// state.events become sounds, announcements and saves here, where the browser lives.
//
// ?seed=N fixes a run. ?shot=title|chase|foot|coast (with &seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady.
(function () {
  'use strict';
  var NH = window.NH;

  var params = new URLSearchParams(window.location.search);
  var shot = params.get('shot');
  var seedParam = Number.parseInt(params.get('seed') || '', 10);
  var fixedSeed = Number.isInteger(seedParam) ? seedParam : null;

  var canvas = document.getElementById('game');
  var status = document.getElementById('status');
  var audio = NH.createAudio();
  var input = NH.createInput(canvas);

  var IDLE = {
    axisX: function () { return 0; }, axisY: function () { return 0; },
    throttle: function () { return 0; }, steer: function () { return 0; },
    handbrake: function () { return false; }, sprint: function () { return false; },
    punchHeld: function () { return false; },
  };

  function store(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private window: lasts the visit */ }
  }
  function readBest() { return Number.parseInt(store(NH.STORAGE.best) || '0', 10) || 0; }
  function readSave() {
    try {
      var raw = store(NH.STORAGE.save);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  var best = readBest();
  var savedRun = readSave();
  var muted = store(NH.STORAGE.muted) === '1';
  audio.setMuted(muted);

  var world = NH.createWorld(fixedSeed !== null ? fixedSeed : 7);
  var renderer = NH.createRenderer(canvas, world.state.city);
  var screen = NH.SCREEN.TITLE;

  function announce(message) { status.textContent = message; }

  function scoreOf(state) { return state.money + state.missionsDone * 150; }

  function persistRun() {
    var s = world.state;
    savedRun = { money: s.money, missionsDone: s.missionsDone, missionIndex: s.missionIndex };
    save(NH.STORAGE.save, JSON.stringify(savedRun));
  }

  function start(continueRun) {
    var seed = fixedSeed !== null ? fixedSeed : Math.floor(Math.random() * 2147483647);
    world = NH.createWorld(seed);
    if (continueRun && savedRun) {
      world.state.money = savedRun.money;
      world.state.missionsDone = savedRun.missionsDone;
      world.state.missionIndex = savedRun.missionIndex;
    }
    screen = NH.SCREEN.PLAY;
    audio.unlock();
    announce('Playing. Marisol has work for you.');
  }

  function finishRun() {
    screen = NH.SCREEN.OVER;
    var s = world.state;
    var score = scoreOf(s);
    if (score > best) {
      best = score;
      save(NH.STORAGE.best, String(best));
    }
    savedRun = null;
    save(NH.STORAGE.save, '');
    announce((s.over === 'busted' ? 'Busted. ' : 'Wasted. ') + 'Final score ' + score + '.');
  }

  function drainEvents() {
    var events = world.state.events;
    for (var i = 0; i < events.length; i++) {
      var name = events[i];
      if (name === 'mission-complete') { audio.success(); persistRun(); announce('Mission complete.'); }
      else if (name === 'mission-fail') audio.fail();
      else if (name === 'pickup' || name === 'checkpoint') audio.pickup();
      else if (name === 'cash') audio.cash();
      else if (name === 'steal') audio.steal();
      else if (name === 'punch') audio.punch();
      else if (name === 'hurt') audio.crash(0.25);
      else if (name.indexOf('crash:') === 0) audio.crash(Number.parseFloat(name.slice(6)) || 0.3);
      else if (name === 'busted') { audio.setSiren(false); audio.setEngine(false, 0); audio.busted(); finishRun(); }
      else if (name === 'wasted') { audio.setSiren(false); audio.setEngine(false, 0); audio.fail(); finishRun(); }
    }
    events.length = 0;
  }

  function updateAudio() {
    var s = world.state;
    var sirenOn = false;
    if (screen === NH.SCREEN.PLAY && s.wanted > 0 && !s.over) {
      var p = s.player.inCar || s.player;
      for (var i = 0; i < s.cars.length; i++) {
        var car = s.cars[i];
        if (car.kind === 'police' && car !== s.player.inCar && Math.hypot(car.x - p.x, car.y - p.y) < 520) { sirenOn = true; break; }
      }
    }
    audio.setSiren(sirenOn);
    if (screen === NH.SCREEN.PLAY && s.player.inCar) {
      var spec = NH.CAR_KINDS[s.player.inCar.carKind];
      audio.setEngine(true, Math.abs(s.player.inCar.speed) / spec.topSpeed);
    } else audio.setEngine(false, 0);
  }

  function drawOpts() {
    return {
      best: best,
      hasSave: !!savedRun,
      saveMoney: savedRun ? savedRun.money : 0,
      saveMissions: savedRun ? savedRun.missionsDone : 0,
      muted: muted,
      inCar: !!world.state.player.inCar,
    };
  }

  if (shot) {
    var scene = NH.stageShot(shot, world);
    var painted = 0;
    var paintShot = function () {
      renderer.draw(world.state, scene.screen, drawOpts());
      painted += 1;
      if (painted < 2) requestAnimationFrame(paintShot);
      else window.__shotReady = true;
    };
    requestAnimationFrame(paintShot);
  } else {
    var accumulator = 0;
    var last = performance.now();

    function handleActions(actions) {
      if (actions & NH.ACTION.MUTE) {
        muted = !muted;
        audio.setMuted(muted);
        save(NH.STORAGE.muted, muted ? '1' : '0');
      }
      if (screen === NH.SCREEN.TITLE) {
        if (actions & NH.ACTION.NEWGAME) start(false);
        else if (actions & (NH.ACTION.CONFIRM | NH.ACTION.CONTINUE)) start(!!savedRun);
      } else if (screen === NH.SCREEN.PLAY) {
        if (actions & NH.ACTION.PAUSE) { screen = NH.SCREEN.PAUSED; announce('Paused.'); }
      } else if (screen === NH.SCREEN.PAUSED) {
        if (actions & (NH.ACTION.PAUSE | NH.ACTION.CONFIRM)) { screen = NH.SCREEN.PLAY; announce('Playing.'); }
      } else if (screen === NH.SCREEN.OVER) {
        if (actions & (NH.ACTION.RESTART | NH.ACTION.CONFIRM)) start(false);
      }
    }

    function frame(now) {
      requestAnimationFrame(frame);
      accumulator += Math.min((now - last) / 1000, 0.25);
      last = now;
      var actions = input.takeActions();
      handleActions(actions);
      if (screen === NH.SCREEN.PLAY) {
        var first = true;
        while (accumulator >= NH.STEP && screen === NH.SCREEN.PLAY) {
          world.step(input, first ? actions : 0, NH.STEP);
          first = false;
          accumulator -= NH.STEP;
          drainEvents();
        }
      } else if (screen === NH.SCREEN.TITLE || screen === NH.SCREEN.OVER) {
        while (accumulator >= NH.STEP) {
          world.step(IDLE, 0, NH.STEP);
          accumulator -= NH.STEP;
          // A finished run's world only idles: drop its events unheard.
          world.state.events.length = 0;
        }
      } else {
        accumulator = 0;
      }
      updateAudio();
      renderer.draw(world.state, screen, drawOpts());
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && screen === NH.SCREEN.PLAY) {
        screen = NH.SCREEN.PAUSED;
        announce('Paused.');
      }
    });

    announce('Neon Harbor Nights. Press Enter to start.');
    requestAnimationFrame(frame);
  }

  // A handle for automated checks: the live state, readable from the console or a test rig.
  window.__game = {
    get state() { return world.state; },
    screens: NH.SCREEN,
  };
})();

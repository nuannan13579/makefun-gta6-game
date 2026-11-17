// The story Marisol Vega hands out, one errand at a time, and the endless errands after it.
// A mission is a small state machine over the world state: an objective point (sometimes a
// car, sometimes a list of checkpoints), a timer, a payout. The world calls updateMissions
// every step; this file never moves anything itself.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  // The five story errands, in order. Points are filled in from the city's landmarks when
  // a mission starts, so the text here stays about the job, not the coordinates.
  var STORY = [
    {
      kind: 'reach', title: 'First Errand', payout: 150, time: 0, at: 'market',
      text: 'Rook. Get yourself to the North Market, any way you like. I pay for results, not style. — M',
    },
    {
      kind: 'package', title: 'Package Run', payout: 260, time: 130, at: 'casino', drop: 'garage',
      text: 'A package waits behind the Casa Azul. Pick it up on foot, then bring it to Delgado at the garage. — M',
    },
    {
      kind: 'steal', title: 'Borrowed Wheels', payout: 420, time: 170, at: 'garage',
      text: 'The gold sports car at the lot is mine by morning. Take it — gently — and park it at my garage. — M',
    },
    {
      kind: 'checkpoints', title: 'Harbor Sprint', payout: 520, time: 105,
      text: 'Four corners of my city, in order, against the clock. Show me you can really drive. — M',
    },
    {
      kind: 'escape', title: 'Hot Night', payout: 750, time: 150, at: 'hideout',
      text: 'Tonight you run hot. Reach the Plaza Fountain and lay low there until I say you are clear. — M',
    },
  ];

  var ERRAND_KINDS = ['reach', 'package', 'checkpoints', 'steal'];
  var LANDMARK_KEYS = ['market', 'casino', 'depot', 'park', 'harbor', 'bodega', 'garage'];

  function playerPos(state) {
    return state.player.inCar || state.player;
  }

  function distTo(state, target) {
    var p = playerPos(state);
    return Math.hypot(p.x - target.x, p.y - target.y);
  }

  function completeMission(state) {
    var mission = state.mission;
    var payout = Math.round(mission.payout * state.missionPayoutScale);
    if (mission.kind === 'steal' && mission.targetCar) {
      // A borrowed car pays for the shape it comes back in.
      var frac = Math.max(0.4, mission.targetCar.health / mission.targetCar.maxHealth);
      payout = Math.round(payout * frac);
    }
    state.money += payout;
    state.missionsDone += 1;
    state.missionIndex += 1;
    state.missionPayoutScale = 1;
    state.events.push('mission-complete');
    state.toast('MISSION COMPLETE', mission.title + '  +$' + payout, 3.2);
    state.mission = null;
    state.nextMissionIn = 3.5;
  }

  function failMission(state, why) {
    state.events.push('mission-fail');
    state.toast('MISSION FAILED', why + ' Marisol will offer it again.', 3.2);
    state.missionPayoutScale = Math.max(0.5, state.missionPayoutScale * 0.8);
    if (state.mission && state.mission.targetCar) state.mission.targetCar.missionCar = false;
    state.mission = null;
    state.nextMissionIn = 2.5;
  }

  NH.startMission = function (state) {
    var city = state.city;
    var mission;
    if (state.missionIndex < STORY.length) {
      var def = STORY[state.missionIndex];
      mission = {
        kind: def.kind, title: def.title, text: def.text, payout: def.payout,
        timeLeft: def.time || 0, totalTime: def.time || 0, stage: 0, layLow: 0,
        target: null, checkpoints: null, cpIndex: 0, targetCar: null,
      };
      if (def.at) {
        var lm = city.landmarks[def.at];
        mission.target = { x: lm.x, y: lm.y, label: lm.label || def.at };
      }
      if (def.kind === 'checkpoints') {
        mission.checkpoints = [
          { x: 860, y: 800, label: 'Checkpoint 1' },
          { x: 1980, y: 800, label: 'Checkpoint 2' },
          { x: 2540, y: 1840, label: 'Checkpoint 3' },
          { x: 1420, y: 2360, label: 'Checkpoint 4' },
        ];
        mission.target = mission.checkpoints[0];
      }
      if (def.kind === 'steal') {
        mission.targetCar = state.spawnMissionCar();
        mission.target = { x: mission.targetCar.x, y: mission.targetCar.y, label: 'Gold sports car' };
      }
      if (def.kind === 'escape') state.setWanted(3);
    } else {
      // Endless errands: same shapes, new corners of the city, slowly rising pay.
      var n = state.missionIndex - STORY.length + 1;
      var kind = ERRAND_KINDS[(n - 1) % ERRAND_KINDS.length];
      var key = state.rng.pick(LANDMARK_KEYS);
      var spot = city.landmarks[key];
      mission = {
        kind: kind, title: 'Errand #' + n, payout: 200 + n * 45,
        timeLeft: kind === 'reach' ? 0 : 140, totalTime: kind === 'reach' ? 0 : 140,
        stage: 0, layLow: 0, target: { x: spot.x, y: spot.y, label: spot.label || key },
        checkpoints: null, cpIndex: 0, targetCar: null,
        text: 'Another job, Rook. ' + (spot.label || key) + '. Do not keep me waiting. — M',
      };
      if (kind === 'package') mission.dropKey = 'garage';
      if (kind === 'checkpoints') {
        mission.checkpoints = [];
        for (var i = 0; i < 4; i++) {
          var p = NH.cityIntersectionNear(city, state.rng, state.player.x, state.player.y, 500, 1600);
          mission.checkpoints.push({ x: p.x, y: p.y, label: 'Checkpoint ' + (i + 1) });
        }
        mission.target = mission.checkpoints[0];
      }
      if (kind === 'steal') {
        mission.targetCar = state.spawnMissionCar();
        mission.target = { x: mission.targetCar.x, y: mission.targetCar.y, label: 'Marked car' };
        mission.dropKey = 'garage';
      }
      if (kind === 'escape') mission.target = { x: city.landmarks.hideout.x, y: city.landmarks.hideout.y, label: 'Plaza Fountain' };
    }
    state.mission = mission;
    state.events.push('new-mission');
    state.toast(mission.title, mission.text, 5);
    return mission;
  };

  NH.updateMissions = function (state, dt) {
    if (state.nextMissionIn > 0) {
      state.nextMissionIn -= dt;
      if (state.nextMissionIn <= 0 && !state.mission) NH.startMission(state);
      return;
    }
    var mission = state.mission;
    if (!mission) return;

    if (mission.timeLeft > 0) {
      mission.timeLeft -= dt;
      if (mission.timeLeft <= 0) {
        failMission(state, 'Out of time.');
        return;
      }
    }

    var garage = state.city.landmarks.garage;
    switch (mission.kind) {
      case 'reach':
        if (distTo(state, mission.target) < 44) completeMission(state);
        break;
      case 'package':
        if (mission.stage === 0) {
          if (!state.player.inCar && distTo(state, mission.target) < 30) {
            mission.stage = 1;
            var drop = state.city.landmarks[mission.dropKey || 'garage'];
            mission.target = { x: drop.x, y: drop.y, label: drop.label || 'Drop-off' };
            state.events.push('pickup');
            state.toast('PACKAGE PICKED UP', 'Take it to ' + mission.target.label + '.', 2.6);
          }
        } else if (distTo(state, mission.target) < 48) completeMission(state);
        break;
      case 'steal': {
        var car = mission.targetCar;
        if (!car || car.health <= 0) { failMission(state, 'The car is wrecked.'); break; }
        if (mission.stage === 0) {
          mission.target.x = car.x;
          mission.target.y = car.y;
          if (state.player.inCar === car) {
            mission.stage = 1;
            mission.target = { x: garage.x, y: garage.y, label: garage.label };
            state.toast('WHEELS BORROWED', 'Get it to ' + garage.label + ' in one piece.', 2.6);
          }
        } else if (state.player.inCar === car && distTo(state, mission.target) < 56) {
          completeMission(state);
        }
        break;
      }
      case 'checkpoints': {
        var cp = mission.checkpoints[mission.cpIndex];
        mission.target = cp;
        if (distTo(state, cp) < 58) {
          mission.cpIndex += 1;
          state.events.push('checkpoint');
          if (mission.cpIndex >= mission.checkpoints.length) completeMission(state);
          else state.toast('CHECKPOINT ' + mission.cpIndex + ' / ' + mission.checkpoints.length, 'Keep going.', 1.6);
        }
        break;
      }
      case 'escape':
        if (distTo(state, mission.target) < 52) {
          mission.layLow += dt;
          if (mission.layLow >= 4) completeMission(state);
        } else {
          mission.layLow = Math.max(0, mission.layLow - dt * 0.7);
        }
        break;
    }
  };

  NH.STORY_COUNT = STORY.length;
})();

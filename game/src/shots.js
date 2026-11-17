// The staged screenshot scenes behind ?shot=title|chase|foot|coast. Each one builds a real
// moment of the game — a police chase mid-mission, a package pickup on foot, a run down the
// coast road — by placing the actors and then stepping the true simulation forward with a
// scripted driver, so what the camera captures is the game as it actually plays, and the
// same seed always stages the same frame.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  var IDLE = {
    axisX: function () { return 0; }, axisY: function () { return 0; },
    throttle: function () { return 0; }, steer: function () { return 0; },
    handbrake: function () { return false; }, sprint: function () { return false; },
    punchHeld: function () { return false; },
  };

  function driving(throttle) {
    return {
      axisX: function () { return 0; }, axisY: function () { return 0; },
      throttle: function () { return throttle; }, steer: function () { return 0; },
      handbrake: function () { return false; }, sprint: function () { return false; },
      punchHeld: function () { return false; },
    };
  }

  function walking(x, y) {
    return {
      axisX: function () { return x; }, axisY: function () { return y; },
      throttle: function () { return 0; }, steer: function () { return 0; },
      handbrake: function () { return false; }, sprint: function () { return false; },
      punchHeld: function () { return false; },
    };
  }

  function stepFor(world, input, seconds) {
    var steps = Math.round(seconds / NH.STEP);
    for (var i = 0; i < steps; i++) world.step(input, 0, NH.STEP);
  }

  function findCar(state, predicate) {
    for (var i = 0; i < state.cars.length; i++) if (predicate(state.cars[i])) return state.cars[i];
    return null;
  }

  // Put the player in a car at a place, as if they had just climbed in.
  function putPlayerInCar(state, car, x, y, angle, carKind, color) {
    car.x = x; car.y = y; car.angle = angle; car.speed = 0;
    car.vx = 0; car.vy = 0;
    if (carKind) { car.carKind = carKind; var spec = NH.CAR_KINDS[carKind]; car.health = spec.health; car.maxHealth = spec.health; }
    if (color) car.color = color;
    car.driver = 'player';
    car.everOwned = true;
    state.player.inCar = car;
    state.player.x = x; state.player.y = y;
    return car;
  }

  // Turn a traffic car into a police car on the player's tail.
  function makePolice(state, x, y, angle) {
    var car = findCar(state, function (c) { return c.kind === 'traffic'; });
    if (!car) return null;
    car.kind = 'police';
    car.carKind = 'police';
    car.color = '#f5f6fa';
    car.health = NH.CAR_KINDS.police.health;
    car.maxHealth = car.health;
    car.x = x; car.y = y; car.angle = angle; car.speed = 60;
    car.driver = 'ai';
    car.policeState = 'chase';
    return car;
  }

  NH.stageShot = function (name, world) {
    var state = world.state;

    if (name === 'chase') {
      // Harbor Sprint, checkpoint 1 ahead, three stars and two police cars behind.
      state.money = 620;
      state.missionsDone = 3;
      state.missionIndex = 3;
      state.nextMissionIn = 0;
      NH.startMission(state);
      var car = findCar(state, function (c) { return c.kind === 'parked'; }) || state.cars[0];
      putPlayerInCar(state, car, 886, 1180, -Math.PI / 2, 'sport', '#e74c3c');
      state.setWanted(3);
      makePolice(state, 872, 1320, -Math.PI / 2);
      makePolice(state, 905, 1412, -Math.PI / 2);
      state.lastSeen.x = car.x; state.lastSeen.y = car.y;
      stepFor(world, driving(1), 1.05);
      state.events.length = 0;
      return { screen: NH.SCREEN.PLAY };
    }

    if (name === 'foot') {
      // Package Run: on foot, closing on the package behind the Casa Azul.
      state.money = 150;
      state.missionsDone = 1;
      state.missionIndex = 1;
      state.nextMissionIn = 0;
      NH.startMission(state);
      state.player.x = 1895;
      state.player.y = 548;
      state.player.angle = 0;
      // A couple of locals on the pavement, so the street feels lived in.
      if (state.peds[0]) { state.peds[0].x = 2005; state.peds[0].y = 462; }
      if (state.peds[1]) { state.peds[1].x = 1972; state.peds[1].y = 646; }
      stepFor(world, walking(1, 0), 0.55);
      state.events.length = 0;
      return { screen: NH.SCREEN.PLAY };
    }

    if (name === 'coast') {
      // A late-run cruise down the coast avenue toward the Harbor Steps, one star up.
      state.money = 1890;
      state.missionsDone = 5;
      state.missionIndex = 5;
      state.nextMissionIn = 0;
      state.mission = {
        kind: 'reach', title: 'Harbor Run', payout: 300, timeLeft: 0, totalTime: 0,
        stage: 0, layLow: 0, cpIndex: 0, checkpoints: null, targetCar: null,
        target: { x: state.city.landmarks.harbor.x, y: state.city.landmarks.harbor.y, label: 'Harbor Steps' },
      };
      var car2 = findCar(state, function (c) { return c.kind === 'parked'; }) || state.cars[0];
      putPlayerInCar(state, car2, 3074, 880, Math.PI / 2, 'sedan', '#3498db');
      state.setWanted(1);
      makePolice(state, 3074, 600, Math.PI / 2);
      state.lastSeen.x = car2.x; state.lastSeen.y = car2.y;
      stepFor(world, driving(1), 1.3);
      state.events.length = 0;
      return { screen: NH.SCREEN.PLAY };
    }

    // Anything else is the title: the city idling behind the menu.
    stepFor(world, IDLE, 4);
    state.events.length = 0;
    return { screen: NH.SCREEN.TITLE };
  };
})();

// The simulation: Port Solano alive. The player on foot and in cars, traffic that follows
// the grid, pedestrians on the pavements, police who chase, the wanted level, collisions,
// cash, particles and the mission clock. No drawing and no browser in here: step() advances
// the state one fixed step and leaves event names in state.events for the caller to drain.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  var TRAFFIC_TARGET = 11;
  var PED_TARGET = 24;
  var MAX_PARTICLES = 240;

  function angleLerp(a, b, t) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, t);
  }

  function laneFor(axis, dirSign, center) {
    var off = NH.ROAD.width / 4;
    if (axis === 'x') return center + (dirSign > 0 ? off : -off);
    return center + (dirSign > 0 ? -off : off);
  }

  NH.createWorld = function (seed) {
    var rng = NH.createRandom(seed);
    var city = NH.buildCity();
    var nextId = 1;

    var state = {
      time: 0, city: city, rng: rng,
      player: {
        x: city.playerSpawn.x, y: city.playerSpawn.y, angle: Math.PI / 2,
        health: NH.PLAYER.health, inCar: null, speedNow: 0,
        punchCd: 0, invulnT: 0, lastHurt: -99,
      },
      cars: [], peds: [], particles: [], pickups: [], floaters: [], events: [],
      wanted: 0, bust: 0, escapeTimer: 0, crimeCd: {},
      money: 0, missionsDone: 0, missionIndex: 0, missionPayoutScale: 1,
      mission: null, nextMissionIn: 1.6,
      stats: { stolen: 0, muggings: 0, crashes: 0 },
      toastData: null, shake: 0, over: null, overAt: 0,
      policeSpawnT: 0, trafficT: 0, pedT: 0,
      lastSeen: { x: city.playerSpawn.x, y: city.playerSpawn.y },
    };

    function playerPos() { return state.player.inCar || state.player; }
    function playerSpeed() {
      return state.player.inCar ? Math.abs(state.player.inCar.speed) : state.player.speedNow;
    }

    state.toast = function (title, sub, seconds) {
      state.toastData = { title: title, sub: sub, until: state.time + (seconds || 3) };
    };

    state.setWanted = function (n) {
      state.wanted = Math.max(state.wanted, Math.min(NH.WANTED.max, n));
      state.escapeTimer = 0;
    };

    state.crime = function (stars, key, cooldown) {
      if (state.over) return;
      if (key) {
        if (state.time < (state.crimeCd[key] || 0)) return;
        state.crimeCd[key] = state.time + (cooldown || 3);
      }
      if (state.wanted < NH.WANTED.max) {
        state.wanted = Math.min(NH.WANTED.max, state.wanted + stars);
        state.events.push('crime');
      }
      state.escapeTimer = 0;
    };

    function floater(x, y, text, color) {
      state.floaters.push({ x: x, y: y, text: text, color: color || '#7dff8a', life: 1.4 });
      if (state.floaters.length > 24) state.floaters.shift();
    }
    state.floater = floater;

    function burst(x, y, color, n, speed) {
      for (var i = 0; i < n; i++) {
        if (state.particles.length >= MAX_PARTICLES) return;
        var a = rng.range(0, Math.PI * 2);
        var s = rng.range(speed * 0.3, speed);
        state.particles.push({
          x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: rng.range(0.25, 0.6), maxLife: 0.6, color: color, size: rng.range(2, 4.5),
        });
      }
    }

    function makeCar(kind, carKind, x, y, angle, color) {
      var spec = NH.CAR_KINDS[carKind];
      var car = {
        id: nextId++, kind: kind, carKind: carKind, x: x, y: y, angle: angle,
        speed: 0, vx: 0, vy: 0, steerVis: 0, color: color,
        health: spec.health, maxHealth: spec.health,
        driver: null, everOwned: false, missionCar: false, smokeT: 0,
        axis: 'x', dirSign: 1, lane: 0, cruise: 120, stopped: 0, policeState: 'chase',
      };
      state.cars.push(car);
      return car;
    }

    function initTraffic(car, x, y) {
      var road = NH.cityRoadAt(x, y);
      car.axis = road && road.axis === 'v' ? 'y' : 'x';
      car.dirSign = rng.chance(0.5) ? 1 : -1;
      var center;
      if (car.axis === 'x') {
        center = road && road.axis === 'h' ? road.center : NH.ROAD.hCenters[0];
        // Snap onto the nearest horizontal road if spawned off one.
        var best = 1e9;
        for (var i = 0; i < NH.ROAD.hCenters.length; i++) {
          var d = Math.abs(y - NH.ROAD.hCenters[i]);
          if (d < best) { best = d; center = NH.ROAD.hCenters[i]; }
        }
        car.y = laneFor('x', car.dirSign, center);
        car.lane = car.y;
        car.angle = car.dirSign > 0 ? 0 : Math.PI;
      } else {
        center = road && road.axis === 'v' ? road.center : NH.ROAD.vCenters[0];
        var best2 = 1e9;
        for (var j = 0; j < NH.ROAD.vCenters.length; j++) {
          var d2 = Math.abs(x - NH.ROAD.vCenters[j]);
          if (d2 < best2) { best2 = d2; center = NH.ROAD.vCenters[j]; }
        }
        car.x = laneFor('y', car.dirSign, center);
        car.lane = car.x;
        car.angle = car.dirSign > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      car.cruise = rng.range(95, 145);
      car.driver = 'ai';
      return car;
    }

    function spawnTraffic(far) {
      var p = state.player;
      var point = null;
      for (var tries = 0; tries < 20; tries++) {
        var cand = rng.pick(city.intersections);
        var d = Math.hypot(cand.x - p.x, cand.y - p.y);
        if (!far || (d > 640 && d < 1500)) { point = cand; break; }
        point = cand;
      }
      var car = makeCar('traffic', rng.pick(['compact', 'sedan', 'compact', 'sport']),
        point.x + rng.range(-30, 30), point.y + rng.range(-30, 30), 0, rng.pick(NH.CAR_COLORS));
      return initTraffic(car, car.x, car.y);
    }

    function spawnParked() {
      for (var i = 0; i < city.parkingSpots.length; i++) {
        var spot = city.parkingSpots[i];
        if (!rng.chance(0.62)) continue;
        var taken = false;
        for (var j = 0; j < state.cars.length; j++) {
          if (Math.hypot(state.cars[j].x - spot.x, state.cars[j].y - spot.y) < 34) { taken = true; break; }
        }
        if (taken) continue;
        makeCar('parked', rng.pick(['compact', 'sedan', 'sport']), spot.x, spot.y, spot.angle, rng.pick(NH.CAR_COLORS));
      }
    }

    state.spawnMissionCar = function () {
      var spot = null;
      for (var i = 0; i < city.parkingSpots.length; i++) {
        var s = city.parkingSpots[i];
        var taken = false;
        for (var j = 0; j < state.cars.length; j++) {
          if (Math.hypot(state.cars[j].x - s.x, state.cars[j].y - s.y) < 36) { taken = true; break; }
        }
        if (!taken) { spot = s; break; }
      }
      var x = spot ? spot.x : city.landmarks.garage.x + 60;
      var y = spot ? spot.y : city.landmarks.garage.y;
      var car = makeCar('parked', 'sport', x, y, spot ? spot.angle : 0, '#f7c948');
      car.missionCar = true;
      return car;
    };

    function spawnPed(anywhere) {
      var block = rng.pick(city.blocks);
      if (block.kind === 'beach') block = city.blocks[0];
      var inset = 10;
      var corners = [
        { x: block.x + inset, y: block.y + inset }, { x: block.x + block.w - inset, y: block.y + inset },
        { x: block.x + block.w - inset, y: block.y + block.h - inset }, { x: block.x + inset, y: block.y + block.h - inset },
      ];
      var start = rng.int(0, 3);
      var ped = {
        x: corners[start].x, y: corners[start].y, angle: 0, speed: rng.range(38, 62),
        color: rng.pick(NH.PED_COLORS), corners: corners, corner: (start + 1) % 4,
        state: 'walk', timer: 0, dirSign: 1,
      };
      if (!anywhere) {
        var d = Math.hypot(ped.x - state.player.x, ped.y - state.player.y);
        if (d < 120) return null;
      }
      state.peds.push(ped);
      return ped;
    }

    function spawnPolice() {
      var p = playerPos();
      var point = NH.cityIntersectionNear(city, rng, p.x, p.y, 560, 820);
      var car = makeCar('police', 'police', point.x, point.y, rng.range(0, Math.PI * 2), '#f5f6fa');
      car.driver = 'ai';
      car.cruise = 240;
      return car;
    }

    // ---- collisions -------------------------------------------------------

    function resolveCarBody(car) {
      // Two sample circles along the body; push the car out of buildings by their delta.
      var hit = false;
      var offsets = [13, -13];
      for (var i = 0; i < 2; i++) {
        var probe = {
          x: car.x + Math.cos(car.angle) * offsets[i],
          y: car.y + Math.sin(car.angle) * offsets[i],
        };
        var before = { x: probe.x, y: probe.y };
        if (NH.cityResolveCircle(city, probe, 14)) {
          car.x += probe.x - before.x;
          car.y += probe.y - before.y;
          hit = true;
        }
      }
      return hit;
    }

    function carCircles(car) {
      return [
        { x: car.x + Math.cos(car.angle) * 13, y: car.y + Math.sin(car.angle) * 13 },
        { x: car.x - Math.cos(car.angle) * 13, y: car.y - Math.sin(car.angle) * 13 },
      ];
    }

    function damageCar(car, amount, x, y) {
      if (car.health <= 0) return;
      car.health = Math.max(0, car.health - amount);
      if (x !== undefined) burst(x, y, '#ffd166', 6, 130);
      if (car.health <= 0) {
        car.speed = 0;
        burst(car.x, car.y, '#8d99ae', 14, 90);
        if (state.player.inCar === car) state.toast('WRECKED', 'This car is done. Find another. (E)', 2.4);
      }
    }

    function collideCars() {
      var cars = state.cars;
      for (var i = 0; i < cars.length; i++) {
        for (var j = i + 1; j < cars.length; j++) {
          var a = cars[i], b = cars[j];
          if (Math.abs(a.x - b.x) > 60 || Math.abs(a.y - b.y) > 60) continue;
          var ac = carCircles(a), bc = carCircles(b);
          var collided = false;
          for (var m = 0; m < 2 && !collided; m++) {
            for (var n = 0; n < 2 && !collided; n++) {
              var dx = bc[n].x - ac[m].x, dy = bc[n].y - ac[m].y;
              var d = Math.hypot(dx, dy);
              if (d < 27 && d > 0.01) {
                var push = (27 - d) / 2;
                var ux = dx / d, uy = dy / d;
                if (a.driver !== 'player' || true) { a.x -= ux * push; a.y -= uy * push; }
                b.x += ux * push; b.y += uy * push;
                collided = true;
                var rel = Math.hypot(a.vx - b.vx, a.vy - b.vy);
                if (rel > 95) {
                  var dmg = (rel - 95) * 0.055;
                  damageCar(a, dmg, ac[m].x, ac[m].y);
                  damageCar(b, dmg, ac[m].x, ac[m].y);
                  a.speed *= 0.45; b.speed *= 0.45;
                  var involvesPlayer = state.player.inCar === a || state.player.inCar === b;
                  if (involvesPlayer) {
                    state.shake = Math.min(14, state.shake + rel * 0.03);
                    state.events.push('crash:' + Math.min(1, rel / 420).toFixed(2));
                    state.stats.crashes += 1;
                    var other = state.player.inCar === a ? b : a;
                    if (other.kind !== 'police') state.crime(1, 'crash', 2.5);
                    if (rel > 270 && state.player.inCar) {
                      hurtPlayer((rel - 270) * 0.05, state.player.inCar.x, state.player.inCar.y);
                    }
                  } else if (rel > 200) {
                    state.events.push('crash:0.2');
                  }
                } else if (rel > 40) {
                  // A gentle nudge apart; damping crawling cars to a stop here would
                  // leave two police cars parked nose to tail in the road.
                  a.speed *= 0.92; b.speed *= 0.92;
                }
              }
            }
          }
        }
      }
    }

    function hurtPlayer(amount, x, y) {
      var p = state.player;
      if (state.time < p.invulnT || state.over) return;
      p.health = Math.max(0, p.health - amount);
      p.invulnT = state.time + 0.9;
      p.lastHurt = state.time;
      state.events.push('hurt');
      state.shake = Math.min(12, state.shake + 5);
      burst(x, y, '#ef476f', 8, 120);
      if (p.health <= 0) gameOver('wasted');
    }

    function gameOver(kind) {
      if (state.over) return;
      state.over = kind;
      state.overAt = state.time;
      state.events.push(kind);
      if (state.player.inCar) {
        // The run ends where the car stops.
        state.player.inCar.driver = null;
      }
    }

    // ---- per-actor updates --------------------------------------------------

    function updatePlayerOnFoot(input, actions, dt) {
      var p = state.player;
      var ax = input.axisX(), ay = input.axisY();
      var len = Math.hypot(ax, ay);
      var speed = input.sprint() ? NH.PLAYER.sprintSpeed : NH.PLAYER.walkSpeed;
      if (len > 0) {
        ax /= len; ay /= len;
        p.angle = Math.atan2(ay, ax);
        p.x += ax * speed * dt;
        p.y += ay * speed * dt;
        p.speedNow = speed;
      } else p.speedNow = 0;
      NH.cityResolveCircle(city, p, NH.PLAYER.radius);
      // Cars are solid to walk into.
      for (var i = 0; i < state.cars.length; i++) {
        var car = state.cars[i];
        var circles = carCircles(car);
        for (var m = 0; m < 2; m++) {
          var dx = p.x - circles[m].x, dy = p.y - circles[m].y;
          var d = Math.hypot(dx, dy);
          if (d < NH.PLAYER.radius + 14 && d > 0.01) {
            p.x = circles[m].x + (dx / d) * (NH.PLAYER.radius + 14);
            p.y = circles[m].y + (dy / d) * (NH.PLAYER.radius + 14);
          }
        }
      }
      // Punch / mug.
      p.punchCd = Math.max(0, p.punchCd - dt);
      if ((actions & NH.ACTION.PUNCH || input.punchHeld()) && p.punchCd <= 0) {
        p.punchCd = NH.PLAYER.punchCooldown;
        state.events.push('punch');
        var hitPed = null, hitD = 1e9;
        for (var j = 0; j < state.peds.length; j++) {
          var ped = state.peds[j];
          if (ped.state === 'down') continue;
          var pd = Math.hypot(ped.x - p.x, ped.y - p.y);
          if (pd < NH.PLAYER.punchRange && pd < hitD) { hitPed = ped; hitD = pd; }
        }
        if (hitPed) {
          hitPed.state = 'down';
          hitPed.timer = 7;
          state.stats.muggings += 1;
          var amount = rng.int(8, 42);
          state.pickups.push({ x: hitPed.x + rng.range(-8, 8), y: hitPed.y + rng.range(-8, 8), amount: amount, t: 0 });
          burst(hitPed.x, hitPed.y, '#ffe66d', 6, 90);
          state.crime(1, 'mug', 2);
        } else {
          for (var k = 0; k < state.cars.length; k++) {
            var c2 = state.cars[k];
            if (Math.hypot(c2.x - p.x, c2.y - p.y) < 44) {
              damageCar(c2, 2, p.x, p.y);
              state.crime(1, 'vandal', 4);
              break;
            }
          }
        }
      }
      // Enter a car.
      if (actions & NH.ACTION.INTERACT) {
        var best = null, bestD = 56;
        for (var q = 0; q < state.cars.length; q++) {
          var c3 = state.cars[q];
          var cd = Math.hypot(c3.x - p.x, c3.y - p.y);
          if (cd < bestD) { best = c3; bestD = cd; }
        }
        if (best) {
          if (best.health <= 0) {
            state.toast('WRECKED', 'That car is not going anywhere.', 1.8);
          } else {
            enterCar(best);
          }
        }
      }
    }

    function enterCar(car) {
      var p = state.player;
      if (car.driver === 'ai' && car.kind === 'traffic') {
        // The driver bails out and runs.
        var ped = spawnPed(true);
        if (ped) { ped.x = car.x; ped.y = car.y; ped.state = 'flee'; ped.timer = 2.5; ped.fleeAngle = rng.range(0, Math.PI * 2); }
      }
      if (!car.everOwned) {
        car.everOwned = true;
        state.stats.stolen += 1;
        state.events.push('steal');
        state.crime(car.kind === 'police' ? 2 : 1, 'steal', 3);
        state.toast('CAR TAKEN', car.kind === 'police' ? 'A police car. Bold.' : 'Wheels acquired.', 1.8);
      }
      car.driver = 'player';
      car.policeState = 'chase';
      p.inCar = car;
      p.speedNow = 0;
    }

    function exitCar() {
      var p = state.player;
      var car = p.inCar;
      if (!car) return;
      car.driver = null;
      if (car.kind === 'traffic') car.kind = 'parked'; // left behind, it stays where it was left
      car.speed = 0;
      var side = car.angle + Math.PI / 2;
      p.x = car.x + Math.cos(side) * 30;
      p.y = car.y + Math.sin(side) * 30;
      NH.cityResolveCircle(city, p, NH.PLAYER.radius);
      p.inCar = null;
    }

    function updatePlayerDriving(input, actions, dt) {
      var p = state.player;
      var car = p.inCar;
      var spec = NH.CAR_KINDS[car.carKind];
      var throttle = car.health > 0 ? input.throttle() : 0;
      if (throttle > 0) car.speed = Math.min(spec.topSpeed, car.speed + spec.accel * dt);
      else if (throttle < 0) {
        if (car.speed > 12) car.speed = Math.max(0, car.speed - 520 * dt);
        else car.speed = Math.max(-NH.CAR.reverseSpeed, car.speed - 200 * dt);
      } else {
        car.speed -= car.speed * 0.85 * dt;
        if (Math.abs(car.speed) < 2) car.speed = 0;
      }
      if (input.handbrake()) {
        car.speed -= car.speed * 2.4 * dt;
      }
      var steer = input.steer();
      car.steerVis = angleLerp(car.steerVis, steer, dt * 10);
      var speedFactor = Math.max(-1, Math.min(1, car.speed / 130));
      var turnBoost = input.handbrake() ? 1.5 : 1;
      car.angle += steer * NH.CAR.turnRate * spec.grip * turnBoost * speedFactor * dt;
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      car.vx = Math.cos(car.angle) * car.speed;
      car.vy = Math.sin(car.angle) * car.speed;
      if (resolveCarBody(car) && Math.abs(car.speed) > 190) {
        damageCar(car, (Math.abs(car.speed) - 190) * 0.045, car.x, car.y);
        state.shake = Math.min(12, state.shake + 4);
        state.events.push('crash:0.35');
        car.speed *= 0.42;
      }
      if (car.health > 0 && car.health < 38) {
        car.smokeT -= dt;
        if (car.smokeT <= 0) {
          car.smokeT = 0.07;
          state.particles.push({
            x: car.x + rng.range(-6, 6), y: car.y + rng.range(-6, 6),
            vx: rng.range(-8, 8), vy: rng.range(-26, -12),
            life: 0.7, maxLife: 0.7, color: '#6c757d', size: rng.range(4, 7),
          });
        }
      }
      if ((actions & NH.ACTION.INTERACT) && Math.abs(car.speed) < 42) exitCar();
    }

    function trafficObstacle(car, aheadDist) {
      var ax = car.x + Math.cos(car.angle) * aheadDist;
      var ay = car.y + Math.sin(car.angle) * aheadDist;
      for (var i = 0; i < state.cars.length; i++) {
        var other = state.cars[i];
        if (other === car) continue;
        if (Math.hypot(other.x - ax, other.y - ay) < 30) return true;
      }
      var p = playerPos();
      if (!state.player.inCar && Math.hypot(p.x - ax, p.y - ay) < 24) return true;
      for (var j = 0; j < state.peds.length; j++) {
        var ped = state.peds[j];
        if (ped.state !== 'down' && Math.hypot(ped.x - ax, ped.y - ay) < 22) return true;
      }
      return false;
    }

    function updateTraffic(car, dt) {
      if (car.stopped > 0) {
        car.stopped -= dt;
        car.speed = 0;
        car.vx = 0; car.vy = 0;
        return;
      }
      var pos = car.axis === 'x' ? car.x : car.y;
      var centers = car.axis === 'x' ? NH.ROAD.vCenters : NH.ROAD.hCenters;
      // The next junction ahead, or a virtual one past the last road (a U-turn point).
      var next = null;
      for (var i = 0; i < centers.length; i++) {
        var c = centers[i];
        if (car.dirSign > 0 && c > pos + 4 && (next === null || c < next)) next = c;
        if (car.dirSign < 0 && c < pos - 4 && (next === null || c > next)) next = c;
      }
      var distToJunction = next === null ? 240 : Math.abs(next - pos);
      if (distToJunction < 30) {
        var roll = rng.next();
        if (next === null) {
          // End of the road: turn around onto the opposite lane of the same road.
          var center0 = carLaneCenter(car);
          car.dirSign = -car.dirSign;
          car.lane = laneFor(car.axis, car.dirSign, center0);
        } else if (roll < 0.42) {
          // Turn onto the crossing road: the junction coordinate becomes the new centre.
          var oldAxis = car.axis;
          car.axis = oldAxis === 'x' ? 'y' : 'x';
          car.dirSign = rng.chance(0.5) ? 1 : -1;
          car.lane = laneFor(car.axis, car.dirSign, next);
          if (car.axis === 'y') car.x = car.lane; else car.y = car.lane;
        }
        // else: straight on, nothing to change.
      }
      // Steer toward a guide point up the lane.
      var guideX, guideY;
      if (car.axis === 'x') { guideX = car.x + car.dirSign * 110; guideY = car.lane; }
      else { guideX = car.lane; guideY = car.y + car.dirSign * 110; }
      var want = Math.atan2(guideY - car.y, guideX - car.x);
      car.angle = angleLerp(car.angle, want, dt * 3.2);
      var blocked = trafficObstacle(car, 52);
      var target = blocked ? 0 : car.cruise;
      if (car.speed < target) car.speed = Math.min(target, car.speed + 170 * dt);
      else car.speed = Math.max(target, car.speed - 420 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      car.vx = Math.cos(car.angle) * car.speed;
      car.vy = Math.sin(car.angle) * car.speed;
      resolveCarBody(car);
    }

    function carLaneCenter(car) {
      // The centre line of the road the car is travelling on, from its lane offset.
      var off = NH.ROAD.width / 4;
      if (car.axis === 'x') return car.lane - (car.dirSign > 0 ? off : -off);
      return car.lane - (car.dirSign > 0 ? -off : off);
    }

    function updatePolice(car, dt) {
      var p = playerPos();
      var d = Math.hypot(p.x - car.x, p.y - car.y);
      if (state.wanted === 0 || car.policeState === 'leave') {
        car.policeState = 'leave';
        car.speed = Math.min(210, car.speed + 160 * dt);
        car.x += Math.cos(car.angle) * car.speed * dt;
        car.y += Math.sin(car.angle) * car.speed * dt;
        car.vx = Math.cos(car.angle) * car.speed;
        car.vy = Math.sin(car.angle) * car.speed;
        resolveCarBody(car);
        return;
      }
      var tx = state.lastSeen.x, ty = state.lastSeen.y;
      if (d < NH.WANTED.sightRange) { tx = p.x; ty = p.y; }
      // Aim a little ahead of a moving target.
      var lead = Math.min(0.5, d / 500);
      tx += (p.vx || 0) * lead;
      ty += (p.vy || 0) * lead;
      var want = Math.atan2(ty - car.y, tx - car.x);
      car.angle = angleLerp(car.angle, want, dt * 2.7);
      var spec = NH.CAR_KINDS.police;
      var target = d > 130 ? spec.topSpeed : Math.max(120, playerSpeed() + 40);
      if (car.speed < target) car.speed = Math.min(target, car.speed + spec.accel * dt);
      else car.speed = Math.max(target, car.speed - 380 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      car.vx = Math.cos(car.angle) * car.speed;
      car.vy = Math.sin(car.angle) * car.speed;
      if (resolveCarBody(car)) car.speed *= 0.55;
    }

    function updatePed(ped, dt) {
      if (ped.state === 'down') {
        ped.timer -= dt;
        if (ped.timer <= 0) ped.state = 'walk';
        return;
      }
      if (ped.state === 'flee') {
        ped.timer -= dt;
        ped.x += Math.cos(ped.fleeAngle || 0) * 225 * dt;
        ped.y += Math.sin(ped.fleeAngle || 0) * 225 * dt;
        ped.angle = ped.fleeAngle || 0;
        NH.cityResolveCircle(city, ped, 8);
        if (ped.timer <= 0) ped.state = 'walk';
        return;
      }
      // Flee a fast car that is close.
      for (var i = 0; i < state.cars.length; i++) {
        var car = state.cars[i];
        if (Math.abs(car.speed) > 130 && Math.hypot(car.x - ped.x, car.y - ped.y) < 84) {
          ped.state = 'flee';
          ped.timer = 1.1;
          ped.fleeAngle = Math.atan2(ped.y - car.y, ped.x - car.x) + rng.range(-0.4, 0.4);
          return;
        }
      }
      var target = ped.corners[ped.corner];
      var dx = target.x - ped.x, dy = target.y - ped.y;
      var d = Math.hypot(dx, dy);
      if (d < 6) {
        ped.corner = (ped.corner + ped.dirSign + 4) % 4;
        if (rng.chance(0.06)) ped.dirSign = -ped.dirSign;
        return;
      }
      ped.angle = Math.atan2(dy, dx);
      ped.x += (dx / d) * ped.speed * dt;
      ped.y += (dy / d) * ped.speed * dt;
    }

    function updateWanted(dt) {
      var p = playerPos();
      var police = [];
      for (var i = 0; i < state.cars.length; i++) {
        var anyCar = state.cars[i];
        // A police car the player is sitting in does not count as pursuit.
        if (anyCar.kind === 'police' && anyCar !== state.player.inCar) police.push(anyCar);
      }

      var seen = false;
      var nearest = 1e9;
      for (var j = 0; j < police.length; j++) {
        var d = Math.hypot(p.x - police[j].x, p.y - police[j].y);
        if (d < nearest) nearest = d;
        if (d < NH.WANTED.sightRange) {
          seen = true;
          state.lastSeen.x = p.x;
          state.lastSeen.y = p.y;
        }
      }
      if (state.wanted > 0) {
        if (seen) state.escapeTimer = 0;
        else {
          state.escapeTimer += dt;
          if (state.escapeTimer >= NH.WANTED.escapeSeconds) {
            state.wanted -= 1;
            state.escapeTimer = 0;
            state.events.push('cooldown');
            if (state.wanted === 0) state.bust = 0;
          }
        }
        // Bust meter: a police car close to a slow player.
        if (nearest < NH.WANTED.bustRange && playerSpeed() < 30 && !state.over) {
          state.bust = Math.min(1, state.bust + dt / NH.WANTED.bustSeconds);
          if (state.bust >= 1) gameOver('busted');
        } else {
          state.bust = Math.max(0, state.bust - dt * 0.7);
        }
      } else {
        state.bust = Math.max(0, state.bust - dt * 0.7);
      }

      // Keep the police presence matched to the wanted level.
      var desired = state.wanted === 0 ? 0 : Math.min(6, state.wanted + (state.wanted >= 3 ? 1 : 0));
      var active = 0;
      for (var k = 0; k < police.length; k++) if (police[k].policeState !== 'leave') active += 1;
      state.policeSpawnT -= dt;
      if (active < desired && state.policeSpawnT <= 0 && !state.over) {
        spawnPolice();
        state.policeSpawnT = 1.1;
      }
      // Clean up police who have given up or drifted far away.
      for (var m = state.cars.length - 1; m >= 0; m--) {
        var pc = state.cars[m];
        if (pc.kind !== 'police' || state.player.inCar === pc) continue;
        var pd = Math.hypot(p.x - pc.x, p.y - pc.y);
        if ((pc.policeState === 'leave' && pd > 640) || pd > 1600) {
          state.cars.splice(m, 1);
        }
      }
    }

    function updatePickups(dt) {
      var p = playerPos();
      for (var i = state.pickups.length - 1; i >= 0; i--) {
        var pk = state.pickups[i];
        pk.t += dt;
        if (Math.hypot(pk.x - p.x, pk.y - p.y) < 30) {
          state.money += pk.amount;
          floater(pk.x, pk.y - 14, '+$' + pk.amount, '#7dff8a');
          state.events.push('cash');
          state.pickups.splice(i, 1);
        } else if (pk.t > 90) state.pickups.splice(i, 1);
      }
    }

    function updateAmbient(dt) {
      // Traffic and pedestrians keep living whether or not the run is over.
      for (var i = 0; i < state.cars.length; i++) {
        var car = state.cars[i];
        if (car.driver === 'player') continue;
        if (car.kind === 'traffic') updateTraffic(car, dt);
        else if (car.kind === 'police') updatePolice(car, dt);
      }
      for (var j = 0; j < state.peds.length; j++) updatePed(state.peds[j], dt);
      // Being run down is bad for the player and worse for the driver's record.
      if (!state.over && !state.player.inCar) {
        var p = state.player;
        for (var k = 0; k < state.cars.length; k++) {
          var c = state.cars[k];
          if (Math.abs(c.speed) > 65 && Math.hypot(c.x - p.x, c.y - p.y) < 25) {
            hurtPlayer(9 + Math.abs(c.speed) * 0.045, p.x, p.y);
            p.x += (p.x - c.x) * 0.6;
            p.y += (p.y - c.y) * 0.6;
            if (c.kind === 'traffic') c.stopped = 2.5;
          }
        }
      }
      // The player's car running someone down: a serious crime.
      if (!state.over && state.player.inCar && Math.abs(state.player.inCar.speed) > 55) {
        var pc = state.player.inCar;
        for (var m = 0; m < state.peds.length; m++) {
          var ped = state.peds[m];
          if (ped.state !== 'down' && Math.hypot(ped.x - pc.x, ped.y - pc.y) < 26) {
            ped.state = 'down';
            ped.timer = 8;
            burst(ped.x, ped.y, '#ef476f', 8, 110);
            state.events.push('hurt');
            state.crime(2, 'rundown', 3);
          }
        }
      }
      // Particles and floaters.
      for (var n = state.particles.length - 1; n >= 0; n--) {
        var pt = state.particles[n];
        pt.life -= dt;
        if (pt.life <= 0) { state.particles.splice(n, 1); continue; }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 0.92; pt.vy *= 0.92;
      }
      for (var f = state.floaters.length - 1; f >= 0; f--) {
        var fl = state.floaters[f];
        fl.life -= dt;
        fl.y -= 34 * dt;
        if (fl.life <= 0) state.floaters.splice(f, 1);
      }
      // Keep the streets populated.
      state.trafficT -= dt;
      if (state.trafficT <= 0) {
        state.trafficT = 1.5;
        var trafficCount = 0;
        for (var t = 0; t < state.cars.length; t++) if (state.cars[t].kind === 'traffic') trafficCount += 1;
        if (trafficCount < TRAFFIC_TARGET) spawnTraffic(true);
        // Remove traffic that wandered to the far side of the city.
        var pp = playerPos();
        for (var r = state.cars.length - 1; r >= 0; r--) {
          var rc = state.cars[r];
          if (rc.kind === 'traffic' && rc.driver !== 'player' && Math.hypot(rc.x - pp.x, rc.y - pp.y) > 1750) {
            state.cars.splice(r, 1);
          }
        }
      }
      state.pedT -= dt;
      if (state.pedT <= 0) {
        state.pedT = 1.2;
        if (state.peds.length < PED_TARGET) spawnPed(false);
        if (state.peds.length > PED_TARGET + 6) state.peds.splice(0, state.peds.length - PED_TARGET);
      }
    }

    function step(input, actions, dt) {
      state.time += dt;
      if (!state.over) {
        if (state.player.inCar) updatePlayerDriving(input, actions, dt);
        else updatePlayerOnFoot(input, actions, dt);
        // On-foot health slowly returns when nobody has hurt the player lately.
        var p = state.player;
        if (!p.inCar && state.time - p.lastHurt > 5 && p.health > 0) {
          p.health = Math.min(NH.PLAYER.health, p.health + 2.2 * dt);
        }
        if (p.invulnT > 0) p.invulnT = Math.max(0, p.invulnT - dt);
        // Delgado repairs the player's ride at the garage door, for a price.
        state.repairCd = Math.max(0, (state.repairCd || 0) - dt);
        if (state.player.inCar && state.repairCd <= 0) {
          var ride = state.player.inCar;
          var gd = Math.hypot(ride.x - city.landmarks.garage.x, ride.y - city.landmarks.garage.y);
          if (gd < 58 && ride.health < ride.maxHealth) {
            if (state.money >= 40) {
              state.money -= 40;
              ride.health = ride.maxHealth;
              state.repairCd = 3;
              floater(ride.x, ride.y - 22, '-$40 REPAIRS', '#ffd166');
              state.toast("DELGADO'S GARAGE", 'Good as new. That will be $40.', 2.2);
              state.events.push('cash');
            } else if (state.time > (state.repairHintCd || 0)) {
              state.repairHintCd = state.time + 6;
              state.toast("DELGADO'S GARAGE", 'Repairs cost $40. Come back richer.', 2.2);
            }
          }
        }
        NH.updateMissions(state, dt);
        updateWanted(dt);
        updatePickups(dt);
      }
      updateAmbient(dt);
      collideCars();
      state.shake = Math.max(0, state.shake - dt * 26);
    }

    // Populate the city.
    spawnParked();
    for (var s = 0; s < TRAFFIC_TARGET; s++) spawnTraffic(false);
    for (var q = 0; q < PED_TARGET; q++) spawnPed(true);
    // A few bonus cash bundles glitter around the city.
    for (var b = 0; b < 6; b++) {
      var lmKeys = ['park', 'harbor', 'hideout', 'market', 'depot', 'casino'];
      var lm = city.landmarks[b % lmKeys.length] || { x: 600, y: 600 };
      state.pickups.push({ x: lm.x + rng.range(-40, 40), y: lm.y + rng.range(-40, 40), amount: rng.int(15, 50), t: -9999 });
    }

    return { state: state, step: step };
  };
})();

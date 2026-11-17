// Port Solano itself: generates the street grid, the blocks between the roads and everything
// that stands on them — pastel buildings, two parks, a plaza with a fountain, a parking lot,
// the beach and the sea. Also the collision and road helpers the simulation asks every step.
// The layout is grown from a fixed seed, so the city is the same on every visit.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  var CITY_SEED = 7;
  var SIDEWALK = 16; // pavement border inside each block
  var BUILDING_INSET = 34; // buildings stand this far inside their block

  function shade(hex, factor) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * factor)));
    var g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * factor)));
    var b = Math.min(255, Math.max(0, Math.round((n & 255) * factor)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // The rectangles of land between the roads (and the world edges): columns west to east,
  // rows north to south. The last column is the beach.
  function blockGrid() {
    var xs = [0];
    for (var i = 0; i < NH.ROAD.vCenters.length; i++) {
      xs.push(NH.ROAD.vCenters[i] - NH.ROAD.width / 2, NH.ROAD.vCenters[i] + NH.ROAD.width / 2);
    }
    xs.push(NH.WORLD.width);
    var ys = [0];
    for (var j = 0; j < NH.ROAD.hCenters.length; j++) {
      ys.push(NH.ROAD.hCenters[j] - NH.ROAD.width / 2, NH.ROAD.hCenters[j] + NH.ROAD.width / 2);
    }
    ys.push(NH.WORLD.height);
    var blocks = [];
    for (var c = 0; c < xs.length - 1; c += 2) {
      for (var r = 0; r < ys.length - 1; r += 2) {
        blocks.push({
          x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r],
          col: c / 2, row: r / 2, kind: 'buildings',
        });
      }
    }
    return blocks;
  }

  function blockAt(blocks, col, row) {
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].col === col && blocks[i].row === row) return blocks[i];
    }
    return null;
  }

  function addBuilding(city, rng, x, y, w, h) {
    if (w < 60 || h < 50) return;
    var color = rng.pick(NH.BUILDING_COLORS);
    var building = {
      x: x, y: y, w: w, h: h, color: color, roof: shade(color, 0.82),
      trim: shade(color, 1.12), lift: rng.range(6, 26), floors: Math.max(2, Math.round(h / 34)),
    };
    city.buildings.push(building);
    city.colliders.push({ x: x, y: y, w: w, h: h });
  }

  function fillBuildings(city, rng, block) {
    var x = block.x + BUILDING_INSET, y = block.y + BUILDING_INSET;
    var w = block.w - BUILDING_INSET * 2, h = block.h - BUILDING_INSET * 2;
    if (w < 90 || h < 80) { addBuilding(city, rng, x, y, w, h); return; }
    var layout = rng.int(0, 3);
    var gap = 40;
    if (layout === 0) {
      addBuilding(city, rng, x, y, w, h);
    } else if (layout === 1) { // two, side by side
      var w2 = (w - gap) / 2;
      addBuilding(city, rng, x, y, w2, h);
      addBuilding(city, rng, x + w2 + gap, y, w2, h);
    } else if (layout === 2) { // two, stacked
      var h2 = (h - gap) / 2;
      addBuilding(city, rng, x, y, w, h2);
      addBuilding(city, rng, x, y + h2 + gap, w, h2);
    } else { // four around an alley cross
      var qw = (w - gap) / 2, qh = (h - gap) / 2;
      addBuilding(city, rng, x, y, qw, qh);
      addBuilding(city, rng, x + qw + gap, y, qw, qh);
      addBuilding(city, rng, x, y + qh + gap, qw, qh);
      addBuilding(city, rng, x + qw + gap, y + qh + gap, qw, qh);
    }
  }

  function fillPark(city, rng, block) {
    city.parks.push({ x: block.x + SIDEWALK, y: block.y + SIDEWALK, w: block.w - SIDEWALK * 2, h: block.h - SIDEWALK * 2 });
    for (var i = 0; i < 16; i++) {
      city.trees.push({
        x: rng.range(block.x + 40, block.x + block.w - 40),
        y: rng.range(block.y + 40, block.y + block.h - 40),
        r: rng.range(9, 15), palm: false,
      });
    }
  }

  function fillPlaza(city, rng, block) {
    var cx = block.x + block.w / 2, cy = block.y + block.h / 2;
    city.plaza = { x: block.x, y: block.y, w: block.w, h: block.h, fountain: { x: cx, y: cy, r: 36 } };
    city.colliders.push({ x: cx - 36, y: cy - 36, w: 72, h: 72 });
    var corners = [[44, 44], [block.w - 44, 44], [44, block.h - 44], [block.w - 44, block.h - 44]];
    for (var i = 0; i < corners.length; i++) {
      city.trees.push({ x: block.x + corners[i][0], y: block.y + corners[i][1], r: 12, palm: false });
    }
  }

  function fillParking(city, rng, block) {
    city.parkingLot = { x: block.x + SIDEWALK, y: block.y + SIDEWALK, w: block.w - SIDEWALK * 2, h: block.h - SIDEWALK * 2 };
    // Two rows of marked bays along the north and south edges of the lot.
    for (var i = 0; i < 6; i++) {
      city.parkingSpots.push({ x: block.x + 70 + i * 62, y: block.y + 52, angle: Math.PI / 2 });
      city.parkingSpots.push({ x: block.x + 70 + i * 62, y: block.y + block.h - 52, angle: -Math.PI / 2 });
    }
    city.parkingSpots.push({ x: block.x + block.w / 2, y: block.y + block.h / 2, angle: 0 });
  }

  NH.buildCity = function () {
    var rng = NH.createRandom(CITY_SEED);
    var city = {
      width: NH.WORLD.width, height: NH.WORLD.height,
      blocks: blockGrid(), buildings: [], colliders: [], trees: [], lamps: [],
      parks: [], parkingSpots: [], plaza: null, parkingLot: null, landmarks: {},
      intersections: [],
    };

    for (var i = 0; i < NH.ROAD.vCenters.length; i++) {
      for (var j = 0; j < NH.ROAD.hCenters.length; j++) {
        city.intersections.push({ x: NH.ROAD.vCenters[i], y: NH.ROAD.hCenters[j] });
      }
    }

    var parkA = blockAt(city.blocks, 2, 2), parkB = blockAt(city.blocks, 4, 4);
    var plaza = blockAt(city.blocks, 1, 1), parking = blockAt(city.blocks, 3, 3);
    if (parkA) parkA.kind = 'park';
    if (parkB) parkB.kind = 'park';
    if (plaza) plaza.kind = 'plaza';
    if (parking) parking.kind = 'parking';

    for (var b = 0; b < city.blocks.length; b++) {
      var block = city.blocks[b];
      if (block.col === 6) { block.kind = 'beach'; continue; } // the sand strip: no buildings
      if (block.kind === 'park') fillPark(city, rng, block);
      else if (block.kind === 'plaza') fillPlaza(city, rng, block);
      else if (block.kind === 'parking') fillParking(city, rng, block);
      else fillBuildings(city, rng, block);
    }

    // Palms along the promenade where the last avenue meets the sand.
    for (var y = 120; y < NH.WORLD.height - 60; y += 118) {
      city.trees.push({ x: NH.BEACH_X + 26 + rng.range(-8, 8), y: y + rng.range(-16, 16), r: rng.range(10, 14), palm: true });
    }
    // Street lamps along the avenues (visual only).
    for (var v = 0; v < NH.ROAD.vCenters.length; v++) {
      for (var ly = 90; ly < NH.WORLD.height; ly += 190) {
        city.lamps.push({ x: NH.ROAD.vCenters[v] - NH.ROAD.width / 2 - 7, y: ly });
        city.lamps.push({ x: NH.ROAD.vCenters[v] + NH.ROAD.width / 2 + 7, y: ly + 95 });
      }
    }

    // Named places the missions and the story point at. Door points sit on the pavement
    // at a block edge, always reachable on foot.
    function door(block, side) {
      if (!block) return { x: 600, y: 600 };
      if (side === 'south') return { x: block.x + block.w / 2, y: block.y + block.h - 8 };
      if (side === 'north') return { x: block.x + block.w / 2, y: block.y + 8 };
      if (side === 'east') return { x: block.x + block.w - 8, y: block.y + block.h / 2 };
      return { x: block.x + 8, y: block.y + block.h / 2 };
    }
    city.landmarks = {
      bodega: door(blockAt(city.blocks, 1, 4), 'south'),
      garage: door(parking, 'west'),
      hideout: door(plaza, 'south'),
      park: door(parkA, 'west'),
      harbor: { x: NH.BEACH_X + 90, y: 1320 },
      casino: door(blockAt(city.blocks, 4, 1), 'west'),
      depot: door(blockAt(city.blocks, 5, 5), 'north'),
      market: door(blockAt(city.blocks, 3, 0), 'south'),
    };
    city.landmarks.bodega.label = 'Bodega Luna';
    city.landmarks.garage.label = "Delgado's Garage";
    city.landmarks.hideout.label = 'Plaza Fountain';
    city.landmarks.park.label = 'Solano Park';
    city.landmarks.harbor.label = 'Harbor Steps';
    city.landmarks.casino.label = 'Casa Azul Hotel';
    city.landmarks.depot.label = 'South Depot';
    city.landmarks.market.label = 'North Market';
    city.playerSpawn = { x: city.landmarks.bodega.x - 60, y: city.landmarks.bodega.y + 26 };
    return city;
  };

  // Is (x, y) on a road? Returns the road it is on, so traffic can follow the grid.
  NH.cityRoadAt = function (x, y) {
    var half = NH.ROAD.width / 2 + 6;
    for (var i = 0; i < NH.ROAD.vCenters.length; i++) {
      if (Math.abs(x - NH.ROAD.vCenters[i]) <= half) return { axis: 'v', center: NH.ROAD.vCenters[i] };
    }
    for (var j = 0; j < NH.ROAD.hCenters.length; j++) {
      if (Math.abs(y - NH.ROAD.hCenters[j]) <= half) return { axis: 'h', center: NH.ROAD.hCenters[j] };
    }
    return null;
  };

  // Push a circle (an object with x and y) out of every building and out of the sea.
  // Returns true when it had to move.
  NH.cityResolveCircle = function (city, p, r) {
    var moved = false;
    if (p.x < r) { p.x = r; moved = true; }
    if (p.y < r) { p.y = r; moved = true; }
    if (p.x > city.width - r) { p.x = city.width - r; moved = true; }
    if (p.y > city.height - r) { p.y = city.height - r; moved = true; }
    if (p.x + r > NH.WATER_X) { p.x = NH.WATER_X - r; moved = true; }
    for (var i = 0; i < city.colliders.length; i++) {
      var c = city.colliders[i];
      var nx = Math.max(c.x, Math.min(p.x, c.x + c.w));
      var ny = Math.max(c.y, Math.min(p.y, c.y + c.h));
      var dx = p.x - nx, dy = p.y - ny;
      var d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      moved = true;
      if (d2 > 0.0001) {
        var d = Math.sqrt(d2);
        p.x = nx + (dx / d) * r;
        p.y = ny + (dy / d) * r;
      } else {
        // Centre inside the rect: leave by the nearest face.
        var left = p.x - c.x, right = c.x + c.w - p.x, top = p.y - c.y, bottom = c.y + c.h - p.y;
        var m = Math.min(left, right, top, bottom);
        if (m === left) p.x = c.x - r;
        else if (m === right) p.x = c.x + c.w + r;
        else if (m === top) p.y = c.y - r;
        else p.y = c.y + c.h + r;
      }
    }
    return moved;
  };

  NH.cityPointBlocked = function (city, x, y, r) {
    var probe = { x: x, y: y };
    return NH.cityResolveCircle(city, probe, r) && (Math.abs(probe.x - x) > 0.01 || Math.abs(probe.y - y) > 0.01);
  };

  // A random intersection whose distance from (x, y) falls in [minD, maxD].
  NH.cityIntersectionNear = function (city, rng, x, y, minD, maxD) {
    var best = null;
    for (var tries = 0; tries < 24; tries++) {
      var p = rng.pick(city.intersections);
      var d = Math.hypot(p.x - x, p.y - y);
      if (d >= minD && d <= maxD) return p;
      if (best === null || d > minD) best = p;
    }
    return best || city.intersections[0];
  };
})();

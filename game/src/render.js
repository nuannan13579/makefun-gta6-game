// Drawing only: the world state and the current screen in, pixels out. The static city
// (roads, buildings, parks, beach) is painted once onto a big offscreen canvas and blitted
// each frame; the minimap is painted once too. Everything dynamic — cars, people, the
// beacon over the objective, the HUD — is drawn per frame from the state.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  NH.SCREEN = { TITLE: 'title', PLAY: 'play', PAUSED: 'paused', OVER: 'over' };

  var FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
  var shadeCache = {};

  function shade(hex, factor) {
    var key = hex + '|' + factor;
    if (shadeCache[key]) return shadeCache[key];
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * factor)));
    var g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * factor)));
    var b = Math.min(255, Math.max(0, Math.round((n & 255) * factor)));
    var out = 'rgb(' + r + ',' + g + ',' + b + ')';
    shadeCache[key] = out;
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function star(ctx, cx, cy, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 === 0 ? r : r * 0.45;
      var a = -Math.PI / 2 + (i * Math.PI) / 5;
      var x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function paintStatic(city) {
    var c = document.createElement('canvas');
    c.width = city.width;
    c.height = city.height;
    var g = c.getContext('2d');
    var P = NH.PALETTE;
    g.fillStyle = P.ground;
    g.fillRect(0, 0, city.width, city.height);
    // The sea and the sand.
    g.fillStyle = P.sand;
    g.fillRect(NH.BEACH_X, 0, city.width - NH.BEACH_X, city.height);
    var grad = g.createLinearGradient(NH.WATER_X, 0, city.width, 0);
    grad.addColorStop(0, P.water);
    grad.addColorStop(1, P.waterDeep);
    g.fillStyle = grad;
    g.fillRect(NH.WATER_X, 0, city.width - NH.WATER_X, city.height);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    for (var wy = 30; wy < city.height; wy += 64) {
      g.beginPath();
      g.moveTo(NH.WATER_X + 8, wy);
      g.lineTo(NH.WATER_X + 34, wy);
      g.lineTo(NH.WATER_X + 60, wy + 6);
      g.stroke();
    }
    // Blocks: pavement border, then the block's own ground.
    for (var i = 0; i < city.blocks.length; i++) {
      var b = city.blocks[i];
      if (b.kind === 'beach') continue;
      g.fillStyle = P.sidewalk;
      g.fillRect(b.x, b.y, b.w, b.h);
      g.fillStyle = b.kind === 'park' ? P.grass : b.kind === 'parking' ? '#5a5e68' : P.blockGround;
      g.fillRect(b.x + 16, b.y + 16, b.w - 32, b.h - 32);
    }
    // Park paths.
    for (var p = 0; p < city.parks.length; p++) {
      var park = city.parks[p];
      g.fillStyle = P.parkPath;
      g.fillRect(park.x, park.y + park.h / 2 - 9, park.w, 18);
      g.fillRect(park.x + park.w / 2 - 9, park.y, 18, park.h);
      g.fillStyle = P.grassDark;
      g.fillRect(park.x + 12, park.y + 12, 26, 26);
      g.fillRect(park.x + park.w - 38, park.y + park.h - 38, 26, 26);
    }
    // The plaza fountain.
    if (city.plaza) {
      var f = city.plaza.fountain;
      g.fillStyle = '#8ecae6';
      g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#caf0f8';
      g.beginPath(); g.arc(f.x, f.y, f.r * 0.55, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#adb5bd';
      g.lineWidth = 4;
      g.beginPath(); g.arc(f.x, f.y, f.r + 3, 0, Math.PI * 2); g.stroke();
    }
    // Parking bays.
    if (city.parkingLot) {
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 2;
      for (var s = 0; s < city.parkingSpots.length; s++) {
        var spot = city.parkingSpots[s];
        g.strokeRect(spot.x - 15, spot.y - 26, 30, 52);
      }
    }
    // Roads, over everything else at ground level.
    g.fillStyle = P.asphalt;
    for (var v = 0; v < NH.ROAD.vCenters.length; v++) {
      g.fillRect(NH.ROAD.vCenters[v] - NH.ROAD.width / 2, 0, NH.ROAD.width, city.height);
    }
    for (var h = 0; h < NH.ROAD.hCenters.length; h++) {
      g.fillRect(0, NH.ROAD.hCenters[h] - NH.ROAD.width / 2, city.width, NH.ROAD.width);
    }
    // Edge lines and dashed centre lines.
    g.strokeStyle = P.asphaltEdge;
    g.lineWidth = 3;
    for (var v2 = 0; v2 < NH.ROAD.vCenters.length; v2++) {
      g.beginPath(); g.moveTo(NH.ROAD.vCenters[v2] - NH.ROAD.width / 2 + 3, 0); g.lineTo(NH.ROAD.vCenters[v2] - NH.ROAD.width / 2 + 3, city.height); g.stroke();
      g.beginPath(); g.moveTo(NH.ROAD.vCenters[v2] + NH.ROAD.width / 2 - 3, 0); g.lineTo(NH.ROAD.vCenters[v2] + NH.ROAD.width / 2 - 3, city.height); g.stroke();
    }
    g.strokeStyle = P.lane;
    g.lineWidth = 3;
    g.setLineDash([26, 30]);
    for (var v3 = 0; v3 < NH.ROAD.vCenters.length; v3++) {
      g.beginPath(); g.moveTo(NH.ROAD.vCenters[v3], 0); g.lineTo(NH.ROAD.vCenters[v3], city.height); g.stroke();
    }
    for (var h3 = 0; h3 < NH.ROAD.hCenters.length; h3++) {
      g.beginPath(); g.moveTo(0, NH.ROAD.hCenters[h3]); g.lineTo(NH.BEACH_X + 40, NH.ROAD.hCenters[h3]); g.stroke();
    }
    g.setLineDash([]);
    // Zebra crossings on all four approaches to every intersection: slim bars laid
    // along the road, repeated across its width.
    g.fillStyle = 'rgba(232,228,218,0.85)';
    for (var x = 0; x < city.intersections.length; x++) {
      var pt = city.intersections[x];
      for (var stripe = -2; stripe <= 2; stripe++) {
        var off = stripe * 17 - 3;
        g.fillRect(pt.x + off, pt.y - 84, 7, 30);
        g.fillRect(pt.x + off, pt.y + 54, 7, 30);
        g.fillRect(pt.x - 84, pt.y + off, 30, 7);
        g.fillRect(pt.x + 54, pt.y + off, 30, 7);
      }
    }
    // Buildings: a soft shadow to the south-east, the walls, then the roof furniture.
    for (var bi = 0; bi < city.buildings.length; bi++) {
      var bd = city.buildings[bi];
      g.fillStyle = 'rgba(60,40,20,0.28)';
      g.fillRect(bd.x + bd.lift * 0.5, bd.y + bd.lift * 0.7, bd.w, bd.h);
      g.fillStyle = bd.color;
      g.fillRect(bd.x, bd.y, bd.w, bd.h);
      g.fillStyle = bd.roof;
      g.fillRect(bd.x + 7, bd.y + 7, bd.w - 14, bd.h - 14);
      // A sparse grid of skylights and roof boxes, so a roof reads as a roof.
      g.fillStyle = 'rgba(255,255,255,0.17)';
      var cols = Math.floor((bd.w - 30) / 24), rows = Math.floor((bd.h - 30) / 24);
      for (var wx = 0; wx < cols; wx++) {
        for (var wy = 0; wy < rows; wy++) {
          if ((wx * 7 + wy * 13 + bi * 5) % 3 === 0) continue;
          g.fillRect(bd.x + 16 + wx * 24, bd.y + 16 + wy * 24, 11, 8);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(bd.x + bd.w - 30, bd.y + bd.h - 26, 16, 12);
    }
    // Trees and palms.
    for (var t = 0; t < city.trees.length; t++) {
      var tree = city.trees[t];
      g.fillStyle = 'rgba(60,40,20,0.25)';
      g.beginPath(); g.arc(tree.x + 4, tree.y + 5, tree.r, 0, Math.PI * 2); g.fill();
      if (tree.palm) {
        g.strokeStyle = '#2d9d5f';
        g.lineWidth = 3;
        for (var frond = 0; frond < 6; frond++) {
          var fa = (frond / 6) * Math.PI * 2;
          g.beginPath();
          g.moveTo(tree.x, tree.y);
          g.quadraticCurveTo(tree.x + Math.cos(fa) * tree.r * 0.8, tree.y + Math.sin(fa) * tree.r * 0.8 - 4,
            tree.x + Math.cos(fa) * tree.r * 1.25, tree.y + Math.sin(fa) * tree.r * 1.25 + 3);
          g.stroke();
        }
        g.fillStyle = '#8a5a2b';
        g.beginPath(); g.arc(tree.x, tree.y, 3.5, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = '#3e9c4f';
        g.beginPath(); g.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#57b368';
        g.beginPath(); g.arc(tree.x - tree.r * 0.3, tree.y - tree.r * 0.3, tree.r * 0.62, 0, Math.PI * 2); g.fill();
      }
    }
    // Lamps.
    g.fillStyle = '#5a4632';
    for (var l = 0; l < city.lamps.length; l++) g.fillRect(city.lamps[l].x - 2, city.lamps[l].y - 2, 4, 4);
    return c;
  }

  function paintMinimap(city) {
    var scale = 220 / city.width;
    var c = document.createElement('canvas');
    c.width = 220;
    c.height = Math.round(city.height * scale);
    var g = c.getContext('2d');
    g.fillStyle = '#a89e86';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = NH.PALETTE.waterDeep;
    g.fillRect(NH.WATER_X * scale, 0, c.width - NH.WATER_X * scale, c.height);
    g.fillStyle = NH.PALETTE.sand;
    g.fillRect(NH.BEACH_X * scale, 0, (NH.WATER_X - NH.BEACH_X) * scale, c.height);
    g.fillStyle = '#79c25f';
    for (var i = 0; i < city.parks.length; i++) {
      var park = city.parks[i];
      g.fillRect(park.x * scale, park.y * scale, park.w * scale, park.h * scale);
    }
    g.fillStyle = '#e8e2d2';
    for (var v = 0; v < NH.ROAD.vCenters.length; v++) {
      g.fillRect((NH.ROAD.vCenters[v] - NH.ROAD.width / 2) * scale, 0, NH.ROAD.width * scale, c.height);
    }
    for (var h = 0; h < NH.ROAD.hCenters.length; h++) {
      g.fillRect(0, (NH.ROAD.hCenters[h] - NH.ROAD.width / 2) * scale, c.width, NH.ROAD.width * scale);
    }
    return { canvas: c, scale: scale };
  }

  NH.createRenderer = function (canvas, city) {
    var ctx = canvas.getContext('2d');
    var view = { w: 1280, h: 800, dpr: 1 };
    var staticLayer = paintStatic(city);
    var minimap = paintMinimap(city);
    var beaconSprite = document.createElement('canvas');
    beaconSprite.width = 72;
    beaconSprite.height = 220;
    (function () {
      var g = beaconSprite.getContext('2d');
      var grad = g.createLinearGradient(0, 0, 0, 220);
      grad.addColorStop(0, 'rgba(255,209,102,0)');
      grad.addColorStop(1, 'rgba(255,209,102,0.5)');
      g.fillStyle = grad;
      g.fillRect(18, 0, 36, 220);
    })();

    function resize() {
      view.dpr = Math.min(1.5, window.devicePixelRatio || 1);
      view.w = window.innerWidth;
      view.h = window.innerHeight;
      canvas.width = Math.round(view.w * view.dpr);
      canvas.height = Math.round(view.h * view.dpr);
    }
    window.addEventListener('resize', resize);
    resize();

    function text(str, x, y, size, color, align, weight) {
      ctx.font = (weight || '600') + ' ' + size + 'px ' + FONT;
      ctx.fillStyle = color;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y);
    }

    function drawCar(car, time) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);
      ctx.fillStyle = 'rgba(30,20,10,0.3)';
      roundRect(ctx, -22, -9, 48, 24, 7);
      ctx.fill();
      var body = car.kind === 'police' ? '#f5f6fa' : car.color;
      ctx.fillStyle = body;
      roundRect(ctx, -24, -12, 48, 24, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (car.kind === 'police') {
        ctx.fillStyle = '#22252d';
        ctx.fillRect(-24, -12, 10, 24);
        ctx.fillRect(14, -12, 10, 24);
        var flash = Math.sin(time * 14) > 0;
        ctx.fillStyle = flash ? '#ff2e4d' : '#7a1220';
        ctx.fillRect(-4, -9, 4, 8);
        ctx.fillStyle = flash ? '#274bff' : '#ffd60a';
        ctx.fillRect(0, -9, 4, 8);
        ctx.fillStyle = flash ? '#ffd60a' : '#274bff';
        ctx.fillRect(-4, 1, 4, 8);
        ctx.fillStyle = flash ? '#7a1220' : '#ff2e4d';
        ctx.fillRect(0, 1, 4, 8);
      }
      // Cabin: windshield, roof, rear window.
      ctx.fillStyle = '#a8d8ea';
      ctx.fillRect(6, -9, 6, 18);
      ctx.fillStyle = shade(body === '#f5f6fa' ? '#dfe3ea' : body, 0.78);
      roundRect(ctx, -7, -8.5, 13, 17, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(23,28,43,0.75)';
      ctx.fillRect(-13, -8, 5, 16);
      // Wheels (the front pair turns with the steering).
      ctx.fillStyle = '#14161c';
      var wy = [-13.5, 10.5];
      ctx.fillRect(12, wy[0], 8, 3.5);
      ctx.fillRect(12, wy[1], 8, 3.5);
      ctx.fillRect(-19, wy[0], 8, 3.5);
      ctx.fillRect(-19, wy[1], 8, 3.5);
      // Lights.
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(23, -9, 2.5, 4);
      ctx.fillRect(23, 5, 2.5, 4);
      ctx.fillStyle = '#e63946';
      ctx.fillRect(-25.5, -9, 2.5, 4);
      ctx.fillRect(-25.5, 5, 2.5, 4);
      if (car.health <= 0) {
        ctx.fillStyle = 'rgba(20,20,25,0.45)';
        roundRect(ctx, -24, -12, 48, 24, 7);
        ctx.fill();
      }
      ctx.restore();
      if (car.missionCar) {
        ctx.strokeStyle = 'rgba(255,209,102,' + (0.65 + 0.35 * Math.sin(time * 6)) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(car.x, car.y, 34 + 3 * Math.sin(time * 6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function drawPerson(x, y, angle, shirt, headColor, down) {
      ctx.fillStyle = 'rgba(30,20,10,0.25)';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 4, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (down) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle + Math.PI / 2);
        ctx.fillStyle = shirt;
        ctx.beginPath(); ctx.ellipse(0, 0, 13, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = headColor;
        ctx.beginPath(); ctx.arc(13, 0, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return;
      }
      ctx.fillStyle = shirt;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = headColor;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * 3.5, y + Math.sin(angle) * 3.5, 4.6, 0, Math.PI * 2);
      ctx.fill();
    }

    function objectiveText(state) {
      var m = state.mission;
      if (!m) return null;
      var label = m.target ? m.target.label : '';
      switch (m.kind) {
        case 'reach': return 'Get to ' + label;
        case 'package': return m.stage === 0 ? 'Pick up the package at ' + label + ' (on foot)' : 'Deliver the package to ' + label;
        case 'steal': return m.stage === 0 ? 'Take the ' + label : 'Deliver it to ' + label + ' in one piece';
        case 'checkpoints': return 'Checkpoint ' + (m.cpIndex + 1) + ' of ' + m.checkpoints.length;
        case 'escape': return m.layLow > 0 ? 'Laying low… hold on' : 'Reach ' + label + ' and lay low';
        default: return label;
      }
    }

    function drawWorld(state, screen) {
      var p = state.player.inCar || state.player;
      var vw = view.w, vh = view.h;
      var lookX = (p.vx || 0) * 0.32, lookY = (p.vy || 0) * 0.32;
      var camX = p.x + lookX - vw / 2;
      var camY = p.y + lookY - vh / 2;
      if (vw < city.width) camX = Math.max(0, Math.min(city.width - vw, camX)); else camX = (city.width - vw) / 2;
      if (vh < city.height) camY = Math.max(0, Math.min(city.height - vh, camY)); else camY = (city.height - vh) / 2;
      var shX = state.shake ? (Math.random() - 0.5) * state.shake : 0;
      var shY = state.shake ? (Math.random() - 0.5) * state.shake : 0;
      camX += shX; camY += shY;

      ctx.fillStyle = '#157f9e';
      ctx.fillRect(0, 0, vw, vh);
      ctx.save();
      ctx.translate(-camX, -camY);
      var sx0 = Math.max(0, camX), sy0 = Math.max(0, camY);
      var sx1 = Math.min(city.width, camX + vw), sy1 = Math.min(city.height, camY + vh);
      if (sx1 > sx0 && sy1 > sy0) {
        ctx.drawImage(staticLayer, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0, sy0, sx1 - sx0, sy1 - sy0);
      }

      var time = state.time;
      // Cash pickups.
      for (var i = 0; i < state.pickups.length; i++) {
        var pk = state.pickups[i];
        var bob = Math.sin(time * 4 + pk.x) * 2.5;
        ctx.fillStyle = 'rgba(46,204,113,0.3)';
        ctx.beginPath(); ctx.arc(pk.x, pk.y + bob, 13 + 2 * Math.sin(time * 4), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2ecc71';
        roundRect(ctx, pk.x - 8, pk.y - 5 + bob, 16, 10, 2);
        ctx.fill();
        ctx.fillStyle = '#eaffea';
        ctx.font = '700 9px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText('$', pk.x, pk.y + 3 + bob);
      }
      // The objective beacon.
      var m = state.mission;
      if (m && m.target && screen !== NH.SCREEN.TITLE) {
        var t = m.target;
        ctx.drawImage(beaconSprite, t.x - 36, t.y - 220);
        ctx.strokeStyle = 'rgba(255,209,102,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.x, t.y, 30 + 5 * Math.sin(time * 5), 0, Math.PI * 2); ctx.stroke();
        if (m.kind === 'escape' && m.layLow > 0) {
          ctx.strokeStyle = '#7dff8a';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 40, -Math.PI / 2, -Math.PI / 2 + (m.layLow / 4) * Math.PI * 2);
          ctx.stroke();
        }
        if (m.kind === 'package' && m.stage === 0) {
          ctx.fillStyle = '#ffd166';
          roundRect(ctx, t.x - 9, t.y - 9, 18, 18, 3);
          ctx.fill();
          ctx.strokeStyle = '#8a5a2b';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      // People, then cars, then the player.
      for (var j = 0; j < state.peds.length; j++) {
        var ped = state.peds[j];
        drawPerson(ped.x, ped.y, ped.angle, ped.color, '#f1c27d', ped.state === 'down');
      }
      for (var k = 0; k < state.cars.length; k++) drawCar(state.cars[k], time);
      if (!state.player.inCar) {
        var pl = state.player;
        var blink = pl.invulnT > 0 && Math.floor(time * 12) % 2 === 0;
        if (!blink) drawPerson(pl.x, pl.y, pl.angle, '#00b8a9', '#f1c27d', false);
      } else {
        // A bobbing marker over the player's car.
        var pc = state.player.inCar;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        var by = pc.y - 30 + Math.sin(time * 5) * 3;
        ctx.moveTo(pc.x - 7, by - 10);
        ctx.lineTo(pc.x + 7, by - 10);
        ctx.lineTo(pc.x, by);
        ctx.closePath();
        ctx.fill();
      }
      // Particles.
      for (var n = 0; n < state.particles.length; n++) {
        var pt = state.particles[n];
        ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      }
      ctx.globalAlpha = 1;
      // Floating texts (cash, payouts).
      ctx.textAlign = 'center';
      for (var f = 0; f < state.floaters.length; f++) {
        var fl = state.floaters[f];
        ctx.globalAlpha = Math.min(1, fl.life);
        text(fl.text, fl.x, fl.y, 17, fl.color, 'center', '800');
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      return { camX: camX, camY: camY };
    }

    function drawMinimap(state) {
      var mw = 220, mh = minimap.canvas.height;
      var x = 14, y = view.h - mh - 14;
      ctx.fillStyle = 'rgba(10,12,20,0.55)';
      roundRect(ctx, x - 4, y - 4, mw + 8, mh + 8, 8);
      ctx.fill();
      ctx.drawImage(minimap.canvas, x, y);
      var s = minimap.scale;
      function dot(wx, wy, color, r) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x + wx * s, y + wy * s, r, 0, Math.PI * 2); ctx.fill();
      }
      for (var i = 0; i < state.cars.length; i++) {
        var car = state.cars[i];
        if (car.kind === 'police' && car !== state.player.inCar) dot(car.x, car.y, '#ff4757', 2.6);
        else if (car.missionCar) dot(car.x, car.y, '#ffd166', 3);
      }
      if (state.mission && state.mission.target) {
        var t = state.mission.target;
        if (Math.sin(state.time * 5) > -0.4) dot(t.x, t.y, '#ffd166', 3.6);
        ctx.strokeStyle = 'rgba(255,209,102,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x + t.x * s, y + t.y * s, 6, 0, Math.PI * 2); ctx.stroke();
      }
      var p = state.player.inCar || state.player;
      dot(p.x, p.y, '#ffffff', 3.4);
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x + p.x * s, y + p.y * s);
      ctx.lineTo(x + (p.x + Math.cos(p.angle) * 26) * s, y + (p.y + Math.sin(p.angle) * 26) * s);
      ctx.stroke();
      text('PORT SOLANO', x + 4, y + mh + 16, 10, 'rgba(255,255,255,0.75)', 'left', '700');
    }

    function drawHud(state, opts) {
      // Money and errands, top-left.
      ctx.fillStyle = 'rgba(10,12,20,0.5)';
      roundRect(ctx, 12, 12, 218, 64, 10);
      ctx.fill();
      text('$ ' + state.money.toLocaleString('en-US'), 24, 48, 30, '#7dff8a', 'left', '800');
      text('ERRANDS DONE  ' + state.missionsDone, 24, 68, 12.5, '#e8e4da', 'left', '700');
      // Wanted stars, top-right.
      for (var i = 0; i < NH.WANTED.max; i++) {
        var cx = view.w - 30 - i * 34;
        ctx.save();
        if (i < state.wanted) {
          ctx.shadowColor = '#ffd60a';
          ctx.shadowBlur = 10;
          ctx.fillStyle = '#ffd60a';
        } else ctx.fillStyle = 'rgba(255,255,255,0.22)';
        star(ctx, cx, 34, 13);
        ctx.fill();
        ctx.restore();
      }
      // Health (or the car's health) under the stars.
      var inCar = !!state.player.inCar;
      var frac = inCar ? state.player.inCar.health / state.player.inCar.maxHealth
        : state.player.health / NH.PLAYER.health;
      var bw = 168;
      ctx.fillStyle = 'rgba(10,12,20,0.5)';
      roundRect(ctx, view.w - bw - 16, 54, bw + 8, 22, 6);
      ctx.fill();
      ctx.fillStyle = frac > 0.35 ? '#2ecc71' : '#e63946';
      roundRect(ctx, view.w - bw - 12, 58, Math.max(0, bw * frac), 14, 4);
      ctx.fill();
      text(inCar ? 'CAR' : 'HEALTH', view.w - bw - 12, 50, 10.5, '#e8e4da', 'left', '700');
      // The bust meter, when the police have nearly got the player.
      if (state.bust > 0.02 && !state.over) {
        var bx = view.w / 2 - 130;
        ctx.fillStyle = 'rgba(10,12,20,0.6)';
        roundRect(ctx, bx - 6, 96, 272, 30, 8);
        ctx.fill();
        ctx.fillStyle = '#ff2e4d';
        roundRect(ctx, bx, 102, 260 * state.bust, 18, 5);
        ctx.fill();
        text('BUSTED?', view.w / 2, 116, 13, '#ffffff', 'center', '800');
      }
      // The mission panel, top-centre.
      var obj = objectiveText(state);
      if (obj && !state.over) {
        var m = state.mission;
        var dist = m.target ? Math.round(Math.hypot(m.target.x - (state.player.inCar || state.player).x, m.target.y - (state.player.inCar || state.player).y) / 10) : 0;
        ctx.fillStyle = 'rgba(10,12,20,0.55)';
        roundRect(ctx, view.w / 2 - 250, 12, 500, m.totalTime > 0 ? 66 : 56, 10);
        ctx.fill();
        text(m.title.toUpperCase(), view.w / 2, 36, 13, '#ffd166', 'center', '800');
        text(obj + '  ·  ' + dist + 'm', view.w / 2, 58, 15.5, '#ffffff', 'center', '600');
        if (m.totalTime > 0) {
          var tf = Math.max(0, m.timeLeft / m.totalTime);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          roundRect(ctx, view.w / 2 - 240, 66, 480, 6, 3);
          ctx.fill();
          ctx.fillStyle = tf > 0.3 ? '#ffd166' : '#ff2e4d';
          roundRect(ctx, view.w / 2 - 240, 66, 480 * tf, 6, 3);
          ctx.fill();
        }
      } else if (!state.mission && !state.over && state.missionsDone >= 0) {
        text('Marisol is typing…', view.w / 2, 34, 13, 'rgba(255,255,255,0.65)', 'center', '600');
      }
      // Toasts: mission briefs and verdicts from the world.
      var toast = state.toastData;
      if (toast && state.time < toast.until) {
        var remain = toast.until - state.time;
        ctx.globalAlpha = Math.min(1, remain / 0.5);
        ctx.fillStyle = 'rgba(10,12,20,0.62)';
        roundRect(ctx, view.w / 2 - 330, 118, 660, 74, 12);
        ctx.fill();
        text(toast.title, view.w / 2, 148, 21, '#ffd166', 'center', '800');
        text(toast.sub, view.w / 2, 176, 14.5, '#f1f1f1', 'center', '600');
        ctx.globalAlpha = 1;
      }
      drawMinimap(state);
      // Controls hint, bottom-right.
      var hint = opts.inCar
        ? 'W A S D drive · SPACE handbrake · E get out · P pause'
        : 'W A S D move · SHIFT sprint · J punch · E enter car · P pause';
      text(hint, view.w - 16, view.h - 16, 12.5, 'rgba(255,255,255,0.66)', 'right', '600');
      if (opts.muted) text('MUTED (M)', view.w - 16, view.h - 36, 12.5, 'rgba(255,255,255,0.66)', 'right', '700');
    }

    function drawTitle(state, opts) {
      var grad = ctx.createLinearGradient(0, 0, 0, view.h);
      grad.addColorStop(0, 'rgba(43,16,64,0.30)');
      grad.addColorStop(0.55, 'rgba(43,16,64,0.45)');
      grad.addColorStop(1, 'rgba(20,8,36,0.86)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.save();
      ctx.shadowColor = '#ff2e88';
      ctx.shadowBlur = 26;
      text('NEON HARBOR', view.w / 2, view.h * 0.30, 76, '#ffe66d', 'center', '900');
      ctx.restore();
      text('N I G H T S', view.w / 2, view.h * 0.30 + 52, 30, '#7bf1ff', 'center', '800');
      text('An open-world crime spree in the city of Port Solano', view.w / 2, view.h * 0.30 + 88, 17, '#f5f0e6', 'center', '600');
      var lines = [
        'You are Rook, a courier with quick hands and no licence to show for them.',
        'Fixer Marisol Vega feeds you errands by the hour: packages, borrowed cars,',
        'checkpoint runs and hot nights. Finish them, bank the cash, and whatever',
        'you do — do not let the Port Solano police hold you still.',
      ];
      for (var i = 0; i < lines.length; i++) {
        text(lines[i], view.w / 2, view.h * 0.30 + 128 + i * 23, 15.5, 'rgba(245,240,230,0.92)', 'center', '500');
      }
      var controls = 'W A S D / arrows — move & drive      E — enter / leave a car      SHIFT — sprint      SPACE — handbrake';
      var controls2 = 'J — punch (mugging pays)      P — pause      M — sound on/off      R — restart a finished run';
      text(controls, view.w / 2, view.h * 0.30 + 244, 14.5, '#ffd166', 'center', '700');
      text(controls2, view.w / 2, view.h * 0.30 + 268, 14.5, '#ffd166', 'center', '700');
      if (Math.sin(state.time * 3.4) > -0.3) {
        text(opts.hasSave ? 'Press ENTER to continue your run — N for a fresh start' : 'Press ENTER or click to start',
          view.w / 2, view.h * 0.30 + 316, 19, '#7dff8a', 'center', '800');
      }
      if (opts.best > 0) text('Best score so far: ' + opts.best.toLocaleString('en-US'), view.w / 2, view.h * 0.30 + 348, 14, 'rgba(255,255,255,0.75)', 'center', '600');
      if (opts.hasSave) text('Saved run: $' + opts.saveMoney.toLocaleString('en-US') + ' · ' + opts.saveMissions + ' errands done', view.w / 2, view.h * 0.30 + 372, 14, 'rgba(255,255,255,0.75)', 'center', '600');
    }

    function drawOver(state, opts) {
      var busted = state.over === 'busted';
      ctx.fillStyle = busted ? 'rgba(16,20,54,0.66)' : 'rgba(54,8,14,0.66)';
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.save();
      ctx.shadowColor = busted ? '#4d7cff' : '#ff2e4d';
      ctx.shadowBlur = 22;
      text(busted ? 'BUSTED' : 'WASTED', view.w / 2, view.h * 0.36, 72, busted ? '#a9c2ff' : '#ff8fa3', 'center', '900');
      ctx.restore();
      var score = state.money + state.missionsDone * 150;
      var lines = [
        busted ? 'The Port Solano police finally held you still.' : 'Port Solano keeps your car. And your shoes.',
        '',
        'Cash banked:  $' + state.money.toLocaleString('en-US'),
        'Errands done:  ' + state.missionsDone + '   ·   Cars taken:  ' + state.stats.stolen + '   ·   Muggings:  ' + state.stats.muggings,
        'Final score:  ' + score.toLocaleString('en-US') + (opts.best > 0 ? '      Best:  ' + Math.max(opts.best, score).toLocaleString('en-US') : ''),
      ];
      for (var i = 0; i < lines.length; i++) {
        text(lines[i], view.w / 2, view.h * 0.36 + 52 + i * 27, i === 0 ? 16.5 : 17, '#f5f0e6', 'center', i >= 2 ? '700' : '500');
      }
      if (Math.sin(state.time * 3.4) > -0.3) {
        text('Press R or ENTER to run it back', view.w / 2, view.h * 0.36 + 52 + lines.length * 27 + 22, 18, '#7dff8a', 'center', '800');
      }
    }

    function draw(state, screen, opts) {
      opts = opts || {};
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      drawWorld(state, screen);
      if (screen === NH.SCREEN.TITLE) { drawTitle(state, opts); return; }
      drawHud(state, opts);
      if (screen === NH.SCREEN.PAUSED) {
        ctx.fillStyle = 'rgba(12,10,24,0.55)';
        ctx.fillRect(0, 0, view.w, view.h);
        text('PAUSED', view.w / 2, view.h * 0.44, 44, '#ffe66d', 'center', '900');
        text('Press P to keep driving', view.w / 2, view.h * 0.44 + 38, 16, '#f5f0e6', 'center', '600');
      } else if (screen === NH.SCREEN.OVER) {
        drawOver(state, opts);
      }
    }

    return { draw: draw, view: view };
  };
})();

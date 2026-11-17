// Neon Harbor Nights — shared constants: world geometry, the palette and the tuning numbers
// every other file reads. One job: say how big Port Solano is and how fast things move.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  NH.GAME_TITLE = 'Neon Harbor Nights';
  NH.STEP = 1 / 60; // the fixed simulation step, in seconds

  // The city: a grid of avenues (vertical) and streets (horizontal), a beach and the sea
  // along the east edge. Coordinates are pixels, origin at the north-west corner.
  NH.WORLD = { width: 3520, height: 2640 };
  NH.ROAD = {
    width: 104,
    vCenters: [300, 860, 1420, 1980, 2540, 3100],
    hCenters: [280, 800, 1320, 1840, 2360],
  };
  NH.BEACH_X = 3200; // sand starts here
  NH.WATER_X = 3380; // the sea starts here; nothing drives or walks into it

  NH.PLAYER = {
    radius: 11,
    walkSpeed: 168,
    sprintSpeed: 252,
    health: 100,
    punchRange: 38,
    punchCooldown: 0.45,
  };

  // Car archetypes: top speed and acceleration in px and px/s, grip scales the turn rate.
  NH.CAR_KINDS = {
    compact: { topSpeed: 320, accel: 300, grip: 1.0, health: 100 },
    sedan: { topSpeed: 355, accel: 320, grip: 0.95, health: 120 },
    sport: { topSpeed: 430, accel: 420, grip: 1.1, health: 90 },
    police: { topSpeed: 445, accel: 430, grip: 1.12, health: 160 },
  };
  NH.CAR = { length: 48, width: 24, turnRate: 2.5, reverseSpeed: 120 };

  NH.WANTED = {
    max: 5,
    escapeSeconds: 5, // unseen this long, one star cools off
    sightRange: 430, // police work on the player's position inside this range
    bustRange: 66, // a police car this close to a slow player fills the bust meter
    bustSeconds: 2.2,
  };

  NH.STORAGE = {
    best: 'neon-harbor-best',
    save: 'neon-harbor-save',
    muted: 'neon-harbor-muted',
  };

  // Sun-soaked, neon-kissed palette.
  NH.PALETTE = {
    ground: '#c8bfa9',
    blockGround: '#bfb59e',
    sidewalk: '#ddd5c2',
    asphalt: '#41454f',
    asphaltEdge: '#33363e',
    lane: '#e6cf6b',
    crosswalk: '#e8e4da',
    grass: '#79c25f',
    grassDark: '#63ab4c',
    sand: '#f0d48c',
    water: '#1fa8bf',
    waterDeep: '#157f9e',
    parkPath: '#e3d3a8',
  };

  NH.BUILDING_COLORS = [
    '#ff9e7d', '#ffc46b', '#fff3b0', '#a0e7a0', '#7fd8e0', '#90b8ff',
    '#d3a6ff', '#ff8fb2', '#f7f0e1', '#ffb59e', '#9fe0c5', '#f9e08a',
  ];
  NH.CAR_COLORS = ['#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#ecf0f1', '#9b59b6', '#1abc9c', '#e67e22', '#fd79a8', '#95a5a6'];
  NH.PED_COLORS = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#f368e0', '#ff9f43', '#54a0ff', '#5f27cd', '#c8d6e5', '#8395a7'];
})();

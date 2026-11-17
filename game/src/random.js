// A small seeded random number generator (mulberry32): the same seed always grows the same
// city and the same run, which is what makes the staged screenshots reproducible.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  NH.createRandom = function (seed) {
    var state = (seed >>> 0) || 1;
    function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      range: function (min, max) { return min + next() * (max - min); },
      int: function (min, max) { return Math.floor(min + next() * (max - min + 1)); },
      pick: function (list) { return list[Math.floor(next() * list.length)]; },
      chance: function (p) { return next() < p; },
    };
  };
})();

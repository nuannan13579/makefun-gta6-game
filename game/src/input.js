// Keyboard and pointer input. Held keys drive movement and driving; one-shot presses are
// queued as bit flags and taken once by the loop, so a press between frames is never lost
// and never counted twice.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  NH.ACTION = { CONFIRM: 1, PAUSE: 2, INTERACT: 4, PUNCH: 8, RESTART: 16, MUTE: 32, CONTINUE: 64, NEWGAME: 128 };

  var UP = { ArrowUp: 1, KeyW: 1 };
  var DOWN = { ArrowDown: 1, KeyS: 1 };
  var LEFT = { ArrowLeft: 1, KeyA: 1 };
  var RIGHT = { ArrowRight: 1, KeyD: 1 };

  NH.createInput = function (target) {
    var held = {};
    var actions = 0;

    window.addEventListener('keydown', function (event) {
      held[event.code] = true;
      if (!event.repeat) {
        if (event.code === 'Enter' || event.code === 'Space') actions |= NH.ACTION.CONFIRM;
        else if (event.code === 'KeyP' || event.code === 'Escape') actions |= NH.ACTION.PAUSE;
        else if (event.code === 'KeyE' || event.code === 'KeyF') actions |= NH.ACTION.INTERACT;
        else if (event.code === 'KeyJ') actions |= NH.ACTION.PUNCH;
        else if (event.code === 'KeyR') actions |= NH.ACTION.RESTART;
        else if (event.code === 'KeyM') actions |= NH.ACTION.MUTE;
        else if (event.code === 'KeyC') actions |= NH.ACTION.CONTINUE;
        else if (event.code === 'KeyN') actions |= NH.ACTION.NEWGAME;
      }
      if (UP[event.code] || DOWN[event.code] || LEFT[event.code] || RIGHT[event.code] || event.code === 'Space') {
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', function (event) { held[event.code] = false; });
    // A key released while the tab is hidden never sends keyup: let go of everything on blur.
    window.addEventListener('blur', function () { held = {}; });
    target.addEventListener('pointerdown', function () { actions |= NH.ACTION.CONFIRM; });

    function anyKey(map) {
      for (var code in map) if (held[code]) return true;
      return false;
    }

    return {
      // Foot movement axes, each -1, 0 or 1 (the world normalises diagonals).
      axisX: function () { return (anyKey(RIGHT) ? 1 : 0) - (anyKey(LEFT) ? 1 : 0); },
      axisY: function () { return (anyKey(DOWN) ? 1 : 0) - (anyKey(UP) ? 1 : 0); },
      // Driving: throttle 1 is forward, -1 is brake/reverse; steer -1 left, 1 right.
      throttle: function () { return (anyKey(UP) ? 1 : 0) - (anyKey(DOWN) ? 1 : 0); },
      steer: function () { return (anyKey(RIGHT) ? 1 : 0) - (anyKey(LEFT) ? 1 : 0); },
      handbrake: function () { return !!held['Space']; },
      sprint: function () { return !!(held['ShiftLeft'] || held['ShiftRight']); },
      punchHeld: function () { return !!held['KeyJ'] || !!held['Space']; },
      takeActions: function () {
        var taken = actions;
        actions = 0;
        return taken;
      },
    };
  };
})();

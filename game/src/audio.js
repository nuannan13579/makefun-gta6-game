// Tiny WebAudio synth: pickup blips, a crash thud, a two-tone siren and a low engine hum,
// all made from oscillators and noise — no audio files. Everything is guarded: with no
// AudioContext (a headless browser, an old one) every call is a silent no-op, and the
// context is only ever created after a user gesture.
(function () {
  'use strict';
  var NH = window.NH = window.NH || {};

  NH.createAudio = function () {
    var ctx = null;
    var master = null;
    var muted = false;
    var siren = null;
    var engine = null;

    function ensure() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return true;
      }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ctx.destination);
        return true;
      } catch (e) {
        return false;
      }
    }

    function tone(freq, dur, type, vol, delay, slideTo) {
      if (!ensure()) return;
      try {
        var t0 = ctx.currentTime + (delay || 0);
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      } catch (e) { /* sound is decoration; never break the game for it */ }
    }

    function noise(dur, vol, cutoff) {
      if (!ensure()) return;
      try {
        var length = Math.max(1, Math.floor(ctx.sampleRate * dur));
        var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        var data = buffer.getChannelData(0);
        for (var i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
        var src = ctx.createBufferSource();
        src.buffer = buffer;
        var filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff;
        var gain = ctx.createGain();
        gain.gain.value = vol;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start();
      } catch (e) { /* as above */ }
    }

    return {
      unlock: function () { ensure(); },
      setMuted: function (value) {
        muted = value;
        if (master) master.gain.value = value ? 0 : 0.5;
      },
      isMuted: function () { return muted; },
      pickup: function () { tone(880, 0.07, 'square', 0.10); tone(1318, 0.1, 'square', 0.09, 0.05); },
      cash: function () { tone(1046, 0.06, 'triangle', 0.12); tone(1568, 0.08, 'triangle', 0.1, 0.04); },
      punch: function () { noise(0.08, 0.22, 900); },
      crash: function (strength) { noise(0.2, Math.min(0.5, 0.16 + strength * 0.3), 420); tone(64, 0.22, 'sine', 0.3); },
      steal: function () { tone(392, 0.08, 'square', 0.1); tone(587, 0.1, 'square', 0.1, 0.07); },
      success: function () { tone(523, 0.1, 'triangle', 0.14); tone(659, 0.1, 'triangle', 0.14, 0.09); tone(784, 0.16, 'triangle', 0.14, 0.18); },
      fail: function () { tone(233, 0.16, 'sawtooth', 0.1); tone(155, 0.24, 'sawtooth', 0.1, 0.14); },
      busted: function () { tone(660, 0.14, 'square', 0.12); tone(660, 0.14, 'square', 0.12, 0.2); tone(440, 0.3, 'square', 0.12, 0.4); },
      setSiren: function (on) {
        if (!on) {
          if (siren) {
            try { siren.osc.stop(); siren.lfo.stop(); } catch (e) { /* already stopped */ }
            siren = null;
          }
          return;
        }
        if (siren || !ensure()) return;
        try {
          var osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = 800;
          var lfo = ctx.createOscillator();
          lfo.type = 'square';
          lfo.frequency.value = 0.8;
          var lfoGain = ctx.createGain();
          lfoGain.gain.value = 160;
          lfo.connect(lfoGain);
          lfoGain.connect(osc.frequency);
          var gain = ctx.createGain();
          gain.gain.value = 0.028;
          osc.connect(gain);
          gain.connect(master);
          osc.start();
          lfo.start();
          siren = { osc: osc, lfo: lfo };
        } catch (e) { siren = null; }
      },
      setEngine: function (on, ratio) {
        if (!on) {
          if (engine) {
            try { engine.osc.stop(); } catch (e) { /* already stopped */ }
            engine = null;
          }
          return;
        }
        if (!ensure()) return;
        try {
          if (!engine) {
            var osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            var filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 300;
            var gain = ctx.createGain();
            gain.gain.value = 0.018;
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(master);
            osc.start();
            engine = { osc: osc };
          }
          engine.osc.frequency.value = 52 + 130 * Math.max(0, Math.min(1, ratio));
        } catch (e) { engine = null; }
      },
    };
  };
})();

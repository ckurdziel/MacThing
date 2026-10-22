import { watch } from 'vue';
import { state, CT } from './state.js';
import { timer } from './timer.js';

// Settings → Cycle screens: while nothing is playing, step through the four screens on the top
// buttons in the order their buttons run (CT.slots()), one every rotateSeconds. A press or a knob
// turn holds it off for a while, so the screen you're using doesn't slide away under you. Music
// starting brings Now Playing back, unless you picked the screen that's up. It never moves off
// Settings, a screen on no button, a meeting alert or reminder, a timer that's going, or the
// screen the device is held on while the Mac is locked.
var INPUT_HOLD_MS = 60000; // after any input, wait at least this long before moving on

var countdown = null;
var lastInput = 0;
var autoScreen = ''; // the screen this moved to, until someone navigates

function intervalMs() { return (state.settings.rotateSeconds || 0) * 1000; }
function playing() { return !!(state.np.active && state.np.playing); }
function rotatable() { return intervalMs() > 0 && !playing() && CT.slots().indexOf(state.current) >= 0; }
function busy() {
  return (CT.modalOpen && CT.modalOpen()) || !!CT.lockedTo || state.asleep || state.offline ||
    timer.status === 'running' || timer.status === 'paused' || timer.status === 'done';
}

function arm() {
  clearTimeout(countdown);
  countdown = null;
  if (!rotatable()) return;
  var wait = Math.max(intervalMs(), lastInput + INPUT_HOLD_MS - Date.now());
  countdown = setTimeout(fire, wait);
}

function fire() {
  countdown = null;
  if (!rotatable()) return;
  if (busy()) return arm(); // look again after another interval
  var order = CT.slots();
  var next = order[(order.indexOf(state.current) + 1) % order.length];
  if (!CT.screens[next]) return arm();
  autoScreen = next;
  CT.show(next);
}

watch(playing, function (on) {
  if (on && autoScreen && state.current === autoScreen && autoScreen !== 'nowplaying') CT.show('nowplaying');
  if (on) autoScreen = '';
  arm();
});
watch(function () { return state.current; }, function (current) {
  if (current !== autoScreen) autoScreen = ''; // someone (or something) else moved the screen
  arm();
});
watch([function () { return state.settings.rotateSeconds; }, function () { return CT.slots().join(); }], arm);

// A top or settings button on the screen this put up counts as choosing it, so music won't take
// it away again.
CT.on('input', function (key) {
  lastInput = Date.now();
  if (autoScreen && /^[1-4m]$/.test(key)) autoScreen = '';
  arm();
});

arm();

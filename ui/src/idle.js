import { watch } from 'vue';
import { state, CT } from './state.js';
import { timer } from './timer.js';

// Settings → When idle: once nothing has played for idleMinutes while Now Playing is up, show
// idleScreen instead (the clock, by default). Music starting again brings Now Playing back, as
// long as nobody has moved off the screen this put up. Only ever leaves Now Playing, and never
// over Settings, a meeting alert or a timer that's going. Cycle screens (rotate.js) takes over
// while it's on.
const RETRY_MS = 30000; // something was in the way: look again in a bit

var countdown = null;
var autoScreen = ''; // the screen this switched to, until someone navigates

function playing() { return !!(state.np.active && state.np.playing); }

function arm() {
  clearTimeout(countdown);
  countdown = null;
  var minutes = state.settings.idleMinutes;
  if (!minutes || state.settings.rotateSeconds || playing() || state.current !== 'nowplaying') return;
  countdown = setTimeout(fire, minutes * 60000);
}

function fire() {
  countdown = null;
  if (playing() || state.current !== 'nowplaying' || !state.settings.idleMinutes || state.settings.rotateSeconds) return;
  var busy = (CT.modalOpen && CT.modalOpen()) || timer.status === 'running' || timer.status === 'paused' || timer.status === 'done';
  if (busy) { countdown = setTimeout(fire, RETRY_MS); return; }
  var target = state.settings.idleScreen || 'clock';
  if (!CT.screens[target]) return;
  autoScreen = target;
  CT.show(target);
}

watch(playing, function (on) {
  if (on && autoScreen && state.current === autoScreen) CT.show('nowplaying');
  if (on) autoScreen = '';
  arm();
});
watch(function () { return state.current; }, function (current) {
  if (current !== autoScreen) autoScreen = ''; // someone (or something) else moved the screen
  arm();
});
watch(function () { return [state.settings.idleMinutes, state.settings.rotateSeconds]; }, arm);

// Any input starts the countdown over. A top or settings button on the screen this put up
// (pressing it again, say) counts as choosing it, so music won't take it away again.
CT.on('input', function (key) {
  if (autoScreen && /^[1-4m]$/.test(key)) autoScreen = '';
  arm();
});

arm();

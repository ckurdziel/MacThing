/* Shared runtime for every screen: the channel to the Mac, the Mac's clock, screen switching,
 * hardware input and the volume readout. Screens register with CT.screen(name) and listen for
 * bridge messages with CT.on(type, fn).
 *
 * Bundled by Vite for Chromium 69. Vue owns rendering; this module owns input and transport.
 * The page never talks to the network; the Mac bridge drives it over Chrome DevTools Protocol:
 *   Mac → page: window.__carthingReceive(msg)
 *   page → Mac: window.__carthingSend(json)  (a CDP binding; console.debug is the fallback)
 */
export function initializeRuntime(state) {
  'use strict';

  var CT = (window.CT = {});
  CT.app = null; // assigned after Vue mounts; retained for device diagnostics

  // Replaced by the bridge's config/settings on connect; these just let the page render before that.
  CT.config = {
    buttons: { 1: 'screen:nowplaying', 2: 'screen:calendar', 3: 'screen:weather', 4: 'screen:clock', m: 'settings', Escape: 'favorite' },
    buttonClicks: { Escape: { 1: 'favorite', 2: 'unfavorite' } },
    knobClicks: { 1: 'playpause', 2: 'next', 3: 'previous' },
    buttonHolds: { m: 'sleep' }, holdMs: 1200, offlineSleepMs: 90000,
    multiClickMs: 350, volumeStep: 1 / 16, knobDirection: 1, debug: false
  };
  Object.defineProperty(CT, 'settings', { get: function () { return state.settings; } });

  var listeners = {};
  CT.on = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); };
  function emit(type, arg) {
    var fns = listeners[type] || [];
    for (var i = 0; i < fns.length; i++) fns[i](arg);
  }
  CT.emit = emit; // for page-local events (e.g. 'art' from Now Playing)

  // ---- Channel to the Mac ------------------------------------------------------------

  CT.send = function (msg) {
    var json = JSON.stringify(msg);
    if (typeof window.__carthingSend === 'function') window.__carthingSend(json);
    else console.debug('⁣carthing ' + json);
  };

  var connected = false;
  var gotConfig = false;
  var lastMsgAt = 0;

  window.__carthingReceive = function (msg) {
    lastMsgAt = performance.now();
    if (msg.type === 'bye') return setConnected(false);
    setConnected(true);
    if (msg.type === 'config') { CT.config = msg.config; gotConfig = true; restoreDevScreen(); }
    else if (msg.type === 'tick') { syncClock(msg.now - Date.now()); clock.tz = msg.tzMinutes || 0; }
    else if (msg.type === 'settings') state.settings = msg.settings;
    else if (msg.type === 'appearance') macDark = msg.dark;
    if (msg.type === 'settings' || msg.type === 'appearance') applyTheme();
    emit(msg.type, msg);
  };

  // Appearance: dark | light | auto (follow the Mac's Dark Mode).
  var macDark = true;
  function applyTheme() {
    var theme = CT.settings.theme || 'dark';
    state.light = theme === 'light' || (theme === 'auto' && !macDark);
  }
  CT.applyTheme = applyTheme;

  var offlineSince = 0; // when the Mac was last seen; 0 means "not since this page loaded"
  function setConnected(on) {
    if (on !== connected) offlineSince = on ? 0 : performance.now();
    if (on && !connected) opening = true;
    if (!on) CT.lockedTo = null; // no Mac to say it's still locked; it says again on reconnecting
    connected = on;
    state.offline = !on;
  }

  // ---- Time (the device clock is never set, so everything uses the Mac's) -------------

  var clock = { offset: 0, tz: 0 };
  CT.now = function () { return Date.now() + clock.offset; };
  // Each tick reaches the device a little late, and by a different amount each time, so taking
  // every one as-is makes the clock jump back and forth by that much every two seconds — enough
  // for a countdown to show some seconds twice. A late tick only ever makes the Mac look behind,
  // so keep the least-delayed reading of the last fifteen (half a minute, which still follows
  // the Mac if its clock is changed).
  var offsets = [];
  function syncClock(offset) {
    offsets.push(offset);
    if (offsets.length > 15) offsets.shift();
    clock.offset = Math.max.apply(null, offsets);
  }
  CT.DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  CT.MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /** Calendar fields of epoch ms in a timezone (minutes east of UTC; defaults to the Mac's). */
  CT.parts = function (ms, tzMinutes) {
    var d = new Date(ms + (tzMinutes == null ? clock.tz : tzMinutes) * 60000);
    return {
      year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), day: d.getUTCDay(),
      hours: d.getUTCHours(), minutes: d.getUTCMinutes(), seconds: d.getUTCSeconds()
    };
  };
  /** Days since the epoch in a timezone — for "is this today / tomorrow". */
  CT.dayNumber = function (ms, tzMinutes) {
    return Math.floor((ms + (tzMinutes == null ? clock.tz : tzMinutes) * 60000) / 86400000);
  };
  /** {time: '4:07', ampm: 'PM'} or {time: '16:07', ampm: ''}, following the 12/24-hour setting. */
  CT.clockText = function (p) {
    var mm = (p.minutes < 10 ? '0' : '') + p.minutes;
    if (CT.settings.clock24h) return { time: (p.hours < 10 ? '0' : '') + p.hours + ':' + mm, ampm: '' };
    return { time: (p.hours % 12 || 12) + ':' + mm, ampm: p.hours < 12 ? 'AM' : 'PM' };
  };
  CT.timeText = function (ms, tzMinutes) {
    var c = CT.clockText(CT.parts(ms, tzMinutes));
    return c.ampm ? c.time + ' ' + c.ampm : c.time;
  };
  CT.hourText = function (ms, tzMinutes) {
    var h = CT.parts(ms, tzMinutes).hours;
    if (CT.settings.clock24h) return (h < 10 ? '0' : '') + h;
    return (h % 12 || 12) + (h < 12 ? 'AM' : 'PM');
  };

  // A shared once-a-second tick, aligned to the Mac's second boundary.
  var secondFns = [];
  CT.onSecond = function (fn) { secondFns.push(fn); };
  (function secondLoop() {
    var now = CT.now();
    // Nothing is visible while the backlight is off — don't spend the device's CPU redrawing it.
    if (!CT.asleep) for (var i = 0; i < secondFns.length; i++) secondFns[i](now);
    setTimeout(secondLoop, 1005 - (now % 1000));
  })();

  // ---- Screens -------------------------------------------------------------------------

  CT.screens = {};
  CT.current = 'nowplaying';
  var beforeSettings = 'nowplaying';

  /** Registers a screen. Optional hooks: show(), hide(), turn(steps), press(), and reselect()
   * for its own button pressed while it's already showing. turn and press can return false to
   * leave the input to the default (volume, and play/pause/next/previous). */
  CT.screen = function (name) {
    var def = { name: name };
    CT.screens[name] = def;
    return def;
  };

  // The old screen stays on under the new one until the new one has faded in (see "Switching
  // screens" in app.css), however long that is set to take.
  document.addEventListener('animationend', function (e) {
    if (e.animationName === 'fade-in' && e.target.classList.contains('screen') && e.target.classList.contains('active')) {
      state.leaving = '';
      state.screenSwitch = '';
      thaw();
    }
  });

  // A switch before the last one has finished: the screen still coming in loses its fade-in as
  // it starts to leave, so it would jump to full strength and then fade out — a ghost of it
  // flashing up. Instead its content leaves from how far it had faded in (its panels go to full
  // strength, covering the screen before it, which goes). Undone once it's no longer leaving.
  var frozenScreen = null, frozenParts = [];
  function freeze(name) {
    var el = document.getElementById('screen-' + name);
    if (!el) return;
    var style = getComputedStyle(el), shown = parseFloat(style.opacity);
    if (shown >= 1 && style.transform === 'none') return;
    frozenScreen = el;
    if (style.transform !== 'none') el.style.transform = style.transform; // where its slide had got to
    frozenParts = Array.prototype.slice.call(el.querySelectorAll('.left-rail > *, .screen-stage > *'));
    for (var i = 0; i < frozenParts.length; i++) {
      frozenParts[i].style.opacity = String(parseFloat(getComputedStyle(frozenParts[i]).opacity) * shown);
    }
  }
  function thaw() {
    if (frozenScreen) frozenScreen.style.transform = '';
    for (var i = 0; i < frozenParts.length; i++) frozenParts[i].style.opacity = '';
    frozenScreen = null;
    frozenParts = [];
  }

  // The screens on top buttons 1–4, left to right (the screens setting, picked on the Mac). Moving
  // between them wipes the new one in from that side; Settings, and a screen on no button, fades.
  var DEFAULT_SCREENS = ['nowplaying', 'calendar', 'weather', 'clock'];
  CT.slots = function () {
    var screens = CT.settings.screens;
    return screens && screens.length === 4 ? screens : DEFAULT_SCREENS;
  };

  /** Shows a screen. `fade` crossfades even between pages, rather than sliding to the side. */
  CT.show = function (name, fade) {
    var next = CT.screens[name];
    if (!next || (CT.lockedTo && name !== CT.lockedTo)) return;
    if (name !== CT.current) {
      var prev = CT.screens[CT.current];
      if (name === 'settings') beforeSettings = CT.current;
      if (prev.hide) prev.hide();
      thaw();
      if (state.leaving) freeze(CT.current);
      var pages = CT.slots(), from = pages.indexOf(CT.current), to = pages.indexOf(name);
      state.screenSwitch = fade || from < 0 || to < 0 ? 'fade' : to > from ? 'next' : 'previous';
      state.leaving = CT.current;
      CT.current = name;
      state.current = name;
      if (next.show) next.show();
      saveDevScreen();
    }
  };
  CT.closeSettings = function () { CT.show(beforeSettings); };

  // The While locked setting: with the Mac locked, the bridge can hold the device on one screen.
  // Nothing moves it off that screen, and the buttons and knob only work the volume and playback.
  CT.lockedTo = null;
  CT.on('lock', function (msg) {
    CT.lockedTo = msg.screen && CT.screens[msg.screen] ? msg.screen : null;
    if (CT.lockedTo) CT.show(CT.lockedTo, true);
  });

  // Whenever the Mac connects (the page loading, or the bridge coming back), an empty Now Playing
  // gives way to the Idle screen (unless When idle is Never). From there, or from the page's first screen, it moves to Now Playing
  // when something starts — until a screen is picked on the device (or restored in dev). It
  // doesn't leave Now Playing while connected: a player can drop out between tracks.
  var autoScreen = true, opening = true; // opening: no Now Playing message yet since connecting
  CT.on('nowPlaying', function (msg) {
    var first = opening;
    opening = false;
    // Settings → When idle governs this: Never keeps the (placeholder) Now Playing up; otherwise
    // the page opens on the Idle screen (the Clock by default). Settings arrive before Now Playing.
    var idleTarget = CT.settings.idleScreen || 'clock';
    if (first && !msg.np.active && CT.current === 'nowplaying' && CT.settings.idleMinutes && CT.screens[idleTarget]) {
      autoScreen = true;
      return CT.show(idleTarget, true); // under "Waiting for your Mac" as it fades
    }
    if (autoScreen && msg.np.active) {
      autoScreen = false;
      CT.show('nowplaying');
    }
  });

  // Dev only (npm run dev): the watcher reloads the page on every change, so remember the screen
  // and how many times each screen's button was pressed again (weather Today/This Week, the
  // calendar's month, the clock's timer — they keep their view when you leave) and put them back.
  var reselects = {}, restoredDevScreen = false;
  function saveDevScreen() {
    if (!CT.config.debug) return;
    try { sessionStorage.setItem('ct-dev-screen', JSON.stringify({ name: CT.current, reselects: reselects })); } catch (e) {}
  }
  function restoreDevScreen() {
    if (!CT.config.debug || restoredDevScreen) return;
    restoredDevScreen = true;
    var saved;
    try { saved = JSON.parse(sessionStorage.getItem('ct-dev-screen')); } catch (e) {}
    if (!saved || !CT.screens[saved.name]) return;
    autoScreen = opening = false;
    Object.keys(saved.reselects || {}).forEach(function (name) {
      var screen = CT.screens[name];
      for (var i = 0; screen && screen.reselect && i < saved.reselects[name]; i++) screen.reselect();
      if (screen && screen.reselect) reselects[name] = saved.reselects[name];
    });
    CT.show(saved.name);
    saveDevScreen();
  }

  // ---- Commands and feedback ------------------------------------------------------------

  /** Media command for the Mac (playpause | next | previous …). Screens can react via CT.on('command'). */
  CT.command = function (action) {
    if (!action) return;
    emit('command', action);
    CT.send({ type: 'command', action: action });
  };

  // `flashing` lasts as long as the .flash animation (0.7s in app.css): while it's set, the paused
  // badge on Now Playing shows the flash's icon instead of a second disc landing on top of it.
  var flashTimer = null;
  CT.flash = function (icon, color) {
    state.flash = { icon: icon, color: color || '', key: state.flash.key + 1 };
    state.flashing = true;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { state.flashing = false; }, 700);
  };

  var toastTimer = null;
  CT.toast = function (text) {
    state.toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { state.toast = ''; }, 1800);
  };
  CT.on('toast', function (msg) { CT.toast(msg.text); });

  // ---- Screen sleep ----------------------------------------------------------------------
  // The Mac turns the backlight off when its display sleeps, and when the sleep button is held.
  // When the Mac stops talking to us altogether the device does it for itself (device/sleepd.sh)
  // and we go black here to match. While dark, the first button or knob input only wakes us.

  CT.asleep = false;
  function setAsleep(on) {
    CT.asleep = on;
    state.asleep = on;
  }
  CT.on('screen', function (msg) { setAsleep(!msg.on); });

  /** Holding the sleep button: the Mac turns the backlight off until the next input. */
  function sleepNow() {
    setAsleep(true); // black straight away, even if the Mac isn't there to answer
    CT.send({ type: 'sleep' });
  }

  function wakeInstead() {
    if (!CT.asleep) return false;
    CT.send({ type: 'wake' });
    offlineSince = performance.now();
    if (!connected) setAsleep(false); // no Mac to turn the backlight back on for us
    return true;
  }

  // ---- Hardware input -------------------------------------------------------------------
  // Top buttons 1–4 and the settings button arrive as keys; the knob press is Enter, the back
  // button under it is Escape, and turning the knob is a horizontal wheel event per click.

  var CODE_ALIASES = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', NumpadEnter: 'Enter', KeyM: 'm' };
  function keyName(e) {
    if (/^[1-4]$/.test(e.key) || e.key === 'Enter' || e.key === 'Escape') return e.key;
    if (e.key === 'm' || e.key === 'M') return 'm';
    return CODE_ALIASES[e.code] || null;
  }

  function debugInput(text) {
    if (CT.config.debug) CT.send({ type: 'log', message: text });
  }

  function runButton(action) {
    if (!action) return;
    if (CT.lockedTo && (action.indexOf('screen:') === 0 || action === 'settings')) return;
    if (action.indexOf('screen:') === 0 || action === 'settings') autoScreen = false;
    if (action.indexOf('screen:') === 0) {
      var name = action.slice(7), screen = CT.screens[name];
      if (name === CT.current && screen && screen.reselect) {
        reselects[name] = (reselects[name] || 0) + 1;
        saveDevScreen();
        return screen.reselect();
      }
      return CT.show(name);
    }
    if (action === 'settings') return CT.current === 'settings' ? CT.closeSettings() : CT.show('settings');
    // Favoriting is for the song on screen, so only Now Playing does it.
    if ((action === 'favorite' || action === 'unfavorite') && CT.current !== 'nowplaying') return;
    CT.command(action);
  }

  // Knob press: count quick presses (1 = play/pause, 2 = next, 3 = previous by default).
  var clicks = 0;
  var clickTimer = null;
  function knobPress() {
    var screen = CT.screens[CT.current];
    if (!CT.lockedTo && screen.press && screen.press() !== false) return;
    clicks++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(function () {
      var n = Math.min(clicks, 3);
      clicks = 0;
      CT.command(CT.config.knobClicks[n]);
    }, CT.config.multiClickMs || 350);
  }

  // Buttons in config.buttonClicks count quick presses the way the knob does (by default the
  // back button: one press favorites the song, two unfavorite it).
  var presses = {}; // key → {count, timer}
  function buttonPress(key, actions) {
    var state = presses[key] || (presses[key] = { count: 0, timer: null });
    var most = Math.max.apply(null, Object.keys(actions).map(Number));
    state.count++;
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      var n = Math.min(state.count, most);
      state.count = 0;
      runButton(actions[n]);
    }, CT.config.multiClickMs || 350);
  }

  function runKey(key) {
    if (key === 'Enter') return knobPress();
    // A screen can take the back button for itself (Settings opens the Mac's settings page on it,
    // the clock's stale usage refreshes on it).
    var screen = CT.screens[CT.current];
    if (key === 'Escape' && !CT.lockedTo && screen && screen.back && screen.back() !== false) return;
    if (key === 'Escape' && CT.current === 'settings') return CT.closeSettings();
    var actions = (CT.config.buttonClicks || {})[key];
    if (actions) return buttonPress(key, actions);
    runButton(buttonAction(key));
  }

  // A top button set to open a screen (bridge/config.js) opens the screen picked for its slot; any
  // other action configured there stays as it is.
  function buttonAction(key) {
    var action = CT.config.buttons[key];
    if (/^[1-4]$/.test(key) && action && action.indexOf('screen:') === 0) return 'screen:' + CT.slots()[key - 1];
    return action;
  }

  // Buttons in config.buttonHolds do a second thing when held (by default: the settings button
  // puts the screen to sleep). Those act on release, so a hold isn't also a short press —
  // every other button still acts the moment it goes down.
  var holds = {}; // key → {start, done}
  var releasesWork = true; // until a key goes down twice with no keyup in between
  function holdAction(key) { return releasesWork && (CT.config.buttonHolds || {})[key]; }
  function holdMs() { return CT.config.holdMs || 1200; }

  function fireHold(key, press) {
    if (press.done) return;
    press.done = true;
    clearTimeout(press.timer);
    var action = holdAction(key);
    debugInput('hold ' + key + ' → ' + action);
    if (action === 'sleep') return sleepNow();
    runButton(action);
  }

  window.addEventListener('keydown', function (e) {
    var key = keyName(e);
    debugInput('keydown key=' + e.key + ' code=' + e.code + ' → ' + key + (e.repeat ? ' (repeat)' : ''));
    if (!key) return;
    e.preventDefault();
    if (!e.repeat) emit('input', key); // e.g. the When idle countdown starts over

    var press = holds[key];
    if (e.repeat) {
      // Auto-repeat is the backstop for the timer on a device that fires it while a key is held.
      if (press && !press.done && holdAction(key) && performance.now() - press.start >= holdMs()) fireHold(key, press);
      return;
    }
    if (press) { // no keyup arrived for the last press: this firmware only sends keydown
      releasesWork = false;
      clearTimeout(press.timer);
      debugInput('no keyup seen — holds disabled');
    }
    if (wakeInstead()) {
      holds[key] = { start: performance.now(), done: true }; // the wake was the whole press
      return;
    }
    // An alert over the screen (the meeting alert) takes the whole press to dismiss it (the back
    // button can do one thing more there: start the meeting's timer).
    if (CT.dismissModal && CT.dismissModal(key)) {
      holds[key] = { start: performance.now(), done: true };
      return;
    }
    press = holds[key] = { start: performance.now(), done: false, timer: null };
    if (!holdAction(key)) {
      press.done = true; // nothing to hold for: act now, as every button always has
      return runKey(key);
    }
    press.timer = setTimeout(function () { fireHold(key, press); }, holdMs());
  }, true);

  window.addEventListener('keyup', function (e) {
    var key = keyName(e);
    if (!key) return;
    e.preventDefault();
    var press = holds[key];
    delete holds[key];
    if (!press) return;
    clearTimeout(press.timer);
    if (!press.done) runKey(key); // short press: the action happens on release
  }, true);

  window.addEventListener('wheel', function (e) {
    e.preventDefault();
    var d = e.deltaX || e.deltaY;
    debugInput('wheel dx=' + e.deltaX + ' dy=' + e.deltaY);
    if (d) emit('input', 'wheel');
    if (!d || wakeInstead()) return;
    var steps = (d > 0 ? 1 : -1) * (CT.config.knobDirection || 1);
    var screen = CT.screens[CT.current];
    if (CT.lockedTo || !screen.turn || screen.turn(steps) === false) onKnobVolume(steps);
  }, { passive: false, capture: true });

  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---- Volume (knob turns anywhere but settings) --------------------------------------

  var vol = null;          // {volume, muted, supported, device, app?} from the Mac (app: the knob turns that app's volume)
  var lastTurn = -1e9;     // when the knob last turned
  var localVol = null;     // optimistic value while the knob is turning
  var localUntil = 0;
  var pendingDelta = 0;
  var flushTimer = null;
  var settleTimer = null;
  var hideTimer = null;
  var awaiting = null;     // where the knob left the volume, until the Mac has caught up
  var awaitingUntil = 0;   // past this, take the Mac's word even if it still disagrees
  var lastReportAt = 0;    // when a volume reading last arrived from the Mac

  CT.on('volume', function (msg) {
    var prev = vol;
    vol = msg.volume;
    lastReportAt = performance.now();
    if (performance.now() < localUntil) return; // knob in motion: don't fight the optimistic value
    renderVolume();
    // Not when the knob switches between the output and an app's volume: nothing was turned.
    // Except that an app's volume arrives in answer to the first turn (the Mac reads it then).
    var changed = prev && prev.app === vol.app && (prev.volume !== vol.volume || prev.muted !== vol.muted || prev.device !== vol.device);
    var answered = prev && vol.app && vol.supported && !prev.supported && performance.now() - lastTurn < 3000;
    if (changed || answered) showVolume();
  });

  function renderVolume(optimistic) {
    if (!vol) return;
    state.volumeUnsupported = !vol.supported;
    state.volumeNote = vol.supported ? '' : vol.note || 'No volume control on ' + vol.device;
    state.volumeIcon = !vol.supported ? '' : vol.appId === 'com.spotify.client' ? 'spotify' : vol.appId === 'com.apple.Music' ? 'apple-music' : '';
    var v = optimistic != null ? optimistic : vol.muted ? 0 : vol.volume || 0;
    if (optimistic == null && !vol.muted && awaiting != null) v = awaiting;
    state.volume = v;
  }

  // The Mac applies volume changes one at a time and reports after each, so for a while after a
  // spin its reports replay the spin. Showing them would slide the bar away from where the knob
  // left it and crawl it back. So the knob's value (`awaiting`) stands until the Mac's reports
  // have gone quiet, then the Mac's last one is taken. (Waiting for a matching value doesn't
  // work: a spin that doubles back passes its own end value partway through the replay.)
  // `awaitingUntil` covers a Mac that never answers.
  function macHasSettled(now) {
    return now > awaitingUntil || (lastReportAt > lastTurn && now - lastReportAt > 400);
  }

  function showVolume() {
    state.showVolume = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { state.showVolume = false; }, 1600);
  }

  function onKnobVolume(steps) {
    if (!vol) return;
    var now = performance.now();
    lastTurn = now;
    if (!vol.supported) {
      if (!vol.app) return showVolume(); // "No volume control on <device>"
      // An app's volume the Mac hasn't read yet, or the app isn't running: it reads it for this
      // turn and answers with the volume (or a toast).
      return CT.send({ type: 'volume', delta: steps * CT.config.volumeStep });
    }
    // A fresh turn starts from the Mac's value, unless the Mac is still catching up with the
    // last turn: then its number is stale and the knob's is the right one.
    if (now > localUntil) localVol = awaiting != null ? awaiting : vol.volume || 0;
    var next = Math.min(1, Math.max(0, localVol + steps * CT.config.volumeStep));
    pendingDelta += next - localVol;
    localVol = next;
    localUntil = now + 500;
    awaiting = next;
    awaitingUntil = now + 2500;
    renderVolume(localVol);
    showVolume();
    if (!flushTimer) flushTimer = setTimeout(flushVolume, 40);
    // Keep checking until the Mac has caught up, so the bar ends on the real value.
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function settle() {
      if (awaiting != null && macHasSettled(performance.now())) awaiting = null;
      renderVolume();
      if (awaiting != null) settleTimer = setTimeout(settle, 150);
    }, 550);
  }

  function flushVolume() {
    flushTimer = null;
    if (Math.abs(pendingDelta) > 1e-6) CT.send({ type: 'volume', delta: pendingDelta });
    pendingDelta = 0;
  }

  // ---- Start ----------------------------------------------------------------------------

  setInterval(function () {
    if (connected && performance.now() - lastMsgAt > 6500) setConnected(false);
    if (!connected || !gotConfig) CT.send({ type: 'hello' }); // ask the bridge for full state
    // The Mac is gone, so nothing will send us a screen message: go dark on our own. The device's
    // own watchdog (device/sleepd.sh) kills the backlight at the same point; this just means the
    // panel shows black rather than "Waiting for your Mac" even without it installed.
    if (!connected && !CT.asleep && performance.now() - offlineSince > (CT.config.offlineSleepMs || 90000)) setAsleep(true);
  }, 1000);

  // Runs after every screen script has registered.
  CT.ready = function () {
    var screen = CT.screens[CT.current];
    if (screen.show) screen.show();
    CT.send({ type: 'hello' });
  };
  return CT;
}

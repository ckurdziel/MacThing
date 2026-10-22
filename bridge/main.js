#!/usr/bin/env node
// Car Thing bridge: macOS Now Playing, volume, weather, calendar and Claude/ChatGPT usage ⇄ the Car Thing's screen,
// knob and buttons. Also serves the Mac-side settings page.
//   npm start          run the bridge
//   npm run dev        …and redeploy the device UI whenever ui/ changes

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VOLUME, AppVolume } from './audio/app-volume.js';
import { Volume } from './audio/volume.js';
import { config, paths } from './config.js';
import { listCarThings, listDevices, onUsbBus, restartServer, trackDevices } from './device/adb.js';
import { DeviceLink } from './device/link.js';
import { log } from './log.js';
import { AppInfo, kindOf } from './nowplaying/apps.js';
import { ArtworkCache } from './nowplaying/artwork.js';
import { browserArtKey, largerBrowserArt } from './nowplaying/browser-art.js';
import { MediaRemoteSource } from './nowplaying/mediaremote.js';
import { MacAppearance } from './mac/appearance.js';
import { MacHelper } from './mac/helper.js';
import { MacPower } from './mac/power.js';
import { Reminders, AWAY_MS } from './widgets/reminders.js';
import { settings } from './settings.js';
import { startSettingsPage } from './settings-page/server.js';
import { Calendar } from './widgets/calendar.js';
import { PerpetualCover } from './widgets/perpetual.js';
import { PhotosFeed } from './widgets/photos.js';
import { ClaudeUsage } from './widgets/usage.js';
import { CodexUsage } from './widgets/codex-usage.js';
import { Weather } from './widgets/weather.js';
import { SkipDetector } from './nowplaying/skips.js';

const source = new MediaRemoteSource(paths.bin);
const skips = new SkipDetector();
// A press on the device already shows its own flash, so a skip seen this soon after one is that press.
const OWN_PRESS_MS = 3000;
let lastDeviceCommand = 0;
const volume = new Volume(paths.bin);
const appVolume = new AppVolume();
const apps = new AppInfo(paths.bin);
const artwork = new ArtworkCache(path.join(paths.bin, 'artwork'), { blur: config.ambientBlurOnMac });
const helper = new MacHelper(paths.bin);
const weather = new Weather(helper, settings);
const calendar = new Calendar(helper, settings);
const perpetual = new PerpetualCover(path.join(paths.bin, 'artwork'), { blur: config.ambientBlurOnMac });
// The Photos screen only reads the Mac (and so only asks for access) while in use.
const photos = new PhotosFeed(helper, settings, { inUse: () => screenInUse('photos') });
// Settings → Usage: only the providers it names are read (none: no Keychain or Codex logs at all).
const wantsUsage = (provider) => [provider, 'both'].includes(settings.get().usageSource);
const usage = new ClaudeUsage({ enabled: () => wantsUsage('claude') });
const chatgptUsage = new CodexUsage({ enabled: () => wantsUsage('chatgpt') });
const appearance = new MacAppearance();
const power = new MacPower(paths.bin);
// You're at the Mac: awake, unlocked, display on, and some input in the last few minutes.
const reminders = new Reminders({
  settings,
  presence: async () =>
    !systemAsleep && !power.locked && !power.displayAsleep && ((await power.idleMs()) ?? 0) < AWAY_MS,
});

/** @type {DeviceLink|null} */
let link = null;
let connecting = false;

// ---- Now Playing ----------------------------------------------------------

// Latest snapshot with its artwork and app info resolved (both async, both cached).
let current = { np: source.snapshot, art: null, app: null };
let resolveSeq = 0;
let lastLogged = '';
const largerArt = new Map(); // source + video + artwork identity -> upgraded art (null: none found)

async function onNowPlaying(snapshot) {
  const seq = ++resolveSeq;
  const [art, app] = await Promise.all([
    snapshot.artwork ? artwork.get(snapshot.artwork) : null,
    snapshot.bundleId ? apps.get(snapshot.bundleId) : null,
  ]);
  if (seq !== resolveSeq) return; // superseded by a newer update
  const key = browserArtKey(snapshot);
  current = { np: snapshot, art: (key && largerArt.get(key)) || art, app };

  const summary = snapshot.active
    ? `${snapshot.playing ? '▶' : '❚❚'} ${snapshot.artist || '—'} · ${snapshot.title} [${app?.name || snapshot.bundleId}]`
    : 'nothing playing';
  if (summary !== lastLogged) log.info(`[now playing] ${(lastLogged = summary)}`);

  if (link) pushNowPlaying(link);
  refreshKnobTarget(); // under 'auto', the playing app decides what the knob turns

  // Browser video art is often a small thumbnail. Look for a bigger one once per cover.
  if (!art || largerArt.has(key) || Math.min(art.width, art.height) >= 360) return;
  if (largerArt.size > 20) largerArt.delete(largerArt.keys().next().value);
  largerArt.set(key, null);
  const bigger = await largerBrowserArt(snapshot.bundleId, snapshot.title).catch(() => null);
  if (!bigger) return;
  const mime = bigger.buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
  const hi = await artwork.get({ key: `${key}-hi`, mime, base64: bigger.buf.toString('base64') });
  if (Math.min(hi.width, hi.height) < 360) return;
  largerArt.set(key, hi);
  log.info(`[artwork] ${hi.width}×${hi.height} from the playing tab`);
  if (browserArtKey(current.np) !== key) return; // moved on to another video meanwhile
  current = { ...current, art: hi };
  if (link) pushNowPlaying(link);
}

function nowPlayingMessage() {
  const { np, art, app } = current;
  if (!np.active) return { type: 'nowPlaying', np: { active: false } };

  let elapsed = null;
  if (np.elapsed != null) {
    elapsed = np.elapsed + ((Date.now() - np.elapsedAt) / 1000) * np.rate;
    if (np.duration) elapsed = Math.min(elapsed, np.duration);
    elapsed = Math.max(0, elapsed);
  }
  return {
    type: 'nowPlaying',
    np: {
      active: true,
      playing: np.playing,
      title: np.title,
      artist: np.artist,
      album: np.album,
      duration: np.duration,
      elapsed,
      rate: np.rate,
      kind: kindOf(np.bundleId),
      source: {
        bundleId: np.bundleId,
        name: app?.name || '',
        icon: config.unbadgedApps.includes(np.bundleId) ? null : app?.icon || null,
      },
      artworkKey: art?.key || null,
    },
  };
}

function pushNowPlaying(target) {
  const { art } = current;
  if (art && target.sentArtKey !== art.key) {
    target.send({ type: 'artwork', key: art.key, dataUrl: art.dataUrl, blurUrl: art.blurUrl, tint: art.tint, width: art.width, height: art.height });
    target.sentArtKey = art.key;
  }
  target.send(nowPlayingMessage());
}

const tickMessage = () => ({ type: 'tick', now: Date.now(), tzMinutes: -new Date().getTimezoneOffset() });

function pushAll(target) {
  target.sentArtKey = null; // page (re)loaded: it has no artwork cached
  photos.setVisible(false); // a fresh page says when it shows the Photos screen
  target.send({
    type: 'config',
    config: {
      buttons: config.buttons,
      knobClicks: config.knobClicks,
      buttonClicks: config.buttonClicks,
      multiClickMs: config.multiClickMs,
      buttonHolds: config.buttonHolds,
      holdMs: config.holdMs,
      offlineSleepMs: config.deviceSleepSeconds * 1000,
      volumeStep: config.volumeStep,
      knobDirection: config.knobDirection,
      debug: Boolean(process.env.DEBUG), // page reports raw key/wheel events to the log
    },
  });
  target.send(tickMessage());
  target.send({ type: 'settings', settings: settings.get() });
  target.send({ type: 'appearance', dark: appearance.dark });
  const vol = volumeMessage();
  if (vol) target.send({ type: 'volume', volume: vol });
  pushNowPlaying(target);
  target.send({ type: 'weather', weather: weather.state });
  target.send({ type: 'calendar', calendar: calendar.state });
  target.send({ type: 'perpetual', perpetual: perpetual.state });
  target.send({ type: 'photo', photo: photos.state });
  target.send({ type: 'usage', usage: usage.state });
  target.send({ type: 'chatgptUsage', usage: chatgptUsage.state });
  target.send({ type: 'screen', on: screenOn !== false }); // the page may have gone dark by itself
  pushLock(target);
}

// ---- Screen sleep ---------------------------------------------------------

let systemAsleep = false;
let lastDeviceInput = 0;
let manualSleep = false; // held down the sleep button; any input clears it
let screenOn = null; // unknown until applied to the current device link

let macIdleMs = 0; // kept up to date while the Sleep setting is a number of minutes

// The Sleep setting. With Mac: the screen follows the Mac's display, and while the Mac is locked it
// stays off for good (what's on it is the locked-away Mac's business). A number of minutes: off
// once the Mac has gone that long without input, like a screen saver, or while it sleeps. Either
// way a button/knob press wakes it for a while. Never: always on, unless the sleep button is held.
function screenShouldBeOn() {
  if (manualSleep) return false;
  const mode = settings.get().screenSleep;
  if (mode === 'never') return true;
  if (mode === 'mac' && power.locked) return false;
  if (systemAsleep) return false;
  const idle = mode === 'mac' ? power.displayAsleep : macIdleMs >= mode * 60 * 1000;
  return !idle || Date.now() - lastDeviceInput < config.screenWakeMs;
}

// While Locked: the screen the device is held on while the Mac is locked, or null.
function lockedScreen() {
  const s = settings.get();
  return power.locked && s.screenSleep !== 'mac' && s.whenLocked !== 'unlocked' ? s.whenLocked : null;
}

/** A screen the device can show: a top button opens it, or it's shown when idle or while locked. */
function screenInUse(name) {
  const s = settings.get();
  return s.screens.includes(name) || (s.idleMinutes > 0 && s.idleScreen === name) || s.whenLocked === name;
}
let sentLock;
/** Tells the device which screen it's held on; only on a change unless `target` is a fresh page. */
function pushLock(target) {
  const screen = lockedScreen();
  if (!target && screen === sentLock) return;
  sentLock = screen;
  (target || link)?.send({ type: 'lock', screen });
}

async function applyScreen() {
  pushLock();
  const on = screenShouldBeOn();
  if (!link || on === screenOn) return;
  screenOn = on;
  log.info(`[screen] ${on ? 'on' : 'off'}`);
  await link.setScreen(on).catch((err) => {
    screenOn = null;
    log.warn('[screen]', err.message);
  });
  heartbeat(); // tell the device's watchdog what the screen is doing now, not in ten seconds
}

// The Mac says "still here" every few seconds. When it stops — the Mac was shut down, or the
// cable now only carries power — the device puts itself to sleep. See device/sleepd.sh.
//
// Only once a state has been applied to this link: the first beat after a reconnect is what the
// watchdog hands the screen back with, so it must say what we just set, not what the last link had.
function heartbeat() {
  if (screenOn === null) return;
  link?.heartbeat(screenOn).catch((err) => log.debug('[heartbeat]', err.message));
}

async function macStatus() {
  const s = await helper.status().catch(() => ({}));
  // The lists are for the settings page's checkboxes; they're empty until access is granted.
  const [cals, album] = await Promise.all([
    helper.calendars().catch(() => ({})),
    photos.albumsStatus(s.photos), // cached: counting every album's photos is too slow for each poll
  ]);
  return {
    location: { status: s.location || 'unknown', name: weather.auto?.name || null },
    calendar: { status: s.calendar || 'unknown', list: cals.ok ? cals.calendars : [] },
    photos: album,
  };
}

function openSettingsPage(section) {
  const hash = /^[a-z]+$/.test(section || '') ? `#${section}` : '';
  execFile('/usr/bin/open', [`http://127.0.0.1:${config.settingsPort}/${hash}`]);
}

// ---- Input from the device ------------------------------------------------

/** Apple Music actions via native/bin/musicctl (macOS asks once to let "musicctl" control Music). */
function musicctl(command) {
  return new Promise((resolve) =>
    // Long timeout: the first run waits on the Automation permission prompt.
    execFile(path.join(paths.bin, 'musicctl'), [command], { timeout: 60000 }, (err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: false, error: err?.message || 'musicctl failed' });
      }
    }),
  );
}

async function runCommand(action) {
  log.info(`[input] ${action}`);
  lastDeviceCommand = Date.now();
  if (action === 'favorite' || action === 'unfavorite') return setFavorite(action);
  try {
    if (!current.np.active && (action === 'playpause' || action === 'play')) {
      const r = await musicctl('play'); // nothing playing: start Apple Music
      if (!r.ok) log.warn('[input] starting Music failed:', r.error);
    } else {
      await source.command(action);
    }
  } catch (err) {
    log.warn(`[input] ${action} failed:`, err.message);
  }
}

async function setFavorite(command) {
  const { np } = current;
  if (np.active && !np.playing) return; // paused: the back button does nothing
  if (np.bundleId !== 'com.apple.Music') {
    return link?.send({ type: 'toast', text: np.active ? 'Favorites work with Apple Music' : 'Nothing playing' });
  }
  const r = await musicctl(command);
  if (r.ok) {
    log.info(`[favorite] ${np.title}: ${r.favorited ? 'added' : 'removed'}`);
    link?.send({ type: 'favorite', favorited: r.favorited });
  } else {
    log.warn('[favorite]', r.error);
    // -1743: the user said no to "musicctl wants to control Music".
    link?.send({ type: 'toast', text: r.code === -1743 ? 'Allow musicctl to control Music' : 'Couldn’t favorite this song' });
  }
}

// Pressing the volume keys is what makes macOS show its volume indicator, but macOS applies
// presses one at a time, about 100ms apart however fast they arrive. Every press sent is time
// the Mac spends behind the knob, and a spin that goes up and back down was played out both ways.
// So the presses are kept few:
//
//   - A plain press is 1/16, the same as a knob detent, so a detent is one press. (Option+Shift
//     presses are 1/64: four per detent, four times the wait.)
//   - Only one press is out at a time. Knob turns add up in keyBacklog while the Mac applies it,
//     and when the Mac reports the new volume the next press goes out toward the total. Turning up
//     and back down cancels in the backlog and is never pressed at all.
//   - A backlog more than MAX_PRESSES away is set directly. That skips macOS's indicator for that
//     change, but the Car Thing draws its own bar.
//
// Based on JackWangCA's fork (github.com/JackWangCA/MacThing), which found the four-presses-per-
// detent cost and netted out bursts.
const KEY_STEP = 1 / 16; // one plain volume-key press
const FINE_KEY_STEP = 1 / 64; // one Option+Shift press, only for remainders smaller than a detent
const MAX_PRESSES = 3;
const PRESS_TIMEOUT_MS = 300; // stop waiting for the Mac's report after this

let keyBacklog = 0;
let pressInFlight = null; // timer while a press is out and the Mac hasn't reported it yet

function changeVolume(delta) {
  if (!Number.isFinite(delta) || delta === 0) return;
  const app = knobApp();
  if (app) return changeAppVolume(app, delta);
  askForKeyAccess();
  if (!(config.macVolumeIndicator && volume.state?.keys)) return volume.delta(delta);
  keyBacklog += delta;
  pressNext();
}

/** The Mac reported a volume: the press it was applying is done. */
function pressLanded() {
  if (!pressInFlight) return;
  clearTimeout(pressInFlight);
  pressInFlight = null;
  pressNext();
}

function pressNext() {
  if (pressInFlight) return;
  const size = Math.abs(keyBacklog);
  if (size < FINE_KEY_STEP / 2) return (keyBacklog = 0);
  const up = keyBacklog > 0;
  if (size > MAX_PRESSES * KEY_STEP + 1e-9) {
    volume.delta(keyBacklog);
    keyBacklog = 0;
  } else {
    // The page's deltas are clamped at 0 and 1, so they don't always land on a detent; a bit
    // under a detent goes out as Option+Shift presses.
    const step = size >= KEY_STEP - 1e-9 ? KEY_STEP : FINE_KEY_STEP;
    volume.pressKey(up, { fine: step === FINE_KEY_STEP });
    keyBacklog -= up ? step : -step;
  }
  pressInFlight = setTimeout(pressLanded, PRESS_TIMEOUT_MS);
}

// ---- Knob volume: the Mac's output or an app's own ----------------------------------------
// settings.knobVolume picks what the knob turns: 'system' (the Mac's output), 'spotify' or
// 'music' (that app's own volume slider, over AppleScript), or 'auto' — the output, unless it
// has no volume of its own (an HDMI monitor), then the playing app's if it's Spotify or Music.
// An app's volume is first read on a knob turn, so macOS only asks for the Automation
// permission ("node wants to control Spotify") when someone actually uses it.

const KNOB_APPS = { spotify: 'com.spotify.client', music: 'com.apple.Music' };

let appVol = null; // {bundleId, level: 0–100, fractional} once the knob has read that app's volume
let appVolTouched = 0; // last knob turn: a background read mustn't undo what the knob just did
let appVolReading = false;
let appVolError = ''; // last failure logged, so the same one isn't logged on every turn
let appVolToastAt = 0;
const APP_VOL_QUIET_MS = 2000;

/** The bundle id whose volume the knob turns, or null for the Mac's output volume. */
function knobApp() {
  const mode = settings.get().knobVolume;
  if (KNOB_APPS[mode]) return KNOB_APPS[mode];
  if (mode !== 'auto' || !volume.state || volume.state.supported) return null;
  const { np } = current;
  return np.active && AppVolume.supports(np.bundleId) ? np.bundleId : null;
}

/** What the device shows: {volume, muted, supported, device, app?: the app the knob turns}. */
function volumeMessage() {
  const v = volume.state;
  const app = knobApp();
  if (!app) {
    // Under 'auto' on an output with no volume (an HDMI monitor), playing Spotify or Music would
    // give the knob something to turn, so say that rather than blaming the output.
    if (v && !v.supported && settings.get().knobVolume === 'auto' && !current.np.active) return { ...v, note: 'No music playing' };
    return v;
  }
  const base = { device: v?.device || '', keys: v?.keys };
  if (appVol?.bundleId === app) return { ...base, volume: appVol.level / 100, muted: false, supported: true, app: APP_VOLUME[app].name, appId: app };
  // Not read yet, or the app isn't running: the page sends the turn anyway and the read answers it.
  return { ...base, volume: null, muted: false, supported: false, app: APP_VOLUME[app].name, appId: app };
}

let lastVolumeSent = '';
function pushVolume({ force = false } = {}) {
  const v = volumeMessage();
  const json = JSON.stringify(v);
  if (!v || (!force && json === lastVolumeSent)) return;
  lastVolumeSent = json;
  link?.send({ type: 'volume', volume: v });
}

/** Forgets the app's volume when the knob no longer turns that app (setting, source or output changed). */
function refreshKnobTarget() {
  if (appVol && knobApp() !== appVol.bundleId) appVol = null;
  pushVolume();
}

function appVolFailed(r, bundleId, { toast = false } = {}) {
  appVol = null;
  pushVolume();
  const { name } = APP_VOLUME[bundleId];
  if (!r.notRunning) {
    const text = `${r.code || ''} ${r.error || ''}`;
    if (text !== appVolError) log.warn(`[volume] ${name}'s volume:`, r.error);
    appVolError = text;
  }
  if (!toast || Date.now() - appVolToastAt < 2500) return;
  appVolToastAt = Date.now();
  // -1743: the user said no to "node wants to control …" (System Settings → Privacy & Security → Automation).
  const text = r.notRunning ? `${name} isn’t running`
    : r.code === -1743 ? `Allow control of ${name} in Automation`
    : r.timedOut ? `Allow control of ${name} on your Mac`
    : `Couldn’t change ${name}’s volume`;
  link?.send({ type: 'toast', text });
}

async function readAppVolume(bundleId) {
  appVolReading = true;
  try {
    return await appVolume.read(bundleId);
  } finally {
    appVolReading = false;
  }
}

async function changeAppVolume(bundleId, delta) {
  appVolTouched = Date.now();
  if (appVol?.bundleId !== bundleId) {
    if (appVolReading) return; // the first turn is still reading it (or waiting on the permission prompt)
    const r = await readAppVolume(bundleId);
    if (!r.ok) return appVolFailed(r, bundleId, { toast: true });
    if (knobApp() !== bundleId) return;
    appVol = { bundleId, level: r.volume };
    appVolError = '';
    log.info(`[volume] the knob turns ${APP_VOLUME[bundleId].name}'s volume (${r.volume})`);
  }
  appVol.level = Math.min(100, Math.max(0, appVol.level + delta * 100));
  const r = await appVolume.set(bundleId, appVol.level);
  appVolTouched = Date.now();
  if (r && !r.ok) return appVolFailed(r, bundleId, { toast: true });
  pushVolume();
}

/** Every few seconds while the knob turns an app: follow its own slider, and notice it quitting. */
async function syncAppVolume() {
  refreshKnobTarget();
  if (!appVol || appVolReading || appVolume.running || Date.now() - appVolTouched < APP_VOL_QUIET_MS) return;
  const { bundleId } = appVol;
  const r = await readAppVolume(bundleId);
  if (Date.now() - appVolTouched < APP_VOL_QUIET_MS || appVolume.running || appVol?.bundleId !== bundleId) return;
  if (!r.ok) return appVolFailed(r, bundleId);
  // Keep the knob's fractional level unless the app really moved.
  if (Math.round(appVol.level) !== r.volume) appVol.level = r.volume;
  pushVolume();
}

// Asked on a knob turn rather than at startup: macOS's prompt only stays up briefly, so it
// should appear while someone is turning the knob and looking, with the device saying why.
// Its button opens System Settings, where MacThingVolume is already listed, switched off.
// A helper process keeps the first answer it got, so after asking, a fresh one is started every
// few seconds until the permission shows up — allowing it then needs no restart.
let askedForKeyAccess = false;
const KEY_RECHECK_MS = 3000;
const KEY_RECHECK_FOR_MS = 3 * 60 * 1000;
function askForKeyAccess() {
  if (!config.macVolumeIndicator || !volume.state || volume.state.keys || askedForKeyAccess) return;
  askedForKeyAccess = true;
  log.warn(
    '[volume] to show the macOS volume indicator, allow "MacThingVolume" in System Settings → ' +
      'Privacy & Security → Accessibility. Until then the knob sets the volume silently.',
  );
  volume.requestKeyAccess();
  link?.send({ type: 'toast', text: 'Allow MacThingVolume on your Mac' });
  const until = Date.now() + KEY_RECHECK_FOR_MS;
  const timer = setInterval(() => {
    if (volume.state?.keys || Date.now() > until) {
      clearInterval(timer);
      if (volume.state?.keys) log.info('[volume] MacThingVolume allowed: the knob shows the macOS volume indicator');
      return;
    }
    volume.recheck();
  }, KEY_RECHECK_MS);
}

function onDeviceMessage(msg) {
  if (msg.type === 'command' || msg.type === 'volume' || msg.type === 'wake') {
    lastDeviceInput = Date.now();
    manualSleep = false;
    applyScreen();
  }
  switch (msg.type) {
    case 'sleep':
      log.info('[screen] sleep requested from the device');
      manualSleep = true;
      return applyScreen();
    case 'command':
      return runCommand(msg.action);
    case 'volume':
      return changeVolume(Number(msg.delta));
    case 'setting':
      return settings.update({ [msg.key]: msg.value });
    case 'openSettingsPage':
      return openSettingsPage(msg.section);
    case 'retryWeather':
      return retryWeather(msg.quiet);
    case 'refreshUsage':
      return Promise.allSettled([chatgptUsage.ask(), usage.ask()]).then(() => {
        if (msg.ack) link?.send({ type: 'usageRefreshed' });
      });
    case 'photos':
      if (typeof msg.visible === 'boolean') photos.setVisible(msg.visible);
      if (msg.action === 'next') photos.next();
      return;
    case 'log':
      return log.info('[device]', msg.message);
  }
}

/** The weather button on an unavailable forecast: try again, or say how long until it can. */
async function retryWeather(quiet) {
  const r = await weather.retry();
  if (typeof r === 'number' && !quiet) link?.send({ type: 'toast', text: `Try again in ${r}s` });
}

// ---- Device lifecycle -----------------------------------------------------

// After the Mac sleeps, adb's server can keep an empty device list while the Car Thing is sitting
// on the USB bus perfectly happy — `ioreg -p IOUSB` shows it, `adb devices` doesn't, and no
// track-devices event ever arrives to say otherwise. Restarting the server fixes it at once, so
// treat a device-shaped silence as a stale server rather than an absent device.
let lastSeen = Date.now();
let lastServerRestart = 0;

async function refreshDevices() {
  let all;
  try {
    all = await listDevices();
  } catch (err) {
    return log.warn('[adb]', err.message);
  }
  let devices = all.filter((d) => d.carThing).map(({ serial }) => ({ serial }));

  if (!devices.length && !connecting && !all.length && Date.now() - lastServerRestart > config.adbRestartMs) {
    // Only when the server lists nothing at all AND the hardware is really on the bus. Anything
    // else on the list means the list isn't stale, and kill-server would drop someone else's
    // session; nothing on the bus means the device is unplugged and there's nothing to fix.
    if (await onUsbBus()) {
      lastServerRestart = Date.now();
      log.info('[adb] the Car Thing is on the USB bus but adb cannot see it — restarting the adb server');
      await restartServer();
      devices = await listCarThings().catch(() => []);
      if (devices.length) log.info('[adb] the server had gone stale; the device was there all along');
    }
  }
  if (devices.length) lastSeen = Date.now();

  if (link && !devices.some((d) => d.serial === link.serial)) link.close();
  if (!link && !connecting && devices.length) await connect(devices[0].serial);
}

async function connect(serial) {
  connecting = true;
  const l = new DeviceLink(serial);
  l.on('ready', () => pushAll(l));
  l.on('message', onDeviceMessage);
  screenOn = null; // whatever it was belonged to the last link
  l.on('close', () => {
    if (link !== l) return;
    link = null;
    photos.setVisible(false);
    log.info('[device] disconnected');
    setTimeout(refreshDevices, 1500);
  });
  link = l;
  try {
    log.info(`[device] connecting to ${serial}…`);
    await l.connect();
    log.info('[device] connected');
    screenOn = null;
    manualSleep = false;
    await applyScreen();
    heartbeat();
  } catch (err) {
    log.warn('[device] connect failed:', err.message);
    if (link === l) link = null;
    l.close();
    setTimeout(refreshDevices, 3000);
  } finally {
    connecting = false;
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- Start ----------------------------------------------------------------

log.info('Car Thing bridge starting');
source.on('change', (s) => {
  // Skips made on the Mac show on the device the same way as its own.
  const skip = skips.observe(s);
  if (skip && Date.now() - lastDeviceCommand > OWN_PRESS_MS) {
    log.info(`[now playing] skipped: ${skip}`);
    link?.send({ type: 'skip', action: skip });
  }
  onNowPlaying(s).catch((err) => log.warn('[now playing]', err.message));
});
volume.on('change', (v) => {
  pressLanded();
  if (appVol && knobApp() !== appVol.bundleId) appVol = null;
  pushVolume({ force: true });
});
settings.on('change', (values, changed) => {
  link?.send({ type: 'settings', settings: values });
  if (changed.includes('knobVolume')) refreshKnobTarget();
  if (changed.includes('screenSleep') || changed.includes('whenLocked')) refreshIdle();
});
settings.on('change', (_, changed) => {
  if (!changed.includes('usageSource')) return;
  usage.refresh();
  chatgptUsage.refresh();
});
weather.on('change', (state) => link?.send({ type: 'weather', weather: state }));
calendar.on('change', (state) => link?.send({ type: 'calendar', calendar: state }));
perpetual.on('change', (state) => link?.send({ type: 'perpetual', perpetual: state }));
photos.on('change', (state) => link?.send({ type: 'photo', photo: state }));
usage.on('change', (state) => link?.send({ type: 'usage', usage: state }));
chatgptUsage.on('change', (state) => link?.send({ type: 'chatgptUsage', usage: state }));
appearance.on('change', (dark) => link?.send({ type: 'appearance', dark }));
reminders.on('due', (reminder) => {
  log.info(`[reminders] ${reminder.text}`);
  link?.send({ type: 'reminder', reminder });
});
power.on('display', () => applyScreen());
power.on('lock', (locked) => {
  log.info(`[screen] Mac ${locked ? 'locked' : 'unlocked'}`);
  applyScreen();
});
power.on('willSleep', async () => {
  systemAsleep = true;
  await Promise.race([applyScreen(), new Promise((r) => setTimeout(r, 2500))]);
  power.ack(); // let the Mac go to sleep
});
power.on('didWake', () => {
  systemAsleep = false;
  applyScreen();
  // Waking is exactly when adb's list goes stale, so look now and again once USB has settled,
  // instead of waiting out the timer that exists for ordinary unplugs.
  refreshDevices();
  setTimeout(refreshDevices, 8000);
});
source.start();
volume.start();
helper.start();
weather.start();
calendar.start();
perpetual.start();
photos.start();
usage.start();
chatgptUsage.start();
appearance.start();
power.start();
reminders.start();
startSettingsPage({ port: config.settingsPort, settings, status: macStatus, reminders, dev: process.argv.includes('--watch') });

trackDevices(debounce(refreshDevices, 400));
setInterval(refreshDevices, 30 * 1000); // a stale adb server sends no events; look anyway
refreshDevices();

setInterval(() => link?.send(tickMessage()), 2000);
// Lets the post-input wake window expire, and reads the Mac's idle time for a timed Sleep setting.
async function refreshIdle() {
  if (typeof settings.get().screenSleep === 'number') macIdleMs = (await power.idleMs()) ?? 0;
  applyScreen();
}
setInterval(refreshIdle, 5000);
setInterval(() => syncAppVolume(), 10 * 1000); // follows the app's own volume slider while the knob turns it
setInterval(heartbeat, config.heartbeatMs);
setInterval(() => link?.send(nowPlayingMessage()), 15000); // re-anchor the device's progress clock

if (process.argv.includes('--watch')) {
  log.info(`[dev] watching Vue source in ${paths.uiSource}`);
  let building = false;
  let pending = false;
  const rebuild = async () => {
    if (building) { pending = true; return; }
    building = true;
    try {
      do {
        pending = false;
        await new Promise((resolve, reject) => {
          execFile(process.execPath, [path.join(paths.root, 'node_modules/vite/bin/vite.js'), 'build'],
            { cwd: paths.root }, (err, stdout, stderr) => err ? reject(new Error(stderr || stdout || err.message)) : resolve());
        });
      } while (pending);
      await link?.redeploy();
    } catch (err) { log.warn('[dev] build/deploy failed:', err.message); }
    finally {
      building = false;
      if (pending) { pending = false; rebuild(); }
    }
  };
  const redeploy = debounce(rebuild, 300);
  fs.watch(paths.uiSource, { recursive: true }, redeploy);
  fs.watch(path.join(paths.root, 'vite.config.js'), redeploy);
}

async function shutdown() {
  log.info('shutting down');
  // Don't leave the Car Thing dark with nothing to wake it — unless its own watchdog is there,
  // which wakes the screen on any button or knob press and would only turn it off again anyway.
  if (link && screenOn === false && !link.sleepd) {
    await Promise.race([link.setScreen(true).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  }
  link?.send({ type: 'bye' });
  source.stop();
  volume.stop();
  helper.stop();
  power.stop();
  reminders.stop();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

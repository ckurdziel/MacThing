import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from './log.js';
import { DAY_MINUTES, EVERY_MINUTES, MAX_REMINDERS, MAX_TEXT, MAX_TIMES } from './widgets/reminders.js';

// User-changeable settings (from the device's settings screen or the Mac settings page),
// persisted outside the repo. Developer-level options live in config.js instead.
const FILE = path.join(os.homedir(), 'Library', 'Application Support', 'carthing-now-playing', 'settings.json');

// Every screen a top button can open; the Apple Reminders screen is 'todo' ('reminders' is the
// task-reminder cards).
export const SCREENS = ['nowplaying', 'calendar', 'weather', 'clock', 'photos', 'todo'];

export const DEFAULTS = {
  theme: 'dark', // 'dark' | 'light' | 'auto' (follow the Mac's appearance)
  units: 'F', // weather temperature: 'F' | 'C'
  clock24h: false,
  clockFace: 'analog', // 'analog' | 'numbers' | 'digital'
  artBackground: false, // blurred album art behind Now Playing and the widgets
  location: { mode: 'auto' }, // or { mode: 'manual', name, lat, lon }
  calendars: null, // null = every calendar in the Mac's Calendar app; else an array of calendar ids
  calendarDays: 2, // days of events on the Calendar screen: today plus the next (n − 1)
  meetingAlert: 0, // when a timed event's alert covers the screen: 0 = off, 'event' = at the event's own alert, else minutes before
  usageSource: 'claude', // the Clock screen's usage views: 'claude' (Claude Code) | 'chatgpt' (Codex) | 'both' | 'none'
  // What the knob turns: 'auto' = the Mac's output, or when it has no volume of its own (an HDMI
  // monitor) the playing app's if it's Spotify or Music | 'system' | 'spotify' | 'music'
  knobVolume: 'auto',
  idleMinutes: 0, // once nothing has played this long on Now Playing, show idleScreen (0 = never)
  idleScreen: 'clock', // any of SCREENS but 'nowplaying'
  rotateSeconds: 0, // nothing playing: step through the top buttons' screens every this many seconds (0 = off)
  screens: ['nowplaying', 'calendar', 'weather', 'clock'], // what top buttons 1–4 open: four different SCREENS
  photosAlbum: null, // the Photos screen's album: a Photos album id, or null = Favorites
  photosSeconds: 30, // how long each photo stays up on the Photos screen
  todoLists: null, // the Reminders screen's lists: null = every list in the Reminders app; else list ids
  // When the screen turns off: 'mac' = while the Mac's display sleeps or the Mac is locked |
  // minutes the Mac has been idle (no keyboard or mouse, like a screen saver) | 'never'
  screenSleep: 'mac',
  // While the Mac is locked (and screenSleep isn't 'mac', which turns the screen off):
  // 'unlocked' = everything works | any of SCREENS = held on that screen, with only the knob's
  // volume and media controls
  whenLocked: 'unlocked',
  // Task reminders: [{ id, text, on, repeat: 'every' | 'times', every (minutes at the Mac),
  // times (minutes since midnight) }]. See widgets/reminders.js.
  reminders: [],
  // When reminders may show: { days (0 = Sunday), from, to (minutes since midnight) }, or null = any time.
  activeHours: { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 18 * 60 },
};

const VALID = {
  theme: (v) => ['dark', 'light', 'auto'].includes(v),
  units: (v) => v === 'F' || v === 'C',
  clock24h: (v) => typeof v === 'boolean',
  clockFace: (v) => ['analog', 'numbers', 'digital'].includes(v),
  artBackground: (v) => typeof v === 'boolean',
  location: (v) =>
    v?.mode === 'auto' ||
    (v?.mode === 'manual' && typeof v.name === 'string' && Number.isFinite(v.lat) && Number.isFinite(v.lon)),
  calendars: (v) => v === null || (Array.isArray(v) && v.every((id) => typeof id === 'string')),
  calendarDays: (v) => Number.isInteger(v) && v >= 1 && v <= 7,
  meetingAlert: (v) => [0, 'event', 1, 5, 10].includes(v),
  usageSource: (v) => ['claude', 'chatgpt', 'both', 'none'].includes(v),
  knobVolume: (v) => ['auto', 'system', 'spotify', 'music'].includes(v),
  idleMinutes: (v) => [0, 1, 2, 5, 10].includes(v),
  idleScreen: (v) => SCREENS.includes(v) && v !== 'nowplaying',
  rotateSeconds: (v) => [0, 15, 30, 60, 120].includes(v),
  screens: (v) => Array.isArray(v) && v.length === 4 && new Set(v).size === 4 && v.every((s) => SCREENS.includes(s)),
  photosAlbum: (v) => v === null || (typeof v === 'string' && v.length > 0),
  photosSeconds: (v) => [10, 20, 30, 60, 300].includes(v),
  todoLists: (v) => v === null || (Array.isArray(v) && v.every((id) => typeof id === 'string')),
  screenSleep: (v) => ['mac', 30, 60, 120, 240, 'never'].includes(v),
  whenLocked: (v) => v === 'unlocked' || SCREENS.includes(v),
  reminders: (v) =>
    Array.isArray(v) &&
    v.length <= MAX_REMINDERS &&
    v.every(
      (r) =>
        typeof r?.id === 'string' &&
        typeof r.text === 'string' &&
        r.text.trim().length > 0 &&
        r.text.length <= MAX_TEXT &&
        EVERY_MINUTES.includes(r.every) &&
        [undefined, 'every', 'times'].includes(r.repeat) &&
        (r.times === undefined ||
          (Array.isArray(r.times) &&
            r.times.length <= MAX_TIMES &&
            r.times.every((t) => Number.isInteger(t) && t >= 0 && t < DAY_MINUTES))) &&
        typeof r.on === 'boolean',
    ),
  activeHours: (v) =>
    v === null ||
    (Array.isArray(v?.days) &&
      v.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
      Number.isInteger(v.from) &&
      Number.isInteger(v.to) &&
      v.from >= 0 &&
      v.from < v.to &&
      v.to <= DAY_MINUTES),
};

class Settings extends EventEmitter {
  constructor() {
    super();
    this.values = { ...DEFAULTS, ...this.#load() };
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (raw.sleepWithMac === false && raw.screenSleep === undefined) raw.screenSleep = 'never'; // the old on/off setting
      return Object.fromEntries(Object.entries(raw).filter(([k, v]) => VALID[k]?.(v)));
    } catch {
      return {};
    }
  }

  get() {
    return this.values;
  }

  /** Applies the valid, changed keys of `patch`; emits 'change' (values, changedKeys). */
  update(patch) {
    const changed = Object.entries(patch ?? {}).filter(
      ([k, v]) => VALID[k]?.(v) && JSON.stringify(v) !== JSON.stringify(this.values[k]),
    );
    if (!changed.length) return false;
    this.values = { ...this.values, ...Object.fromEntries(changed) };
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(this.values, null, 2));
      fs.renameSync(`${FILE}.tmp`, FILE);
    } catch (err) {
      log.warn('[settings] could not save:', err.message);
    }
    this.emit('change', this.values, changed.map(([k]) => k));
    return true;
  }
}

export const settings = new Settings();

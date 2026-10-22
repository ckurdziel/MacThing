import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  root,
  ui: path.join(root, 'dist', 'ui'),
  uiSource: path.join(root, 'ui'),
  bin: path.join(root, 'native', 'bin'),
  sleepd: path.join(root, 'device', 'sleepd.sh'),
  dimmerd: path.join(root, 'device', 'dimmerd.sh'),
};

export const config = {
  // Host port that `adb forward` maps to the Car Thing's Chromium devtools port (2222).
  // NOTE: never use `adb reverse` with this firmware — it crashes adbd and drops USB until a reboot.
  cdpPort: Number(process.env.CARTHING_CDP_PORT || 22222),

  // Where our files live on the device. /var/lib is the persistent "settings" partition,
  // so updates never need the read-only rootfs remounted.
  deviceDir: '/var/lib/carthing',
  deviceUiDir: '/var/lib/carthing/ui',
  // What Chromium opens at boot (supervisord --app). scripts/setup-device.sh points it at deviceUiDir.
  deviceBootUrl: 'file:///usr/share/qt-superbird-app/webapp/index.html',

  // Buttons → action. Keys are what the device reports to the page: top buttons 1–4, the
  // fifth (settings) button at the end of the top row (m) and the back button under the knob
  // (Escape — also closes Settings whatever it's mapped to).
  // Actions: screen:<nowplaying|calendar|weather|clock|photos> | settings | favorite |
  // unfavorite (the playing Apple Music song) | previous | next | playpause | null
  // A screen: action on top buttons 1–4 opens whatever the Top buttons setting puts on that button
  // (Appearance on the Mac settings page); the names below are only what it starts as.
  buttons: {
    1: 'screen:nowplaying',
    2: 'screen:calendar',
    3: 'screen:weather',
    4: 'screen:clock',
    m: 'settings',
    Escape: 'favorite',
  },
  // Knob press, by number of quick presses. A single press waits multiClickMs to see if more follow.
  knobClicks: { 1: 'playpause', 2: 'next', 3: 'previous' },
  // Buttons that count presses the same way. On Now Playing the back button favorites the playing
  // song on one press and unfavorites it on two, so neither is a toggle you have to guess the state
  // of. A key listed here ignores its `buttons` entry.
  buttonClicks: { Escape: { 1: 'favorite', 2: 'unfavorite' } },
  multiClickMs: 350,

  // Hold a button for holdMs to get a second action out of it; the short press then happens on
  // release instead. `sleep` puts the screen to sleep until the next button or knob input.
  buttonHolds: { m: 'sleep' },
  holdMs: 1200,

  // Mac-side settings page (weather location etc.), loopback only.
  settingsPort: Number(process.env.CARTHING_SETTINGS_PORT || 4747),

  // What the knob turns (the Mac's output, Spotify, Music, or automatic) is the Knob volume
  // setting, on the device's Settings screen and the Mac page.
  volumeStep: 1 / 16, // per knob detent — one press of the Mac's volume keys (16 steps)
  // true: turn the knob by pressing the Mac's volume keys so macOS shows its volume indicator.
  // Needs native/bin/MacThingVolume allowed under Privacy & Security → Accessibility (software
  // can't press keys without it); until it is, the knob sets the volume silently instead.
  // false: always set the volume directly — silent, no permission.
  macVolumeIndicator: true,
  knobDirection: 1, // 1 = turning right raises the volume (same as Spotify's firmware); -1 flips it

  // How long a button or knob input wakes the screen once the Sleep setting has turned it off.
  screenWakeMs: 60 * 1000,

  // Deep sleep, run by the device itself (device/sleepd.sh, installed by `npm run setup-device`).
  // The bridge writes deviceHeartbeat every heartbeatMs with the screen state it wants; when the
  // Mac stops writing it — shut down, cable pulled, bridge stopped — the device turns its own
  // backlight off after deviceSleepSeconds and idles the CPU, since nothing on the Mac can do it
  // any more. Any button or knob input wakes it for deviceWakeSeconds.
  deviceSleepSeconds: 90,
  deviceWakeSeconds: 20,
  devicePowersave: true, // also idle the device's CPU while asleep (see device/sleepd.sh)
  // Shortest gap between adb server restarts. The bridge only restarts it when ioreg shows the
  // Car Thing on the USB bus while `adb devices` is empty, which is always wrong and always the
  // server's fault, so there's no reason to wait long or to give up.
  adbRestartMs: 20 * 1000,

  // This firmware's USB gadget doesn't always survive the Mac suspending the port, and it's only
  // built at boot, so the Mac can wake to no device on the bus until it's fully power-cycled.
  // After this many seconds without a heartbeat — and only while no host has the gadget
  // configured — the device rebinds it itself.
  deviceUsbHealSeconds: 180, // 0 turns it off
  heartbeatMs: 10 * 1000,
  deviceHeartbeat: '/tmp/carthing-heartbeat', // tmpfs: the rootfs is read-only and flash wears out

  // Auto-brightness (device/dimmerd.sh, installed by `npm run setup-device` in place of Spotify's
  // daemon). The light sensor is where your hand goes when you reach for the controls, so the
  // screen only dims once the room has read darker for this long. Brighter happens right away.
  deviceDimDelaySeconds: 10,

  // Sources that don't get an app badge on the artwork (your "home" player).
  unbadgedApps: ['com.apple.Music'],

  // Blur the album art background here (native/bin/artwork) and send the device a finished image.
  // false: the device blurs the cover itself with CSS, which takes it ~1.7s of drawing per cover.
  ambientBlurOnMac: true,
};

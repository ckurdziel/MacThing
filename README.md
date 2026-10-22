# MacThing

Turns a Spotify Car Thing into a desk display and volume knob for macOS.
It has four screens: Now Playing, Calendar, Weather and Clock.

No reflashing: this runs on the community firmware you already have, replaces the web app the
device shows, and can be undone with one command. Nothing is installed on the device that a
`npm run restore-device` doesn't put back.

[Version 1.0.0](https://github.com/srcurran/MacThing/releases) · [Figma artwork and video source](https://www.figma.com/design/Xw7pn5j4QZ8Ns237keo3ev/MacThing?node-id=327-1567)

https://github.com/user-attachments/assets/bae1ab1a-63c3-4b50-8840-2d3ef3a6e8e8

![Now Playing on the Car Thing](docs/1.0.0/device-nowplaying.png)

![Calendar, Weather, Clock, meeting timer, Claude usage and ChatGPT usage on the Car Thing](docs/1.0.0/device-overview.png)

_Every screen here is captured from the Car Thing itself at 800×480 with fixture data
(`npm run mock-screens`), then mounted in the device mockups in Figma, with the album art
background on. [docs/1.0.0](docs/1.0.0/README.md) lists every screen and which album is behind it._

## New in 1.0.0

- **Claude and ChatGPT usage** on the Clock screen: session and weekly rings, a pace for each, and when they reset. ChatGPT's numbers come live from Codex.
- **Meeting alerts that start the timer:** queue the meeting's timer from the alert before it starts, or start it once it has. The timer stops counting ten minutes after the meeting ends.
- **Reminders:** "Time to stand" or "Drink water" as a card on the device, on an interval that counts only time you're at the Mac, or at set times.
- **A perpetual calendar** in place of the album art when nothing is playing, after [pketh's perpetual-calendar](https://github.com/pketh/perpetual-calendar), with new colours each day.
- **A new digital clock:** two-digit hours stacked over the minutes, set in Merriweather.
- **The knob's volume:** turn the Mac's output, Spotify's or Apple Music's volume, in the same steps as the Mac's volume keys, with the macOS volume pop-up.
- **Settings:** a new Mac settings page, plus **When idle** (leave an idle Now Playing for the Clock, Calendar or Weather) and **Sleep** (with the Mac, after the Mac has been idle, or never) and what works while the Mac is locked. When idle and Sleep with Mac are from [eparis-bit](https://github.com/eparis-bit).
- **Smoother at the desk:** album art crossfades after a skip, the screen waits 10 seconds before dimming under your hand, stays lit when the Mac wakes, opens on the Clock when nothing is playing, and no longer lags after a reconnect. Browser video artwork is steadier, and the UI icons are [Phosphor](https://phosphoricons.com).

| Control                               | Action                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Top buttons 1 · 2 · 3 · 4             | Now Playing · Calendar · Weather · Clock                                                                                     |
| Turn knob                             | Volume — the Mac's output, Spotify's or Apple Music's, per the Knob → Volume setting (in Settings: move the selection)        |
| Press knob once / twice / three times | Play-pause / next track / previous track; starts Apple Music if nothing is playing (in Settings: change the selected option) |
| Fifth top button (settings)           | Settings (press it again to close)                                                                                           |
| Hold the fifth top button             | Sleep now — screen off until the next button or knob input                                                                   |
| Back button (under the knob)          | On Now Playing, press once to favorite the playing Apple Music song, twice to unfavorite it (does nothing while it's paused). In Settings, open the settings page on your Mac. On a paused or finished timer, reset it; on a usage view showing “10m ⟳”, check usage again. The screen's lower-right corner says which |

The four screens:

- **Now Playing** follows whatever is playing in Control Center's Now Playing: Apple Music, Spotify, Podcasts, YouTube in a browser, and so on. It shows the artist, title, album, progress and artwork, plus a paused state and an app badge for non-Music sources. When nothing is playing it becomes a perpetual calendar, after [pketh's perpetual-calendar](https://github.com/pketh/perpetual-calendar): the month, date and day with the time below, and a cover of six stencil panels in new colours each day (drawn on the Mac) in place of the album art, and behind everything when the album art background is on. A paused track keeps showing that track. With nothing playing, the Car Thing opens on the Clock instead (moving to Now Playing once something starts, until you pick a screen). Optionally the artwork also fills the screen behind everything, blurred and tinted.
- **Calendar** shows today's remaining events and, by default, tomorrow's under their own heading. Choose how many days (1–7) and which calendars on the Mac settings page. Press the calendar button again while it's up to see the whole month, with today circled; press it once more to go back to the agenda.
- **Weather** shows the current conditions, the next five hours and four days. It uses [Open-Meteo](https://open-meteo.com) (free, no account) for your Mac's location or a place you pick. Press the weather button again while it's up to list the next six hours (Today), once more for the next six days (This Week), and a third time to go back to the forecast. If the forecast can't be fetched, the weather button asks again instead; each failed try makes the next wait longer (4 seconds, then 8, 16 and so on), and the screen says how long.
- **Clock** shows an analog face (plain or with numbers) or a digital one (the hours over the minutes, both two digits) — pick which on the Mac settings page — plus the next event still to come today, or "No events today". Press the clock button again while the clock is up to swap in a timer: turn the knob to pick 5, 10, 15, 30, 45 or 60 minutes, press it to start or pause, and press twice to reset. Once the timer is paused or finished, the back button resets it too, and the lower-right corner says reset ⟳. When the time is up, the timer counts on past it (1:23+) until you reset it or leave it. Press the clock button again for Claude usage, and once more to go back to the clock; while the timer is running or paused, the knob still sets the volume.
  - **Until the meeting ends, or starts.** Past 60 minutes there's one more knob stop: while a timed Calendar event is going on, the time until it ends, labelled with the meeting's name; otherwise the time until the next one today starts ("Next meeting in"); with neither, no stop. Until you start it, it shows the minutes left, rounded up, and doesn't tick: 9:49 to go reads 10 min. During a meeting the timer opens on this stop. Counting to a meeting's end, the dial's full turn is the whole meeting, so it shows how much of it is left. Started, it runs to the meeting's actual time, and follows it if the meeting is moved in Calendar — unless you've paused it. Once the meeting's over it counts on past the end (1:23+) for ten minutes at most, then goes back to the clock. With overlapping meetings it uses the one that ends first; all-day events don't count. With meeting alerts on, the card's **Queue**/**Start** option starts it, as the meeting begins or once it has, and switches to it; nothing else starts it, or switches screens, by itself.
  - **Claude usage.** The clock button's third press shows how much of your Claude plan you've used — the same numbers as Claude Code's `/usage` — as two rings the size of the clock: the current five-hour session outside and the week inside. Each ring's faint track is the whole allowance and the white arc is what you've used. The pace — how much of that window's time has gone, where you'd be using it evenly — is marked by a white dot outside the session ring and inside the weekly ring. The dots are solid white with no border; usage past the dot is orange. Before a window starts, its dot stays at 12 o’clock and its reset line shows the full window (Session 5h or Week 7d); the actual countdown begins when usage starts. Each ring is marked with its initial, S or W, in a white circle at 12 o'clock, and the bottom line says how long until each resets (Session 1.5h · Week 5d) in place of the next event. The left side shows the session's numeric pace (for example, **1.1x**) and the week's pace and, dimmed after it, its percentage on one line (for example, **Week: 0.3x** · 18%). Each pace compares how fast you've used the allowance with how fast you can still afford to use what remains. Below 1x is under pace; above 1x means slowing down to stay within the allowance. The first 10% of the window counts as 10% elapsed so a first message does not appear extreme. At 100% usage or more, the pace is replaced with 🔥🔥🔥. It uses the Claude Code command line's sign-in on your Mac (the "Claude Code-credentials" Keychain item; the first time, macOS asks whether `security` may read it, so choose Always Allow), and only ever reads the access token, so it never signs Claude Code out. Signing in to the Claude desktop app doesn't count: if it says "Not signed in to Claude", run `claude auth login` in Terminal. The numbers refresh every five minutes, and when you open the view (at most once a minute). Claude throttling respects Retry-After and uses a five-minute minimum cooldown, doubling up to one hour after repeated throttling. The cooldown survives bridge restarts. The last successful reading is cached for the current sign-in and shown during a temporary failure; a “10m ⟳” label appears on the right, aligned with the bottom of the reset text block, once the last successful check is at least ten minutes old, and while it's up the back button checks again (at most once a minute); expired windows are discarded. If no reading is available, the screen names Claude and explains whether it is loading, waiting for retry, or needs sign-in. When the access token expires, MacThing quietly initializes the installed Claude Code to let it renew its own login, then retries usage. This sends no model prompt, uses no model tokens, and runs no tools or hooks. Renewal attempts are limited to once every five minutes. If Claude Code is not installed or cannot renew the login, open it and sign in if prompted, or run `claude auth login`.
  - **ChatGPT, both or neither.** **AI Usage → Show usage** on the Mac settings page picks Claude (the default), ChatGPT, Both (a Claude view and then a ChatGPT one, each a press of the clock button) or None (no usage view, and nothing read on the Mac). The ChatGPT view shows your ChatGPT plan's limits: the five-hour and weekly limits Codex runs under, with the OpenAI mark in the middle. They're live from OpenAI, the same numbers Codex's `/status` shows: the bridge asks the Codex that's installed on your Mac (the ChatGPT app's, or the command line's) every five minutes and whenever the view opens, so Codex keeps its own sign-in and nothing here reads or renews it. If Codex isn't signed in, the view says "Not signed in to ChatGPT"; without Codex installed, "Codex isn’t on this Mac".

<img src="docs/1.0.0/nowplaying-empty.png" width="49%" alt="Now Playing with nothing playing: the perpetual calendar"> <img src="docs/1.0.0/clock-digital.png" width="49%" alt="The digital clock: 01 over 14">
<img src="docs/1.0.0/weather-today.png" width="49%" alt="Weather's Today view: the next six hours"> <img src="docs/1.0.0/weather-week.png" width="49%" alt="Weather's This Week view: the next six days">
<img src="docs/1.0.0/meeting-alert.png" width="49%" alt="A meeting alert over Now Playing, offering to queue its timer"> <img src="docs/1.0.0/settings.png" width="49%" alt="Settings on the device">

_Nothing playing, the digital clock, Weather's Today and This Week views, a meeting alert and Settings, from the same fixture data._

**Meeting alerts** (off by default; turn them on in Settings): at a timed event's alert, a sheet with its title, start and end time and location comes up over the bottom of whatever screen is up. A video call is named by its service (Zoom, Google Meet, Microsoft Teams, Webex, FaceTime) rather than shown as a link, including when the link is only in the event's URL or notes. "Event's alert" uses the alert set on the event in Calendar (only alerts within an hour of the start; an event without one gets the card as it starts); or pick a fixed 1, 5 or 10 minutes before every event. The back button under the knob works the Clock screen's timer from the card. Before the meeting, the card shows **Queue 30 min timer** (the meeting's length): press back to queue it (the card stays and says **Cancel timer**, in red; press back again to un-queue it), and the timer starts as the meeting does and comes up on the Clock screen, in place of the card. Once the meeting has started, it shows **Start 30 min timer** (the minutes left until it ends): press back to start the timer to the meeting's end (it comes up on the Clock screen). Only one timer can be queued. Only one timer runs at a time, so with two meetings at once each card says which one its timer is for. Any other button or the knob — or the back button before the meeting starts — cancels — that press only dismisses the card. It stays until then, or until the meeting ends, its "In 3 min" turning to "22 min ago" once it's started (a zero-length event's stays five minutes). Dismissed before the meeting starts, it comes back as it does, so every meeting's card is up at its start time. It shows one meeting at a time: when meetings overlap, the one that started last (before any has, the next to start; of two that start together, the one that ends first), and a press dismisses only that one. Turning the knob still sets the volume.

**Reminders** (set them up under Reminders on the Mac settings page): up to eight short reminders, each shown as a card like the meeting alert's, with its text, when it repeats ("Every 45 min", or the time it was set for) and **Done**. A reminder repeats on an **Interval** (every 15 minutes to 2 hours) or at **Set times** (up to six a day). An interval counts only time you're at the Mac: while it's locked, asleep or you're away from the keyboard the count pauses, and a break as long as the interval starts it over, so a reminder never fires the moment you sit back down. A set time you're away for shows once you're back. **Active hours** (any time, or chosen days and hours) keep them all to the working day. Any button or a knob press dismisses the card — that press does nothing else — and left alone it goes after a minute. A meeting's card comes first; a reminder waits under it. Turning the knob still sets the volume.

**Sleep:** the Car Thing's screen turns off whenever your Mac's display sleeps (with the Sleep setting at its default, With Mac; it can instead follow the Mac's idle time, or never sleep), when you hold the settings button, and — this part runs on the device itself — about a minute and a half after the Mac stops talking to it at all: shut down, unplugged from the Mac but still powered, or just the bridge stopped. Press any button or turn the knob to wake it; while the Mac is away it stays lit for 20 seconds, and while the Mac is only asleep, for a minute. That first input only wakes it.

The backlight is the part that wears out, so "off" means the backlight really is off, not a black page — plus the device idles its CPU and the UI stops redrawing. There's no suspend-to-RAM: the Car Thing's kernel can't resume from one, and USB would drop with it, so an idle backlit-off device drawing very little is as deep as this goes.

**Lock:** while your Mac is locked — the lock screen, or switched to another account — the backlight stays off and no button wakes it. It comes back when you log in.

**Usage pace.** Both Claude and ChatGPT show numeric pace for the session and week. An unstarted window shows **0.0x**; any pace above zero shows at least **0.1x** so it never reads as unstarted; a window at or above its allowance shows **🔥🔥🔥**. Percentages and reset times stay visible. Fire artwork is bundled for offline use from [Twemoji v16.0.1](https://github.com/jdecked/twemoji/tree/v16.0.1), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), by Twitter and other contributors.

**Settings** covers appearance (dark, light or match the Mac), the album art background, meeting alerts and Sleep (With Mac, after the Mac has been idle 30 min to 4 hr, or never). Everything else — whose usage the Clock shows, °F/°C, the clock face, 12/24-hour time, the knob volume, what works while the Mac is locked, what shows when no music is playing, the weather location, which calendars and how many days the Calendar screen shows, and reminders — is under **More settings on Mac**, which opens a settings page on your Mac at http://127.0.0.1:4747.

### Before you grant anything

Nothing is required for the device to work: Now Playing and the clock need no permissions at all. The other screens say what they need, in place:

| Screen                                    | Without permission                                          | How it's fixed                                 |
| ----------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Now Playing                               | works; shows the perpetual calendar when nothing is playing | —                                              |
| Calendar                                  | "Calendar access is off", naming the System Settings pane   | allow Calendars for Car Thing Helper           |
| Weather                                   | "Location access is off" with the place-picker hint         | allow Location, or pick a city on the Mac page |
| Clock                                     | works; no event line or meeting timer until Calendar is allowed | allow Calendars for Car Thing Helper           |
| Clock → Claude usage                      | "Not signed in to Claude" or "Claude sign-in expired"       | run `claude auth login` in Terminal; Always Allow the Keychain prompt |
| Back button (favorite)                    | toast: "Allow musicctl to control Music"                    | allow Automation for musicctl                  |
| Knob on an output with no software volume | "No volume control on <device>"; under Knob → Volume: Auto, Spotify or Apple Music playing turns its volume instead, and with nothing playing it says "No music playing" | play from Spotify or Music, or use an output that has volume |
| Knob on Spotify's or Apple Music's volume | toast: "Allow control of Spotify in Automation"            | allow Automation for node to control the app   |
| Bridge not running                        | "Waiting for your Mac"                                      | start it, or `npm run install-agent`           |

## What you need

- **A Mac** running macOS 15.4 or later (developed on macOS 27), with the Xcode command-line tools (`xcode-select --install`).
- **Node 22 or later.**
- **adb:** `brew install android-platform-tools`.
- **A Car Thing with ADB access**, meaning community-modified firmware such as the Thing Labs / DeskThing image based on Spotify's 8.9.2. Plug it in by USB and check that `adb devices -l` lists `product:spotify-car-thing`.

## Setup (once)

```bash
git clone https://github.com/srcurran/MacThing.git
cd MacThing
npm ci                 # installs the locked Vue/Vite dependencies
npm run build          # builds the Vue UI and native helpers, then self-tests the media adapter
npm run setup-device   # makes the Car Thing boot into this UI (reversible; see "Undo")
npm run install-agent  # starts the bridge now and at every login
```

That's it. Within a few seconds the Car Thing switches to Now Playing, or to the Clock if nothing is playing.

Re-run `npm run setup-device` if the bridge logs `boot web app not pointed at our UI yet`, `no sleep watchdog` or `stock dimmer still running`. The rootfs edit normally survives a reboot, but it has been seen to revert, and a device that's been reflashed or restored will need it again. Nothing breaks meanwhile — the bridge points the device at this UI on every connect — but until you do, the Car Thing shows Spotify's own app before the bridge connects, doesn't sleep on its own when the Mac goes away, and dims whenever a hand covers the light sensor.

The first time you favorite a song with the back button, macOS asks whether **musicctl** may control Music. That's `native/bin/musicctl`, a small helper that sends the favorite and play commands to Apple Music.

The first time the knob turns Spotify's or Apple Music's own volume, macOS asks whether **node** (the bridge) may control that app — once for each app. The app has to be running already; the knob never launches it.

The first time the Weather and Calendar screens load, macOS asks whether **Car Thing Helper** may use your location and your calendars. That's `native/bin/CarThingHelper.app`, a small helper so these permissions don't go to Node or Terminal. If you decline location, pick a place in Settings instead. You can change either answer later in System Settings → Privacy & Security.

## Launching

The Car Thing is only a display. The work happens in the **bridge**, a small Node program on your Mac (`bridge/main.js`). It reads Now Playing and the volume, and drives the Car Thing over USB. The Car Thing shows "Waiting for your Mac" whenever the bridge isn't running.

### Automatically at login (recommended)

`npm run install-agent` installs a per-user LaunchAgent at `~/Library/LaunchAgents/com.carthing.bridge.plist`. macOS then starts the bridge when you log in and restarts it if it ever exits. There's nothing to open or keep running yourself. Unplugging, replugging or rebooting the Car Thing is handled automatically.

```bash
npm run status          # is it running?
npm run logs            # follow the log (~/Library/Logs/carthing-bridge.log)
npm run restart         # restart it, e.g. after pulling updates
npm run uninstall-agent # stop it and remove it from login
```

The agent records the absolute path of the `node` you installed it with. If you later remove that Node version (for example with nvm), run `npm run install-agent` again.

### Manually

```bash
npm start       # runs in the foreground; Ctrl-C to stop
npm run dev     # rebuilds Vue and redeploys on source changes; logs raw knob/button events
```

Don't run a manual copy while the agent is running, because both would fight over the device. Run `npm run uninstall-agent` first, and `npm run install-agent` when you're done.

### After pulling updates

```bash
npm ci                # install dependency updates from the lockfile
npm run build         # needed if native/ changed; also builds the Vue UI
npm run restart       # rebuilds Vue, restarts the bridge, and deploys the compiled UI
npm run setup-device  # only if you set the device up before the sleep watchdog or the dimmer existed
```

## Customizing

**Everyday settings.** Use the device's Settings screen (fifth top button) or http://127.0.0.1:4747 on the Mac. The Mac page has a sidebar of categories — Appearance, Controls, Calendar, Weather, Clock, AI usage and Reminders — each opening its own panel. They're saved in `~/Library/Application Support/carthing-now-playing/settings.json`.

A few of them change how the device behaves:

- **Knob → Volume:** *Auto* (the default) turns the Mac's output volume, and when the output has no volume of its own — an HDMI or DisplayPort monitor, which shows "No volume control on <device>" — the playing app's volume instead, if that's Spotify or Apple Music. *Mac output* is the output only; *Spotify* and *Apple Music* always turn that app's own volume slider (the volume pill then shows that app's icon in place of the speaker).
- **When no music is playing → Show** and **After** (General on the Mac page): once nothing has played for 1–10 minutes while Now Playing is up, the device switches to Weather, the Clock or Calendar. When music starts again it goes back to Now Playing, unless you've moved off that screen yourself. It never leaves another screen you picked, Settings, a meeting alert or a running timer. *Date* (the default) turns it off, so Now Playing stays and shows the perpetual calendar.
- **When no music is playing → Cycle screens** (Appearance on the Mac page): every 15 seconds to 2 minutes while nothing is playing, the device moves on to the next screen in button order — Now Playing (the perpetual calendar, or the paused track), Calendar, Weather, Clock — and round again. A button press or knob turn holds it on the screen it's on for at least a minute. When music starts it goes back to Now Playing, unless you picked the screen that's up. It never moves off Settings, a meeting alert or reminder, a running, paused or finished timer, or a screen the device is held on while the Mac is locked. While it's on, it takes the place of **Show** and **After**. *Off* is the default.
- **Sleep and lock → Sleep:** *With Mac* (the default) turns the screen off while the Mac's display sleeps or the Mac is locked. *Mac idle 30 min* to *Mac idle 4 hr* turn it off once the Mac has gone that long without keyboard or mouse input, like a screen saver (and while the Mac sleeps). *Never* keeps it on. A button or knob press wakes it for a minute. The device's own sleep when the Mac goes away is separate (`deviceSleepSeconds`).
- **Sleep and lock → When Mac is locked** (with Sleep set to anything but *With Mac*): *Everything works* leaves the device as it is; *Now Playing only*, *Weather only*, *Calendar only* or *Clock only* hold the device on that screen until the Mac unlocks, with the top buttons and Settings off and the knob and back button only working the volume and playback.

**Hardware mapping and behavior.** Edit `bridge/config.js`, then `npm run restart`:

- `buttons`: what each button does (`screen:<name>`, `settings`, or a media command)
- `knobClicks` and `multiClickMs`: the single, double and triple press actions, and how long a single press waits for more
- `buttonClicks`: buttons that count presses the same way — by default the back button, once to favorite and twice to unfavorite
- `volumeStep`: volume change per knob click
- `knobDirection`: `1` matches Spotify's own mapping (turning right raises the volume); `-1` flips it
- `screenWakeMs`: how long a button or knob press wakes the screen once the Sleep setting has turned it off
- `buttonHolds` and `holdMs`: what a held button does (`sleep` by default on the settings button) and how long the hold is. A button with a hold acts on release, so one press isn't both things
- `deviceSleepSeconds`, `deviceWakeSeconds`, `devicePowersave`: the device's own sleep once the Mac goes quiet — how long it waits, how long an input wakes it for, and whether it also idles the CPU. Changes reach the device the next time the bridge connects (`npm run restart`)
- `macVolumeIndicator`: see below

**macOS volume pop-up.** The knob presses the Mac's volume keys, so macOS shows its volume pop-up. That needs `native/bin/MacThingVolume` allowed under **System Settings → Privacy & Security → Accessibility** (on macOS 27, **Device Control and Data Access**); the first time you turn the knob without it, macOS asks and the Car Thing shows "Allow MacThingVolume on your Mac". Apple's prompt can close on its own after a few seconds; its button opens that list, where MacThingVolume is already added: switch it on. macOS only asks once, so if the prompt closes before you get to it, open that list yourself and switch MacThingVolume on. No restart needed either way. macOS requires that permission for any software that generates keystrokes. A physical keyboard doesn't need it because its keys come from hardware. Until it's allowed, the knob sets the volume directly: the Sound menu reflects the change, but there's no pop-up. To keep it that way without the permission, set `macVolumeIndicator: false`.

The permission belongs to that exact build of `MacThingVolume`, so `native/build.sh` only rebuilds it when its source changes. It compares the source's contents with a hash it keeps in `native/bin/MacThingVolume.srchash`, so a `git pull` or branch switch that leaves the file unchanged doesn't rebuild it. If it does rebuild, the switch can still read on while the bridge logs that it needs access: remove `MacThingVolume` from the list with **−**, restart the bridge, and turn the knob to be asked again.

## Undo

```bash
npm run uninstall-agent   # remove the login item
npm run restore-device    # put Spotify's original web app and config back, then reboot the Car Thing
```

## Design

Every screen is drawn in the Figma file [MacThing](https://www.figma.com/design/Xw7pn5j4QZ8Ns237keo3ev/MacThing?node-id=0-1) — Now Playing and its states, the three widgets, Settings, and light copies of them all. The type scale is by size, so the same numbers turn up everywhere:

- 104 / 120 semibold, Merriweather: the big number (weather temperature, clock date, calendar time, the timer, Claude usage's level)
- 30 regular, Merriweather: the numerals on the Numbers clock face
- 40 / 56 semibold, Merriweather: the song title
- 32 / 40 semibold: second line of a panel, weather conditions
- 22 / 28: everything else, in bold, semibold, medium, regular or light by role — nothing is smaller
- panel and square insets: 48 top and bottom, 24 left, 64 right so the knob's dial doesn't cover anything

Inter is bundled in weights 300–700, plus variable Merriweather for the song title and the big numbers.

## How it works

```
Mac                                                         Car Thing (USB)
────────────────────────────────────────────                ─────────────────────────────────
bridge/main.js (Node, no npm deps)
 ├─ Now Playing ← /usr/bin/perl + MediaRemoteAdapter        Chromium 69 kiosk
 │               (streams JSON; also sends play/next/…)       file:///…/webapp/index.html
 ├─ Volume     ⇄ native/bin/MacThingVolume (CoreAudio)         → symlink → /var/lib/carthing/ui
 ├─ App badges ← native/bin/appinfo (name + icon)             Vue app (compiled locally)
 ├─ Location, calendar ← native/bin/CarThingHelper.app
 ├─ Sleep/lock  ← native/bin/powerwatch (IOKit + CGSession; holds sleep ≤3 s to kill the backlight)
 ├─ Heartbeat  ── adb shell → /tmp/carthing-heartbeat ───▶     sleepd.sh (backlight off when it stops)
 ├─ Weather    ← Open-Meteo (HTTPS)
 ├─ Settings page http://127.0.0.1:4747
 └─ Device link ── adb forward tcp:22222 → tcp:2222 ──────▶     (Chromium devtools port)
      Mac → page: Runtime.evaluate(__carthingReceive(msg))
      page → Mac: __carthingSend(json) (Runtime.addBinding)
      UI sync: adb push dist/ui/ → /var/lib/carthing/ui when its hash changes
```

The page on the device never touches the network. The Mac drives it over the Chrome DevTools Protocol.
Buttons and the knob reach the page as ordinary `keydown` (`1`–`4`, `Enter`, `Escape`, `m`) and `wheel` (`deltaX` ±53 per click) events, and the page forwards actions to the Mac.
`npm run screenshot out.png` captures what the device is showing.

## The device

The device this was built on runs Spotify's final firmware, `v8.9.2`, community-modified:

- root `adbd` plus an RNDIS gadget (`/etc/init.d/S49usbgadget`)
- Chromium 69 kiosk run by supervisord with `--remote-debugging-port=2222`
- Weston compositor
- 32-bit userland on a 64-bit kernel, 512 MB RAM

`npm run setup-device` changes four things, and `npm run restore-device` reverts all of them:

- `/usr/share/qt-superbird-app/webapp` becomes a symlink to `/var/lib/carthing/ui`. Spotify's original is kept as `webapp.spotify`.
- Spotify's background app (`qt-superbird-app`) no longer autostarts. It was using about 15% CPU on wake-word listening and Bluetooth pairing. The original config is kept as `/etc/supervisord.conf.spotify`.
- `device/sleepd.sh` is installed at `/var/lib/carthing/sleepd.sh` and registered with supervisord as `carthing-sleep`, so the device can sleep without the Mac (below). The bridge keeps the script and its `sleep.conf` up to date on every connect; `supervisorctl status carthing-sleep` and `/tmp/carthing-sleep.log` on the device show what it's doing.
- supervisord's `backlight` program runs `device/dimmerd.sh` (installed at `/var/lib/carthing/dimmerd.sh`) instead of Spotify's `sp-als-backlight`. See [Auto-brightness](#auto-brightness).

### Auto-brightness

The light sensor sits where your hand goes when you reach for the knob or a button. Spotify's `sp-als-backlight` sets the backlight straight from each reading, so the screen dimmed under your fingers. `dimmerd.sh` uses the same curve, taken from that daemon's own log, but it only dims once every reading for `deviceDimDelaySeconds` (10) has been darker. It then dims only as far as the brightest of those readings. Getting brighter happens on the next one-second reading.

- It keeps the `backlight` program name, so the bridge and `sleepd.sh` still stop it while the screen is off and start it again when the screen comes back.
- When it starts, it keeps whatever brightness is already lit. The screen is often woken by a press, with the hand still over the sensor.
- It sets the level through `/sys/class/backlight/aml-bl/brightness`. On this panel a higher number is dimmer: 235 in the dark, about 130 in a lit room. Its log, with each dim it made, goes to `/var/log/backlight.info` on the device.
- It doesn't serve the stock daemon's `/tmp/light` socket, which only Spotify's own app read.

### Sleeping without the Mac

Nothing on the Mac can turn the backlight off once the Mac is gone, so the device watches for the Mac instead:

- while the bridge is connected it writes `/tmp/carthing-heartbeat` every 10 seconds — a counter plus the screen state it wants. The bridge still owns the backlight; `sleepd.sh` only reads along.
- when that file stops changing for `deviceSleepSeconds`, the Mac isn't there any more: `sleepd.sh` stops the ambient-light daemon, writes `0` to `/sys/class/aml_bl/power` and idles the CPU. This kernel's governors are `interactive performance schedutil` — there's no `powersave` — so it uses `schedutil` where it exists and otherwise caps the clock to its lowest step.
- it wakes on any input by reading `/dev/input/event*` in the background. evdev hands every reader its own copy of each event, so Chromium still sees the same press.
- when the heartbeat starts changing again it puts the governor back and hands the screen over in whatever state the heartbeat last asked for.

The page does its own small version of this: after the same timeout with no messages it renders black, so the screen isn't showing "Waiting for your Mac" all night even on a device where the watchdog isn't installed.

### Gotchas

- **Never run `adb reverse`.** It crashes this adbd, the USB gadget unbinds, and the device disappears from USB until it's power-cycled. That's why everything goes Mac → device.
- **adb's server loses the device when the Mac sleeps.** This is the common one, and it isn't the Car Thing's fault: after a sleep the device is still on the USB bus — `ioreg -p IOUSB | grep Superbird` finds it — while `adb devices` stays empty and no `track-devices` event ever arrives. `adb kill-server` brings it straight back. The bridge does that itself once the device has been missing for `adbRestartMs`, and polls every 30s because a stale server sends no events to react to. Straight after the Mac wakes — when this nearly always happens — it only waits 8s, since a device missing at that moment is far more likely to be a stale list than a real absence.
- **Behind a USB hub, the device can also lose the bus outright.** On a monitor hub the Car Thing saw `not attached` and needed the gadget rebinding; on a port directly on the Mac, across the same sleep, it stayed `configured` and needed nothing. `/etc/init.d/S49usbgadget` only builds the gadget at boot, so when it does wedge, replugging the cable isn't enough while the device still has power — it has to lose power completely. `sleepd.sh` rebinds the UDC itself after `deviceUsbHealSeconds` of silence, immediately on a button press, and immediately when the controller's state changes while the Mac is quiet — that last one is the host coming back. All three only act while no host has the gadget configured, so they can't interrupt a working link.
- macOS has no RNDIS driver, so the device's USB network interface is unused.
- The kernel has no USB HID gadget driver, so the Car Thing can't simply act as a USB media-key device.
- The device clock is never set, so the idle clock uses the Mac's time and timezone.
- The backlight switch is `/sys/class/aml_bl/power` (`echo 0|1`). The standard `/sys/class/backlight/aml-bl/bl_power` accepts writes and does nothing, and its `brightness` only sets the level, so neither turns the LEDs off. Writing either leaves them lit while the page goes black.
- `npm run setup-device` doesn't survive a power cycle (see Setup).
- Userland is 32-bit, so a raw `input_event` is 16 bytes, not 24. This matters only if you read or inject `/dev/input/event*` yourself.
- The UI must be plain ES2017 and CSS that Chromium 69 supports: no `?.`, `??`, flex `gap`, `inset`, `aspect-ratio` or `clamp()`.

## Troubleshooting

**The device isn't showing up.** One command tells you which half is wrong:

```bash
ioreg -p IOUSB -w0 -l | grep -i superbird; adb devices
```

- Listed by `ioreg` but not by `adb devices` → adb's server has gone stale, which it does across Mac
  sleep. `adb kill-server` fixes it instantly; the bridge now does this for you.
- Listed by neither → the device is off the USB bus. Its gadget is only built at boot, so a replug
  isn't enough while it still has power from a hub — unplug it completely for ten seconds. The
  device's own watchdog also rebinds the gadget itself, and a button press triggers that at once.

**The screen is dark.** That's usually correct: it follows your Mac's display, goes off while the Mac
is locked, and the device blanks itself when the bridge stops talking to it. Press a button — one
press only wakes it. If it stays dark with the Mac awake and unlocked, check `npm run status` and
`npm run logs`.

**The screen is black but the backlight is on.** Only possible on firmware where
`/sys/class/aml_bl/power` is missing; see the gotcha below.

**Nothing playing, but something is.** Whatever macOS shows in Control Center's Now Playing is what
this shows. If Control Center is also empty, `npm run build` self-tests the MediaRemote adapter.

**Watchdog and boot web app warnings in the log.** Run `npm run setup-device`.

## Known limitations

- **Now Playing relies on a workaround.** Since macOS 15.4, Apple only lets its own entitled processes read MediaRemote. [ungive/mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) gets around this by running inside `/usr/bin/perl`, which Apple signs. `npm run build` self-tests it. A future macOS update could break it. An AppleScript fallback for Music.app would be the plan B, and `bridge/nowplaying/mediaremote.js` documents the interface such a source would implement.
- **Only one source at a time.** Control Center can list several players; this shows the one macOS considers current.
- **Browser video artwork.** macOS only gets a small thumbnail for browser video. When the playing tab is in Chrome, Safari, Arc, Brave, Edge, Vivaldi or Opera, the bridge finds it by title and loads a larger image instead (for YouTube, the full-size thumbnail; otherwise the page's `og:image`). The first time, macOS asks to let the bridge control that browser; if you decline, you get the small thumbnail. The art is still centre-cropped to the square panel, so the sides of a 16:9 frame are cut off. If the browser supplies the default Chromium icon instead of a thumbnail, the device shows its generic music-note placeholder.
- **Non-Latin scripts.** The device has no CJK font, so Japanese, Chinese or Korean titles render as boxes. Adding a Noto Sans CJK subset to `ui/fonts` would fix it.
- **Volume depends on the output device.** HDMI, S/PDIF and some USB DACs have no software volume. The screen then says "No volume control on …".
- **Weather data.** Your location leaves the Mac rounded to about 1 km, and only to Open-Meteo. Hourly and daily labels use the forecast place's own timezone.
- **Rebuilding the helper can reset its permissions.** `CarThingHelper.app` is ad-hoc signed, so after changing and rebuilding `native/helper/` macOS may ask for Location and Calendars again. `npm run build` skips the helper, `musicctl` and `MacThingVolume` unless their source's contents changed (a `.srchash` file next to each records what it was built from), so pulling or switching branches doesn't reset their permissions.
- **Single press delay.** A single knob or back-button press waits `multiClickMs` (350 ms) to see whether a second press follows, so play/pause reacts slightly later than it would without double and triple presses.
- **No real suspend.** Sleep means backlight off, CPU idled and the UI stopped redrawing. Chromium stays loaded so waking is instant, and the device keeps drawing a little current as long as the cable does.
- **Waking takes up to a second.** While the Mac is away, `sleepd.sh` notices a button or knob event on its next one-second poll rather than instantly.

## Layout

```
bridge/           Mac-side Node app (config.js: buttons, knob, volume…; settings.js: user settings)
  nowplaying/     MediaRemote source, artwork re-encoding (native/bin/artwork → ≤480px JPEG + blurred background and its tint), app names/icons
  widgets/        weather (Open-Meteo) and calendar feeds
  mac/            CarThingHelper wrapper, Mac light/dark detection
  settings-page/  the http://127.0.0.1:4747 page
  audio/          MacThingVolume wrapper
  device/         adb, minimal CDP client, UI sync, connection lifecycle
native/           Swift helpers + build script (output in native/bin, git-ignored)
  helper/         CarThingHelper.app source (location + calendar)
ui/               device UI source (Vue 3, 800×480)
  src/            App.vue, reactive bridge state, components/, screens/
  js/             core.js (hardware input, channel, sleep and volume logic)
  css/app.css     one stylesheet: tokens, components, bespoke controls, then utility classes
dist/ui/          generated device bundle and local assets (git-ignored)
vite.config.js    Vue compiler and Chromium 69 classic-script build
device/           sleepd.sh (sleep watchdog) and dimmerd.sh (auto-brightness), installed by setup-device
scripts/          device setup/restore, screenshots, LaunchAgent
  util/           one-off comparisons (art-compare.js: album art background versions side by side)
vendor/           mediaremote-adapter source (cloned by native/build.sh, git-ignored)
.github/workflows release.yml: a version bump in package.json merged to main publishes release v<version>
```

## Contributing

Issues and pull requests are welcome, especially from anyone running different Car Thing firmware —
the device-side assumptions in `device/sleepd.sh`, `device/dimmerd.sh` and `scripts/setup-device.sh` were written against
one image and one panel, and are the most likely things to differ.

The device UI is a Vue 3 app. Repeated layouts live in `ui/src/components/`; screens supply
props and named slots, and `ui/src/state.js` connects bridge messages to reactive data.
The existing hardware-input and reconnect protocol lives in `ui/js/core.js`.

Presentation has one owner: `ui/css/app.css` defines shared typography and component
styles. Layout (display, direction, alignment, gap) comes from a small set of single-purpose
utility classes at the end of the stylesheet, such as `.flex-col`, `.gap-12` and `.fill`. A class
named after what something is (`.volume-hud`, `.art-layer`) keeps its own rules when it does
several things. Components own their wrappers and default classes; screens pass content.
For example, `<LeftRail :eyebrow="artist" :title="title" :subtitle="album" variant="media" />`
needs no repeated text classes. Named slots supply inner content, not another styled
paragraph. The rail defaults to the large widget layout; `media`, `time`, and
`instructions` variants handle real differences. Forecast and settings rows follow
the same content-prop pattern. Keep bespoke geometry (clock hands, progress bars)
in its own section of the shared stylesheet. Measured font-size overrides are documented
beside both the CSS fallback and the measuring code.

`npm run build:ui` creates `dist/ui/`. Vite targets Chromium 69 and emits a single classic
script (IIFE), because the kiosk loads via `file://`. No server, CDN, or network access is
needed on the device. The build copies the existing fonts, SVG hands, and CSS locally.
CSS must still avoid flex `gap` (the `.gap-*` utilities use margins instead), `inset`, `aspect-ratio`, and `clamp()`; JavaScript syntax
is transpiled, but new browser APIs still require compatibility checks.

`npm run restart` automatically rebuilds the UI before restarting the bridge.
`npm run dev` rebuilds source changes and deploys only after a successful build, then reopens the
screen and view you were on (the weather's Today, the calendar's month, the clock's timer).
Run `node scripts/verify-device-ui.js` with a connected device for isolated screen/state
checks. It blocks outgoing commands during fixtures and reloads afterward to restore live data.
`npm run mock-screens` works the same way and rewrites the README's and the release video's screenshots in
`docs/1.0.0/`, so they always show what the device draws. Each shot has the album art background on, over
the same album as its scene in the Figma video ([docs/1.0.0/README.md](docs/1.0.0/README.md)). `npm run screenshot`
grabs whatever is on screen now. `node scripts/util/art-compare.js [covers-dir] [out-dir]` draws the album art
background four ways (current, Mac blur with the usual tint, CSS blur with mirrored edges, the original CSS
blur) over each cover in a folder, in both themes, over whatever screen is up, and writes an `index.html`
that lays them side by side.

## Credits

- The Car Thing community — [Thing Labs](https://github.com/thinglabsoss) and
  [DeskThing](https://github.com/ItsRiprod/DeskThing) — for the firmware that makes any of this
  possible, and for working out ADB access on the device in the first place.
- [ungive/mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) (BSD-3-Clause), cloned and built by `npm run build`.
- [Nihal Shetty](https://github.com/nihalshetty-boop), whose [fork](https://github.com/nihalshetty-boop/MacThing) came up with loading larger browser video artwork from the playing tab (`bridge/nowplaying/browser-art.js`).
- UI icons from [Phosphor](https://phosphoricons.com) by Helena Zhang and Tobias Fried (MIT), bundled into the UI at build time from `@phosphor-icons/core`; the weather icons are drawn in `IconSymbols.vue`.
- [Inter](https://rsms.me/inter/) by Rasmus Andersson and [Merriweather](https://github.com/EbenSorkin/Merriweather4) by Eben Sorkin (both SIL Open Font License), bundled in `ui/fonts`.

---

MIT licensed — see [LICENSE](LICENSE). Not affiliated with or endorsed by Spotify; "Car Thing" is
their trademark, and the hardware is discontinued and unsupported by them.

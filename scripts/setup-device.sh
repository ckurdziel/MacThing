#!/bin/zsh
# One-time device setup (safe to re-run). Needs the Car Thing connected with adb access.
#
#  1. Points the boot web app (/usr/share/qt-superbird-app/webapp) at /var/lib/carthing/ui,
#     keeping Spotify's original as webapp.spotify. Future UI updates then never touch the
#     read-only rootfs — the bridge just syncs /var/lib/carthing/ui.
#  2. Stops Spotify's background app (qt-superbird-app) from autostarting: with no Spotify
#     service it only burns ~15% CPU on "Hey Spotify" wake-word listening and BT pairing.
#     The original supervisord.conf is kept as supervisord.conf.spotify.
#  3. Installs device/sleepd.sh as a supervisord program, so the Car Thing turns its own
#     backlight off when the Mac stops talking to it — shut down, asleep, or unplugged from
#     everything but power. Any button or the knob wakes it.
#  4. Runs device/dimmerd.sh as supervisord's `backlight` program instead of Spotify's
#     sp-als-backlight: same brightness curve, but it waits for the room to stay darker before
#     dimming, so a hand reaching for the controls (and over the light sensor) doesn't dim it.
#  5. Turns Bluetooth off: it was for pairing with Spotify's phone app, which nothing here uses,
#     so it's only something listening. bluetoothd no longer autostarts, and device/bluetooth-off.sh
#     soft-blocks the radio at every boot (the firmware brings it up discoverable on its own).
#
# Undo everything with scripts/restore-device.sh.
set -euo pipefail

here=${0:A:h}

serial=$(adb devices -l | awk '/spotify-car-thing|Car_Thing/ && $2=="device" {print $1; exit}')
[[ -n "$serial" ]] || { echo "No Car Thing found over adb" >&2; exit 1; }

adb -s "$serial" shell 'mkdir -p /var/lib/carthing'
adb -s "$serial" push "$here/../device/sleepd.sh" /var/lib/carthing/sleepd.sh >/dev/null
adb -s "$serial" push "$here/../device/dimmerd.sh" /var/lib/carthing/dimmerd.sh >/dev/null
adb -s "$serial" push "$here/../device/bluetooth-off.sh" /var/lib/carthing/bluetooth-off.sh >/dev/null

adb -s "$serial" shell '
set -e
mkdir -p /var/lib/carthing/ui
[ -f /var/lib/carthing/ui/index.html ] || echo "<body style=\"background:#121212\"></body>" > /var/lib/carthing/ui/index.html

mount -o remount,rw /
trap "sync; mount -o remount,ro /" EXIT

cd /usr/share/qt-superbird-app
if [ ! -L webapp ]; then
  mv webapp webapp.spotify
  ln -s /var/lib/carthing/ui webapp
  echo "• boot web app → /var/lib/carthing/ui (original kept as webapp.spotify)"
else
  echo "• boot web app already points at $(readlink webapp)"
fi

if [ ! -f /etc/supervisord.conf.spotify ]; then
  cp /etc/supervisord.conf /etc/supervisord.conf.spotify
  # flip autostart only inside the [program:superbird] section
  sed -i "/^\[program:superbird\]/,/^\[/ s/^autostart=true/autostart=false/" /etc/supervisord.conf
  echo "• qt-superbird-app autostart disabled (original kept as supervisord.conf.spotify)"
else
  echo "• supervisord already modified"
fi
supervisorctl stop superbird >/dev/null 2>&1 || true

chmod +x /var/lib/carthing/sleepd.sh
if ! grep -q "^\[program:carthing-sleep\]" /etc/supervisord.conf; then
  cat >> /etc/supervisord.conf <<EOF

[program:carthing-sleep]
command=/bin/sh /var/lib/carthing/sleepd.sh
autostart=true
autorestart=true
startsecs=5
stdout_logfile=/tmp/carthing-sleep.log
redirect_stderr=true
EOF
  echo "• sleep watchdog installed (backlight off when the Mac goes away)"
else
  echo "• sleep watchdog already installed"
fi
chmod +x /var/lib/carthing/dimmerd.sh
if ! grep -q "^command=/bin/sh /var/lib/carthing/dimmerd.sh" /etc/supervisord.conf; then
  # swap the command only inside the [program:backlight] section, keeping its name: the bridge
  # and sleepd.sh stop and start it as "backlight" around turning the screen off
  sed -i "/^\[program:backlight\]/,/^\[/ s|^command=.*|command=/bin/sh /var/lib/carthing/dimmerd.sh|" /etc/supervisord.conf
  echo "• dimmer installed (a hand on the controls no longer dims the screen)"
else
  echo "• dimmer already installed"
fi
if sed -n "/^\[program:bluetoothd\]/,/^\[/p" /etc/supervisord.conf | grep -q "^autostart=true"; then
  sed -i "/^\[program:bluetoothd\]/,/^\[/ s/^autostart=true/autostart=false/" /etc/supervisord.conf
  echo "• bluetoothd no longer starts (nothing here uses Bluetooth)"
else
  echo "• bluetoothd already off"
fi
if ! grep -q "^\[program:carthing-bluetooth-off\]" /etc/supervisord.conf; then
  cat >> /etc/supervisord.conf <<EOF

[program:carthing-bluetooth-off]
command=/bin/sh /var/lib/carthing/bluetooth-off.sh
autostart=true
autorestart=false
startsecs=0
stdout_logfile=/tmp/carthing-bluetooth-off.log
redirect_stderr=true
EOF
  echo "• Bluetooth radio blocked at every boot"
else
  echo "• Bluetooth radio already blocked at boot"
fi
tmpmount=$(grep " /tmp " /proc/mounts || true)
case "$tmpmount" in *tmpfs*) ;; *) echo "  warning: /tmp is not tmpfs — the heartbeat file would write to flash" ;; esac
'
# `update` restarts the backlight program for its new command, even if the bridge had stopped it
# for the screen being off. Put it back the way it was so it stays out of the way until screen-on.
adb -s "$serial" shell '
lit=yes
supervisorctl status backlight 2>/dev/null | grep -q STOPPED && lit=no
supervisorctl reread >/dev/null 2>&1; supervisorctl update >/dev/null 2>&1
[ "$lit" = no ] && supervisorctl stop backlight >/dev/null 2>&1
supervisorctl start carthing-sleep >/dev/null 2>&1; supervisorctl stop bluetoothd >/dev/null 2>&1
supervisorctl start carthing-bluetooth-off >/dev/null 2>&1
supervisorctl status carthing-sleep backlight bluetoothd carthing-bluetooth-off'
echo "Done. Start the bridge (npm start) — it deploys the UI and takes over the screen."

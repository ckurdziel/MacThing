#!/bin/zsh
# Reverts scripts/setup-device.sh: restores Spotify's web app and supervisord config, then reboots.
set -euo pipefail

serial=$(adb devices -l | awk '/spotify-car-thing|Car_Thing/ && $2=="device" {print $1; exit}')
[[ -n "$serial" ]] || { echo "No Car Thing found over adb" >&2; exit 1; }

adb -s "$serial" shell '
set -e
supervisorctl stop carthing-sleep >/dev/null 2>&1 || true
rm -f /var/lib/carthing/sleepd.sh /var/lib/carthing/sleep.conf /var/lib/carthing/sleepd.version
rm -f /var/lib/carthing/dimmerd.sh /var/lib/carthing/dimmer.conf /var/lib/carthing/dimmerd.version
rm -f /var/lib/carthing/bluetooth-off.sh
mount -o remount,rw /
trap "sync; mount -o remount,ro /" EXIT
cd /usr/share/qt-superbird-app
if [ -L webapp ] && [ -d webapp.spotify ]; then rm webapp && mv webapp.spotify webapp && echo "• web app restored"; fi
# The pristine copy predates the sleep watchdog, the dimmer and the Bluetooth block, so restoring it
# removes those, puts sp-als-backlight back, and starts bluetoothd again at boot (the reboot below
# also clears the soft block on the radio).
if [ -f /etc/supervisord.conf.spotify ]; then mv /etc/supervisord.conf.spotify /etc/supervisord.conf && echo "• supervisord.conf restored"; fi
'
echo "Rebooting the Car Thing…"
adb -s "$serial" shell 'sync; reboot' || true

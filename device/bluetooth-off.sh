#!/bin/sh
# Keeps the Car Thing's Bluetooth radio off (installed by scripts/setup-device.sh, run once per boot
# by supervisord). Something in the firmware's boot attaches the controller with btattach and it
# comes up discoverable even without bluetoothd; a soft rfkill block stops the kernel powering it,
# whoever asks. Waits for the controller to appear, blocks it, and exits.
i=0
while [ "$i" -lt 120 ]; do
  for r in /sys/class/rfkill/rfkill*; do
    if [ "$(cat "$r/type" 2>/dev/null)" = bluetooth ]; then
      echo 1 > "$r/soft"
      echo "bluetooth radio blocked ($r)"
      exit 0
    fi
  done
  i=$((i + 1))
  sleep 1
done
echo "no bluetooth radio appeared"

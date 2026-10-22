#!/bin/zsh
# Builds the two native pieces the bridge needs:
#   native/bin/MacThingVolume                    CoreAudio volume helper, presses the volume keys (Swift)
#   native/bin/appinfo                           app name + icon lookup by bundle id (Swift)
#   native/bin/powerwatch                        Mac sleep/wake + display sleep events (Swift)
#   native/bin/artwork                           covers for the device, and the blurred background (Swift)
#   native/bin/musicctl                          Apple Music favorite/play via Apple Events (Swift)
#   native/bin/CarThingHelper.app                location + calendar, with its own permissions (Swift)
#   native/bin/MediaRemoteAdapter.framework      ungive/mediaremote-adapter, loaded by /usr/bin/perl
# No cmake required — the adapter is small enough to build with clang directly.
set -euo pipefail

ROOT="${0:A:h:h}"
OUT="$ROOT/native/bin"
ADAPTER="$ROOT/vendor/mediaremote-adapter"
ADAPTER_TAG="v0.7.7"
# The commit that tag pointed at when it was reviewed. Tags can be moved, so the build checks this
# and stops if the checkout is anything else; bump both together after reviewing a new release.
ADAPTER_COMMIT="e3ff5021eb0875858bd05f48d2e9ba2e962d1cf6"
mkdir -p "$OUT"

if [[ ! -d "$ADAPTER" ]]; then
  git clone -q --depth 1 --branch "$ADAPTER_TAG" https://github.com/ungive/mediaremote-adapter.git "$ADAPTER"
fi
adapter_head=$(git -C "$ADAPTER" rev-parse HEAD)
if [[ "$adapter_head" != "$ADAPTER_COMMIT" ]]; then
  echo "vendor/mediaremote-adapter is at $adapter_head, not the reviewed $ADAPTER_COMMIT ($ADAPTER_TAG)." >&2
  echo "Delete vendor/mediaremote-adapter to fetch it again, or review the new code and update ADAPTER_COMMIT." >&2
  exit 1
fi
if [[ -n "$(git -C "$ADAPTER" status --porcelain)" ]]; then
  echo "vendor/mediaremote-adapter has local changes; delete it to fetch a clean copy." >&2
  exit 1
fi

echo "• appinfo, powerwatch, artwork"
swiftc -O -o "$OUT/appinfo" "$ROOT/native/appinfo.swift"
swiftc -O -o "$OUT/powerwatch" "$ROOT/native/powerwatch.swift"
swiftc -O -o "$OUT/artwork" "$ROOT/native/artwork.swift"

# Ad-hoc signed tools that hold a macOS permission lose it whenever the binary changes,
# so they're only rebuilt when their source changed. That's judged by content, not mtime:
# a git pull or checkout touches the .swift files without changing them. The hash of each
# tool's inputs is kept next to it as <name>.srchash.
src_hash() { cat "$@" | shasum -a 256 | cut -d' ' -f1 }

# needs_build <binary> <stamp> <inputs...>: true when the binary is missing or its inputs changed.
# A binary built before stamps existed is taken to match its current source, so it keeps its grant.
needs_build() {
  local bin="$1" stamp="$2"; shift 2
  [[ -x "$bin" ]] || return 0
  if [[ ! -f "$stamp" ]]; then
    src_hash "$@" > "$stamp"
    return 1
  fi
  [[ "$(<"$stamp")" != "$(src_hash "$@")" ]]
}

VOLUME="$OUT/MacThingVolume"
VOLUME_SRC=("$ROOT/native/MacThingVolume.swift")
if needs_build "$VOLUME" "$VOLUME.srchash" $VOLUME_SRC; then
  echo "• MacThingVolume (volume) — macOS will ask again before the knob can show the volume pop-up"
  swiftc -O -o "$VOLUME" $VOLUME_SRC
  codesign --force --sign - --identifier com.macthing.volume "$VOLUME" 2>/dev/null
  src_hash $VOLUME_SRC > "$VOLUME.srchash"
else
  echo "• MacThingVolume unchanged (keeping its permission)"
fi

MUSICCTL="$OUT/musicctl"
MUSICCTL_SRC=("$ROOT/native/musicctl.swift")
if needs_build "$MUSICCTL" "$MUSICCTL.srchash" $MUSICCTL_SRC; then
  echo "• musicctl (Apple Music favorite/play) — macOS will ask again to let it control Music"
  swiftc -O -o "$MUSICCTL" $MUSICCTL_SRC
  codesign --force --sign - --identifier com.carthing.musicctl "$MUSICCTL" 2>/dev/null
  src_hash $MUSICCTL_SRC > "$MUSICCTL.srchash"
else
  echo "• musicctl unchanged (keeping its permission)"
fi

APP="$OUT/CarThingHelper.app"
HELPER_BIN="$APP/Contents/MacOS/CarThingHelper"
HELPER_SRC=("$ROOT/native/helper/main.swift" "$ROOT/native/helper/Info.plist")
# The stamp sits beside the bundle, not in it, so it isn't part of the signature.
if needs_build "$HELPER_BIN" "$APP.srchash" $HELPER_SRC; then
  echo "• CarThingHelper.app (location, calendar, reminders, photos) — macOS will ask for permissions again"
  mkdir -p "$APP/Contents/MacOS"
  cp "$ROOT/native/helper/Info.plist" "$APP/Contents/Info.plist"
  swiftc -O -o "$HELPER_BIN" "$ROOT/native/helper/main.swift"
  codesign --force --sign - --identifier com.carthing.helper "$APP" 2>/dev/null
  src_hash $HELPER_SRC > "$APP.srchash"
else
  echo "• CarThingHelper.app unchanged (keeping its permissions)"
fi

echo "• MediaRemoteAdapter.framework ($ADAPTER_TAG)"
FW="$OUT/MediaRemoteAdapter.framework"
rm -rf "$FW"
mkdir -p "$FW/Versions/A/Resources"
clang -dynamiclib -arch arm64 -arch x86_64 -fobjc-arc -fvisibility=default -w \
  -I"$ADAPTER/include" -I"$ADAPTER/src" \
  "$ADAPTER"/src/adapter/*.m "$ADAPTER"/src/private/MediaRemote.m "$ADAPTER"/src/utility/*.m \
  -framework Foundation -framework AppKit -framework UniformTypeIdentifiers \
  -install_name @rpath/MediaRemoteAdapter.framework/Versions/A/MediaRemoteAdapter \
  -o "$FW/Versions/A/MediaRemoteAdapter"
cat > "$FW/Versions/A/Resources/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>MediaRemoteAdapter</string>
<key>CFBundleIdentifier</key><string>com.vandenbe.MediaRemoteAdapter</string>
<key>CFBundleName</key><string>MediaRemoteAdapter</string>
<key>CFBundlePackageType</key><string>FMWK</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>CFBundleVersion</key><string>0.1.0</string>
</dict></plist>
EOF
ln -s A "$FW/Versions/Current"
ln -s Versions/Current/MediaRemoteAdapter "$FW/MediaRemoteAdapter"
ln -s Versions/Current/Resources "$FW/Resources"
codesign --force --deep --sign - "$FW" 2>/dev/null
cp "$ADAPTER/bin/mediaremote-adapter.pl" "$OUT/"

echo "• self-test"
if /usr/bin/perl "$OUT/mediaremote-adapter.pl" "$FW" get --no-artwork >/dev/null; then
  echo "  MediaRemote adapter OK"
else
  echo "  MediaRemote adapter FAILED — now playing will not work on this macOS version" >&2
  exit 1
fi

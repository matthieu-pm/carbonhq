#!/usr/bin/env bash
# Regenerate the bundled icons from the 1024px masters in src-tauri/icons/src.
# Run after replacing a master; the outputs are committed, so this is not part
# of any build.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="src-tauri/icons/src"
OUT="src-tauri/icons"

# macOS doesn't mask custom Dock icons, so the icns needs transparent rounded
# corners and the 824/1024 inset. Flat PNGs keep the full-bleed master.
INSET=824
MARK_SIZE=80%

# `tauri::generate_context!` rejects a window icon that isn't RGBA, and magick
# happily writes a palette PNG when the resized art has few enough colours — so
# every PNG is forced to 32-bit rather than left to that heuristic.
PNG32=PNG32:

make_icns() {
  local src="$1" dest="$2" tmp iconset
  tmp="$(mktemp -d)"
  iconset="$tmp/icon.iconset"
  mkdir -p "$iconset"
  # The clear left edge preserves the master's gradient behind the smaller mark.
  magick "$src" -crop 1x1024+0+0 +repage -scale '1024x1024!' "$PNG32$tmp/background.png"
  magick -background none -density 288 ../../logos/logomark-black.svg \
    -resize 1024x1024 "$PNG32$tmp/mark-mask.png"
  magick "$src" "$tmp/mark-mask.png" -compose DstIn -composite -compose Over \
    -resize "$MARK_SIZE" +repage "$PNG32$tmp/mark.png"
  magick "$tmp/background.png" "$tmp/mark.png" -gravity center \
    -compose Over -composite +repage "$PNG32$tmp/art.png"
  magick -size 1024x1024 xc:none -fill white -stroke none \
    -draw "roundrectangle 0,0,1023,1023,224,224" "$tmp/mask.png"
  magick "$tmp/art.png" "$tmp/mask.png" -compose DstIn -composite -compose Over \
    -resize "${INSET}x${INSET}" -background none -gravity center \
    -extent 1024x1024 "$tmp/master.png"
  for pair in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
              "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
              "512 512x512" "1024 512x512@2x"; do
    local px="${pair% *}" name="${pair#* }"
    magick "$tmp/master.png" -resize "${px}x${px}" "$PNG32$iconset/icon_$name.png"
  done
  iconutil -c icns "$iconset" -o "$dest"
  rm -rf "$tmp"
}

make_flat() {
  local src="$1" dir="$2"
  magick "$src" -resize 32x32 "$PNG32$dir/32x32.png"
  magick "$src" -resize 128x128 "$PNG32$dir/128x128.png"
  magick "$src" -resize 256x256 "$PNG32$dir/128x128@2x.png"
  magick "$src" -resize 1024x1024 "$PNG32$dir/icon.png"
}

make_flat "$SRC/icon-1024.png" "$OUT"
make_icns "$SRC/icon-1024.png" "$OUT/icon.icns"
magick "$SRC/icon-1024.png" -define icon:auto-resize=256,128,64,48,32,16 "$OUT/icon.ico"

mkdir -p "$OUT/dev"
make_flat "$SRC/icon-dev-1024.png" "$OUT/dev"
make_icns "$SRC/icon-dev-1024.png" "$OUT/dev/icon.icns"

echo "icons regenerated"

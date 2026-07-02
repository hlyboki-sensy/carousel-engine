#!/usr/bin/env bash
# HTML → PNG через headless Chrome. Розмір береться з out/_size.txt (формат каруселі).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"

W=1080; H=1440
if [ -f "$OUT/_size.txt" ]; then
  read -r W H < "$OUT/_size.txt" || true
fi

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chromium || true)"
fi
[ -n "$CHROME" ] || { echo "✗ Chrome не знайдено"; exit 1; }

shopt -s nullglob
count=0
for html in "$OUT"/*.html; do
  png="${html%.html}.png"
  # --force-color-profile=srgb: нормалізує колір (фото з широким гамутом не «пересвічує»)
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$W,$H" \
    --force-color-profile=srgb --disable-color-correct-rendering \
    --virtual-time-budget=4000 \
    --screenshot="$png" "file://$html" >/dev/null 2>&1
  echo "  ✓ $(basename "$png")  (${W}×${H})"
  count=$((count+1))
done
echo "Готово: $count PNG → $OUT"

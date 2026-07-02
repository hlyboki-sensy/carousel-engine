#!/bin/bash
# Карусель-панель · Глибокі сенси — двокліковий запуск як застосунок.
# 1) піднімає движок (server.py), якщо ще не працює;
# 2) відкриває панель окремим вікном-застосунком (Chrome --app, без вкладок і адреси).
cd "$(dirname "$0")"

URL="http://127.0.0.1:8090"

# движок уже піднятий?
if ! curl -s -o /dev/null "$URL/api/config" 2>/dev/null; then
  echo "Запускаю движок…"
  nohup python3 server.py >/tmp/karusel-panel.log 2>&1 &
  for i in $(seq 1 60); do
    curl -s -o /dev/null "$URL/api/config" 2>/dev/null && break
    sleep 0.25
  done
fi

# знайти Chrome / Chromium / Edge
CHROME="/Applications/Google Chrome.app"
[ -d "$CHROME" ] || CHROME="/Applications/Chromium.app"
[ -d "$CHROME" ] || CHROME="/Applications/Microsoft Edge.app"

if [ -d "$CHROME" ]; then
  # окреме вікно-застосунок (без вкладок і адресного рядка)
  open -na "$CHROME" --args --app="$URL" --window-size=1440,960 \
    --user-data-dir="$HOME/.karusel-panel-app"
else
  # запасний варіант — звичайний браузер
  open "$URL"
fi

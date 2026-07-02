#!/usr/bin/env bash
# Компілює cutout.swift → bin/cutout (рушій Apple Vision «вирізати об'єкт»).
# Явно проти сумісного SDK, бо дефолтний SDK у системі новіший за компілятор.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# знайти найновіший сумісний SDK (15.x); дефолтний 26.x не збирається з цим swift
SDK=""
for c in MacOSX15.5.sdk MacOSX15.4.sdk MacOSX15.2.sdk MacOSX15.sdk MacOSX14.5.sdk MacOSX14.sdk; do
  p="/Library/Developer/CommandLineTools/SDKs/$c"
  [ -d "$p" ] && { SDK="$p"; break; }
done
[ -n "$SDK" ] || { echo "✗ сумісний SDK (15.x/14.x) не знайдено"; exit 1; }

echo "SDK: $SDK"
swiftc -sdk "$SDK" -target arm64-apple-macos14.0 -O -o "$HERE/cutout" "$HERE/cutout.swift"
echo "✓ bin/cutout готовий"

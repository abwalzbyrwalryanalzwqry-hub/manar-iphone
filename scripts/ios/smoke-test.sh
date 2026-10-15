#!/usr/bin/env bash
# منار ايفون — اختبار تشغيل حقيقي على محاكي iPhone.
#
# يبني التطبيق للمحاكي، يثبّته، يشغّله ويلتقط سجلّ Capacitor (رسائل console من
# الواجهة)، ثم يتنقّل بين الشاشات الرئيسية عبر رابط manar:// (المسار نفسه الذي
# يسلكه نقر الإشعار والويدجت) ويلتقط صورة لكل شاشة.
# يفشل إن انهار التطبيق، أو ظهر خطأ JavaScript غير ملتقط، أو لم تُرسم الواجهة.
#
#   bash scripts/ios/smoke-test.sh   → build/smoke/*.png و build/smoke/console.log
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="$ROOT/build/smoke"
DERIVED="$ROOT/build/DerivedDataSim"
mkdir -p "$OUT"
BUNDLE=app.manar.islamic

set -e
xcodebuild \
  -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO build > "$OUT/xcodebuild-sim.log" 2>&1 ||
  { grep -E "error:" "$OUT/xcodebuild-sim.log" | head -50; exit 1; }
set +e
APP="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"

UDID="$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
c=[x for r,l in d.items() if "iOS" in r for x in l if x["name"].startswith("iPhone")]
pref=[x for x in c if "Pro" not in x["name"] and "Plus" not in x["name"]] or c
print(pref[-1]["udid"] if pref else "")')"
[ -n "$UDID" ] || { echo "::error::لا محاكي iPhone متاح"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 2>/dev/null
xcrun simctl privacy "$UDID" grant location "$BUNDLE" 2>/dev/null
xcrun simctl install "$UDID" "$APP" || { echo "::error::فشل التثبيت"; exit 1; }

xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" > "$OUT/console.log" 2>&1 &
LAUNCHER=$!
sleep 25
xcrun simctl io "$UDID" screenshot "$OUT/01-launch.png" >/dev/null 2>&1

i=2
for route in prayer quran azkar qibla calendar notifications adhan sakinah widget reminders tasbih more; do
  xcrun simctl openurl "$UDID" "manar://$route" 2>/dev/null
  sleep 4
  xcrun simctl io "$UDID" screenshot "$OUT/$(printf %02d $i)-$route.png" >/dev/null 2>&1
  i=$((i + 1))
done

ALIVE=0
xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -q "$BUNDLE" && ALIVE=1
kill "$LAUNCHER" 2>/dev/null
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null

echo "---- console (أوّل ٢٠٠ سطر) ----"
head -200 "$OUT/console.log"
FAIL=0
if [ "$ALIVE" != 1 ]; then echo "::error::انهار التطبيق أو أُغلق أثناء الاختبار"; FAIL=1; fi
if grep -E "\[error\]|Unhandled|TypeError|ReferenceError|SyntaxError" "$OUT/console.log" | grep -v "status bar\|system bars" > "$OUT/js-errors.log"; then
  echo "::error::أخطاء JavaScript:"; cat "$OUT/js-errors.log"; FAIL=1
fi
if grep -q "manar-boot-error\|unsupported" "$OUT/console.log"; then echo "::error::حارس الإقلاع أبلغ عن خطأ"; FAIL=1; fi
exit $FAIL

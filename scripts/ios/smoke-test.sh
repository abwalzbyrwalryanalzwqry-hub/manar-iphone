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

pick() { # $1 = modern | se
  xcrun simctl list devices available -j | python3 -c '
import json,re,sys
kind=sys.argv[1]
d=json.load(sys.stdin)["devices"]
c=[x for r,l in d.items() if "iOS" in r for x in l if x["name"].startswith("iPhone")]
if kind=="se":
    c=[x for x in c if "SE" in x["name"]]
else:
    m=[x for x in c if re.fullmatch(r"iPhone \d+( Pro)?", x["name"])]
    c=sorted(m, key=lambda x:(int(re.findall(r"\d+",x["name"])[0]), "Pro" not in x["name"])) or c
print(c[-1]["udid"] if c else "")' "$1"
}
UDID="$(pick modern)"
SE_UDID="$(pick se)"
[ -n "$UDID" ] || { echo "::error::لا محاكي iPhone متاح"; exit 1; }
echo "المحاكي: $(xcrun simctl list devices | grep "$UDID" | sed "s/ (.*//" | xargs)"
xcrun simctl boot "$UDID" 2>/dev/null
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 2>/dev/null
xcrun simctl privacy "$UDID" grant location "$BUNDLE" 2>/dev/null
xcrun simctl install "$UDID" "$APP" || { echo "::error::فشل التثبيت"; exit 1; }

# ١) الإقلاع الأول (شاشات الترحيب) مع سجلّ console كاملاً.
xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" > "$OUT/console.log" 2>&1 &
LAUNCHER=$!
sleep 25
xcrun simctl io "$UDID" screenshot "$OUT/01-launch.png" >/dev/null 2>&1
ALIVE=0
xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -q "$BUNDLE" && ALIVE=1
kill "$LAUNCHER" 2>/dev/null

# ٢) كل شاشة رئيسية بإقلاعٍ بارد إلى مسارها — المسار نفسه الذي يسلكه نقر إشعار
# (أو الويدجت) والتطبيق مغلق. نافذة «فتح في منار؟» لا تظهر بهذه الطريقة.
i=2
for route in home prayer quran azkar qibla calendar notifications adhan sakinah widget reminders tasbih more about; do
  xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" -ManarSmokeRoute "/$route" \
    >> "$OUT/console.log" 2>&1 &
  LAUNCHER=$!
  sleep 9
  xcrun simctl io "$UDID" screenshot "$OUT/$(printf %02d $i)-$route.png" >/dev/null 2>&1
  xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -q "$BUNDLE" || { echo "::error::انهار على /$route"; ALIVE=0; }
  kill "$LAUNCHER" 2>/dev/null
  i=$((i + 1))
done

# ٣) الوضع الداكن.
xcrun simctl ui "$UDID" appearance dark 2>/dev/null
xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" -ManarSmokeRoute /prayer \
  >> "$OUT/console.log" 2>&1 &
LAUNCHER=$!
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/$(printf %02d $i)-prayer-dark.png" >/dev/null 2>&1
kill "$LAUNCHER" 2>/dev/null
xcrun simctl ui "$UDID" appearance light 2>/dev/null
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null

# ٤) شاشة صغيرة بلا «نتوء» (iPhone SE): الإقلاع وثلاث شاشات.
if [ -n "$SE_UDID" ] && [ "$SE_UDID" != "$UDID" ]; then
  xcrun simctl shutdown "$UDID" 2>/dev/null
  xcrun simctl boot "$SE_UDID" 2>/dev/null
  xcrun simctl bootstatus "$SE_UDID" -b >/dev/null
  xcrun simctl status_bar "$SE_UDID" override --time 9:41 --batteryState charged --batteryLevel 100 2>/dev/null
  xcrun simctl install "$SE_UDID" "$APP"
  for route in prayer quran more; do
    xcrun simctl launch --console-pty --terminate-running-process "$SE_UDID" "$BUNDLE" -ManarSmokeRoute "/$route" \
      >> "$OUT/console.log" 2>&1 &
    LAUNCHER=$!
    sleep 12
    xcrun simctl io "$SE_UDID" screenshot "$OUT/se-$route.png" >/dev/null 2>&1
    xcrun simctl spawn "$SE_UDID" launchctl list 2>/dev/null | grep -q "$BUNDLE" || { echo "::error::انهار على SE /$route"; ALIVE=0; }
    kill "$LAUNCHER" 2>/dev/null
  done
  xcrun simctl terminate "$SE_UDID" "$BUNDLE" 2>/dev/null
fi

echo "---- console (أوّل ١٢٠ سطراً) ----"
head -120 "$OUT/console.log"
FAIL=0
if [ "$ALIVE" != 1 ]; then echo "::error::انهار التطبيق أو أُغلق أثناء الاختبار"; FAIL=1; fi
if grep -E "\[error\]|Unhandled|TypeError|ReferenceError|SyntaxError" "$OUT/console.log" | grep -v "status bar\|system bars" > "$OUT/js-errors.log"; then
  echo "::error::أخطاء JavaScript:"; cat "$OUT/js-errors.log"; FAIL=1
fi
if grep -q "manar-boot-error\|unsupported" "$OUT/console.log"; then echo "::error::حارس الإقلاع أبلغ عن خطأ"; FAIL=1; fi
exit $FAIL

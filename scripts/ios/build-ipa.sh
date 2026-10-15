#!/usr/bin/env bash
# منار ايفون — يبني ملف IPA غير موقَّع للتوزيع المحدود (AltStore / SideStore /
# Sideloadly / eSign…). يُوقَّع توقيعاً مؤقّتاً (ad-hoc «-») مع الصلاحيات
# (Entitlements) مضمّنة في الملف التنفيذي، حتى تقرأها أدوات التثبيت وتعيد
# التوقيع بحساب Apple الخاص بالمستخدم مع مجموعة التطبيقات (ليعمل الويدجت).
#
#   bash scripts/ios/build-ipa.sh   → build/Manar-iPhone.ipa
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="$ROOT/build"
DERIVED="$OUT/DerivedData"
mkdir -p "$OUT"

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build | tee "$OUT/xcodebuild-device.log" | grep -E "error:|warning: .*Manar|BUILD (SUCCEEDED|FAILED)" || true
test "${PIPESTATUS[0]}" -eq 0

APP="$DERIVED/Build/Products/Release-iphoneos/App.app"
[ -d "$APP" ] || { echo "::error::App.app غير موجود"; exit 1; }
[ -d "$APP/PlugIns/ManarWidget.appex" ] || { echo "::error::الويدجت غير مضمَّن في التطبيق"; exit 1; }

# التوقيع المؤقّت من الداخل إلى الخارج: الأطر، ثم الويدجت، ثم التطبيق.
if [ -d "$APP/Frameworks" ]; then
  find "$APP/Frameworks" -maxdepth 1 \( -name "*.framework" -o -name "*.dylib" \) -print0 |
    xargs -0 -I{} codesign --force --sign - --timestamp=none "{}"
fi
codesign --force --sign - --timestamp=none \
  --entitlements ios/App/ManarWidget/ManarWidget.entitlements "$APP/PlugIns/ManarWidget.appex"
codesign --force --sign - --timestamp=none \
  --entitlements ios/App/App/App.entitlements "$APP"
codesign -d --entitlements - "$APP" 2>/dev/null | grep -q "group.app.manar.islamic" ||
  { echo "::error::الصلاحيات لم تُضمَّن في التطبيق"; exit 1; }

STAGE="$(mktemp -d)"
mkdir -p "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/"
rm -f "$OUT/Manar-iPhone.ipa"
(cd "$STAGE" && zip -qry "$OUT/Manar-iPhone.ipa" Payload)
rm -rf "$STAGE"
ls -lh "$OUT/Manar-iPhone.ipa"

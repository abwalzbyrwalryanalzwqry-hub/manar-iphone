#!/usr/bin/env bash
# منار ايفون — توقيع IPA بحساب Apple Developer مدفوع (Ad Hoc حتى ١٠٠ جهاز،
# صالح سنة كاملة، يُثبَّت من رابط مباشر بلا كمبيوتر). اختياري تماماً.
#
# المدخلات (متغيّرات بيئة):
#   IOS_CERT_P12_BASE64, IOS_CERT_PASSWORD  شهادة «Apple Distribution» بصيغة p12
#   IOS_PROFILE_APP_BASE64                  ملف تعريف Ad Hoc لـ app.manar.islamic
#   IOS_PROFILE_WIDGET_BASE64               ملف تعريف Ad Hoc لـ app.manar.islamic.widget
# المُخرج: build/Manar-iPhone-adhoc.ipa
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IN="$ROOT/build/Manar-iPhone.ipa"
OUT="$ROOT/build/Manar-iPhone-adhoc.ipa"
W="$(mktemp -d)"
trap 'security delete-keychain "$W/manar.keychain-db" >/dev/null 2>&1 || true; rm -rf "$W"' EXIT

echo "$IOS_CERT_P12_BASE64" | base64 --decode > "$W/cert.p12"
echo "$IOS_PROFILE_APP_BASE64" | base64 --decode > "$W/app.mobileprovision"
echo "$IOS_PROFILE_WIDGET_BASE64" | base64 --decode > "$W/widget.mobileprovision"

KC="$W/manar.keychain-db"
security create-keychain -p manar "$KC"
security set-keychain-settings -lut 3600 "$KC"
security unlock-keychain -p manar "$KC"
security import "$W/cert.p12" -k "$KC" -P "$IOS_CERT_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k manar "$KC" >/dev/null
security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')
IDENTITY="$(security find-identity -v -p codesigning "$KC" | awk -F'"' '/Distribution|Developer/ {print $2; exit}')"
[ -n "$IDENTITY" ] || { echo "::error::لا هوية توقيع في الشهادة"; exit 1; }

ents() { security cms -D -i "$1" > "$W/p.plist"; /usr/libexec/PlistBuddy -x -c "Print :Entitlements" "$W/p.plist" > "$2"; }
ents "$W/app.mobileprovision" "$W/app.ent"
ents "$W/widget.mobileprovision" "$W/widget.ent"

mkdir "$W/x" && (cd "$W/x" && unzip -q "$IN")
APP="$W/x/Payload/App.app"
cp "$W/app.mobileprovision" "$APP/embedded.mobileprovision"
cp "$W/widget.mobileprovision" "$APP/PlugIns/ManarWidget.appex/embedded.mobileprovision"
if [ -d "$APP/Frameworks" ]; then
  find "$APP/Frameworks" -maxdepth 1 \( -name "*.framework" -o -name "*.dylib" \) -print0 |
    xargs -0 -I{} codesign --force --sign "$IDENTITY" --keychain "$KC" "{}"
fi
codesign --force --sign "$IDENTITY" --keychain "$KC" --entitlements "$W/widget.ent" "$APP/PlugIns/ManarWidget.appex"
codesign --force --sign "$IDENTITY" --keychain "$KC" --entitlements "$W/app.ent" "$APP"
codesign --verify --deep --strict "$APP"
rm -f "$OUT"
(cd "$W/x" && zip -qry "$OUT" Payload)
ls -lh "$OUT"

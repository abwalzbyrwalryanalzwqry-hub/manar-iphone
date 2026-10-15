# البناء الآلي — منار ايفون

سير عملين في `.github/workflows`:

## `ci.yml` — التحقق (Ubuntu)

على كل دفع وطلب دمج: الأنواع (`tsc`)، التنسيق (Prettier)، ESLint، Knip، حصن المسلم
(`build-hisn.py --check`)، اختبارات Vitest (منها `tests/unit/ios-native.test.ts` التي تحرس عقود
الطبقة الأصلية: دوال إضافة Swift، مقاطع CAF، مفاتيح Info.plist، مجموعة التطبيقات)، ثم بناء الويب.

## `ios.yml` — بناء iPhone (macOS + Xcode)

1. **الخطوط:** تُجلب من المستودع الخاص إن وُجد السرّ `MANAR_FONTS_DEPLOY_KEY` (مفتاح نشر للقراءة
   فقط)، وإلا يُبنى بالخط الاحتياطي دون فشل.
2. **`npm run build:ios`:** الواجهة (هدف Safari 15) + نسخ التسجيلات الكاملة إلى `ManarAudio` +
   `cap sync ios`.
3. **XcodeGen:** `npm run ios:project` يولّد `App.xcodeproj` (التطبيق + الويدجت) برقم الإصدار من
   `package.json`.
4. **الأصوات:** كل مقطع CAF يُفحص بـ `afinfo` (صالح ومدته ≤ ٣٠ ثانية، حدّ iOS لصوت الإشعار).
5. **اختبار المحاكي:** `scripts/ios/smoke-test.sh` يبني نسخة Debug، ويشغّلها على محاكي iPhone،
   ويفتح كل شاشة رئيسية بإقلاع بارد إلى مسارها (كنقر إشعار)، ويلتقط صورة لكل شاشة وأخرى بالوضع
   الداكن. يفشل عند أي انهيار أو خطأ JavaScript. الصور والسجلّ في المخرَج `ios-smoke`.
6. **IPA:** `scripts/ios/build-ipa.sh` يبني Release للجهاز ويوقّعه مؤقتاً مع الصلاحيات ←
   `Manar-iPhone.ipa` (لـ AltStore / SideStore / Sideloadly).
7. **Ad Hoc (اختياري):** إن وُجدت الأسرار `IOS_CERT_P12_BASE64` و`IOS_CERT_PASSWORD`
   و`IOS_PROFILE_APP_BASE64` و`IOS_PROFILE_WIDGET_BASE64` يُخرج `Manar-iPhone-adhoc.ipa` موقّعاً.
8. **الإصدار:** عند دفع وسم `v*` (مثل `v1.0.1`) يُنشأ إصدار GitHub مرفقاً به ملف IPA.

## إصدار جديد

```bash
npm version patch --no-git-tag-version   # يرفع الإصدار في package.json
git commit -am "الإصدار 1.0.1" && git tag v1.0.1 && git push --follow-tags
```

رقم البناء في iOS مشتقّ من الإصدار (`major·10000 + minor·100 + patch`) فيزيد دائماً، وأدوات
التثبيت تحدّث التطبيق فوق القديم دون فقد البيانات.

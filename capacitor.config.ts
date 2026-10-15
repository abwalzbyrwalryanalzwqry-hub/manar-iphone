/// <reference types="node" />
/**
 * منار ايفون — إعداد Capacitor (iOS).
 *
 * الواجهة نفسها تماماً كما في منار؛ والخدمات الأصلية (جدولة الأذان، الصوت في
 * الخلفية، أزرار الإشعار، الويدجت) في إضافة Swift ‏`ManarAdhan` تحت
 * ios/App/App/Manar. مشروع Xcode يُولَّد بـ XcodeGen من ios/App/project.yml.
 *
 * `webDir` ناتج `npm run build:ios` (بناء ثابت بلا خادم — يعمل بلا إنترنت).
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.manar.islamic",
  appName: "منار",
  webDir: "dist/client",
  bundledWebRuntime: false,
  ios: {
    // وحدة التحكم الجذرية تضع الويب فيو داخل المنطقة الآمنة (تحت الساعة وفوق
    // شريط الرجوع للرئيسية) وتلوّن ما حولها بلون الواجهة؛ فلا هوامش إضافية هنا.
    contentInset: "never",
    backgroundColor: "#0B1F1A",
    // بلا إنترنت أولاً: كل ما تحتاجه التجربة الأساسية مضمَّن في التطبيق.
    webContentsDebuggingEnabled: false,
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      // يُخفي النظام شاشة البداية تلقائيًا بعد ٣ ثوانٍ كحدٍّ أقصى، حتى لو تعطّل
      // الويب قبل أن يطلب إخفاءها — وهذا ما كان يُبقي الشاشة الخضراء ظاهرة.
      launchAutoHide: true,
      launchShowDuration: 3000,
      launchFadeOutDuration: 250,
      backgroundColor: "#0B1F1A",
      showSpinner: false,
      iosSpinnerStyle: "small",
    },
    LocalNotifications: {
      // يظهر الإشعار وصوته حتى والتطبيق مفتوح (الأذان الكامل يتولّاه ManarAdhan).
      presentationOptions: ["banner", "list", "sound"],
    },
  },
};

export default config;

/* منار ايفون — مشاركة التطبيق.
 *
 * نسخة iPhone لا تُنشر في App Store: تُوزَّع بين الأصدقاء والعائلة من صفحة
 * الإصدارات في GitHub. فـ«قيّم التطبيق» مخفيّ، ورابط المشاركة صفحة التنزيل.
 */

import { Capacitor } from "@capacitor/core";
import { openExternalNative } from "./native-notifications";
import { copyText } from "./developer";

/**
 * هل صفحة منار في Google Play منشورة؟ ما دامت `false` يُخفى «قيّم التطبيق»،
 * لأن رابط التقييم يفتح صفحة غير موجودة. تُقلب إلى `true` في إصدار النشر.
 */
export const PUBLISHED_ON_PLAY = false;

export const APP_ID = "app.manar.islamic";
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${APP_ID}`;
export const PLAY_MARKET_URL = `market://details?id=${APP_ID}`;

/** صفحة تنزيل نسخة iPhone (ملف IPA وطريقة التثبيت). */
export const IPHONE_DOWNLOAD_URL =
  "https://github.com/abwalzbyrwalryanalzwqry-hub/manar-iphone/releases/latest";

export const SHARE_TEXT = `منار — مواقيت الصلاة والقرآن الكريم والأذكار والقبلة، بلا إعلانات وبلا حساب.\nنسخة iPhone: ${IPHONE_DOWNLOAD_URL}`;

/** يفتح صفحة منار في Google Play. يعيد `false` إن لم يُفتح شيء. */
export async function rateApp(): Promise<boolean> {
  const native = await openExternalNative([PLAY_MARKET_URL, PLAY_URL]);
  if (native != null) return native;
  if (typeof window === "undefined") return false;
  try {
    return window.open(PLAY_URL, "_blank", "noopener,noreferrer") !== null;
  } catch {
    return false;
  }
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** يشارك رابط منار: نافذة المشاركة في الجوال، أو `navigator.share`، أو النسخ. */
export async function shareApp(): Promise<ShareOutcome> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "منار", text: SHARE_TEXT, dialogTitle: "مشاركة منار" });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  const nav = navigator as Navigator & { share?: (data: { text: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ text: SHARE_TEXT });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  return (await copyText(SHARE_TEXT)) ? "copied" : "failed";
}

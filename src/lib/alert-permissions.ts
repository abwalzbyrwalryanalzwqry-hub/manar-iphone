/**
 * منار — أذونات التنبيه الثلاثة وحكمها على الأذان.
 *
 * ثلاثة أذونات من النظام تقرّر هل يصل الأذان والتطبيق مغلق، وكيف:
 *
 * - **الإشعارات** (أندرويد ١٣+): بدونها لا يظهر أيّ إشعار — لا دخول الوقت
 *   ولا التذكيرات ولا زرّ إيقاف الأذان. الأذان نفسه يُسمع (خدمة أمامية)،
 *   فجدول الأذان لا يتوقف على هذا الإذن أبداً.
 * - **المنبّهات الدقيقة** (أندرويد ١٢+، وممنوع افتراضياً منذ ١٤): بدونه يتأخّر
 *   المنبّه، **ولا يُجيز النظام بدء خدمة الصوت من الخلفية** — فيصير الأذان إشعاراً
 *   مكتوباً فقط، إلا إن كان التطبيق مستثنىً من تحسين البطارية.
 * - **البطارية** («غير مقيّد»): استثناء يُجيز بدء خدمة الصوت ولو بلا منبّه دقيق،
 *   ويمنع الشركات المصنِّعة المتشدّدة من قتل التطبيق.
 *
 * الدوالّ هنا نقيّة (تُختبر بلا جهاز)، والقراءة الفعلية في `readAlertPermissions`.
 */

import { isIOSApp } from "@/lib/ios";

export type NotificationPermissionState = "granted" | "denied" | "prompt" | "unsupported";

export type AlertPermissions = {
  notifications: NotificationPermissionState;
  exactAlarms: boolean;
  batteryUnrestricted: boolean;
  /** مستوى واجهة أندرويد (0 خارج أندرويد). */
  sdk: number;
};

export type PermissionKey = "notifications" | "exact" | "battery";

/** ما ينقص الآن، بترتيب الأهمية. */
export function missingPermissions(p: AlertPermissions): PermissionKey[] {
  const out: PermissionKey[] = [];
  if (p.notifications !== "granted") out.push("notifications");
  if (!p.exactAlarms) out.push("exact");
  if (!p.batteryUnrestricted) out.push("battery");
  return out;
}

/**
 * ماذا يحدث للأذان والتطبيق مغلق:
 * - `ok`: يُسمع في وقته.
 * - `late`: يُسمع، لكن قد يتأخّر دقائق (بلا منبّه دقيق، مع استثناء البطارية).
 * - `silent`: لن يُسمع — يصل إشعاراً مكتوباً فقط (أندرويد ١٢+ بلا الإذنين).
 */
export type AdhanVerdict = "ok" | "late" | "silent";

export function adhanVerdict(
  p: Pick<AlertPermissions, "exactAlarms" | "batteryUnrestricted" | "sdk">,
): AdhanVerdict {
  if (p.exactAlarms) return "ok";
  // قبل أندرويد ١٢ لا إذن للمنبّهات الدقيقة ولا قيد على بدء الخدمة من الخلفية.
  if (p.sdk > 0 && p.sdk < 31) return "ok";
  return p.batteryUnrestricted ? "late" : "silent";
}

/** جملة واحدة للمستخدم تصف حكم الأذان. `null` إن كان كل شيء سليماً. */
export function verdictMessage(p: AlertPermissions): string | null {
  const v = adhanVerdict(p);
  if (v === "silent") {
    return "لن يُسمع الأذان والتطبيق مغلق: يصل إشعاراً مكتوباً فقط. اسمح بالمنبّهات الدقيقة.";
  }
  if (v === "late")
    return "إذن «المنبّهات والتذكيرات» غير ممنوح — قد يتأخّر الأذان والإقامة دقائق.";
  if (p.notifications !== "granted") {
    /* iOS: الأذان نفسه إشعار — بلا إذن الإشعارات لا يصل شيء إطلاقاً. */
    if (isIOSApp()) {
      return "الإشعارات معطّلة لمنار — على iPhone لن يصل الأذان ولا أي تنبيه. فعّلها من الإعدادات ← منار ← الإشعارات.";
    }
    return "الإشعارات معطّلة لمنار — يُسمع الأذان، لكن لا يظهر أي تنبيه مكتوب ولا زرّ لإيقافه.";
  }
  return null;
}

/* ------------------------- نافذة الأذونات ------------------------- */

/** مفتاح الإخفاء القديم: كان «1» يُخفي النافذة للأبد. */
export const LEGACY_DISMISS_VALUE = "1";

/**
 * قيمة تُحفظ عند «لاحقاً»: ما كان ناقصاً وقت الإخفاء. تعود النافذة فقط إن نقص
 * شيءٌ جديد لم يكن ناقصاً حينها — فلا إلحاح، ولا صمتَ إن سُحب إذنٌ لاحقاً.
 */
export function dismissValue(missing: PermissionKey[]): string {
  return JSON.stringify([...missing].sort());
}

export function shouldShowReliabilityPrompt(
  missing: PermissionKey[],
  stored: string | null,
): boolean {
  if (missing.length === 0) return false;
  if (stored == null) return true;
  let dismissed: PermissionKey[];
  if (stored === LEGACY_DISMISS_VALUE) {
    // الإخفاء القديم شمل المنبّهات والبطارية فقط؛ الإشعارات لم تكن في النافذة.
    dismissed = ["exact", "battery"];
  } else {
    try {
      const parsed = JSON.parse(stored);
      dismissed = Array.isArray(parsed) ? parsed : [];
    } catch {
      dismissed = [];
    }
  }
  return missing.some((k) => !dismissed.includes(k));
}

/** يحوّل نتيجة `LocalNotifications.checkPermissions` إلى حالة واحدة. */
export function normalizeDisplayPermission(
  display: string | undefined,
): NotificationPermissionState {
  if (display === "granted") return "granted";
  if (display === "denied") return "denied";
  if (display === "prompt" || display === "prompt-with-rationale") return "prompt";
  return "unsupported";
}

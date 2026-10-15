/**
 * منار — المرحلة ٢٥: موثوقية الأذان (docs/audit/NOTIFICATIONS-AUDIT.ar.md، ح١–ح٤).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  adhanVerdict,
  dismissValue,
  LEGACY_DISMISS_VALUE,
  missingPermissions,
  normalizeDisplayPermission,
  shouldShowReliabilityPrompt,
  verdictMessage,
  type AlertPermissions,
} from "@/lib/alert-permissions";
import { staleIds } from "@/lib/schedule-diff";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const perms = (o: Partial<AlertPermissions> = {}): AlertPermissions => ({
  notifications: "granted",
  exactAlarms: true,
  batteryUnrestricted: true,
  sdk: 34,
  ...o,
});

/** جسم دالّة بالاسم حتى الدالّة التالية في المستوى الأعلى. */
function body(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  const rest = src.slice(start + signature.length);
  const end = rest.search(/\n(?:export )?(?:async )?function |\n\/\*\* /);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("ح١ — حكم الأذان من الأذونات", () => {
  it("بلا منبّه دقيق ولا استثناء بطارية على أندرويد ١٢+: لن يُسمع", () => {
    expect(adhanVerdict(perms({ exactAlarms: false, batteryUnrestricted: false }))).toBe("silent");
    expect(adhanVerdict(perms({ exactAlarms: false, batteryUnrestricted: false, sdk: 31 }))).toBe(
      "silent",
    );
  });

  it("استثناء البطارية يُجيز الصوت، مع تأخير محتمل", () => {
    expect(adhanVerdict(perms({ exactAlarms: false }))).toBe("late");
  });

  it("المنبّه الدقيق يكفي، وقبل أندرويد ١٢ لا قيد", () => {
    expect(adhanVerdict(perms({ batteryUnrestricted: false }))).toBe("ok");
    expect(adhanVerdict(perms({ exactAlarms: false, batteryUnrestricted: false, sdk: 30 }))).toBe(
      "ok",
    );
  });

  it("الرسالة تقول الحقيقة لكل حالة", () => {
    expect(verdictMessage(perms({ exactAlarms: false, batteryUnrestricted: false }))).toContain(
      "لن يُسمع الأذان",
    );
    expect(verdictMessage(perms({ exactAlarms: false }))).toContain("قد يتأخّر");
    expect(verdictMessage(perms({ notifications: "denied" }))).toContain("يُسمع الأذان");
    expect(verdictMessage(perms())).toBeNull();
  });

  it("الناقص بترتيب الأهمية", () => {
    expect(
      missingPermissions(
        perms({ notifications: "prompt", exactAlarms: false, batteryUnrestricted: false }),
      ),
    ).toEqual(["notifications", "exact", "battery"]);
    expect(missingPermissions(perms())).toEqual([]);
  });

  it("حالات إذن الإشعارات من LocalNotifications", () => {
    expect(normalizeDisplayPermission("granted")).toBe("granted");
    expect(normalizeDisplayPermission("denied")).toBe("denied");
    expect(normalizeDisplayPermission("prompt")).toBe("prompt");
    expect(normalizeDisplayPermission("prompt-with-rationale")).toBe("prompt");
    expect(normalizeDisplayPermission(undefined)).toBe("unsupported");
  });
});

describe("م٨ — نافذة الأذونات لا تختفي للأبد", () => {
  it("تظهر أول مرة إن نقص شيء، ولا تظهر إن اكتمل كل شيء", () => {
    expect(shouldShowReliabilityPrompt(["battery"], null)).toBe(true);
    expect(shouldShowReliabilityPrompt([], null)).toBe(false);
  });

  it("«لاحقاً» يُسكتها على الناقص نفسه، وتعود إن نقص جديد", () => {
    const stored = dismissValue(["battery"]);
    expect(shouldShowReliabilityPrompt(["battery"], stored)).toBe(false);
    expect(shouldShowReliabilityPrompt(["exact", "battery"], stored)).toBe(true);
    expect(shouldShowReliabilityPrompt([], stored)).toBe(false);
  });

  it("الإخفاء القديم («1») شمل المنبّهات والبطارية فقط", () => {
    expect(shouldShowReliabilityPrompt(["exact", "battery"], LEGACY_DISMISS_VALUE)).toBe(false);
    expect(shouldShowReliabilityPrompt(["notifications"], LEGACY_DISMISS_VALUE)).toBe(true);
  });

  it("قيمة تالفة تُعامل كأن لا إخفاء", () => {
    expect(shouldShowReliabilityPrompt(["exact"], "{oops")).toBe(true);
  });
});

describe("ح٤ — الجدولة بالفرق", () => {
  it("يُلغى فقط المعلّق في المدى وغير الموجود في الجديد", () => {
    expect(staleIds([41001, 41002, 41003, 5, 241000], [41002], 41000, 241000)).toEqual([
      41001, 41003,
    ]);
  });

  it("لا يمسّ التأجيل والتجربة (خارج المدى) ولا يكرّر", () => {
    expect(staleIds([241005, 241099, 41001, 41001], [], 41000, 241000)).toEqual([41001]);
  });

  it("المزامنة تضبط الجديد قبل أن تلغي القديم", () => {
    const src = read("src/lib/native-notifications.ts");
    const sync = body(src, "async function syncNativePrayerScheduleNow(");
    const scheduleAt = sync.indexOf("p.schedule({ notifications: reminders })");
    const cancelAt = sync.indexOf("p.cancel(");
    expect(scheduleAt).toBeGreaterThan(-1);
    expect(cancelAt).toBeGreaterThan(scheduleAt);
    expect(sync).toContain("staleIds(");
  });

  it("لا مزامنة لحظة الذهاب إلى الخلفية", () => {
    const src = read("src/components/manar/adhan-provider.tsx");
    expect(src).toMatch(
      /const onResume = \(\) => \{\s*if \(document\.visibilityState !== "visible"\) return;/,
    );
  });

  it("الطلبات المتقاربة تُدمج في مزامنة واحدة", () => {
    const src = read("src/lib/native-notifications.ts");
    const fn = body(src, "export function syncNativePrayerSchedule(");
    expect(fn).toMatch(/if \(queued\) \{[\s\S]*?return queued\.run;/);
  });
});

describe("ح٢ — جدول الأذان لا يتوقف على إذن الإشعارات", () => {
  it("المزامنة لا تطلب الإذن ولا تخرج قبل تسليم جدول الأذان", () => {
    const src = read("src/lib/native-notifications.ts");
    const sync = body(src, "async function syncNativePrayerScheduleNow(");
    expect(sync).not.toContain("ensureNativePermission");
    expect(sync).not.toContain("requestPermissions");
    const firstReturn = sync.search(/\breturn 0;/);
    const adhanAt = sync.indexOf("adhan.schedule(");
    expect(adhanAt).toBeGreaterThan(-1);
    // الخروج الوحيد المسموح قبله: خارج التطبيق الأصلي.
    expect(sync.slice(0, adhanAt).match(/\breturn 0;/g) ?? []).toHaveLength(1);
    expect(sync.slice(0, firstReturn + 20)).toContain("isNativeShell()");
  });
});

describe("ح١ — تعذّر الصوت يُقال ولا يُكتم", () => {
  it("شريحة التعريف داخل أندرويد تشرح الأذونات", () => {
    const src = read("src/routes/onboarding.tsx");
    expect(src).toContain("PERMISSIONS_SLIDE");
    expect(src).toContain("<AlertPermissionRows");
  });
});

describe("ح٣ — بطاقة الإذن الأصلية في مركز التنبيهات", () => {
  it("داخل أندرويد تُقرأ الأذونات من النظام لا من واجهة المتصفح", () => {
    const src = read("src/routes/notifications.tsx");
    expect(src).toContain("useAlertPermissions()");
    expect(src).toMatch(/if \(isNativeShell\(\)\) return;\s*if \(!\("Notification" in window\)\)/);
    expect(src).toContain("<AlertPermissionRows");
  });

  it("«السماح» يطلب الإذن أو يفتح الإعدادات إن رُفض", () => {
    const src = read("src/lib/native-notifications.ts");
    const fn = body(src, "export async function requestNotificationAccess(");
    expect(fn).toContain("requestPermissions()");
    expect(fn).toContain("openNativeNotificationSettings()");
  });
});

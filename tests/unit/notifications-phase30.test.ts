/**
 * منار — المرحلة ٣٠: مركز تنبيهات حقيقي وتشخيص (docs/audit/NOTIFICATIONS-AUDIT.ar.md، م٧، م١١، ت١، ت٥).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  blockedChannelsMessage,
  describeAlertKey,
  describeLogEvent,
  formatAlertLog,
  nextAlertLine,
  otherAlertRows,
  testVerdict,
  testVerdictText,
  type AlertLogEvent,
} from "@/lib/alert-center";
import { countAr } from "@/lib/format";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("التنبيه القادم", () => {
  it("يسمّي الحدث من مفتاحه", () => {
    expect(describeAlertKey("asr_iqamah_2026_09_23")).toBe("الإقامة — العصر");
    expect(describeAlertKey("fajr_adhan_2026_09_23")).toBe("الأذان — الفجر");
    expect(describeAlertKey("dhuhr_reminder15m_2026_09_23")).toBe("قبل الصلاة بـ١٥ دقيقة — الظهر");
    expect(describeAlertKey("fajr_fajr_reminder45m_2026_09_23")).toBe("تذكير الفجر");
    expect(describeAlertKey("isha_renew_2026_10_20")).toBe("تجديد المواقيت");
    expect(describeAlertKey("fajr_fajr_first_adhan_2026_09_23")).toBe("الأذان الأول — الفجر");
    expect(describeAlertKey("daily_2_2026_09_23", "أذكار الصباح")).toBe("أذكار الصباح");
    expect(describeAlertKey("test_1")).toBe("تجربة شاملة");
    expect(describeAlertKey("weird", "عنوان")).toBe("عنوان");
  });

  it("سطر «التالي» باليوم والساعة", () => {
    const now = new Date(2026, 8, 23, 10, 0).getTime();
    const at = new Date(2026, 8, 23, 15, 42).getTime();
    expect(nextAlertLine({ nextKey: "asr_iqamah_2026_09_23", nextAt: at }, now)).toBe(
      "التالي: الإقامة — العصر، اليوم ٣:٤٢ م",
    );
    const tomorrow = new Date(2026, 8, 24, 4, 5).getTime();
    expect(nextAlertLine({ nextKey: "fajr_adhan_2026_09_24", nextAt: tomorrow }, now)).toBe(
      "التالي: الأذان — الفجر، غداً ٤:٠٥ ص",
    );
    expect(nextAlertLine({ nextAt: now - 1 }, now)).toBeNull();
    expect(nextAlertLine(null, now)).toBeNull();
  });
});

describe("م١١ — القنوات المطفأة", () => {
  it("تُسمّى بأسمائها", () => {
    expect(
      blockedChannelsMessage([
        { id: "manar_adhan", name: "الأذان", importance: 0, blocked: true },
        { id: "manar_iqama", name: "الإقامة", importance: 4, blocked: false },
      ]),
    ).toBe("أطفأت قناة «الأذان» من إعدادات النظام — تنبيهاتها لا تظهر.");
    expect(blockedChannelsMessage([])).toBeNull();
  });
});

describe("ت٥ — سجل التنبيهات", () => {
  const ev = (type: string, key = "", detail = "", at = 0): AlertLogEvent => ({
    at,
    type,
    key,
    detail,
  });

  it("جمل عربية لكل نوع", () => {
    expect(describeLogEvent(ev("fired", "asr_adhan_2026_09_23", "adhan/5"))).toBe(
      "أُطلق الأذان — العصر في موعده",
    );
    expect(describeLogEvent(ev("fired", "asr_adhan_2026_09_23", "adhan/600"))).toBe(
      "أُطلق الأذان — العصر متأخّراً ١٠ دقائق",
    );
    expect(describeLogEvent(ev("scheduled", "", "120/9/inexact"))).toBe(
      "ضُبط الجدول: ١٢٠ حدثاً، ٩ في النافذة (غير دقيقة)",
    );
    expect(describeLogEvent(ev("silenced", "fajr_adhan_2026_09_23", "مكتوم في فترة «سكينة»"))).toBe(
      "الأذان — الفجر: مكتوم في فترة «سكينة»",
    );
    expect(describeLogEvent(ev("prayed", "dhuhr", "2026-09-23"))).toBe("«صلّيت» من الإشعار: الظهر");
    expect(describeLogEvent(ev("snoozed", "600", "10"))).toBe("أُجّل تذكير ١٠ دقائق");
    expect(describeLogEvent(ev("rearmed", "", "android.intent.action.BOOT_COMPLETED"))).toBe(
      "أُعيد ضبط المنبّهات (إعادة تشغيل الهاتف)",
    );
  });

  it("النسخ: الأحدث أولاً، بالتاريخ", () => {
    const a = new Date(2026, 8, 23, 9, 0).getTime();
    const b = new Date(2026, 8, 23, 12, 0).getTime();
    const text = formatAlertLog([ev("duplicate", "x", "", a), ev("notice_dropped", "1", "", b)]);
    const lines = text.split("\n");
    expect(lines[0]).toContain("رُفض إشعار");
    expect(lines[0]).toContain("٢٠٢٦-٠٩-٢٣");
    expect(lines[1]).toContain("تكرّر");
  });
});

describe("ت١ — تجربة شاملة", () => {
  const test = { key: "test_1000", at: 1_000_000 };
  it("النتيجة من السجل", () => {
    expect(testVerdict([], test, test.at - 10_000).state).toBe("waiting");
    expect(testVerdict([], test, test.at + 200_000).state).toBe("missed");
    expect(
      testVerdict([{ at: 0, type: "fired", key: test.key, detail: "adhan/3" }], test).state,
    ).toBe("on-time");
    expect(
      testVerdict([{ at: 0, type: "fired", key: test.key, detail: "adhan/420" }], test),
    ).toEqual({ state: "late", minutes: 7 });
    const w = testVerdict(
      [
        { at: 0, type: "fired", key: test.key, detail: "adhan/0" },
        { at: 0, type: "playback_failed", key: test.key, detail: "background_start" },
      ],
      test,
    );
    expect(w.state).toBe("written");
    expect(testVerdictText(w)).toContain("المنبّهات الدقيقة");
  });
});

describe("تنبيهات أخرى", () => {
  it("أربعة صفوف بروابطها وحالتها", () => {
    const rows = otherAlertRows({
      daily: { enabled: true, items: [{ enabled: true }, { enabled: true }, { enabled: false }] },
      seasons: { enabled: false, seasons: { ramadan: true } },
      jumuah: { remindEarly: true, remindKahf: true, remindHour: false },
      sakinah: { enabled: true },
    });
    expect(rows.map((r) => r.route)).toEqual(["/reminders", "/seasons", "/jumuah", "/sakinah"]);
    expect(rows[0]).toMatchObject({ on: true, detail: "تذكيران" });
    expect(rows[1]).toMatchObject({ on: false, detail: "متوقّفة" });
    expect(rows[2].detail).toBe("التبكير · الكهف");
    expect(rows[3].on).toBe(true);
  });

  it("صيغ العدد", () => {
    expect(countAr(1, "تذكير", "تذكيران", "تذكيرات")).toBe("تذكير واحد");
    expect(countAr(3, "تذكير", "تذكيران", "تذكيرات")).toBe("٣ تذكيرات");
    expect(countAr(11, "تذكير", "تذكيران", "تذكيرات")).toBe("١١ تذكيراً");
  });

  it("البطاقة في شاشة الإشعارات", () => {
    expect(read("src/routes/notifications.tsx")).toContain(
      "<AlertCenterCard settings={settings} />",
    );
  });
});

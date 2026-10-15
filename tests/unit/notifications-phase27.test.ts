/**
 * منار — المرحلة ٢٧: نصوص صحيحة في كل إشعار (docs/audit/NOTIFICATIONS-AUDIT.ar.md، ع٧، ع٩، ت٦، ت٧).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { __setDisplayForTests } from "@/lib/display-prefs";
import {
  agoAr,
  daysAr,
  durationAr,
  minutesAr,
  minutesUnit,
  prePrayerBody,
} from "@/lib/notification-text";
import { minutesWord } from "@/lib/jumuah";
import { prayerLabelOn } from "@/lib/prayer-schedule";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

afterEach(() => __setDisplayForTests({ clock: "12", digits: "arab" }));

describe("صيغ العدد بالأرقام العربية", () => {
  it("الدقائق: ١، ٢، ٣–١٠، ١١+", () => {
    expect(minutesAr(1)).toBe("دقيقة واحدة");
    expect(minutesAr(2)).toBe("دقيقتان");
    expect(minutesAr(2, "gen")).toBe("دقيقتين");
    expect(minutesAr(3)).toBe("٣ دقائق");
    expect(minutesAr(10)).toBe("١٠ دقائق");
    expect(minutesAr(11)).toBe("١١ دقيقة");
    expect(minutesAr(15)).toBe("١٥ دقيقة");
    expect(minutesAr(103)).toBe("١٠٣ دقائق");
  });

  it("الأيام والمدد", () => {
    expect(daysAr(1)).toBe("يوم واحد");
    expect(daysAr(2, "gen")).toBe("يومين");
    expect(daysAr(3)).toBe("٣ أيام");
    expect(daysAr(12)).toBe("١٢ يومًا");
    expect(durationAr(60)).toBe("ساعة");
    expect(durationAr(90)).toBe("ساعة ونصف");
    expect(durationAr(120)).toBe("ساعتان");
    expect(durationAr(45)).toBe("٤٥ دقيقة");
    expect(minutesWord(30)).toBe("٣٠ دقيقة");
  });

  it("وحدة الرقاقات", () => {
    expect(minutesUnit(5)).toBe("دقائق");
    expect(minutesUnit(10)).toBe("دقائق");
    expect(minutesUnit(15)).toBe("دقيقة");
    expect(minutesUnit(30)).toBe("دقيقة");
  });

  it("الوقت النسبي: لا «قبل ٣ يوم» ولا «د»/«س»", () => {
    const now = Date.UTC(2026, 8, 28, 12);
    expect(agoAr(now, now)).toBe("الآن");
    expect(agoAr(now - 2 * 60_000, now)).toBe("قبل دقيقتين");
    expect(agoAr(now - 5 * 60_000, now)).toBe("قبل ٥ دقائق");
    expect(agoAr(now - 2 * 3600_000, now)).toBe("قبل ساعتين");
    expect(agoAr(now - 3 * 86400_000, now)).toBe("قبل ٣ أيام");
    expect(agoAr(now - 86400_000, now)).toBe("قبل يوم واحد");
  });
});

describe("بالأرقام الغربية", () => {
  it("الأرقام تتبع اختيار العرض", () => {
    __setDisplayForTests({ clock: "12", digits: "latn" });
    expect(minutesAr(5)).toBe("5 دقائق");
    expect(minutesAr(20)).toBe("20 دقيقة");
    expect(prePrayerBody(10, "العصر")).toBe("تبقّى 10 دقائق على صلاة العصر");
  });
});

describe("التنبيه قبل الصلاة", () => {
  it("يوم الجمعة يُسمّى الظهر «الجمعة»", () => {
    // ٢ أكتوبر ٢٠٢٦ جمعة، ظهراً — تُقرأ بمنطقة الجهاز، فنبنيها محلياً.
    const friday = new Date(2026, 9, 2, 12);
    expect(friday.getDay()).toBe(5);
    expect(prePrayerBody(10, prayerLabelOn("dhuhr", friday))).toBe(
      "تبقّى ١٠ دقائق على صلاة الجمعة",
    );
    const thursday = new Date(2026, 9, 1, 12);
    expect(prePrayerBody(15, prayerLabelOn("dhuhr", thursday))).toBe(
      "تبقّى ١٥ دقيقة على صلاة الظهر",
    );
  });

  it("الجدول الأصلي ومحرّك الويب يستعملان المنشئ نفسه", () => {
    for (const f of [
      "src/lib/native-notifications.ts",
      "src/components/manar/adhan-provider.tsx",
    ]) {
      expect(read(f)).not.toContain("دقيقة على صلاة");
    }
    // منذ المرحلة ٢٨ يُبنى التنبيه قبل الصلاة في الجدول الموحّد وحده.
    expect(read("src/lib/prayer-schedule.ts")).toContain("body: prePrayerBody(m, label)");
  });
});

describe("حارس: لا «دقيقة» بعد رقمٍ خام في ملفات التنبيهات", () => {
  const files = [
    "src/lib/native-notifications.ts",
    "src/lib/prayer-schedule.ts",
    "src/lib/jumuah.ts",
    "src/components/manar/adhan-provider.tsx",
    "src/components/manar/alert-system-status.tsx",
    "src/routes/notifications.tsx",
    "src/routes/adhan.tsx",
    "src/routes/jumuah.tsx",
  ];
  for (const f of files) {
    it(f, () => {
      const src = read(f);
      expect(src).not.toMatch(/\$\{[^}]+\}\s?(?:دقيقة|دقائق|يوم|أيام)`/);
      expect(src).not.toMatch(/\$\{[^}]+\}\s?(?:دقيقة|دقائق|يوم|أيام) /);
    });
  }
});

/**
 * منار — المرحلة ٣٣: دقّة البيانات والموقع.
 * جدول أم القرى الاحتياطي، المنطقة الزمنية للموقع، اليوم الهجري عند المغرب،
 * رسائل تحديد الموقع، وتقريب الإحداثيات قبل Nominatim.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  __setHijriEngineForTests,
  hijriDisplayDate,
  hijriEngine,
  tableHijri,
  toHijri,
} from "@/lib/hijri";
import { UQ_FIRST_YEAR, UQ_LAST_YEAR } from "@/lib/hijri-table";
import { formatHijriAr } from "@/lib/format";
import {
  gmtLabel,
  hoursPhrase,
  isValidTimeZone,
  mismatchMessage,
  timeZoneForCountryCode,
  timeZoneOf,
  zoneMismatch,
  zoneOffsetMinutes,
} from "@/lib/place-timezone";
import { geolocationErrorAr, nominatimReverseUrl } from "@/lib/prayer";
import { ARAB_COUNTRIES } from "@/lib/arab-places";
import { CITIES } from "@/lib/cities";
import { BACKUP_KEYS, DEVICE_ONLY_KEYS } from "@/lib/local-backup";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const DAY = 86_400_000;

afterEach(() => __setHijriEngineForTests(null));

describe("جدول أم القرى الاحتياطي", () => {
  it("يطابق Intl يوماً بيوم في كامل مداه (١٣٠٠–١٦٠٠هـ)", () => {
    const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    let checked = 0;
    let mismatches = 0;
    let first = "";
    for (let d = Math.floor(Date.UTC(1882, 10, 1) / DAY); d < Date.UTC(2178, 0, 1) / DAY; d++) {
      const t = tableHijri(d);
      if (!t) continue;
      const p: Record<string, number> = {};
      for (const x of fmt.formatToParts(new Date(d * DAY + DAY / 2)))
        if (x.type !== "literal") p[x.type] = Number(x.value.replace(/[^\d]/g, ""));
      checked++;
      if (p.year !== t.year || p.month !== t.month || p.day !== t.day) {
        mismatches++;
        if (!first) first = `${d}: ${JSON.stringify(t)} vs ${JSON.stringify(p)}`;
      }
    }
    expect(first).toBe("");
    expect(mismatches).toBe(0);
    expect(checked).toBeGreaterThan(106_000);
  });

  it("خارج المدى: null (فيرجع إلى Intl)", () => {
    expect(tableHijri(Math.floor(Date.UTC(1850, 0, 1) / DAY))).toBeNull();
    expect(tableHijri(Math.floor(Date.UTC(2200, 0, 1) / DAY))).toBeNull();
    expect(UQ_FIRST_YEAR).toBe(1300);
    expect(UQ_LAST_YEAR).toBe(1600);
  });

  it("الملف المولَّد مطابق للسكربت على ICU الحالي", () => {
    const out = execFileSync(process.execPath, ["scripts/build-hijri-table.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toContain("OK");
  });

  it("المحرّك السليم هنا Intl", () => {
    expect(hijriEngine()).toBe("intl");
  });

  it("بالجدول: toHijri وformatHijriAr يعطيان النتيجة نفسها", () => {
    const dates = [
      new Date(2025, 5, 26, 9),
      new Date(2026, 1, 18, 23),
      new Date(2026, 8, 28, 12),
      new Date(2030, 0, 1, 0, 30),
    ];
    const viaIntl = dates.map((d) => [toHijri(d), toHijri(d, 1), toHijri(d, -2)]);
    __setHijriEngineForTests("table");
    expect(dates.map((d) => [toHijri(d), toHijri(d, 1), toHijri(d, -2)])).toEqual(viaIntl);
    expect(formatHijriAr(new Date(2026, 8, 28, 12))).toBe("١٧ ربيع الآخر ١٤٤٨ هـ");
  });

  it("المحرّك يُفحص على تواريخ مرجعية ويرجع إلى الجدول إن أخطأ Intl", () => {
    const src = read("src/lib/hijri.ts");
    expect(src).toMatch(/engine = ok \? "intl" : "table"/);
    expect(src).toMatch(/catch \{\s*engine = "table";/);
  });
});

describe("اليوم الهجري عند المغرب", () => {
  const maghrib = new Date(2026, 8, 28, 18, 5);
  it("مطفأ: التاريخ نفسه", () => {
    const now = new Date(2026, 8, 28, 20);
    expect(hijriDisplayDate(now, maghrib, false)).toBe(now);
  });
  it("مفعّل قبل المغرب: اليوم؛ بعده: الغد", () => {
    const before = new Date(2026, 8, 28, 17, 59);
    expect(hijriDisplayDate(before, maghrib, true)).toBe(before);
    const after = hijriDisplayDate(new Date(2026, 8, 28, 18, 5), maghrib, true);
    expect(after.getDate()).toBe(29);
    expect(toHijri(after).day).toBe(toHijri(new Date(2026, 8, 28, 12)).day + 1);
  });
  it("يُحفظ في النسخة الاحتياطية", () => {
    expect(BACKUP_KEYS).toContain("manar.hijri.at-maghrib.v1");
    expect(DEVICE_ONLY_KEYS.has("manar.zone-banner.dismissed.v1")).toBe(true);
  });
});

describe("المنطقة الزمنية للموقع", () => {
  it("كل مدينة ودولة مضمَّنة لها منطقة صالحة", () => {
    for (const c of ARAB_COUNTRIES) {
      const tz = timeZoneOf({ city: "", country: c.name });
      expect(tz, c.name).not.toBeNull();
      expect(isValidTimeZone(tz), c.name).toBe(true);
    }
    for (const c of CITIES) {
      const tz = timeZoneOf(c);
      expect(tz, c.city).not.toBeNull();
      expect(isValidTimeZone(tz), c.city).toBe(true);
    }
  });

  it("مدن الدول متعدّدة المناطق وقطاع غزة", () => {
    expect(timeZoneOf({ city: "لوس أنجلوس", country: "أمريكا" })).toBe("America/Los_Angeles");
    expect(timeZoneOf({ city: "غزة", country: "فلسطين" })).toBe("Asia/Gaza");
    expect(timeZoneOf({ city: "نابلس", country: "فلسطين" })).toBe("Asia/Hebron");
    expect(timeZoneOf({ city: "x", country: "y", tz: "Asia/Tokyo" })).toBe("Asia/Tokyo");
    expect(timeZoneOf({ city: "x", country: "y", tz: "Mars/Olympus" })).toBeNull();
    expect(timeZoneForCountryCode("YE")).toBe("Asia/Aden");
    expect(timeZoneForCountryCode("us")).toBeNull();
  });

  it("الإزاحة تحترم التوقيت الصيفي", () => {
    expect(zoneOffsetMinutes("Asia/Aden", new Date(Date.UTC(2026, 0, 1)))).toBe(180);
    expect(zoneOffsetMinutes("Asia/Kolkata", new Date(Date.UTC(2026, 0, 1)))).toBe(330);
    expect(zoneOffsetMinutes("America/New_York", new Date(Date.UTC(2026, 0, 15)))).toBe(-300);
    expect(zoneOffsetMinutes("America/New_York", new Date(Date.UTC(2026, 6, 15)))).toBe(-240);
  });

  it("لا شارة حين تتطابق الإزاحة ولو اختلف الاسم (الرياض على جهاز بتوقيت عدن)", () => {
    const at = new Date(Date.UTC(2026, 8, 28, 12));
    const device = -at.getTimezoneOffset();
    const m = zoneMismatch({ city: "الرياض", country: "السعودية" }, at);
    if (device === 180) expect(m).toBeNull();
    else expect(m?.diffMinutes).toBe(180 - device);
  });

  it("الفرق وجهته ونصّه", () => {
    const at = new Date(Date.UTC(2026, 0, 15, 12));
    const device = -at.getTimezoneOffset();
    const m = zoneMismatch({ city: "لندن", country: "بريطانيا" }, at);
    expect(m?.diffMinutes).toBe(0 - device);
    const gps = mismatchMessage(
      { city: "لندن", source: "gps" },
      { tz: "Europe/London", diffMinutes: -180, cityOffset: 0, deviceOffset: 180 },
    );
    expect(gps.severe).toBe(true);
    expect(gps.body).toContain("غرينتش+3");
    const manual = mismatchMessage(
      { city: "القاهرة", source: "manual" },
      { tz: "Africa/Cairo", diffMinutes: -60, cityOffset: 120, deviceOffset: 180 },
    );
    expect(manual.severe).toBe(false);
    expect(manual.body).toContain("يتأخّر عن جهازك بـساعة");
    expect(hoursPhrase(120)).toBe("ساعتين");
    expect(hoursPhrase(210)).toBe("3 ساعات ونصف");
    expect(hoursPhrase(30)).toBe("نصف ساعة");
    expect(gmtLabel(-330)).toBe("غرينتش−5:30");
  });
});

describe("تحديد الموقع", () => {
  it("Nominatim يتلقّى الإحداثيات مقرّبة إلى منزلتين", () => {
    const url = nominatimReverseUrl(15.369412, 44.190987);
    expect(url).toContain("lat=15.37&lon=44.19&");
    expect(url).not.toContain("15.3694");
    expect(nominatimReverseUrl(-6.20881, -0.004)).toContain("lat=-6.21&lon=0.00&");
    expect(read("src/lib/prayer.ts")).not.toMatch(/lat=\$\{pos\.coords\.latitude\}/);
  });

  it("رسائل عربية لكل رمز خطأ، والمهلة ليست رفضاً", () => {
    expect(geolocationErrorAr(1)).toContain("إذن");
    expect(geolocationErrorAr(2)).toContain("GPS");
    expect(geolocationErrorAr(3)).toContain("وقتاً طويلاً");
    const src = read("src/lib/prayer.ts");
    expect(src).toContain('setStatus(err.code === 1 ? "denied" : "failed")');
    expect(src).not.toContain("err.message");
  });

  it("سياسة الخصوصية تذكر التقريب", () => {
    expect(read("src/lib/legal.ts")).toContain("مقرّبةً");
  });
});

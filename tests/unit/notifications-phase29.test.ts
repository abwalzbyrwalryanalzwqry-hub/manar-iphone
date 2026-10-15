/**
 * منار — المرحلة ٢٩: شاشة القفل (docs/audit/NOTIFICATIONS-AUDIT.ar.md، م٣، م٩، ت٢–ت٤).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getAdhanSettings, type AdhanSettings } from "@/lib/adhan-settings";
import { validPrayed } from "@/lib/prayed-queue";
import {
  DAILY_EVENT_BASE,
  DAILY_EVENT_MAX,
  buildPrayerAlarms,
  dailyEventId,
  eventId,
  logDayKey,
} from "@/lib/prayer-schedule";
import type { LocationState, Settings } from "@/lib/prayer";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const SANAA: LocationState = { lat: 15.3694, lng: 44.191, city: "صنعاء", source: "manual" };
const CALC: Settings = {
  method: "UmmAlQura",
  madhab: "shafi",
  offsets: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  dstOffset: 0,
};
const NOW = Date.UTC(2026, 8, 22, 22, 0, 0);

const settings = (patch: Partial<AdhanSettings> = {}): AdhanSettings => ({
  ...structuredClone(getAdhanSettings()),
  remindersEnabled: true,
  reminderMinutes: [15],
  iqamaEnabled: true,
  iqamaReminderEnabled: true,
  ...patch,
});
const build = (s: AdhanSettings) =>
  buildPrayerAlarms({ settings: s, location: SANAA, calc: CALC, now: NOW, days: 3 });

describe("ت٢ — «صلّيت» ومسار النقر في أحداث الصلاة", () => {
  const events = build(settings());

  it("الأذان والإقامة ودخول الوقت يحملون الصلاة ويومها", () => {
    for (const e of events.filter((x) => ["adhan", "iqamah", "prayer_notice"].includes(x.role))) {
      expect(e.meta?.route).toBe("/prayer");
      expect(e.meta?.prayer).toBe(e.prayer);
      expect(e.meta?.prayedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.key).toContain(e.meta!.prayedDay!.replace(/-/g, "_"));
    }
  });

  it("التذكيرات قبل الصلاة تفتح شاشة الصلاة بلا «صلّيت»", () => {
    const rs = events.filter((x) => x.role === "reminder" || x.role === "iqamah_reminder");
    expect(rs.length).toBeGreaterThan(0);
    for (const e of rs) {
      expect(e.meta?.route).toBe("/prayer");
      expect(e.meta?.prayer).toBeUndefined();
    }
  });

  it("logDayKey بصيغة سجل النشاط", () => {
    expect(logDayKey(new Date(2026, 8, 3, 12))).toBe("2026-09-03");
  });
});

describe("طابور «صلّيت» — الدمج الآمن", () => {
  const today = "2026-09-23";
  it("يقبل المفروضة ويرفض الشروق والمستقبل والتكرار والقيم الغريبة", () => {
    expect(
      validPrayed(
        [
          { prayer: "fajr", day: "2026-09-23" },
          { prayer: "fajr", day: "2026-09-23" },
          { prayer: "isha", day: "2026-09-22" },
          { prayer: "sunrise", day: "2026-09-23" },
          { prayer: "dhuhr", day: "2026-09-24" },
          { prayer: "asr", day: "23-09-2026" },
          null,
          "x",
        ],
        today,
      ),
    ).toEqual([
      { prayer: "fajr", day: "2026-09-23" },
      { prayer: "isha", day: "2026-09-22" },
    ]);
    expect(validPrayed(undefined, today)).toEqual([]);
  });
});

describe("م٩ — تذكيرات الأذكار في الجدول الأصلي", () => {
  it("معرّفاتها في خانات مستقلّة لا تصطدم بالصلوات ولا بتنبيه المنطقة", () => {
    const day = new Date(2026, 8, 23, 12);
    const prayerIds = new Set<number>();
    for (const p of ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const) {
      for (const r of [
        "adhan",
        "fajr_first_adhan",
        "iqamah",
        "prayer_notice",
        "iqamah_reminder",
        "renew",
        "reminder",
        "fajr_reminder",
      ] as const) {
        for (let slot = 0; slot < 10; slot++) prayerIds.add(eventId(p, r, day, slot));
      }
    }
    const block = Math.floor(eventId("fajr", "adhan", day) / 1000) * 1000;
    for (let i = 0; i < DAILY_EVENT_MAX; i++) {
      const id = dailyEventId(day, i);
      expect(prayerIds.has(id)).toBe(false);
      expect(id - block).toBeGreaterThanOrEqual(DAILY_EVENT_BASE);
      expect(id % 1000).toBeLessThan(990);
    }
  });

  it("تُبنى أحداث notice بمسارها و«ذكّرني لاحقاً» لثلاثين يوماً", () => {
    const src = read("src/lib/native-notifications.ts");
    expect(src).toMatch(/days: ADHAN_DAYS_AHEAD,[\s\S]*?done,/);
    expect(src).toMatch(/meta: \{ route: r\.route, snooze: SNOOZE_MINUTES \}/);
    expect(src).not.toMatch(/reminders\.push\(dailyNotification/);
  });
});

describe("ت٣/ت٤ — الأصلي: القناة والمجموعة والمسار", () => {
  it("الويب يدمج الطابور عند الفتح والعودة", () => {
    const a = read("src/components/manar/adhan-provider.tsx");
    expect(a.match(/void mergeNativePrayed\(\);/g)?.length).toBe(2);
    expect(read("src/components/manar/reminder-tap-bridge.tsx")).toContain(
      "attachNativeRouteListener",
    );
  });
});

/**
 * منار — المرحلة ٢٨: أفق واحد وجدولة خفيفة (docs/audit/NOTIFICATIONS-AUDIT.ar.md، ع٨، م٢، م٦، م١٠).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getAdhanSettings, type AdhanSettings } from "@/lib/adhan-settings";
import {
  ADHAN_DAYS_AHEAD,
  LN_CAP,
  SAKINAH_DAYS_AHEAD,
  SCHEDULE_DAYS_AHEAD,
  buildPrayerAlarms,
  renewPlan,
  reminderSlot,
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
const DAY = 86_400_000;

/** أقصى إعداد: كل التنبيهات مفعّلة. */
const maxed = (): AdhanSettings => ({
  ...structuredClone(getAdhanSettings()),
  remindersEnabled: true,
  reminderMinutes: [30, 15, 10, 5],
  fajrReminderEnabled: true,
  fajrReminderMinutes: 45,
  fajrFirstAdhanEnabled: true,
  iqamaReminderEnabled: true,
  prayerNoticeEnabled: true,
});

const build = (s: AdhanSettings, extra: Partial<Parameters<typeof buildPrayerAlarms>[0]> = {}) =>
  buildPrayerAlarms({
    settings: s,
    location: SANAA,
    calc: CALC,
    now: NOW,
    days: ADHAN_DAYS_AHEAD,
    ...extra,
  });

describe("ع٨ — التنبيه قبل الصلاة ثلاثون يوماً كالأذان", () => {
  const ev = build(maxed(), { reminderChannel: (p) => `manar_approach_${p}` });
  const rem = ev.filter((e) => e.role === "reminder");

  it("يمتد إلى آخر الجدول، لا سبعة أيام", () => {
    const last = Math.max(...rem.map((e) => e.at));
    expect(last - NOW).toBeGreaterThan(28 * DAY);
    // ٥ صلوات × ٤ مدد × ~٣٠ يوماً
    expect(rem.length).toBeGreaterThanOrEqual(5 * 4 * 29);
  });

  it("حدث notice بقناة التذكير كما أنشأتها المزامنة، وبدقائقه", () => {
    for (const e of rem) {
      expect(e.kind).toBe("notice");
      expect(e.sound).toBe("");
      expect(e.channel).toBe(`manar_approach_${e.prayer}`);
      expect(e.at).toBe(
        ev.find((a) => a.role === "adhan" && a.key === e.key.replace(/reminder\d+m/, "adhan"))!.at -
          e.minutes! * 60_000,
      );
    }
  });

  it("«تذكير الفجر» حدثٌ مستقلّ في الجدول نفسه", () => {
    const fr = ev.filter((e) => e.role === "fajr_reminder");
    expect(fr.length).toBeGreaterThanOrEqual(29);
    for (const e of fr) {
      expect(e.prayer).toBe("fajr");
      expect(e.minutes).toBe(45);
    }
  });

  it("المعرّفات والمفاتيح فريدة، والخانة ثابتة بالمدة لا بالترتيب", () => {
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length);
    expect(new Set(ev.map((e) => e.key)).size).toBe(ev.length);
    expect(reminderSlot(5)).toBe(0);
    expect(reminderSlot(30)).toBe(3);
    const a = build({ ...maxed(), reminderMinutes: [5, 30] as never });
    const b = build({ ...maxed(), reminderMinutes: [30, 5] as never });
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });

  it("مطفأ عاماً أو لصلاة: لا تنبيه", () => {
    expect(build({ ...maxed(), remindersEnabled: false }).some((e) => e.role === "reminder")).toBe(
      false,
    );
    const s = maxed();
    s.perPrayer.asr = { ...s.perPrayer.asr, reminder: false };
    expect(build(s).some((e) => e.role === "reminder" && e.prayer === "asr")).toBe(false);
  });

  it("المنبّهات المضبوطة فعلاً (نافذة ٤٨ ساعة) لا تتجاوز ١٠٠ في أقصى إعداد", () => {
    const armed = ev.filter((e) => e.at - NOW <= 2 * DAY);
    expect(armed.length).toBeLessThanOrEqual(100);
  });
});

describe("LocalNotifications: ١٤ يوماً بحدٍّ أعلى", () => {
  it("المدى والحد", () => {
    expect(SCHEDULE_DAYS_AHEAD).toBe(14);
    expect(LN_CAP).toBeLessThanOrEqual(400);
  });

  it("لا تنبيه قبل الصلاة في LocalNotifications بعد اليوم", () => {
    const src = read("src/lib/native-notifications.ts");
    expect(src).not.toMatch(/\bidFor\(/);
    expect(src).toContain("reminders.length = LN_CAP");
    expect(src).toContain("reminderChannel,");
  });
});

describe("تنبيه التجديد يسبق أقصر جدول", () => {
  it("سكينة (٧ أيام) ثم LocalNotifications (١٤) ثم الأذان (٣٠)", () => {
    expect(renewPlan({ lnItems: 3, sakinah: true })?.day).toBe(SAKINAH_DAYS_AHEAD - 2);
    expect(renewPlan({ lnItems: 3, sakinah: false })?.day).toBe(SCHEDULE_DAYS_AHEAD - 2);
    expect(renewPlan({ lnItems: 0, sakinah: false })).toBeUndefined();
    expect(read("src/lib/sakinah.ts")).toContain(`daysAhead = ${SAKINAH_DAYS_AHEAD}`);
  });

  it("الحدث يقع في اليوم المطلوب وبنصّه", () => {
    const plan = renewPlan({ lnItems: 1, sakinah: false })!;
    const renew = build(maxed(), { renew: plan }).find((e) => e.role === "renew")!;
    expect(renew.body).toBe(plan.body);
    const days = (renew.at - NOW) / DAY;
    expect(days).toBeGreaterThan(plan.day - 1);
    expect(days).toBeLessThan(plan.day + 2);
    const def = build(maxed()).find((e) => e.role === "renew")!;
    expect((def.at - NOW) / DAY).toBeGreaterThan(ADHAN_DAYS_AHEAD - 4);
  });
});

describe("م١٠ — مستمع نقرٍ واحد وبلا بقايا", () => {
  const src = read("src/lib/native-notifications.ts");
  it("لا STOP_ADHAN ولا attachNativeActionListener", () => {
    expect(src).not.toContain("STOP_ADHAN");
    expect(src).not.toContain("attachNativeActionListener");
    expect(read("src/components/manar/adhan-provider.tsx")).not.toContain(
      "attachNativeActionListener",
    );
  });
  it("تسجيل واحد لحدث النقر", () => {
    expect(src.match(/addListener\("localNotificationActionPerformed"/g)?.length).toBe(1);
  });

  it("التوزيع حسب extra.kind", async () => {
    const n = await import("@/lib/native-notifications");
    const routes: string[] = [];
    const seasons: string[] = [];
    await n.attachReminderTapListener((r) => void routes.push(r));
    await n.attachSeasonTapListener((id) => void seasons.push(id));
    n.dispatchNotificationTap({ actionId: "tap", notification: { extra: { kind: "jumuah" } } });
    n.dispatchNotificationTap({ actionId: "dismiss", notification: { extra: { kind: "jumuah" } } });
    n.dispatchNotificationTap({
      actionId: "tap",
      notification: { extra: { kind: "season", season: "not-a-season" } },
    });
    expect(routes).toEqual(["/jumuah"]);
    expect(seasons).toEqual([]);
  });
});

/**
 * منار — المرحلة ٢٦: إعدادات تعمل كما تقول (docs/audit/NOTIFICATIONS-AUDIT.ar.md، ع١–ع٦، م٤، م٥).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FAJR_FIRST_ADHAN_OPTIONS,
  FAJR_REMINDER_OPTIONS,
  getAdhanSettings,
  type AdhanSettings,
} from "@/lib/adhan-settings";
import { adhanVariantUrl } from "@/lib/adhan-sound";
import {
  buildPrayerAlarms,
  fajrReminderBody,
  fajrReminderMinutesFor,
  rawResourceName,
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
const base = (): AdhanSettings => structuredClone(getAdhanSettings());
const build = (s: AdhanSettings) =>
  buildPrayerAlarms({ settings: s, location: SANAA, calc: CALC, now: NOW, days: 2 });

/** يقرأ الإعدادات كما تُقرأ في المتصفح/أندرويد من localStorage مُعطى. */
async function readStored(stored: Record<string, unknown> | null, native = false) {
  const store = new Map<string, string>();
  if (stored) store.set("manar.adhan-settings.v2", JSON.stringify(stored));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    ...(native ? { Capacitor: { isNativePlatform: () => true } } : {}),
  });
  vi.resetModules();
  const mod = await import("@/lib/adhan-settings");
  return mod.getAdhanSettings();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("ع١ — تذكير الفجر صار تذكيراً حقيقياً", () => {
  it("مطفأ افتراضياً ودقائقه ٣٠", () => {
    const s = base();
    expect(s.fajrReminderEnabled).toBe(false);
    expect(s.fajrReminderMinutes).toBe(30);
    expect(fajrReminderMinutesFor(s)).toBeNull();
  });

  it("مفعّلاً يعطي دقائقه، ولا يتكرّر مع تنبيهٍ عام بالدقائق نفسها", () => {
    const s = { ...base(), fajrReminderEnabled: true, fajrReminderMinutes: 30 };
    expect(fajrReminderMinutesFor(s)).toBe(30);
    expect(fajrReminderMinutesFor({ ...s, reminderMinutes: [30, 5] as never })).toBeNull();
    // التنبيه العام للفجر مطفأ: لا تكرار، فيبقى تذكير الفجر.
    const perOff = {
      ...s,
      reminderMinutes: [30] as never,
      perPrayer: { ...s.perPrayer, fajr: { ...s.perPrayer.fajr, reminder: false } },
    };
    expect(fajrReminderMinutesFor(perOff)).toBe(30);
  });

  it("النصّ بصيغة العدد العربية", () => {
    expect(fajrReminderBody(30)).toContain("دقيقة");
    expect(fajrReminderBody(10)).toContain("دقائق");
  });

  it("يُجدوَل أصلياً ويُطلَق في الويب", () => {
    // منذ المرحلة ٢٨ في الجدول الموحّد نفسه (الأصلي والويب).
    expect(read("src/lib/prayer-schedule.ts")).toContain("fajrReminderMinutesFor(s)");
    expect(read("src/components/manar/adhan-provider.tsx")).toContain('e.role === "fajr_reminder"');
  });

  it("الخيارات ١٠/١٥/٢٠/٣٠/٤٥/٦٠ ظاهرة في صفحة الأذان", () => {
    expect([...FAJR_REMINDER_OPTIONS]).toEqual([10, 15, 20, 30, 45, 60]);
    expect([...FAJR_FIRST_ADHAN_OPTIONS]).toEqual([10, 15, 20, 30, 45, 60]);
    const page = read("src/routes/adhan.tsx");
    expect(page).toContain("FAJR_REMINDER_OPTIONS");
    expect(page).toContain("FAJR_FIRST_ADHAN_OPTIONS");
    expect(page).not.toMatch(/بـ \$\{settings\.fajrFirstAdhanOffset\} دقيقة/);
  });
});

describe("ترحيل الإعدادات المحفوظة قبل المرحلة ٢٦", () => {
  it("من كان «تذكير الفجر» عنده ظاهراً مفعّلاً بلا أثر يبقى مطفأً", async () => {
    const s = await readStored({ fajrReminderEnabled: true, fajrTathweebEnabled: true });
    expect(s.fajrReminderEnabled).toBe(false);
    expect(s.fajrTathweebEnabled).toBe(true); // الويب كان يُشغّله فعلاً
  });

  it("في أندرويد يبقى التثويب مطفأً كما عاشه المستخدم", async () => {
    const s = await readStored({ fajrTathweebEnabled: true }, true);
    expect(s.fajrTathweebEnabled).toBe(false);
  });

  it("بعد الحفظ بالمخطّط الجديد تُحترم القيم كما هي", async () => {
    const s = await readStored(
      { fajrReminderEnabled: true, fajrReminderMinutes: 45, fajrTathweebEnabled: true },
      true,
    );
    expect(s.fajrReminderEnabled).toBe(true);
    expect(s.fajrReminderMinutes).toBe(45);
    expect(s.fajrTathweebEnabled).toBe(true);
  });

  it("قيم الدقائق التالفة ترجع لافتراضيّها", async () => {
    const s = await readStored({ fajrReminderMinutes: "x", fajrFirstAdhanOffset: 0 });
    expect(s.fajrReminderMinutes).toBe(30);
    expect(s.fajrFirstAdhanOffset).toBe(20);
  });
});

describe("ع٢ — التثويب أصلياً بعد أذان الفجر", () => {
  it("حدث أذان الفجر يحمل مقطع التثويب، وغيره لا", () => {
    const s = { ...base(), fajrTathweebEnabled: true };
    const ev = build(s).filter((e) => e.role === "adhan");
    const fajr = ev.find((e) => e.prayer === "fajr");
    expect(fajr?.follow).toBe(rawResourceName(adhanVariantUrl(s.fajrTathweebAudio)));
    expect(fajr?.follow).toBeTruthy();
    for (const e of ev.filter((x) => x.prayer !== "fajr")) expect(e.follow).toBeUndefined();
  });

  it("مطفأ أو الصوت مطفأ: لا تثويب", () => {
    const off = build({ ...base(), fajrTathweebEnabled: false }).find(
      (e) => e.role === "adhan" && e.prayer === "fajr",
    );
    expect(off?.follow).toBeUndefined();
    const silent = build({ ...base(), fajrTathweebEnabled: true, silentMode: true }).find(
      (e) => e.role === "adhan" && e.prayer === "fajr",
    );
    expect(silent?.follow).toBeUndefined();
  });
});

describe("ع٣ — الاهتزاز يحكم الأذان والتنبيهات", () => {
  it("قنوات التذكيرات لها نسخ `_nv` بلا اهتزاز", async () => {
    vi.resetModules();
    const n = await import("@/lib/native-notifications");
    n.setChannelVibration(false);
    expect(n.defaultReminderChannelFor(100)).toBe("manar_reminders_nv");
    expect(n.defaultReminderChannelFor(60)).toBe("manar_reminders_v60_nv");
    expect(n.defaultReminderChannelFor(0)).toBe("manar_silent");
    n.setChannelVibration(true);
    expect(n.defaultReminderChannelFor(100)).toBe("manar_reminders");
    const src = read("src/lib/native-notifications.ts");
    expect(src).not.toMatch(/vibration: true/);
  });
});

describe("ع٦ — مفتاح «الصوت» ورقاقات الصلوات", () => {
  const page = read("src/routes/notifications.tsx");
  it("مفتاح الصوت يعكس soundEnabled وحده ويشرح الوضع الصامت", () => {
    expect(page).toContain("on={settings.soundEnabled}");
    expect(page).toContain("الوضع الصامت مفعّل");
  });
  it("الرقاقات باهتة إن كان المفتاح العام مطفأً، والمفاتيح role=switch", () => {
    expect(page).toMatch(/master\[k\] \? "" : "opacity-40"/);
    expect(page).toContain('role="switch"');
    expect(page).toContain("aria-checked={on}");
  });
});

/**
 * حارس: كل حقل في إعدادات الأذان إمّا يقرؤه محرّك الجدولة/الخدمة، وإمّا مُعلَنٌ
 * هنا صراحةً أنه للواجهة وحدها. حقلٌ جديد بلا أثر يُسقط هذا الاختبار.
 */
describe("حارس: لا إعداد بلا أثر", () => {
  const UI_ONLY = new Set<keyof AdhanSettings>([]);
  const engine = [
    "src/lib/prayer-schedule.ts",
    "src/lib/native-notifications.ts",
    "src/components/manar/adhan-provider.tsx",
    "src/lib/adhan-settings.ts",
  ]
    .map(read)
    .join("\n")
    // تعريف النوع والافتراضيات لا يُعدّان قراءة.
    .replace(/export type AdhanSettings = \{[\s\S]*?\n\};/, "")
    .replace(/const DEFAULTS: AdhanSettings = \{[\s\S]*?\n\};/, "");

  for (const key of Object.keys(getAdhanSettings()) as (keyof AdhanSettings)[]) {
    it(`«${key}» مقروء في المحرّك`, () => {
      if (UI_ONLY.has(key)) return;
      expect(engine).toMatch(new RegExp(`\\.${key}\\b`));
    });
  }
});

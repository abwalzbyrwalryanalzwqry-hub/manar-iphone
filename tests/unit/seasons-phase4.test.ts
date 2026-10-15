/* مواسم منار — المرحلة الرابعة: الميزات الجديدة. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dayKey, type ActivityLog } from "@/lib/activity-log";
import { formatHijriAr } from "@/lib/format";
import {
  __resetHijriMonthStartsForTests,
  checkHijriMonthStart,
  clearHijriMonthStart,
  confirmHijriMonthStart,
  fromHijri,
  hijriMonthConfirmed,
  hijriMonthLength,
  toHijri,
} from "@/lib/hijri";
import { BACKUP_KEYS, KEY_EVENTS } from "@/lib/local-backup";
import {
  adjustQadaFasts,
  makeUpFast,
  normalizeQada,
  undoMakeUpFast,
  DEFAULT_QADA,
} from "@/lib/qada";
import { SEASONS } from "@/lib/seasons/definitions";
import {
  addDays,
  findSeason,
  getSeasonState,
  instanceStateAt,
  seasonsOverview,
} from "@/lib/seasons/engine";
import { khatmahLine, monthConfirmApplies, summaryApplies } from "@/lib/seasons/extras";
import { DEFAULT_NOTIFY, normalizeStore, planFor, type SeasonsStore } from "@/lib/seasons/store";
import {
  normalizeHistory,
  previousSummary,
  SEASON_HISTORY_KEY,
  seasonSummary,
  summaryShareText,
  withSummary,
} from "@/lib/seasons/summary";
import { widgetSeasonLine } from "@/lib/seasons/widget-line";
import type { Season } from "@/lib/seasons/types";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const H = (year: number, month: number, day: number) => fromHijri({ year, month, day });
const S = (id: string): Season => findSeason(id)!;
const same = (a: Date, b: Date) => dayKey(a) === dayKey(b);

afterEach(() => __resetHijriMonthStartsForTests());

/* ------------------------------ ٤.١ ------------------------------ */

describe("٤.١ تأكيد دخول الشهر", () => {
  /** أول يوم ممكن لرمضان ١٤٤٨ يختلف عن الحساب ويبقي شعبان ٢٩/٣٠. */
  const pickShift = () => {
    const base = H(1448, 9, 1);
    for (const d of [1, -1]) {
      const at = addDays(base, d);
      if (checkHijriMonthStart(1448, 9, at, 0).ok) return { base, at, d };
    }
    throw new Error("لا إزاحة صالحة");
  };

  it("يتقدّم على الحساب في الشهر المؤكَّد وما حوله", () => {
    const { base, at, d } = pickShift();
    expect(confirmHijriMonthStart(1448, 9, at, 0)).toEqual({ ok: true });
    expect(toHijri(at)).toEqual({ year: 1448, month: 9, day: 1 });
    expect(toHijri(addDays(at, -1)).month).toBe(8);
    expect(same(fromHijri({ year: 1448, month: 9, day: 1 }), at)).toBe(true);
    expect([29, 30]).toContain(hijriMonthLength(1448, 8));
    expect([29, 30]).toContain(hijriMonthLength(1448, 9));
    expect(same(hijriMonthConfirmed(1448, 9)!, at)).toBe(true);
    // المواسم تتبع التأكيد (وتُبطل التخزين المؤقت).
    const st = getSeasonState(S("ramadan"), addDays(at, 3))!;
    expect(same(st.instance.startDate, at)).toBe(true);
    // والعرض النصي.
    expect(formatHijriAr(at)).toContain("رمضان");
    // الإلغاء يعيد الحساب.
    clearHijriMonthStart(1448, 9);
    expect(same(fromHijri({ year: 1448, month: 9, day: 1 }), base)).toBe(true);
    expect(d).not.toBe(0);
  });

  it("الشهر التالي يتبع الحساب ما دام طول المؤكَّد ٢٩/٣٠", () => {
    const { at } = pickShift();
    confirmHijriMonthStart(1448, 9, at, 0);
    const shawwal = fromHijri({ year: 1448, month: 10, day: 1 });
    const len = Math.round((shawwal.getTime() - at.getTime()) / 86_400_000);
    expect([29, 30]).toContain(len);
  });

  it("يُرفض ما يبعد أكثر من يومين أو يجعل الشهر السابق ٢٨/٣١", () => {
    const base = H(1448, 9, 1);
    expect(checkHijriMonthStart(1448, 9, addDays(base, 3), 0).ok).toBe(false);
    const both = [-2, 2].map((d) => checkHijriMonthStart(1448, 9, addDays(base, d), 0).ok);
    expect(both).toEqual([false, false]);
    expect(confirmHijriMonthStart(1448, 9, addDays(base, 5), 0).ok).toBe(false);
    expect(hijriMonthConfirmed(1448, 9)).toBeNull();
  });

  it("تُعرض البطاقة قرب بداية الأشهر فقط، ويُحمل المفتاح في النسخة الاحتياطية", () => {
    const r = S("ramadan");
    expect(monthConfirmApplies(getSeasonState(r, addDays(H(1448, 9, 1), -2))!)).toBe(true);
    expect(monthConfirmApplies(getSeasonState(r, H(1448, 9, 3))!)).toBe(true);
    expect(monthConfirmApplies(getSeasonState(r, H(1448, 9, 10))!)).toBe(false);
    expect(monthConfirmApplies(getSeasonState(S("friday"), new Date(2026, 9, 2, 12))!)).toBe(false);
    expect(BACKUP_KEYS).toContain("manar.hijri.month-starts.v1");
    expect(KEY_EVENTS["manar.hijri.month-starts.v1"]).toBe("manar:hijri-adjust");
  });
});

/* ------------------------------ ٤.٢ / ٤.٣ ------------------------------ */

describe("٤.٢ ملخص الموسم و٤.٣ سجلّه", () => {
  const r = S("ramadan");
  const inst = getSeasonState(r, H(1447, 9, 5))!.instance;
  const d = (i: number) => dayKey(addDays(inst.startDate, i));
  const log: ActivityLog = {
    bestStreak: 0,
    days: {
      [d(0)]: {
        prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
        ayahs: 10,
        azkar: 1,
        wird: [],
      },
      [d(1)]: { prayers: ["fajr"], ayahs: 0, azkar: 0, wird: [] },
    },
  };
  const plan = {
    fast: { enabled: true, frequency: "daily" as const, target: 1, done: [d(0), d(1), d(2)] },
  };

  it("الأهداف والمجاميع من أيام النسخة", () => {
    const s = seasonSummary(inst, plan, log, addDays(inst.endDate, 2));
    expect(s.days).toBe(inst.length);
    expect(s.goals).toEqual([
      expect.objectContaining({ id: "fast", done: 3, target: inst.length, once: false }),
    ]);
    expect(s.totals).toEqual({ prayers: 6, ayahs: 10, azkar: 1, activeDays: 2 });
    const text = summaryShareText(s);
    expect(text).toContain("حصيلتي في رمضان ١٤٤٧هـ");
    expect(text).toContain("صيام اليوم: ٣ /");
    expect(text).toContain("الصلوات المسجّلة: ٦");
  });

  it("يظهر بعد النهاية أو في آخر يومين", () => {
    expect(summaryApplies(getSeasonState(r, H(1447, 10, 3))!)).toBe(true);
    expect(summaryApplies(getSeasonState(r, H(1447, 9, 10))!)).toBe(false);
    expect(summaryApplies(getSeasonState(r, addDays(inst.endDate, 0))!)).toBe(true);
  });

  it("السجل مستقل ويقارن بالعام الماضي", () => {
    const now = seasonSummary(inst, plan, log, addDays(inst.endDate, 1));
    const old = { ...now, key: "ramadan@2025-03-01", hijriYear: 1446 };
    let h = withSummary({}, old);
    h = withSummary(h, now);
    expect(withSummary(h, now)).toBe(h); // بلا تغيير ← المرجع نفسه
    expect(previousSummary(h, now)?.hijriYear).toBe(1446);
    expect(normalizeHistory(JSON.parse(JSON.stringify(h)))).toEqual(h);
    expect(normalizeHistory({ x: { seasonId: 3 } })).toEqual({});
    expect(BACKUP_KEYS).toContain(SEASON_HISTORY_KEY);
  });
});

/* ------------------------------ ٤.٤ ------------------------------ */

describe("٤.٤ قالب الخطة للمواسم المتكررة", () => {
  it("نسخة جديدة بلا خطة تبدأ من القالب، والمحفوظة تبقى كما هي", () => {
    const store: SeasonsStore = normalizeStore({
      notify: DEFAULT_NOTIFY,
      plans: {
        "friday@2026-10-02": {
          kahf: { enabled: true, frequency: "once", target: 1, done: ["2026-10-02"] },
        },
      },
      templates: { friday: { kahf: { frequency: "once", target: 1 }, bad: { target: "x" } } },
    });
    expect(store.templates.friday.bad).toEqual({ frequency: "daily", target: 1 });
    expect(planFor(store, "friday@2026-10-09").kahf).toEqual({
      enabled: true,
      frequency: "once",
      target: 1,
      done: [],
    });
    expect(planFor(store, "friday@2026-10-02").kahf.done).toEqual(["2026-10-02"]);
    expect(planFor(store, "ramadan@2027-02-08")).toEqual({});
    expect(normalizeStore({}).templates).toEqual({});
  });

  it("الواجهة تعرض «احفظ خطتي لكل …» للمتكررة", () => {
    const page = read("src/routes/seasons.$season.tsx");
    expect(page).toContain("احفظ خطتي لكل");
    expect(page).toContain("planFor(store, key)");
  });
});

/* ------------------------------ ٤.٥ ------------------------------ */

describe("٤.٥ عدّاد قضاء الصيام", () => {
  it("إضافة وطرح وتراجع، والبيانات القديمة سليمة", () => {
    expect(normalizeQada({ enabled: true, remaining: {}, madeUp: 2 })).toMatchObject({
      fasts: 0,
      fastsMadeUp: 0,
      madeUp: 2,
    });
    let q = adjustQadaFasts(DEFAULT_QADA, 3);
    q = makeUpFast(q);
    expect(q).toMatchObject({ fasts: 2, fastsMadeUp: 1 });
    q = undoMakeUpFast(q);
    expect(q).toMatchObject({ fasts: 3, fastsMadeUp: 0 });
    expect(makeUpFast({ ...q, fasts: 0 }).fastsMadeUp).toBe(0);
  });

  it("أهداف القضاء في شعبان وقبل رمضان مربوطة بالعدّاد", () => {
    const tagged = SEASONS.flatMap((s) =>
      s.recommendedActions.filter((a) => a.goal?.qada).map((a) => `${s.id}/${a.id}`),
    );
    expect(tagged.sort()).toEqual(["ramadan/qada", "shaban/qada"]);
    expect(read("src/components/manar/qada-card.tsx")).toContain("أيام الصيام");
  });
});

/* ------------------------------ ٤.٦ ------------------------------ */

describe("٤.٦ الختمة في صفحة الموسم", () => {
  it("سطر التقدّم بالأجزاء والصفحات", () => {
    expect(khatmahLine(60, 0, false, "active")).toBe("أنت متأخر ٣ أجزاء عن الجدول");
    expect(khatmahLine(20, 0, false, "active")).toBe("أنت متأخر جزءًا واحدًا عن الجدول");
    expect(khatmahLine(2, 0, false, "active")).toBe("أنت متأخر صفحتين عن الجدول");
    expect(khatmahLine(0, 5, true, "active")).toBe("متقدّم ٥ صفحات على الجدول");
    expect(khatmahLine(0, 0, true, "active")).toBe("أتممت ورد اليوم");
    expect(khatmahLine(0, 0, false, "finished")).toBe("تقبّل الله منك.");
  });
});

/* ------------------------------ ٤.٧ ------------------------------ */

describe("٤.٧ الموسم في الويدجت", () => {
  it("سطر رمضان مع الإفطار، ولا سطر في يوم عادي", () => {
    expect(widgetSeasonLine(H(1447, 9, 12), 0, "٦:٢١ م")).toBe(
      "اليوم ١٢ من رمضان · الإفطار ٦:٢١ م",
    );
    expect(widgetSeasonLine(H(1447, 12, 5), 0, "٦:٠٠ م")).toBe("اليوم ٥ من ذي الحجة");
    expect(widgetSeasonLine(H(1447, 5, 10), 0)).toBeUndefined();
  });
});

/* ------------------------------ ٤.٨ ------------------------------ */

describe("٤.٨ الأشهر الحُرُم", () => {
  it("رجب وذو القعدة بآية التوبة وبلا تنبيهات", () => {
    for (const id of ["rajab", "dhul-qadah"]) {
      const s = S(id);
      expect(s.reminders).toEqual([]);
      expect(s.priority).toBeLessThan(30);
      expect(s.phases[0].content).toContainEqual({ kind: "ayah", surah: 9, from: 36 });
    }
    expect(seasonsOverview(H(1447, 7, 10)).featured?.instance.season.id).toBe("rajab");
    // ذو الحجة القريب يتقدّم على ذي القعدة.
    const late = seasonsOverview(addDays(H(1447, 12, 1), -3));
    expect(late.featured?.instance.season.id).toBe("dhul-hijjah");
  });
});

/* ------------------------------ B17 ------------------------------ */

describe("B17 المواسم الماضية تفتح نسختها", () => {
  it("instanceStateAt يعيد النسخة المنتهية", () => {
    const r = S("ramadan");
    const now = H(1447, 11, 1);
    const past = getSeasonState(r, H(1447, 9, 5))!.instance;
    const at = past.key.split("@")[1];
    const st = instanceStateAt(r, at, now)!;
    expect(st.status).toBe("ended");
    expect(st.instance.key).toBe(past.key);
    expect(instanceStateAt(r, "2000-01-01", now)).toBeNull();
    expect(instanceStateAt(r, "x", now)).toBeNull();
    expect(read("src/routes/seasons.index.tsx")).toContain(
      'search={muted ? { at: st.instance.key.split("@")[1] } : {}}',
    );
  });
});

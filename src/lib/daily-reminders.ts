/* منار — تذكيرات الأذكار والوِرد اليومي.
 *
 * منفصلة عن تنبيهات الصلاة لأنها مختلفة في جوهرها: تنبيه الصلاة يتبع حساباً
 * فلكياً لا يملك المستخدم توقيته، أما هذه فيختار المستخدم ساعتها بنفسه — وقد
 * يربطها بصلاة (بعد الفجر، قبل المغرب) فتتحرّك معها كل يوم.
 */

import { displayPrefs } from "./display-prefs";
import { useEffect, useState } from "react";
import { PRAYER_LABELS, PRAYER_ORDER, type PrayerKey } from "./prayer";

/* فهرس أصوات «تذكيرات الأذكار والوِرد» وحده. لا يُقرأ منه إلا هذا القسم، ولا
 * يعرف شيئاً عن أصوات «اقتراب الصلاة» (src/lib/prayer-approach-audio.ts) —
 * فلا يمكن أن يظهر صوتٌ من إحدى الحزمتين في قائمة الأخرى. */
export const AZKAR_WIRD_AUDIO_CATEGORY = "azkar_wird_reminders";

/* قسم التذكيرات بالنداءات الصوتية وحدها: النغمات المولَّدة (إشراق، أصيل، تأمّل،
 * جرس، هادئ، نقرة) حُذفت مع ملفاتها، وكل تذكير يبدأ بندائه المقترح. من كان
 * اختار نغمةً ينتقل تلقائياً إلى النداء المقترح لتذكيره (انظر `normalizeItem`). */
export const REMINDER_TONES = [
  /* حزمة «أصوات تذكيرات الأذكار والوِرد» — نداء صوتي واحد لكل موضوع. كانت
   * الحزمة ١٢ نداءً، منها أداءان وثلاثة للموضوع نفسه («أذكار الصباح»،
   * «أذكارُ الصباح»، «حان وقت أذكار الصباح»…) فتتكرّر في كل تذكير بلا فائدة.
   * بقي أوضحها صيغةً («حان وقت…»، «لا تنسَ…») والمحذوف يُنقل تلقائياً
   * (`REMOVED_TONE_MIGRATION`). */
  {
    id: "azkar-morning-03",
    name: "حان وقت أذكار الصباح",
    hint: "نداء صوتي",
    url: "/audio/reminders/azkar-morning-03.mp3",
    kind: "voice",
    topic: "morning",
  },
  {
    id: "azkar-evening-02",
    name: "حان وقت أذكار المساء",
    hint: "نداء صوتي",
    url: "/audio/reminders/azkar-evening-02.mp3",
    kind: "voice",
    topic: "evening",
  },
  {
    id: "azkar-sleep-02",
    name: "حان وقت أذكار النوم",
    hint: "نداء صوتي",
    url: "/audio/reminders/azkar-sleep-02.mp3",
    kind: "voice",
    topic: "sleep",
  },
  {
    id: "azkar-wake-01",
    name: "أذكار الاستيقاظ من النوم",
    hint: "نداء صوتي",
    url: "/audio/reminders/azkar-wake-01.mp3",
    kind: "voice",
    topic: "wake",
  },
  {
    id: "wird-daily-01",
    name: "لا تنسَ وِردك اليومي",
    hint: "نداء صوتي",
    url: "/audio/reminders/wird-daily-01.mp3",
    kind: "voice",
    topic: "wird",
  },
  {
    id: "wird-quran-01",
    name: "لا تنسَ وِردك من القرآن",
    hint: "نداء صوتي",
    url: "/audio/reminders/wird-quran-01.mp3",
    kind: "voice",
    topic: "quran",
  },
  {
    id: "azkar-general-01",
    name: "لا تنسَ الأذكار",
    hint: "نداء صوتي عام",
    url: "/audio/reminders/azkar-general-01.mp3",
    kind: "voice",
    topic: "general",
  },
  { id: "silent", name: "صامت", hint: "إشعار بلا صوت", url: "", kind: "silent" },
] as const;

/** نغمات حُذفت من القسم — يُستبدل بها النداء المقترح للتذكير نفسه. */
export const REMOVED_TONES: ReadonlySet<string> = new Set([
  "azkar-morning",
  "azkar-evening",
  "wird",
  "reminder-bell",
  "reminder-default",
  "reminder-chime",
]);

export type ReminderToneId = (typeof REMINDER_TONES)[number]["id"];

/** موضوع النداء الصوتي — يحدّد في أي تذكير يظهر. */
export type VoiceTopic = "morning" | "evening" | "sleep" | "wake" | "wird" | "quran" | "general";

/** النداءات المحذوفة ← النداء الباقي للموضوع نفسه، حتى لا يصمت اختيارٌ محفوظ. */
export const REMOVED_TONE_MIGRATION: Record<string, ReminderToneId> = {
  "azkar-morning-01": "azkar-morning-03",
  "azkar-morning-02": "azkar-morning-03",
  "azkar-evening-01": "azkar-evening-02",
  "azkar-sleep-01": "azkar-sleep-02",
  "azkar-general-02": "azkar-general-01",
};

export function isToneId(v: unknown): v is ReminderToneId {
  return typeof v === "string" && REMINDER_TONES.some((t) => t.id === v);
}

/** يحوّل أي صوت محفوظ إلى معرّف صالح، أو null إن لم يكن معروفاً. */
export function migrateToneId(v: unknown): ReminderToneId | null {
  if (isToneId(v)) return v;
  if (typeof v === "string" && REMOVED_TONE_MIGRATION[v]) return REMOVED_TONE_MIGRATION[v];
  return null;
}

export function toneUrl(id: ReminderToneId): string {
  return REMINDER_TONES.find((t) => t.id === id)?.url ?? "";
}

export function toneName(id: ReminderToneId): string {
  return REMINDER_TONES.find((t) => t.id === id)?.name ?? "صامت";
}

export type ToneKind = "voice" | "silent";

/** نوع الصوت: نداء صوتي، أو صامت. */
export function toneKind(id: ReminderToneId): ToneKind {
  return REMINDER_TONES.find((t) => t.id === id)?.kind ?? "voice";
}

/** النداء الصوتي المقترح لكل تذكير مبنيّ — يطابق موضوعه («أذكار الصباح» لتذكير الصباح). */
export const SUGGESTED_TONE: Record<string, ReminderToneId> = {
  "azkar-morning": "azkar-morning-03",
  "azkar-evening": "azkar-evening-02",
  wird: "wird-daily-01",
  "sleep-azkar": "azkar-sleep-02",
  "wake-azkar": "azkar-wake-01",
};

/* النداءات التي تناسب كل تذكير: نداء موضوعه أولاً، ثم ما يقاربه. «تذكير» العامّ
 * المضاف يعرض الكل لأن موضوعه يختاره المستخدم. */
const VOICE_TOPICS: Record<string, readonly VoiceTopic[]> = {
  "azkar-morning": ["morning", "general"],
  "azkar-evening": ["evening", "general"],
  wird: ["wird", "quran"],
  "sleep-azkar": ["sleep", "general"],
  "wake-azkar": ["wake", "general"],
};
const TEMPLATE_VOICE_TOPICS: Record<CustomTemplateId, readonly VoiceTopic[] | null> = {
  "after-prayer": ["general"],
  duha: ["general", "wird"],
  quran: ["quran", "wird"],
  other: null,
};

type ToneEntry = (typeof REMINDER_TONES)[number];

/**
 * خيارات الصوت لتذكير: النداءات المناسبة لموضوعه (المقترح أولاً)، ثم «صامت».
 * والنداء المختار حالياً يبقى ظاهراً ولو لم يكن من موضوعه، حتى لا يختفي
 * اختيار المستخدم.
 */
export function toneOptionsFor(r: Pick<DailyReminder, "id" | "template" | "tone">): ToneEntry[] {
  const suggested = suggestedToneFor(r);
  let list: ToneEntry[] = REMINDER_TONES.filter((t) => t.kind === "voice");
  const topics =
    VOICE_TOPICS[r.id] ?? (r.template ? TEMPLATE_VOICE_TOPICS[r.template] : null) ?? null;
  if (topics) {
    const rank = (t: ToneEntry) => {
      const topic = "topic" in t ? t.topic : undefined;
      const i = topic ? topics.indexOf(topic) : -1;
      return i < 0 ? topics.length : i;
    };
    list = list
      .filter((t) => rank(t) < topics.length || t.id === r.tone)
      .sort((a, b) => rank(a) - rank(b));
  }
  list = list.slice().sort((a, b) => Number(b.id === suggested) - Number(a.id === suggested));
  return [...list, ...REMINDER_TONES.filter((t) => t.kind === "silent")];
}

export function suggestedToneFor(r: Pick<DailyReminder, "id" | "template">): ReminderToneId | null {
  return SUGGESTED_TONE[r.id] ?? (r.template ? (CUSTOM_TEMPLATES[r.template]?.tone ?? null) : null);
}

/** أي أيام الأسبوع يعمل فيها التذكير — ٠ الأحد … ٦ السبت (كـ`Date.getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** أسماء الأيام مرتّبة كما تُعرض في الواجهة العربية: السبت أولاً. */
export const WEEKDAY_ORDER: Weekday[] = [6, 0, 1, 2, 3, 4, 5];
export const WEEKDAY_SHORT: Record<Weekday, string> = {
  0: "أحد",
  1: "اثنين",
  2: "ثلاثاء",
  3: "أربعاء",
  4: "خميس",
  5: "جمعة",
  6: "سبت",
};

/**
 * توقيت التذكير: إمّا ساعة ثابتة، أو منسوب إلى صلاة فيتحرّك معها يومياً.
 *
 * النسبة إلى صلاة هي الطلب الحقيقي: من يريد وِرده «بعد الفجر» لا يريده الساعة
 * الخامسة — لأن الفجر يتقدّم ويتأخّر نحو ساعة على مدار السنة.
 */
export type ReminderTiming =
  | { mode: "clock"; hour: number; minute: number }
  | { mode: "prayer"; prayer: PrayerKey; offset: number };

export type DailyReminder = {
  id: string;
  /** اسم يظهر للمستخدم؛ التذكيرات المبنيّة لها أسماء ثابتة. */
  name: string;
  enabled: boolean;
  timing: ReminderTiming;
  tone: ReminderToneId;
  days: Weekday[];
  /** المسار الذي يُفتح عند لمس الإشعار. */
  route: ReminderRoute;
  /** نصّ الإشعار. */
  body: string;
  /** آخر توقيت بالنمط الآخر — يُستعاد عند الرجوع إليه بدل قيمة ثابتة. */
  altTiming?: ReminderTiming;
  /** تذكير أضافه المستخدم (قابل للحذف). */
  custom?: boolean;
  /** القالب الذي أُنشئ منه التذكير المضاف. */
  template?: CustomTemplateId;
  /** تخطّي تذكير اليوم إن أُنجز العمل قبله (للتذكيرات التي يُسجَّل إنجازها). */
  skipIfDone?: boolean;
};

/** المسارات المسموح أن يفتحها إشعار تذكير — لا يُفتح مسار مجهول من بيانات محفوظة. */
export const REMINDER_ROUTES = [
  "/azkar",
  "/wird",
  "/quran",
  /* وجهات التذكيرات المبنيّة: الباب أو الوِرد المقصود مباشرة. */
  "/azkar/1",
  "/azkar/27?time=morning",
  "/azkar/27?time=evening",
  "/azkar/28",
  "/wird/morning",
] as const;
export type ReminderRoute = (typeof REMINDER_ROUTES)[number];

export function isReminderRoute(v: unknown): v is ReminderRoute {
  return typeof v === "string" && (REMINDER_ROUTES as readonly string[]).includes(v);
}

/* ---------------------- التذكيرات التي يضيفها المستخدم ---------------------- */

export type CustomTemplateId = "after-prayer" | "duha" | "quran" | "other";

export const CUSTOM_TEMPLATES: Record<
  CustomTemplateId,
  { name: string; body: string; route: ReminderRoute; timing: ReminderTiming; tone: ReminderToneId }
> = {
  "after-prayer": {
    name: "الأذكار بعد الصلاة",
    body: "لا تنسَ الأذكار بعد الصلاة",
    route: "/azkar",
    timing: { mode: "prayer", prayer: "dhuhr", offset: 15 },
    tone: "azkar-general-01",
  },
  duha: {
    name: "ورد الضحى",
    body: "حان وقت الضحى",
    route: "/wird",
    timing: { mode: "prayer", prayer: "sunrise", offset: 30 },
    tone: "azkar-general-01",
  },
  quran: {
    name: "وِرد القرآن",
    body: "لا تنسَ وِردك من القرآن",
    route: "/quran",
    timing: { mode: "clock", hour: 21, minute: 0 },
    tone: "wird-quran-01",
  },
  other: {
    name: "تذكير",
    body: "حان وقت الذكر",
    route: "/azkar",
    timing: { mode: "clock", hour: 12, minute: 0 },
    tone: "azkar-general-01",
  },
};

export const MAX_CUSTOM_REMINDERS = 10;

export function isCustomId(id: string): boolean {
  return /^custom-[a-z0-9]+$/.test(id);
}

export type DailyRemindersState = {
  /** مفتاح عام يُسكِت كل هذه التذكيرات دون فقدان إعداداتها. */
  enabled: boolean;
  items: DailyReminder[];
};

/* التذكيرات المبنيّة افتراضياً. أوقاتها منسوبة إلى الصلاة لا إلى الساعة،
 * لأن أذكار الصباح بعد الفجر وأذكار المساء بعد العصر هي المعروف شرعاً. */
export const DEFAULT_REMINDERS: DailyReminder[] = [
  {
    id: "azkar-morning",
    name: "أذكار الصباح",
    /* مطفأ افتراضيًا: «ورد الصباح» (الفجر + ٢٠) يغني عنه، فلا يصل تذكيران متتاليان. */
    enabled: false,
    timing: { mode: "prayer", prayer: "fajr", offset: 45 },
    tone: "azkar-morning-03",
    days: [...ALL_DAYS],
    route: "/azkar/27?time=morning",
    body: "حان وقت أذكار الصباح",
    skipIfDone: true,
  },
  {
    id: "azkar-evening",
    name: "أذكار المساء",
    enabled: true,
    timing: { mode: "prayer", prayer: "asr", offset: 30 },
    tone: "azkar-evening-02",
    days: [...ALL_DAYS],
    route: "/azkar/27?time=evening",
    body: "حان وقت أذكار المساء",
    skipIfDone: true,
  },
  {
    id: "wird",
    name: "ورد الصباح",
    enabled: true,
    timing: { mode: "prayer", prayer: "fajr", offset: 20 },
    tone: "wird-daily-01",
    days: [...ALL_DAYS],
    route: "/wird/morning",
    body: "حان وقت وِرد الصباح",
    skipIfDone: true,
  },
  {
    id: "sleep-azkar",
    name: "أذكار النوم",
    enabled: false,
    timing: { mode: "clock", hour: 22, minute: 30 },
    tone: "azkar-sleep-02",
    days: [...ALL_DAYS],
    route: "/azkar/28",
    body: "لا تنم قبل أذكار النوم",
    skipIfDone: true,
  },
  /* كان هنا «وِرد قبل النوم» فيتداخل مع «أذكار النوم»؛ حلّ محلّه تذكير
   * «أذكار الاستيقاظ من النوم» (فصل ١ من حصن المسلم) قبيل الفجر. */
  {
    id: "wake-azkar",
    name: "أذكار الاستيقاظ من النوم",
    enabled: false,
    timing: { mode: "prayer", prayer: "fajr", offset: -15 },
    tone: "azkar-wake-01",
    days: [...ALL_DAYS],
    route: "/azkar/1",
    body: "ابدأ يومك بأذكار الاستيقاظ من النوم",
    skipIfDone: true,
  },
];

const DEFAULTS: DailyRemindersState = { enabled: true, items: DEFAULT_REMINDERS };

const KEY = "manar.daily-reminders.v1";
const EVENT = "manar:daily-reminders";

/* -------------------------------- حراسة -------------------------------- */

function clampInt(v: unknown, lo: number, hi: number, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.trunc(n))) : fb;
}

function normalizeTiming(raw: unknown, fb: ReminderTiming): ReminderTiming {
  const t = raw as Partial<ReminderTiming> | undefined;
  if (t?.mode === "clock") {
    return {
      mode: "clock",
      hour: clampInt((t as { hour?: unknown }).hour, 0, 23, 6),
      minute: clampInt((t as { minute?: unknown }).minute, 0, 59, 0),
    };
  }
  if (t?.mode === "prayer") {
    const p = (t as { prayer?: unknown }).prayer;
    return {
      mode: "prayer",
      prayer: (typeof p === "string" && p in PRAYER_LABELS ? p : "fajr") as PrayerKey,
      offset: clampInt((t as { offset?: unknown }).offset, -120, 240, 0),
    };
  }
  return fb;
}

function normalizeItem(raw: unknown, fb: DailyReminder): DailyReminder {
  const r = (raw ?? {}) as Partial<DailyReminder>;
  const days = Array.isArray(r.days)
    ? ([...new Set(r.days)].filter((d) => ALL_DAYS.includes(d as Weekday)) as Weekday[])
    : fb.days;
  const timing = normalizeTiming(r.timing, fb.timing);
  const alt = r.altTiming ? normalizeTiming(r.altTiming, fb.timing) : undefined;
  const custom = !!fb.custom;
  return {
    id: fb.id,
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 40) : fb.name,
    enabled: typeof r.enabled === "boolean" ? r.enabled : fb.enabled,
    timing,
    ...(alt && alt.mode !== timing.mode ? { altTiming: alt } : {}),
    tone: migrateToneId(r.tone) ?? fb.tone,
    /* قائمة أيام فارغة تعني تذكيراً لا يعمل أبداً وهو غالباً خطأ حفظ، فنرجع
     * للأيام الافتراضية بدل إسكات التذكير بلا سبب ظاهر للمستخدم. */
    days: days.length ? days.sort((a, b) => a - b) : fb.days,
    /* المبنيّة: المسار والنصّ من الشيفرة دائماً. المضافة: من المحفوظ بعد الفحص. */
    route: custom && isReminderRoute(r.route) ? r.route : fb.route,
    body:
      custom && typeof r.body === "string" && r.body.trim() ? r.body.trim().slice(0, 80) : fb.body,
    ...(custom ? { custom: true, template: fb.template } : {}),
    skipIfDone:
      fb.skipIfDone === undefined
        ? undefined
        : typeof r.skipIfDone === "boolean"
          ? r.skipIfDone
          : fb.skipIfDone,
  };
}

/** تذكير مضاف جديد من قالب. `id` يُمرَّر في الاختبارات فقط. */
export function newCustomReminder(
  template: CustomTemplateId,
  name?: string,
  id = `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
): DailyReminder {
  const t = CUSTOM_TEMPLATES[template];
  return {
    id,
    name: name?.trim() ? name.trim().slice(0, 40) : t.name,
    enabled: true,
    timing: { ...t.timing },
    tone: t.tone,
    days: [...ALL_DAYS],
    route: t.route,
    body: t.body,
    custom: true,
    template,
  };
}

function normalizeCustom(raw: unknown): DailyReminder | null {
  const r = (raw ?? {}) as Partial<DailyReminder>;
  if (typeof r.id !== "string" || !isCustomId(r.id)) return null;
  const template: CustomTemplateId =
    typeof r.template === "string" && r.template in CUSTOM_TEMPLATES
      ? (r.template as CustomTemplateId)
      : "other";
  return normalizeItem(raw, newCustomReminder(template, undefined, r.id));
}

/** يحوّل أي محتوى محفوظ إلى حالة صالحة. دالّة نقيّة — تُختبر بلا متصفح. */
export function normalizeRemindersState(parsed: unknown): DailyRemindersState {
  const p = (parsed ?? {}) as { enabled?: unknown; items?: unknown };
  const stored = Array.isArray(p.items) ? (p.items as Partial<DailyReminder>[]) : [];
  /* نبني المبنيّة من التذكيرات المعروفة لا من المحفوظ: هكذا يحصل من حدّث
   * التطبيق على أي تذكير جديد، ولا يبقى في تخزينه تذكير أُزيل من الشيفرة.
   * ثم تُلحق التذكيرات التي أضافها المستخدم بعد فحصها. */
  const builtIn = DEFAULT_REMINDERS.map((d) =>
    normalizeItem(
      stored.find((s) => s?.id === d.id),
      d,
    ),
  );
  const seen = new Set<string>();
  const custom: DailyReminder[] = [];
  for (const raw of stored) {
    const c = normalizeCustom(raw);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    custom.push(c);
    if (custom.length >= MAX_CUSTOM_REMINDERS) break;
  }
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : true,
    items: [...builtIn, ...custom],
  };
}

export function readReminders(): DailyRemindersState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return normalizeRemindersState(raw ? JSON.parse(raw) : {});
  } catch {
    return DEFAULTS;
  }
}

export function writeReminders(next: DailyRemindersState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useDailyReminders() {
  const [state, setState] = useState<DailyRemindersState>(DEFAULTS);

  useEffect(() => {
    const sync = () => setState(readReminders());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const commit = (next: DailyRemindersState) => {
    setState(next);
    writeReminders(next);
  };

  const setEnabled = (enabled: boolean) => commit({ ...readReminders(), enabled });

  const patch = (id: string, p: Partial<DailyReminder>) => {
    const cur = readReminders();
    commit({
      ...cur,
      items: cur.items.map((it) => (it.id === id ? { ...it, ...p } : it)),
    });
  };

  const toggleDay = (id: string, day: Weekday) => {
    const cur = readReminders();
    const item = cur.items.find((i) => i.id === id);
    if (!item) return;
    const has = item.days.includes(day);
    const days = has ? item.days.filter((d) => d !== day) : [...item.days, day];
    /* لا نسمح بإفراغ القائمة كلها: التذكير الذي لا يعمل في أي يوم مُربِك —
     * إسكاته يكون بمفتاحه لا بحذف أيامه واحداً واحداً. */
    if (!days.length) return;
    patch(id, { days: days.sort((a, b) => a - b) });
  };

  /** استعادة القيم الافتراضية للتذكيرات المبنيّة. التذكيرات المضافة لا تُمسّ. */
  const reset = () => {
    const cur = readReminders();
    commit({ enabled: true, items: [...DEFAULT_REMINDERS, ...cur.items.filter((i) => i.custom)] });
  };

  const addCustom = (template: CustomTemplateId, name?: string): DailyReminder | null => {
    const cur = readReminders();
    if (cur.items.filter((i) => i.custom).length >= MAX_CUSTOM_REMINDERS) return null;
    const item = newCustomReminder(template, name);
    commit({ ...cur, items: [...cur.items, item] });
    return item;
  };

  const remove = (id: string) => {
    if (!isCustomId(id)) return;
    const cur = readReminders();
    commit({ ...cur, items: cur.items.filter((i) => i.id !== id) });
  };

  return { state, setEnabled, patch, toggleDay, reset, addCustom, remove };
}

/* ------------------------------ الحساب ------------------------------ */

/**
 * وقت التذكير في يوم بعينه.
 *
 * `prayerTimeFor` تُمرَّر من الخارج فتُغني هذه الوحدة عن معرفة الموقع وطريقة
 * الحساب، وتبقى قابلة للاختبار وحدها.
 */
export function reminderTimeOn(
  r: DailyReminder,
  date: Date,
  prayerTimeFor: (p: PrayerKey, d: Date) => Date,
): Date | null {
  if (!r.days.includes(date.getDay() as Weekday)) return null;
  if (r.timing.mode === "clock") {
    const d = new Date(date);
    d.setHours(r.timing.hour, r.timing.minute, 0, 0);
    return d;
  }
  const base = prayerTimeFor(r.timing.prayer, date);
  return new Date(base.getTime() + r.timing.offset * 60_000);
}

/** وصف التوقيت للعرض — نصّ واحد يفهمه المستخدم بلا شرح. */
export function describeTiming(t: ReminderTiming, digits: (s: string | number) => string): string {
  if (t.mode === "clock") {
    const h24 = t.hour;
    if (displayPrefs().clock === "24") {
      return `${digits(String(h24).padStart(2, "0"))}:${digits(String(t.minute).padStart(2, "0"))}`;
    }
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const suffix = h24 < 12 ? "صباحاً" : "مساءً";
    return `${digits(h12)}:${digits(String(t.minute).padStart(2, "0"))} ${suffix}`;
  }
  const label = PRAYER_LABELS[t.prayer].ar;
  if (t.offset === 0) return `مع ${label}`;
  const mins = Math.abs(t.offset);
  const unit =
    mins % 60 === 0 && mins >= 60
      ? `${digits(mins / 60)} ${mins === 60 ? "ساعة" : "ساعات"}`
      : `${digits(mins)} دقيقة`;
  return t.offset > 0 ? `بعد ${label} بـ${unit}` : `قبل ${label} بـ${unit}`;
}

/* --------------------------- خيارات الإزاحة --------------------------- */

/** خيارات الإزاحة المنسوبة لصلاة — بالدقائق. تضمّ ٢٠ لأنها افتراضيّ «الوِرد اليومي». */
export const PRAYER_OFFSET_OPTIONS = [-30, -15, 0, 15, 20, 30, 45, 60, 90, 120] as const;

/**
 * الخيارات المعروضة لتذكير بعينه: القائمة الثابتة مع قيمته الحالية إن لم تكن
 * فيها، حتى يظهر اختياره مفعّلاً دائماً (كانت ٢٠ دقيقة للوِرد بلا اختيار ظاهر).
 */
export function offsetOptionsFor(current: number): number[] {
  const set = new Set<number>(PRAYER_OFFSET_OPTIONS);
  set.add(current);
  return [...set].sort((a, b) => a - b);
}

/* ---------------------------- الساعة الثابتة ---------------------------- */

/**
 * يحرّك الساعة الثابتة بعدد دقائق مع نقل الساعة: من ١١:٥٥ + ٥ يصير ١٢:٠٠ لا
 * ١١:٠٠. الخطوة تلتصق بمضاعفاتها أولاً (١١:٥٧ + ٥ ← ١٢:٠٠، و− ٥ ← ١١:٥٥).
 */
export function stepClock(
  hour: number,
  minute: number,
  delta: number,
): { hour: number; minute: number } {
  const total = hour * 60 + minute;
  const step = Math.abs(delta);
  let next: number;
  if (step > 1 && total % step !== 0) {
    next = delta > 0 ? Math.ceil(total / step) * step : Math.floor(total / step) * step;
  } else {
    next = total + delta;
  }
  const wrapped = ((next % 1440) + 1440) % 1440;
  return { hour: Math.floor(wrapped / 60), minute: wrapped % 60 };
}

/** الساعة بنظام ١٢ ساعة مع ص/م — كما يُعرض الوصف فوق المحدِّد. */
export function to12h(hour: number): { h12: number; pm: boolean } {
  return { h12: hour % 12 === 0 ? 12 : hour % 12, pm: hour >= 12 };
}

export function from12h(h12: number, pm: boolean): number {
  const h = ((Math.round(h12) % 12) + 12) % 12;
  return pm ? h + 12 : h;
}

/* ------------------------ تبديل نوع التوقيت ------------------------ */

type PrayerTimes = Record<PrayerKey, Date>;

/**
 * يبدّل بين «منسوب لصلاة» و«ساعة ثابتة» دون محو الإعداد السابق:
 *   - إن سبق للتذكير توقيت بالنمط المطلوب يُستعاد كما كان.
 *   - وإلا يُشتقّ من الوقت الفعلي نفسه: ساعة ثابتة = موعده اليوم مقرّباً لخمس
 *     دقائق، ومنسوب لصلاة = أقرب صلاة قبل الساعة المختارة وفرقها عنها.
 * والتوقيت الحالي يُحفظ في `altTiming` ليُستعاد عند الرجوع.
 */
export function switchTimingMode(
  r: DailyReminder,
  mode: ReminderTiming["mode"],
  times: PrayerTimes,
): Pick<DailyReminder, "timing" | "altTiming"> {
  if (r.timing.mode === mode) return { timing: r.timing, altTiming: r.altTiming };
  let next: ReminderTiming;
  if (r.altTiming && r.altTiming.mode === mode) {
    next = r.altTiming;
  } else if (mode === "clock" && r.timing.mode === "prayer") {
    const at = new Date(times[r.timing.prayer].getTime() + r.timing.offset * 60_000);
    const total = Math.round((at.getHours() * 60 + at.getMinutes()) / 5) * 5;
    const wrapped = ((total % 1440) + 1440) % 1440;
    next = { mode: "clock", hour: Math.floor(wrapped / 60), minute: wrapped % 60 };
  } else if (r.timing.mode === "clock") {
    const target = r.timing.hour * 60 + r.timing.minute;
    const mins = (d: Date) => d.getHours() * 60 + d.getMinutes();
    let best: { prayer: PrayerKey; offset: number } = { prayer: "fajr", offset: 30 };
    let bestAbs = Infinity;
    for (const p of PRAYER_ORDER) {
      if (!(times[p] instanceof Date)) continue;
      const offset = Math.round((target - mins(times[p])) / 5) * 5;
      // نفضّل «بعد صلاة» على «قبل صلاة»، وفي حدود ما يقبله الحفظ.
      if (offset < -120 || offset > 240) continue;
      const score = offset >= 0 ? offset : Math.abs(offset) * 2;
      if (score < bestAbs) {
        bestAbs = score;
        best = { prayer: p, offset };
      }
    }
    next = { mode: "prayer", ...best };
  } else {
    next = mode === "clock" ? { mode, hour: 6, minute: 0 } : { mode, prayer: "fajr", offset: 30 };
  }
  return { timing: next, altTiming: r.timing };
}

/* ------------------------- تحذير التوقيت ------------------------- */

/**
 * تنبيه لطيف حين يقع التذكير في وقت لا يناسب موضوعه. لا يمنع الحفظ — المستخدم
 * قد يقصد ذلك — لكنه لا يمرّ دون أن يُلاحَظ.
 */
export function timingWarning(r: DailyReminder, at: Date, times: PrayerTimes): string | null {
  const t = at.getTime();
  const kind = r.id === "azkar-morning" ? "morning" : r.id === "azkar-evening" ? "evening" : null;
  if (kind === "morning") {
    if (t < times.fajr.getTime()) return "هذا الوقت قبل دخول الفجر، وأذكار الصباح بعده.";
    if (t > times.sunrise.getTime())
      return "هذا الوقت بعد الشروق، والأفضل قراءة أذكار الصباح بين الفجر والشروق.";
  }
  if (kind === "evening") {
    if (t < times.asr.getTime()) return "هذا الوقت قبل العصر، وأذكار المساء تبدأ بعده.";
    if (t > times.maghrib.getTime())
      return "هذا الوقت بعد المغرب، والأفضل قراءة أذكار المساء بين العصر والمغرب.";
  }
  return null;
}

/* ------------------------- تخطّي ما أُنجز ------------------------- */

/** فصول «حصن المسلم» التي يُعدّ إكمالها إنجازاً لتذكير (أرقامها في الكتاب). */
export const HISN_CHAPTERS = { wake: 1, morningEvening: 27, sleep: 28 } as const;

/** ما أُنجز اليوم، من السجل اليومي الموحّد (`activity-log.ts`). */
export type DoneToday = {
  /** جلسات الوِرد المكتملة اليوم. */
  wird: readonly string[];
  /** فصول الأذكار المكتملة اليوم: رقم الفصل ← وقت الإكمال. */
  chapters?: Readonly<Record<string, number>>;
};

/** ما يُعدّ إنجازاً لكل تذكير. */
export type CompletionKey =
  "azkar-morning" | "azkar-evening" | "wird-morning" | "azkar-sleep" | "azkar-wake";

export function completionKeyFor(r: DailyReminder): CompletionKey | null {
  if (r.id === "azkar-morning") return "azkar-morning";
  if (r.id === "azkar-evening") return "azkar-evening";
  if (r.id === "wird") return "wird-morning";
  if (r.id === "sleep-azkar") return "azkar-sleep";
  if (r.id === "wake-azkar") return "azkar-wake";
  return null;
}

/** وصف «تخطّي إذا أُنجز» لكل تذكير — ما الذي يُلغي تذكير اليوم. */
export const COMPLETION_HINTS: Record<CompletionKey, string> = {
  "azkar-morning": "لا يصل تذكير اليوم إن أكملت ورد الصباح أو أذكار الصباح والمساء قبله",
  "azkar-evening": "لا يصل تذكير اليوم إن أكملت ورد المساء أو أذكار الصباح والمساء بعد العصر",
  "wird-morning": "لا يصل تذكير اليوم إن أكملت ورد الصباح قبله",
  "azkar-sleep": "لا يصل تذكير اليوم إن أكملت أذكار النوم قبله",
  "azkar-wake": "لا يصل تذكير اليوم إن أكملت أذكار الاستيقاظ قبله",
};

/**
 * هل أُنجز العمل اليوم؟ باب «أذكار الصباح والمساء» يُسجَّل بمفتاحين «27:m» و«27:e».
 * السجلات القديمة فيها «27» وحده، فيُفرَّق بوقت إكماله: قبل العصر صباحٌ، ومن العصر
 * مساءٌ، وبلا مواقيت يُعدّ صباحاً.
 */
export function isDoneToday(
  r: DailyReminder,
  done: DoneToday,
  times?: Pick<PrayerTimes, "asr">,
): boolean {
  if (!r.skipIfDone) return false;
  const key = completionKeyFor(r);
  const ch = done.chapters ?? {};
  const me = ch[String(HISN_CHAPTERS.morningEvening)];
  const meMorning = ch[`${HISN_CHAPTERS.morningEvening}:m`];
  const meEvening = ch[`${HISN_CHAPTERS.morningEvening}:e`];
  const asr = times?.asr?.getTime();
  switch (key) {
    case "wird-morning":
      return done.wird.includes("morning");
    case "azkar-morning":
      return (
        done.wird.includes("morning") ||
        meMorning !== undefined ||
        (me !== undefined && (asr === undefined || me < asr))
      );
    case "azkar-evening":
      return (
        done.wird.includes("evening") ||
        meEvening !== undefined ||
        (me !== undefined && asr !== undefined && me >= asr)
      );
    case "azkar-sleep":
      return ch[String(HISN_CHAPTERS.sleep)] !== undefined;
    case "azkar-wake":
      return ch[String(HISN_CHAPTERS.wake)] !== undefined;
    default:
      return false;
  }
}

/* ------------------------- خطة الجدولة ------------------------- */

export type PlannedReminder = {
  reminder: DailyReminder;
  /** ترتيب التذكير بين المفعّلة — يدخل في معرّف الإشعار. */
  index: number;
  dayIndex: number;
  at: Date;
};

/**
 * مواعيد تذكيرات الأذكار والوِرد للأيام القادمة. دالّة نقيّة: تُمرَّر لها
 * المواقيت وما أُنجز اليوم، فتُختبر بلا متصفح ولا أندرويد.
 * تذكير اليوم الذي أُنجز عمله قبل موعده لا يُجدول (إن كان `skipIfDone`).
 */
export function planDailyReminders(
  state: DailyRemindersState,
  o: {
    now: number;
    days: number;
    timesFor: (date: Date) => PrayerTimes;
    done?: DoneToday;
  },
): PlannedReminder[] {
  if (!state.enabled) return [];
  const active = state.items.filter((r) => r.enabled);
  const out: PlannedReminder[] = [];
  for (let d = 0; d < o.days; d++) {
    const date = new Date(o.now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + d);
    const times = o.timesFor(date);
    active.forEach((r, index) => {
      const at = reminderTimeOn(r, date, (p) => times[p]);
      if (!at || !Number.isFinite(at.getTime()) || at.getTime() <= o.now) return;
      if (d === 0 && isDoneToday(r, o.done ?? { wird: [] }, times)) return;
      out.push({ reminder: r, index, dayIndex: d, at });
    });
  }
  return out;
}

/* ------------------------- فتح الإشعار ------------------------- */

type ActionEvent = { actionId?: unknown; notification?: { extra?: unknown } };

/**
 * حدث `localNotificationActionPerformed` لتذكير أذكار/وِرد ← ما يجب فعله:
 * فتح صفحته عند النقر، أو «ذكّرني لاحقاً». null لأي تنبيه آخر.
 */
export function reminderActionFromTap(
  e: unknown,
):
  | { type: "open"; route: ReminderRoute; reminder: string }
  | { type: "snooze"; reminder: string }
  | null {
  const ev = (e ?? {}) as ActionEvent;
  const extra = (ev.notification?.extra ?? {}) as {
    kind?: unknown;
    reminder?: unknown;
    route?: unknown;
  };
  if (extra.kind !== "daily-reminder" || typeof extra.reminder !== "string") return null;
  if (ev.actionId === "snooze") return { type: "snooze", reminder: extra.reminder };
  if (ev.actionId !== "tap") return null;
  if (!isReminderRoute(extra.route)) return null;
  return { type: "open", route: extra.route, reminder: extra.reminder };
}

/** مدّة «ذكّرني لاحقاً» بالدقائق. */
export const SNOOZE_MINUTES = 10;

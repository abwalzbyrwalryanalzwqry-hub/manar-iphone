/* منار — «مركز التنبيهات»: نصوص الحالة والتشخيص (المرحلة ٣٠).
 *
 * دوالّ نقيّة تحوّل ما تعيده الطبقة الأصلية (مفتاح الحدث التالي، أهمية
 * القنوات، سجل التنبيهات) إلى جُملٍ عربية، فتُختبر بلا أندرويد.
 */

import { isIOSApp } from "@/lib/ios";
import { PRAYER_LABELS, type PrayerKey } from "@/lib/prayer";
import { minutesAr } from "@/lib/notification-text";
import { countAr, toArabicDigits } from "@/lib/format";
import { activeSeasonNotifyCount } from "@/lib/seasons/engine";

const ROLE_LABELS: Record<string, string> = {
  adhan: "الأذان",
  fajr_first_adhan: "الأذان الأول",
  iqamah: "الإقامة",
  prayer_notice: "دخول الوقت",
  iqamah_reminder: "قبل الإقامة",
  reminder: "قبل الصلاة",
  fajr_reminder: "تذكير الفجر",
  renew: "تجديد المواقيت",
};

/**
 * مفتاح حدث (`asr_iqamah_2026_09_23`، `dhuhr_reminder15m_…`، `daily_2_…`) ←
 * «الإقامة — العصر». `title` بديلٌ لما لا يُعرف.
 */
export function describeAlertKey(key: string | undefined, title?: string): string {
  if (!key) return title ?? "";
  if (key.startsWith("test_")) return "تجربة شاملة";
  if (key.startsWith("daily_") || key.startsWith("snooze_")) return title || "تذكير أذكار";
  const m = /^([a-z]+)_([a-z_]+?)(\d+m)?_\d{4}_\d{2}_\d{2}$/.exec(key);
  if (!m) return title ?? key;
  const prayer = PRAYER_LABELS[m[1] as PrayerKey]?.ar;
  const role = ROLE_LABELS[m[2]];
  if (!prayer || !role) return title ?? key;
  if (m[2] === "renew" || m[2] === "fajr_reminder") return role;
  if (m[3]) return `${role} بـ${minutesAr(Number(m[3].slice(0, -1)))} — ${prayer}`;
  return `${role} — ${prayer}`;
}

/** «١٢:٠٥ م» بتوقيت الجهاز. */
export function clockAr(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return toArabicDigits(`${h12}:${mm}`) + (h < 12 ? " ص" : " م");
}

/** «اليوم»، «غداً»، أو اسم اليوم. */
export function dayWordAr(ms: number, now: number = Date.now()): string {
  const a = new Date(ms);
  const b = new Date(now);
  const diff = Math.round(
    (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
      Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) /
      86_400_000,
  );
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غداً";
  const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  return days[a.getDay()];
}

/** «التالي: الإقامة — العصر، اليوم ٣:٤٢ م». */
export function nextAlertLine(
  s: { nextKey?: string; nextAt?: number; nextTitle?: string } | null,
  now: number = Date.now(),
): string | null {
  if (!s?.nextAt || s.nextAt <= now) return null;
  const what = describeAlertKey(s.nextKey, s.nextTitle);
  return `التالي: ${what}، ${dayWordAr(s.nextAt, now)} ${clockAr(s.nextAt)}`;
}

export type ChannelInfo = { id: string; name: string; importance: number; blocked: boolean };

/** القنوات التي أطفأها المستخدم، بأسمائها كما في إعدادات النظام. */
export function blockedChannels(list: ChannelInfo[] | undefined): string[] {
  return (list ?? []).filter((c) => c.blocked).map((c) => c.name || c.id);
}

export function blockedChannelsMessage(list: ChannelInfo[] | undefined): string | null {
  const names = blockedChannels(list);
  if (!names.length) return null;
  const quoted = names.map((n) => `«${n}»`).join("، ");
  return names.length === 1
    ? `أطفأت قناة ${quoted} من إعدادات النظام — تنبيهاتها لا تظهر.`
    : `أطفأت قنوات ${quoted} من إعدادات النظام — تنبيهاتها لا تظهر.`;
}

export type AlertLogEvent = { at: number; type: string; key: string; detail: string };

/** سطر عربي واحد لكل مدخلة. */
export function describeLogEvent(e: AlertLogEvent): string {
  const what = describeAlertKey(e.key);
  switch (e.type) {
    case "scheduled": {
      const [stored, armed, mode, clock] = e.detail.split("/");
      const clockN = Number(clock) || 0;
      return `ضُبط الجدول: ${toArabicDigits(stored ?? "0")} حدثاً، ${toArabicDigits(armed ?? "0")} في النافذة${
        mode === "inexact" ? " (غير دقيقة)" : ""
      }${clockN > 0 ? `، منها ${toArabicDigits(clockN)} بأولوية المنبّه` : ""}`;
    }
    case "fired": {
      const late = Number(e.detail.split("/")[1] ?? 0);
      return `أُطلق ${what}${lateWord(late)}`;
    }
    case "duplicate":
      return `تكرّر ${what} فتُجوهل`;
    case "silenced":
      return `${what}: ${e.detail}`;
    case "playback_failed":
      return e.detail === "background_start"
        ? `${what}: منع النظام الصوت لغياب إذن المنبّهات الدقيقة، فوصل مكتوباً`
        : `${what}: تعذّر تشغيل الصوت، فوصل مكتوباً`;
    case "notice_dropped":
      return "رُفض إشعار: الإشعارات معطّلة لمنار";
    case "prayed":
      return `«صلّيت» من الإشعار: ${PRAYER_LABELS[e.key as PrayerKey]?.ar ?? e.key}`;
    case "snoozed":
      return `أُجّل تذكير ${minutesAr(Number(e.detail) || 10, "gen")}`;
    case "rearmed":
      return `أُعيد ضبط المنبّهات (${rearmReason(e.detail)})`;
    case "zone_changed":
      return `تغيّرت المنطقة الزمنية إلى ${e.detail}`;
    case "test_scheduled":
      if (e.detail === "clock") return "ضُبطت تجربة شاملة بأولوية المنبّه";
      return e.detail === "exact"
        ? "ضُبطت تجربة شاملة بمنبّه دقيق"
        : "ضُبطت تجربة شاملة بمنبّه غير دقيق — قد تتأخّر";
    default:
      return `${e.type} ${e.key} ${e.detail}`.trim();
  }
}

function lateWord(sec: number): string {
  if (!Number.isFinite(sec) || sec < 60) return " في موعده";
  return ` متأخّراً ${minutesAr(Math.round(sec / 60))}`;
}

function rearmReason(action: string): string {
  if (action.includes("BOOT") || action.includes("QUICKBOOT")) return "إعادة تشغيل الهاتف";
  if (action.includes("PACKAGE_REPLACED")) return "تحديث التطبيق";
  if (action.includes("TIMEZONE")) return "تغيّر المنطقة الزمنية";
  if (action.includes("TIME_SET") || action.includes("TIME_CHANGED")) return "تغيّر الساعة";
  if (action.includes("EXACT_ALARM")) return "تغيّر إذن المنبّهات";
  return action;
}

/** نصّ السجل للنسخ: الأحدث أولاً، بتاريخ ووقت. */
export function formatAlertLog(events: AlertLogEvent[]): string {
  return [...events]
    .sort((a, b) => b.at - a.at)
    .map((e) => {
      const d = new Date(e.at);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
      return `${toArabicDigits(date)} ${clockAr(e.at)} — ${describeLogEvent(e)}`;
    })
    .join("\n");
}

export type TestVerdict =
  | { state: "waiting" }
  | { state: "on-time" }
  | { state: "late"; minutes: number }
  | { state: "written"; why: string }
  | { state: "missed" };

/**
 * نتيجة «تجربة شاملة» من السجل: لم يحن بعد، أو أُطلق في موعده، أو تأخّر،
 * أو صار إشعاراً مكتوباً ولماذا، أو لم يُطلق بعد دقيقتين من موعده.
 */
export function testVerdict(
  events: AlertLogEvent[],
  test: { key: string; at: number },
  now: number = Date.now(),
): TestVerdict {
  const mine = events.filter((e) => e.key === test.key);
  const failed = mine.find((e) => e.type === "playback_failed" || e.type === "silenced");
  if (failed) {
    return {
      state: "written",
      why:
        failed.type === "silenced"
          ? failed.detail
          : failed.detail === "background_start"
            ? "منع النظام الصوت لغياب إذن المنبّهات الدقيقة"
            : "تعذّر تشغيل الصوت",
    };
  }
  const fired = mine.find((e) => e.type === "fired");
  if (fired) {
    const late = Number(fired.detail.split("/")[1] ?? 0);
    return late >= 60 ? { state: "late", minutes: Math.round(late / 60) } : { state: "on-time" };
  }
  return now > test.at + 120_000 ? { state: "missed" } : { state: "waiting" };
}

export function testVerdictText(v: TestVerdict): string {
  switch (v.state) {
    case "waiting":
      return "بانتظار الموعد — أغلق التطبيق وأطفئ الشاشة.";
    case "on-time":
      return "أُطلق في موعده. هكذا يصل الأذان والتطبيق مغلق.";
    case "late":
      return `أُطلق متأخّراً ${minutesAr(v.minutes)}. امنح إذن «المنبّهات والتذكيرات» واستثنِ منار من توفير البطارية.`;
    case "written":
      return `وصل إشعاراً مكتوباً: ${v.why}.`;
    case "missed":
      if (isIOSApp()) {
        return "لم يصل بعد دقيقتين من موعده. تحقّق من الإعدادات ← منار ← الإشعارات: «السماح بالإشعارات» و«الأصوات» مفعّلان، وأن «التركيز» لا يحجب منار.";
      }
      return "لم يُطلق بعد دقيقتين من موعده. الغالب أن النظام قتل منار: استثنِها من توفير البطارية.";
  }
}

export type OtherAlertRow = {
  id: "reminders" | "seasons" | "jumuah" | "sakinah";
  label: string;
  route: "/reminders" | "/seasons" | "/jumuah" | "/sakinah";
  on: boolean;
  detail: string;
};

/** «تنبيهات أخرى»: الأذكار والوِرد، والمواسم، والجمعة، وسكينة — بحالتها وملخّصها. */
export function otherAlertRows(o: {
  daily: { enabled: boolean; items: { enabled: boolean }[] };
  seasons: { enabled: boolean; seasons: Record<string, boolean> };
  jumuah: { remindEarly: boolean; remindKahf: boolean; remindHour: boolean };
  sakinah: { enabled: boolean };
}): OtherAlertRow[] {
  const dailyCount = o.daily.enabled ? o.daily.items.filter((i) => i.enabled).length : 0;
  /* المواسم المفعّلة افتراضياً (رمضان، ذو الحجة…) تُعدّ أيضاً، لا المحفوظة صراحةً فقط. */
  const seasonCount = activeSeasonNotifyCount(o.seasons);
  const j = [
    o.jumuah.remindEarly && "التبكير",
    o.jumuah.remindKahf && "الكهف",
    o.jumuah.remindHour && "ساعة الإجابة",
  ].filter(Boolean) as string[];
  return [
    {
      id: "reminders",
      label: "الأذكار والوِرد",
      route: "/reminders",
      on: dailyCount > 0,
      detail: dailyCount > 0 ? countAr(dailyCount, "تذكير", "تذكيران", "تذكيرات") : "متوقّفة",
    },
    {
      id: "seasons",
      label: "المواسم",
      route: "/seasons",
      on: seasonCount > 0,
      detail: seasonCount > 0 ? countAr(seasonCount, "موسم", "موسمان", "مواسم") : "متوقّفة",
    },
    {
      id: "jumuah",
      label: "الجمعة",
      route: "/jumuah",
      on: j.length > 0,
      detail: j.length ? j.join(" · ") : "متوقّفة",
    },
    {
      id: "sakinah",
      label: "سكينة",
      route: "/sakinah",
      on: o.sakinah.enabled,
      detail: o.sakinah.enabled ? "كتم الجوال وقت الصلاة" : "متوقّفة",
    },
  ];
}

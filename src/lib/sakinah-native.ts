/* منار — جسر «سكينة» إلى الطبقة الأصلية.
 *
 * الويب يحسب الفترات من المواقيت (`sakinah.ts`) ثم يُسلّمها، والأندرويد يملك
 * التنفيذ: منبّهات دقيقة تمرّ من Doze، ووضع عدم الإزعاج الرسمي، واستعادة ما
 * كان عليه الهاتف. لا مؤقّت في الواجهة يقوم بالجدولة، ولا `while` ينتظر وقت
 * الصلاة، ولا `window.Capacitor.Plugins` — الوصول من `registerPlugin` فقط عبر
 * `native-notifications.ts`.
 */

import { isIOSApp } from "@/lib/ios";
import {
  isNativeShell,
  manarAdhanPlugin,
  type SakinahLogEvent,
  type SakinahNativeStatus,
  type SakinahNativeWindow,
} from "@/lib/native-notifications";
import {
  computeSakinahWindows,
  filterMode,
  readSakinah,
  type SakinahSettings,
} from "@/lib/sakinah";
import type { LocationState, Settings } from "@/lib/prayer";

export type { SakinahLogEvent, SakinahNativeStatus };

/** يبني الفترات ويُسلّمها. يُنادى عند كل تغيير إعداد أو مواقيت أو استئناف. */
export async function syncSakinahSchedule(
  location: LocationState,
  calc: Settings,
  settings: SakinahSettings = readSakinah(),
): Promise<{ armed: number; dndAccess: boolean } | null> {
  const plugin = manarAdhanPlugin();
  if (!plugin) return null;

  const filter = filterMode(settings);
  const windows: SakinahNativeWindow[] = computeSakinahWindows(settings, location, calc).map(
    (w) => ({
      id: w.id,
      start: w.start,
      end: w.end,
      prayer: w.prayer,
      label: w.label,
      filter,
      muteAdhan: settings.muteAdhanDuringSakinah,
    }),
  );

  try {
    const res = await plugin.sakinahSchedule({ enabled: settings.enabled, windows });
    return { armed: res.armed ?? 0, dndAccess: Boolean(res.dndAccess) };
  } catch {
    return null;
  }
}

export async function readSakinahStatus(): Promise<SakinahNativeStatus | null> {
  const plugin = manarAdhanPlugin();
  if (!plugin) return null;
  try {
    return await plugin.sakinahStatus();
  } catch {
    return null;
  }
}

/** «إيقاف الآن» — ينهي الفترة الجارية وحدها ولا يُعطّل سكينة. */
export async function stopSakinahNow(): Promise<void> {
  const plugin = manarAdhanPlugin();
  if (!plugin) return;
  try {
    await plugin.sakinahStopNow();
  } catch {
    /* ignore */
  }
}

/** «تخطي هذه الفترة». */
export async function skipSakinahWindow(id: number): Promise<void> {
  const plugin = manarAdhanPlugin();
  if (!plugin) return;
  try {
    await plugin.sakinahSkip({ id });
  } catch {
    /* ignore */
  }
}

export async function clearSakinahSkips(): Promise<void> {
  const plugin = manarAdhanPlugin();
  if (!plugin) return;
  try {
    await plugin.sakinahClearSkips();
  } catch {
    /* ignore */
  }
}

export async function requestSakinahPolicyAccess(): Promise<boolean> {
  const plugin = manarAdhanPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.sakinahRequestPolicyAccess();
    return Boolean(res.granted);
  } catch {
    return false;
  }
}

/**
 * يفتح شاشة النظام «الوصول إلى عدم الإزعاج» دائماً، ممنوحاً كان الإذن أو لا،
 * ليمنحه المستخدم أو يسحبه بنفسه. يعيد حالة الإذن لحظة الفتح.
 */
export async function openSakinahPolicyAccessSettings(): Promise<boolean> {
  const plugin = manarAdhanPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.sakinahOpenPolicyAccessSettings();
    return Boolean(res.opened);
  } catch {
    return false;
  }
}

export async function readSakinahLog(): Promise<SakinahLogEvent[]> {
  const plugin = manarAdhanPlugin();
  if (!plugin) return [];
  try {
    const res = await plugin.sakinahLog();
    return Array.isArray(res.events) ? res.events : [];
  } catch {
    return [];
  }
}

/* --------------------------- اختبار سكينة --------------------------- */

export type SakinahCheck = {
  key: string;
  title: string;
  ok: boolean;
  /** يمنع الميزة من العمل أصلاً، لا مجرّد نقصٍ في الجودة. */
  blocking: boolean;
  detail: string;
  /** ما يفعله المستخدم لإصلاحها، إن كان ثمّ إصلاح. */
  fix?: "dnd" | "exact" | "battery" | "notifications";
};

export type SakinahDiagnostics = {
  level: "ready" | "needs-setup" | "blocked";
  title: string;
  summary: string;
  checks: SakinahCheck[];
};

/**
 * تشخيصٌ صادق: لا نقول «جاهزة» إلا إذا كان كل ما تحتاجه الميزة فعلاً متوفّراً،
 * ولا نُخفي نقصاً لأن الواجهة تبدو جميلة بدونه.
 */
export async function runSakinahSelfTest(
  settings: SakinahSettings = readSakinah(),
): Promise<SakinahDiagnostics> {
  if (!isNativeShell()) {
    return {
      level: "blocked",
      title: "🔴 لا يمكن تشغيلها",
      summary: "سكينة تحتاج إلى تطبيق منار على الهاتف، فالمتصفح لا يملك إسكات الجهاز.",
      checks: [
        {
          key: "platform",
          title: "التشغيل على الهاتف",
          ok: false,
          blocking: true,
          detail: "افتح منار من التطبيق المثبَّت على هاتفك لتفعيل سكينة.",
        },
      ],
    };
  }

  const status = await readSakinahStatus();
  if (!status) {
    return {
      level: "blocked",
      title: "🔴 لا يمكن تشغيلها",
      summary: "لم يتمكن منار من قراءة حالة النظام على هذا الجهاز.",
      checks: [
        {
          key: "bridge",
          title: "الاتصال بنظام الهاتف",
          ok: false,
          blocking: true,
          detail: "أعد تشغيل التطبيق، وإن استمرّ الأمر فأعد تشغيل الهاتف.",
        },
      ],
    };
  }

  const ios = isIOSApp();
  const checks: SakinahCheck[] = [
    ios
      ? {
          key: "dnd",
          title: "الإسكات على iPhone",
          ok: true,
          blocking: false,
          detail:
            "iOS لا يسمح لأي تطبيق بتشغيل «عدم الإزعاج»؛ تذكّرك سكينة بتفعيل «التركيز» عند كل فترة وتكتم أصوات منار.",
        }
      : {
          key: "dnd",
          title: "التحكم في وضع عدم الإزعاج",
          ok: status.dndAccess,
          blocking: true,
          detail: status.dndAccess
            ? "منار يستطيع إسكات الهاتف أثناء الصلاة ثم إعادته كما كان."
            : "بدون هذا الإذن لا يستطيع أي تطبيق إسكات الهاتف. امنح منار «الوصول إلى عدم الإزعاج».",
          fix: status.dndAccess ? undefined : "dnd",
        },
    {
      key: "exact",
      title: "التنبيهات في وقتها بالضبط",
      ok: status.exactAlarms,
      blocking: false,
      detail: status.exactAlarms
        ? "تبدأ الفترة وتنتهي في وقتها تماماً."
        : "قد تتأخر بداية الهدوء دقائق. اسمح لمنار بـ«التنبيهات والتذكيرات».",
      fix: status.exactAlarms ? undefined : "exact",
    },
    {
      key: "battery",
      title: "عدم تقييد البطارية",
      ok: status.batteryUnrestricted,
      blocking: false,
      detail: status.batteryUnrestricted
        ? "لن يوقف توفير البطارية سكينة."
        : "قد يؤخّر توفير البطارية بداية الهدوء أو نهايته. استثنِ منار من تقييد البطارية.",
      fix: status.batteryUnrestricted ? undefined : "battery",
    },
    {
      key: "notifications",
      title: "إشعارات منار",
      ok: status.notificationsAllowed,
      blocking: false,
      detail: status.notificationsAllowed
        ? "سترى «الهدوء فعال» وزرّ «إيقاف الآن» أثناء الفترة."
        : "لن يظهر شعار الهدوء ولا زرّ الإيقاف السريع. اسمح بإشعارات منار.",
      fix: status.notificationsAllowed ? undefined : "notifications",
    },
    {
      key: "armed",
      title: "الفترات القادمة مجدولة",
      ok: !settings.enabled || status.pending > 0,
      blocking: false,
      detail:
        !settings.enabled || status.pending > 0
          ? "الفترات القادمة محسوبة من مواقيت الصلاة في هاتفك."
          : "لا توجد فترات مجدولة — تأكّد من تفعيل صلاة واحدة على الأقل ومن تحديد الموقع.",
    },
  ];

  const blocked = checks.some((c) => c.blocking && !c.ok);
  const warnings = checks.some((c) => !c.ok);

  if (blocked) {
    return {
      level: "needs-setup",
      title: "🟡 تحتاج إلى إعداد",
      summary: "خطوة واحدة باقية: امنح منار التحكم في وضع عدم الإزعاج، ثم أعد الاختبار.",
      checks,
    };
  }
  if (warnings) {
    return {
      level: "needs-setup",
      title: "🟡 تحتاج إلى إعداد",
      summary: "سكينة ستعمل، لكن هناك إعدادات قد تؤخّرها على هذا الجهاز.",
      checks,
    };
  }
  return {
    level: "ready",
    title: "🟢 جاهزة",
    summary: "سكينة جاهزة وتعمل حتى لو كان التطبيق مغلقاً والشاشة مقفلة.",
    checks,
  };
}

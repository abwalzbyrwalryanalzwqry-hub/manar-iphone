/* Manar — Native (Android) scheduled prayer notifications
 * ---------------------------------------------------------------
 * Bridges the EXISTING local prayer schedule + adhan settings to the native
 * layer, WITHOUT touching the web in-app engine (`adhan-provider.tsx` /
 * `audio-engine.ts`).
 *
 * Two native surfaces are used, each for what it is actually good at:
 *
 *   • `ManarAdhan` (custom plugin, android/app/src/main/java/app/manar/islamic)
 *     — Adhan and Iqama. Exact alarms (`setExactAndAllowWhileIdle`) fire a
 *       foreground service that plays the FULL recording with audio focus and
 *       lock-screen controls. A plain notification sound gets truncated by
 *       Android after a few seconds, which is useless for a 3-4 minute Adhan.
 *   • `LocalNotifications` — pre-prayer reminders, which are ordinary short
 *     notifications and need nothing special.
 *
 * Both are reached through the SUPPORTED JS plugin API — the `registerPlugin()`
 * proxies (`@capacitor/local-notifications` for the wrapper, `registerPlugin()`
 * for our own `ManarAdhan`). The raw runtime bridge `window.Capacitor.Plugins`
 * must NOT be used: on Android its generated `addListener` returns a plain
 * synchronous `{ remove }` object instead of `Promise<PluginListenerHandle>`,
 * which is what produced the start-up crash
 * `TypeError: r.addListener(...).then is not a function` (see `native-shell.ts`).
 * Every call below is still gated on `Capacitor.isNativePlatform()`, so the web
 * build behaves exactly as before: a no-op in a browser.
 *
 * Everything is computed offline: prayer times come from `computePrayerTimes`,
 * never from the network.
 */

import { applyPrayed } from "@/lib/prayed-queue";
import type { AlertLogEvent, ChannelInfo } from "@/lib/alert-center";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { foldLocalNotification, iosNotificationSound, isIOSApp } from "@/lib/ios";
import { LocalNotifications } from "@capacitor/local-notifications";
import { computePrayerTimes, type LocationState, type Settings } from "@/lib/prayer";
import {
  effectiveVolume,
  getAdhanSettings,
  notificationLevel,
  type NotificationLevel,
} from "@/lib/adhan-settings";
import {
  buildPrayerAlarms,
  rawResourceName as rawName,
  SCHEDULE_DAYS_AHEAD,
  ADHAN_DAYS_AHEAD,
  LN_CAP,
  DAILY_EVENT_MAX,
  dailyEventId,
  dateKey,
  renewPlan,
  type ManarAlarmEvent,
} from "@/lib/prayer-schedule";
import {
  REMINDER_TONES,
  SNOOZE_MINUTES,
  planDailyReminders,
  readReminders,
  reminderActionFromTap,
  toneUrl,
  type DailyReminder,
  type ReminderRoute,
} from "@/lib/daily-reminders";
import { dayKey, readLog } from "@/lib/activity-log";
import { jumuahTimeline, planJumuahReminders, readJumuah } from "@/lib/jumuah";
import { getIqamahSound } from "@/lib/iqamah-library";
import { resolveAdhanForPrayer, resolveIqamaForPrayer } from "@/lib/adhan-settings";
import { adhanVariantUrl } from "@/lib/adhan-sound";
import { prayerLabelOn } from "@/lib/prayer-schedule";
import { readSakinah } from "@/lib/sakinah";
import type { PrayerKey } from "@/lib/prayer";
import { PRAYER_APPROACH_CLIPS, approachClipFor } from "@/lib/prayer-approach-audio";
import { getHijriAdjust } from "@/lib/hijri";
import { seasonNotificationsBetween } from "@/lib/seasons/engine";
import { readSeasonNotifyPrefs } from "@/lib/seasons/store";
import {
  DEFAULT_SEASON_SOUND,
  SEASON_SOUNDS,
  seasonSoundFor,
  seasonSoundUrl,
  type SeasonSound,
  type SeasonSoundId,
} from "@/lib/seasons/sounds";
import { seasonIdFromNotificationTap } from "@/lib/seasons/notification-route";
import {
  normalizeDisplayPermission,
  type AlertPermissions,
  type NotificationPermissionState,
} from "@/lib/alert-permissions";
import { staleIds } from "@/lib/schedule-diff";
import { minutesAr } from "@/lib/notification-text";

export type IOSNativeInfo = {
  platform: "ios";
  system?: string;
  model?: string;
  authorization?: number;
  sounds?: boolean;
  lockScreen?: boolean;
  timeSensitive?: boolean;
  backgroundRefresh?: boolean;
  appGroup?: boolean;
};

type LocalNotificationsPlugin = {
  requestPermissions: () => Promise<{ display: string }>;
  checkPermissions: () => Promise<{ display: string }>;
  registerActionTypes: (o: unknown) => Promise<void>;
  getPending: () => Promise<{ notifications: { id: number }[] }>;
  cancel: (o: { notifications: { id: number }[] }) => Promise<void>;
  schedule: (o: { notifications: unknown[] }) => Promise<void>;
  createChannel: (c: {
    id: string;
    name: string;
    description?: string;
    importance?: number;
    visibility?: number;
    sound?: string;
    vibration?: boolean;
  }) => Promise<void>;
  deleteChannel?: (c: { id: string }) => Promise<void>;
  listChannels?: () => Promise<{ channels: { id: string }[] }>;
  addListener: (event: string, cb: (e: unknown) => void) => Promise<unknown>;
};

/** حدث واحد كما يُسلَّم لـ`AdhanScheduler` — انظر `prayer-schedule.ts`. */
export type ManarAdhanEvent = ManarAlarmEvent;

export type NativeAdhanStatus = {
  exactAlarms: boolean;
  batteryUnrestricted: boolean;
  pending: number;
  sdk: number;
  /** عدد المُجدوَل لكل نوع (نسخ أصلية أقدم لا تُرجعها). */
  pendingAdhan?: number;
  pendingIqama?: number;
  pendingNotice?: number;
  notificationsAllowed?: boolean;
  /** آخر إعادة جدولة (ميلي ثانية). */
  lastScheduledAt?: number;
  nextKey?: string;
  nextAt?: number;
  nextTitle?: string;
  nextKind?: string;
  /** آخر مرة تعذّر فيها تشغيل صوت الأذان أو الإقامة (ميلي ثانية)، وسببها. */
  playbackFailedAt?: number;
  playbackFailedReason?: string;
};

/** نتيجة آخر مزامنة للجدول — تعرضها الواجهة في بطاقة الحالة. */
export type ScheduleSyncResult = {
  at: number;
  alarms: number;
  reminders: number;
  exactAlarms: boolean;
};

let lastSync: ScheduleSyncResult | null = null;
export function lastScheduleSync(): ScheduleSyncResult | null {
  return lastSync;
}

/** فترة هدوء واحدة كما تُسلّم إلى الطبقة الأصلية — أوقات مطلقة محسوبة من المواقيت. */
export type SakinahNativeWindow = {
  id: number;
  start: number;
  end: number;
  prayer: string;
  label: string;
  filter: "manar" | "priority" | "alarms" | "none";
  muteAdhan: boolean;
};

export type SakinahNativeStatus = {
  enabled: boolean;
  dndAccess: boolean;
  exactAlarms: boolean;
  batteryUnrestricted: boolean;
  notificationsAllowed: boolean;
  pending: number;
  currentFilter: number;
  sdk: number;
  active?: SakinahNativeWindow;
  next?: SakinahNativeWindow;
};

/** حالات مدير الصوت في منار — واحدة لا غيرها في أي لحظة. */
export type ManarAudioState = "IDLE" | "PLAYING_AZAN" | "PLAYING_IQAMA" | "MUTED" | "STOPPED";

export type ManarAudioSnapshot = {
  state: ManarAudioState;
  kind: string;
  title: string;
};

type ManarAdhanPlugin = {
  schedule: (o: {
    events: ManarAdhanEvent[];
  }) => Promise<{ scheduled: number; exactAlarms: boolean }>;
  cancelAll: () => Promise<void>;
  stop: () => Promise<void>;
  preview: (o: {
    sound: string;
    title?: string;
    body?: string;
    volume?: number;
    usage?: "alarm" | "notification";
  }) => Promise<void>;
  /** مستويات الأذان والإقامة للخدمة الأصلية (0..1) — تُقرأ وقت التشغيل. */
  setVolumes: (o: {
    master: number;
    adhan: number;
    iqama: number;
    reminder: number;
    /** رفع صوت المنبّه في الجوال مؤقتاً وقت الأذان والإقامة. */
    raiseAlarm?: boolean;
    /** إعداد «الاهتزاز»: اهتزاز الأذان والإقامة وقنوات تنبيههما المكتوب. */
    vibrate?: boolean;
  }) => Promise<void>;
  /** صوت «المنبّه» في الجوال — الأذان نسبةٌ منه. */
  alarmVolume: () => Promise<{ level: number; max: number; percent: number }>;
  setAlarmVolume: (o: { fraction: number }) => Promise<{ ok: boolean; percent: number }>;
  widgetStatus: () => Promise<{ placed: number; pinSupported: boolean }>;
  pinWidget: () => Promise<{ requested: boolean }>;
  openExternal: (o: { urls: string[] }) => Promise<{ opened: boolean; url?: string }>;
  status: () => Promise<NativeAdhanStatus>;
  /** لقطة ويدجت الشاشة الرئيسية (JSON من `buildWidgetSnapshot`). */
  updateWidget: (o: { snapshot: string }) => Promise<{ widgets: number }>;
  requestExactAlarmPermission: () => Promise<{ granted: boolean; opened?: boolean }>;
  requestIgnoreBatteryOptimizations: () => Promise<{ granted: boolean; opened?: boolean }>;
  openNotificationSettings: () => Promise<void>;
  /** إعدادات التاريخ والوقت (المرحلة ٣٣). اختياري: نسخٌ أقدم بلا الدالة. */
  openDateSettings?: () => Promise<{ opened: boolean }>;
  /* مركز التنبيهات (المرحلة ٣٠) */
  alertLog?: () => Promise<{ events: AlertLogEvent[] }>;
  clearAlertLog?: () => Promise<void>;
  channelStatus?: () => Promise<{ notificationsAllowed: boolean; channels: ChannelInfo[] }>;
  testAlarm?: (o: {
    sound: string;
    title?: string;
    body?: string;
    seconds?: number;
    /** بأولوية المنبّه كما في الإعداد (المرحلة ٣٢). */
    priority?: boolean;
  }) => Promise<{
    scheduled: boolean;
    key?: string;
    at?: number;
    exact?: boolean;
    mode?: "clock" | "exact" | "inexact";
  }>;
  /** طابور «صلّيت» من الإشعارات (المرحلة ٢٩) — يُعاد ويُفرَّغ. */
  takePrayed?: () => Promise<{ items: unknown }>;
  /* صوت منار */
  muteAudio: () => Promise<void>;
  audioState: () => Promise<ManarAudioSnapshot>;
  /* سكينة */
  sakinahSchedule: (o: {
    enabled: boolean;
    windows: SakinahNativeWindow[];
  }) => Promise<{ armed: number; dndAccess: boolean; exactAlarms?: boolean }>;
  sakinahCancelAll: () => Promise<void>;
  sakinahStopNow: () => Promise<void>;
  sakinahSkip: (o: { id: number }) => Promise<void>;
  sakinahStatus: () => Promise<SakinahNativeStatus>;
  sakinahLog: () => Promise<{ events: SakinahLogEvent[] }>;
  sakinahClearSkips: () => Promise<void>;
  sakinahRequestPolicyAccess: () => Promise<{ granted: boolean; opened?: boolean }>;
  sakinahOpenPolicyAccessSettings: () => Promise<{ granted: boolean; opened: boolean }>;
  /** iOS: لون ما خارج المنطقة الآمنة (خلف شريط الحالة ومؤشّر الرئيسية). */
  setSystemBars?: (o: { color: string }) => Promise<void>;
  /** iOS: يعيد دمج فئات أزرار منار بعد أن تستبدلها LocalNotifications. */
  iosEnsureCategories?: () => Promise<void>;
  /** iOS: حالة النظام لمنار (للتشخيص والإرشاد). */
  iosInfo?: () => Promise<IOSNativeInfo>;
  addListener: (
    event: string,
    cb: (e: unknown) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
};

/** مدخلة سجل كما تخرج من الطبقة الأصلية (أنواع تقنية تُترجَم للمستخدم). */
export type SakinahLogEvent = {
  at: number;
  type: string;
  prayer: string;
  detail: string;
};

const DAYS_AHEAD = SCHEDULE_DAYS_AHEAD;
const ID_BASE = 41000;

/** Our own native plugin, reached through the supported `registerPlugin` proxy. */
const ManarAdhan = registerPlugin<ManarAdhanPlugin>("ManarAdhan");

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function plugin(): LocalNotificationsPlugin | null {
  if (!isNative()) return null;
  const ln = LocalNotifications as unknown as LocalNotificationsPlugin;
  return isIOSApp() ? iosLocalNotifications(ln) : ln;
}

/**
 * iOS: لا قنوات، والصوت اسم ملف CAF في الإشعار نفسه. ونعيد دمج فئات أزرار
 * منار بعد `registerActionTypes` (الإضافة تستبدل الفئات كلها في iOS).
 */
let iosLnWrapper: LocalNotificationsPlugin | null = null;
function iosLocalNotifications(ln: LocalNotificationsPlugin): LocalNotificationsPlugin {
  if (iosLnWrapper) return iosLnWrapper;
  /* كائن صريح لا `Object.create`: الإضافة وكيل Proxy من Capacitor. */
  const wrapped: LocalNotificationsPlugin = {
    requestPermissions: () => ln.requestPermissions(),
    checkPermissions: () => ln.checkPermissions(),
    registerActionTypes: (o) => ln.registerActionTypes(o),
    getPending: () => ln.getPending(),
    cancel: (o) => ln.cancel(o),
    schedule: (o) => ln.schedule(o),
    createChannel: async () => {},
    deleteChannel: async () => {},
    listChannels: async () => ({ channels: [] }),
    addListener: (event, cb) => ln.addListener(event, cb),
  };
  wrapped.schedule = (o: { notifications: unknown[] }) =>
    ln.schedule({
      notifications: o.notifications.map((n) => {
        const item = { ...(n as Record<string, unknown>) };
        item.sound = iosNotificationSound(
          typeof item.channelId === "string" ? item.channelId : undefined,
          typeof item.sound === "string" ? item.sound : undefined,
        );
        delete item.channelId;
        delete item.smallIcon;
        return item;
      }),
    });
  wrapped.registerActionTypes = async (types: unknown) => {
    await ln.registerActionTypes(types);
    try {
      await ManarAdhan.iosEnsureCategories?.();
    } catch {
      /* نسخة أصلية أقدم */
    }
  };
  iosLnWrapper = wrapped;
  return wrapped;
}

function adhanPlugin(): ManarAdhanPlugin | null {
  if (!isNative()) return null;
  return ManarAdhan;
}

export function isNativeShell(): boolean {
  return isNative();
}

/** منفذ واحد للإضافة الأصلية — لا تُستخدم `window.Capacitor.Plugins` أبداً. */
export function manarAdhanPlugin(): ManarAdhanPlugin | null {
  return adhanPlugin();
}

/**
 * يسلّم لقطة ويدجت الشاشة الرئيسية للطبقة الأصلية. نسخة قديمة من التطبيق الأصلي
 * بلا هذه الدالة تُرفض بصمت — الويدجت ميزة إضافية لا تُعطّل شيئاً.
 */
/** صوت المنبّه في الجوال بالنسبة المئوية، أو `null` خارج أندرويد/نسخة أقدم. */
export async function getPhoneAlarmVolume(): Promise<number | null> {
  const p = adhanPlugin();
  if (!p) return null;
  try {
    const r = await p.alarmVolume();
    return r.max > 0 ? r.percent : null;
  } catch {
    return null;
  }
}

/** يرفع صوت المنبّه في الجوال إلى النسبة المطلوبة. يعيد النسبة الجديدة أو `null`. */
export async function setPhoneAlarmVolume(fraction: number): Promise<number | null> {
  const p = adhanPlugin();
  if (!p) return null;
  try {
    const r = await p.setAlarmVolume({ fraction });
    return r.ok ? r.percent : null;
  } catch {
    return null;
  }
}

export type HomeWidgetStatus = { placed: number; pinSupported: boolean };

/** حالة ويدجت الشاشة الرئيسية، أو `null` خارج أندرويد. */
export async function getHomeWidgetStatus(): Promise<HomeWidgetStatus | null> {
  const p = adhanPlugin();
  if (!p) return null;
  try {
    return await p.widgetStatus();
  } catch {
    return null;
  }
}

/** يطلب من المُشغّل إضافة الويدجت مباشرة. `false` إن لم يدعم ذلك. */
export async function requestPinHomeWidget(): Promise<boolean> {
  const p = adhanPlugin();
  if (!p) return false;
  try {
    return (await p.pinWidget()).requested;
  } catch {
    return false;
  }
}

/** يفتح أول رابط يوجد له تطبيق على الجوال. `null` خارج أندرويد. */
export async function openExternalNative(urls: string[]): Promise<boolean | null> {
  const p = adhanPlugin();
  if (!p) return null;
  try {
    return (await p.openExternal({ urls })).opened;
  } catch {
    return null;
  }
}

export async function updateHomeWidget(snapshot: string): Promise<void> {
  const p = adhanPlugin();
  if (!p) return;
  try {
    await p.updateWidget({ snapshot });
  } catch {
    /* ignore */
  }
}

/** يكتم صوت منار الجاري فوراً مع إبقاء تنبيه الصلاة والأذان القادم. */
export async function muteNativeAudio(): Promise<void> {
  const p = adhanPlugin();
  if (!p) return;
  try {
    await p.muteAudio();
  } catch {
    /* ignore */
  }
}

export async function nativeAudioState(): Promise<ManarAudioSnapshot | null> {
  const p = adhanPlugin();
  if (!p) return null;
  try {
    return await p.audioState();
  } catch {
    return null;
  }
}

/** يستمع لتغيّر حالة الصوت بدل استطلاعها كل ثانية. */
export async function attachAudioStateListener(
  onState: (s: ManarAudioSnapshot) => void,
): Promise<() => void> {
  const p = adhanPlugin();
  if (!p) return () => {};
  try {
    const handle = await p.addListener("manarAudioState", (e) => {
      const snapshot = e as ManarAudioSnapshot;
      if (snapshot && typeof snapshot.state === "string") onState(snapshot);
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}

/* مدى معرّفات تذكيرات الأذكار والوِرد — منفصل تماماً عن مدى تنبيهات الصلاة
 * أعلاه، فلا يُلغي أحدهما جدولة الآخر عند إعادة المزامنة. */
const DAILY_ID_BASE = ID_BASE + 100000;
/* «ذكّرني لاحقاً» والتنبيه التجريبي: خارج مدى الإلغاء في كل مزامنة، وإلا
 * ألغت المزامنةُ (التي تجري فور عودة التطبيق) التذكيرَ المؤجَّل نفسه. */
const SNOOZE_ID_BASE = DAILY_ID_BASE + 100000;
const TEST_ID = SNOOZE_ID_BASE + 99;

/* تنبيهات «مواسم منار» داخل مدى التذكيرات نفسه (فتُلغى وتُعاد جدولتها معه)،
 * لكن بإزاحة لا تتقاطع مع معرّفات الأذكار والوِرد (dayIndex * 100 + ri). */
const SEASON_ID_BASE = DAILY_ID_BASE + 50000;
/* تنبيهات الجمعة في المدى نفسه أيضاً، بعد المواسم: dayIndex * 10 + slot. */
const JUMUAH_ID_BASE = DAILY_ID_BASE + 60000;

function seasonIdFor(dayIndex: number, slot: "morning" | "evening") {
  return SEASON_ID_BASE + dayIndex * 10 + (slot === "morning" ? 0 : 1);
}

/** اسم مورد أندرويد لصوت مضمَّن — التحويل نفسه في `sync-android-raw-audio.mjs`. */
export const rawResourceName = rawName;

/**
 * يطلب إذن الإشعارات — لا يُستدعى إلا من فعلٍ صريح للمستخدم (زرّ، تجربة، شريحة
 * التعريف). المزامنة لا تطلبه أبداً: كانت تطلبه مع كل فتح بلا سياق.
 */
export async function ensureNativePermission(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    const current = await p.checkPermissions();
    if (current.display === "granted") return true;
    const asked = await p.requestPermissions();
    return asked.display === "granted";
  } catch {
    return false;
  }
}

/** حالة إذن الإشعارات دون طلبه. */
export async function notificationPermission(): Promise<NotificationPermissionState> {
  const p = plugin();
  if (!p) return "unsupported";
  try {
    return normalizeDisplayPermission((await p.checkPermissions()).display);
  } catch {
    return "unsupported";
  }
}

/**
 * «السماح بالإشعارات»: يطلب الإذن إن كان النظام ما زال يعرض الحوار، وإلا
 * (رُفض من قبل أو حظره النظام) يفتح إعدادات إشعارات منار مباشرة.
 */
export async function requestNotificationAccess(): Promise<NotificationPermissionState> {
  const before = await notificationPermission();
  if (before === "granted" || before === "unsupported") return before;
  if (before === "prompt") {
    const p = plugin();
    try {
      const r = normalizeDisplayPermission((await p!.requestPermissions()).display);
      if (r === "granted") return r;
    } catch {
      /* نفتح الإعدادات أدناه */
    }
  }
  await openNativeNotificationSettings();
  return notificationPermission();
}

/** الأذونات الثلاثة معاً (داخل أندرويد فقط). */
export async function readAlertPermissions(): Promise<AlertPermissions | null> {
  if (!isNativeShell()) return null;
  const [notifications, status] = await Promise.all([
    notificationPermission(),
    nativeAdhanStatus(),
  ]);
  if (!status) return null;
  return {
    notifications:
      status.notificationsAllowed === false && notifications === "granted"
        ? "denied"
        : notifications,
    exactAlarms: status.exactAlarms,
    batteryUnrestricted: status.batteryUnrestricted,
    sdk: status.sdk,
  };
}

/** Exact-alarm + battery state, so the UI can nudge the user when needed. */
export async function nativeAdhanStatus(): Promise<NativeAdhanStatus | null> {
  const p = adhanPlugin();
  if (!p) return null;
  try {
    return await p.status();
  } catch {
    return null;
  }
}

/**
 * Opens the Android 12+ "Alarms & reminders" screen. Without this permission the
 * OS downgrades our alarms to inexact ones and the Adhan drifts by minutes.
 */
export async function requestExactAlarms(): Promise<boolean> {
  const p = adhanPlugin();
  if (!p) return false;
  try {
    const r = await p.requestExactAlarmPermission();
    return r.granted;
  } catch {
    return false;
  }
}

/**
 * Opens the system battery screen where the user sets Manar to «Unrestricted».
 * On Doze-aggressive OEM builds this is the difference between the Adhan firing
 * on time and not firing at all. (No direct exemption prompt: its permission is
 * restricted on Google Play.)
 */
export async function requestBatteryExemption(): Promise<boolean> {
  const p = adhanPlugin();
  if (!p) return false;
  try {
    const r = await p.requestIgnoreBatteryOptimizations();
    return r.granted;
  } catch {
    return false;
  }
}

export async function openNativeNotificationSettings(): Promise<void> {
  const p = adhanPlugin();
  if (!p) return;
  try {
    await p.openNotificationSettings();
  } catch {
    /* ignore */
  }
}

/** يفتح إعدادات التاريخ والوقت في أندرويد؛ false خارجه أو إن تعذّر. */
export async function openNativeDateSettings(): Promise<boolean> {
  const p = adhanPlugin();
  if (!p?.openDateSettings) return false;
  try {
    return (await p.openDateSettings()).opened;
  } catch {
    return false;
  }
}

/** Stops an Adhan that is currently playing through the native service. */
export async function stopNativeAdhan(): Promise<void> {
  const p = adhanPlugin();
  if (!p) return;
  try {
    await p.stop();
  } catch {
    /* ignore */
  }
}

/** Plays a recording immediately through the native service (settings preview). */
export async function previewNativeAdhan(
  url: string | undefined,
  title = "معاينة الأذان",
): Promise<boolean> {
  const p = adhanPlugin();
  const sound = rawResourceName(url);
  if (!p || !sound) return false;
  try {
    await p.preview({ sound, title });
    return true;
  } catch {
    return false;
  }
}

/* ------------------- قنوات الصوت: حزمتان منفصلتان -------------------
 *
 * منذ أندرويد ٨ يُحدَّد صوت الإشعار بقناته لا بالإشعار نفسه، وصوت القناة لا
 * يتغيّر بعد إنشائها. لذلك لكل صوتٍ قناته الثابتة، وبادئتان لا تلتقيان:
 *
 *   manar_azkar_<مورد>     ← «تذكيرات الأذكار والوِرد» فقط  (REMINDER_TONES)
 *   manar_approach_<مورد>  ← «التنبيهات قبل الصلاة» فقط     (PRAYER_APPROACH_CLIPS)
 *
 * قنوات الأذان والإقامة وسكينة و`manar_reminders` لا تُمسّ.
 */

const AZKAR_CHANNEL_PREFIX = "manar_azkar_";
const SEASON_CHANNEL_PREFIX = "manar_season_";

const APPROACH_CHANNEL_PREFIX = "manar_approach_";

/* ------------------- مستوى صوت الإشعارات -------------------
 *
 * صوت القناة ملفٌّ ثابت لا يقبل مستوى صوت، فلكل درجة من درجات
 * `NOTIFICATION_LEVELS` نسخةٌ مخفَّضة من كل نغمة (`<مورد>_v60` مثلاً، من
 * scripts/build-volume-levels.mjs) وقناةٌ خاصة بها. الدرجة ١٠٠ هي القنوات
 * الأصلية نفسها بلا أي تغيير، والدرجة ٠ هي القناة الصامتة. */

const levelSuffix = (level: NotificationLevel) => (level === 100 ? "" : `_v${level}`);
const LEVEL_CHANNEL = /^manar_(?:azkar_.+|approach_.+|season_.+|reminders)_v(\d+)(?:_nv)?$/;
/** قنوات التنبيهات بلاحقة (درجة أو «بلا اهتزاز») — تُحذف إن لم تعد مطلوبة. */
const NV_CHANNEL = /^manar_(?:azkar_.+|approach_.+|season_.+|reminders(?:_v\d+)?)_nv$/;

/* ------------------- الاهتزاز -------------------
 * اهتزاز القناة ثابتٌ بعد إنشائها كصوتها، فكانت قنوات التنبيهات كلها تهتزّ
 * مهما كان إعداد «الاهتزاز». من أطفأه تُنشأ له نسخةٌ من كل قناة بلاحقة `_nv`
 * بلا اهتزاز، وتُسلَّم تنبيهاته عليها. */
let channelVibrate = true;
const nv = () => (channelVibrate ? "" : "_nv");

/** يضبط نمط القنوات (للاختبار وللمزامنة). */
export function setChannelVibration(on: boolean) {
  channelVibrate = on;
}

/** اسم مورد الصوت بالدرجة المطلوبة. */
function leveledRaw(raw: string, level: NotificationLevel): string {
  return raw + levelSuffix(level);
}

/** قناة تذكير أذكار/وِرد لصوتٍ من فهرسه — أو القناة الصامتة. */
export function azkarWirdChannelFor(url: string, level: NotificationLevel = 100): string {
  const raw = rawResourceName(url);
  return raw && level > 0 ? AZKAR_CHANNEL_PREFIX + leveledRaw(raw, level) + nv() : "manar_silent";
}

/** قناة تنبيه موسمي لصوتٍ من حزمة المواسم بالدرجة المطلوبة. */
export function seasonChannelFor(id: SeasonSoundId, level: NotificationLevel = 100): string {
  if (level === 0) return "manar_silent";
  return SEASON_CHANNEL_PREFIX + leveledRaw(rawResourceName(seasonSoundUrl(id)), level) + nv();
}

/** قناة تنبيه قبل صلاة لمقطعٍ من حزمة اقتراب الصلاة. */
export function prayerApproachChannelFor(url: string, level: NotificationLevel = 100): string {
  if (level === 0) return "manar_silent";
  return APPROACH_CHANNEL_PREFIX + leveledRaw(rawResourceName(url), level) + nv();
}

/** قناة التنبيه الافتراضي قبل الصلاة (التكبير) بالدرجة المطلوبة. */
export function defaultReminderChannelFor(level: NotificationLevel = 100): string {
  if (level === 0) return "manar_silent";
  return (level === 100 ? "manar_reminders" : `manar_reminders_v${level}`) + nv();
}

let soundChannelsLevel: string | null = null;

async function ensureSoundChannels(p: LocalNotificationsPlugin, level: NotificationLevel) {
  /* iOS بلا قنوات: الصوت يُشتقّ من معرّف القناة نفسه في الطبقة الأصلية، فتبقى
   * المعرّفات «المقصودة» (failedChannels فارغة) ولا يُستدعى ما لا يُنفَّذ. */
  if (isIOSApp()) return;
  setChannelVibration(getAdhanSettings().vibrationEnabled);
  const cacheKey = `${level}${nv()}`;
  if (soundChannelsLevel === cacheKey) return;
  const vibration = channelVibrate;
  const levels: NotificationLevel[] = level === 100 || level === 0 ? [100] : [100, level];
  const pct = (l: NotificationLevel) =>
    (l === 100 ? "" : ` · ${toArabicDigitsLocal(l)}٪`) + (vibration ? "" : " · بلا اهتزاز");
  const channels: Parameters<LocalNotificationsPlugin["createChannel"]>[0][] = [];
  for (const l of levels) {
    for (const t of REMINDER_TONES) {
      if (!t.url) continue;
      channels.push({
        id: azkarWirdChannelFor(t.url, l),
        name: `تذكيرات الأذكار والوِرد · ${t.name}${pct(l)}`,
        description: "تذكير الأذكار والوِرد اليومي",
        importance: 3,
        visibility: 1,
        sound: `${leveledRaw(rawResourceName(t.url), l)}.mp3`,
        vibration,
      });
    }
    for (const c of Object.values(PRAYER_APPROACH_CLIPS)) {
      channels.push({
        id: prayerApproachChannelFor(c.url, l),
        name: `التنبيه قبل الصلاة · ${c.name}${pct(l)}`,
        description: "تذكير قبل دخول وقت الصلاة",
        importance: 3,
        visibility: 1,
        sound: `${leveledRaw(rawResourceName(c.url), l)}.mp3`,
        vibration,
      });
    }
    for (const [id, snd] of Object.entries(SEASON_SOUNDS) as [SeasonSoundId, SeasonSound][]) {
      channels.push({
        id: seasonChannelFor(id, l),
        name: `تنبيهات المواسم · ${snd.name}${pct(l)}`,
        description: "تنبيهات مواسم الخير في منار",
        importance: 3,
        visibility: 1,
        sound: `${leveledRaw(rawResourceName(snd.url), l)}.mp3`,
        vibration,
      });
    }
    if (l !== 100 || !vibration) {
      // `manar_reminders` نفسها تُنشأ أصلياً (ManarChannels) ولا تُمسّ.
      channels.push({
        id: defaultReminderChannelFor(l),
        name: `التذكيرات${pct(l)}`,
        description: "تذكير قبل دخول وقت الصلاة",
        importance: 3,
        visibility: 1,
        sound: l === 100 ? "segment_takbir.mp3" : `segment_takbir_v${l}.mp3`,
        vibration,
      });
    }
  }
  let ok = true;
  for (const c of channels) {
    try {
      await p.createChannel(c);
      failedChannels.delete(c.id);
    } catch {
      /* قناة واحدة تعذّرت لا تُسقط الجدولة: إشعارها يُحوَّل إلى قناة القسم
       * الاحتياطية أدناه، ونحاول إنشاءها ثانيةً في المزامنة التالية. */
      ok = false;
      failedChannels.add(c.id);
    }
  }
  /* قنوات الدرجات السابقة لا حاجة لها بعد تغيير المستوى، فنحذفها حتى لا
   * تتراكم في إعدادات النظام. القنوات الأصلية (بلا لاحقة) لا تُحذف أبداً.
   * وقنوات النغمات المحذوفة من التذكيرات (manar_azkar_*) تُحذف كذلك. */
  if (p.listChannels && p.deleteChannel) {
    try {
      const { channels: existing } = await p.listChannels();
      const wanted = new Set(channels.map((c) => c.id));
      for (const c of existing) {
        const ours =
          c.id.startsWith(AZKAR_CHANNEL_PREFIX) || c.id.startsWith(SEASON_CHANNEL_PREFIX);
        if (ours && !wanted.has(c.id)) {
          await p.deleteChannel({ id: c.id }).catch(() => {});
          continue;
        }
        const suffixed = LEVEL_CHANNEL.test(c.id) || NV_CHANNEL.test(c.id);
        if (suffixed && !wanted.has(c.id)) await p.deleteChannel({ id: c.id }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }
  soundChannelsLevel = ok ? cacheKey : null;
}

function toArabicDigitsLocal(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

const failedChannels = new Set<string>();

/** إن تعذّر إنشاء قناة الصوت نرجع لقناة القسم نفسه، لا لقناة قسمٍ آخر. */
function channelOr(id: string, fallback: string): string {
  return failedChannels.has(id) ? fallback : id;
}

/** احتياط قسم الأذكار والوِرد: نغمته الأولى، ثم الصمت — لا قناة التنبيه قبل الصلاة. */
function azkarWirdFallbackChannel(level: NotificationLevel): string {
  const first = REMINDER_TONES.find((t) => t.url);
  const id = first ? azkarWirdChannelFor(first.url, level) : "manar_silent";
  return failedChannels.has(id) ? "manar_silent" : id;
}

let actionsRegistered = false;
const DAILY_REMINDER_ACTIONS = "DAILY_REMINDER";

async function registerActions(p: LocalNotificationsPlugin) {
  if (actionsRegistered) return;
  actionsRegistered = true;
  try {
    await p.registerActionTypes({
      types: [
        {
          id: DAILY_REMINDER_ACTIONS,
          actions: [{ id: "snooze", title: `ذكّرني بعد ${minutesAr(SNOOZE_MINUTES, "gen")}` }],
        },
      ],
    });
  } catch {
    /* ignore */
  }
}

/**
 * Rebuild the whole native schedule from the local prayer computation.
 * Everything is computed offline — no network involved.
 *
 * @returns the number of scheduled items (adhan + iqama + reminders).
 */
let syncChain: Promise<unknown> = Promise.resolve();
/* طلبٌ ينتظر دوره ولم يبدأ بعد: الطلبات اللاحقة تنضمّ إليه بأحدث المعاملات
 * بدل أن تصطفّ خلفه. العودة إلى التطبيق كانت تُطلق ثلاث مزامنات متتالية. */
let queued: { location: LocationState; calc: Settings; run: Promise<number> } | null = null;

/* مزامنتان متداخلتان قد تُلغي إحداهما ما جدولته الأخرى، فتُسلسَل في طابور واحد،
 * ويُدمج كل ما يصل قبل أن يبدأ الدور التالي في مزامنة واحدة. */
export function syncNativePrayerSchedule(location: LocationState, calc: Settings): Promise<number> {
  if (queued) {
    queued.location = location;
    queued.calc = calc;
    return queued.run;
  }
  const start = () => {
    const args = queued!;
    queued = null;
    return syncNativePrayerScheduleNow(args.location, args.calc);
  };
  const run = syncChain.then(start, start);
  queued = { location, calc, run };
  syncChain = run.catch(() => 0);
  return run;
}

async function syncNativePrayerScheduleNow(
  location: LocationState,
  calc: Settings,
): Promise<number> {
  if (!isNativeShell()) return 0;

  const adhan = adhanPlugin();
  const s = getAdhanSettings();
  if (adhan) {
    /* الأذان والإقامة يُشغَّلان في الخدمة الأصلية ولو كان التطبيق مغلقاً،
     * فتحفظ الخدمة مستوياتهما لتقرأها لحظة التشغيل. تُحفظ قبل فحص إذن
     * الإشعارات: كانت تُتخطّى كلياً إن لم يُمنح الإذن بعد، فيبقى مستوى قديم. */
    try {
      await adhan.setVolumes({
        master: s.volume,
        adhan: s.adhanVolume,
        iqama: s.iqamaVolume,
        reminder: effectiveVolume(s, "reminder"),
        raiseAlarm: s.raisePhoneAlarm,
        vibrate: s.vibrationEnabled,
      });
    } catch {
      /* نسخة أصلية أقدم بلا هذه الدالة: يبقى التشغيل بكامل الصوت كما كان */
    }
  }
  /* لا شرط على إذن الإشعارات هنا: الأذان يُسمع بلا هذا الإذن، وكان رفضه يُبقي
   * جدولاً قديماً يعمل ٣٠ يوماً (أذانٌ أُطفئ يظلّ يُسمع). التذكيرات تُضبط كذلك،
   * فتظهر بمجرد منح الإذن، ويُلغى منها ما لم يعد مطلوباً. */
  const p = plugin();
  const level = notificationLevel(s);
  if (p) await registerActions(p);
  if (p) await ensureSoundChannels(p, level);

  const now = Date.now();
  const reminders: unknown[] = [];
  /* الأذان والإقامة والتنبيه قبل الصلاة و«تذكير الفجر»: جدول واحد من دالّة
   * نقيّة بمفاتيح فريدة، يُسلَّم للطبقة الأصلية بنافذتها المتحركة (٤٨ ساعة
   * مضبوطة من ٣٠ يوماً محفوظة). كان التنبيه قبل الصلاة هنا في LocalNotifications
   * لسبعة أيام وحدها، فيسكت بعد أسبوع والأذان باقٍ. */
  const reminderChannel = (prayer: PrayerKey) => {
    if (s.silentMode || !s.soundEnabled) return "manar_silent";
    const clip = approachClipFor(s.reminderSound, prayer);
    const fallback = channelOr(defaultReminderChannelFor(level), "manar_reminders");
    return clip ? channelOr(prayerApproachChannelFor(clip.url, level), fallback) : fallback;
  };
  const buildAdhan = (renew?: { day: number; body: string }) =>
    buildPrayerAlarms({
      settings: s,
      location,
      calc,
      now,
      days: ADHAN_DAYS_AHEAD,
      reminderChannel,
      renew,
    });

  /* ---------- تذكيرات الأذكار والوِرد ---------- */

  const daily = readReminders();
  /* تذكير اليوم يُتخطّى إن أُنجز عمله قبل موعده (سجل النشاط اليومي). */
  const todayLog = readLog().days[dayKey(new Date(now))];
  const done = { wird: todayLog?.wird ?? [], chapters: todayLog?.chapters };
  /* في الجدول الأصلي منذ المرحلة ٢٩ (٣٠ يوماً): «ذكّرني لاحقاً» بمستقبِلٍ أصلي
   * لا يفتح التطبيق، والنقر يفتح صفحة التذكير. */
  const planned = planDailyReminders(daily, {
    now,
    days: ADHAN_DAYS_AHEAD,
    timesFor: (date) => computePrayerTimes(location, calc, date),
    done,
  });
  const dailyUrl = (r: DailyReminder) =>
    s.silentMode || !s.soundEnabled || level === 0 ? "" : toneUrl(r.tone);
  const dailyEvents: ManarAdhanEvent[] = [];
  for (const { reminder: r, index, dayIndex, at } of planned) {
    if (index >= DAILY_EVENT_MAX) continue;
    const day = new Date(now);
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + dayIndex);
    const ln = dailyNotification(r, 0, at, dailyUrl(r), level);
    dailyEvents.push({
      id: dailyEventId(day, index),
      key: `daily_${index}_${dateKey(day)}`,
      at: at.getTime(),
      sound: "",
      title: ln.title,
      body: ln.body,
      kind: "notice",
      role: "daily",
      prayer: "fajr",
      channel: ln.channelId,
      meta: { route: r.route, snooze: SNOOZE_MINUTES },
      /* تذكير أذكار: منبّه دقيق عادي، لا أولوية منبّه (المرحلة ٣٢). */
      priority: false,
    });
  }

  /* ---------- تنبيهات مواسم منار (اختيارية، محلية بالكامل) ---------- */

  try {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const planned = seasonNotificationsBetween(
      start,
      DAYS_AHEAD,
      getHijriAdjust(),
      readSeasonNotifyPrefs(),
      undefined,
      /* تذكير الكهف في قسم الجمعة يُغني عن ذكره في تذكير موسم الجمعة. */
      { jumuahKahf: readJumuah().prefs.remindKahf },
    );
    /* لكل تنبيه موسمي صوته من حزمة المواسم (seasons/sounds.ts)؛ وإن تعذّرت
     * قناته فالاحتياطي العام، ثم قناة التنبيهات العامة. */
    const audible = !(s.silentMode || !s.soundEnabled || level === 0);
    const generalChannel = channelOr(
      seasonChannelFor(DEFAULT_SEASON_SOUND, level),
      channelOr(defaultReminderChannelFor(level), "manar_reminders"),
    );
    for (const n of planned) {
      if (n.at.getTime() <= now) continue;
      const sound = seasonSoundFor(n.seasonId, n.reminderId);
      reminders.push({
        id: seasonIdFor(n.dayIndex, n.slot),
        title: n.title,
        body: n.body,
        schedule: { at: n.at, allowWhileIdle: true },
        smallIcon: "ic_stat_manar",
        channelId: audible
          ? channelOr(seasonChannelFor(sound, level), generalChannel)
          : "manar_silent",
        /* أندرويد < ٨ يأخذ الصوت من الإشعار لا من القناة. */
        sound: audible ? leveledRaw(rawResourceName(seasonSoundUrl(sound)), level) : undefined,
        extra: { kind: "season", season: n.seasonId, route: `/seasons/${n.seasonId}` },
      });
    }
  } catch (e) {
    /* خطأ في المواسم لا يمنع بقية التنبيهات */
    console.error("[manar] تعذّر حساب تنبيهات المواسم", e);
  }

  /* ---------- صلاة الجمعة: الكهف، التبكير، ساعة الإجابة ---------- */

  try {
    const store = readJumuah();
    const planned = planJumuahReminders({
      now,
      days: DAYS_AHEAD,
      store,
      timelineFor: (key) => jumuahTimeline(key, location, calc, s, store.prefs),
      sunriseFor: (key) => {
        const [y, m, d] = key.split("-").map(Number);
        return computePrayerTimes(location, calc, new Date(y, m - 1, d, 12)).sunrise;
      },
    });
    const audible = !(s.silentMode || !s.soundEnabled || level === 0);
    const channel = audible
      ? channelOr(defaultReminderChannelFor(level), "manar_reminders")
      : "manar_silent";
    planned.forEach((r) => {
      const dayIndex = Math.max(
        0,
        Math.round(
          (new Date(r.key).getTime() - new Date(dayKey(new Date(now))).getTime()) / 86_400_000,
        ),
      );
      reminders.push({
        id: JUMUAH_ID_BASE + dayIndex * 10 + r.slot,
        title: r.title,
        body: r.body,
        schedule: { at: r.at, allowWhileIdle: true },
        smallIcon: "ic_stat_manar",
        channelId: channel,
        extra: { kind: "jumuah", route: "/jumuah" },
      });
    });
  } catch (e) {
    console.error("[manar] تعذّر حساب تنبيهات الجمعة", e);
  }

  /* iOS: حدّ النظام ٦٤ إشعاراً معلّقاً للتطبيق كله. تمرّ المواسم والجمعة عبر
   * الجدول الأصلي نفسه فيقتسم الجميع الميزانية بالأقرب أولاً، ولا يُسقط iOS
   * أذاناً بصمت لأن تذكير موسمٍ بعيد سبقه إلى المكان. */
  const iosFolded: ManarAdhanEvent[] = [];
  if (isIOSApp()) {
    for (const r of reminders) {
      const e = foldLocalNotification(r);
      if (e) iosFolded.push({ ...e, prayer: "dhuhr" } as unknown as ManarAdhanEvent);
    }
    reminders.length = 0;
  }

  /* حدّ أعلى لـLocalNotifications: كل إشعارٍ منبّهٌ في النظام، وحدّ أندرويد
   * ٥٠٠ للتطبيق كله (مع نافذة الأذان وسكينة). الأقرب أولاً. */
  if (reminders.length > LN_CAP) {
    reminders.sort(
      (a, b) =>
        (a as { schedule: { at: Date } }).schedule.at.getTime() -
        (b as { schedule: { at: Date } }).schedule.at.getTime(),
    );
    reminders.length = LN_CAP;
  }

  /* تنبيه التجديد يسبق نهاية أقصر جدولٍ فعّال، لا نهاية جدول الأذان وحده. */
  const adhanEvents: ManarAdhanEvent[] = [
    ...buildAdhan(renewPlan({ lnItems: reminders.length, sakinah: readSakinah().enabled })),
    ...dailyEvents,
    ...iosFolded,
  ].sort((a, b) => a.at - b.at || a.id - b.id);

  let scheduled = 0;
  let alarms = 0;
  let exactAlarms = false;

  if (adhan) {
    try {
      const r = await adhan.schedule({ events: adhanEvents });
      scheduled += r.scheduled;
      alarms = r.scheduled;
      exactAlarms = r.exactAlarms;
    } catch (e) {
      /* the reminders below are still worth scheduling */
      console.error("[manar] تعذّرت جدولة الأذان والإقامة", e);
    }
  }

  if (p) {
    /* الجديد أولاً ثم حذف ما لم يعد مطلوباً: ضبطُ معرّفٍ قائم يستبدله. كان
     * «إلغاء الكل ثم الضبط» يُسقط التذكيرات كلها إن أنهى النظام التطبيق بين
     * الخطوتين. */
    let pendingIds: number[] | null = null;
    try {
      pendingIds = (await p.getPending()).notifications.map((n) => n.id);
    } catch {
      pendingIds = null;
    }
    if (reminders.length) {
      try {
        await p.schedule({ notifications: reminders });
        scheduled += reminders.length;
      } catch {
        /* ignore */
      }
    }
    if (pendingIds) {
      const nextIds = reminders.map((r) => (r as { id: number }).id);
      const stale = staleIds(pendingIds, nextIds, ID_BASE, SNOOZE_ID_BASE);
      if (stale.length) {
        try {
          await p.cancel({ notifications: stale.map((id) => ({ id })) });
        } catch {
          /* ignore */
        }
      }
    }
  }

  lastSync = { at: Date.now(), alarms, reminders: reminders.length, exactAlarms };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("manar:schedule-synced", { detail: lastSync }));
  }
  return scheduled;
}

/** إشعار تذكير أذكار/وِرد واحد كما يُسلَّم لـ`LocalNotifications`. */
function dailyNotification(
  r: DailyReminder,
  id: number,
  at: Date,
  url: string,
  level: NotificationLevel,
) {
  return {
    id,
    title: r.name,
    body: r.body,
    schedule: { at, allowWhileIdle: true },
    smallIcon: "ic_stat_manar",
    /* قناة الصوت المختار من فهرس الأذكار والوِرد. كانت كل التذكيرات تمرّ
     * بقناة `manar_reminders` (صوت التكبير) فيضيع اختيار المستخدم على
     * أندرويد ٨+، حيث القناة لا الإشعار هي من تُحدّد الصوت. */
    channelId: url
      ? channelOr(azkarWirdChannelFor(url, level), azkarWirdFallbackChannel(level))
      : "manar_silent",
    /* الصوت يُمرَّر باسم المورد الأصلي؛ نغمات التذكير القصيرة (٢–٦ ثوانٍ)
     * تصلح لإشعار عادي، بخلاف الأذان الذي يحتاج خدمةً أمامية. */
    sound: url ? leveledRaw(rawResourceName(url), level) : undefined,
    /* زرّ «ذكّرني لاحقاً» داخل الإشعار. */
    actionTypeId: DAILY_REMINDER_ACTIONS,
    extra: { kind: "daily-reminder", reminder: r.id, route: r.route },
  };
}

/** نفس الصوت والقناة التي سيصل بها التذكير فعلاً. */
async function dailyDelivery(r: DailyReminder) {
  const s = getAdhanSettings();
  const level = notificationLevel(s);
  const p = plugin();
  if (p) {
    await registerActions(p);
    await ensureSoundChannels(p, level);
  }
  const url = s.silentMode || !s.soundEnabled || level === 0 ? "" : toneUrl(r.tone);
  return { p, url, level };
}

/** «ذكّرني لاحقاً»: التذكير نفسه بعد عشر دقائق. */
export async function snoozeDailyReminder(reminderId: string): Promise<boolean> {
  const r = readReminders().items.find((i) => i.id === reminderId);
  if (!r) return false;
  const { p, url, level } = await dailyDelivery(r);
  if (!p) return false;
  const idx = readReminders().items.findIndex((i) => i.id === reminderId);
  try {
    await p.schedule({
      notifications: [
        dailyNotification(
          r,
          SNOOZE_ID_BASE + Math.max(0, idx % 90),
          new Date(Date.now() + SNOOZE_MINUTES * 60_000),
          url,
          level,
        ),
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * «تجربة التنبيه الآن» لتذكير أذكار/وِرد: إشعار حقيقي بعد ثانيتين بالصوت
 * والقناة الفعليين. `false` خارج أندرويد أو دون إذن الإشعارات.
 */
export async function testDailyReminderNow(r: DailyReminder): Promise<boolean> {
  if (!isNativeShell() || !(await ensureNativePermission())) return false;
  const { p, url, level } = await dailyDelivery(r);
  if (!p) return false;
  try {
    await p.schedule({
      notifications: [dailyNotification(r, TEST_ID, new Date(Date.now() + 2000), url, level)],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * «تجربة التنبيه الآن» للإقامة: التسجيل الفعلي لهذه الصلاة عبر خدمة الأذان
 * الأصلية نفسها (قناة الإقامة ومستوى صوتها)، أو إشعار صامت إن كان صوتها مطفأً.
 */
export async function testIqamaNow(prayer: PrayerKey): Promise<boolean> {
  if (!isNativeShell()) return false;
  const s = getAdhanSettings();
  const label = prayerLabelOn(prayer, new Date());
  const title = `إقامة ${label} — تجربة`;
  const body = "هكذا يصل تنبيه الإقامة";
  const sound = getIqamahSound(resolveIqamaForPrayer(s, prayer));
  const soundOn = s.soundEnabled && !s.silentMode && s.iqamaSoundEnabled && !!sound;
  const adhan = adhanPlugin();
  if (soundOn && adhan && sound) {
    try {
      await adhan.preview({
        sound: rawResourceName(sound.url),
        title,
        body,
        volume: effectiveVolume(s, "iqama"),
        usage: "alarm",
      });
      return true;
    } catch {
      /* نسخة أصلية أقدم: إشعار صامت أدناه */
    }
  }
  const p = plugin();
  if (!p || !(await ensureNativePermission())) return false;
  try {
    await p.schedule({
      notifications: [
        {
          id: TEST_ID,
          title,
          body,
          schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true },
          smallIcon: "ic_stat_manar",
          channelId: "manar_iqama",
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/* مستمع نقرٍ واحد طوال عمر التطبيق لكل إشعارات LocalNotifications، يوزّع حسب
 * `extra.kind`. كانت أربعة مستمعين منفصلين للحدث نفسه، أحدها («إيقاف الأذان» القديم)
 * لإجراءٍ لا يحمله أي إشعار ويُسجَّل من جديد مع كل تغيّر في الموقع. وحدث النقر
 * الذي فتح التطبيق من الإغلاق تحتفظ به الإضافة الأصلية حتى يُسجَّل المستمع. */
let tapAttached = false;
let reminderTapHandler: ((route: ReminderRoute) => void) | null = null;
let seasonTapHandler: ((seasonId: string) => void) | null = null;

/** يوزّع حدث نقرٍ واحد على معالجه — مُصدَّر للاختبار. */
export function dispatchNotificationTap(e: unknown): void {
  const extra = (e as { notification?: { extra?: { kind?: string } } })?.notification?.extra;
  const actionId = (e as { actionId?: string })?.actionId;
  if (extra?.kind === "jumuah") {
    if (actionId === "tap") reminderTapHandler?.("/jumuah" as ReminderRoute);
    return;
  }
  const season = seasonIdFromNotificationTap(e);
  if (season) {
    seasonTapHandler?.(season);
    return;
  }
  const action = reminderActionFromTap(e);
  if (!action) return;
  if (action.type === "open") reminderTapHandler?.(action.route);
  else void snoozeDailyReminder(action.reminder);
}

async function ensureTapListener() {
  const p = plugin();
  if (!p || tapAttached) return;
  tapAttached = true;
  try {
    await p.addListener("localNotificationActionPerformed", dispatchNotificationTap);
  } catch {
    tapAttached = false;
  }
}

/** النقر على تذكير أذكار/وِرد يفتح صفحته، و«ذكّرني لاحقاً» يؤجّله؛ والجمعة قسمها. */
export async function attachReminderTapListener(onOpen: (route: ReminderRoute) => void) {
  reminderTapHandler = onOpen;
  await ensureTapListener();
}

/** النقر على تنبيه موسم يفتح صفحة الموسم. */
export async function attachSeasonTapListener(onOpen: (seasonId: string) => void) {
  seasonTapHandler = onOpen;
  await ensureTapListener();
}

/** Cancels every native alarm and notification Manar owns. */
export async function cancelNativeSchedule(): Promise<void> {
  const adhan = adhanPlugin();
  if (adhan) {
    try {
      await adhan.cancelAll();
    } catch {
      /* ignore */
    }
  }
  const p = plugin();
  if (!p) return;
  try {
    const pending = await p.getPending();
    const ours = pending.notifications.filter(
      (n) => n.id >= ID_BASE && n.id < SNOOZE_ID_BASE + 100,
    );
    if (ours.length) await p.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  } catch {
    /* ignore */
  }
}

/* ------------------- شاشة القفل: «صلّيت» ومسار النقر (المرحلة ٢٩) ------------------- */

/**
 * يدمج طابور «صلّيت» الأصلي في سجل النشاط. يُستدعى عند الإقلاع والعودة إلى
 * التطبيق ومع حدث `manarPrayed` حين تكون الواجهة حيّة. يعيد عدد المسجَّل.
 */
export async function mergeNativePrayed(): Promise<number> {
  const p = adhanPlugin();
  if (!p?.takePrayed) return 0;
  try {
    const { items } = await p.takePrayed();
    return applyPrayed(items);
  } catch {
    return 0;
  }
}

/** مسارات يفتحها نقر إشعارٍ أصلي — داخلية فقط. */
export function isNotificationRoute(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.startsWith("/") &&
    !v.startsWith("//") &&
    !v.includes(":") &&
    v.length <= 120
  );
}

let routeListenerAttached = false;

/**
 * نقر إشعار أصلي (دخول الوقت، الإقامة، تذكير أذكار) ← مساره. الأصلي يحتفظ
 * بالحدث حتى يُسجَّل المستمع، فيصل حتى إن فُتح التطبيق من الإغلاق.
 */
export async function attachNativeRouteListener(onRoute: (route: string) => void): Promise<void> {
  const p = adhanPlugin();
  if (!p || routeListenerAttached) return;
  routeListenerAttached = true;
  try {
    await p.addListener("manarOpenRoute", (e) => {
      const route = (e as { route?: unknown })?.route;
      if (isNotificationRoute(route)) onRoute(route);
    });
    await p.addListener("manarPrayed", () => {
      void mergeNativePrayed();
    });
  } catch {
    routeListenerAttached = false;
  }
}

/* ------------------- مركز التنبيهات (المرحلة ٣٠) ------------------- */

export async function nativeAlertLog(): Promise<AlertLogEvent[]> {
  const p = adhanPlugin();
  if (!p?.alertLog) return [];
  try {
    const { events } = await p.alertLog();
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

export async function clearNativeAlertLog(): Promise<void> {
  try {
    await adhanPlugin()?.clearAlertLog?.();
  } catch {
    /* لا شيء */
  }
}

export async function nativeChannelStatus(): Promise<ChannelInfo[]> {
  const p = adhanPlugin();
  if (!p?.channelStatus) return [];
  try {
    const { channels } = await p.channelStatus();
    return Array.isArray(channels) ? channels : [];
  } catch {
    return [];
  }
}

/**
 * «تجربة شاملة»: أذان الظهر المختار بعد دقيقة، بالمسار الأصلي نفسه. `null`
 * خارج أندرويد أو إن تعذّر الضبط.
 */
export async function scheduleFullTest(): Promise<{
  key: string;
  at: number;
  exact: boolean;
} | null> {
  const p = adhanPlugin();
  if (!p?.testAlarm || !(await ensureNativePermission())) return null;
  const s = getAdhanSettings();
  const soundOn = s.soundEnabled && !s.silentMode;
  try {
    const r = await p.testAlarm({
      sound: soundOn ? rawResourceName(adhanVariantUrl(resolveAdhanForPrayer(s, "dhuhr"))) : "",
      title: "تجربة شاملة — منار",
      body: "هكذا يصل الأذان والتطبيق مغلق",
      seconds: 60,
      priority: s.alarmClockPriority,
    });
    if (!r.scheduled || !r.key || !r.at) return null;
    return { key: r.key, at: r.at, exact: !!r.exact };
  } catch {
    return null;
  }
}

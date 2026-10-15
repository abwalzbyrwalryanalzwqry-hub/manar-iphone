/**
 * منار ايفون — ما يخصّ iOS في الطبقة المشتركة.
 *
 * الطبقة المشتركة (الواجهة والحسابات) واحدة؛ والفروق هنا وحدها حيث يختلف
 * النظام فعلاً:
 *  • لا «قنوات إشعار» في iOS: الصوت يُحمل في الإشعار نفسه باسم ملف CAF.
 *  • حدّ النظام ٦٤ إشعاراً معلّقاً للتطبيق كله — فتمرّ تنبيهات المواسم والجمعة
 *    عبر الجدول الأصلي نفسه (ManarAdhan) ليقتسم الجميع الميزانية بالأقرب أولاً.
 *  • لا تحكّم بـ«عدم الإزعاج» ولا بمستوى صوت المنبّه ولا «المنبّهات الدقيقة».
 */
import { Capacitor } from "@capacitor/core";

export function isIOSApp(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

/** صفحات وبطاقات تقول «أندرويد» صراحةً تقرأ اسم المنصّة من هنا. */
export function nativePlatformName(): string {
  return isIOSApp() ? "iPhone" : "أندرويد";
}

/**
 * المورد الخام لقناة أندرويد — مرآة `ManarSounds.rawForChannel` في Swift.
 * "" = صامت، undefined = نغمة النظام الافتراضية.
 */
export function rawForChannel(channelIn: string | undefined | null): string | undefined {
  if (!channelIn) return undefined;
  let channel = channelIn;
  if (channel.endsWith("_nv")) channel = channel.slice(0, -3);
  if (channel === "manar_silent") return "";
  for (const prefix of ["manar_azkar_", "manar_approach_", "manar_season_"]) {
    if (channel.startsWith(prefix)) return channel.slice(prefix.length);
  }
  if (channel === "manar_reminders") return "segment_takbir";
  if (channel.startsWith("manar_reminders_v")) {
    return `segment_takbir_${channel.slice("manar_reminders_".length)}`;
  }
  return undefined;
}

/**
 * اسم ملف الصوت الذي تحتاجه LocalNotifications على iOS (بامتداده، من
 * Library/Sounds). القناة أولاً لأنها تحمل درجة الصوت المختارة.
 * undefined = بلا صوت.
 */
export function iosNotificationSound(
  channelId: string | undefined,
  sound: string | undefined,
): string | undefined {
  const fromChannel = rawForChannel(channelId);
  if (fromChannel === "") return undefined;
  const raw = fromChannel ?? (sound ? sound.replace(/\.(mp3|m4a|wav|ogg|caf)$/i, "") : "");
  return raw ? `${raw}.caf` : "default";
}

/** حدث جدول أصلي من عنصر LocalNotifications (المواسم، الجمعة) — iOS فقط. */
export type IOSFoldedEvent = {
  id: number;
  at: number;
  kind: "notice";
  role: "reminder";
  key: string;
  title: string;
  body: string;
  sound: string;
  channel?: string;
  meta?: { route?: string };
};

export function foldLocalNotification(n: unknown): IOSFoldedEvent | null {
  const item = (n ?? {}) as {
    id?: unknown;
    title?: unknown;
    body?: unknown;
    schedule?: { at?: unknown };
    channelId?: unknown;
    extra?: { route?: unknown; kind?: unknown };
  };
  const at = item.schedule?.at;
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : NaN;
  if (typeof item.id !== "number" || !Number.isFinite(ms)) return null;
  const route = typeof item.extra?.route === "string" ? item.extra.route : undefined;
  const kind = typeof item.extra?.kind === "string" ? item.extra.kind : "ln";
  return {
    id: item.id,
    at: ms,
    kind: "notice",
    role: "reminder",
    key: `${kind}_${item.id}`,
    title: typeof item.title === "string" ? item.title : "منار",
    body: typeof item.body === "string" ? item.body : "",
    sound: "",
    channel: typeof item.channelId === "string" ? item.channelId : undefined,
    meta: route ? { route } : undefined,
  };
}

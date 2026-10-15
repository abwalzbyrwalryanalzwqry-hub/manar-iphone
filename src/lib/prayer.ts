import { geolocationAvailable, getCurrentPositionCompat } from "@/lib/geo";
import { useEffect, useMemo, useState, useLayoutEffect } from "react";
import {
  CalculationMethod,
  Coordinates,
  HighLatitudeRule,
  Madhab,
  PolarCircleResolution,
  PrayerTimes,
  SunnahTimes,
  type CalculationParameters,
} from "adhan";
import { getHijriAdjust, toHijri, useHijriAdjust } from "./hijri";

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

export type PrayerKey = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";

export const PRAYER_LABELS: Record<PrayerKey, { ar: string; en: string }> = {
  fajr: { ar: "الفجر", en: "Fajr" },
  sunrise: { ar: "الشروق", en: "Shuruq" },
  dhuhr: { ar: "الظهر", en: "Dhuhr" },
  asr: { ar: "العصر", en: "Asr" },
  maghrib: { ar: "المغرب", en: "Maghrib" },
  isha: { ar: "العشاء", en: "Isha" },
};

export const PRAYER_ORDER: PrayerKey[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

export type LocationState = {
  lat: number;
  lng: number;
  city: string;
  country?: string;
  source: "gps" | "manual" | "default";
  /**
   * المنطقة الزمنية للموقع (IANA) إن عُرفت يقيناً — من Nominatim عند التحديد
   * التلقائي. بغيابها تُستنتج من المدينة أو الدولة (`place-timezone.ts`).
   */
  tz?: string;
};

export type CalcMethodKey =
  | "MuslimWorldLeague"
  | "Egyptian"
  | "Karachi"
  | "UmmAlQura"
  | "Dubai"
  | "Qatar"
  | "Kuwait"
  | "MoonsightingCommittee"
  | "Singapore"
  | "Turkey"
  | "Tehran"
  | "NorthAmerica";

/** أسماء طرق الحساب بالعربية — مصدر واحد لكل الشاشات. */
export const METHOD_LABELS: Record<CalcMethodKey, string> = {
  UmmAlQura: "أم القرى (مكة المكرمة)",
  MuslimWorldLeague: "رابطة العالم الإسلامي",
  Egyptian: "الهيئة المصرية العامة للمساحة",
  Karachi: "جامعة العلوم الإسلامية — كراتشي",
  Dubai: "دبي",
  Qatar: "قطر",
  Kuwait: "الكويت",
  MoonsightingCommittee: "لجنة رؤية الهلال",
  Singapore: "سنغافورة",
  Turkey: "تركيا (ديانت)",
  Tehran: "طهران",
  NorthAmerica: "أمريكا الشمالية (ISNA)",
};

/** إزاحة يدوية بالدقائق لكل صلاة. */
export type PrayerOffsets = Record<PrayerKey, number>;

export const EMPTY_OFFSETS: PrayerOffsets = {
  fajr: 0,
  sunrise: 0,
  dhuhr: 0,
  asr: 0,
  maghrib: 0,
  isha: 0,
};

/** حدّ الإزاحة اليدوية بالدقائق — يمنع إدخال قيم تُفسد الجدول. */
export const OFFSET_LIMIT = 60;

export type Settings = {
  method: CalcMethodKey;
  madhab: "shafi" | "hanafi";
  /**
   * تعديل المستخدم لكل صلاة بالدقائق (−٦٠ … +٦٠). الحساب الفلكي دقيق، لكن
   * المساجد تختلف عنه بدقائق حسب المنطقة والتقويم المحلي المعتمد.
   */
  offsets: PrayerOffsets;
  /**
   * إزاحة التوقيت الصيفي بالساعات (−١ / ٠ / +١). بعض الأجهزة أو المناطق
   * تُبلّغ منطقة زمنية لا تتبع التوقيت الصيفي فيظهر الجدول متقدّماً أو
   * متأخراً ساعة كاملة.
   */
  dstOffset: number;
};

function normalizeOffsets(raw: unknown): PrayerOffsets {
  const src = (raw ?? {}) as Partial<Record<PrayerKey, unknown>>;
  const out = { ...EMPTY_OFFSETS };
  for (const k of PRAYER_ORDER) {
    const v = Number(src[k]);
    if (Number.isFinite(v)) out[k] = Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.trunc(v)));
  }
  return out;
}

/** يُكمل أي إعدادات محفوظة قديمة بالحقول الجديدة، ويحرس القيم من التلف. */
export function normalizeSettings(raw: unknown): Settings {
  const src = (raw ?? {}) as Partial<Settings>;
  const dst = Number(src.dstOffset);
  return {
    method: src.method ?? DEFAULT_SETTINGS.method,
    madhab: src.madhab === "hanafi" ? "hanafi" : "shafi",
    offsets: normalizeOffsets(src.offsets),
    dstOffset: Number.isFinite(dst) ? Math.max(-1, Math.min(1, Math.trunc(dst))) : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Defaults & storage                                                 */
/* ------------------------------------------------------------------ */

const DEFAULT_LOCATION: LocationState = {
  lat: 24.7136,
  lng: 46.6753,
  city: "الرياض",
  country: "المملكة العربية السعودية",
  source: "default",
};

const DEFAULT_SETTINGS: Settings = {
  method: "UmmAlQura",
  madhab: "shafi",
  offsets: EMPTY_OFFSETS,
  dstOffset: 0,
};

const LS_LOCATION = "manar.location.v1";
const LS_SETTINGS = "manar.settings.v1";
const LS_CACHE = "manar.prayer-cache.v1";

function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function safeSet(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  Calculation helpers                                                */
/* ------------------------------------------------------------------ */

function buildParams(settings: Settings): CalculationParameters {
  const params = (CalculationMethod[settings.method] ?? CalculationMethod.UmmAlQura)();
  params.madhab = settings.madhab === "hanafi" ? Madhab.Hanafi : Madhab.Shafi;

  /* نمرّر الإزاحة عبر `adjustments` الخاصة بمكتبة الحساب بدل تعديل التواريخ
   * الناتجة، فتبقى كل الاشتقاقات (الصلاة القادمة، العدّ التنازلي، أوقات السنن،
   * جدولة التنبيهات الأصلية) متّسقة مع الجدول المعروض تلقائياً. */
  const dstMinutes = (settings.dstOffset ?? 0) * 60;
  const offsets = settings.offsets ?? EMPTY_OFFSETS;
  params.adjustments = {
    fajr: (offsets.fajr ?? 0) + dstMinutes,
    sunrise: (offsets.sunrise ?? 0) + dstMinutes,
    dhuhr: (offsets.dhuhr ?? 0) + dstMinutes,
    asr: (offsets.asr ?? 0) + dstMinutes,
    maghrib: (offsets.maghrib ?? 0) + dstMinutes,
    isha: (offsets.isha ?? 0) + dstMinutes,
  };
  return params;
}

/** شهر رمضان في التقويم الهجري بإزاحة المستخدم. */
function isRamadan(date: Date, hijriAdjust: number): boolean {
  try {
    return toHijri(date, hijriAdjust).month === 9;
  } catch {
    return false;
  }
}

/**
 * مواقيت يوم واحد. تُحسب لكل تاريخ من جديد، فتتغيّر يومياً مع حركة الشمس.
 *
 * فوق ما تفعله المكتبة:
 * - **أم القرى في رمضان:** العشاء بعد المغرب بـ١٢٠ دقيقة بدل ٩٠، كما يطبّقه
 *   تقويم أم القرى الرسمي (وتوصي به مكتبة adhan نفسها).
 * - **خطوط العرض العالية (> ٤٨°):** قاعدة «سُبع الليل» الموصى بها بدل «منتصف
 *   الليل»، حتى لا يتطابق الفجر والعشاء صيفاً في أوروبا الشمالية.
 * - **الدائرة القطبية:** حين لا تشرق الشمس أو لا تغرب يُؤخذ أقرب يوم له
 *   مواقيت، بدل «تاريخ غير صالح» يكسر العرض والتنبيهات.
 *
 * `hijriAdjust` اختياري: الافتراضي إزاحة المستخدم المحفوظة.
 */
export function computePrayerTimes(
  loc: LocationState,
  settings: Settings,
  date = new Date(),
  hijriAdjust: number = getHijriAdjust(),
): PrayerTimes {
  const coords = new Coordinates(loc.lat, loc.lng);
  const params = buildParams(settings);
  params.highLatitudeRule = HighLatitudeRule.recommended(coords);
  params.polarCircleResolution = PolarCircleResolution.AqrabYaum;
  if (settings.method === "UmmAlQura" && isRamadan(date, hijriAdjust)) {
    params.ishaInterval = 120;
  }
  return new PrayerTimes(coords, date, params);
}

export function computeSunnahTimes(times: PrayerTimes): SunnahTimes {
  return new SunnahTimes(times);
}

export function pickNextPrayer(times: PrayerTimes, now = new Date()) {
  const entries: { key: PrayerKey; at: Date }[] = PRAYER_ORDER.map((k) => ({
    key: k,
    at: times[k],
  }));
  // current
  let current: { key: PrayerKey; at: Date } = entries[0];
  for (const e of entries) if (e.at <= now) current = e;
  // next
  const next = entries.find((e) => e.at > now);
  return { current, next };
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

/**
 * بذرة ثابتة لأول رسم. `new Date()` تعطي قيمة مختلفة على الخادم وعند الترطيب،
 * فيفشل الترطيب ويُعيد React رسم الشجرة كاملةً. بذرة ثابتة تُطابِق HTML
 * المُولَّد مسبقاً، ثم يُستبدل الوقت الحقيقي في `useLayoutEffect` — أي قبل أن
 * يرسم المتصفّح الإطار الأول، فلا يرى المستخدم البذرة أبداً.
 */
const NOW_SEED = new Date(0);

/** `useLayoutEffect` على العميل و`useEffect` على الخادم (حيث لا وجود للأول). */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<Date>(NOW_SEED);

  useIsomorphicLayoutEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}

/* ------------------------------------------------------------------ */
/*  Shared, reactive location store                                    */
/* ------------------------------------------------------------------ */

const EVT_LOCATION = "manar:location";

function readLocation(): LocationState {
  return safeGet(LS_LOCATION, DEFAULT_LOCATION);
}
function writeLocation(next: LocationState) {
  safeSet(LS_LOCATION, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT_LOCATION));
  }
}

export function getLocation(): LocationState {
  return readLocation();
}

/** Great-circle bearing (degrees from True North) to the Kaaba. */
export function qiblaBearing(loc: { lat: number; lng: number }): number {
  const KAABA_LAT = 21.4225;
  const KAABA_LNG = 39.8262;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(loc.lat);
  const φ2 = toRad(KAABA_LAT);
  const Δλ = toRad(KAABA_LNG - loc.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle distance in km. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * رابط الاستدلال العكسي من Nominatim. الإحداثيات مقرّبة إلى منزلتين (~١ كم):
 * اسم المدينة (zoom=10) لا يحتاج أكثر، ولا نرسل موقع المستخدم الدقيق إلى خدمة
 * خارجية. المواقيت والقبلة تبقى بالإحداثيات الكاملة محلياً.
 */
export function nominatimReverseUrl(lat: number, lng: number): string {
  const r = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
  return `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=ar&lat=${r(lat)}&lon=${r(lng)}&zoom=10`;
}

/** رسالة عربية لكل رمز من `GeolocationPositionError`. */
export function geolocationErrorAr(code: number): string {
  switch (code) {
    case 1:
      return "لم يُمنح إذن الموقع";
    case 2:
      return "تعذّر تحديد موقعك — فعّل خدمة الموقع (GPS) وجرّب في مكان مكشوف";
    case 3:
      return "استغرق تحديد الموقع وقتاً طويلاً — حاول مرة أخرى";
    default:
      return "تعذّر تحديد موقعك";
  }
}

export function useLocation() {
  /* نبدأ من الافتراضي لا من التخزين: الخادم لا يرى localStorage، فلو قرأناه في
   * أول رسم على العميل لاختلف الناتج عمّا أرسله الخادم وفشل الترطيب. نقرأ
   * المحفوظ في `useLayoutEffect` — قبل أول رسم للمتصفّح فلا يظهر وميض. */
  const [location, setLocationState] = useState<LocationState>(DEFAULT_LOCATION);
  const [status, setStatus] = useState<
    "idle" | "requesting" | "granted" | "denied" | "unsupported" | "failed"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  useIsomorphicLayoutEffect(() => {
    const stored = readLocation();
    setLocationState(stored);
    if (stored.source === "gps") setStatus("granted");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setLocationState(readLocation());
    window.addEventListener(EVT_LOCATION, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT_LOCATION, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setLocation = (next: LocationState) => {
    setLocationState(next);
    writeLocation(next);
  };

  const requestGps = () => {
    if (!geolocationAvailable()) {
      setStatus("unsupported");
      setError("المتصفح لا يدعم تحديد الموقع");
      return;
    }
    setStatus("requesting");
    setError(null);
    getCurrentPositionCompat(
      async (pos) => {
        /* أولاً بلا إنترنت: نسمّي الموقع من القاعدة المضمَّنة (٣٤٣ محافظة
         * و٢٤٢٨ مدينة عربية)، فيعمل التحديد التلقائي كاملاً في وضع الطيران
         * أو بشبكة ضعيفة. ثم نُحسّن الاسم عبر الشبكة إن كانت متاحة فعلاً. */
        const { nearestPlace, loadWorldCities } = await import("@/lib/places");
        /* المدن العالمية الكبرى تسمّي الموقع خارج العالم العربي وتعطيه منطقته
         * الزمنية الدقيقة حتى في الدول متعدّدة المناطق. */
        await loadWorldCities();
        const near = nearestPlace(pos.coords.latitude, pos.coords.longitude);
        let city = near?.city ?? "موقعي الحالي";
        let country = near?.country ?? location.country;
        let tz: string | undefined = near?.tz;
        const online = typeof navigator === "undefined" || navigator.onLine !== false;
        if (online) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 6000);
            const r = await fetch(nominatimReverseUrl(pos.coords.latitude, pos.coords.longitude), {
              signal: ctrl.signal,
            });
            clearTimeout(t);
            if (r.ok) {
              const j = await r.json();
              const a = j.address ?? {};
              city = a.city || a.town || a.village || a.county || a.state || city;
              country = a.country || country;
              const { timeZoneForCountryCode } = await import("@/lib/place-timezone");
              /* منطقة المدينة القريبة أدقّ من منطقة الدولة (أمريكا، روسيا…). */
              tz = tz ?? timeZoneForCountryCode(a.country_code) ?? undefined;
            }
          } catch {
            /* keep the offline city name */
          }
        }

        const next: LocationState = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          city,
          country,
          source: "gps",
          ...(tz ? { tz } : {}),
        };
        setLocation(next);
        setStatus("granted");
      },
      (err) => {
        /* رسالة المتصفح إنجليزية («User denied Geolocation»)؛ ونفاد المهلة أو
         * غياب الإشارة ليسا رفضاً — لا نقول للمستخدم إنه رفض وهو لم يرفض. */
        setStatus(err.code === 1 ? "denied" : "failed");
        setError(geolocationErrorAr(err.code));
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  };

  return { location, setLocation, requestGps, status, error };
}

const EVT_SETTINGS = "manar:settings";

export function readSettings(): Settings {
  return normalizeSettings(safeGet<unknown>(LS_SETTINGS, DEFAULT_SETTINGS));
}

export function writeSettings(next: Settings) {
  safeSet(LS_SETTINGS, next);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT_SETTINGS));
}

export function useSettings() {
  /* افتراضي في أول رسم ثم المحفوظ — لنفس سبب `useLocation` أعلاه. */
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);

  /* تعديل الإعدادات من أي شاشة يجب أن ينعكس على الشاشات المفتوحة الأخرى،
   * وإلا عرضت شاشة المواقيت جدولاً قديماً بعد تغيير الإزاحة من الإعدادات. */
  useIsomorphicLayoutEffect(() => {
    setSettingsState(readSettings());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setSettingsState(readSettings());
    window.addEventListener(EVT_SETTINGS, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT_SETTINGS, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setSettings = (next: Settings) => {
    const safe = normalizeSettings(next);
    setSettingsState(safe);
    writeSettings(safe);
  };

  /** تعديل حقل واحد دون إعادة بناء الكائن في كل شاشة. */
  const patchSettings = (patch: Partial<Settings>) => setSettings({ ...readSettings(), ...patch });

  const setOffset = (prayer: PrayerKey, minutes: number) => {
    const current = readSettings();
    setSettings({
      ...current,
      offsets: {
        ...current.offsets,
        [prayer]: Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.trunc(minutes))),
      },
    });
  };

  const resetOffsets = () => patchSettings({ offsets: EMPTY_OFFSETS, dstOffset: 0 });

  return { settings, setSettings, patchSettings, setOffset, resetOffsets };
}

/* ------------------------------------------------------------------ */
/*  Master hook: combines all of the above + offline cache             */
/* ------------------------------------------------------------------ */

export function usePrayerSchedule() {
  const { location, setLocation, requestGps, status: locStatus, error: locError } = useLocation();
  const { settings, setSettings } = useSettings();
  const now = useNow(1000);

  /* `now` يتغيّر كل ثانية، لكن جدول اليوم لا يتغيّر إلا بتغيّر التاريخ.
   * نستخرج مفتاح اليوم كمتغيّر حتى يتحقّق منه المدقّق ولا نحتاج تعطيله. */
  const dayStamp = now.toDateString();

  /* إزاحة الهجري تحدّد بداية رمضان، وفيه يتغيّر عشاء أم القرى. */
  const { adjust: hijriAdjust } = useHijriAdjust();

  const today = useMemo(
    () => computePrayerTimes(location, settings, new Date(dayStamp), hijriAdjust),
    [location, settings, dayStamp, hijriAdjust],
  );
  const tomorrow = useMemo(() => {
    const d = new Date(dayStamp);
    d.setDate(d.getDate() + 1);
    return computePrayerTimes(location, settings, d, hijriAdjust);
  }, [location, settings, dayStamp, hijriAdjust]);

  // Cache last successful schedule for offline fallback
  useEffect(() => {
    try {
      safeSet(LS_CACHE, {
        date: now.toDateString(),
        location,
        settings,
        times: PRAYER_ORDER.reduce<Record<string, string>>((acc, k) => {
          acc[k] = today[k].toISOString();
          return acc;
        }, {}),
      });
    } catch {
      /* ignore */
    }
  }, [today, location, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const { current, next } = useMemo(() => {
    const t = pickNextPrayer(today, now);
    if (!t.next) {
      return { current: t.current, next: { key: "fajr" as PrayerKey, at: tomorrow.fajr } };
    }
    return { current: t.current, next: t.next };
  }, [today, tomorrow, now]);

  const remainingMs = Math.max(0, next.at.getTime() - now.getTime());

  // Progress between current prayer and next prayer (0..1)
  const intervalMs = Math.max(1, next.at.getTime() - current.at.getTime());
  const elapsedMs = Math.max(0, now.getTime() - current.at.getTime());
  const progress = Math.max(0, Math.min(1, elapsedMs / intervalMs));

  return {
    now,
    location,
    setLocation,
    requestGps,
    locStatus,
    locError,
    settings,
    setSettings,
    today,
    tomorrow,
    current,
    next,
    remainingMs,
    progress,
  };
}

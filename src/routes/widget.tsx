import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { Icon, icons, Mark, Screen, ScreenHeader, SectionLabel } from "@/components/manar/shell";
import { computePrayerTimes, PRAYER_LABELS, useLocation, useSettings, useNow } from "@/lib/prayer";
import { useHijriAdjust } from "@/lib/hijri";
import { widgetSeasonLine } from "@/lib/seasons/widget-line";
import { useDailyVerse, useLocalDay } from "@/lib/daily-content";
import { ampmAr, formatArTime, formatCountdown, formatHijriAr, toArabicDigits } from "@/lib/format";
import { WIDGET_PRAYERS, widgetVerseText } from "@/lib/widget-snapshot";
import {
  requestWidgetRefresh,
  useWidgetOptions,
  WIDGET_THEME_LABELS,
  type WidgetOptions,
  type WidgetTheme,
} from "@/lib/widget-settings";
import {
  getHomeWidgetStatus,
  isNativeShell,
  requestPinHomeWidget,
  type HomeWidgetStatus,
} from "@/lib/native-notifications";

export const Route = createFileRoute("/widget")({
  /* المحتوى كله أوقات وتواريخ بتوقيت الجهاز، والخادم لا يعرف منطقة المستخدم
   * الزمنية، فرسمه على الخادم يعطي نصاً مختلفاً ويكسر الـHydration. */
  ssr: false,
  head: () => ({ meta: [{ title: "ويدجت الشاشة الرئيسية — منار" }] }),
  component: WidgetScreen,
});

const STEPS = [
  "اضغط مطوّلاً على مساحة فارغة في الشاشة الرئيسية حتى تهتزّ الأيقونات.",
  "اضغط «تعديل» أو «+» في أعلى الشاشة، ثم «إضافة أداة».",
  "ابحث عن «منار» في قائمة الأدوات.",
  "اختر الحجم الذي تريده (صغير، متوسط، كبير) ثم «إضافة أداة».",
  "ولشاشة القفل: اضغط مطوّلاً على شاشة القفل ← «تخصيص» ← «إضافة أدوات» ← منار.",
];

const TOGGLES: {
  key: keyof Omit<WidgetOptions, "theme">;
  label: string;
  sub: string;
  icon: string;
}[] = [
  {
    key: "countdown",
    label: "العدّ التنازلي",
    sub: "الوقت المتبقّي للصلاة القادمة، يتحرّك وحده",
    icon: icons.clock,
  },
  {
    key: "hijri",
    label: "التاريخ الهجري",
    sub: "أعلى الويدجت، بحسب إزاحة التقويم في الإعدادات",
    icon: icons.calendar,
  },
  { key: "city", label: "اسم المدينة", sub: "بجانب التاريخ", icon: icons.location },
  {
    key: "season",
    label: "الموسم",
    sub: "«اليوم ١٢ من رمضان · الإفطار» بدل التاريخ في أيام المواسم",
    icon: icons.sparkle,
  },
  { key: "verse", label: "آية اليوم", sub: "تتجدّد كل يوم بلا إنترنت", icon: icons.quran },
];

function WidgetScreen() {
  const native = isNativeShell();
  const { options, update, reset } = useWidgetOptions();
  const [status, setStatus] = useState<HomeWidgetStatus | null>(null);
  const [checking, setChecking] = useState(native);

  const refreshStatus = useCallback(async () => {
    if (!native) return;
    setStatus(await getHomeWidgetStatus());
    setChecking(false);
  }, [native]);

  // بعد إضافة الويدجت من المُشغّل يعود المستخدم إلى التطبيق: نعيد الفحص.
  useEffect(() => {
    void refreshStatus();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    const t = window.setInterval(() => void refreshStatus(), 4000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(t);
    };
  }, [refreshStatus]);

  const placed = (status?.placed ?? 0) > 0;

  const addToHome = async () => {
    const ok = await requestPinHomeWidget();
    if (ok) toast.success("اختر «إضافة» في النافذة التي ظهرت لتثبيت الويدجت");
    else toast.message("المُشغّل لا يدعم الإضافة المباشرة — اتبع الخطوات أدناه");
  };

  const refreshNow = () => {
    requestWidgetRefresh();
    toast.success("سيتحدّث الويدجت خلال ثوانٍ");
  };

  return (
    <Screen>
      <ScreenHeader
        title="ويدجت الشاشة الرئيسية"
        subtitle="الصلاة القادمة وآية اليوم على شاشة جوالك"
        backTo="/more"
      />

      <div className="px-5">
        <WidgetPreview options={options} />
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          معاينة حيّة — تتغيّر فوراً مع اختياراتك أدناه
        </p>
      </div>

      <SectionLabel>الحالة</SectionLabel>
      <div className="px-5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          {!native ? (
            <StatusLine
              tone="muted"
              title="متاح في تطبيق منار للآيفون"
              sub="الويدجت يعمل على الشاشة الرئيسية وشاشة القفل في iPhone. ثبّت تطبيق منار ثم عد إلى هذه الصفحة."
            />
          ) : checking ? (
            <StatusLine tone="muted" title="جارٍ التحقّق…" sub="" />
          ) : placed ? (
            <StatusLine
              tone="ok"
              title={
                status!.placed === 1
                  ? "الويدجت مضاف إلى الشاشة الرئيسية"
                  : `مضاف ${toArabicDigits(status!.placed)} مرات إلى الشاشة الرئيسية`
              }
              sub="يتحدّث وحده عند كل أذان ومنتصف الليل، ويبقى صحيحاً أسبوعاً والتطبيق مغلق."
            />
          ) : (
            <StatusLine
              tone="warn"
              title="الويدجت غير مضاف بعد"
              sub="أضفه بلمسة واحدة، أو اتبع الخطوات اليدوية أدناه."
            />
          )}

          {native && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              {status?.pinSupported && (
                <button
                  onClick={() => void addToHome()}
                  className="gradient-primary flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-medium text-primary-foreground shadow-glow"
                >
                  <Icon d={icons.plus} size={14} />
                  {placed ? "إضافة نسخة أخرى" : "إضافة إلى الشاشة الرئيسية"}
                </button>
              )}
              {placed && (
                <button
                  onClick={refreshNow}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 text-xs font-medium"
                >
                  <Icon d={icons.refresh} size={14} />
                  تحديث الويدجت الآن
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <SectionLabel>ما يظهر في الويدجت</SectionLabel>
      <div className="space-y-2 px-5">
        {TOGGLES.map((t) => (
          <SwitchRow
            key={t.key}
            icon={t.icon}
            label={t.label}
            sub={t.sub}
            on={options[t.key]}
            onChange={(v) => update({ [t.key]: v } as Partial<WidgetOptions>)}
          />
        ))}
      </div>

      <SectionLabel>اللون</SectionLabel>
      <div className="grid grid-cols-2 gap-2 px-5" role="radiogroup" aria-label="لون الويدجت">
        {(Object.keys(WIDGET_THEME_LABELS) as WidgetTheme[]).map((t) => {
          const on = options.theme === t;
          return (
            <button
              key={t}
              role="radio"
              aria-checked={on}
              onClick={() => update({ theme: t })}
              className={`flex min-h-12 items-center gap-3 rounded-2xl border bg-card px-3 py-3 text-right shadow-soft transition ${
                on ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              <span className={`h-8 w-8 shrink-0 rounded-xl ${themeClass(t)}`} aria-hidden />
              <span className="flex-1 text-sm font-medium">{WIDGET_THEME_LABELS[t]}</span>
              {on && (
                <span className="text-primary">
                  <Icon d={icons.check} size={16} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <SectionLabel>الإضافة يدوياً</SectionLabel>
      <div className="px-5">
        <ol className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
          {STEPS.map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-medium text-primary">
                {toArabicDigits(i + 1)}
              </span>
              <span className="text-xs leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <SectionLabel>إن لم يتحدّث الويدجت</SectionLabel>
      <div className="px-5">
        <ul className="space-y-2 rounded-2xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground shadow-soft">
          <li>
            • افتح منار مرة واحدة بعد تغيير الموقع أو طريقة الحساب ليستلم الويدجت المواقيت الجديدة.
          </li>
          <li>
            • اسمح لمنار بالعمل في الخلفية من إعدادات البطارية، خصوصاً على أجهزة شاومي وهواوي وأوبو.
          </li>
          <li>• إذا ظهر «افتح منار لتحديث المواقيت»، افتح التطبيق أو اضغط «تحديث الويدجت الآن».</li>
          <li>• الويدجت لا يحتاج إنترنت: المواقيت وآية اليوم محسوبة على جوالك.</li>
        </ul>
        <button
          onClick={reset}
          className="mt-3 min-h-11 w-full rounded-xl border border-border bg-secondary/40 text-xs"
        >
          استعادة الإعدادات الافتراضية للويدجت
        </button>
      </div>
    </Screen>
  );
}

function themeClass(t: WidgetTheme) {
  return t === "emerald"
    ? "bg-gradient-to-br from-[#0E7A5F] to-[#0B1F1A]"
    : "bg-gradient-to-br from-[#152238] to-[#0B1F1A]";
}

/** نسخة ويب من تخطيط `widget_manar.xml` بنفس البيانات والخيارات. */
function WidgetPreview({ options }: { options: WidgetOptions }) {
  const { location } = useLocation();
  const { settings } = useSettings();
  const { adjust } = useHijriAdjust();
  const day = useLocalDay();
  const verse = useDailyVerse(day);
  const now = useNow(1000);
  const dayStamp = now.toDateString();

  const next = useMemo(() => {
    const base = new Date(dayStamp);
    for (let d = 0; d < 2; d += 1) {
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, 12);
      const times = computePrayerTimes(location, settings, date);
      for (const p of WIDGET_PRAYERS) {
        if (times[p].getTime() > now.getTime()) return { key: p, at: times[p] };
      }
    }
    return null;
  }, [location, settings, dayStamp, now]);

  const hijri = formatHijriAr(now, adjust);
  const season = useMemo(() => {
    if (!options.season) return undefined;
    const t = computePrayerTimes(location, settings, new Date(dayStamp));
    const ampm = ampmAr(t.maghrib) ? (t.maghrib.getHours() < 12 ? " ص" : " م") : "";
    return widgetSeasonLine(new Date(dayStamp), adjust, `${formatArTime(t.maghrib)}${ampm}`);
  }, [options.season, location, settings, dayStamp, adjust]);
  const metaParts = [
    season ?? (options.hijri ? hijri : ""),
    options.city ? location.city : "",
  ].filter(Boolean);
  const cd = next ? formatCountdown(next.at.getTime() - now.getTime()) : null;

  return (
    <div
      className={`relative mx-auto flex min-h-[150px] w-full max-w-sm flex-col overflow-hidden rounded-[22px] p-3.5 text-white shadow-elegant ring-1 ring-white/10 ${themeClass(options.theme)}`}
      aria-label="معاينة الويدجت"
    >
      {metaParts.length > 0 && (
        <div className="truncate text-[11px] text-gold">{metaParts.join("  ·  ")}</div>
      )}
      <div className="mt-1 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[22px] font-bold leading-tight">
            {next ? PRAYER_LABELS[next.key].ar : "افتح منار لتحديث المواقيت"}
          </div>
          {next && (
            <div className="text-[13px] text-white/80">
              {formatArTime(next.at)} {ampmAr(next.at) && (next.at.getHours() < 12 ? "ص" : "م")}
            </div>
          )}
        </div>
        {options.countdown && cd && (
          <div className="shrink-0 text-left">
            <div className="text-[10px] text-white/60">متبقٍّ</div>
            <div className="text-lg tabular-nums" dir="ltr">
              {cd.h}:{cd.m}:{cd.s}
            </div>
          </div>
        )}
      </div>
      {options.verse && verse && (
        <div className="mt-2 flex-1 rounded-xl bg-white/10 px-2.5 py-1.5">
          <p className="line-clamp-3 text-[13px] leading-relaxed text-white/95">
            {widgetVerseText(verse.firstText)}
          </p>
          <div className="truncate text-[10px] text-gold">سورة {verse.surahName}</div>
        </div>
      )}
      <span className="pointer-events-none absolute bottom-2 left-2 opacity-20" aria-hidden>
        <Mark size={18} tone="light" />
      </span>
    </div>
  );
}

function StatusLine({
  tone,
  title,
  sub,
}: {
  tone: "ok" | "warn" | "muted";
  title: string;
  sub: string;
}) {
  const dot = tone === "ok" ? "bg-primary" : tone === "warn" ? "bg-gold" : "bg-muted-foreground";
  return (
    <div className="flex items-start gap-3" role="status">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {sub && (
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{sub}</div>
        )}
      </div>
    </div>
  );
}

function SwitchRow({
  icon,
  label,
  sub,
  on,
  onChange,
}: {
  icon: string;
  label: string;
  sub: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 text-right shadow-soft"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <Icon d={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[10px] text-muted-foreground">{sub}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "gradient-primary" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-all ${
            on ? "right-0.5" : "right-[22px]"
          }`}
        />
      </span>
    </button>
  );
}

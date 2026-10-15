import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Arabesque,
  Icon,
  icons,
  Screen,
  ScreenHeader,
  SectionLabel,
} from "@/components/manar/shell";
import { AlertSystemStatus } from "@/components/manar/alert-system-status";
import { toast } from "@/lib/toast";
import {
  ADJUSTABLE_PRAYERS,
  DEFAULT_IQAMA,
  IQAMA_CATEGORIES,
  IQAMA_OFFSET_MAX,
  IQAMA_REMINDER_OPTIONS,
  JUMUAH_OFFSET_MAX,
  useAdhanSettings,
  effectiveVolume,
} from "@/lib/adhan-settings";
import {
  computePrayerTimes,
  PRAYER_LABELS,
  useLocation,
  useSettings,
  type PrayerKey,
} from "@/lib/prayer";
import { formatArTime, ampmAr, toArabicDigits } from "@/lib/format";
import { playIqama, stopAdhan, type IqamaVariant } from "@/lib/adhan-sound";
import { IQAMAH_GROUP_LABELS, IQAMAH_SOUNDS, iqamahLabel } from "@/lib/iqamah-library";
import {
  iqamahReminderSkipped,
  iqamahTimeFor,
  isJumuah,
  prayerLabelOn,
} from "@/lib/prayer-schedule";
import { isNativeShell, testIqamaNow } from "@/lib/native-notifications";

export const Route = createFileRoute("/iqama")({
  /* المحتوى كله أوقات وتواريخ بتوقيت الجهاز، والخادم لا يعرف منطقة المستخدم
   * الزمنية، فرسمه على الخادم يعطي نصاً مختلفاً ويكسر الـHydration. */
  ssr: false,
  head: () => ({ meta: [{ title: "الإقامة — منار" }] }),
  component: IqamaSettings,
});

function IqamaSettings() {
  const { settings, update, updateDeep } = useAdhanSettings();
  const { location } = useLocation();
  const { settings: calc } = useSettings();
  const [playing, setPlaying] = useState<IqamaVariant | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  // معاينة واحدة في كل لحظة، وتُسكَت عند مغادرة الشاشة.
  useEffect(
    () => () => {
      stopRef.current?.();
      stopRef.current = null;
    },
    [],
  );

  const previewIqama = (v: IqamaVariant) => {
    if (playing === v) {
      stopAdhan();
      stopRef.current = null;
      setPlaying(null);
      return;
    }
    setPlaying(v);
    stopRef.current = playIqama(v, {
      volume: effectiveVolume(settings, "iqama"),
      onEnd: () => setPlaying((cur) => (cur === v ? null : cur)),
      onError: () => setPlaying((cur) => (cur === v ? null : cur)),
    });
  };

  const setOffset = (p: PrayerKey, v: number) =>
    updateDeep((s) => ({
      ...s,
      iqamaOffsets: { ...s.iqamaOffsets, [p]: Math.max(0, Math.min(IQAMA_OFFSET_MAX, v)) },
    }));

  const setJumuahOffset = (v: number) =>
    update({ jumuahIqamaOffset: Math.max(1, Math.min(JUMUAH_OFFSET_MAX, v)) });

  const enablePrayerIqama = (p: PrayerKey) =>
    updateDeep((s) => ({
      ...s,
      perPrayer: { ...s.perPrayer, [p]: { ...s.perPrayer[p], iqama: true } },
    }));

  // ساعة تتقدّم كل دقيقة، حتى ينتقل العرض إلى الغد بعد إقامة العشاء دون إعادة فتح الشاشة.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* مواقيت اليوم من محرّك المواقيت نفسه — موعد الإقامة = الأذان + الفاصل. بعد
   * آخر حدث في اليوم (إقامة العشاء، أو أذانها إن لم تكن لها إقامة) تُعرض مواعيد
   * الغد بدل أوقات مضت. */
  const { shown, isTomorrow } = useMemo(() => {
    const todayTimes = computePrayerTimes(location, calc, new Date(now));
    const ishaEnd =
      iqamahTimeFor(settings, "isha", todayTimes.isha)?.getTime() ?? todayTimes.isha.getTime();
    if (now <= ishaEnd) return { shown: todayTimes, isTomorrow: false };
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return { shown: computePrayerTimes(location, calc, d), isTomorrow: true };
  }, [location, calc, now, settings]);
  const shownDay = shown.dhuhr;
  const shownIsFriday = isJumuah("dhuhr", shownDay);

  // الجمعة القادمة (أو اليوم إن كان جمعة) — لعرض موعد إقامتها.
  const nextFriday = useMemo(() => {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    return computePrayerTimes(location, calc, d).dhuhr;
  }, [location, calc, now]);
  const jumuahIqamaAt = iqamahTimeFor(settings, "dhuhr", nextFriday);

  // الصلوات التي لن يصلها تنبيه ما قبل الإقامة (مدّته ≥ فاصلها).
  const skipped = iqamahReminderSkipped(settings, shownDay);

  const [testing, setTesting] = useState(false);
  const testNow = async () => {
    // الصلاة القادمة، حتى تُسمَع الإقامة التي ستصل فعلًا بعد قليل.
    const p: PrayerKey = ADJUSTABLE_PRAYERS.find((k) => shown[k].getTime() > now) ?? "fajr";
    setTesting(true);
    try {
      if (isNativeShell()) {
        const ok = await testIqamaNow(p);
        if (ok) toast.success("أُرسل تنبيه تجريبي بصوت الإقامة وقناتها");
        else toast.error("تعذّر إرسال التنبيه — تحقّق من إذن الإشعارات");
      } else {
        // على الويب لا إشعارات أصلية: نُسمع الصوت الفعلي لإقامة هذه الصلاة.
        previewIqama(settings.perPrayerIqama[p] ?? settings.iqamaVariant);
        toast(`إقامة ${prayerLabelOn(p, new Date())} — تجربة`, {
          description: "الإشعار الفعلي يصل في تطبيق منار للآيفون",
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const confirmReset = () => {
    if (
      !window.confirm(
        "استعادة فواصل الإقامة الافتراضية وإلغاء أصوات الصلوات المخصّصة وإعداد الجمعة؟",
      )
    )
      return;
    updateDeep((s) => ({
      ...s,
      iqamaOffsets: { ...DEFAULT_IQAMA },
      perPrayerIqama: {},
      jumuahIqamaEnabled: true,
      jumuahIqamaOffset: 30,
    }));
    toast.success("استُعيدت القيم الافتراضية");
  };

  const soundDisabled = !settings.iqamaEnabled;
  // الفواصل تخدم الإقامة وتنبيهها معاً؛ لا معنى لها إن أُطفئ الاثنان.
  const offsetsDisabled = !settings.iqamaEnabled && !settings.iqamaReminderEnabled;

  const makkahCount = IQAMAH_SOUNDS.filter((s) => s.group === "makkah").length;
  const madinahCount = IQAMAH_SOUNDS.length - makkahCount;

  return (
    <Screen>
      <ScreenHeader
        title="إعدادات الإقامة"
        subtitle="صوت الإقامة وموعدها بعد الأذان"
        backTo="/more"
      />

      <div className="px-4 animate-fade-up">
        <div className="gradient-hero relative overflow-hidden rounded-[28px] p-6 text-white shadow-elegant">
          <Arabesque className="absolute -right-10 -top-10 h-56 w-56 text-white/15" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
              <Icon d={icons.prayer} size={22} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/60">الإقامة</div>
              <div className="font-display text-xl">
                {toArabicDigits(IQAMAH_SOUNDS.length)} تسجيلاً للإقامة
              </div>
              <div className="mt-0.5 text-[11px] text-white/70">
                {toArabicDigits(makkahCount)} من الحرم المكي · {toArabicDigits(madinahCount)} من
                الحرم النبوي
              </div>
              <div className="text-[11px] text-white/60">مضمّنة في التطبيق · تعمل دون إنترنت</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 px-4">
        <AlertSystemStatus settings={settings} />
      </div>

      <SectionLabel>الإعدادات العامة</SectionLabel>
      <div className="space-y-2 px-4">
        <Toggle
          label="الإقامة"
          hint="تنبيه وصوت في موعد الإقامة — مستقلّ عن الأذان"
          on={settings.iqamaEnabled}
          onToggle={() => update({ iqamaEnabled: !settings.iqamaEnabled })}
        />
        <Toggle
          label="صوت الإقامة"
          hint={
            soundDisabled
              ? "الإقامة مطفأة — شغّلها أولًا"
              : settings.iqamaSoundEnabled
                ? iqamahLabel(settings.iqamaVariant)
                : "إشعار بلا صوت"
          }
          on={settings.iqamaSoundEnabled}
          disabled={soundDisabled}
          onToggle={() => update({ iqamaSoundEnabled: !settings.iqamaSoundEnabled })}
        />
        <div className="rounded-2xl border border-border bg-card shadow-soft">
          <Toggle
            bare
            label="تنبيه قبل الإقامة"
            hint="إشعار نصّي قبل موعد الإقامة بدقائق"
            on={settings.iqamaReminderEnabled}
            onToggle={() => update({ iqamaReminderEnabled: !settings.iqamaReminderEnabled })}
          />
          {settings.iqamaReminderEnabled && (
            <div className="grid grid-cols-4 gap-2 px-4 pb-4">
              {IQAMA_REMINDER_OPTIONS.map((m) => {
                const active = settings.iqamaReminderMinutes === m;
                return (
                  <button
                    key={m}
                    onClick={() => update({ iqamaReminderMinutes: m })}
                    className={`rounded-2xl border py-2 text-center transition ${
                      active
                        ? "border-transparent gradient-primary text-primary-foreground shadow-glow"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="font-display text-lg tabular-nums">{toArabicDigits(m)}</div>
                    <div className="text-[10px] opacity-80">دقيقة</div>
                  </button>
                );
              })}
            </div>
          )}
          {settings.iqamaReminderEnabled && skipped.length > 0 && (
            <div
              role="status"
              className="mx-4 mb-4 rounded-xl bg-secondary px-3 py-2 text-[11px] leading-relaxed text-muted-foreground"
            >
              لن يصل تنبيه قبل إقامة{" "}
              {skipped.map((x) => `${x.label} (فاصلها ${toArabicDigits(x.offset)} د)`).join("، ")}{" "}
              لأن مدّة التنبيه {toArabicDigits(settings.iqamaReminderMinutes)} دقائق لا تقلّ عن
              الفاصل. اختر مدّة أقصر أو فاصلًا أطول.
            </div>
          )}
        </div>
      </div>

      <fieldset
        disabled={soundDisabled}
        aria-disabled={soundDisabled}
        className={`min-w-0 transition ${soundDisabled ? "opacity-50" : ""}`}
      >
        <SectionLabel hint="انقر ▶ للاستماع">صوت الإقامة</SectionLabel>
        <div className="px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <button
              onClick={() => previewIqama(settings.iqamaVariant)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-secondary text-primary"
              aria-label="استماع للصوت الحالي"
            >
              <Icon d={playing === settings.iqamaVariant ? icons.pause : icons.play} size={16} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-muted-foreground">الصوت الحالي</div>
              <div className="truncate text-sm font-medium">
                {iqamahLabel(settings.iqamaVariant)}
              </div>
            </div>
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary"
              aria-expanded={pickerOpen}
            >
              {pickerOpen ? "إغلاق" : "تغيير صوت الإقامة"}
            </button>
          </div>
        </div>

        {pickerOpen &&
          (["makkah", "madinah"] as const).map((group) => (
            <div key={group}>
              <SectionLabel hint={IQAMAH_GROUP_LABELS[group].hint}>
                {IQAMAH_GROUP_LABELS[group].title}
              </SectionLabel>
              <div className="space-y-2 px-4 stagger" role="radiogroup">
                {IQAMA_CATEGORIES.filter((c) => c.group === group).map((c) => {
                  const isSel = settings.iqamaVariant === c.id;
                  const isPlaying = playing === c.id;
                  return (
                    <div
                      key={c.id}
                      className={`relative overflow-hidden rounded-2xl border transition ${
                        isSel
                          ? "border-transparent gradient-primary text-primary-foreground shadow-glow"
                          : "border-border bg-card shadow-soft"
                      }`}
                    >
                      {isSel && (
                        <Arabesque className="absolute -right-6 -top-6 h-32 w-32 text-white/15" />
                      )}
                      <div className="relative flex items-center gap-3 p-4">
                        <button
                          onClick={() => previewIqama(c.id)}
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition ${
                            isSel
                              ? "border-white/30 bg-white/15 text-white"
                              : "border-border bg-secondary text-primary"
                          }`}
                          aria-label={`استماع: ${c.name}`}
                        >
                          <Icon d={isPlaying ? icons.pause : icons.play} size={16} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{c.shortName}</div>
                          <div
                            className={`text-[11px] truncate ${isSel ? "text-white/70" : "text-muted-foreground"}`}
                          >
                            {c.shortHint}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${isSel ? "bg-white/15 text-white/80" : "bg-secondary text-muted-foreground"}`}
                        >
                          {c.duration}
                        </span>
                        <button
                          onClick={() => update({ iqamaVariant: c.id })}
                          role="radio"
                          aria-checked={isSel}
                          className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                            isSel
                              ? "bg-white/20 text-white"
                              : "border border-primary/30 bg-primary/10 text-primary"
                          }`}
                        >
                          {isSel ? "محدد" : "اختر"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </fieldset>

      <SectionLabel hint="بالدقائق بعد الأذان">موعد الإقامة لكل صلاة</SectionLabel>
      <div
        className={`space-y-2 px-4 stagger transition ${offsetsDisabled ? "opacity-50" : ""}`}
        aria-disabled={offsetsDisabled}
      >
        {offsetsDisabled && (
          <div className="rounded-xl bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
            الإقامة وتنبيهها مطفآن — الفواصل محفوظة وتعمل عند تشغيل أحدهما.
          </div>
        )}
        {ADJUSTABLE_PRAYERS.map((p) => {
          const v = settings.iqamaOffsets[p];
          const perVariant = settings.perPrayerIqama[p] ?? "";
          const adhanAt = shown[p];
          // يوم الجمعة يُعرض موعد إقامة الجمعة (فاصلها الخاص) تحت الظهر.
          const friday = isJumuah(p, adhanAt);
          const iqamaAt = iqamahTimeFor(settings, p, adhanAt);
          const perOn = settings.perPrayer[p]?.iqama !== false;
          const label = PRAYER_LABELS[p].ar;
          return (
            <div key={p} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
                    <Icon d={icons.prayer} size={16} />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{PRAYER_LABELS[p].ar}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      الأذان {formatArTime(adhanAt)} {ampmAr(adhanAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOffset(p, v - 1)}
                    disabled={offsetsDisabled || v <= 0}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground disabled:opacity-40"
                    aria-label={`إنقاص فاصل إقامة ${label} دقيقة`}
                  >
                    −
                  </button>
                  <div className="min-w-[64px] text-center">
                    <div className="font-display text-xl tabular-nums">{toArabicDigits(v)}</div>
                    <div className="text-[10px] text-muted-foreground">دقيقة</div>
                  </div>
                  <button
                    onClick={() => setOffset(p, v + 1)}
                    disabled={offsetsDisabled || v >= IQAMA_OFFSET_MAX}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground disabled:opacity-40"
                    aria-label={`زيادة فاصل إقامة ${label} دقيقة`}
                  >
                    +
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={IQAMA_OFFSET_MAX}
                value={v}
                disabled={offsetsDisabled}
                onChange={(e) => setOffset(p, Number(e.target.value))}
                className="w-full accent-primary"
                dir="ltr"
                aria-label={`فاصل إقامة ${label} بالدقائق`}
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{toArabicDigits(0)}</span>
                <span>الافتراضي: {toArabicDigits(DEFAULT_IQAMA[p])}</span>
                <span>{toArabicDigits(IQAMA_OFFSET_MAX)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2 text-[11px]">
                <span className="text-muted-foreground">
                  {friday
                    ? isTomorrow
                      ? "إقامة الجمعة غدًا"
                      : "إقامة الجمعة اليوم"
                    : isTomorrow
                      ? "موعد الإقامة غدًا"
                      : "موعد الإقامة اليوم"}
                </span>
                {!perOn ? (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">معطّلة لهذه الصلاة</span>
                    <button
                      onClick={() => enablePrayerIqama(p)}
                      className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary"
                      aria-label={`تفعيل إقامة ${label}`}
                    >
                      تفعيل
                    </button>
                  </span>
                ) : (
                  <span className="font-medium tabular-nums">
                    {iqamaAt
                      ? `${formatArTime(iqamaAt)} ${ampmAr(iqamaAt)}`
                      : friday
                        ? "إقامة الجمعة مطفأة"
                        : "بلا إقامة (الفاصل صفر)"}
                  </span>
                )}
              </div>
              {friday && perOn && (
                <div className="mt-1.5 text-[10px] text-muted-foreground">
                  {settings.jumuahIqamaEnabled
                    ? `يوم الجمعة يُطبَّق فاصل الجمعة (${toArabicDigits(settings.jumuahIqamaOffset)} د) من قسم «صلاة الجمعة»، وهذا الفاصل لبقية الأيام.`
                    : "إقامة الجمعة مطفأة من قسم «صلاة الجمعة»، وهذا الفاصل لبقية الأيام."}
                </div>
              )}
              <div className="mt-3">
                <label className="text-[10px] text-muted-foreground">صوت الإقامة لهذه الصلاة</label>
                <select
                  value={perVariant}
                  disabled={soundDisabled}
                  onChange={(e) =>
                    updateDeep((s) => {
                      const next = { ...s.perPrayerIqama };
                      if (e.target.value) next[p] = e.target.value as IqamaVariant;
                      else delete next[p];
                      return { ...s, perPrayerIqama: next };
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs"
                  dir="rtl"
                >
                  <option value="">كالصوت العام — {iqamahLabel(settings.iqamaVariant)}</option>
                  {IQAMA_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.duration}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <SectionLabel hint="الخطبة تبدأ مع الأذان">صلاة الجمعة</SectionLabel>
      <div
        className={`space-y-2 px-4 transition ${offsetsDisabled ? "opacity-50" : ""}`}
        aria-disabled={offsetsDisabled}
      >
        <div className="rounded-2xl border border-border bg-card shadow-soft">
          <Toggle
            bare
            label="إقامة الجمعة"
            hint={
              settings.jumuahIqamaEnabled
                ? "بفاصل خاص بعد الأذان، بدل فاصل الظهر"
                : "لا إقامة ولا تنبيه لها يوم الجمعة"
            }
            on={settings.jumuahIqamaEnabled}
            disabled={offsetsDisabled}
            onToggle={() => update({ jumuahIqamaEnabled: !settings.jumuahIqamaEnabled })}
          />
          {settings.jumuahIqamaEnabled && (
            <div className="px-4 pb-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">بعد أذان الجمعة</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setJumuahOffset(settings.jumuahIqamaOffset - 1)}
                    disabled={offsetsDisabled || settings.jumuahIqamaOffset <= 1}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground disabled:opacity-40"
                    aria-label="إنقاص فاصل إقامة الجمعة دقيقة"
                  >
                    −
                  </button>
                  <div className="min-w-[64px] text-center">
                    <div className="font-display text-xl tabular-nums">
                      {toArabicDigits(settings.jumuahIqamaOffset)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">دقيقة</div>
                  </div>
                  <button
                    onClick={() => setJumuahOffset(settings.jumuahIqamaOffset + 1)}
                    disabled={offsetsDisabled || settings.jumuahIqamaOffset >= JUMUAH_OFFSET_MAX}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground disabled:opacity-40"
                    aria-label="زيادة فاصل إقامة الجمعة دقيقة"
                  >
                    +
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={JUMUAH_OFFSET_MAX}
                value={settings.jumuahIqamaOffset}
                disabled={offsetsDisabled}
                onChange={(e) => setJumuahOffset(Number(e.target.value))}
                className="mt-2 w-full accent-primary"
                dir="ltr"
                aria-label="فاصل إقامة الجمعة بالدقائق"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{toArabicDigits(1)}</span>
                <span>الافتراضي: {toArabicDigits(30)}</span>
                <span>{toArabicDigits(JUMUAH_OFFSET_MAX)}</span>
              </div>
            </div>
          )}
          <div className="mx-4 mb-4 flex items-center justify-between rounded-xl bg-secondary px-3 py-2 text-[11px]">
            <span className="text-muted-foreground">
              {shownIsFriday ? "إقامة الجمعة" : "الجمعة القادمة"}
            </span>
            <span className="font-medium tabular-nums">
              {settings.perPrayer.dhuhr?.iqama === false
                ? "إقامة الظهر معطّلة"
                : jumuahIqamaAt
                  ? `${formatArTime(jumuahIqamaAt)} ${ampmAr(jumuahIqamaAt)}`
                  : "مطفأة"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-2 px-4">
        <button
          onClick={() => void testNow()}
          disabled={testing}
          className="w-full rounded-2xl border border-primary/30 bg-primary/10 py-3 text-sm font-medium text-primary shadow-soft disabled:opacity-60"
        >
          تجربة التنبيه الآن
        </button>
        <button
          onClick={confirmReset}
          className="w-full rounded-2xl border border-border bg-card py-3 text-sm shadow-soft"
        >
          استعادة القيم الافتراضية
        </button>
      </div>
    </Screen>
  );
}

function Toggle({
  label,
  hint,
  on,
  onToggle,
  bare = false,
  disabled = false,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onToggle: () => void;
  bare?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={`flex w-full items-center justify-between px-4 py-3.5 text-right transition disabled:opacity-50 ${
        bare ? "" : "rounded-2xl border border-border bg-card shadow-soft"
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "gradient-primary" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-all ${on ? "right-0.5" : "right-[22px]"}`}
        />
      </span>
    </button>
  );
}

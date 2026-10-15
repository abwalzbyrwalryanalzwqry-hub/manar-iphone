/* منار — «سكينة»: أوقات للصلاة بلا مقاطعات.
 *
 * الصفحة تضبط الإعداد وتعرض الحالة الحقيقية القادمة من النظام، ولا تدّعي شيئاً
 * لا يقدر عليه الجهاز: إن كان إذنٌ ناقصاً قالت ذلك وفتحت طريق إصلاحه.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { isIOSApp } from "@/lib/ios";

import { Icon, icons, Screen, ScreenHeader, SectionLabel } from "@/components/manar/shell";
import { ampmAr, formatCountdown, formatHHMM, toArabicDigits } from "@/lib/format";
import { PRAYER_LABELS, useLocation, useNow, useSettings, type PrayerKey } from "@/lib/prayer";
import {
  END_OPTIONS,
  FILTER_LABELS,
  SAKINAH_PRAYERS,
  SAKINAH_PRESET_LABELS,
  START_OPTIONS,
  activePrayerCount,
  applyPreset,
  computeSakinahWindows,
  currentWindow,
  dateKey,
  describeLogEvent,
  describeStart,
  describeTiming,
  effectiveEnd,
  filterMode,
  filterPatch,
  makeStartOffset,
  minutesWord,
  MIN_QUIET_MINUTES,
  startDirection,
  START_OFFSET_LIMIT,
  END_LIMIT,
  type StartDirection,
  nextWindow,
  useSakinah,
  type SakinahLogLine,
  type SakinahPrayerKey,
  type SakinahPreset,
} from "@/lib/sakinah";
import {
  clearSakinahSkips,
  openSakinahPolicyAccessSettings,
  readSakinahLog,
  readSakinahStatus,
  requestSakinahPolicyAccess,
  runSakinahSelfTest,
  skipSakinahWindow,
  stopSakinahNow,
  syncSakinahSchedule,
  type SakinahDiagnostics,
  type SakinahNativeStatus,
} from "@/lib/sakinah-native";
import {
  isNativeShell,
  openNativeNotificationSettings,
  requestBatteryExemption,
  requestExactAlarms,
} from "@/lib/native-notifications";

export const Route = createFileRoute("/sakinah")({
  head: () => ({ meta: [{ title: "سكينة — منار" }] }),
  component: Sakinah,
});

const WEEKDAYS: { index: number; short: string }[] = [
  { index: 0, short: "أحد" },
  { index: 1, short: "إثن" },
  { index: 2, short: "ثلا" },
  { index: 3, short: "أرب" },
  { index: 4, short: "خمي" },
  { index: 5, short: "جمع" },
  { index: 6, short: "سبت" },
];

function Sakinah() {
  const { settings, update, updateDeep, setPrayer } = useSakinah();
  const { location } = useLocation();
  const { settings: calc } = useSettings();
  const now = useNow(1000);

  const [openPrayer, setOpenPrayer] = useState<SakinahPrayerKey | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [status, setStatus] = useState<SakinahNativeStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<SakinahDiagnostics | null>(null);
  const [testing, setTesting] = useState(false);
  const [log, setLog] = useState<SakinahLogLine[]>([]);

  const windows = useMemo(
    () => computeSakinahWindows(settings, location, calc),
    [settings, location, calc],
  );

  const nowMs = now.getTime();
  const active = nowMs > 0 ? currentWindow(windows, nowMs) : null;
  const upcoming = nowMs > 0 ? nextWindow(windows, nowMs) : null;

  const refresh = useCallback(async () => {
    setStatus(await readSakinahStatus());
    const events = await readSakinahLog();
    setLog(events.map(describeLogEvent));
  }, []);

  /* كل تغيير في الإعداد يُعيد بناء الجدول في النظام فوراً: الواجهة لا تُعتبر
     مكتملة ما لم يصل التغيير إلى المنبّهات الحقيقية. */
  useEffect(() => {
    if (!isNativeShell()) return;
    let cancelled = false;
    void (async () => {
      await syncSakinahSchedule(location, calc, settings);
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [settings, location, calc, refresh]);

  /* إذن «عدم الإزعاج» اختيارٌ للمستخدم وحده: لا يُطلب تلقائياً ولا تُفتح شاشة
     النظام دون نقرة منه. نعرض حالته ونترك له المنح أو السحب في أي وقت. */
  const openDndAccess = useCallback(async () => {
    await openSakinahPolicyAccessSettings();
    toast("في «الوصول إلى عدم الإزعاج» فعّل «منار» أو أوقفه كما تشاء، ثم ارجع إلى التطبيق", {
      duration: 5000,
    });
  }, []);

  /* بعد العودة من شاشة النظام تتحدّث حالة الإذن فوراً، منحاً كان أو سحباً. */
  useEffect(() => {
    if (!isNativeShell()) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const enable = async (next: boolean) => {
    update({ enabled: next });
    if (!next || !isNativeShell()) return;
    const s = await readSakinahStatus();
    setStatus(s);
    if (isIOSApp()) {
      toast("على iPhone تُذكّرك سكينة بتفعيل «التركيز» عند كل صلاة، وتكتم أصوات منار حتى تنتهي", {
        duration: 6000,
      });
      return;
    }
    if (s && !s.dndAccess) {
      toast("لتُسكت سكينة الهاتف أثناء الصلاة تحتاج إذن «عدم الإزعاج»", {
        duration: 6000,
        action: { label: "منح الإذن", onClick: () => void openDndAccess() },
      });
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      setDiagnostics(await runSakinahSelfTest(settings));
      await refresh();
    } finally {
      setTesting(false);
    }
  };

  const fix = async (what: "dnd" | "exact" | "battery" | "notifications") => {
    if (what === "dnd") {
      await requestSakinahPolicyAccess();
      toast("بعد السماح لمنار بالتحكم في عدم الإزعاج، ارجع وأعد الاختبار", { duration: 4000 });
    } else if (what === "exact") {
      await requestExactAlarms();
      toast("بعد السماح بالتنبيهات الدقيقة، ارجع وأعد الاختبار", { duration: 4000 });
    } else if (what === "battery") {
      await requestBatteryExemption();
      toast("بعد استثناء منار من تقييد البطارية، ارجع وأعد الاختبار", { duration: 4000 });
    } else {
      await openNativeNotificationSettings();
    }
  };

  const skipToday = () => {
    const key = dateKey(new Date());
    updateDeep((s) => ({
      ...s,
      skipDates: s.skipDates.includes(key) ? s.skipDates : [...s.skipDates, key],
    }));
    toast("استُثني اليوم — تعود سكينة غداً");
  };

  const undoSkips = async () => {
    updateDeep((s) => ({ ...s, skipDates: [] }));
    await clearSakinahSkips();
    toast("أُلغيت الاستثناءات");
  };

  const filter = filterMode(settings);
  const todaySkipped = settings.skipDates.includes(dateKey(new Date()));

  return (
    <Screen>
      <ScreenHeader title="سكينة" subtitle="أوقات للصلاة بلا مقاطعات" backTo="/more" />

      {/* المفتاح الرئيسي */}
      <div className="px-5">
        <button
          onClick={() => void enable(!settings.enabled)}
          role="switch"
          aria-checked={settings.enabled}
          aria-label="تفعيل سكينة"
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 text-right shadow-soft"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
            <Icon d={settings.enabled ? icons.moon : icons.bellOff} size={16} />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium">سكينة</span>
            <span className="block text-[10px] text-muted-foreground">
              {settings.enabled
                ? `${toArabicDigits(activePrayerCount(settings))} صلوات، ${FILTER_LABELS[filter]}`
                : "غير مفعلة — إعداداتك محفوظة"}
            </span>
          </span>
          <Switch on={settings.enabled} />
        </button>
      </div>

      {/* iPhone: لا يسمح iOS لأي تطبيق بتشغيل «عدم الإزعاج» — نشرح ما تفعله سكينة فعلاً */}
      {isIOSApp() && settings.enabled && (
        <div className="mt-3 px-5">
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              <Icon d={icons.moon} size={16} />
            </span>
            <div className="flex-1">
              <div className="text-sm font-medium">سكينة على iPhone</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                لا يسمح iOS لأي تطبيق بتشغيل «عدم الإزعاج» أو «التركيز» بنفسه. لذلك يصلك عند بدء كل
                فترة إشعار هادئ بلا صوت يذكّرك بتفعيله من مركز التحكم، وتُكتم أصوات منار وتذكيراتها
                حتى تنتهي الفترة.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                نصيحة: أنشئ «تركيزاً» باسم «الصلاة» من الإعدادات ← التركيز، واسمح فيه لتطبيق منار
                وحده، ثم شغّله من مركز التحكم بلمسة عند كل صلاة.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* إذن «عدم الإزعاج» — بيد المستخدم */}
      {isNativeShell() && !isIOSApp() && settings.enabled && status && (
        <div className="mt-3 px-5">
          <div
            className={`flex items-start gap-3 rounded-2xl border p-4 shadow-soft ${
              status.dndAccess ? "border-border bg-card" : "border-primary/40 bg-primary/5"
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              <Icon d={status.dndAccess ? icons.moon : icons.bellOff} size={16} />
            </span>
            <div className="flex-1">
              <div className="text-sm font-medium">
                {status.dndAccess ? "إذن «عدم الإزعاج»: ممنوح" : "إذن «عدم الإزعاج»: غير ممنوح"}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {status.dndAccess
                  ? "تُسكت سكينة الهاتف في أوقات الصلاة ثم تعيده كما كان. يمكنك سحب الإذن متى شئت من إعدادات النظام."
                  : "بدونه لا تستطيع سكينة إسكات الهاتف. الإذن اختياري، تمنحه من شاشة النظام ويمكنك سحبه متى شئت."}
              </p>
              <button
                onClick={() => void openDndAccess()}
                className={`mt-3 w-full rounded-xl py-2.5 text-xs font-medium ${
                  status.dndAccess
                    ? "border border-border bg-card"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {status.dndAccess ? "إدارة الإذن" : "منح الإذن"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* الحالة الآن */}
      <div className="mt-3 px-5">
        <div
          className={`rounded-2xl border p-4 shadow-soft ${
            active ? "border-primary/40 bg-primary/5" : "border-border bg-card"
          }`}
        >
          {!settings.enabled ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {isIOSApp()
                ? "فعّل سكينة لتُذكّرك بالهدوء مع كل صلاة وتكتم أصوات منار حتى تنتهي."
                : "فعّل سكينة ليصمت هاتفك وحده مع كل صلاة، ثم يعود كما كان بعدها."}
            </p>
          ) : active ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">🤫 الهدوء فعال · {active.label}</span>
                <span className="font-display text-sm tabular-nums">
                  {formatCountdown(active.end - nowMs).compact}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                بدأ {formatHHMM(new Date(active.start))} {ampmAr(new Date(active.start))}، وينتهي{" "}
                {formatHHMM(new Date(active.end))} {ampmAr(new Date(active.end))}
              </div>
              <button
                onClick={() => void stopSakinahNow().then(refresh)}
                className="mt-3 w-full rounded-xl border border-border bg-card py-2.5 text-xs font-medium"
              >
                إيقاف الآن
              </button>
              <p className="mt-2 text-[10px] text-muted-foreground">
                يُنهي هذه الفترة وحدها، وتعود سكينة في الصلاة القادمة.
              </p>
            </>
          ) : upcoming ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">الصلاة القادمة: {upcoming.label}</span>
                <span className="font-display text-sm tabular-nums">
                  {formatCountdown(upcoming.start - nowMs).compact}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                يبدأ الهدوء {formatHHMM(new Date(upcoming.start))}، وينتهي{" "}
                {formatHHMM(new Date(upcoming.end))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void skipSakinahWindow(upcoming.id).then(refresh)}
                  className="flex-1 rounded-xl border border-border bg-card py-2.5 text-xs font-medium"
                >
                  تخطي هذه الفترة
                </button>
                <button
                  onClick={skipToday}
                  className="flex-1 rounded-xl border border-border bg-card py-2.5 text-xs font-medium"
                >
                  استثناء اليوم
                </button>
              </div>
              {todaySkipped && (
                <button
                  onClick={() => void undoSkips()}
                  className="mt-2 text-[10px] text-primary underline"
                >
                  إلغاء استثناء اليوم
                </button>
              )}
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              لا فترات قادمة اليوم — فعّل صلاة واحدة على الأقل أو راجع أيام الأسبوع.
            </p>
          )}
        </div>
      </div>

      {/* أنماط جاهزة */}
      <SectionLabel hint="يضبط كل الصلوات مرة واحدة">النمط</SectionLabel>
      <div className="grid grid-cols-3 gap-2 px-5">
        {(Object.keys(SAKINAH_PRESET_LABELS) as SakinahPreset[]).map((p) => (
          <Chip
            key={p}
            label={SAKINAH_PRESET_LABELS[p].label}
            hint={SAKINAH_PRESET_LABELS[p].hint}
            active={settings.preset === p}
            onClick={() => updateDeep((s) => applyPreset(s, p))}
          />
        ))}
      </div>

      {/* الصلوات */}
      <SectionLabel hint="اضغط أي صلاة لضبط بدايتها ونهايتها">الصلوات</SectionLabel>
      <div className="space-y-2 px-5">
        {SAKINAH_PRAYERS.map((p) => {
          const cfg = settings.prayers[p];
          const open = openPrayer === p;
          const label = PRAYER_LABELS[p as PrayerKey].ar;
          return (
            <div
              key={p}
              className={`overflow-hidden rounded-2xl border bg-card shadow-soft transition ${
                open ? "border-primary/40" : "border-border"
              }`}
            >
              <div className="flex items-center gap-3 px-4 py-3.5">
                <button
                  onClick={() => setPrayer(p, { enabled: !cfg.enabled })}
                  role="switch"
                  aria-checked={cfg.enabled}
                  aria-label={`سكينة في ${label}`}
                  className="shrink-0"
                  disabled={!settings.enabled}
                >
                  <Switch on={cfg.enabled && settings.enabled} />
                </button>
                <button
                  onClick={() => setOpenPrayer(open ? null : p)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-right"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {describeTiming(cfg, toArabicDigits)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-muted-foreground transition ${open ? "-rotate-90" : "rotate-180"}`}
                  >
                    <Icon d={icons.chevron} size={14} />
                  </span>
                </button>
              </div>

              {open && (
                <div className="space-y-4 border-t border-border bg-secondary/20 px-4 py-4">
                  <StartPicker
                    offset={cfg.startOffset}
                    onChange={(startOffset) => setPrayer(p, { startOffset })}
                    label={label}
                  />

                  <div>
                    <Label>نهاية الهدوء</Label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {END_OPTIONS.filter((m) => m >= cfg.startOffset + MIN_QUIET_MINUTES).map(
                        (m) => (
                          <MiniChip
                            key={m}
                            label={`بعد ${toArabicDigits(m)} ${minutesWord(m)}`}
                            active={cfg.afterMinutes === m}
                            onClick={() => setPrayer(p, { afterMinutes: m })}
                          />
                        ),
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
                      <span className="text-[10px] text-muted-foreground">مخصص</span>
                      <Stepper
                        value={cfg.afterMinutes}
                        onChange={(v) =>
                          setPrayer(p, {
                            afterMinutes: effectiveEnd(
                              cfg.startOffset,
                              Math.min(END_LIMIT, Math.max(1, v)),
                            ),
                          })
                        }
                        label="دقائق بعد الأذان"
                      />
                    </div>
                    {cfg.startOffset > 0 && (
                      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                        النهاية تُحسب من وقت الأذان، وتبقى بعد البداية بـ
                        {toArabicDigits(MIN_QUIET_MINUTES)} دقائق على الأقل.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* الخيارات المتقدمة: مطويّة حتى لا تطغى على الأساسي (النمط والصلوات). */}
      <div className="px-5 pt-5">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5 text-right shadow-soft"
        >
          <span>
            <span className="block text-sm font-medium">خيارات متقدمة</span>
            <span className="block text-[10px] text-muted-foreground">
              الجمعة، أيام الأسبوع، الصوت، الاختبار، السجل
            </span>
          </span>
          <span className={`transition ${advanced ? "-rotate-90" : "rotate-90"}`}>
            <Icon d={icons.chevron} size={14} />
          </span>
        </button>
      </div>

      {advanced && (
        <>
          {/* صلاة الجمعة */}
          <SectionLabel hint="الخطبة أطول من الصلاة">صلاة الجمعة</SectionLabel>
          <div className="px-5">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <button
                onClick={() => update({ jumuahSeparate: !settings.jumuahSeparate })}
                role="switch"
                aria-checked={settings.jumuahSeparate}
                aria-label="إعداد خاص لصلاة الجمعة"
                className="flex w-full items-center gap-3 text-right"
              >
                <span className="flex-1">
                  <span className="block text-sm font-medium">إعداد خاص للجمعة</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {settings.jumuahSeparate
                      ? describeTiming(
                          {
                            startOffset: settings.jumuahStartOffset,
                            afterMinutes: settings.jumuahAfterMinutes,
                          },
                          toArabicDigits,
                        )
                      : "تُستخدم إعدادات الظهر نفسها"}
                  </span>
                </span>
                <Switch on={settings.jumuahSeparate} />
              </button>

              {settings.jumuahSeparate && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <StartPicker
                    offset={settings.jumuahStartOffset}
                    onChange={(jumuahStartOffset) => update({ jumuahStartOffset })}
                    label="الجمعة"
                  />
                  <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/20 px-3 py-2">
                    <span className="text-[10px] text-muted-foreground">بعد الأذان</span>
                    <Stepper
                      value={settings.jumuahAfterMinutes}
                      onChange={(v) =>
                        update({
                          jumuahAfterMinutes: effectiveEnd(
                            settings.jumuahStartOffset,
                            Math.min(END_LIMIT, Math.max(1, v)),
                          ),
                        })
                      }
                      label="دقائق بعد أذان الجمعة"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* الأيام */}
          <SectionLabel hint="سكينة تعمل في الأيام المحددة فقط">أيام الأسبوع</SectionLabel>
          <div className="px-5">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <DayChip
                  key={d.index}
                  label={d.short}
                  active={settings.weekdays.includes(d.index)}
                  onClick={() =>
                    updateDeep((s) => {
                      const on = s.weekdays.includes(d.index);
                      const next = on
                        ? s.weekdays.filter((x) => x !== d.index)
                        : [...s.weekdays, d.index].sort((a, b) => a - b);
                      return { ...s, weekdays: next.length ? next : s.weekdays };
                    })
                  }
                />
              ))}
            </div>
          </div>

          {/* إعدادات الصوت */}
          <SectionLabel hint="ما يُسمح له بالمرور أثناء الهدوء">إعدادات الصوت</SectionLabel>
          <div className="space-y-2 px-5">
            {isIOSApp() ? (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                <Label>المكالمات والإشعارات</Label>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  على iPhone يحدّد «التركيز» ما يمرّ من المكالمات وإشعارات التطبيقات الأخرى
                  (الإعدادات ← التركيز ← اختر التركيز ← الأشخاص والتطبيقات). منار نفسه يكتم تذكيراته
                  طوال الفترة، والأذان حسب اختيارك أدناه.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                <Label>المكالمات والإشعارات</Label>
                <div className="mt-2 space-y-1.5">
                  <Radio
                    label="أصوات منار فقط (موصى به)"
                    hint="يمرّ أذان منار وإقامتها وتنبيهاتها وحدها، وتُكتم المكالمات والرسائل وإشعارات التطبيقات الأخرى والوسائط"
                    active={filter === "manar"}
                    onClick={() => update(filterPatch("manar"))}
                  />
                  <Radio
                    label="السماح بالمكالمات المهمة والمنبّهات"
                    hint="نمط «الأولوية» في النظام حسب استثناءاتك فيه، مع أصوات منار"
                    active={filter === "priority"}
                    onClick={() => update(filterPatch("priority"))}
                  />
                  <Radio
                    label="المنبّهات فقط"
                    hint="يصمت كل شيء إلا المنبّهات، ومنها أذان منار وإقامتها"
                    active={filter === "alarms"}
                    onClick={() => update(filterPatch("alarms"))}
                  />
                  <Radio
                    label="صمت كامل"
                    hint="لا شيء يصدر صوتًا، ولا أذان منار نفسه"
                    active={filter === "none"}
                    onClick={() => update(filterPatch("none"))}
                  />
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                  منار يستخدم وضع «عدم الإزعاج» الرسمي في الهاتف ولا يعبث بمستوى صوت جهازك، ويُعيد
                  الهاتف كما كان عند انتهاء الفترة. يحتاج «أصوات منار فقط» إذن التحكم في عدم
                  الإزعاج.
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <Label>أثناء سكينة — الأذان</Label>
              <div className="mt-2 space-y-1.5">
                <Radio
                  label="السماح بالأذان"
                  hint={
                    filter === "none"
                      ? "غير متاح مع «صمت كامل» — اختر «أصوات منار فقط» ليُسمع الأذان"
                      : "أذان منار وإقامتها يُسمعان رغم الهدوء"
                  }
                  active={!settings.muteAdhanDuringSakinah && filter !== "none"}
                  onClick={() =>
                    update(
                      filter === "none"
                        ? { ...filterPatch("manar"), muteAdhanDuringSakinah: false }
                        : { muteAdhanDuringSakinah: false },
                    )
                  }
                />
                <Radio
                  label="كتم الأذان أيضاً"
                  hint="يبقى إشعار الصلاة، بلا صوت"
                  active={settings.muteAdhanDuringSakinah || filter === "none"}
                  onClick={() => update({ muteAdhanDuringSakinah: true })}
                />
              </div>
            </div>

            <LinkRow to="/adhan" title="أذان منار" hint="اختيار الصوت لكل صلاة" />
            <LinkRow to="/iqama" title="الإقامة" hint="الفاصل والصوت" />
            <LinkRow to="/notifications" title="إشعارات منار" hint="الأذان والإقامة والتذكيرات" />
          </div>

          {/* اختبار سكينة */}
          <SectionLabel hint="يفحص ما يحتاجه النظام فعلاً">اختبار سكينة</SectionLabel>
          <div className="px-5">
            <button
              onClick={() => void runTest()}
              disabled={testing}
              className="gradient-primary flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium text-primary-foreground shadow-glow disabled:opacity-60"
            >
              <Icon d={icons.check} size={14} />
              {testing ? "جارٍ الفحص…" : "تشغيل الاختبار"}
            </button>

            {diagnostics && (
              <div className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
                <div className="text-sm font-medium">{diagnostics.title}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {diagnostics.summary}
                </p>
                <div className="mt-3 space-y-2">
                  {diagnostics.checks.map((c) => (
                    <div
                      key={c.key}
                      className="rounded-xl border border-border bg-secondary/20 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className={c.ok ? "text-primary" : "text-destructive"}>
                          <Icon d={c.ok ? icons.check : icons.info} size={12} />
                        </span>
                        <span className="flex-1 text-xs font-medium">{c.title}</span>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        {c.detail}
                      </p>
                      {c.fix && (
                        <button
                          onClick={() => void fix(c.fix!)}
                          className="mt-2 rounded-full border border-border bg-card px-3 py-1.5 text-[10px] font-medium"
                        >
                          فتح الإعدادات
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* سجل سكينة */}
          <SectionLabel hint="ما جرى فعلاً على هذا الجهاز">سجل سكينة</SectionLabel>
          <div className="px-5">
            {log.length === 0 ? (
              <p className="rounded-2xl border border-border bg-secondary/30 p-4 text-[10px] leading-relaxed text-muted-foreground">
                لا سجل بعد. يظهر هنا ما نُفّذ وما تُخطّي وما تعذّر، لكل صلاة على حدة.
              </p>
            ) : (
              <div className="space-y-1.5">
                {log
                  .slice()
                  .reverse()
                  .slice(0, 30)
                  .map((line, i) => (
                    <div
                      key={`${line.at}-${i}`}
                      className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          line.tone === "warn"
                            ? "bg-destructive"
                            : line.tone === "ok"
                              ? "bg-primary"
                              : "bg-muted-foreground/50"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px]">
                        {line.prayer ? `${line.prayer} — ` : ""}
                        {line.text}
                      </span>
                      <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
                        {formatHHMM(new Date(line.at))}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-5 px-5 pb-2">
        <p className="rounded-2xl border border-border bg-secondary/30 p-4 text-[10px] leading-relaxed text-muted-foreground">
          سكينة تُحسب من مواقيت الصلاة في هاتفك، فتتحرّك معها كل يوم وتتكيّف إذا سافرت أو تغيّرت
          طريقة الحساب. وتعمل والتطبيق مغلق لأنها تستخدم منبّهات النظام ووضع عدم الإزعاج الرسمي، ثم
          تُعيد هاتفك إلى ما كان عليه لا إلى حالة نفترضها.
          {status ? ` · فترات مجدولة الآن: ${toArabicDigits(status.pending)}` : ""}
        </p>
      </div>
    </Screen>
  );
}

/* ----------------------------- عناصر ----------------------------- */

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={`relative block h-6 w-11 rounded-full transition ${on ? "gradient-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-all ${
          on ? "right-0.5" : "right-[22px]"
        }`}
      />
    </span>
  );
}

const START_DIRS: { dir: StartDirection; label: string }[] = [
  { dir: "before", label: "قبل الأذان" },
  { dir: "with", label: "مع الأذان" },
  { dir: "after", label: "بعد الأذان" },
];

/**
 * بداية الهدوء: قبل الأذان أو معه أو بعده بدقائق يختارها المستخدم (١..٦٠).
 * الإزاحة موقّعة — سالبة قبل الأذان وموجبة بعده.
 */
function StartPicker({
  offset,
  onChange,
  label,
}: {
  offset: number;
  onChange: (offset: number) => void;
  label: string;
}) {
  const dir = startDirection(offset);
  const minutes = Math.abs(offset);
  /* آخر عدد دقائق اختير — يبقى عند التبديل بين «قبل» و«بعد». */
  const [lastMinutes, setLastMinutes] = useState(minutes || 5);
  useEffect(() => {
    if (minutes) setLastMinutes(minutes);
  }, [minutes]);
  const set = (d: StartDirection, m: number) => onChange(makeStartOffset(d, m));
  return (
    <div>
      <Label>بداية الهدوء</Label>
      <div
        role="radiogroup"
        aria-label={`بداية الهدوء في ${label}`}
        className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-border bg-card p-1"
      >
        {START_DIRS.map((o) => (
          <button
            key={o.dir}
            role="radio"
            aria-checked={dir === o.dir}
            onClick={() => set(o.dir, lastMinutes)}
            className={`rounded-lg py-1.5 text-[11px] font-medium transition ${
              dir === o.dir ? "gradient-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {dir !== "with" && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {START_OPTIONS.map((m) => (
              <MiniChip
                key={m}
                label={`${toArabicDigits(m)} ${minutesWord(m)}`}
                active={minutes === m}
                onClick={() => set(dir, m)}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
            <span className="text-[10px] text-muted-foreground">
              مخصص — {dir === "before" ? "دقائق قبل الأذان" : "دقائق بعد الأذان"}
            </span>
            <Stepper
              value={minutes}
              onChange={(v) => set(dir, Math.min(START_OFFSET_LIMIT, Math.max(1, v)))}
              label={dir === "before" ? "دقائق قبل الأذان" : "دقائق بعد الأذان"}
            />
          </div>
        </>
      )}
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        يبدأ الهدوء {describeStart(offset, toArabicDigits)}.
      </p>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-medium text-muted-foreground">{children}</div>;
}

function Chip({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-right transition ${
        active
          ? "gradient-primary border-transparent text-primary-foreground shadow-glow"
          : "border-border bg-card"
      }`}
    >
      <span className="block text-[11px] font-medium">{label}</span>
      <span className={`block text-[9px] ${active ? "opacity-80" : "text-muted-foreground"}`}>
        {hint}
      </span>
    </button>
  );
}

function MiniChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1.5 text-[10px] font-medium transition ${
        active
          ? "gradient-primary border-transparent text-primary-foreground"
          : "border-border bg-card text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function DayChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border py-1.5 text-center text-[9px] font-medium transition ${
        active
          ? "gradient-primary border-transparent text-primary-foreground"
          : "border-border bg-card text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Radio({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-right ${
        active ? "border-primary/50 bg-primary/10" : "border-border bg-card"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          active ? "gradient-primary border-transparent text-primary-foreground" : "border-border"
        }`}
      >
        {active && <Icon d={icons.check} size={10} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[9px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function Stepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(value - 1)}
        aria-label={`إنقاص ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card"
      >
        <Icon d={icons.minus} size={12} />
      </button>
      <span className="font-display text-sm tabular-nums">{toArabicDigits(value)}</span>
      <button
        onClick={() => onChange(value + 1)}
        aria-label={`زيادة ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card"
      >
        <Icon d={icons.plus} size={12} />
      </button>
    </div>
  );
}

type SoundLink = "/adhan" | "/iqama" | "/notifications";

function LinkRow({ to, title, hint }: { to: SoundLink; title: string; hint: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
        <Icon d={icons.bell} size={16} />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <span className="rotate-180 text-muted-foreground">
        <Icon d={icons.chevron} size={16} />
      </span>
    </Link>
  );
}

/* منار — «بياناتي»: بديل الحساب وتسجيل الدخول.
 *
 * كل بيانات المستخدم على جهازه. هذه الشاشة تجمع ما كان الحساب يقدّمه، بلا خادم:
 *   ١. اسم اختياري نناديك به.
 *   ٢. النسخ التلقائي عبر نسخ Google الاحتياطي لأندرويد (مهيّأ في
 *      `backup_rules.xml`) — تعود الإعدادات والتقدّم عند نقل الحساب إلى جوال جديد.
 *   ٣. ملف نسخة احتياطية: تصدير ومشاركة، واستيراد بدمج أو استبدال.
 *   ٤. إعادة ضبط التطبيق.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Icon, icons, Screen, ScreenHeader, SectionLabel } from "@/components/manar/shell";
import { ConfirmSheet } from "@/components/manar/confirm-sheet";
import { exportTextFile } from "@/lib/export-file";
import { toArabicDigits } from "@/lib/format";
import {
  applyBackup,
  backupFileName,
  buildBackup,
  clearUserData,
  LAST_EXPORT_KEY,
  parseBackup,
  summarizeBackup,
  type ImportMode,
  type ManarBackup,
} from "@/lib/local-backup";
import { flushPersistentWrites } from "@/lib/persistent-storage";
import { cleanName, saveUserName, USER_NAME_MAX, useUserName } from "@/lib/user-name";

export const Route = createFileRoute("/my-data")({
  head: () => ({ meta: [{ title: "بياناتي — منار" }] }),
  component: MyData,
});

/** عدد مع معدوده بقواعد العربية: «عنصر واحد»، «عنصران»، «٣ عناصر»، «١١ عنصراً». */
function countAr(n: number, [one, two, few, many]: [string, string, string, string]): string {
  if (n === 1) return one;
  if (n === 2) return two;
  const d = toArabicDigits(n);
  return n % 100 >= 3 && n % 100 <= 10 ? `${d} ${few}` : `${d} ${many}`;
}
const ITEMS_W: [string, string, string, string] = ["عنصر واحد", "عنصران", "عناصر", "عنصراً"];
const MARKS_W: [string, string, string, string] = ["علامة واحدة", "علامتان", "علامات", "علامة"];

/** تاريخ عربي قصير بأرقام عربية: «٢٧ سبتمبر ٢٠٢٦». */
function arDate(ms: number): string {
  return toArabicDigits(
    new Date(ms).toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" }),
  );
}

async function appVersion(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return "web";
  try {
    const { App } = await import("@capacitor/app");
    return (await App.getInfo()).version;
  } catch {
    return "";
  }
}

/** يكتب التغييرات إلى المرآة الأصلية ثم يعيد تشغيل الواجهة لتقرأ كل وحدة قيمها. */
async function restartWithNewData(to = "/") {
  await flushPersistentWrites();
  window.location.replace(to);
}

type Stats = { items: number; bookmarks: number; lastExport: number | null };

function readStats(): Stats {
  const s = summarizeBackup(buildBackup(window.localStorage, 0, ""));
  const raw = Number(window.localStorage.getItem(LAST_EXPORT_KEY));
  return { items: s.keys, bookmarks: s.bookmarks, lastExport: raw > 0 ? raw : null };
}

function MyData() {
  const savedName = useUserName();
  const [name, setName] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<ManarBackup | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const native = typeof window !== "undefined" && Capacitor.isNativePlatform();

  useEffect(() => setName(savedName), [savedName]);
  useEffect(() => setStats(readStats()), []);

  const dirty = cleanName(name) !== savedName;

  const onSaveName = () => {
    saveUserName(name);
    toast.success(cleanName(name) ? "حُفظ اسمك" : "أُزيل الاسم");
  };

  const onExport = async () => {
    setBusy(true);
    try {
      const now = Date.now();
      const backup = buildBackup(window.localStorage, now, await appVersion());
      const outcome = await exportTextFile(backupFileName(now), JSON.stringify(backup), {
        title: "نسخة منار الاحتياطية",
      });
      if (outcome === "cancelled") return;
      window.localStorage.setItem(LAST_EXPORT_KEY, String(now));
      setStats(readStats());
      toast.success(outcome === "shared" ? "جُهّزت النسخة للمشاركة" : "نُزّلت النسخة الاحتياطية");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر تصدير النسخة");
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const result = parseBackup(await file.text());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPending(result.backup);
  };

  const onImport = async (mode: ImportMode) => {
    if (!pending) return;
    setBusy(true);
    try {
      const changed = applyBackup(window.localStorage, pending, mode);
      setPending(null);
      if (changed.length === 0) {
        toast.success("بيانات جهازك مطابقة للنسخة — لا شيء تغيّر");
        setBusy(false);
        return;
      }
      toast.success("استُعيدت النسخة — يُعاد تشغيل منار");
      await restartWithNewData();
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "تعذّر استيراد النسخة");
    }
  };

  const onReset = async () => {
    setBusy(true);
    clearUserData(window.localStorage);
    toast.success("أُعيد ضبط منار");
    await restartWithNewData();
  };

  const summary = pending ? summarizeBackup(pending) : null;

  return (
    <Screen>
      <ScreenHeader title="بياناتي" subtitle="كل شيء على جهازك — بلا حساب" backTo="/more" />

      <div className="px-5">
        <div className="glass flex items-start gap-3 rounded-[24px] p-4 shadow-soft">
          <span className="gradient-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-primary-foreground shadow-glow">
            <Icon d={icons.lock} size={20} />
          </span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            منار لا يحتاج حساباً ولا يرسل بياناتك إلى أي خادم. إعداداتك وتقدّمك وعلاماتك محفوظة على
            هذا الجهاز، وتنقلها بنفسك متى شئت.
          </p>
        </div>
      </div>

      {/* ١. الاسم */}
      <SectionLabel>اسمك</SectionLabel>
      <div className="px-5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <label htmlFor="user-name" className="block text-sm font-medium">
            بماذا نناديك؟
          </label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            اختياري، يظهر في التحية ويبقى على جهازك.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              id="user-name"
              value={name}
              maxLength={USER_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dirty) onSaveName();
              }}
              placeholder="اسمك"
              autoComplete="given-name"
              className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={onSaveName}
              disabled={!dirty}
              className="gradient-primary rounded-xl px-4 text-sm font-medium text-primary-foreground shadow-glow disabled:opacity-40 disabled:shadow-none"
            >
              حفظ
            </button>
          </div>
        </div>
      </div>

      {/* ٢. النسخ التلقائي */}
      <SectionLabel>النسخ التلقائي</SectionLabel>
      <div className="px-5">
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
            <Icon d={icons.refresh} size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {native ? "نسخ iCloud الاحتياطي" : "غير متاح في المتصفح"}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {native
                ? "يحفظ iPhone إعدادات منار وتقدّمك ضمن نسخة iCloud الاحتياطية للجوال (أو نسخة الكمبيوتر)، فتعود عند استعادة النسخة على جوال جديد. يعمل إن كان مفعّلاً: الإعدادات ← اسمك ← iCloud ← نسخ iCloud الاحتياطي. ولأن منار يُثبَّت خارج App Store، فملف النسخة الاحتياطية أدناه هو الطريقة الأضمن لنقل بياناتك."
                : "النسخ التلقائي ميزة في تطبيق منار للآيفون. في المتصفح استخدم ملف النسخة الاحتياطية أدناه."}
            </p>
          </div>
        </div>
      </div>

      {/* ٣. ملف النسخة */}
      <SectionLabel>ملف النسخة الاحتياطية</SectionLabel>
      <div className="space-y-2 px-5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            صدّر ملفاً واحداً فيه إعداداتك وتقدّمك وعلاماتك، واحفظه في Drive أو أرسله لنفسك عبر
            واتساب أو تيليجرام. على الجوال الجديد افتح «بياناتي» واستورده.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-secondary/60 px-2 py-2">
              <div className="font-display text-lg tabular-nums">
                {stats ? toArabicDigits(stats.items) : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">الإعدادات والتقدّم المحفوظ</div>
            </div>
            <div className="rounded-xl bg-secondary/60 px-2 py-2">
              <div className="font-display text-lg tabular-nums">
                {stats ? toArabicDigits(stats.bookmarks) : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">علامات المصحف</div>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            {stats?.lastExport
              ? `آخر تصدير: ${arDate(stats.lastExport)}`
              : "لم تصدّر نسخة من هذا الجهاز بعد"}
          </p>
        </div>

        <button
          onClick={() => void onExport()}
          disabled={busy}
          className="gradient-primary flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-medium text-primary-foreground shadow-glow disabled:opacity-60"
        >
          <Icon d={icons.share} size={16} />
          تصدير نسختي
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-sm font-medium shadow-soft disabled:opacity-60"
        >
          <Icon d={icons.download} size={16} />
          استيراد نسخة
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,text/plain,application/octet-stream,.json"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => void onPickFile(e.target.files?.[0])}
        />
      </div>

      {/* ٤. إعادة الضبط */}
      <SectionLabel>إعادة الضبط</SectionLabel>
      <div className="px-5 pb-2">
        <button
          onClick={() => setConfirmReset(true)}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 py-3.5 text-sm font-medium text-destructive disabled:opacity-60"
        >
          <Icon d={icons.trash} size={16} />
          إعادة ضبط التطبيق
        </button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          يمسح اسمك وإعداداتك وتقدّمك من هذا الجهاز ويعيد منار كما ثُبّت أول مرة.
        </p>
      </div>

      <ConfirmSheet
        open={pending != null}
        busy={busy}
        icon={icons.download}
        title="استيراد النسخة الاحتياطية"
        body={
          summary && (
            <>
              {summary.exportedAt ? `نسخة ${arDate(summary.exportedAt)}` : "نسخة بلا تاريخ"} — فيها{" "}
              {countAr(summary.keys, ITEMS_W)}
              {summary.bookmarks ? ` و${countAr(summary.bookmarks, MARKS_W)}` : ""}. كيف نستعيدها؟
            </>
          )
        }
        actions={[
          {
            label: "دمج مع بيانات جهازي",
            hint: "يبقى ما على جهازك، ويُضاف ما ينقصه، وتُضمّ العلامات والسجلّ والإحصائيات",
            onSelect: () => void onImport("merge"),
          },
          {
            label: "استبدال بيانات جهازي",
            hint: "تحلّ النسخة محلّ كل ما على الجهاز — لا يمكن التراجع",
            tone: "danger",
            onSelect: () => void onImport("replace"),
          },
        ]}
        onCancel={() => setPending(null)}
      />

      <ConfirmSheet
        open={confirmReset}
        busy={busy}
        icon={icons.trash}
        title="إعادة ضبط منار؟"
        body="سيُمسح اسمك وكل إعداداتك وتقدّمك وعلاماتك من هذا الجهاز، ولا يمكن التراجع. إن أردت الاحتفاظ بها فصدّر نسخة أولاً."
        actions={[
          {
            label: "تصدير نسخة أولاً",
            tone: "plain",
            onSelect: () => {
              setConfirmReset(false);
              void onExport();
            },
          },
          {
            label: "امسح كل بياناتي",
            tone: "danger",
            onSelect: () => void onReset(),
          },
        ]}
        onCancel={() => setConfirmReset(false)}
      />
    </Screen>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon, icons, Screen, ScreenHeader, SectionLabel, Mark } from "@/components/manar/shell";
import { DeveloperCard } from "@/components/manar/developer-card";
import { toast } from "@/lib/toast";
import { copyText, DEVELOPER, openContact } from "@/lib/developer";
import { IPHONE_DOWNLOAD_URL, PUBLISHED_ON_PLAY, rateApp, shareApp } from "@/lib/app-store";
import { openExternalNative } from "@/lib/native-notifications";
import { BUILD_VERSION, formatAppVersion, readAppVersion } from "@/lib/app-version";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "عن التطبيق — منار" }] }),
  component: About,
});

function About() {
  const version = useAppVersion();
  return (
    <Screen>
      <ScreenHeader title="عن التطبيق" backTo="/more" />

      <div className="px-5">
        <div className="gradient-hero relative overflow-hidden rounded-[28px] p-8 text-center text-white shadow-elegant">
          <div className="pattern-arabesque absolute inset-0 opacity-30" />
          <div className="relative flex flex-col items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/15 backdrop-blur ring-1 ring-white/20 animate-float">
              <Mark size={44} tone="light" />
            </div>
            <h2 className="mt-5 font-display text-4xl font-light">منار</h2>
            <p className="mt-1 text-xs text-white/70">نور يهديك في كل وقت</p>
            {version && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] backdrop-blur">
                الإصدار <span dir="ltr">{version}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <SectionLabel>عن منار</SectionLabel>
      <div className="px-5">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <p className="text-sm font-light leading-loose text-foreground">
            منار تطبيق إسلامي فاخر يجمع لك مواقيت الصلاة، والقرآن الكريم، والأذكار اليومية، واتجاه
            القِبلة في مكان واحد. صُمم بعناية ليكون رفيقك في رحلتك الإيمانية اليومية.
          </p>
        </div>
      </div>

      <div className="mt-6 px-5">
        <DeveloperCard />
      </div>

      <SectionLabel>روابط</SectionLabel>
      <div className="space-y-2 px-5">
        <LinkRow
          icon={icons.mail}
          l="تواصل معنا"
          v={DEVELOPER.email}
          onClick={() => void mail(DEVELOPER.email)}
        />
        {/* يظهر بعد النشر فقط؛ قبله يفتح الرابط صفحة غير موجودة في المتجر. */}
        {PUBLISHED_ON_PLAY && (
          <LinkRow icon={icons.star} l="قيّم التطبيق" v="Google Play" onClick={() => void rate()} />
        )}
        <LinkRow
          icon={icons.download}
          l="آخر إصدار لـ iPhone"
          v="GitHub"
          onClick={() => void openUpdates()}
        />
        <LinkRow icon={icons.share} l="شارك التطبيق" v="" onClick={() => void share()} />
      </div>

      <SectionLabel>قانوني</SectionLabel>
      <div className="space-y-2 px-5">
        <LinkRow icon={icons.lock} l="سياسة الخصوصية" v="" to="/privacy" />
        <LinkRow icon={icons.info} l="شروط الاستخدام" v="" to="/terms" />
        <LinkRow icon={icons.heart} l="المصادر والتراخيص" v="" to="/sources" />
      </div>

      <div className="mt-8 px-5 pb-4 text-center">
        <div className="font-display text-lg text-gold">﷽</div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          صُنع بحب في اليمن · Adamin Idris Zoqri · © Manar 2026
        </p>
      </div>
    </Screen>
  );
}

/**
 * رقم الإصدار: يبدأ بما ضُمِّن وقت البناء (مطابق بين الخادم والعميل فلا خطأ
 * Hydration)، ثم يُستبدل بعد الترطيب بما يعيده النظام على أندرويد مع رقم البناء.
 */
function useAppVersion(): string {
  const [version, setVersion] = useState(BUILD_VERSION);
  useEffect(() => {
    let alive = true;
    void readAppVersion().then((v) => {
      const text = formatAppVersion(v);
      if (alive && text) setVersion(text);
    });
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

async function rate() {
  if (!(await rateApp())) toast.error("تعذّر فتح Google Play على هذا الجهاز");
}

async function openUpdates() {
  const native = await openExternalNative([IPHONE_DOWNLOAD_URL]);
  if (native) return;
  if (native == null && window.open(IPHONE_DOWNLOAD_URL, "_blank", "noopener,noreferrer")) return;
  toast.error("تعذّر فتح صفحة الإصدارات");
}

async function share() {
  const outcome = await shareApp();
  if (outcome === "copied") toast.success("نُسخ رابط منار");
  else if (outcome === "failed") toast.error("تعذّرت المشاركة");
}

/** يفتح تطبيق البريد، وإن لم يوجد يُنسخ العنوان. */
async function mail(address: string) {
  const ok = await openContact("email", address);
  if (!ok) await copyText(address);
}

function LinkRow({
  icon,
  l,
  v,
  to,
  onClick,
}: {
  icon: string;
  l: string;
  v: string;
  to?: string;
  onClick?: () => void;
}) {
  const cls =
    "flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-soft";
  const body = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
        <Icon d={icon} size={16} />
      </span>
      <span className="flex-1 text-right text-sm font-medium">{l}</span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {/* البريد يُعرض كاملاً من اليسار لليمين، ويلتف عند الحاجة بدل أن يُقصّ. */}
        <span className="min-w-0 break-all text-left" dir="ltr">
          {v}
        </span>
        <span className="rotate-180">
          <Icon d={icons.chevron} size={14} />
        </span>
      </span>
    </>
  );
  if (to)
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    );
  return (
    <button className={cls} onClick={onClick}>
      {body}
    </button>
  );
}

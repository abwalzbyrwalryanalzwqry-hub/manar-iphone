import {
  Outlet,
  Link,
  createRootRoute,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useMemo, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AdhanProvider } from "@/components/manar/adhan-provider";
import { WidgetSync } from "@/components/manar/widget-sync";
import { LazyToaster } from "@/components/manar/lazy-toaster";
import { NativeBridge } from "@/components/manar/native-bridge";
import { ReminderTapBridge } from "@/components/manar/reminder-tap-bridge";
import { AudioStopBar } from "@/components/manar/audio-stop-bar";
import { GlobalRecitationBar, RecitationDownloadNotifier } from "@/components/manar/recitation-bar";
import { RecitationPlayerProvider } from "@/hooks/use-recitation-player";
import { hideSplash } from "@/lib/native-shell";
import { StorageGate } from "@/components/manar/storage-gate";
import { DisplayPrefsGate } from "@/components/manar/display-prefs-gate";
import { markAppMounted } from "@/lib/boot-guard";

function NotFoundComponent() {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">٤٠٤</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">الصفحة غير موجودة</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          الصفحة التي تبحث عنها غير موجودة أو نُقلت إلى مكان آخر.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error: raw, reset }: { error: unknown; reset: () => void }) {
  // TanStack Router يمرّر الخطأ بنوع unknown (قد يُرمى أي شيء)؛ نوحّده إلى Error.
  const error = useMemo(() => (raw instanceof Error ? raw : new Error(String(raw))), [raw]);
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    // لا تُترك شاشة البداية الأصلية فوق رسالة الخطأ أبداً.
    void hideSplash();
  }, [error]);

  /* الرسالة المبهمة عدوّة الإصلاح.
   *
   * كانت هذه الشاشة تقول «Something went wrong on our end» بالإنجليزية ولا
   * شيء غير ذلك — فلا المستخدم يفهم، ولا المطوّر يعرف ما وقع. صارت عربية،
   * وتُظهر نصّ الخطأ وأصله. فحين يُصوّر المستخدم الشاشة يكون في الصورة ما
   * يكفي للتشخيص. */
  const detail = [error?.name, error?.message].filter(Boolean).join(": ");
  const stack = (error?.stack ?? "").split("\n").slice(0, 6).join("\n");

  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10"
    >
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          تعذّر عرض هذه الشاشة
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          حدث خطأ غير متوقّع. يمكنك إعادة المحاولة أو الرجوع إلى الرئيسية.
        </p>
        {detail ? (
          <pre
            dir="ltr"
            className="mt-4 max-h-56 overflow-auto rounded-lg bg-muted/60 p-3 text-start text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
          >
            {detail}
            {stack ? `\n\n${stack}` : ""}
          </pre>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            إعادة المحاولة
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            الرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}

const NATIVE_SHELL_BUILD = import.meta.env.VITE_NATIVE_SHELL === "1";
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no",
      },
      { title: "منار — نور يهديك في كل وقت" },
      {
        name: "description",
        content:
          "منار: مواقيت الصلاة والأذان والقرآن الكريم والأذكار والوِرد — يعمل بالكامل دون اتصال بالإنترنت.",
      },
      { name: "author", content: "منار" },
      { name: "theme-color", content: "#0B1F1A" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { property: "og:title", content: "منار — نور يهديك في كل وقت" },
      {
        property: "og:description",
        content: "مواقيت الصلاة، الأذان، القرآن الكريم، الأذكار والوِرد في تطبيق واحد.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Self-hosted Quran fonts — bundled locally so the Mushaf renders offline.
      { rel: "stylesheet", href: "/fonts/quran-fonts.css" },
      // Self-hosted interface font — bundled locally for the same reason.
      { rel: "stylesheet", href: "/fonts/ui-fonts.css" },
      // خط ثمانية الرسمي — الخط الأساسي للواجهة، مُضمَّن داخل التطبيق.
      { rel: "stylesheet", href: "/fonts/thmanyah-fonts.css" },
      /* أيقونات منار — مُولَّدة بـ scripts/build-icon.py.
       * المتّجه أولاً ليستعمله المتصفح القادر عليه بأي دقّة، والنقطية تليه
       * للمتصفحات التي لا تقرأ SVG في هذا الموضع. */
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      /* أيقونات التثبيت على الويب (PWA وiOS) لا معنى لها داخل تطبيق أندرويد:
       * الويب فيو لا يقرأ ملف الـ manifest ولا apple-touch-icon، وأيقونة التطبيق
       * هي أيقونة النظام. تُحذف ملفاتها من حزمة أندرويد
       * (scripts/prepare-android-webdir.mjs) فلا تُذكر هنا كذلك. */
      ...(NATIVE_SHELL_BUILD
        ? []
        : [
            { rel: "icon", href: "/favicon.png", type: "image/png", sizes: "64x64" },
            { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
            { rel: "manifest", href: "/manifest.webmanifest" },
          ]),
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/* يُنفَّذ قبل أول رسم فلا يومض التطبيق بالمظهر الخاطئ عند الإقلاع.
 * مضمّن كنص لأنه يجب أن يسبق تحميل حزمة React كاملةً. */
const APPEARANCE_BOOTSTRAP = `(function(){try{
var s=JSON.parse(localStorage.getItem("manar.appearance.v1")||"{}");
var t=s.theme||"system";
var dark=t==="dark"||(t==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var r=document.documentElement;
if(dark){r.classList.add("dark");r.style.colorScheme="dark";}
var m={small:0.9,medium:1,large:1.12,xlarge:1.25};
r.style.setProperty("--manar-font-scale",String(m[s.fontScale]||1));
}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    /* suppressHydrationWarning لأن نص الإقلاع أعلاه يضيف صنف `dark` ومتغيّر
       حجم الخط إلى <html> قبل الترطيب، فتختلف سمات العنصر عمّا رسمه الخادم.
       هذا هو النمط القياسي لتطبيق المظهر بلا وميض. */
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  // يُعلن لدرع الإقلاع أن الحزمة عملت فعلاً (لا يكفي وجود HTML المبني مسبقاً).
  useEffect(() => {
    markAppMounted();
  }, []);

  return (
    <>
      {/* تُستعاد حالة المستخدم من الطبقة الأصلية قبل تركيب أي مزوّد يقرأ التخزين. */}
      <StorageGate>
        <AdhanProvider />
        <WidgetSync />
        <NativeBridge />
        <ReminderTapBridge />
        <AudioStopBar />
        <LazyToaster />
        <RecitationPlayerProvider>
          <DisplayPrefsGate>
            <Outlet />
          </DisplayPrefsGate>
          <GlobalRecitationBar />
          <RecitationDownloadNotifier />
        </RecitationPlayerProvider>
      </StorageGate>
    </>
  );
}

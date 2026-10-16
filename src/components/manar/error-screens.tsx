// منار — شاشتا الخطأ و«غير موجود» بالعربية.
//
// كانتا داخل __root.tsx فقط، فكان أي فشل في مسار فرعي يعرض نص TanStack
// الإنجليزي الافتراضي ("Not Found" / "This page didn't load") — وهو النص نفسه
// الذي ظهر على أندرويد وأوهمنا بأنه صفحة خطأ WebView. الآن الملف واحد ويُسجَّل
// كافتراضي للراوتر كله في src/router.tsx. مصدرها فرع android-release-prep.
import { useEffect, useMemo } from "react";
import { Link, useRouter } from "@tanstack/react-router";

export function ManarNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">الصفحة غير موجودة</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            العودة للرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ManarRouteError({ error: raw, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter();
  // TanStack Router يمرّر الخطأ بنوع unknown (قد يُرمى أي شيء)؛ نوحّده إلى Error.
  const error = useMemo(() => (raw instanceof Error ? raw : new Error(String(raw))), [raw]);

  // logcat هو المكان الوحيد الذي يُقرأ فيه خطأ وقع على جهاز المستخدم.
  useEffect(() => {
    console.error("MANAR_ROUTE_ERROR", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          تعذّر عرض هذه الصفحة
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          حدث خطأ غير متوقع. جرّب إعادة المحاولة، وإن تكرّر الأمر أرسل التفاصيل التالية للمطوّر.
        </p>
        {/* التفاصيل ظاهرة بقصد: خطأ يظهر على الجهاز فقط لا يمكن تشخيصه برسالة عامة. */}
        <pre
          dir="ltr"
          className="mt-4 max-h-48 select-text overflow-auto rounded-xl border border-border bg-muted/40 p-3 text-start text-[11px] leading-relaxed text-muted-foreground"
        >
          {`${error?.name ?? "Error"}: ${error?.message ?? String(error)}`}
          {error?.stack ? `\n\n${error.stack.split("\n").slice(0, 6).join("\n")}` : ""}
        </pre>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset?.();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            إعادة المحاولة
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            العودة للرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}

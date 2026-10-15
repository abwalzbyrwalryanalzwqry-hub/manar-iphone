/**
 * منار ايفون — prepares dist/client so it is a valid Capacitor `webDir` for iOS.
 *
 * The TanStack Start SPA build emits `_shell.html` (the client shell) plus one
 * prerendered directory per route. Capacitor's WKWebView loads `index.html` from
 * the root of `webDir`, so the shell is copied there and the client router
 * takes over from the first paint. Without this step the app opens on a blank
 * white screen.
 */
import {
  copyFileSync,
  existsSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { BOOT_GUARD } from "./boot-guard.mjs";

const root = resolve(import.meta.dirname, "..");
const clientDir = resolve(root, "dist/client");
const shell = resolve(clientDir, "_shell.html");
const index = resolve(clientDir, "index.html");

if (!existsSync(shell)) {
  console.error(
    "[manar] dist/client/_shell.html is missing — run `vite build --config vite.config.capacitor.ts` first.",
  );
  process.exit(1);
}

copyFileSync(shell, index);

// The native shell never talks to a server: drop the SSR bundle so it cannot be
// shipped inside the IPA by accident.
rmSync(resolve(root, "dist/server"), { recursive: true, force: true });
rmSync(resolve(clientDir, "_headers"), { force: true });

// Capacitor iOS serves from capacitor://localhost — make sure nothing points at a host.
/* درع الإقلاع (ترقيع Object.hasOwn + سجلّ أخطاء مبكّر + كشف WebView القديم + مهلة
 * تركيب React) — انظر scripts/boot-guard.mjs. */

const html = readFileSync(index, "utf8");
if (/https?:\/\/(?!localhost)/.test(html.replace(/https?:\/\/www\.w3\.org/g, ""))) {
  console.warn("[manar] warning: index.html references an external origin.");
}
writeFileSync(index, html.replace("</head>", `${BOOT_GUARD}</head>`));

/* الصوت يُشحن مرّة واحدة لا مرّتين.
 *
 * التسجيلات تُنسخ إلى حزمة iOS الأصلية (scripts/sync-ios-audio.mjs: ManarAudio
 * للتشغيل الكامل، وManarSounds مقاطع الإشعار ≤ ٣٠ث). ولو بقيت
 * نسخةٌ ثانية منها في أصول الويب لتضاعف حجم الحزمة ١٦ ميجابايت بلا فائدة:
 * الطبقة الأصلية لا تقرأ من أصول الويب أصلاً، والمعاينة داخل التطبيق تمرّ
 * بالمُشغّل الأصلي (`src/lib/audio-engine.ts`) لا بعنصر <audio>.
 *
 * تبقى النسخة في `public/audio` كما هي لبناء الويب. */
const audioDir = resolve(clientDir, "audio");
if (existsSync(audioDir)) {
  let freed = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) walk(full);
      else freed += statSync(full).size;
    }
  };
  walk(audioDir);
  rmSync(audioDir, { recursive: true, force: true });
  console.log(
    `[manar] dropped duplicated web audio (${(freed / 1048576).toFixed(1)} MB) — ManarAudio is the single source`,
  );
}

/* أيقونات تثبيت الويب (PWA وiOS) وملف manifest لا تُقرأ داخل الويب فيو، وقشرة
 * التطبيق الأصلية لا تذكرها في <head> أصلاً (انظر `src/routes/__root.tsx`). أيقونة
 * التطبيق الفعلية في `ios/App/App/Assets.xcassets/AppIcon.appiconset`. تبقى الملفات كما هي في بناء الويب. */
const webOnly = [
  "icon-512.png",
  "icon-192.png",
  "apple-touch-icon.png",
  "favicon.png",
  "manifest.webmanifest",
];
let webOnlyFreed = 0;
for (const name of webOnly) {
  const full = resolve(clientDir, name);
  if (!existsSync(full)) continue;
  webOnlyFreed += statSync(full).size;
  rmSync(full, { force: true });
}
if (webOnlyFreed > 0) {
  console.log(
    `[manar] dropped web-install icons (${(webOnlyFreed / 1024).toFixed(0)} KB) — not used by the WebView`,
  );
}

console.log("[manar] dist/client/index.html ready for `cap sync ios`.");

/* Manar — native shell integration (Android)
 * -----------------------------------------------------------------
 * Everything the Capacitor WebView needs that the web app cannot do on its own:
 * hardware back button, status-bar styling, splash hand-off, and the one-time
 * reliability prompts (exact alarms + battery exemption) that decide whether the
 * Adhan actually fires while the app is closed.
 *
 * ROOT CAUSE OF THE 2026-09 START-UP CRASH — read before refactoring
 * -----------------------------------------------------------------
 * This module used to reach plugins through the raw runtime bridge
 * (`window.Capacitor.Plugins.App`). That object is NOT the typed JS wrapper: on
 * Android it is generated natively by `JSExport.getPluginJS()`, which emits
 *
 *     t.addListener = function (eventName, callback) {
 *       return w.Capacitor.addListener('App', eventName, callback);
 *     }
 *
 * and `Capacitor.addListener` (native-bridge.js) returns a PLAIN, SYNCHRONOUS
 * `{ remove }` object. The documented plugin API returns
 * `Promise<PluginListenerHandle>`, so `addListener(...).then(...)` threw
 *   TypeError: r.addListener(...).then is not a function
 * inside the first start-up effect, the React tree unmounted into the error
 * boundary, and the splash never handed off.
 *
 * The supported API is the JS wrapper created by `registerPlugin()`
 * (`@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`, …):
 * its `addListener` always resolves through a Promise on web AND on native.
 * Those packages are already direct dependencies, so importing them adds no new
 * dependency — only the correct entry point. Do not go back to
 * `window.Capacitor.Plugins`.
 */

import { isIOSApp } from "@/lib/ios";
import { Capacitor } from "@capacitor/core";
import { App, type BackButtonListenerEvent } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

/** True only inside the native shell (Android/iOS), false in any browser. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Routes where pressing back should ask to exit instead of navigating away. */
const ROOT_PATHS = new Set(["/", "/home", "/prayer", "/quran", "/azkar", "/more", "/onboarding"]);

let backHandlerAttached = false;

/** معترضات زر الرجوع (الأحدث أولاً): تعيد true إن استهلكت الضغطة، كالخروج من ملء الشاشة. */
const backInterceptors: (() => boolean)[] = [];

export function addBackInterceptor(fn: () => boolean): () => void {
  backInterceptors.push(fn);
  return () => {
    const i = backInterceptors.lastIndexOf(fn);
    if (i >= 0) backInterceptors.splice(i, 1);
  };
}

/** وضع القراءة الغامر: إخفاء شريط الحالة في أندرويد، وملء الشاشة في المتصفح. */
export async function setImmersiveChrome(on: boolean): Promise<void> {
  try {
    if (isNativeApp()) {
      if (on) await StatusBar.hide();
      else await StatusBar.show();
      return;
    }
    if (typeof document === "undefined") return;
    if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } else if (!on && document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (error) {
    // تجميلي: قد يرفضه المتصفح (بلا تفاعل مستخدم مثلاً) ويبقى العرض الغامر داخل الصفحة.
    console.warn("[manar] immersive chrome unavailable", error);
  }
}

/**
 * Hardware back button.
 *
 * Without this listener Capacitor closes the Activity on every back press, from
 * any screen — the single most jarring bug in a wrapped web app. Behaviour now:
 * inner screens go back in history; tab roots require a second press within two
 * seconds to leave the app (with an Arabic hint in between).
 */
export function setupBackButton(onHint: (message: string) => void): () => void {
  if (!isNativeApp() || backHandlerAttached) return () => {};
  backHandlerAttached = true;

  let exitArmed = false;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let removeListener: (() => Promise<void>) | null = null;
  let cancelled = false;

  const onBack = (event: BackButtonListenerEvent) => {
    for (let i = backInterceptors.length - 1; i >= 0; i--) {
      if (backInterceptors[i]()) return;
    }
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const atRoot = ROOT_PATHS.has(path) || !event.canGoBack;

    if (!atRoot) {
      window.history.back();
      return;
    }

    if (exitArmed) {
      void App.exitApp();
      return;
    }

    exitArmed = true;
    onHint("اضغط مرة أخرى للخروج من منار");
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      exitArmed = false;
    }, 2000);
  };

  // `App.addListener` resolves to a PluginListenerHandle. Failures are reported
  // (never silently swallowed) so a real plugin problem stays visible in logcat,
  // but they must not take the whole UI down with them.
  App.addListener("backButton", onBack).then(
    (handle) => {
      if (cancelled) {
        void handle.remove();
        return;
      }
      removeListener = () => handle.remove();
    },
    (error: unknown) => {
      console.error("[manar] failed to attach backButton listener", error);
    },
  );

  return () => {
    cancelled = true;
    if (armTimer) clearTimeout(armTimer);
    backHandlerAttached = false;
    void removeListener?.().catch((error: unknown) => {
      console.error("[manar] failed to remove backButton listener", error);
    });
  };
}

/** Matches the status bar to the app's current light/dark surface. */
export async function applyStatusBar(dark: boolean): Promise<void> {
  if (!isNativeApp()) return;
  const surface = dark ? "#0B1117" : "#F8F9FA";
  if (isIOSApp()) {
    /* iOS: لا setOverlaysWebView ولا setBackgroundColor (أندرويد فقط — كانت
     * ترمي فيسقط setStyle بعدها). الواجهة داخل المنطقة الآمنة، وما حولها
     * (خلف شريط الحالة ومؤشّر الرئيسية) يُلوَّن أصلياً بلون السطح نفسه. */
    try {
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    } catch (error) {
      console.warn("[manar] status bar style unavailable", error);
    }
    try {
      const { manarAdhanPlugin } = await import("@/lib/native-notifications");
      await manarAdhanPlugin()?.setSystemBars?.({ color: surface });
    } catch (error) {
      console.warn("[manar] system bars color unavailable", error);
    }
    return;
  }
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: surface });
  } catch (error) {
    // Status-bar styling is cosmetic — log it, never block start-up on it.
    console.warn("[manar] status bar styling unavailable", error);
  }
}

/**
 * Hides the splash screen once the first real screen is painted, avoiding a
 * white flash. `capacitor.config.ts` also sets `launchAutoHide` as a native-side
 * safety net so a JS failure can never leave the splash up forever.
 */
export async function hideSplash(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch (error) {
    console.warn("[manar] splash hide failed", error);
  }
}

/** Runs `cb` whenever the app returns to the foreground. */
export function onResume(cb: () => void): () => void {
  if (!isNativeApp()) return () => {};

  let removeListener: (() => Promise<void>) | null = null;
  let cancelled = false;

  App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) cb();
  }).then(
    (handle) => {
      if (cancelled) {
        void handle.remove();
        return;
      }
      removeListener = () => handle.remove();
    },
    (error: unknown) => {
      console.error("[manar] failed to attach appStateChange listener", error);
    },
  );

  return () => {
    cancelled = true;
    void removeListener?.().catch((error: unknown) => {
      console.error("[manar] failed to remove appStateChange listener", error);
    });
  };
}

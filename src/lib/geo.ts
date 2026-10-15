/**
 * منار — تحديد الموقع بواجهة واحدة.
 *
 * في تطبيق iPhone نستعمل إضافة Capacitor الأصلية (CoreLocation) لا
 * `navigator.geolocation`: الأخيرة داخل WKWebView تسأل المستخدم مرتين (إذن
 * التطبيق ثم «‏localhost يريد موقعك») وتعيد السؤال في كل تشغيل. الشكل المُعاد
 * يطابق `GeolocationPosition` ورموز `GeolocationPositionError` (١ رفض، ٢ تعذّر،
 * ٣ مهلة) فلا يتغيّر شيء في المستدعي.
 */
import { isIOSApp } from "@/lib/ios";

export type GeoCoords = { coords: { latitude: number; longitude: number; accuracy?: number } };
export type GeoError = { code: number; message?: string };

export function geolocationAvailable(): boolean {
  if (isIOSApp()) return true;
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

export function getCurrentPositionCompat(
  onOk: (pos: GeoCoords) => void,
  onErr: (err: GeoError) => void,
  options: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
): void {
  if (!isIOSApp()) {
    navigator.geolocation.getCurrentPosition(onOk, onErr, options);
    return;
  }
  void (async () => {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      let perm = await Geolocation.checkPermissions().catch(() => null);
      if (!perm || perm.location === "prompt" || perm.location === "prompt-with-rationale") {
        perm = await Geolocation.requestPermissions({ permissions: ["location"] }).catch(
          () => null,
        );
      }
      if (perm && perm.location === "denied") {
        onErr({ code: 1, message: "denied" });
        return;
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 12_000,
        maximumAge: options.maximumAge ?? 0,
      });
      onOk({
        coords: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        },
      });
    } catch (e) {
      const msg = String((e as { message?: unknown })?.message ?? e).toLowerCase();
      const code = /denied|permission|not authorized|restricted/.test(msg)
        ? 1
        : /time ?out/.test(msg)
          ? 3
          : 2;
      onErr({ code, message: msg });
    }
  })();
}

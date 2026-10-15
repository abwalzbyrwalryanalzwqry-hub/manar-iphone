/**
 * منار ايفون — حرّاس الطبقة الأصلية في iOS.
 *
 * لا يمكن تشغيل Swift هنا؛ فنحرس العقود التي إن انكسرت تعطّل التطبيق صامتاً:
 * أسماء دوال الإضافة، أصوات الإشعارات، مفاتيح Info.plist، ومجموعة التطبيقات.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { foldLocalNotification, iosNotificationSound, rawForChannel } from "@/lib/ios";
import { isNotificationRoute } from "@/lib/native-notifications";
import { SILENCE_REASONS } from "@/lib/notification-text";
import { normalizeSettings, type LocationState, type Settings } from "@/lib/prayer";
import { buildWidgetSnapshot } from "@/lib/widget-snapshot";
import { normalizeWidgetOptions } from "@/lib/widget-settings";
import { fromHijri } from "@/lib/hijri";
import {
  IOS_AUDIO_EXT,
  IOS_AUDIO_SOURCES,
  rawResourceName,
} from "../../scripts/ios-audio-sources.mjs";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const swift = (n: string) => read(`ios/App/App/Manar/${n}.swift`);

describe("إضافة ManarAdhan: كل دالة يستدعيها JS موجودة في Swift", () => {
  const ts = read("src/lib/native-notifications.ts");
  const typeBody = ts.slice(ts.indexOf("type ManarAdhanPlugin = {"));
  const tsMethods = new Set(
    [
      ...typeBody
        .slice(0, typeBody.indexOf("\n};"))
        .matchAll(/^ {2}([a-zA-Z]+)\??: (?:<[^>]*>)?\(/gm),
    ]
      .map((m) => m[1])
      .filter((m) => m !== "addListener"),
  );
  const plugin = swift("ManarAdhanPlugin");
  const declared = new Set(
    [...plugin.matchAll(/CAPPluginMethod\(name: "([a-zA-Z]+)"/g)].map((m) => m[1]),
  );
  const implemented = new Set(
    [...plugin.matchAll(/@objc func ([a-zA-Z]+)\(_ call: CAPPluginCall\)/g)].map((m) => m[1]),
  );

  it("قائمة الدوال غير فارغة", () => {
    expect(tsMethods.size).toBeGreaterThan(25);
  });
  it("كل دالة في النوع مُعلَنة ومُنفَّذة", () => {
    for (const m of tsMethods) {
      expect(declared.has(m), `مُعلنة: ${m}`).toBe(true);
      expect(implemented.has(m), `مُنفّذة: ${m}`).toBe(true);
    }
  });
  it("كل دالة مُعلنة لها تنفيذ (وإلا انهار الجسر عند الاستدعاء)", () => {
    for (const m of declared) expect(implemented.has(m), m).toBe(true);
  });
  it("اسم الإضافة في JS وSwift واحد، وتُسجَّل في وحدة التحكم", () => {
    expect(plugin).toContain('jsName = "ManarAdhan"');
    expect(ts).toContain('registerPlugin<ManarAdhanPlugin>("ManarAdhan")');
    expect(swift("ManarViewControllers")).toContain("registerPluginInstance(ManarAdhanPlugin())");
  });
  it("الأحداث التي يستمع لها JS يُطلقها Swift", () => {
    for (const ev of ["manarAudioState", "manarOpenRoute", "manarPrayed"]) {
      expect(plugin, ev).toContain(`"${ev}"`);
    }
  });
});

describe("أصوات الإشعارات (CAF)", () => {
  const dir = resolve(root, "ios/App/App/ManarSounds");
  const cafs = new Set(readdirSync(dir).filter((f) => f.endsWith(".caf")));

  it("لكل ملف صوتي يجدوله منار مقطع CAF", () => {
    let n = 0;
    for (const src of IOS_AUDIO_SOURCES as string[]) {
      const full = resolve(root, src);
      if (!existsSync(full)) continue;
      for (const f of readdirSync(full).filter((x) => IOS_AUDIO_EXT.test(x))) {
        expect(cafs.has(`${rawResourceName(f)}.caf`), `${src}/${f}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });
  it("المقاطع ≤ ٣٠ ثانية تقديراً من الحجم (IMA4 ‏٣٢ كيلوهرتز أحادي ≈ ١٦ ك.ب/ث)", () => {
    for (const f of cafs) {
      const size = readFileSync(resolve(dir, f)).length;
      expect(size, f).toBeLessThan(32000 * 0.5625 * 31);
    }
  });
  it("مرآة rawForChannel في Swift وTS", () => {
    const s = swift("ManarSounds");
    for (const p of [
      "manar_azkar_",
      "manar_approach_",
      "manar_season_",
      "manar_reminders_v",
      "manar_silent",
      "_nv",
    ]) {
      expect(s, p).toContain(p);
    }
    expect(rawForChannel("manar_azkar_azkar_morning_nv")).toBe("azkar_morning");
    expect(rawForChannel("manar_silent")).toBe("");
    expect(rawForChannel("manar_reminders")).toBe("segment_takbir");
    expect(rawForChannel("manar_reminders_v40")).toBe("segment_takbir_v40");
    expect(rawForChannel("other")).toBeUndefined();
  });
  it("صوت LocalNotifications على iOS اسم ملف CAF أو صامت", () => {
    expect(iosNotificationSound("manar_silent", "x.mp3")).toBeUndefined();
    expect(iosNotificationSound(undefined, "approach_asr.mp3")).toBe("approach_asr.caf");
    expect(iosNotificationSound(undefined, undefined)).toBe("default");
  });
});

describe("طيّ تنبيهات LocalNotifications في الجدول الأصلي", () => {
  it("عنصر سليم يصير حدثاً بموعده ومساره", () => {
    const at = new Date(Date.UTC(2026, 9, 16, 9));
    const e = foldLocalNotification({
      id: 7,
      title: "الجمعة",
      body: "الكهف",
      schedule: { at },
      extra: { route: "/quran", kind: "jumuah" },
    });
    expect(e).toMatchObject({
      id: 7,
      at: at.getTime(),
      key: "jumuah_7",
      meta: { route: "/quran" },
    });
  });
  it("بلا معرّف أو موعد: يُهمل ولا يكسر الجدول", () => {
    expect(foldLocalNotification({ title: "x" })).toBeNull();
    expect(foldLocalNotification(null)).toBeNull();
    expect(foldLocalNotification({ id: 1, schedule: { at: "bad" } })).toBeNull();
  });
});

describe("Info.plist والصلاحيات", () => {
  const plist = read("ios/App/App/Info.plist");
  it("أوصاف الأذونات موجودة (غيابها يُسقط التطبيق عند الطلب)", () => {
    for (const k of ["NSLocationWhenInUseUsageDescription", "NSPhotoLibraryAddUsageDescription"]) {
      expect(plist, k).toContain(`<key>${k}</key>`);
    }
  });
  it("الخلفية: الصوت وتحديث الجدول، ومعرّف المهمّة نفسه في AppDelegate", () => {
    expect(plist).toContain("<string>audio</string>");
    expect(plist).toContain("<string>fetch</string>");
    expect(plist).toContain("app.manar.islamic.refresh");
    expect(read("ios/App/App/AppDelegate.swift")).toContain("app.manar.islamic.refresh");
  });
  it("رابط manar:// مُسجَّل", () => {
    expect(plist).toMatch(/CFBundleURLSchemes[\s\S]*<string>manar<\/string>/);
  });
  it("مجموعة التطبيقات نفسها في التطبيق والويدجت والكود", () => {
    const g = "group.app.manar.islamic";
    expect(read("ios/App/App/App.entitlements")).toContain(g);
    expect(read("ios/App/ManarWidget/ManarWidget.entitlements")).toContain(g);
    expect(read("ios/App/ManarWidget/ManarWidget.swift")).toContain(g);
  });
  it("مفتاح لقطة الويدجت واحد بين التطبيق والويدجت", () => {
    const key = "manar.widget.snapshot.v1";
    expect(read("ios/App/ManarWidget/ManarWidget.swift")).toContain(key);
    expect(swift("ManarAdhanPlugin") + swift("ManarStore")).toContain(key);
  });
});

describe("حدود iOS في المجدول", () => {
  const s = swift("ManarScheduler");
  it("سقف ٦٤ إشعاراً معلّقاً محترم مع احتياطي التجديد", () => {
    expect(s).toMatch(/64/);
    expect(s).toContain("manar.renew");
  });
});

describe("ما كانت تحرسه اختبارات أندرويد — بنسخته في iOS", () => {
  const calc: Settings = {
    method: "UmmAlQura",
    madhab: "shafi",
    offsets: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
    dstOffset: 0,
  };
  const loc: LocationState = { lat: 15.3694, lng: 44.191, city: "صنعاء", source: "manual" };
  const widget = read("ios/App/ManarWidget/ManarWidget.swift");

  it("الويدجت: تاريخ الغد الهجري من مغرب اليوم", () => {
    const from = new Date(2026, 8, 28, 12);
    const on = buildWidgetSnapshot({ location: loc, settings: calc, from, hijriAtMaghrib: true });
    const off = buildWidgetSnapshot({ location: loc, settings: calc, from });
    expect(off.days[0].hijriEvening).toBeUndefined();
    expect(on.days[0].hijriEvening).toBe(off.days[1].hijri);
    expect(widget).toContain("hijriEvening");
    expect(widget).toContain("hijriFrom");
  });

  it("الويدجت يعرض سطر الموسم ويحترم إطفاءه", () => {
    const snap = buildWidgetSnapshot({
      location: loc,
      settings: normalizeSettings({}),
      from: fromHijri({ year: 1447, month: 9, day: 12 }),
      days: 2,
    });
    expect(snap.days[0].season).toMatch(/^اليوم ١٢ من رمضان · الإفطار /);
    expect(normalizeWidgetOptions({}).season).toBe(true);
    expect(widget).toMatch(/season \?\? true/);
  });

  it("مسار الإشعار داخلي فقط — في JS وSwift", () => {
    expect(isNotificationRoute("/prayer")).toBe(true);
    for (const bad of ["https://x.y", "//evil", "javascript:alert(1)", 5, ""]) {
      expect(isNotificationRoute(bad)).toBe(false);
    }
    const notify = swift("ManarNotify");
    expect(notify).toContain('!r.hasPrefix("//")');
    expect(notify).toContain('!r.contains(":")');
  });

  it("الأذان المكتوم في «سكينة» يذكر سببه بنصّ SILENCE_REASONS", () => {
    expect(swift("ManarScheduler")).toContain(`"${SILENCE_REASONS.sakinah}"`);
  });

  it("زرّ إعدادات التاريخ والوقت موجود في iOS (يفتح إعدادات منار)", () => {
    expect(swift("ManarAdhanPlugin")).toMatch(/func openDateSettings\(_ call: CAPPluginCall\)/);
  });
});

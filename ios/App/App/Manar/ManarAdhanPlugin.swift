import Capacitor
import Foundation
import UIKit
import UserNotifications
import WidgetKit

/// منار — الإضافة الأصلية `ManarAdhan` لـiOS.
///
/// الواجهة نفسها التي تستدعيها طبقة الويب على أندرويد (`ManarAdhanPlugin.java`)،
/// بالأسماء والأشكال نفسها، فلا تحتاج JavaScript إلى فرعٍ خاص إلا حيث يختلف
/// النظام فعلاً. ما لا يوجد في iOS (المنبّهات الدقيقة، توفير البطارية، مستوى
/// صوت المنبّه، «عدم الإزعاج») يُعاد بقيمة صادقة تُخفي بطاقته من الواجهة.
@objc(ManarAdhanPlugin)
public class ManarAdhanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ManarAdhanPlugin"
    public let jsName = "ManarAdhan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolumes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alarmVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAlarmVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "widgetStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pinWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestExactAlarmPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestIgnoreBatteryOptimizations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNotificationSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openDateSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alertLog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAlertLog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "channelStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testAlarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePrayed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "muteAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "audioState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahSchedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahCancelAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahStopNow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahSkip", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahLog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahClearSkips", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahRequestPolicyAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sakinahOpenPolicyAccessSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSystemBars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iosInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iosEnsureCategories", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        ManarNotify.shared.plugin = self
        ManarPlayer.shared.onState = { [weak self] data in
            self?.notifyListeners("manarAudioState", data: data)
        }
        if let r = ManarNotify.shared.takePendingRoute() {
            emitRoute(r)
        }
    }

    // MARK: أحداث إلى JavaScript

    func emitRoute(_ route: String) {
        // يُحتفظ بالحدث حتى يسجّل الويب مستمعه (فتح من الإغلاق).
        notifyListeners("manarOpenRoute", data: ["route": route], retainUntilConsumed: true)
    }

    func emitPrayed(prayer: String, day: String) {
        notifyListeners("manarPrayed", data: ["prayer": prayer, "day": day])
    }

    // MARK: الجدولة

    @objc func schedule(_ call: CAPPluginCall) {
        let raw = call.getArray("events", JSObject.self) ?? []
        let events: [[String: Any]] = raw.map { obj in
            var d: [String: Any] = [:]
            for (k, v) in obj { d[k] = v }
            return ManarStore.sanitize(d)
        }
        ManarScheduler.storeEvents(events)
        ManarScheduler.rearm(reason: "schedule") { armed in
            call.resolve(["scheduled": armed, "exactAlarms": true, "stored": events.count])
        }
    }

    @objc func cancelAll(_ call: CAPPluginCall) {
        ManarScheduler.cancelAll()
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            ManarPlayer.shared.stop()
            call.resolve()
        }
    }

    @objc func preview(_ call: CAPPluginCall) {
        let sound = call.getString("sound") ?? ""
        let volume = call.getDouble("volume")
        let title = call.getString("title") ?? ""
        DispatchQueue.main.async {
            let ok = ManarPlayer.shared.play(raw: sound, volume: volume, kind: "preview", title: title, key: "preview")
            if ok {
                call.resolve(["ok": true])
            } else {
                call.reject("sound_not_found")
            }
        }
    }

    @objc func setVolumes(_ call: CAPPluginCall) {
        ManarVolumes.save([
            "master": call.getDouble("master") ?? 1,
            "adhan": call.getDouble("adhan") ?? 1,
            "iqama": call.getDouble("iqama") ?? 1,
            "reminder": call.getDouble("reminder") ?? 1,
        ])
        call.resolve()
    }

    /// iOS لا يتيح قراءة مستوى صوت المنبّه ولا ضبطه: max = 0 يُخفي بطاقته.
    @objc func alarmVolume(_ call: CAPPluginCall) {
        call.resolve(["level": 0, "max": 0, "percent": 0])
    }

    @objc func setAlarmVolume(_ call: CAPPluginCall) {
        call.resolve(["ok": false, "percent": 0])
    }

    @objc func muteAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            _ = ManarPlayer.shared.mute()
            call.resolve()
        }
    }

    @objc func audioState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(ManarPlayer.shared.state())
        }
    }

    // MARK: الحالة والتشخيص

    @objc func status(_ call: CAPPluginCall) {
        ManarScheduler.status { call.resolve($0) }
    }

    @objc func channelStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let allowed = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
            // iOS بلا «قنوات»: نعرض ما يقابلها من إعدادات النظام لمنار.
            var channels: [[String: Any]] = [
                ["id": "ios_alerts", "name": "التنبيهات", "importance": allowed ? 4 : 0, "blocked": !allowed || s.alertSetting == .disabled],
                ["id": "ios_sounds", "name": "الأصوات", "importance": 3, "blocked": s.soundSetting != .enabled],
                ["id": "ios_lockscreen", "name": "شاشة القفل", "importance": 3, "blocked": s.lockScreenSetting == .disabled],
            ]
            if #available(iOS 15.0, *) {
                channels.append(["id": "ios_time_sensitive", "name": "التنبيهات الحسّاسة للوقت", "importance": 4,
                                 "blocked": s.timeSensitiveSetting == .disabled])
            }
            call.resolve(["notificationsAllowed": allowed, "channels": channels])
        }
    }

    @objc func alertLog(_ call: CAPPluginCall) {
        ManarScheduler.reconcileDelivered()
        // مهلة قصيرة ليُكمل التسجيل مما سلّمه النظام قبل القراءة.
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.35) {
            call.resolve(["events": ManarStore.readArray(ManarStore.Key.log)])
        }
    }

    @objc func clearAlertLog(_ call: CAPPluginCall) {
        ManarStore.defaults.removeObject(forKey: ManarStore.Key.log)
        call.resolve()
    }

    @objc func testAlarm(_ call: CAPPluginCall) {
        let sound = call.getString("sound") ?? ""
        let title = call.getString("title") ?? "تجربة الأذان"
        let body = call.getString("body") ?? "هكذا يصل الأذان والتطبيق مغلق."
        let seconds = call.getInt("seconds") ?? 60
        let priority = call.getBool("priority") ?? true
        let r = ManarScheduler.test(sound: sound, title: title, body: body, seconds: seconds, priority: priority)
        ManarStore.log("test_scheduled", key: r.key, kind: "adhan", detail: "exact")
        call.resolve(["scheduled": true, "key": r.key, "at": r.at, "exact": true, "mode": "exact"])
    }

    @objc func takePrayed(_ call: CAPPluginCall) {
        call.resolve(["items": ManarStore.takePrayed()])
    }

    // MARK: ما لا مقابل له في iOS

    @objc func requestExactAlarmPermission(_ call: CAPPluginCall) {
        call.resolve(["granted": true, "opened": false])
    }

    @objc func requestIgnoreBatteryOptimizations(_ call: CAPPluginCall) {
        call.resolve(["granted": true, "opened": false])
    }

    @objc func openNotificationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var target = UIApplication.openSettingsURLString
            if #available(iOS 16.0, *) { target = UIApplication.openNotificationSettingsURLString }
            if let url = URL(string: target) {
                UIApplication.shared.open(url, options: [:]) { _ in call.resolve() }
            } else {
                call.resolve()
            }
        }
    }

    /// لا رابط عامّاً لشاشة «التاريخ والوقت» في iOS؛ نفتح إعدادات منار وتشرح الواجهة الباقي.
    @objc func openDateSettings(_ call: CAPPluginCall) {
        call.resolve(["opened": false])
    }

    @objc func openExternal(_ call: CAPPluginCall) {
        let urls = (call.getArray("urls", String.self) ?? []).compactMap { URL(string: $0) }
        DispatchQueue.main.async {
            Self.openFirst(urls) { url in
                if let u = url {
                    call.resolve(["opened": true, "url": u.absoluteString])
                } else {
                    call.resolve(["opened": false])
                }
            }
        }
    }

    private static func openFirst(_ urls: [URL], done: @escaping (URL?) -> Void) {
        guard let first = urls.first else { done(nil); return }
        let rest = Array(urls.dropFirst())
        UIApplication.shared.open(first, options: [:]) { ok in
            if ok { done(first) } else { openFirst(rest, done: done) }
        }
    }

    // MARK: الويدجت

    @objc func updateWidget(_ call: CAPPluginCall) {
        let snapshot = call.getString("snapshot") ?? ""
        ManarStore.shared.set(snapshot, forKey: ManarStore.Key.widgetSnapshot)
        ManarStore.defaults.set(snapshot, forKey: ManarStore.Key.widgetSnapshot)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
            WidgetCenter.shared.getCurrentConfigurations { result in
                let n = (try? result.get())?.count ?? 0
                call.resolve(["widgets": n])
            }
        } else {
            call.resolve(["widgets": 0])
        }
    }

    @objc func widgetStatus(_ call: CAPPluginCall) {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.getCurrentConfigurations { result in
                let n = (try? result.get())?.count ?? 0
                call.resolve(["placed": n, "pinSupported": false, "platform": "ios"])
            }
        } else {
            call.resolve(["placed": 0, "pinSupported": false, "platform": "ios"])
        }
    }

    /// iOS لا يسمح بإضافة ويدجت برمجياً؛ الواجهة تشرح خطوات الإضافة يدوياً.
    @objc func pinWidget(_ call: CAPPluginCall) {
        call.resolve(["requested": false])
    }

    // MARK: سكينة

    @objc func sakinahSchedule(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        let raw = call.getArray("windows", JSObject.self) ?? []
        let windows: [[String: Any]] = raw.map { obj in
            var d: [String: Any] = [:]
            for (k, v) in obj { d[k] = v }
            return ManarStore.sanitize(d)
        }
        ManarSakinah.save(enabled: enabled, windows: windows)
        ManarScheduler.rearm(reason: "silent") { _ in
            let armed = enabled ? ManarSakinah.upcomingStarts(limit: 1000).count : 0
            call.resolve(["armed": armed, "dndAccess": false, "exactAlarms": true])
        }
    }

    @objc func sakinahCancelAll(_ call: CAPPluginCall) {
        ManarSakinah.save(enabled: false, windows: [])
        UNUserNotificationCenter.current().getPendingNotificationRequests { pending in
            let ids = pending.map { $0.identifier }.filter { $0.hasPrefix(ManarScheduler.sakinahPrefix) }
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
            call.resolve()
        }
    }

    @objc func sakinahStopNow(_ call: CAPPluginCall) {
        if let w = ManarSakinah.active() {
            ManarSakinah.skip(id: w.id)
            ManarSakinah.log("quiet_stopped_by_user", prayer: w.prayer)
            ManarScheduler.rearm(reason: "silent")
        }
        call.resolve()
    }

    @objc func sakinahSkip(_ call: CAPPluginCall) {
        if let id = call.getInt("id") {
            ManarSakinah.skip(id: id)
            ManarScheduler.rearm(reason: "silent")
        }
        call.resolve()
    }

    @objc func sakinahClearSkips(_ call: CAPPluginCall) {
        ManarSakinah.clearSkips()
        ManarScheduler.rearm(reason: "silent")
        call.resolve()
    }

    @objc func sakinahStatus(_ call: CAPPluginCall) {
        ManarSakinah.status { call.resolve($0) }
    }

    @objc func sakinahLog(_ call: CAPPluginCall) {
        call.resolve(["events": ManarStore.readArray(ManarStore.Key.sakinahLog)])
    }

    @objc func sakinahRequestPolicyAccess(_ call: CAPPluginCall) {
        call.resolve(["granted": false, "opened": false])
    }

    @objc func sakinahOpenPolicyAccessSettings(_ call: CAPPluginCall) {
        call.resolve(["granted": false, "opened": false])
    }

    // MARK: خاص بـiOS

    /// لون ما خلف شريط الحالة ومؤشّر الرئيسية (خارج المنطقة الآمنة).
    @objc func setSystemBars(_ call: CAPPluginCall) {
        let color = call.getString("color") ?? "#0B1F1A"
        DispatchQueue.main.async {
            (self.bridge?.viewController?.parent as? ManarRootViewController)?.setChrome(hex: color)
            call.resolve()
        }
    }

    @objc func iosEnsureCategories(_ call: CAPPluginCall) {
        ManarScheduler.ensureCategories { call.resolve() }
    }

    @objc func iosInfo(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            var out: [String: Any] = [
                "platform": "ios",
                "authorization": s.authorizationStatus.rawValue,
                "sounds": s.soundSetting == .enabled,
                "lockScreen": s.lockScreenSetting == .enabled,
                "appGroup": FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ManarStore.appGroupId) != nil,
            ]
            if #available(iOS 15.0, *) { out["timeSensitive"] = s.timeSensitiveSetting == .enabled }
            DispatchQueue.main.async {
                out["system"] = UIDevice.current.systemVersion
                out["model"] = UIDevice.current.model
                out["backgroundRefresh"] = UIApplication.shared.backgroundRefreshStatus == .available
                call.resolve(out)
            }
        }
    }
}

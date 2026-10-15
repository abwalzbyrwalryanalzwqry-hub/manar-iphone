import Capacitor
import Foundation
import UIKit
import UserNotifications

/// منار — مفوَّض مركز الإشعارات.
///
/// يُثبَّت في `application(_:didFinishLaunchingWithOptions:)` قبل أي شيء، كما
/// تشترط Apple، فلا يضيع نقرٌ على إشعار فتح التطبيق من الإغلاق. يعالج إشعارات
/// منار بنفسه (تشغيل الأذان كاملاً في المقدّمة، «صلّيت»، التأجيل، المسار)، ويمرّر
/// غيرها إلى موجّه Capacitor فتبقى إضافة LocalNotifications تعمل كما هي.
final class ManarNotify: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ManarNotify()

    /// موجّه Capacitor (يحمل معالج LocalNotifications). يُضبط عند إنشاء الجسر.
    private var fallback: UNUserNotificationCenterDelegate?
    private var bufferedResponses: [(UNNotificationResponse, () -> Void)] = []

    weak var plugin: ManarAdhanPlugin?
    /// مسار نُقر قبل أن تُحمَّل الإضافة.
    private(set) var pendingRoute: String?

    func install() {
        UNUserNotificationCenter.current().delegate = self
    }

    /// يُستدعى بعد إنشاء جسر Capacitor: الجسر يضبط موجّهه مفوَّضاً، فنستعيد
    /// موقعنا ونحتفظ بموجّهه للتمرير.
    func attach(router: UNUserNotificationCenterDelegate?) {
        if let r = router, r !== self { fallback = r }
        UNUserNotificationCenter.current().delegate = self
        let pending = bufferedResponses
        bufferedResponses.removeAll()
        for (resp, done) in pending {
            if let f = fallback, f.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
                f.userNotificationCenter?(UNUserNotificationCenter.current(), didReceive: resp, withCompletionHandler: done)
            } else {
                done()
            }
        }
    }

    func takePendingRoute() -> String? {
        defer { pendingRoute = nil }
        return pendingRoute
    }

    private func isManar(_ n: UNNotification) -> Bool {
        (n.request.content.userInfo["manar"] as? Bool) == true
    }

    // MARK: وصول الإشعار والتطبيق في المقدّمة

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        guard isManar(notification) else {
            if let f = fallback, f.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
                f.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
            } else {
                completionHandler(banner(sound: true))
            }
            return
        }
        let info = notification.request.content.userInfo
        ManarScheduler.markLogged(notification)
        ManarScheduler.logFired(info: info, deliveredAt: notification.date)

        let kind = info["kind"] as? String ?? ""
        let sound = info["sound"] as? String ?? ""
        let muted = (info["muted"] as? Bool) ?? false
        var options = banner(sound: !muted)
        if (kind == "adhan" || kind == "iqama") && !sound.isEmpty && !muted {
            // التطبيق مفتوح: الأذان كاملاً بالمشغّل الأصلي، والإشعار بلا مقطعه.
            let played = ManarPlayer.shared.play(
                raw: sound,
                follow: info["follow"] as? String,
                volume: ManarVolumes.volume(for: kind),
                kind: kind,
                title: notification.request.content.title,
                key: info["key"] as? String ?? "")
            if played { options = banner(sound: false) }
        }
        completionHandler(options)
        // الجدول يُستهلك من أوّله: نعبّئ الميزانية من جديد ما دام التطبيق حيّاً.
        ManarScheduler.rearm(reason: "silent")
    }

    // MARK: نقر الإشعار أو أحد أزراره

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        guard isManar(response.notification) else {
            if let f = fallback, f.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
                f.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
            } else {
                // الجسر لم يُنشأ بعد (فتح من الإغلاق): نؤجّل حتى يُنشأ.
                bufferedResponses.append((response, completionHandler))
            }
            return
        }
        let n = response.notification
        let info = n.request.content.userInfo
        ManarScheduler.markLogged(n)
        let key = info["key"] as? String ?? ""
        let kind = info["kind"] as? String ?? ""

        switch response.actionIdentifier {
        case ManarScheduler.actionPrayed:
            let prayer = info["prayer"] as? String ?? ""
            let day = info["prayedDay"] as? String ?? ""
            ManarStore.pushPrayed(prayer: prayer, day: day)
            ManarStore.log("prayed", key: prayer, kind: kind, detail: day)
            plugin?.emitPrayed(prayer: prayer, day: day)
            center.removeDeliveredNotifications(withIdentifiers: [n.request.identifier])
        case ManarScheduler.actionSnooze:
            var copy = info
            copy["title"] = n.request.content.title
            copy["body"] = n.request.content.body
            let minutes = Int(manarNumber(info["snooze"]) ?? 10)
            ManarScheduler.snooze(from: copy, minutes: minutes > 0 ? minutes : 10)
            ManarStore.log("snoozed", key: key, kind: kind, detail: String(minutes > 0 ? minutes : 10))
        case ManarScheduler.actionPlay:
            playFull(info: info, title: n.request.content.title)
            openRoute(info["route"] as? String)
        case ManarScheduler.actionStop:
            ManarPlayer.shared.stop()
        case UNNotificationDismissActionIdentifier:
            break
        default:
            // نقر الإشعار نفسه بعد وصوله بقليل = يريد سماع الأذان كاملاً.
            let at = manarNumber(info["at"]) ?? 0
            let fresh = Date().timeIntervalSince1970 * 1000 - at < 4 * 60_000
            if fresh && (kind == "adhan" || kind == "iqama") && (info["muted"] as? Bool) != true {
                playFull(info: info, title: n.request.content.title)
            }
            openRoute(info["route"] as? String)
        }
        ManarScheduler.rearm(reason: "silent")
        completionHandler()
    }

    private func playFull(info: [AnyHashable: Any], title: String) {
        let sound = info["sound"] as? String ?? ""
        guard !sound.isEmpty else { return }
        let kind = info["kind"] as? String ?? "adhan"
        DispatchQueue.main.async {
            ManarPlayer.shared.play(
                raw: sound,
                follow: info["follow"] as? String,
                volume: ManarVolumes.volume(for: kind),
                kind: kind,
                title: title,
                key: info["key"] as? String ?? "")
        }
    }

    func openRoute(_ r: String?) {
        // داخلي فقط — مرآة isNotificationRoute: لا «//» ولا مخطّط (javascript: …).
        guard let r = r, r.hasPrefix("/"), !r.hasPrefix("//"), !r.contains(":"), r.count <= 120 else { return }
        if let p = plugin {
            p.emitRoute(r)
        } else {
            pendingRoute = r
        }
    }

    private func banner(sound: Bool) -> UNNotificationPresentationOptions {
        var o: UNNotificationPresentationOptions = []
        if #available(iOS 14.0, *) {
            o = [.banner, .list]
        } else {
            o = [.alert]
        }
        if sound { o.insert(.sound) }
        return o
    }
}

/// مستويات الصوت من الإعدادات (setVolumes) — للتشغيل داخل التطبيق فقط؛
/// صوت الإشعار نفسه يتبع مستوى رنين الجوال كما يفرض iOS.
enum ManarVolumes {
    private static let key = "manar.ios.volumes.v1"

    static func save(_ d: [String: Any]) {
        ManarStore.writeObject(key, d)
    }

    static func volume(for kind: String) -> Double {
        let d = ManarStore.readObject(key)
        let master = manarNumber(d["master"]) ?? 1
        let part: Double
        switch kind {
        case "iqama": part = manarNumber(d["iqama"]) ?? 1
        case "notice", "reminder": part = manarNumber(d["reminder"]) ?? 1
        default: part = manarNumber(d["adhan"]) ?? 1
        }
        return max(0.05, min(1, master * part))
    }
}

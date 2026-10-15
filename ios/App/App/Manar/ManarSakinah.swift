import Foundation
import UserNotifications

/// منار — «سكينة» على iOS.
///
/// iOS لا يسمح لأي تطبيق بتشغيل «عدم الإزعاج» أو «التركيز» بنفسه (لا يوجد ما
/// يقابل NotificationManager.setInterruptionFilter في أندرويد). فتعمل سكينة هنا
/// بما يتيحه النظام فعلاً، ودون أي وعد كاذب:
///  • إشعار هادئ بلا صوت عند بدء كل فترة يذكّر بتفعيل «التركيز» من مركز التحكم؛
///  • كتم أصوات منار نفسها (الأذان إن طُلب، والتذكيرات) طوال الفترة؛
///  • الاستثناءات («تخطٍّ»، «أوقفها الآن») تُحترم كما في أندرويد.
enum ManarSakinah {
    struct Window {
        let id: Int
        let start: Double
        let end: Double
        let prayer: String
        let label: String
        let filter: String
        let muteAdhan: Bool

        init?(_ d: [String: Any]) {
            guard let id = manarNumber(d["id"]), let s = manarNumber(d["start"]), let e = manarNumber(d["end"]) else { return nil }
            self.id = Int(id)
            start = s
            end = e
            prayer = d["prayer"] as? String ?? ""
            label = d["label"] as? String ?? ""
            filter = d["filter"] as? String ?? "manar"
            muteAdhan = (d["muteAdhan"] as? Bool) ?? false
        }

        var dict: [String: Any] {
            ["id": id, "start": start, "end": end, "prayer": prayer, "label": label, "filter": filter, "muteAdhan": muteAdhan]
        }
    }

    // MARK: التخزين

    static func save(enabled: Bool, windows: [[String: Any]]) {
        let prevEnabled = (ManarStore.readObject(ManarStore.Key.sakinah)["enabled"] as? Bool) ?? false
        let hadWindows = !(ManarStore.readObject(ManarStore.Key.sakinah)["windows"] as? [Any] ?? []).isEmpty
        ManarStore.writeObject(ManarStore.Key.sakinah, ["enabled": enabled, "windows": windows])
        if enabled {
            log(hadWindows || prevEnabled ? "schedule_updated" : "schedule_created")
        }
    }

    static var enabled: Bool {
        (ManarStore.readObject(ManarStore.Key.sakinah)["enabled"] as? Bool) ?? false
    }

    static func windows() -> [Window] {
        let obj = ManarStore.readObject(ManarStore.Key.sakinah)
        let arr = obj["windows"] as? [[String: Any]] ?? []
        let skips = Set(skipIds())
        return arr.compactMap { Window($0) }.filter { !skips.contains($0.id) }.sorted { $0.start < $1.start }
    }

    static func skipIds() -> [Int] {
        (ManarStore.defaults.array(forKey: ManarStore.Key.sakinahSkips) as? [Int]) ?? []
    }

    static func skip(id: Int) {
        var s = skipIds()
        if !s.contains(id) { s.append(id) }
        if s.count > 200 { s = Array(s.suffix(200)) }
        ManarStore.defaults.set(s, forKey: ManarStore.Key.sakinahSkips)
        let prayer = windowsIncludingSkipped().first { $0.id == id }?.prayer ?? ""
        log("quiet_skipped", prayer: prayer)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["\(ManarScheduler.sakinahPrefix)\(id)"])
    }

    static func clearSkips() {
        ManarStore.defaults.removeObject(forKey: ManarStore.Key.sakinahSkips)
    }

    private static func windowsIncludingSkipped() -> [Window] {
        let obj = ManarStore.readObject(ManarStore.Key.sakinah)
        return (obj["windows"] as? [[String: Any]] ?? []).compactMap { Window($0) }
    }

    // MARK: الاستعلام

    static func active(at ms: Double = Date().timeIntervalSince1970 * 1000) -> Window? {
        guard enabled else { return nil }
        return windows().first { $0.start <= ms && ms < $0.end }
    }

    static func next(after ms: Double = Date().timeIntervalSince1970 * 1000) -> Window? {
        guard enabled else { return nil }
        return windows().first { $0.start > ms }
    }

    static func upcomingStarts(limit: Int) -> [Window] {
        guard enabled else { return [] }
        let now = Date().timeIntervalSince1970 * 1000
        return Array(windows().filter { $0.start > now + 1000 }.prefix(limit))
    }

    /// هل يُكتم أذان/إقامة منار في هذه اللحظة؟
    static func mutesAdhan(atMs: Double) -> Bool {
        guard let w = active(at: atMs + 1) else { return false }
        return w.muteAdhan || w.filter == "none"
    }

    // MARK: الإشعار الهادئ عند البداية

    static func startRequest(for w: Window) -> UNNotificationRequest? {
        let c = UNMutableNotificationContent()
        let name = w.label.isEmpty ? "الصلاة" : w.label
        c.title = "سكينة: \(name)"
        let end = Date(timeIntervalSince1970: w.end / 1000)
        let f = DateFormatter()
        f.locale = Locale(identifier: "ar")
        f.dateFormat = "h:mm a"
        c.body = "وقت الصلاة. فعّل «التركيز» أو «عدم الإزعاج» من مركز التحكم إن شئت — أصوات منار مكتومة حتى \(f.string(from: end))."
        c.sound = nil
        c.threadIdentifier = "manar.sakinah"
        if #available(iOS 15.0, *) { c.interruptionLevel = .passive }
        c.userInfo = [
            "manar": true, "kind": "notice", "role": "sakinah", "key": "sakinah_\(w.id)",
            "prayer": w.prayer, "route": "/sakinah", "at": w.start,
        ]
        return UNNotificationRequest(
            identifier: "\(ManarScheduler.sakinahPrefix)\(w.id)",
            content: c,
            trigger: ManarScheduler.trigger(atMs: w.start))
    }

    // MARK: السجلّ

    static func log(_ type: String, prayer: String = "", detail: String = "") {
        var arr = ManarStore.readArray(ManarStore.Key.sakinahLog)
        arr.append(["at": Date().timeIntervalSince1970 * 1000, "type": type, "prayer": prayer, "detail": detail])
        if arr.count > 120 { arr.removeFirst(arr.count - 120) }
        ManarStore.writeArray(ManarStore.Key.sakinahLog, arr)
    }

    static func status(_ done: @escaping ([String: Any]) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            center.getPendingNotificationRequests { pending in
                let count = pending.filter { $0.identifier.hasPrefix(ManarScheduler.sakinahPrefix) }.count
                let upcoming = enabled ? windows().filter { $0.end > Date().timeIntervalSince1970 * 1000 }.count : 0
                var out: [String: Any] = [
                    "platform": "ios",
                    "enabled": enabled,
                    "dndAccess": false,
                    "exactAlarms": true,
                    "batteryUnrestricted": true,
                    "notificationsAllowed": settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional,
                    // «مجدولة» في iOS = الفترات المحفوظة القادمة (الإشعار الهادئ يُضبط للأقرب منها).
                    "pending": max(count, upcoming),
                    "currentFilter": 0,
                    "sdk": 0,
                ]
                if let a = active() { out["active"] = a.dict }
                if let n = next() { out["next"] = n.dict }
                done(out)
            }
        }
    }
}

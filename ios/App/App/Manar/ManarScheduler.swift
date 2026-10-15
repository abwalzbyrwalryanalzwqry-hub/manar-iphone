import Foundation
import UserNotifications

/// منار — جدولة الأذان والإقامة والتذكيرات على iOS.
///
/// الفرق الجوهري عن أندرويد: iOS لا يوقظ التطبيق عند موعد المنبّه، فلا يمكن
/// تشغيل خدمة صوت في الخلفية. البديل الموثوق الوحيد هو الإشعار المحلي المجدول
/// مسبقاً (`UNNotificationRequest`) بصوت مخصّص ≤ ٣٠ ثانية — يصل في موعده
/// بالثانية حتى والتطبيق مغلق والجوال مقفل، دون أي إذن خاص.
///
/// وللنظام حدّ صارم: ٦٤ إشعاراً معلّقاً للتطبيق كله، يُسقِط ما زاد بصمت. لذا
/// نحفظ الجدول الكامل (٣٠ يوماً من JavaScript) ونضبط منه الأقرب فالأقرب ضمن
/// الميزانية، ونعيد التعبئة كلما فُتح التطبيق، أو وصل إشعار وهو مفتوح، أو منح
/// النظام وقت تحديث في الخلفية (BGAppRefresh). وآخر ما يُضبط إشعار «افتح منار
/// لتجديد التنبيهات» عند نفاد النافذة، فلا ينقطع الأذان بصمت أبداً.
enum ManarScheduler {
    /// حدّ iOS للإشعارات المعلّقة.
    static let systemCap = 64
    /// يُترك لإشعارات LocalNotifications (تجربة تذكير، تأجيل) ولغيرها.
    static let reserveForOthers = 4
    /// أقصى ما يُحجز لبدايات «سكينة».
    static let sakinahCap = 4

    static let eventPrefix = "manar.e."
    static let sakinahPrefix = "manar.s."
    static let snoozePrefix = "manar.z."
    static let testPrefix = "manar.t."
    static let renewId = "manar.renew"

    static let categoryAdhanPrayed = "MANAR_ADHAN_PRAYED"
    static let categoryAdhan = "MANAR_ADHAN"
    static let categoryPrayed = "MANAR_PRAYED"
    static let categorySnooze = "MANAR_SNOOZE"

    static let actionPlay = "manar.play"
    static let actionPrayed = "manar.prayed"
    static let actionSnooze = "manar.snooze"
    static let actionStop = "manar.stop"

    private static let center = UNUserNotificationCenter.current()
    private static let lock = DispatchQueue(label: "app.manar.scheduler")

    // MARK: الفئات (أزرار الإشعار)

    /// يدمج فئات منار مع الموجودة: إضافة LocalNotifications تستبدل الفئات كلها
    /// عند `registerActionTypes`، فنعيد دمج فئاتنا قبل كل جدولة.
    static func ensureCategories(_ done: (() -> Void)? = nil) {
        let play = UNNotificationAction(identifier: actionPlay, title: "استمع للأذان كاملاً", options: [.foreground])
        let prayed = UNNotificationAction(identifier: actionPrayed, title: "صلّيت ✓", options: [])
        let snooze = UNNotificationAction(identifier: actionSnooze, title: "ذكّرني لاحقاً", options: [])
        let mine: [UNNotificationCategory] = [
            UNNotificationCategory(identifier: categoryAdhanPrayed, actions: [play, prayed], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: categoryAdhan, actions: [play], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: categoryPrayed, actions: [prayed], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: categorySnooze, actions: [snooze], intentIdentifiers: [], options: []),
        ]
        center.getNotificationCategories { existing in
            var merged = existing.filter { c in !mine.contains(where: { $0.identifier == c.identifier }) }
            merged.formUnion(mine)
            center.setNotificationCategories(merged)
            done?()
        }
    }

    // MARK: الجدول المحفوظ

    static func storeEvents(_ events: [[String: Any]]) {
        let now = Date().timeIntervalSince1970 * 1000
        // نحفظ القادم فقط، مرتّباً، بحدّ أعلى معقول.
        let future = events
            .filter { (manarNumber($0["at"]) ?? 0) > now - 60_000 }
            .sorted { (manarNumber($0["at"]) ?? 0) < (manarNumber($1["at"]) ?? 0) }
        ManarStore.writeArray(ManarStore.Key.events, Array(future.prefix(1500)))
    }

    static func storedEvents() -> [[String: Any]] {
        ManarStore.readArray(ManarStore.Key.events)
    }

    // MARK: إعادة الضبط

    /// يضبط الأقرب فالأقرب من الجدول المحفوظ ضمن ميزانية iOS. آمن من أي خيط.
    static func rearm(reason: String, completion: ((Int) -> Void)? = nil) {
        lock.async {
            // تسلسل صارم: لا تتداخل إعادتا ضبط فتُكرّر الطلبات أو تُسقطها.
            let sem = DispatchSemaphore(value: 0)
            ensureCategories {
                center.getPendingNotificationRequests { pending in
                    let armed = arm(pending: pending, reason: reason)
                    completion?(armed)
                    sem.signal()
                }
            }
            _ = sem.wait(timeout: .now() + 20)
        }
    }

    private static func arm(pending: [UNNotificationRequest], reason: String) -> Int {
        let nowMs = Date().timeIntervalSince1970 * 1000
        let all = storedEvents().filter { (manarNumber($0["at"]) ?? 0) > nowMs + 1000 }

        let others = pending.filter { !$0.identifier.hasPrefix("manar.") }.count
        let transient = pending.filter {
            $0.identifier.hasPrefix(snoozePrefix) || $0.identifier.hasPrefix(testPrefix)
        }.count
        let sakinah = ManarSakinah.upcomingStarts(limit: sakinahCap)
        var budget = systemCap - reserveForOthers - others - transient - sakinah.count - 1
        budget = max(8, budget)

        let chosen = Array(all.prefix(budget))
        var wanted: [UNNotificationRequest] = []
        for e in chosen {
            if let r = request(for: e) { wanted.append(r) }
        }
        for w in sakinah {
            if let r = ManarSakinah.startRequest(for: w) { wanted.append(r) }
        }
        if all.count > chosen.count, let last = chosen.last, let lastAt = manarNumber(last["at"]) {
            wanted.append(renewRequest(at: lastAt + 90_000))
        }

        let wantedIds = Set(wanted.map { $0.identifier })
        let stale = pending
            .map { $0.identifier }
            .filter { ($0.hasPrefix(eventPrefix) || $0.hasPrefix(sakinahPrefix) || $0 == renewId) && !wantedIds.contains($0) }
        if !stale.isEmpty { center.removePendingNotificationRequests(withIdentifiers: stale) }

        let group = DispatchGroup()
        let counter = NSLock()
        var failed = 0
        for r in wanted {
            group.enter()
            center.add(r) { err in
                if let err = err {
                    NSLog("[Manar] add \(r.identifier) failed: \(err.localizedDescription)")
                    counter.lock(); failed += 1; counter.unlock()
                }
                group.leave()
            }
        }
        _ = group.wait(timeout: .now() + 15)

        counter.lock()
        let armed = wanted.count - failed
        counter.unlock()
        ManarStore.writeObject(ManarStore.Key.lastArm, [
            "at": nowMs,
            "armed": armed,
            "total": all.count,
            "reason": reason,
        ])
        // كما في أندرويد: يُسجَّل ما يعيده النظام لا ما تطلبه الواجهة في كل مزامنة.
        switch reason {
        case "background": ManarStore.log("rearmed", detail: "تحديث iOS في الخلفية")
        case "time_change": ManarStore.log("rearmed", detail: "TIME_CHANGED")
        default: break
        }
        return armed
    }

    /// يلغي كل ما ضبطته منار (لا يمسّ إشعارات LocalNotifications).
    static func cancelAll(keepStore: Bool = false) {
        if !keepStore { ManarStore.defaults.removeObject(forKey: ManarStore.Key.events) }
        center.getPendingNotificationRequests { pending in
            let ids = pending.map { $0.identifier }.filter {
                $0.hasPrefix(eventPrefix) || $0 == renewId || $0.hasPrefix(snoozePrefix)
            }
            center.removePendingNotificationRequests(withIdentifiers: ids)
        }
    }

    // MARK: بناء الطلبات

    static func trigger(atMs: Double) -> UNNotificationTrigger {
        let date = Date(timeIntervalSince1970: atMs / 1000)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute, .second, .timeZone], from: date)
        return UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
    }

    static func request(for e: [String: Any], identifier: String? = nil, atOverride: Double? = nil) -> UNNotificationRequest? {
        guard let id = manarNumber(e["id"]), let at = atOverride ?? manarNumber(e["at"]) else { return nil }
        let kind = e["kind"] as? String ?? "notice"
        let role = e["role"] as? String ?? ""
        let sound = e["sound"] as? String ?? ""
        let meta = e["meta"] as? [String: Any] ?? [:]
        let prayedDay = meta["prayedDay"] as? String ?? ""
        let prayer = (meta["prayer"] as? String) ?? (e["prayer"] as? String) ?? ""
        let snooze = manarNumber(meta["snooze"]) ?? 0
        let inQuiet = ManarSakinah.active(at: at + 1) != nil
        let muted = (kind == "adhan" || kind == "iqama") ? ManarSakinah.mutesAdhan(atMs: at) : inQuiet

        let c = UNMutableNotificationContent()
        c.title = e["title"] as? String ?? "منار"
        c.body = e["body"] as? String ?? ""
        c.threadIdentifier = "manar.\(kind)"
        // مرآة SILENCE_REASONS.sakinah في notification-text.ts: كل صمتٍ بسببه.
        if muted && (kind == "adhan" || kind == "iqama") { c.subtitle = "مكتوم في فترة «سكينة»" }
        switch kind {
        case "adhan", "iqama":
            c.sound = muted ? nil : ManarSounds.notificationSound(raw: sound)
        default:
            // تذكيرات منار تصل صامتة أثناء «سكينة».
            c.sound = muted ? nil : ManarSounds.soundForNotice(channel: e["channel"] as? String)
        }

        let hasFull = (kind == "adhan" || kind == "iqama") && !sound.isEmpty && ManarSounds.fullURL(sound) != nil
        if hasFull && !prayedDay.isEmpty { c.categoryIdentifier = categoryAdhanPrayed }
        else if hasFull { c.categoryIdentifier = categoryAdhan }
        else if !prayedDay.isEmpty { c.categoryIdentifier = categoryPrayed }
        else if snooze > 0 { c.categoryIdentifier = categorySnooze }

        if #available(iOS 15.0, *) {
            let priority = (e["priority"] as? Bool) ?? false
            c.interruptionLevel = priority ? .timeSensitive : .active
            c.relevanceScore = kind == "notice" ? 0.4 : 1.0
        }

        var info: [String: Any] = [
            "manar": true,
            "id": id,
            "key": e["key"] as? String ?? "\(Int(id))",
            "kind": kind,
            "role": role,
            "at": at,
            "sound": sound,
            "prayer": prayer,
            "prayedDay": prayedDay,
            "route": meta["route"] as? String ?? "",
            "snooze": snooze,
            "muted": muted,
        ]
        if let f = e["follow"] as? String, !f.isEmpty { info["follow"] = f }
        if let ch = e["channel"] as? String { info["channel"] = ch }
        c.userInfo = info

        return UNNotificationRequest(
            identifier: identifier ?? "\(eventPrefix)\(Int(id))",
            content: c,
            trigger: trigger(atMs: at))
    }

    private static func renewRequest(at: Double) -> UNNotificationRequest {
        let c = UNMutableNotificationContent()
        c.title = "افتح منار لتجديد تنبيهات الصلاة"
        c.body = "ضبط iOS تنبيهات الأيام القادمة كلها. افتح التطبيق لحظةً ليُكمل الجدول فلا يفوتك أذان."
        c.sound = .default
        c.threadIdentifier = "manar.renew"
        c.userInfo = ["manar": true, "kind": "notice", "role": "renew", "key": "renew", "route": "/notifications", "at": at]
        return UNNotificationRequest(identifier: renewId, content: c, trigger: trigger(atMs: at))
    }

    // MARK: التأجيل والتجربة

    static func snooze(from info: [AnyHashable: Any], minutes: Int) {
        let m = max(1, min(120, minutes))
        let c = UNMutableNotificationContent()
        c.title = info["title"] as? String ?? "تذكير منار"
        c.body = info["body"] as? String ?? ""
        let channel = info["channel"] as? String
        c.sound = ManarSounds.soundForNotice(channel: channel)
        c.threadIdentifier = "manar.notice"
        var copy: [String: Any] = [:]
        for (k, v) in info { if let ks = k as? String { copy[ks] = v } }
        copy["snooze"] = 0
        copy["at"] = Date().timeIntervalSince1970 * 1000 + Double(m) * 60_000
        c.userInfo = copy
        let trig = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(m * 60), repeats: false)
        let id = "\(snoozePrefix)\(Int(Date().timeIntervalSince1970))"
        center.add(UNNotificationRequest(identifier: id, content: c, trigger: trig))
    }

    static func test(sound: String, title: String, body: String, seconds: Int, priority: Bool) -> (key: String, at: Double) {
        let s = max(5, min(3600, seconds))
        let at = Date().timeIntervalSince1970 * 1000 + Double(s) * 1000
        let key = "test_\(Int(at))"
        let e: [String: Any] = [
            "id": Int(at / 1000) % 1_000_000,
            "key": key,
            "at": at,
            "kind": "adhan",
            "role": "adhan",
            "sound": sound,
            "title": title,
            "body": body,
            "priority": priority,
            "meta": ["route": "/notifications"],
        ]
        let rid = "\(testPrefix)\(Int(at))"
        if let r = request(for: e, identifier: rid) {
            ensureCategories { center.add(r) }
        }
        var tests = ManarStore.readArray(testsKey)
        tests.append(["key": key, "id": rid, "at": at])
        ManarStore.writeArray(testsKey, Array(tests.suffix(10)))
        return (key, at)
    }

    // MARK: الحالة

    static func status(_ done: @escaping ([String: Any]) -> Void) {
        center.getNotificationSettings { settings in
            center.getPendingNotificationRequests { pending in
                let mine = pending.filter { $0.identifier.hasPrefix(eventPrefix) || $0.identifier.hasPrefix(testPrefix) }
                func count(_ k: String) -> Int { mine.filter { ($0.content.userInfo["kind"] as? String) == k }.count }
                let allowed = settings.authorizationStatus == .authorized
                    || settings.authorizationStatus == .provisional
                    || isEphemeral(settings.authorizationStatus)
                var out: [String: Any] = [
                    "platform": "ios",
                    "exactAlarms": true,
                    "batteryUnrestricted": true,
                    "pending": mine.count,
                    "pendingAdhan": count("adhan"),
                    "pendingIqama": count("iqama"),
                    "pendingNotice": count("notice"),
                    "sdk": 0,
                    "notificationsAllowed": allowed && settings.alertSetting != .disabled,
                    "soundsAllowed": settings.soundSetting == .enabled,
                    "stored": storedEvents().count,
                ]
                if #available(iOS 15.0, *) {
                    out["timeSensitive"] = settings.timeSensitiveSetting == .enabled
                }
                let last = ManarStore.readObject(ManarStore.Key.lastArm)
                if let at = manarNumber(last["at"]) { out["lastScheduledAt"] = at }
                let next = mine
                    .compactMap { r -> (Double, UNNotificationRequest)? in
                        guard let at = manarNumber(r.content.userInfo["at"]) else { return nil }
                        return (at, r)
                    }
                    .min { $0.0 < $1.0 }
                if let n = next {
                    let at = n.0, r = n.1
                    out["nextAt"] = at
                    out["nextKey"] = r.content.userInfo["key"] as? String ?? ""
                    out["nextTitle"] = r.content.title
                    out["nextKind"] = r.content.userInfo["kind"] as? String ?? ""
                }
                let fails = ManarStore.readArray(ManarStore.Key.log).filter { ($0["type"] as? String) == "playback_failed" }
                if let f = fails.last {
                    out["playbackFailedAt"] = f["at"]
                    out["playbackFailedReason"] = f["detail"]
                }
                done(out)
            }
        }
    }

    private static func isEphemeral(_ s: UNAuthorizationStatus) -> Bool {
        if #available(iOS 14.0, *) { return s == .ephemeral }
        return false
    }

    // MARK: سجلّ ما وصل والتطبيق مغلق

    /// iOS لا يوقظ التطبيق عند وصول الإشعار، فنسجّل «أُطلق» حين يعود المستخدم
    /// من قائمة ما سلّمه النظام فعلاً (بتوقيت التسليم الحقيقي).
    private static let testsKey = "manar.ios.tests.v1"

    /// التجربة الشاملة: إن مُسح إشعارها من مركز الإشعارات قبل العودة للتطبيق
    /// فلن يظهر في «ما سُلِّم»؛ لكن خروجه من «المعلّق» بعد موعده يعني أن النظام
    /// أطلقه. فلا نحكم بـ«لم يصل» على تجربةٍ وصلت فعلاً.
    private static func reconcileTests(pending: [UNNotificationRequest]) {
        let now = Date().timeIntervalSince1970 * 1000
        let pendingIds = Set(pending.map { $0.identifier })
        var tests = ManarStore.readArray(testsKey)
        guard !tests.isEmpty else { return }
        let log = ManarStore.readArray(ManarStore.Key.log)
        var changed = false
        for i in tests.indices {
            guard (tests[i]["done"] as? Bool) != true,
                  let key = tests[i]["key"] as? String,
                  let id = tests[i]["id"] as? String,
                  let at = manarNumber(tests[i]["at"]), at < now - 3000,
                  !pendingIds.contains(id) else { continue }
            let fired = log.contains { ($0["type"] as? String) == "fired" && ($0["key"] as? String) == key }
            if !fired { ManarStore.log("fired", key: key, kind: "adhan", detail: "\(key)/0") }
            tests[i]["done"] = true
            changed = true
        }
        if changed { ManarStore.writeArray(testsKey, tests) }
    }

    static func reconcileDelivered() {
        center.getPendingNotificationRequests { pending in
            lock.async { reconcileTests(pending: pending) }
        }
        center.getDeliveredNotifications { delivered in
            lock.async {
                var seen = Set((ManarStore.defaults.array(forKey: ManarStore.Key.loggedDelivered) as? [String]) ?? [])
                var changed = false
                for n in delivered.sorted(by: { $0.date < $1.date }) {
                    let info = n.request.content.userInfo
                    guard (info["manar"] as? Bool) == true else { continue }
                    let rid = n.request.identifier + "@" + String(Int(n.date.timeIntervalSince1970))
                    if seen.contains(rid) { continue }
                    seen.insert(rid)
                    changed = true
                    logFired(info: info, deliveredAt: n.date)
                }
                if changed {
                    var arr = Array(seen)
                    if arr.count > 400 { arr = Array(arr.suffix(400)) }
                    ManarStore.defaults.set(arr, forKey: ManarStore.Key.loggedDelivered)
                }
            }
        }
    }

    static func markLogged(_ n: UNNotification) {
        let rid = n.request.identifier + "@" + String(Int(n.date.timeIntervalSince1970))
        lock.async {
            var arr = (ManarStore.defaults.array(forKey: ManarStore.Key.loggedDelivered) as? [String]) ?? []
            if !arr.contains(rid) { arr.append(rid) }
            if arr.count > 400 { arr = Array(arr.suffix(400)) }
            ManarStore.defaults.set(arr, forKey: ManarStore.Key.loggedDelivered)
        }
    }

    static func logFired(info: [AnyHashable: Any], deliveredAt: Date) {
        let key = info["key"] as? String ?? ""
        let kind = info["kind"] as? String ?? ""
        let role = info["role"] as? String ?? ""
        if role == "sakinah" {
            ManarSakinah.log("quiet_started", prayer: info["prayer"] as? String ?? "")
            return
        }
        if role == "renew" { return }
        if !key.isEmpty, ManarStore.readArray(ManarStore.Key.log).contains(where: {
            ($0["type"] as? String) == "fired" && ($0["key"] as? String) == key
        }) { return }
        let at = manarNumber(info["at"]) ?? deliveredAt.timeIntervalSince1970 * 1000
        let late = max(0, Int((deliveredAt.timeIntervalSince1970 * 1000 - at) / 1000))
        ManarStore.log("fired", key: key, kind: kind, detail: "\(key)/\(late)")
        if (info["muted"] as? Bool) == true {
            ManarStore.log("silenced", key: key, kind: kind, detail: "مكتوم في فترة «سكينة»")
        }
    }
}

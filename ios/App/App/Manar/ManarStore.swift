import Foundation

/// منار — التخزين الأصلي المشترك بين الإضافة والمفوَّض والمهام الخلفية.
///
/// كل ما تحتاجه الطبقة الأصلية لتعمل والتطبيق مغلق محفوظ هنا في `UserDefaults`
/// (يدخل نسخة iCloud الاحتياطية تلقائياً)، فلا تعتمد إعادة الضبط في الخلفية
/// على JavaScript إطلاقاً.
enum ManarStore {
    static let defaults = UserDefaults.standard

    /// مجموعة التطبيقات المشتركة مع الويدجت. إن لم تُمنح (تثبيت بلا توقيع
    /// يدعمها) نرجع إلى `standard` فلا ينكسر شيء — الويدجت يعرض حينها رسالته.
    static let appGroupId = "group.app.manar.islamic"
    static var shared: UserDefaults {
        if FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) != nil,
           let d = UserDefaults(suiteName: appGroupId) {
            return d
        }
        return .standard
    }

    enum Key {
        static let events = "manar.ios.events.v1"
        static let log = "manar.ios.log.v1"
        static let prayed = "manar.ios.prayed.v1"
        static let sakinah = "manar.ios.sakinah.v1"
        static let sakinahSkips = "manar.ios.sakinah.skips.v1"
        static let sakinahLog = "manar.ios.sakinah.log.v1"
        static let soundsVersion = "manar.ios.sounds.version"
        static let loggedDelivered = "manar.ios.delivered.v1"
        static let lastArm = "manar.ios.lastArm.v1"
        static let widgetSnapshot = "manar.widget.snapshot.v1"
    }

    // MARK: JSON helpers

    static func readArray(_ key: String) -> [[String: Any]] {
        guard let data = defaults.data(forKey: key),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr
    }

    static func writeArray(_ key: String, _ arr: [[String: Any]]) {
        let clean = arr.map { sanitize($0) }
        if let data = try? JSONSerialization.data(withJSONObject: clean) {
            defaults.set(data, forKey: key)
        }
    }

    static func readObject(_ key: String) -> [String: Any] {
        guard let data = defaults.data(forKey: key),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    static func writeObject(_ key: String, _ obj: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: sanitize(obj)) {
            defaults.set(data, forKey: key)
        }
    }

    /// يُبقي ما تقبله JSONSerialization فقط (قيم JSObject قد تحمل NSNull وأنواعاً جسرية).
    static func sanitize(_ obj: [String: Any]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (k, v) in obj {
            if let s = sanitizeValue(v) { out[k] = s }
        }
        return out
    }

    private static func sanitizeValue(_ v: Any) -> Any? {
        switch v {
        case let s as String: return s
        // NSNumber أولاً: يحفظ الفرق بين المنطقي والرقمي كما وصل من JSON
        // (`as Bool` يحوّل الرقم ١ إلى true فيُفسد المعرّفات).
        case let n as NSNumber: return n.doubleValue.isFinite ? n : nil
        case let dict as [String: Any]: return sanitize(dict)
        case let arr as [Any]: return arr.compactMap { sanitizeValue($0) }
        default: return nil
        }
    }

    // MARK: Alert log (يطابق شكل ManarLog في أندرويد)

    static let logCap = 200

    static func log(_ type: String, key: String = "", kind: String = "", detail: String = "") {
        var arr = readArray(Key.log)
        arr.append([
            "at": Date().timeIntervalSince1970 * 1000,
            "type": type,
            "key": key,
            "kind": kind,
            "detail": detail,
        ])
        if arr.count > logCap { arr.removeFirst(arr.count - logCap) }
        writeArray(Key.log, arr)
    }

    // MARK: «صلّيت» من الإشعار

    static func pushPrayed(prayer: String, day: String) {
        guard !prayer.isEmpty, !day.isEmpty else { return }
        var arr = readArray(Key.prayed)
        if arr.contains(where: { ($0["prayer"] as? String) == prayer && ($0["day"] as? String) == day }) { return }
        arr.append(["prayer": prayer, "day": day, "at": Date().timeIntervalSince1970 * 1000])
        if arr.count > 60 { arr.removeFirst(arr.count - 60) }
        writeArray(Key.prayed, arr)
    }

    static func takePrayed() -> [[String: Any]] {
        let arr = readArray(Key.prayed)
        defaults.removeObject(forKey: Key.prayed)
        return arr
    }
}

/// حقل رقمي من قاموس JSON قد يكون Int أو Double أو NSNumber.
func manarNumber(_ v: Any?) -> Double? {
    if let n = v as? NSNumber { return n.doubleValue }
    if let d = v as? Double { return d }
    if let i = v as? Int { return Double(i) }
    if let s = v as? String, let d = Double(s) { return d }
    return nil
}

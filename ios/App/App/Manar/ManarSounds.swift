import Foundation
import UserNotifications

/// منار — أصوات الإشعارات والتشغيل الكامل.
///
/// قيود iOS التي يحترمها هذا الملف:
///  • صوت الإشعار المحلي لا يتجاوز ٣٠ ثانية، وإلا شغّل النظام الصوت الافتراضي.
///    لذا لكل صوت نسختان في الحزمة: مقطع ‎`ManarSounds/<raw>.caf`‏ (≤ ٢٩٫٥ث، IMA4)
///    للإشعار، والملف الكامل ‎`ManarAudio/<raw>.mp3`‏ للتشغيل داخل التطبيق.
///  • النظام يبحث عن أصوات الإشعار في جذر الحزمة أو ‎`Library/Sounds`‏ — لا في
///    المجلدات الفرعية — فنَنسخ المقاطع إلى ‎`Library/Sounds`‏ عند أول تشغيل لكل إصدار.
enum ManarSounds {
    static let clipsFolder = "ManarSounds"
    static let fullFolder = "ManarAudio"

    static var librarySounds: URL? {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first?
            .appendingPathComponent("Sounds", isDirectory: true)
    }

    /// يَنسخ مقاطع الإشعار إلى Library/Sounds مرة لكل إصدار من التطبيق.
    static func installIfNeeded() {
        let version = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0")
            + "/" + (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0")
        guard let dest = librarySounds,
              let src = Bundle.main.resourceURL?.appendingPathComponent(clipsFolder, isDirectory: true)
        else { return }
        let fm = FileManager.default
        let marker = ManarStore.defaults.string(forKey: ManarStore.Key.soundsVersion)
        let destHasFiles = ((try? fm.contentsOfDirectory(atPath: dest.path))?.isEmpty == false)
        if marker == version && destHasFiles { return }
        do {
            try fm.createDirectory(at: dest, withIntermediateDirectories: true)
            let files = try fm.contentsOfDirectory(at: src, includingPropertiesForKeys: nil)
            for f in files where f.pathExtension.lowercased() == "caf" {
                let target = dest.appendingPathComponent(f.lastPathComponent)
                if fm.fileExists(atPath: target.path) { try? fm.removeItem(at: target) }
                try fm.copyItem(at: f, to: target)
            }
            ManarStore.defaults.set(version, forKey: ManarStore.Key.soundsVersion)
        } catch {
            NSLog("[Manar] sounds install failed: \(error.localizedDescription)")
        }
    }

    static func hasClip(_ raw: String) -> Bool {
        guard !raw.isEmpty else { return false }
        if let dest = librarySounds,
           FileManager.default.fileExists(atPath: dest.appendingPathComponent("\(raw).caf").path) {
            return true
        }
        return Bundle.main.url(forResource: raw, withExtension: "caf", subdirectory: clipsFolder) != nil
    }

    static func fullURL(_ raw: String) -> URL? {
        guard !raw.isEmpty else { return nil }
        for ext in ["mp3", "m4a"] {
            if let u = Bundle.main.url(forResource: raw, withExtension: ext, subdirectory: fullFolder) { return u }
        }
        return nil
    }

    /// صوت إشعار لمورد خام. nil = صامت، والافتراضي إن غاب المقطع.
    static func notificationSound(raw: String) -> UNNotificationSound? {
        if raw.isEmpty { return nil }
        if hasClip(raw) { return UNNotificationSound(named: UNNotificationSoundName("\(raw).caf")) }
        return .default
    }

    /// يشتقّ صوت حدث «notice» من معرّف قناته الأندرويدية (المصدر الواحد للمعنى
    /// في الطبقة المشتركة): ‎`manar_azkar_<raw>`‏، ‎`manar_approach_<raw>`‏،
    /// ‎`manar_season_<raw>`‏، ‎`manar_reminders[_vNN]`‏ (تكبير)، ‎`manar_silent`‏.
    /// اللاحقة ‎`_nv`‏ (بلا اهتزاز) لا معنى لها في iOS فتُحذف.
    static func rawForChannel(_ channelIn: String?) -> String? {
        guard var channel = channelIn, !channel.isEmpty else { return nil }
        if channel.hasSuffix("_nv") { channel.removeLast(3) }
        if channel == "manar_silent" { return "" }
        for prefix in ["manar_azkar_", "manar_approach_", "manar_season_"] where channel.hasPrefix(prefix) {
            return String(channel.dropFirst(prefix.count))
        }
        if channel == "manar_reminders" { return "segment_takbir" }
        if channel.hasPrefix("manar_reminders_v") {
            return "segment_takbir_" + String(channel.dropFirst("manar_reminders_".count))
        }
        return nil
    }

    static func soundForNotice(channel: String?) -> UNNotificationSound? {
        if let raw = rawForChannel(channel) {
            return notificationSound(raw: raw)
        }
        // قناتا الصلاة ("adhan"/"iqama") وغيرهما: نغمة النظام القصيرة.
        return .default
    }
}

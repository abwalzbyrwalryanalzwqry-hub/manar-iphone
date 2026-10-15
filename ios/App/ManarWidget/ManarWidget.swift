import SwiftUI
import WidgetKit

// منار — ويدجت الشاشة الرئيسية وشاشة القفل لـiPhone.
//
// يقرأ اللقطة نفسها التي يبنيها `src/lib/widget-snapshot.ts` (٣٠ يوماً من
// المواقيت وآية كل يوم) من مجموعة التطبيقات المشتركة، ويحسب «الصلاة القادمة»
// بنفسه عند كل موعد — فيبقى صحيحاً أسابيع والتطبيق مغلق، بلا إنترنت.

private let appGroupId = "group.app.manar.islamic"
private let snapshotKey = "manar.widget.snapshot.v1"

// MARK: النموذج

struct WPrayer: Decodable {
    let key: String
    let name: String
    let at: Double
    let time: String
}

struct WVerse: Decodable {
    let text: String
    let ref: String
}

struct WDay: Decodable {
    let date: String
    let weekday: String
    let hijri: String
    let hijriFrom: Double?
    let hijriEvening: String?
    let season: String?
    let prayers: [WPrayer]
    let verse: WVerse?
}

struct WOptions: Decodable {
    let verse: Bool?
    let countdown: Bool?
    let hijri: Bool?
    let city: Bool?
    let season: Bool?
    let theme: String?
}

struct WSnapshot: Decodable {
    let v: Int
    let city: String
    let generatedAt: Double
    let days: [WDay]
    let options: WOptions?
}

func loadSnapshot() -> WSnapshot? {
    let shared = UserDefaults(suiteName: appGroupId)
    guard let s = shared?.string(forKey: snapshotKey), let data = s.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(WSnapshot.self, from: data)
}

struct ManarEntry: TimelineEntry {
    let date: Date
    let city: String
    let prayerName: String?
    let prayerTime: String?
    let prayerAt: Date?
    let meta: String
    let verse: WVerse?
    let showCountdown: Bool
    let showVerse: Bool
    let theme: String
    let stale: Bool

    static let placeholder = ManarEntry(
        date: Date(), city: "صنعاء", prayerName: "العصر", prayerTime: "٣:٢٠ م",
        prayerAt: Date().addingTimeInterval(3600), meta: "١٢ ربيع الآخر ١٤٤٨ هـ  ·  صنعاء",
        verse: WVerse(text: "أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ", ref: "الرعد ٢٨"),
        showCountdown: true, showVerse: true, theme: "night", stale: false)
}

// MARK: الحساب

func entry(for date: Date, snapshot s: WSnapshot?) -> ManarEntry {
    guard let s = s else {
        return ManarEntry(date: date, city: "", prayerName: nil, prayerTime: nil, prayerAt: nil,
                          meta: "", verse: nil, showCountdown: false, showVerse: false, theme: "night", stale: true)
    }
    let ms = date.timeIntervalSince1970 * 1000
    let o = s.options
    var next: (WPrayer, WDay)?
    outer: for d in s.days {
        for p in d.prayers where p.at > ms {
            next = (p, d)
            break outer
        }
    }
    // اليوم الحالي لسطر الهجري والآية: آخر يوم بدأ قبل اللحظة.
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    let todayKey = f.string(from: date)
    let today = s.days.first { $0.date == todayKey } ?? next?.1

    var hijri = today?.hijri ?? ""
    if let from = today?.hijriFrom, let eve = today?.hijriEvening, ms >= from { hijri = eve }
    let first: String
    if (o?.season ?? true), let season = today?.season, !season.isEmpty {
        first = season
    } else {
        first = (o?.hijri ?? true) ? hijri : ""
    }
    let meta = [first, (o?.city ?? true) ? s.city : ""].filter { !$0.isEmpty }.joined(separator: "  ·  ")

    return ManarEntry(
        date: date,
        city: s.city,
        prayerName: next?.0.name,
        prayerTime: next?.0.time,
        prayerAt: next.map { Date(timeIntervalSince1970: $0.0.at / 1000) },
        meta: meta,
        verse: (o?.verse ?? true) ? today?.verse : nil,
        showCountdown: o?.countdown ?? true,
        showVerse: o?.verse ?? true,
        theme: o?.theme ?? "night",
        stale: next == nil)
}

struct ManarProvider: TimelineProvider {
    func placeholder(in context: Context) -> ManarEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (ManarEntry) -> Void) {
        let s = loadSnapshot()
        completion(s == nil && context.isPreview ? .placeholder : entry(for: Date(), snapshot: s))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ManarEntry>) -> Void) {
        let s = loadSnapshot()
        let now = Date()
        var dates: [Date] = [now]
        if let s = s {
            let nowMs = now.timeIntervalSince1970 * 1000
            // مدخل عند كل صلاة (بعدها بثانية) وعند منتصف كل ليلة، لـ٣ أيام.
            let horizon = nowMs + 3 * 86_400_000
            for d in s.days {
                for p in d.prayers where p.at > nowMs && p.at < horizon {
                    dates.append(Date(timeIntervalSince1970: p.at / 1000 + 1))
                }
                if let from = d.hijriFrom, from > nowMs, from < horizon {
                    dates.append(Date(timeIntervalSince1970: from / 1000 + 1))
                }
            }
            let cal = Calendar.current
            for i in 1...3 {
                if let mid = cal.date(byAdding: .day, value: i, to: cal.startOfDay(for: now)) {
                    dates.append(mid.addingTimeInterval(1))
                }
            }
        }
        dates = Array(Set(dates)).sorted()
        let entries = dates.map { entry(for: $0, snapshot: s) }
        let refresh = dates.last.map { max($0, now.addingTimeInterval(3600)) } ?? now.addingTimeInterval(3600)
        completion(Timeline(entries: entries, policy: .after(refresh)))
    }
}

// MARK: الألوان

extension Color {
    static let manarGold = Color(red: 0xC9 / 255, green: 0xA2 / 255, blue: 0x27 / 255)
    static let manarDeep = Color(red: 0x0B / 255, green: 0x1F / 255, blue: 0x1A / 255)
    static let manarEmerald = Color(red: 0x0E / 255, green: 0x7A / 255, blue: 0x5F / 255)
    static let manarNight = Color(red: 0x15 / 255, green: 0x22 / 255, blue: 0x38 / 255)
}

func background(_ theme: String) -> LinearGradient {
    LinearGradient(
        colors: [theme == "emerald" ? .manarEmerald : .manarNight, .manarDeep],
        startPoint: .topLeading, endPoint: .bottomTrailing)
}

// MARK: العرض

struct ManarWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: ManarEntry

    var body: some View {
        content
            .environment(\.layoutDirection, .rightToLeft)
            .environment(\.locale, Locale(identifier: "ar"))
            .widgetURL(URL(string: "manar://prayer"))
            .modifier(ManarBackground(theme: entry.theme, accessory: isAccessory))
    }

    private var isAccessory: Bool {
        if #available(iOS 16.0, *) {
            switch family {
            case .accessoryInline, .accessoryCircular, .accessoryRectangular: return true
            default: return false
            }
        }
        return false
    }

    @ViewBuilder private var content: some View {
        if #available(iOS 16.0, *) {
            switch family {
            case .accessoryInline: inlineContent
            case .accessoryCircular: circularContent
            case .accessoryRectangular: rectangularContent
            default: homeContent
            }
        } else {
            homeContent
        }
    }

    private var inlineContent: some View {
        Text(entry.prayerName.map { "\($0) \(entry.prayerTime ?? "")" } ?? "منار")
    }

    private var circularContent: some View {
        VStack(spacing: 0) {
            Text(entry.prayerName ?? "منار").font(.system(size: 12, weight: .bold)).minimumScaleFactor(0.6)
            if let at = entry.prayerAt {
                Text(at, style: .timer).font(.system(size: 10)).multilineTextAlignment(.center).minimumScaleFactor(0.5)
            }
        }
    }

    private var rectangularContent: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(entry.prayerName.map { "\($0) · \(entry.prayerTime ?? "")" } ?? "افتح منار")
                .font(.system(size: 15, weight: .bold)).lineLimit(1)
            if let at = entry.prayerAt {
                HStack(spacing: 4) {
                    Text("متبقٍّ")
                    Text(at, style: .timer).monospacedDigit()
                }.font(.system(size: 12)).lineLimit(1)
            }
            if !entry.city.isEmpty { Text(entry.city).font(.system(size: 11)).opacity(0.8).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var homeContent: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !entry.meta.isEmpty {
                Text(entry.meta).font(.system(size: 11)).foregroundColor(.manarGold).lineLimit(1)
            }
            if entry.stale {
                Spacer(minLength: 0)
                Text("افتح منار لتحديث المواقيت").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            } else {
                HStack(alignment: .center, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.prayerName ?? "").font(.system(size: family == .systemSmall ? 22 : 24, weight: .bold))
                            .foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.7)
                        Text(entry.prayerTime ?? "").font(.system(size: 13)).foregroundColor(.white.opacity(0.8))
                    }
                    Spacer(minLength: 0)
                    if entry.showCountdown, let at = entry.prayerAt, family != .systemSmall {
                        VStack(alignment: .trailing, spacing: 0) {
                            Text("متبقٍّ").font(.system(size: 10)).foregroundColor(.white.opacity(0.6))
                            Text(at, style: .timer).font(.system(size: 18).monospacedDigit())
                                .foregroundColor(.white).multilineTextAlignment(.trailing)
                                .environment(\.layoutDirection, .leftToRight)
                        }
                        .fixedSize()
                    }
                }
                if entry.showCountdown, let at = entry.prayerAt, family == .systemSmall {
                    HStack(spacing: 4) {
                        Text("متبقٍّ").foregroundColor(.white.opacity(0.6))
                        Text(at, style: .timer).monospacedDigit().foregroundColor(.white)
                    }.font(.system(size: 12)).lineLimit(1)
                }
                if family != .systemSmall, let v = entry.verse, entry.showVerse {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(v.text).font(.system(size: 12)).foregroundColor(.white.opacity(0.92))
                            .lineLimit(family == .systemLarge ? 6 : 2)
                        Text(v.ref).font(.system(size: 10)).foregroundColor(.manarGold)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.08))
                    .cornerRadius(12)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct ManarBackground: ViewModifier {
    let theme: String
    let accessory: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            if accessory {
                content.containerBackground(for: .widget) { Color.clear }
            } else {
                content.containerBackground(for: .widget) { background(theme) }
            }
        } else if accessory {
            content
        } else {
            content.padding(14).background(background(theme))
        }
    }
}

// MARK: التعريف

struct ManarPrayerWidget: Widget {
    let kind = "ManarPrayerWidget"

    private var families: [WidgetFamily] {
        var f: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge]
        if #available(iOS 16.0, *) {
            f += [.accessoryRectangular, .accessoryInline, .accessoryCircular]
        }
        return f
    }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ManarProvider()) { e in
            ManarWidgetView(entry: e)
        }
        .configurationDisplayName("منار — الصلاة القادمة")
        .description("الصلاة القادمة والوقت المتبقّي وآية اليوم.")
        .supportedFamilies(families)
    }
}

@main
struct ManarWidgetBundle: WidgetBundle {
    var body: some Widget {
        ManarPrayerWidget()
    }
}

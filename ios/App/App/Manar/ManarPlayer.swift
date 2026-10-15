import AVFoundation
import Foundation
import MediaPlayer

/// منار — مشغّل الأذان والإقامة والمعاينة الأصلي (AVAudioPlayer).
///
/// يعمل حين يصل الأذان والتطبيق في المقدّمة (فيُشغَّل الأذان كاملاً بدل مقطع
/// الإشعار)، وحين يضغط المستخدم «استمع للأذان كاملاً» من الإشعار، ولمعاينة
/// الأصوات في الإعدادات. الحالة تُبثّ لـJavaScript بحدث `manarAudioState`
/// بالشكل نفسه الذي تبثّه خدمة أندرويد.
final class ManarPlayer: NSObject, AVAudioPlayerDelegate {
    static let shared = ManarPlayer()

    /// يُستدعى بكل تغيّر حالة بأسماء خدمة أندرويد نفسها:
    /// PLAYING_AZAN | PLAYING_IQAMA | MUTED | STOPPED | IDLE
    var onState: (([String: Any]) -> Void)?

    private var player: AVAudioPlayer?
    private var queue: [String] = []
    private var current: (kind: String, title: String, key: String, volume: Float)?
    private(set) var muted = false

    var isPlaying: Bool { player?.isPlaying == true }

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self, selector: #selector(onInterruption(_:)),
            name: AVAudioSession.interruptionNotification, object: nil)
    }

    static func configureSession() {
        let s = AVAudioSession.sharedInstance()
        // playback: يُسمع الأذان حتى مع مفتاح الصامت، ويستمرّ التلاوة في الخلفية.
        try? s.setCategory(.playback, mode: .default, options: [])
    }

    /// يشغّل `raw` ثم `follow` (التثويب) إن وُجد. يعيد false إن غاب الملف.
    @discardableResult
    func play(raw: String, follow: String? = nil, volume: Double? = nil, kind: String, title: String, key: String) -> Bool {
        guard ManarSounds.fullURL(raw) != nil else { return false }
        stop(notify: false)
        muted = false
        queue = [raw]
        if let f = follow, !f.isEmpty, ManarSounds.fullURL(f) != nil { queue.append(f) }
        let v = Float(max(0.05, min(1.0, volume ?? 1.0)))
        current = (kind, title, key, v)
        return playNext()
    }

    private func playNext() -> Bool {
        guard !queue.isEmpty, let cur = current else { finish(); return false }
        let raw = queue.removeFirst()
        guard let url = ManarSounds.fullURL(raw) else { return playNext() }
        do {
            ManarPlayer.configureSession()
            try AVAudioSession.sharedInstance().setActive(true, options: [])
            let p = try AVAudioPlayer(contentsOf: url)
            p.delegate = self
            p.volume = cur.volume
            p.prepareToPlay()
            guard p.play() else { finish(); return false }
            player = p
            updateNowPlaying(title: cur.title)
            emit("playing")
            return true
        } catch {
            NSLog("[Manar] playback failed: \(error.localizedDescription)")
            ManarStore.log("playback_failed", key: cur.key, kind: cur.kind, detail: "player")
            finish()
            return false
        }
    }

    func stop(notify: Bool = true) {
        let wasActive = player != nil
        player?.stop()
        player = nil
        queue.removeAll()
        if wasActive && notify { emit("stopped") }
        if wasActive {
            current = nil
            clearNowPlaying()
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    /// كتم الصوت الجاري دون إلغاء الإشعار (زرّ «كتم» في الواجهة).
    func mute() -> Bool {
        guard let p = player else { return false }
        p.volume = 0
        muted = true
        emit("muted")
        return true
    }

    func state() -> [String: Any] {
        guard let cur = current, player != nil else { return ["state": "IDLE", "kind": "", "title": ""] }
        return ["state": muted ? "MUTED" : playingState(cur.kind), "kind": cur.kind, "title": cur.title]
    }

    private func playingState(_ kind: String) -> String {
        kind == "iqama" ? "PLAYING_IQAMA" : "PLAYING_AZAN"
    }

    // MARK: AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if !queue.isEmpty, playNext() { return }
        finish()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        finish()
    }

    private func finish() {
        player = nil
        queue.removeAll()
        if current != nil { emit("stopped") }
        current = nil
        muted = false
        clearNowPlaying()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    @objc private func onInterruption(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        // مكالمة واردة أثناء الأذان: نوقفه نهائياً بدل استئنافه في منتصف الجملة.
        if type == .began, player != nil { stop() }
    }

    private func emit(_ state: String) {
        let kind = current?.kind ?? ""
        // المعاينة لا تُظهر شريط «إيقاف الأذان» في الواجهة، كما في أندرويد.
        if kind == "preview" { return }
        let mapped: String
        switch state {
        case "playing": mapped = playingState(kind)
        case "muted": mapped = "MUTED"
        default: mapped = "STOPPED"
        }
        let d: [String: Any] = ["state": mapped, "kind": kind, "title": current?.title ?? ""]
        DispatchQueue.main.async { [weak self] in self?.onState?(d) }
    }

    // MARK: شاشة القفل

    private func updateNowPlaying(title: String) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title.isEmpty ? "منار" : title,
            MPMediaItemPropertyArtist: "منار",
        ]
    }

    private func clearNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
}

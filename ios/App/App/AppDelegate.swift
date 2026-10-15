import BackgroundTasks
import Capacitor
import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// معرّف مهمة التحديث في الخلفية — مُدرج في Info.plist ‏(BGTaskSchedulerPermittedIdentifiers).
    static let refreshTaskId = "app.manar.islamic.refresh"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // ١) مفوَّض الإشعارات قبل أي شيء — شرط Apple لاستلام نقرة فتحت التطبيق من الإغلاق.
        ManarNotify.shared.install()
        // ٢) مقاطع أصوات الإشعار إلى Library/Sounds (مرة لكل إصدار).
        ManarSounds.installIfNeeded()
        // ٣) جلسة الصوت: الأذان والتلاوة يُسمعان مع مفتاح الصامت ويستمرّان في الخلفية.
        ManarPlayer.configureSession()
        // ٤) إعادة تعبئة الجدول في الخلفية دون انتظار فتح التطبيق.
        registerBackgroundRefresh()

        let win = UIWindow(frame: UIScreen.main.bounds)
        win.backgroundColor = UIColor(manarHex: "#0B1F1A")
        win.rootViewController = ManarRootViewController()
        win.makeKeyAndVisible()
        window = win
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        ManarScheduler.reconcileDelivered()
        ManarScheduler.rearm(reason: "app_open")
        UNUserNotificationCenter.current().setBadgeCountCompat(0)
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        scheduleBackgroundRefresh()
    }

    func applicationSignificantTimeChange(_ application: UIApplication) {
        // تغيّر اليوم أو المنطقة الزمنية أو ضُبطت الساعة: الجدول المطلق يبقى صحيحاً،
        // لكن نعيد الضبط ليُبنى المشغّل بالمنطقة الجديدة.
        ManarStore.log("zone_changed", detail: TimeZone.current.identifier)
        ManarScheduler.rearm(reason: "time_change")
    }

    // MARK: BGAppRefresh

    private func registerBackgroundRefresh() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTaskId, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.scheduleBackgroundRefresh()
            refresh.expirationHandler = { refresh.setTaskCompleted(success: false) }
            ManarScheduler.reconcileDelivered()
            ManarScheduler.rearm(reason: "background") { _ in
                refresh.setTaskCompleted(success: true)
            }
        }
    }

    func scheduleBackgroundRefresh() {
        let req = BGAppRefreshTaskRequest(identifier: Self.refreshTaskId)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 3600)
        do {
            try BGTaskScheduler.shared.submit(req)
        } catch {
            NSLog("[Manar] BG refresh submit failed: \(error.localizedDescription)")
        }
    }

    // MARK: Capacitor

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // نقر الويدجت: manar://prayer ← /prayer
        if url.scheme == "manar" {
            let path = "/" + (url.host ?? "") + url.path
            ManarNotify.shared.openRoute(path == "/" ? "/" : path)
            return true
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return .portrait
    }
}

extension UNUserNotificationCenter {
    func setBadgeCountCompat(_ n: Int) {
        if #available(iOS 16.0, *) {
            setBadgeCount(n) { _ in }
        } else {
            DispatchQueue.main.async { UIApplication.shared.applicationIconBadgeNumber = n }
        }
    }
}

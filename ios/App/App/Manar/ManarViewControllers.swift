import Capacitor
import UIKit
import WebKit

/// منار — الحاوية الجذرية.
///
/// واجهة منار صُمّمت لتُعرض داخل المنطقة الآمنة (كما في أندرويد بهوامش
/// edge-to-edge). فنضع WKWebView داخل المنطقة الآمنة تماماً — لا تحت الشقّ أو
/// «الجزيرة الديناميكية» ولا تحت مؤشّر الرئيسية — ونلوّن ما حوله بلون السمة
/// الحالية (تضبطه الواجهة عبر `ManarAdhan.setSystemBars`).
final class ManarRootViewController: UIViewController {
    let bridgeController = ManarBridgeViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(manarHex: "#0B1F1A")
        addChild(bridgeController)
        let v = bridgeController.view!
        v.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(v)
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            v.topAnchor.constraint(equalTo: g.topAnchor),
            v.bottomAnchor.constraint(equalTo: g.bottomAnchor),
            v.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            v.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        bridgeController.didMove(toParent: self)
    }

    func setChrome(hex: String) {
        let c = UIColor(manarHex: hex)
        UIView.animate(withDuration: 0.2) {
            self.view.backgroundColor = c
            self.bridgeController.webView?.backgroundColor = c
            self.bridgeController.webView?.scrollView.backgroundColor = c
        }
    }

    // شريط الحالة تتحكّم فيه إضافة StatusBar عبر متحكّم الجسر.
    override var childForStatusBarStyle: UIViewController? { bridgeController }
    override var childForStatusBarHidden: UIViewController? { bridgeController }
    override var childForHomeIndicatorAutoHidden: UIViewController? { bridgeController }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }
}

/// متحكّم جسر Capacitor مع تسجيل الإضافة الأصلية وضبط WKWebView لـiPhone.
final class ManarBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ManarAdhanPlugin())
        // الجسر يضبط موجّه إشعاراته مفوَّضاً؛ نستعيد موقعنا ونمرّر له غير إشعارات منار.
        ManarNotify.shared.attach(router: bridge?.notificationRouter)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let wv = webView else { return }
        let bg = UIColor(manarHex: "#0B1F1A")
        wv.isOpaque = false
        wv.backgroundColor = bg
        wv.scrollView.backgroundColor = bg
        // السحب من حافة الشاشة للرجوع — الإيماءة المألوفة في iPhone بدل زر الرجوع في أندرويد.
        wv.allowsBackForwardNavigationGestures = true
        // لا ارتداد مطّاطي يكشف ما خلف الواجهة، ولا تكبير بالقرص يكسر التخطيط.
        wv.scrollView.bounces = false
        wv.scrollView.alwaysBounceVertical = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.pinchGestureRecognizer?.isEnabled = false
        // لا معاينة روابط بالضغط المطوّل (تفتح Safari داخل التطبيق).
        wv.allowsLinkPreview = false
        if #available(iOS 16.4, *) {
            wv.isInspectable = false
        }
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
}

extension UIColor {
    convenience init(manarHex: String) {
        var s = manarHex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        let r, g, b, a: CGFloat
        switch s.count {
        case 8:
            r = CGFloat((v >> 24) & 0xFF) / 255; g = CGFloat((v >> 16) & 0xFF) / 255
            b = CGFloat((v >> 8) & 0xFF) / 255; a = CGFloat(v & 0xFF) / 255
        case 6:
            r = CGFloat((v >> 16) & 0xFF) / 255; g = CGFloat((v >> 8) & 0xFF) / 255
            b = CGFloat(v & 0xFF) / 255; a = 1
        default:
            r = 0.043; g = 0.122; b = 0.102; a = 1
        }
        self.init(red: r, green: g, blue: b, alpha: a)
    }
}

import UIKit
import WebKit
import Network

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let win = UIWindow(frame: UIScreen.main.bounds)
        win.backgroundColor = UIColor(red: 0.043, green: 0.071, blue: 0.149, alpha: 1)
        win.rootViewController = WebViewController()
        win.makeKeyAndVisible()
        window = win
        return true
    }
}

final class WebViewController: UIViewController {
    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.071, blue: 0.149, alpha: 1)

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        cfg.websiteDataStore = .default()

        webView = WKWebView(frame: view.bounds, configuration: cfg)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        view.addSubview(webView)

        let port = FileServer.shared.start()
        if port > 0 {
            let url = URL(string: "http://127.0.0.1:\(port)/index.html")!
            webView.load(URLRequest(url: url))
        } else {
            let label = UILabel(frame: view.bounds)
            label.text = "Не удалось запустить приложение.\nПереустановите его через Sideloadly."
            label.numberOfLines = 0
            label.textAlignment = .center
            label.textColor = .white
            view.addSubview(label)
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}

/// Маленький HTTP-сервер на 127.0.0.1: нужен, чтобы у страницы был настоящий origin
/// (localStorage, fetch к ntfy, офлайн-кэш).
final class FileServer {
    static let shared = FileServer()
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "dnevnik.server")
    private let root: URL
    private(set) var port: UInt16 = 0

    private init() {
        root = Bundle.main.bundleURL
    }

    func start() -> UInt16 {
        let candidates: [UInt16] = [8734, 8735, 8736, 8737, 0]
        for p in candidates {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            do {
                let l: NWListener
                if p == 0 {
                    l = try NWListener(using: params)
                } else {
                    guard let ep = NWEndpoint.Port(rawValue: p) else { continue }
                    l = try NWListener(using: params, on: ep)
                }
                listener = l
                l.newConnectionHandler = { [weak self] conn in self?.handle(conn) }
                var ready: UInt16 = 0
                let sem = DispatchSemaphore(value: 0)
                l.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        ready = l.port?.rawValue ?? 0
                        sem.signal()
                    case .failed, .cancelled:
                        sem.signal()
                    default:
                        break
                    }
                }
                l.start(queue: queue)
                _ = sem.wait(timeout: .now() + 2)
                if ready > 0 {
                    port = ready
                    return ready
                }
                l.cancel()
            } catch {
                continue
            }
        }
        return 0
    }

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        conn.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, _, _ in
            guard let self = self,
                  let d = data,
                  let text = String(data: d, encoding: .utf8),
                  let first = text.components(separatedBy: "\r\n").first else {
                conn.cancel()
                return
            }
            let parts = first.components(separatedBy: " ")
            var path = parts.count > 1 ? parts[1] : "/"
            if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
            if path == "/" { path = "/index.html" }
            if path.contains("..") {
                self.respond(conn, 403, "text/plain; charset=utf-8", Data("Forbidden".utf8))
                return
            }
            let file = self.root.appendingPathComponent(String(path.dropFirst()))
            if let body = try? Data(contentsOf: file) {
                self.respond(conn, 200, self.mime(file.pathExtension), body)
            } else {
                self.respond(conn, 404, "text/plain; charset=utf-8", Data("Not Found".utf8))
            }
        }
    }

    private func respond(_ conn: NWConnection, _ code: Int, _ type: String, _ body: Data) {
        let reason = code == 200 ? "OK" : (code == 403 ? "Forbidden" : "Not Found")
        let head = "HTTP/1.1 \(code) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js": return "application/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        default: return "application/octet-stream"
        }
    }
}

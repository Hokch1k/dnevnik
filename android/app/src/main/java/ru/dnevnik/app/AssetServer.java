package ru.dnevnik.app;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;

/**
 * Крошечный HTTP-сервер на 127.0.0.1, который раздаёт файлы приложения.
 * Нужен, чтобы WebView работал с настоящим origin (localStorage, service worker, fetch).
 * Никаких зависимостей от Android — только java.*, поэтому проверяется обычным javac.
 */
public class AssetServer {

    /** Источник файлов: обёртка над AssetManager в приложении, папка в тестах. */
    public interface Source {
        byte[] read(String path) throws IOException;
    }

    private final Source source;
    private final String root;
    private ServerSocket serverSocket;
    private volatile boolean running;
    private Thread acceptor;

    public AssetServer(Source source, String root) {
        this.source = source;
        this.root = root.endsWith("/") ? root : root + "/";
    }

    public int start() {
        try {
            serverSocket = new ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"));
            running = true;
            acceptor = new Thread(new Runnable() {
                @Override
                public void run() {
                    acceptLoop();
                }
            }, "dnevnik-assets");
            acceptor.setDaemon(true);
            acceptor.start();
            return serverSocket.getLocalPort();
        } catch (IOException e) {
            return -1;
        }
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
    }

    public String baseUrl() {
        return serverSocket == null ? null : "http://127.0.0.1:" + serverSocket.getLocalPort();
    }

    private void acceptLoop() {
        while (running) {
            Socket socket = null;
            try {
                socket = serverSocket.accept();
                handle(socket);
            } catch (IOException e) {
                if (!running) return;
            } catch (RuntimeException e) {
                // не роняем сервер из-за одного плохого запроса
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (IOException ignored) {
                    }
                }
            }
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(8000);
            InputStream in = socket.getInputStream();
            String head = readHead(in);
            if (head == null) return;

            int lineEnd = head.indexOf("\r\n");
            String requestLine = lineEnd >= 0 ? head.substring(0, lineEnd) : head;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2 || !"GET".equals(parts[0])) {
                respond(socket, 405, "text/plain; charset=utf-8", "Method Not Allowed".getBytes("UTF-8"));
                return;
            }

            String target = parts[1];
            int q = target.indexOf('?');
            if (q >= 0) target = target.substring(0, q);
            int h = target.indexOf('#');
            if (h >= 0) target = target.substring(0, h);

            target = URLDecoder.decode(target, "UTF-8");
            if (target.equals("/") || target.isEmpty()) target = "/index.html";
            if (!target.startsWith("/")) target = "/" + target;
            if (target.contains("..")) {
                respond(socket, 403, "text/plain; charset=utf-8", "Forbidden".getBytes("UTF-8"));
                return;
            }

            String path = root + target.substring(1);
            byte[] body;
            try {
                body = source.read(path);
            } catch (IOException e) {
                respond(socket, 404, "text/plain; charset=utf-8", "Not Found".getBytes("UTF-8"));
                return;
            }
            respond(socket, 200, mimeOf(path), body);
        } catch (Exception e) {
            // соединение оборвалось — ничего страшного
        }
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(1024);
        int matched = 0;
        int b;
        while ((b = in.read()) != -1) {
            buf.write(b);
            if ((matched == 0 || matched == 2) && b == '\r') matched++;
            else if ((matched == 1 || matched == 3) && b == '\n') matched++;
            else matched = 0;
            if (matched == 4) break;
            if (buf.size() > 16384) break;
        }
        if (buf.size() == 0) return null;
        return new String(buf.toByteArray(), "UTF-8");
    }

    private void respond(Socket socket, int code, String type, byte[] body) throws IOException {
        String reason = code == 200 ? "OK" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : "Error";
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        sb.append("Content-Type: ").append(type).append("\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Cache-Control: no-cache\r\n");
        sb.append("Connection: close\r\n\r\n");

        OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 8192);
        out.write(sb.toString().getBytes("UTF-8"));
        out.write(body);
        out.flush();
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json; charset=utf-8";
        if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".apk")) return "application/vnd.android.package-archive";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}

import ru.dnevnik.app.AssetServer;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Проверка HTTP-слоя AssetServer без Android: javac + java. */
public class ServerTest {

    static int failures = 0;

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("dnevnik-assets-");
        Files.write(dir.resolve("index.html"), "<!doctype html><title>t</title>".getBytes(StandardCharsets.UTF_8));
        Files.write(dir.resolve("data.json"), "{\"days\":[]}".getBytes(StandardCharsets.UTF_8));
        Files.write(dir.resolve("icon.svg"), "<svg/>".getBytes(StandardCharsets.UTF_8));

        final Path root = dir;
        AssetServer server = new AssetServer(new AssetServer.Source() {
            @Override
            public byte[] read(String path) throws IOException {
                Path p = root.resolve(path);
                if (!p.normalize().startsWith(root)) throw new IOException("outside root");
                return Files.readAllBytes(p);
            }
        }, "www");

        // файлы лежат в assets/www — воспроизводим это расположение
        Path www = dir.resolve("www");
        Files.createDirectories(www);
        Files.move(dir.resolve("index.html"), www.resolve("index.html"));
        Files.move(dir.resolve("data.json"), www.resolve("data.json"));
        Files.move(dir.resolve("icon.svg"), www.resolve("icon.svg"));

        int port = server.start();
        if (port <= 0) {
            System.out.println("FAIL: сервер не запустился");
            System.exit(1);
        }
        String base = "http://127.0.0.1:" + port;
        System.out.println("server: " + base);

        check("GET /", base + "/", 200, "text/html", "<!doctype");
        check("GET /index.html?x=1", base + "/index.html?x=1", 200, "text/html", "<!doctype");
        check("GET /data.json", base + "/data.json", 200, "application/json", "days");
        check("GET /icon.svg", base + "/icon.svg", 200, "image/svg+xml", "<svg");
        check("GET /missing", base + "/missing.txt", 404, "text/plain", "Not Found");
        check("GET /../private", base + "/../private.txt", 403, "text/plain", "Forbidden");
        check("GET /a/../../x", base + "/a/../../x", 403, "text/plain", "Forbidden");

        server.stop();
        System.out.println(failures == 0 ? "ALL PASS" : failures + " FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }

    static void check(String name, String url, int wantStatus, String wantType, String wantBody) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(3000);
        c.setInstanceFollowRedirects(false);
        int status = c.getResponseCode();
        String type = String.valueOf(c.getContentType());
        InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = is == null ? "" : read(is);
        boolean ok = status == wantStatus && type.contains(wantType) && body.contains(wantBody);
        if (!ok) failures++;
        System.out.println((ok ? "PASS " : "FAIL ") + name + " -> " + status + " " + type
                + (ok ? "" : " (want " + wantStatus + " " + wantType + " body~" + wantBody + ", got body " + preview(body) + ")"));
        c.disconnect();
    }

    static String read(InputStream is) throws IOException {
        StringBuilder sb = new StringBuilder();
        BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
        String line;
        while ((line = r.readLine()) != null) sb.append(line).append('\n');
        r.close();
        return sb.toString();
    }

    static String preview(String s) {
        String t = s.replace("\n", " ");
        return t.length() > 60 ? t.substring(0, 60) + "..." : t;
    }
}

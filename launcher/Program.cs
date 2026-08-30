// 尘年往事 · 启动器
// 职责：
//   1. 在本机 127.0.0.1 上起一个极简静态文件服务器，服务 app/ 目录（手札日记前端）。
//   2. 用 Edge 的“应用模式”（--app）打开一个独立、无浏览器样子的窗口指向该服务器。
//   3. 应用窗口关闭（Edge 进程退出）时自动退出，不留后台进程。
// 完全离线：不依赖任何网络资源，不写注册表，数据都在自身目录的 data/ 下。

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;

internal static class Program
{
    private const int PreferredPort = 38613;

    [STAThread]
    private static void Main()
    {
        string exeDir = AppContext.BaseDirectory;
        string appDir = Path.Combine(exeDir, "app");
        string dataDir = Path.Combine(exeDir, "data");

        if (!Directory.Exists(appDir))
        {
            _ = MessageBox.Show(
                "未找到应用资源目录 app/。\n请保持「尘年往事.exe」与其旁的 app 文件夹在一起。",
                "尘年往事",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        try { Directory.CreateDirectory(dataDir); } catch { /* 忽略：只读目录也能运行，只是数据不能持久化 */ }

        // 尝试在首选端口起服务器；若被占用（说明上一个实例还活着），直接复用。
        int port = StartServerIfPossible(appDir, PreferredPort);
        if (port < 0)
        {
            // 端口被占用：视为“已有实例在运行”，直接打开窗口指向它。
            OpenAppWindow(PreferredPort, dataDir);
            return;
        }

        // 本实例就是服务器，等待关闭信标或超时后退出。
        OpenAppWindow(port, dataDir);
        WaitForShutdown();
    }

    private static int StartServerIfPossible(string appDir, int port)
    {
        try
        {
            var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            _ = Task.Run(() => ServeLoop(listener, appDir));
            return port;
        }
        catch (SocketException)
        {
            return -1; // 端口被占用
        }
    }

    private static void OpenAppWindow(int port, string dataDir)
    {
        string? edge = FindEdge();
        string url = $"http://127.0.0.1:{port}/";
        if (edge != null)
        {
            var psi = new ProcessStartInfo(edge)
            {
                UseShellExecute = true,
                Arguments =
                    $"--app=\"{url}\" " +
                    $"--user-data-dir=\"{dataDir}\" " +
                    "--no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2"
            };
            try { _appProcess = Process.Start(psi); return; } catch { /* 走兜底 */ }
        }
        // 兜底：用默认浏览器打开（普通标签页也能用）。
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch { /* 静默失败 */ }
    }

    private static string? FindEdge()
    {
        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe")
        };
        foreach (string c in candidates)
            if (File.Exists(c)) return c;
        // 注册表兜底
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe");
            string? p = key?.GetValue(null) as string;
            if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p!;
        }
        catch { }
        return null;
    }

    // ── 极简 HTTP 静态服务器 ────────────────────────────────────────────────

    private static Process? _appProcess;

    private static void ServeLoop(TcpListener listener, string appDir)
    {
        while (true)
        {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); }
            catch { break; }
            _ = Task.Run(() => HandleClient(client, appDir));
        }
        try { listener.Stop(); } catch { }
        Environment.Exit(0);
    }

    private static void HandleClient(TcpClient client, string appDir)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 5000;
                using var stream = client.GetStream();
                byte[] headerBuf = ReadRequestHead(stream);
                if (headerBuf.Length == 0) return;
                string head = Encoding.UTF8.GetString(headerBuf);
                string[] lines = head.Split("\r\n");
                string[] parts = lines.Length > 0 ? lines[0].Split(' ') : Array.Empty<string>();
                if (parts.Length < 2) return;
                string method = parts[0];
                string rawPath = parts[1];

                if (method is "GET" or "HEAD")
                {
                    string path = rawPath.Split('?')[0];
                    if (path == "/__shutdown__") { /* GET 也允许触发关闭 */ }
                    string local = Uri.UnescapeDataString(path).Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
                    if (local.Length == 0) local = "index.html";
                    string full = Path.GetFullPath(Path.Combine(appDir, local));
                    // 边界判断必须带分隔符：纯前缀比较会把 "C:\dir-app" 误判为 "C:\dir" 内的路径
                    string root = Path.GetFullPath(appDir);
                    bool inside = full.Equals(root, StringComparison.OrdinalIgnoreCase)
                               || full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
                    if (!inside)
                    {
                        WriteSimple(stream, 403, "Forbidden");
                        return;
                    }
                    if (File.Exists(full))
                    {
                        byte[] body = File.ReadAllBytes(full);
                        WriteResponse(stream, 200, MimeOf(full), body, method == "HEAD");
                    }
                    else
                    {
                        WriteSimple(stream, 404, "Not Found");
                    }
                }
                else if (method == "POST" && rawPath.Split('?')[0] == "/__shutdown__")
                {
                    // 兼容旧信标：不再靠它关停（刷新页面也会触发，会误杀启动器）
                    WriteSimple(stream, 204, null);
                    return;
                }
                else
                {
                    WriteSimple(stream, 405, "Method Not Allowed");
                }
            }
            catch
            {
                // 单个连接的异常不影响服务器
            }
        }
    }

    private static byte[] ReadRequestHead(NetworkStream stream)
    {
        using var ms = new MemoryStream();
        byte[] buf = new byte[4096];
        while (true)
        {
            int n = stream.Read(buf, 0, buf.Length);
            if (n <= 0) break;
            ms.Write(buf, 0, n);
            string s = Encoding.UTF8.GetString(ms.ToArray());
            if (s.Contains("\r\n\r\n") || s.Contains("\n\n")) break;
            if (ms.Length > 64 * 1024) break;
        }
        return ms.ToArray();
    }

    private static void WriteSimple(NetworkStream stream, int code, string? text)
    {
        byte[] body = text == null ? Array.Empty<byte>() : Encoding.UTF8.GetBytes(text);
        WriteResponse(stream, code, "text/plain; charset=utf-8", body, false);
    }

    private static void WriteResponse(NetworkStream stream, int code, string contentType, byte[] body, bool headOnly)
    {
        string reason = code switch { 200 => "OK", 403 => "Forbidden", 404 => "Not Found", 405 => "Method Not Allowed", 204 => "No Content", _ => "OK" };
        var sb = new StringBuilder();
        sb.Append($"HTTP/1.1 {code} {reason}\r\n");
        sb.Append($"Content-Type: {contentType}\r\n");
        sb.Append($"Content-Length: {body.Length}\r\n");
        sb.Append("Connection: close\r\n");
        sb.Append("Cache-Control: no-cache\r\n");
        sb.Append("X-Content-Type-Options: nosniff\r\n\r\n");
        byte[] head = Encoding.ASCII.GetBytes(sb.ToString());
        stream.Write(head, 0, head.Length);
        if (!headOnly && body.Length > 0) stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    private static string MimeOf(string path)
    {
        string ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".html" or ".htm" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" or ".mjs" => "text/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".svg" => "image/svg+xml",
            ".ico" => "image/x-icon",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            ".ttf" => "font/ttf",
            ".otf" => "font/otf",
            ".txt" => "text/plain; charset=utf-8",
            ".map" => "application/json; charset=utf-8",
            _ => "application/octet-stream"
        };
    }

    private static void WaitForShutdown()
    {
        // 窗口关闭（Edge 应用进程退出）即退出。不用 beforeunload 信标，
        // 避免页面刷新/重载时误杀启动器。
        if (_appProcess == null)
        {
            // 兜底（没找到 Edge 时）：2 小时后退出，避免留下孤儿进程
            DateTime last = DateTime.UtcNow;
            while (DateTime.UtcNow - last < TimeSpan.FromMinutes(120)) Thread.Sleep(5000);
            return;
        }
        while (!_appProcess.HasExited) Thread.Sleep(1000);
    }
}

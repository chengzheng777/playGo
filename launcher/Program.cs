using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    private static string baseDir;
    private static Process server;
    private static NotifyIcon tray;
    private static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
    private const string HealthUrl = "http://127.0.0.1:8787/api/health";

    [STAThread]
    private static void Main()
    {
        bool created;
        using (var mutex = new Mutex(true, "playGoLauncher", out created))
        {
            if (!created)
            {
                OpenWindow();
                return;
            }

            Application.EnableVisualStyles();
            baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Log("boot");

            Application.ThreadException += (s, e) => Log("thread exception: " + e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Log("unhandled: " + e.ExceptionObject);

            if (!StartServer())
            {
                MessageBox.Show("没有找到 runtime\\node.exe，请确认解压完整。", "playGo",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            Log("server started");

            if (!WaitForServer(25000))
            {
                MessageBox.Show("服务启动失败，请检查是否有安全软件拦截。", "playGo",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                StopServer();
                return;
            }
            Log("health ok");

            OpenWindow();
            Log("window requested");

            try
            {
                SetupTray();
                Log("tray ok");
            }
            catch (Exception error)
            {
                Log("tray failed: " + error.Message);
            }

            Application.ApplicationExit += (s, e) =>
            {
                if (tray != null) tray.Visible = false;
                StopServer();
            };
            Application.Run();
            Log("exit");
        }
    }

    private static void Log(string message)
    {
        try
        {
            File.AppendAllText(Path.Combine(baseDir, "launcher.log"),
                DateTime.Now.ToString("HH:mm:ss") + " " + message + Environment.NewLine);
        }
        catch
        {
            // 忽略
        }
    }

    private static bool StartServer()
    {
        string node = Path.Combine(baseDir, "runtime", "node.exe");
        string script = Path.Combine(baseDir, "app", "server.mjs");
        if (!File.Exists(node) || !File.Exists(script)) return false;

        var info = new ProcessStartInfo
        {
            FileName = node,
            Arguments = "\"" + script + "\" --prod",
            WorkingDirectory = baseDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        info.EnvironmentVariables["PLAYGO_ROOT"] = Path.Combine(baseDir, "app");
        info.EnvironmentVariables["PLAYGO_PROD"] = "1";

        server = Process.Start(info);
        return server != null;
    }

    private static bool WaitForServer(int timeoutMs)
    {
        var started = Environment.TickCount;
        while (Environment.TickCount - started < timeoutMs)
        {
            try
            {
                var response = http.GetAsync(HealthUrl).Result;
                if (response.IsSuccessStatusCode) return true;
            }
            catch
            {
                // 还没起来
            }
            Thread.Sleep(300);
        }
        return false;
    }

    private static string FindBrowser()
    {
        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        foreach (var path in candidates)
        {
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static void OpenWindow()
    {
        string browser = FindBrowser();
        string processName = browser != null ? Path.GetFileNameWithoutExtension(browser) : "";
        bool browserRunning = processName.Length > 0 &&
                              Process.GetProcessesByName(processName).Length > 0;

        if (browser != null && browserRunning)
        {
            const string args = "--app=http://127.0.0.1:8787 --window-size=1280,860 --no-first-run";
            try
            {
                var process = Process.Start(new ProcessStartInfo
                {
                    FileName = browser,
                    Arguments = args,
                    UseShellExecute = true,
                });
                Log("app window requested: " + browser + " pid=" + (process != null ? process.Id : 0));

                if (process == null || !process.WaitForExit(2500))
                {
                    return;
                }
                Log("app window exited early: code=" + process.ExitCode);
            }
            catch (Exception error)
            {
                Log("app window failed: " + error.Message);
            }
        }

        try
        {
            Process.Start(new ProcessStartInfo("http://127.0.0.1:8787")
            {
                UseShellExecute = true,
            });
            Log("default browser opened");
        }
        catch (Exception error)
        {
            Log("default browser failed: " + error.Message);
            MessageBox.Show("打不开浏览器，请手动访问 http://localhost:8787", "playGo");
        }
    }

    private static void SetupTray()
    {
        tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Visible = true,
            Text = "playGo",
        };
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开游戏窗口", null, (s, e) => OpenWindow());
        menu.Items.Add("在浏览器中打开", null, (s, e) => Process.Start("http://127.0.0.1:8787"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, (s, e) => Application.Exit());
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (s, e) => OpenWindow();
    }

    private static void StopServer()
    {
        try
        {
            if (server != null && !server.HasExited)
            {
                server.Kill();
                server.WaitForExit(3000);
            }
        }
        catch
        {
            // 忽略
        }
    }
}

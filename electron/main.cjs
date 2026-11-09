const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require("electron");

app.setName("playGo");
app.setAppUserModelId("com.playgo.app");
app.disableHardwareAcceleration();

// 安装到 Program Files 时 exe 目录不可写，日志统一放到用户数据目录。
const LOG_FILE = path.join(app.getPath("userData"), "playgo-electron.log");
function log(...args) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${args.join(" ")}\n`);
  } catch {
    /* ignore */
  }
}

process.on("uncaughtException", (error) => log("uncaughtException", error?.stack ?? String(error)));
process.on("unhandledRejection", (error) =>
  log("unhandledRejection", error?.stack ?? String(error)),
);

log("boot", process.argv.join(" "));
log("appPath", app.getAppPath());
log("resources", process.resourcesPath);

// asar 里的 __dirname 不能直接当文件路径用：服务端与前端产物由 electron-builder
// 作为 extraResources 放到 resources/app（asar 外），这里按打包/开发两种形态取路径。
const RESOURCES = app.isPackaged
  ? path.join(process.resourcesPath, "app")
  : path.join(__dirname, "app");
const BASE_PORT = 8787;
const PORT_COUNT = 10;

let win = null;
let server = null;
let quitting = false;

async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(700),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.app === "playGo" ? data : null;
  } catch {
    return null;
  }
}

async function findServer() {
  for (let port = BASE_PORT; port < BASE_PORT + PORT_COUNT; port++) {
    const info = await health(port);
    if (info) return { port, info };
  }
  return null;
}

async function startServer() {
  const existing = await findServer();
  if (existing) {
    log("reuse server", existing.port);
    return existing.port;
  }

  const env = {
    ...process.env,
    PORT: String(BASE_PORT),
    PLAYGO_ROOT: RESOURCES,
    PLAYGO_PROD: "1",
  };
  log("fork", path.join(RESOURCES, "server.mjs"));
  server = utilityProcess.fork(path.join(RESOURCES, "server.mjs"), ["--prod"], {
    env,
    stdio: "ignore",
  });
  server.on("exit", (code) => {
    log("server exit", String(code));
    if (quitting) return;
    if (code !== 0) {
      dialog.showErrorBox("playGo 服务异常退出", `退出码 ${code}，请重新打开应用。`);
      app.quit();
    }
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const found = await findServer();
    if (found) {
      log("server ready", found.port);
      return found.port;
    }
  }
  throw new Error("服务启动超时");
}

function createWindow(port) {
  log("createWindow", port);
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: "playGo",
    backgroundColor: "#0b1220",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    log("ready-to-show");
    win.show();
  });
  win.on("closed", () => {
    win = null;
  });
  win.webContents.on("did-fail-load", (_event, code, description) => {
    log("did-fail-load", code, description);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(`http://127.0.0.1:${port}`).catch((error) => log("loadURL error", String(error)));
}

let updaterTimer = null;

/**
 * 自动更新只在安装版里启用：
 * - 构建时设置了 PLAYGO_UPDATE_URL，electron-builder 会生成 app-update.yml；
 * - 也可以在运行时用 PLAYGO_UPDATE_URL 临时覆盖更新源（方便测试）。
 * 便携版 / 开发模式没有 app-update.yml，直接跳过。
 */
function setupUpdater() {
  if (!app.isPackaged) return;

  const override = process.env.PLAYGO_UPDATE_URL?.trim();
  const configFile = path.join(process.resourcesPath, "app-update.yml");
  if (!override && !fs.existsSync(configFile)) {
    log("updater disabled: no feed configured");
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (error) {
    log("updater unavailable", error?.message ?? String(error));
    return;
  }

  autoUpdater.logger = {
    info: (...args) => log("updater", ...args),
    warn: (...args) => log("updater", ...args),
    error: (...args) => log("updater", ...args),
    debug: () => undefined,
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  if (override) {
    autoUpdater.setFeedURL({ provider: "generic", url: override.replace(/\/+$/, "") });
  }

  autoUpdater.on("update-available", (info) => log("update available", info?.version));
  autoUpdater.on("update-not-available", () => log("update not available"));
  autoUpdater.on("update-downloaded", (info) => {
    log("update downloaded", info?.version);
    const options = {
      type: "info",
      title: "playGo 更新",
      message: `新版本 ${info?.version ?? ""} 已下载`,
      detail: "重启后会自动完成安装。",
      buttons: ["立即重启", "稍后"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const ask = win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
    ask.then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on("error", (error) => log("updater error", error?.message ?? String(error)));

  const check = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      log("updater check failed", error?.message ?? String(error));
    });
  };
  // 不阻塞启动；之后每 6 小时再查一次。
  setTimeout(check, 10_000).unref?.();
  updaterTimer = setInterval(check, 6 * 60 * 60 * 1000);
  updaterTimer.unref?.();
}

const locked = app.requestSingleInstanceLock();
log("singleInstanceLock", String(locked));

if (!locked) {
  log("quit: lock not acquired");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    log("whenReady", "version", app.getVersion(), "packaged", String(app.isPackaged));
    Menu.setApplicationMenu(null);
    try {
      const port = await startServer();
      createWindow(port);
      setupUpdater();
    } catch (error) {
      log("startup failed", error?.stack ?? String(error));
      dialog.showErrorBox("playGo 启动失败", String(error?.message ?? error));
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    log("window-all-closed");
    app.quit();
  });
  app.on("before-quit", () => {
    log("before-quit");
    quitting = true;
    if (updaterTimer) clearInterval(updaterTimer);
    server?.kill();
  });
}

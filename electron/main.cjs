const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require("electron");
app.disableHardwareAcceleration();

const LOG_FILE = path.join(path.dirname(process.execPath), "playgo-electron.log");
function log(...args) {
  try {
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

const RESOURCES = path.join(app.getAppPath(), "app");
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
    log("whenReady");
    Menu.setApplicationMenu(null);
    try {
      const port = await startServer();
      createWindow(port);
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
    server?.kill();
  });
}

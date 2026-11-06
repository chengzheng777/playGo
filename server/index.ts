import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { WebSocketServer } from "ws";
import { firewallStatus, openFirewall } from "./firewall";
import { Hub } from "./hub";
import { lanAddresses } from "./net";
import { qrSvg } from "./qr";
import { RoomManager } from "./rooms";

const root = process.env.PLAYGO_ROOT ? path.resolve(process.env.PLAYGO_ROOT) : process.cwd();
const distDir = path.join(root, "dist");

const isProd = process.argv.includes("--prod") || process.env.PLAYGO_PROD === "1";
const basePort = Number(process.env.PORT ?? 8787);
const PORT_SPAN = 10;
const bindHost = process.env.PLAYGO_HOST?.trim() || "0.0.0.0";

function normalizePublicUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const publicUrl = normalizePublicUrl(process.env.PLAYGO_PUBLIC_URL);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "0.0.0.0");
  });
}

async function pickPort(): Promise<number> {
  for (let port = basePort; port < basePort + PORT_SPAN; port++) {
    if (await portFree(port)) return port;
  }
  throw new Error(`端口 ${basePort}-${basePort + PORT_SPAN - 1} 都被占用了`);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendFile(res: http.ServerResponse, file: string): void {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(res: http.ServerResponse, pathname: string): void {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";

  const file = path.join(distDir, path.normalize(rel));
  if (!file.startsWith(distDir)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    sendFile(res, file);
    return;
  }

  const index = path.join(distDir, "index.html");
  if (path.extname(rel) === "" && fs.existsSync(index)) {
    sendFile(res, index);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
}

const port = await pickPort();
const rooms = new RoomManager();
const buildId = crypto.randomUUID();
const hub = new Hub(rooms, buildId);
const firewall = await firewallStatus({ port });

let vite: import("vite").ViteDevServer | undefined;
if (!isProd) {
  const { createServer } = await import("vite");
  vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
    logLevel: "warn",
  });
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isLocalRequest(req: http.IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function visibleLanUrls() {
  return isLoopback(bindHost) ? [] : lanAddresses();
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);

  try {
    if (url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        app: "playGo",
        version: "0.2.0",
        port,
        rooms: rooms.size,
        buildId,
        host: bindHost,
        publicUrl,
      });
      return;
    }

    if (url.pathname === "/api/networks") {
      json(res, 200, { port, urls: visibleLanUrls(), host: bindHost, publicUrl });
      return;
    }

    if (url.pathname === "/api/firewall") {
      json(res, 200, await firewallStatus({ port }));
      return;
    }

    if (url.pathname === "/api/firewall/open" && req.method === "POST") {
      // 放行会弹 UAC，只允许本机（电脑上的浏览器）触发，手机端不行
      if (!isLocalRequest(req)) {
        json(res, 403, { error: "local only" });
        return;
      }
      json(res, 200, await openFirewall(port));
      return;
    }

    if (url.pathname === "/api/rooms") {
      json(res, 200, { rooms: rooms.list() });
      return;
    }

    if (url.pathname === "/api/qr") {
      const text = url.searchParams.get("text") ?? "";
      if (!/^https?:\/\/[^\s]{1,500}$/.test(text)) {
        json(res, 400, { error: "invalid text" });
        return;
      }
      const svg = await qrSvg(text);
      res.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(svg);
      return;
    }

    if (isProd) {
      serveStatic(res, url.pathname);
      return;
    }

    vite?.middlewares(req, res, () => {
      if (!res.headersSent) res.writeHead(404).end("not found");
    });
  } catch (error) {
    console.error("[http]", error);
    if (!res.headersSent) json(res, 500, { error: "internal" });
    else res.end();
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
wss.on("connection", (ws) => hub.attach(ws));

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

const heartbeat = setInterval(() => hub.sweep(), 30_000);
const sweeper = setInterval(() => rooms.sweepEmpty(), 30_000);
const gameTicker = setInterval(() => hub.tickGames(), 500);
heartbeat.unref();
sweeper.unref();
gameTicker.unref();

server.listen(port, bindHost, () => {
  const urls = visibleLanUrls();
  console.log("");
  console.log("  playGo 已启动");
  console.log(`  本机    http://localhost:${port}`);
  for (const item of urls) {
    console.log(`  局域网  http://${item.ip}:${port}  (${item.iface})`);
  }
  if (urls.length === 0) {
    console.log("  局域网  未检测到可用网卡，手机可能连不上");
  }
  if (firewall.applicable && firewall.allowed === false) {
    console.log("  防火墙  未放行本程序，手机扫码会一直转圈");
    console.log(
      "          右键“修复防火墙.cmd”→“以管理员身份运行”，或开房后点二维码下方的“一键放行”",
    );
  }
  console.log("");
  console.log(isProd ? "  生产模式：静态资源来自 dist/" : "  开发模式：Vite 中间件 + HMR");
  console.log(
    bindHost === "0.0.0.0"
      ? "  监听    所有网卡（局域网可访问；公网需端口映射或内网穿透）"
      : `  监听    仅 ${bindHost}`,
  );
  if (publicUrl) {
    console.log(`  公网    ${publicUrl}`);
    console.log("  提醒    拿到公网链接的人都能加入，不需要时请关闭穿透");
  }
  console.log("");

  if (process.argv.includes("--open")) {
    const url = `http://localhost:${port}`;
    const command =
      process.platform === "win32"
        ? `start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    spawn(command, { shell: true, detached: true, stdio: "ignore" }).unref();
  }
});

function shutdown(): void {
  clearInterval(heartbeat);
  clearInterval(sweeper);
  clearInterval(gameTicker);
  for (const client of wss.clients) client.terminate();
  wss.close();
  server.close();
  void vite?.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

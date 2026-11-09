import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { WebSocketServer } from "ws";
import { firewallStatus, openFirewall } from "./firewall";
import { Hub } from "./hub";
import { clientIp, lanAddresses } from "./net";
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

/** 公网部署时关掉全服房间列表（默认开启，保持局域网体验不变）。 */
const roomDiscovery = process.env.PLAYGO_ROOM_DISCOVERY !== "0";
/** 只有放在反向代理后面才信任 X-Forwarded-For。 */
const trustProxy = process.env.PLAYGO_TRUST_PROXY === "1";

function readLimit(name: string): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const maxRooms = readLimit("PLAYGO_MAX_ROOMS");
const maxConnections = readLimit("PLAYGO_MAX_CONNECTIONS");
const maxConnectionsPerIp = readLimit("PLAYGO_MAX_CONNECTIONS_PER_IP");

const allowedOrigins = (process.env.PLAYGO_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
if (allowedOrigins.length === 0 && publicUrl) {
  try {
    allowedOrigins.push(new URL(publicUrl).origin);
  } catch {
    // normalizePublicUrl 已经校验过，这里只是兜底
  }
}

function originAllowed(origin: string | undefined): boolean {
  // 非浏览器客户端可能不带 Origin；带了的必须命中白名单。
  if (!origin || allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

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
const hub = new Hub(rooms, buildId, maxRooms);
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
        mode: publicUrl ? "remote" : "lan",
        discovery: roomDiscovery,
      });
      return;
    }

    if (url.pathname === "/api/networks") {
      json(res, 200, {
        port,
        urls: visibleLanUrls(),
        host: bindHost,
        publicUrl,
        mode: publicUrl ? "remote" : "lan",
        discovery: roomDiscovery,
      });
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
      // 公网服务默认不暴露房间码列表，只能扫码或用房间码加入。
      json(res, 200, { rooms: roomDiscovery ? rooms.list() : [] });
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
const ipConnections = new Map<string, number>();

wss.on("connection", (ws, req) => {
  const ip = clientIp(req, trustProxy);
  ipConnections.set(ip, (ipConnections.get(ip) ?? 0) + 1);
  ws.once("close", () => {
    const left = (ipConnections.get(ip) ?? 1) - 1;
    if (left > 0) ipConnections.set(ip, left);
    else ipConnections.delete(ip);
  });
  hub.attach(ws, ip);
});

function rejectUpgrade(
  socket: import("node:stream").Duplex,
  status: number,
  message: string,
): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    // 连接已经断了
  }
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  if (!originAllowed(req.headers.origin)) {
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }
  if (maxConnections > 0 && wss.clients.size >= maxConnections) {
    rejectUpgrade(socket, 503, "Service Unavailable");
    return;
  }
  const ip = clientIp(req, trustProxy);
  if (maxConnectionsPerIp > 0 && (ipConnections.get(ip) ?? 0) >= maxConnectionsPerIp) {
    rejectUpgrade(socket, 429, "Too Many Requests");
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
  if (!roomDiscovery) {
    console.log("  房间列表 已关闭（PLAYGO_ROOM_DISCOVERY=0），只能扫码或输房间码加入");
  }
  if (maxRooms > 0) console.log(`  容量    最多 ${maxRooms} 个房间`);
  if (maxConnections > 0) console.log(`  连接    最多 ${maxConnections} 个 WebSocket`);
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

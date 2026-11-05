import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Hub } from "./hub";
import { lanAddresses } from "./net";
import { qrSvg } from "./qr";
import { RoomManager } from "./rooms";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const distDir = path.join(root, "dist");

const isProd = process.argv.includes("--prod");
const basePort = Number(process.env.PORT ?? 8787);
const PORT_SPAN = 10;

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
      });
      return;
    }

    if (url.pathname === "/api/networks") {
      json(res, 200, { port, urls: lanAddresses() });
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

server.listen(port, "0.0.0.0", () => {
  const urls = lanAddresses();
  console.log("");
  console.log("  playGo 已启动");
  console.log(`  本机    http://localhost:${port}`);
  for (const item of urls) {
    console.log(`  局域网  http://${item.ip}:${port}  (${item.iface})`);
  }
  if (urls.length === 0) {
    console.log("  局域网  未检测到可用网卡，手机可能连不上");
  }
  console.log("");
  console.log(isProd ? "  生产模式：静态资源来自 dist/" : "  开发模式：Vite 中间件 + HMR");
  console.log("");
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

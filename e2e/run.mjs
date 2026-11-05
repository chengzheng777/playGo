/**
 * 端到端冒烟：真浏览器 + 真 WebSocket，跑一遍「建房 → 加入 → 开始 → 计分」。
 *
 *   pnpm dev        # 另开一个终端
 *   pnpm e2e
 *
 * 依赖本机 Chrome / Edge；可用 CHROME_PATH 指定路径，PLAYGO_BASE 指定地址。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import WebSocket from "ws";

const BASE = process.env.PLAYGO_BASE ?? "http://localhost:8787";
const ARTIFACTS = path.resolve("e2e/.artifacts");
const TIMEOUT = 20_000;

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" ? address.port : 9333));
    });
  });
}

async function waitHttp(url, timeout = TIMEOUT) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error(`等待超时: ${url}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl, { perMessageDeflate: false });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new Cdp(socket);
  }

  call(method, params = {}) {
    const id = ++this.seq;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.exception?.description ?? "evaluate failed");
  }
  return result.result?.result?.value;
}

async function waitFor(client, expression, timeout = TIMEOUT) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await evaluate(client, expression).catch(() => false);
    if (value) return value;
    await sleep(150);
  }
  return null;
}

async function click(client, selector) {
  return evaluate(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`,
  );
}

async function clickByText(client, text) {
  return evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll("button")].find((element) =>
        element.textContent.trim().includes(${JSON.stringify(text)}),
      );
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
}

async function newPage(port, metrics) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?url=about:blank`, {
    method: "PUT",
  }).then((response) => response.json());
  const client = await Cdp.connect(created.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  if (metrics) await client.call("Emulation.setDeviceMetricsOverride", metrics);
  return client;
}

async function screenshot(client, name) {
  const result = await client.call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ARTIFACTS, `${name}.png`), Buffer.from(result.result.data, "base64"));
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const chromePath = findChrome();
  if (!chromePath) throw new Error("找不到 Chrome/Edge，请设置 CHROME_PATH");

  const port = await freePort();
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join(ARTIFACTS, "profile")}`,
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let host;
  let phone;
  let guest;
  try {
    await waitHttp(`http://127.0.0.1:${port}/json/version`);

    host = await newPage(port, {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await host.call("Page.navigate", { url: BASE });
    await waitFor(host, "!!document.querySelector('.game-card')");
    await evaluate(
      host,
      `localStorage.setItem("playgo:profile", JSON.stringify({ name: "Alice", avatar: { text: "A", color: "#fb7185" } }))`,
    );
    await host.call("Page.navigate", { url: BASE });
    await waitFor(host, "!!document.querySelector('.game-card')");

    let code = null;
    for (let attempt = 0; attempt < 6 && !code; attempt++) {
      await clickByText(host, "创建「");
      await sleep(800);
      code = await evaluate(host, "document.querySelector('.room-code b')?.textContent ?? null");
    }
    check("创建房间", Boolean(code), String(code));

    guest = new WebSocket(new URL("/ws", BASE).toString().replace("http", "ws"));
    await new Promise((resolve) => guest.once("open", resolve));
    guest.send(
      JSON.stringify({
        v: 1,
        type: "room.join",
        data: { code, name: "Guest", role: "player" },
      }),
    );
    await sleep(400);
    guest.send(JSON.stringify({ v: 1, type: "player.ready", data: { ready: true } }));

    phone = await newPage(port, {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await phone.call("Page.navigate", { url: BASE });
    await waitFor(phone, "!!document.querySelector('.game-card')");
    await evaluate(
      phone,
      `localStorage.setItem("playgo:profile", JSON.stringify({ name: "小明", avatar: { text: "🦁", color: "#fbbf24" } }))`,
    );
    await phone.call("Page.navigate", { url: `${BASE}/j/${code}` });
    await waitFor(phone, "!!document.querySelector('.join-user')");

    for (let attempt = 0; attempt < 6; attempt++) {
      await click(phone, ".panel .btn-primary");
      await sleep(800);
      if (await evaluate(phone, "!!document.querySelector('.current-game')")) break;
    }
    check(
      "手机加入房间",
      Boolean(await waitFor(phone, "!!document.querySelector('.current-game')")),
    );

    await click(phone, ".current-game .btn");
    await waitFor(host, "!!document.querySelector('.tag-ready')");

    for (let attempt = 0; attempt < 6; attempt++) {
      await clickByText(host, "开始游戏");
      await sleep(900);
      if (await evaluate(host, "!!document.querySelector('.screen-arena')")) break;
    }

    check("开始游戏", Boolean(await waitFor(host, "!!document.querySelector('.screen-arena')")));
    check(
      "手机进入答题界面",
      Boolean(await waitFor(phone, "!!document.querySelector('.phone-arena')")),
    );

    const word = await evaluate(
      host,
      "document.querySelector('.screen-arena .word')?.textContent ?? ''",
    );
    check("大屏显示词语", typeof word === "string" && word.length > 0, word);
    check(
      "手机上不出现词语",
      (await evaluate(phone, "!document.querySelector('.phone-arena .word')")) === true,
    );

    await click(host, ".turn-actions .btn-primary");
    check(
      "答对后手机进入揭晓",
      Boolean(await waitFor(phone, "!!document.querySelector('.reveal')")),
    );

    await screenshot(host, "e2e-host");
    await screenshot(phone, "e2e-phone");

    console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    phone?.close();
    host?.close();
    guest?.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

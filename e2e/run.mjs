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

async function typeInto(client, selector, text) {
  return evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
}

async function noHorizontalOverflow(client) {
  return (
    (await evaluate(client, "document.documentElement.scrollWidth <= window.innerWidth + 1")) ===
    true
  );
}

async function joinAsPhone(port, pages, code, name, avatar, metrics, ready = true) {
  const page = await newPage(port, metrics);
  pages.push(page);
  await page.call("Page.navigate", { url: BASE });
  await waitFor(page, "!!document.querySelector('.home')");
  await evaluate(
    page,
    `localStorage.setItem("playgo:profile", JSON.stringify({ name: ${JSON.stringify(
      name,
    )}, avatar: ${JSON.stringify(avatar)} }))`,
  );
  await page.call("Page.navigate", { url: `${BASE}/j/${code}` });
  await waitFor(page, "!!document.querySelector('.join-user')");

  for (let attempt = 0; attempt < 8; attempt++) {
    await click(page, ".panel .btn-primary");
    await sleep(600);
    if (await evaluate(page, "!!document.querySelector('.current-game')")) break;
  }

  if (ready) {
    await click(page, ".current-game .btn");
    await waitFor(page, "!!document.querySelector('.tag-ready')");
  }
  return page;
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

async function runMobileFlow(port, pages) {
  console.log("\n移动端尺寸");

  const host = await newPage(port, {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  pages.push(host);
  await host.call("Page.navigate", { url: BASE });
  await waitFor(host, "!!document.querySelector('.home')");
  await evaluate(
    host,
    `localStorage.setItem("playgo:profile", JSON.stringify({ name: "MobileHost", avatar: { text: "M", color: "#fb7185" } }))`,
  );
  await host.call("Page.navigate", { url: BASE });
  await waitFor(host, "!!document.querySelector('.home')");
  await sleep(300);

  await clickByText(host, "创建房间");
  check(
    "移动端房主打开创建弹窗",
    Boolean(await waitFor(host, "!!document.querySelector('.modal')")),
  );
  await evaluate(
    host,
    "[...document.querySelectorAll('.game-pill')].find((el) => el.textContent.includes('你画我猜'))?.click()",
  );
  await clickByText(host, "创建「你画我猜」");
  const code = await waitFor(host, "document.querySelector('.room-code b')?.textContent ?? null");
  check("移动端房主创建你画我猜房间", Boolean(code), String(code));

  await waitFor(host, "!!document.querySelector('.word-batch')");
  await typeInto(host, ".word-batch", "移动词甲，移动词乙\n移动词丙");
  await clickByText(host, "加入词库");
  check(
    "移动端自定义词库可批量添加",
    Boolean(await waitFor(host, "document.querySelectorAll('.word-chip').length >= 3")),
  );
  check("移动端房主大厅无横向溢出", await noHorizontalOverflow(host));

  const phoneMetrics = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
  const kickMe = await joinAsPhone(
    port,
    pages,
    code,
    "KickMe",
    { text: "K", color: "#94a3b8" },
    phoneMetrics,
    false,
  );
  const a = await joinAsPhone(
    port,
    pages,
    code,
    "MobileA",
    { text: "A", color: "#38bdf8" },
    phoneMetrics,
  );
  const b = await joinAsPhone(
    port,
    pages,
    code,
    "MobileB",
    { text: "B", color: "#f97316" },
    { width: 360, height: 800, deviceScaleFactor: 2, mobile: true },
  );
  const c = await joinAsPhone(
    port,
    pages,
    code,
    "MobileC",
    { text: "C", color: "#a78bfa" },
    { width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
  );

  await waitFor(host, "document.querySelectorAll('.player').length >= 5");
  check(
    "移动端玩家列表有移出按钮",
    (await evaluate(host, "document.querySelectorAll('.kick-btn').length")) >= 4,
  );
  check(
    "移动端出现未准备批量移出",
    Boolean(
      await waitFor(
        host,
        "[...document.querySelectorAll('button')].some((el) => el.textContent.includes('移出未准备玩家'))",
      ),
    ),
  );
  check("移动端多人房间无横向溢出", await noHorizontalOverflow(host));

  // 房主在 320 小屏也要能完整看到玩家列表、移出按钮和自定义词设置
  await host.call("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 568,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(300);
  check("移动端 320 房主大厅无横向溢出", await noHorizontalOverflow(host));
  await evaluate(
    host,
    "document.querySelector('.players-panel')?.scrollIntoView({ block: 'center' })",
  );
  await screenshot(host, "e2e-mobile-lobby-320");
  await host.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(300);

  await evaluate(host, "window.confirm = () => true");
  await clickByText(host, "移出未准备玩家");
  check(
    "移动端一键移出未准备玩家",
    Boolean(await waitFor(host, "document.querySelectorAll('.player').length === 4")),
  );
  check(
    "移动端被移出玩家回首页",
    Boolean(await waitFor(kickMe, "!!document.querySelector('.home')")),
  );
  check(
    "移动端被移出玩家看到提示",
    Boolean(
      await waitFor(kickMe, "document.querySelector('.toast')?.textContent.includes('移出')"),
    ),
  );

  check(
    "移动端玩家能看到自定义词",
    (await evaluate(a, "document.querySelectorAll('.word-chip').length")) >= 3,
  );
  for (const [page, label] of [
    [a, "390"],
    [b, "360"],
    [c, "320"],
  ]) {
    check(`移动端 ${label} 大厅无横向溢出`, await noHorizontalOverflow(page));
  }

  await clickByText(host, "开始游戏");
  check(
    "移动端开始你画我猜",
    Boolean(await waitFor(host, "!!document.querySelector('.draw-game')")),
  );

  const players = [a, b, c];
  for (const page of players) await waitFor(page, "!!document.querySelector('.draw-game')");
  await sleep(300);

  const drawerFlags = await Promise.all(
    players.map((page) => evaluate(page, "!!document.querySelector('.draw-pad')")),
  );
  const drawerPage = players.find((_, index) => drawerFlags[index]);
  const guesserPages = players.filter((_, index) => !drawerFlags[index]);
  check("移动端找到画手与猜词者", Boolean(drawerPage) && guesserPages.length === 2);
  if (!drawerPage) return;

  const word = await evaluate(
    drawerPage,
    "document.querySelector('.draw-word')?.textContent.replace('你要画：', '').trim() ?? ''",
  );
  check("移动端画手能看到词", word.length > 0, word);
  check("移动端画布无横向溢出", await noHorizontalOverflow(drawerPage));

  // 360 / 320 宽度下聊天面板都要完整落在视口内
  for (const [page, label] of [
    [b, "360"],
    [c, "320"],
  ]) {
    // 后台标签页会暂停 CSS 过渡，量尺寸前先切到前台
    await page.call("Page.bringToFront");
    await sleep(120);
    await click(page, ".game-chat-toggle");
    await waitFor(page, "!!document.querySelector('.game-chat.open')");
    // 等展开动画结束再量尺寸，避免量到 translateX 中间态
    await sleep(320);
    const fits = await evaluate(
      page,
      `(() => {
        const el = document.querySelector('.game-chat.open');
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth + 1 &&
          rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
      })()`,
    );
    check(`移动端 ${label} 聊天面板在视口内`, fits === true);
    check(`移动端 ${label} 聊天无横向溢出`, await noHorizontalOverflow(page));
    await click(page, ".game-chat-toggle");
  }

  await drawerPage.call("Page.bringToFront");
  await sleep(120);
  await click(drawerPage, ".game-chat-toggle");
  await waitFor(drawerPage, "!!document.querySelector('.game-chat.open')");
  await typeInto(drawerPage, ".game-chat-form .input", "移动端公屏消息");
  await evaluate(drawerPage, "document.querySelector('.game-chat-form')?.requestSubmit()");

  const receiver = guesserPages[0];
  check(
    "移动端聊天未读数",
    Boolean(await waitFor(receiver, "!!document.querySelector('.game-chat-badge')")),
  );
  await receiver.call("Page.bringToFront");
  await sleep(120);
  await click(receiver, ".game-chat-toggle");
  check(
    "移动端聊天可展开",
    Boolean(await waitFor(receiver, "!!document.querySelector('.game-chat.open')")),
  );
  check(
    "移动端聊天收到消息",
    Boolean(
      await waitFor(
        receiver,
        "[...document.querySelectorAll('.game-chat.open .msg-text')].some((el) => el.textContent.includes('移动端公屏消息'))",
      ),
    ),
  );
  check("移动端聊天无横向溢出", await noHorizontalOverflow(receiver));
  await sleep(320);
  await screenshot(receiver, "e2e-mobile-chat");
  await click(receiver, ".game-chat-toggle");
  await click(drawerPage, ".game-chat-toggle");

  const first = guesserPages[0];
  const second = guesserPages[1];
  await typeInto(first, ".draw-guess .input", word);
  await evaluate(first, "document.querySelector('.draw-guess')?.requestSubmit()");
  check(
    "移动端首位猜对后本轮继续",
    Boolean(
      await waitFor(host, "document.querySelector('.draw-progress')?.textContent.includes('1/2')"),
    ),
  );
  check(
    "移动端猜对等待提示",
    Boolean(await waitFor(first, "!!document.querySelector('.draw-guessed')")),
  );

  await typeInto(second, ".draw-guess .input", word);
  await evaluate(second, "document.querySelector('.draw-guess')?.requestSubmit()");
  check(
    "移动端全员猜对进入揭晓",
    Boolean(await waitFor(host, "!!document.querySelector('.draw-correct')")),
  );
  const correctText = await evaluate(
    host,
    "document.querySelector('.draw-correct')?.textContent ?? ''",
  );
  check(
    "移动端按顺序显示 5 / 3 分",
    correctText.includes("+5") && correctText.includes("+3"),
    correctText,
  );
  const drawerScore = await evaluate(
    host,
    "document.querySelector('.draw-player.drawer b')?.textContent ?? ''",
  );
  check("移动端全员猜对画手 0 分", drawerScore === "0", drawerScore);

  for (const [page, label] of [
    [host, "大屏"],
    [first, "猜词者1"],
    [second, "猜词者2"],
  ]) {
    check(`移动端 ${label} 揭晓无横向溢出`, await noHorizontalOverflow(page));
  }
  await screenshot(host, "e2e-mobile-draw-reveal");
  await screenshot(second, "e2e-mobile-draw-reveal-phone");
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

  const pages = [];
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
    pages.push(host);
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
    pages.push(phone);
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

    guest.send(JSON.stringify({ v: 1, type: "chat.send", data: { text: "e2e 对局聊天" } }));
    check(
      "对局中有聊天入口",
      Boolean(await waitFor(host, "!!document.querySelector('.game-chat-toggle')")),
    );
    check(
      "对局聊天未读数",
      Boolean(await waitFor(host, "!!document.querySelector('.game-chat-badge')")),
    );
    await click(host, ".game-chat-toggle");
    check(
      "对局聊天可以展开",
      Boolean(await waitFor(host, "!!document.querySelector('.game-chat.open')")),
    );
    check(
      "展开后未读数清零",
      (await evaluate(host, "!document.querySelector('.game-chat-badge')")) === true,
    );
    check(
      "对局聊天收到消息",
      Boolean(
        await waitFor(
          host,
          "[...document.querySelectorAll('.game-chat.open .msg-text')].some((el) => el.textContent.includes('e2e 对局聊天'))",
        ),
      ),
    );

    await click(host, ".turn-actions .btn-primary");
    check(
      "答对后手机进入揭晓",
      Boolean(await waitFor(phone, "!!document.querySelector('.reveal')")),
    );

    await screenshot(host, "e2e-host");
    await screenshot(phone, "e2e-phone");

    await runMobileFlow(port, pages);

    console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    for (const page of pages) page.close();
    guest?.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

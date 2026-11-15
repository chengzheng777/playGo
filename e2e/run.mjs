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

function waitForWs(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("等待 WebSocket 消息超时"));
    }, timeout);
    function onMessage(raw) {
      try {
        const message = JSON.parse(raw.toString());
        if (!predicate(message)) return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(message);
      } catch {
        /* ignore malformed */
      }
    }
    ws.on("message", onMessage);
  });
}

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
  // 同一个浏览器里模拟多台手机：清掉上一个标签页留下的房间 token
  await evaluate(page, `localStorage.removeItem("playgo:token:${code}")`);
  await page.call("Page.navigate", { url: `${BASE}/j/${code}?renderer=lite` });
  await waitFor(page, "!!document.querySelector('.seat-map')");
  check(`手机 ${name} 入座场景无横向溢出`, await noHorizontalOverflow(page));

  // 入座场景：点第一个空位，坐下即加入并准备
  const sat = await evaluate(
    page,
    `(() => {
      const seat = document.querySelector('.seat-card.empty:not(:disabled)');
      if (!seat) return false;
      seat.click();
      return true;
    })()`,
  );
  await waitFor(page, "!!document.querySelector('.room-code')");
  check(`手机 ${name} 通过入座场景进房`, sat === true);

  const playerReady = `[...document.querySelectorAll('.player')].some((el) => el.textContent.includes(${JSON.stringify(
    name,
  )}) && el.querySelector('.tag-ready'))`;
  check(
    `手机 ${name} 大厅出现像素房`,
    Boolean(await waitFor(page, "!!document.querySelector('.lobby-room-canvas')", 5000)),
  );
  if (ready) {
    await waitFor(page, playerReady);
  } else {
    // 坐下默认准备；需要未准备玩家时在大厅点「取消」
    await waitFor(page, "!!document.querySelector('.current-game .btn')");
    await click(page, ".current-game .btn");
    await waitFor(
      page,
      `[...document.querySelectorAll('.player')].some((el) => el.textContent.includes(${JSON.stringify(
        name,
      )}) && !el.querySelector('.tag-ready'))`,
    );
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

/** 独立浏览器上下文：localStorage 与主流程隔离，用来模拟另一台设备 */
async function newIsolatedPage(port, metrics) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) =>
    response.json(),
  );
  const browser = await Cdp.connect(version.webSocketDebuggerUrl);
  const context = await browser.call("Target.createBrowserContext", {});
  const created = await browser.call("Target.createTarget", {
    url: "about:blank",
    browserContextId: context.result.browserContextId,
  });
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
    response.json(),
  );
  const target = targets.find((entry) => entry.id === created.result.targetId);
  if (!target) throw new Error("无法找到隔离页 target");
  const client = await Cdp.connect(target.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  if (metrics) await client.call("Emulation.setDeviceMetricsOverride", metrics);
  client.closeBrowser = () => browser.socket.close();
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
  check(
    "移动端房主大厅出现像素房",
    Boolean(await waitFor(host, "!!document.querySelector('.lobby-room-canvas')", 5000)),
  );

  await waitFor(host, "!!document.querySelector('.word-batch')");
  await typeInto(host, ".word-batch", "移动词甲，移动词乙\n移动词丙");
  await clickByText(host, "加入词库");
  check(
    "移动端自定义词库可批量添加",
    Boolean(await waitFor(host, "document.querySelectorAll('.word-chip').length >= 3")),
  );
  check("移动端房主大厅无横向溢出", await noHorizontalOverflow(host));

  // 未入座的旁观页面：检查像素场景本身（WebGL 可用时出画布，否则 2D 兜底）
  const sceneViewer = await newIsolatedPage(port, {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  pages.push(sceneViewer);
  await sceneViewer.call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await sceneViewer.call("Page.navigate", { url: BASE });
  await waitFor(
    sceneViewer,
    "!!document.querySelector('.onboarding') || !!document.querySelector('.home')",
  );
  await evaluate(
    sceneViewer,
    `localStorage.setItem("playgo:profile", JSON.stringify({ name: "MobileHost", avatar: { text: "M", color: "#fb7185" } }))`,
  );
  await sceneViewer.call("Page.navigate", { url: `${BASE}/j/${code}` });
  const sceneRendered = await waitFor(
    sceneViewer,
    "!!document.querySelector('canvas.scene-canvas') || !!document.querySelector('.seat-map')",
  );
  check("入座场景渲染出 3D 画布或 2D 兜底", Boolean(sceneRendered));
  check("入座场景无横向溢出", await noHorizontalOverflow(sceneViewer));
  await sleep(500);
  await screenshot(sceneViewer, "e2e-join-scene");

  // 用一个 WebSocket 玩家验证已坐玩家预览；不写浏览器 localStorage，避免和后面的手机互相顶号
  const previewGuest = new WebSocket(new URL("/ws", BASE).toString().replace("http", "ws"));
  await new Promise((resolve) => previewGuest.once("open", resolve));
  previewGuest.send(
    JSON.stringify({
      v: 1,
      type: "room.join",
      data: { code, name: "PreviewGuest", role: "player", ready: true },
    }),
  );
  await sleep(500);

  await sceneViewer.call("Page.navigate", { url: `${BASE}/j/${code}?renderer=lite` });
  check(
    "入座场景显示已坐玩家",
    Boolean(await waitFor(sceneViewer, "!!document.querySelector('.seat-card.occupied')", 8000)),
  );
  await evaluate(sceneViewer, "document.querySelector('.seat-card.occupied')?.click()");
  check(
    "入座场景能查看玩家名片",
    Boolean(await waitFor(sceneViewer, "!!document.querySelector('.seat-info-modal')", 3000)),
  );

  // 用房主同名入座：服务端拒绝重名，页面不能半加入
  await evaluate(sceneViewer, "document.querySelector('.seat-info-modal .btn')?.click()");
  await evaluate(sceneViewer, "document.querySelector('.seat-card.empty:not(:disabled)')?.click()");
  check(
    "入座重名会提示",
    Boolean(
      await waitFor(
        sceneViewer,
        "document.body.textContent.includes('这个昵称已经有人用了')",
        8000,
      ),
    ),
  );
  check(
    "入座失败仍留在场景",
    (await evaluate(
      sceneViewer,
      "!!document.querySelector('.join-scene-page') && !document.querySelector('.room-code')",
    )) === true,
  );

  previewGuest.send(JSON.stringify({ v: 1, type: "room.leave", data: {} }));
  previewGuest.close();
  await waitFor(host, "document.querySelectorAll('.player').length === 1", 5000);

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
  check(
    "移动端像素房在玩家列表上方",
    (await evaluate(
      host,
      "(() => { const s = document.querySelector('.lobby-room')?.getBoundingClientRect(); const p = document.querySelector('.players-panel')?.getBoundingClientRect(); return Boolean(s && p && s.top < p.top); })()",
    )) === true,
  );
  await evaluate(host, "window.scrollTo(0, 0)");
  await sleep(200);
  await screenshot(host, "e2e-mobile-lobby-top-320");
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

  // 独立浏览器上下文里验证：入座后刷新 /j/:code 会凭 token 直接回大厅
  console.log("\n入座恢复");
  const resumeHost = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws`);
  await new Promise((resolve, reject) => {
    resumeHost.once("open", resolve);
    resumeHost.once("error", reject);
  });
  const resumeCreatedPromise = waitForWs(resumeHost, (message) => message.type === "room.created");
  resumeHost.send(
    JSON.stringify({ v: 1, type: "room.create", data: { name: "ResumeHost", role: "screen" } }),
  );
  const resumeCreated = await resumeCreatedPromise;
  const resumeCode = resumeCreated.data.room.code;

  await sceneViewer.call("Page.navigate", { url: `${BASE}/j/${resumeCode}?renderer=lite` });
  await waitFor(sceneViewer, "!!document.querySelector('.seat-map')");
  const resumeStatePromise = waitForWs(
    resumeHost,
    (message) =>
      message.type === "room.state" &&
      message.data.room.players.some((player) => player.name === "MobileHost"),
  );
  await evaluate(sceneViewer, "document.querySelector('.seat-card.empty:not(:disabled)')?.click()");
  check(
    "隔离浏览器可以正常入座",
    Boolean(await waitFor(sceneViewer, "!!document.querySelector('.room-code')", 8000)),
  );
  const resumeState = await resumeStatePromise;
  const resumePlayer = resumeState.data.room.players.find((player) => player.name === "MobileHost");
  check(
    "入座后服务端记录座位与准备",
    resumePlayer?.ready === true && resumePlayer?.role === "player",
  );

  await sceneViewer.call("Page.navigate", { url: `${BASE}/j/${resumeCode}` });
  check(
    "已有 token 打开 /j/:code 直接回大厅",
    Boolean(await waitFor(sceneViewer, "!!document.querySelector('.room-code')", 8000)),
  );
  check(
    "重连后路由改为 /r/",
    (await evaluate(sceneViewer, "location.pathname.startsWith('/r/')")) === true,
  );
  check(
    "重连不重新入座",
    (await evaluate(sceneViewer, "!document.querySelector('.join-scene-page')")) === true,
  );

  resumeHost.close();
}

async function runHostPlaysFlow(port, pages) {
  console.log("\n房主参赛与大屏");

  const host = await newPage(port, {
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
    `localStorage.setItem("playgo:profile", JSON.stringify({ name: "HostPlayer", avatar: { text: "H", color: "#fb7185" } }))`,
  );
  await host.call("Page.navigate", { url: BASE });
  await waitFor(host, "!!document.querySelector('.game-card')");
  await evaluate(
    host,
    "[...document.querySelectorAll('.game-card')].find((el) => el.textContent.includes('你画我猜'))?.click()",
  );
  await sleep(250);

  let code = null;
  for (let attempt = 0; attempt < 8 && !code; attempt++) {
    await clickByText(host, "创建「");
    await sleep(700);
    code = await evaluate(host, "document.querySelector('.room-code b')?.textContent ?? null");
  }
  check("房主参赛流程创建房间", Boolean(code), String(code));

  await clickByText(host, "我也玩");
  check(
    "房主切换为参赛",
    Boolean(
      await waitFor(
        host,
        "[...document.querySelectorAll('.host-mode-panel .segmented .on')].some((el) => el.textContent.includes('我也玩'))",
      ),
    ),
  );
  check(
    "房主参赛后自动准备",
    Boolean(
      await waitFor(
        host,
        "[...document.querySelectorAll('.player')].some((el) => el.textContent.includes('HostPlayer') && el.querySelector('.tag-ready'))",
      ),
    ),
  );
  const hostTag = await evaluate(
    host,
    "[...document.querySelectorAll('.player')].find((el) => el.textContent.includes('HostPlayer'))?.querySelector('.tag-host')?.textContent ?? ''",
  );
  check("房主参赛后标签为房主", hostTag.trim() === "房主", hostTag.trim());

  const screenUrl = await waitFor(
    host,
    "document.querySelector('.screen-link-panel .url-line code')?.textContent ?? ''",
  );
  check("房主参赛后出现独立大屏链接", Boolean(screenUrl?.includes("/s/")), screenUrl);
  check("房主参赛大厅无横向溢出", await noHorizontalOverflow(host));
  await screenshot(host, "e2e-host-plays-lobby");
  await host.call("Emulation.setDeviceMetricsOverride", {
    width: 3840,
    height: 2160,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(600);
  const room4k = await evaluate(
    host,
    `(() => {
      const room = document.querySelector(".lobby-hero .lobby-room")?.getBoundingClientRect();
      return {
        width: room?.width ?? 0,
        top: room?.top ?? 0,
        bottom: room?.bottom ?? 0,
        inner: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      };
    })()`,
  );
  check(
    "4K 候场房宽度受控且完整可见",
    room4k.width > 1200 &&
      room4k.width <= 2050 &&
      room4k.top >= 0 &&
      room4k.bottom <= room4k.inner + 1 &&
      room4k.scrollHeight <= room4k.inner + 1,
    JSON.stringify(room4k),
  );
  await screenshot(host, "e2e-host-4k");
  await host.call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(300);

  await host.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(300);
  check("移动端房主参赛大厅无横向溢出", await noHorizontalOverflow(host));
  await screenshot(host, "e2e-host-plays-mobile");
  await host.call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(300);

  const bigScreen = await newPage(port, {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  pages.push(bigScreen);
  // 大屏不依赖本机用户资料：清掉 profile 后仍应能直接连上
  await bigScreen.call("Page.navigate", { url: BASE });
  await waitFor(bigScreen, "!!document.querySelector('.home')");
  await evaluate(bigScreen, 'localStorage.removeItem("playgo:profile")');
  await bigScreen.call("Page.navigate", { url: screenUrl });
  check(
    "大屏大厅等待页可打开",
    Boolean(await waitFor(bigScreen, "!!document.querySelector('.screen-hero')")),
  );
  check(
    "大屏不需要本机用户资料",
    (await evaluate(bigScreen, "!document.querySelector('.onboarding')")) === true,
  );
  check(
    "大屏大厅没有准备按钮",
    (await evaluate(bigScreen, "!document.querySelector('.current-game .btn')")) === true,
  );
  check(
    "大屏大厅显示当前游戏",
    (await evaluate(
      bigScreen,
      "document.querySelector('.screen-hero')?.textContent.includes('你画我猜')",
    )) === true,
  );
  await screenshot(bigScreen, "e2e-big-screen-lobby");

  const mate = await joinAsPhone(
    port,
    pages,
    code,
    "HostMate",
    { text: "M", color: "#38bdf8" },
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  );

  await clickByText(host, "开始游戏");
  check(
    "房主 + 1 名玩家可以开局",
    Boolean(await waitFor(host, "!!document.querySelector('.draw-game')")),
  );
  await waitFor(mate, "!!document.querySelector('.draw-game')");
  check(
    "大屏从大厅自动进入游戏",
    Boolean(await waitFor(bigScreen, "!!document.querySelector('.draw-game')")),
  );
  check(
    "大屏 URL 保持 /s/ 路由",
    (await evaluate(bigScreen, "location.pathname.startsWith('/s/')")) === true,
  );
  check(
    "大屏没有画板/猜词/词语",
    (await evaluate(
      bigScreen,
      "!document.querySelector('.draw-pad') && !document.querySelector('.draw-guess') && !document.querySelector('.draw-word')",
    )) === true,
  );
  check(
    "大屏没有房主结束按钮",
    (await evaluate(
      bigScreen,
      "!(document.querySelector('.game-bar-actions')?.textContent ?? '').includes('结束')",
    )) === true,
  );
  check(
    "大屏看得到两位参赛者比分",
    (await evaluate(bigScreen, "document.querySelectorAll('.draw-scores .draw-player').length")) ===
      2,
  );
  check("大屏无横向溢出", await noHorizontalOverflow(bigScreen));

  const lateScreen = await newPage(port, {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  pages.push(lateScreen);
  await lateScreen.call("Page.navigate", { url: screenUrl });
  check(
    "大屏可以在游戏中加入",
    Boolean(await waitFor(lateScreen, "!!document.querySelector('.draw-game')")),
  );
  check(
    "迟到大屏也没有猜词控件",
    (await evaluate(
      lateScreen,
      "!document.querySelector('.draw-guess') && !document.querySelector('.draw-word')",
    )) === true,
  );

  check(
    "房主是玩家视角",
    (await evaluate(
      host,
      "!!document.querySelector('.draw-game') && (!!document.querySelector('.draw-pad') || !!document.querySelector('.draw-guess'))",
    )) === true,
  );
  check(
    "房主仍有结束按钮",
    (await evaluate(
      host,
      "(document.querySelector('.game-bar-actions')?.textContent ?? '').includes('结束')",
    )) === true,
  );
  await screenshot(host, "e2e-host-plays");
  await screenshot(bigScreen, "e2e-big-screen");
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
    check(
      "房主大厅出现像素房",
      Boolean(await waitFor(host, "!!document.querySelector('.lobby-room-canvas')", 5000)),
    );
    check(
      "PC 大厅以候场房为主界面",
      (await evaluate(
        host,
        `(() => {
          const main = document.querySelector(".layout.lobby-pc");
          const room = document.querySelector(".lobby-hero .lobby-room")?.getBoundingClientRect();
          const tools = document.querySelectorAll(".lobby-tool").length;
          return Boolean(main && room && room.width > 800 && room.height > 420 && tools >= 3);
        })()`,
      )) === true,
    );
    check(
      "PC 大厅无整体纵向滚动条",
      (await evaluate(host, "document.documentElement.scrollHeight <= window.innerHeight + 1")) ===
        true,
    );
    await clickByText(host, "设置");
    check(
      "PC 场景按钮打开房间面板",
      Boolean(
        await waitFor(host, "!!document.querySelector('.lobby-pc.drawer-room .host-mode-panel')"),
      ),
    );
    await sleep(320);
    await screenshot(host, "e2e-host-room-drawer");
    await clickByText(host, "关闭");
    await clickByText(host, "玩家");
    check(
      "PC 场景按钮打开玩家面板",
      Boolean(
        await waitFor(host, "!!document.querySelector('.lobby-pc.drawer-room .players-panel')"),
      ),
    );
    await clickByText(host, "关闭");
    await clickByText(host, "聊天");
    const chatBox = await evaluate(
      host,
      `(() => {
        const chat = document.querySelector(".lobby-chat-float")?.getBoundingClientRect();
        const stage = document.querySelector(".lobby-room-stage")?.getBoundingClientRect();
        if (!chat || !stage) return null;
        return {
          left: chat.left,
          top: chat.top,
          bottom: chat.bottom,
          stageLeft: stage.left,
          stageTop: stage.top,
          stageBottom: stage.bottom,
          stageHeight: stage.height,
        };
      })()`,
    );
    check(
      "PC 悬浮聊天在场景左下",
      Boolean(chatBox) &&
        chatBox.left >= chatBox.stageLeft - 1 &&
        chatBox.bottom <= chatBox.stageBottom + 1 &&
        chatBox.top > chatBox.stageTop + chatBox.stageHeight / 2,
      JSON.stringify(chatBox),
    );
    check(
      "PC 悬浮聊天不产生页面滚动条",
      (await evaluate(host, "document.documentElement.scrollHeight <= window.innerHeight + 1")) ===
        true,
    );
    await screenshot(host, "e2e-host-chat-float");
    await clickByText(host, "收起");
    check(
      "PC 悬浮聊天可收起",
      (await evaluate(host, "!document.querySelector('.lobby-chat-float')")) === true,
    );
    await clickByText(host, "聊天");
    check(
      "PC 悬浮聊天可重新打开",
      Boolean(await waitFor(host, "!!document.querySelector('.lobby-chat-float')")),
    );
    await sleep(250);

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
    await evaluate(phone, `localStorage.removeItem("playgo:token:${code}")`);
    await phone.call("Page.navigate", { url: `${BASE}/j/${code}?renderer=lite` });
    await waitFor(phone, "!!document.querySelector('.seat-map')");
    await evaluate(
      phone,
      `(() => {
        const seat = document.querySelector('.seat-card.empty:not(:disabled)');
        if (!seat) return false;
        seat.click();
        return true;
      })()`,
    );
    check(
      "手机加入房间",
      Boolean(await waitFor(phone, "!!document.querySelector('.current-game')")),
    );
    check(
      "手机大厅出现像素房",
      Boolean(await waitFor(phone, "!!document.querySelector('.lobby-room-canvas')", 5000)),
    );
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
    await runHostPlaysFlow(port, pages);

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

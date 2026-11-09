# 远程服务版：把 playGo 部署到公网服务器

> 目标：同一套代码，既能“电脑开房 + 手机连同一 WiFi”，也能“服务器常驻 + 任何网络扫码即玩”。

---

## 0. 一句话结论

**远程版不需要改游戏逻辑，它只是把“房主电脑上的 Node 服务”搬到一台有公网 IP 的服务器上，前面加一层 HTTPS 反向代理。**

- 桌面版：房主电脑 = 服务器，二维码指向局域网 IP；
- 远程版：云服务器 = 服务器，二维码指向 `https://你的域名`；
- 手机端始终是浏览器，不装任何东西；
- 房主电脑（大屏端）也只是浏览器客户端，主动连服务器，**不需要公网 IP、路由器端口映射或内网穿透**。

注意：远程版改变的是“服务在哪”，不改变“谁当大屏”。房主仍然需要一台电脑（或平板）打开网页当大屏/主持端；手机玩家扫码加入。如果房主只有手机，就没有共用大屏，这类游戏体验会退化。

服务端已经支持 `PLAYGO_PUBLIC_URL`：设置后，`/api/networks` 会返回公网地址，二维码面板自动切到公网模式。仓库另外提供了 `Dockerfile`、`deploy/docker-compose.yml` 和 Caddy 配置，按第 4 节即可上线。

---

## 1. 两种形态对比

| 维度         | 桌面版（便携 / 安装包） | 远程服务版                       |
| ------------ | ----------------------- | -------------------------------- |
| 谁当服务器   | 房主的 Windows 电脑     | 云服务器（Linux）                |
| 玩家网络     | 必须同一局域网          | 任何能上网的网络                 |
| 域名 / HTTPS | 不需要                  | 必须（二维码、WebSocket 都用它） |
| 房间状态     | 进程内存                | 进程内存（重启即清空）           |
| 成本         | 0                       | 一台小 VPS + 域名                |
| 适合         | 朋友聚会、家里          | 公开服务、异地朋友、固定入口     |
| 运维         | 双击 exe                | Docker / 反代 / 证书 / 监控      |

远程版不是“另一个产品”，而是同一个服务端的另一种部署位置。桌面版仍然保留：局域网零延迟、不依赖公网，是离线场景的兜底。

---

## 2. 架构

```
手机 / 电脑浏览器
        │  HTTPS + WSS（443）
        ▼
   Caddy（自动 TLS、HTTP/2、WebSocket 反代）
        │  http://playgo:8787（仅容器网络）
        ▼
   playGo Node 进程
   ├─ 静态资源 dist/
   ├─ /api/*（房间列表、二维码、健康检查）
   └─ /ws（WebSocket：房间、聊天、游戏状态）
        │
        └─ 房间 / 玩家 / 游戏状态全部在进程内存
```

关键点：

1. **页面和 WebSocket 同源同端口**。前端用 `location.host` 拼 `wss://.../ws`，所以只要反代把 443 转给 8787，WebSocket 不需要额外配置。
2. **不需要 WebRTC / TURN / STUN**。所有流量都是普通 HTTP + WebSocket，不涉及 P2P 穿透。
3. **不需要数据库**。房间是临时的，30 秒无人自动销毁；玩家身份存在浏览器 `localStorage` 里。
4. **TLS 必须由反代终止**。Node 进程只监听容器内的 8787，不直接暴露公网。

---

## 3. 为什么先做“单实例”

当前实现里，房间、玩家、计时器、游戏状态都在一个 Node 进程的内存中，`setInterval` 每 500ms 推进所有游戏。这带来两个直接结论：

- **单实例是最简单、最正确的起点**。一台 1–2 核的小机器就能承载几十个并发房间；
- **不要一上来就多副本**。多副本要么把房间状态和广播都外置到 Redis（每个实例都能处理任意连接），要么做房间级粘性路由；两条路都会让复杂度和成本翻倍。

### 什么时候才需要扩容

按以下顺序升级，而不是直接上集群：

1. **纵向扩容**：加 CPU / 内存。单进程是单线程事件循环，瓶颈通常是消息广播和拍照上传带宽，不是 CPU 核数。
2. **状态外置（推荐的横向方案）**：把 `RoomManager` 迁到 Redis（房间快照 + Pub/Sub 广播），每个实例都能处理任意连接，才能做无状态副本和滚动发布。
3. **按房间分片（需要改协议）**：当前 WebSocket 连接是 `/ws`，房间码要连上之后才发送，反代在 Upgrade 时并不知道房间码，没法直接按房间做粘性路由。要做这条，必须让客户端把房间码放进连接 URL（例如 `/ws?room=XXXX`），加入/换房时重连到目标实例；大厅列表仍需共享数据。代价比第 2 条更绕。

在达到“几百个同时在线房间”之前，不建议做第 2、3 步。先监控 `rooms`、连接数、事件循环延迟，用数据说话。

### 重启的代价

进程重启 = 所有房间消失。对“朋友开一局”的场景可以接受；对公开服务，发布时建议：

- 选择低峰期；
- 在页面/公告里提示“服务维护，房间会重置”；
- 不要在没有 Drain 的情况下频繁滚动重启。

---

## 4. 部署（Docker + Caddy）

### 4.1 准备

- 一台 Linux VPS（1 核 1 GB 起步，2 核 2 GB 更稳）；
- 一个域名，把 `A` 记录指到服务器公网 IP（IPv6 可选 `AAAA`）；
- 放行 80 / 443（Caddy 申请证书和提供 HTTPS 用）；
- **不要**对公网开放 8787。

### 4.2 启动

```bash
cd deploy
cp .env.example .env
# 编辑 .env：PLAYGO_DOMAIN、PLAYGO_PUBLIC_URL 改成你的域名
docker compose up -d --build
docker compose logs -f playgo
```

`PLAYGO_PUBLIC_URL` 必须和域名一致（含 `https://`，不要带结尾斜杠）。Caddy 第一次启动会自动申请 Let's Encrypt 证书，通常几十秒内完成。

### 4.3 验证

```bash
curl https://play.example.com/api/health
# {"ok":true,"app":"playGo","mode":"remote","discovery":false,...}

curl https://play.example.com/api/networks
# publicUrl 应该是你的 https 地址
```

浏览器打开域名 → 创建房间 → 二维码应该显示 `https://play.example.com/j/XXXX`。用手机流量（不要连 WiFi）扫码，能进房间即说明公网链路通了。

### 4.4 更新

```bash
cd deploy
git pull
docker compose up -d --build
```

镜像重新构建后，旧容器被替换，房间会清空。需要“零丢房”发布时，先做第 3 节的状态外置（或按房间分片）。

### 4.5 宝塔面板（已有 Nginx）

宝塔通常已经用 Nginx 占住 80/443，这时**不要再起 Caddy**，只跑 playGo 容器，让宝塔站点做 HTTPS 和反向代理。

```bash
cd deploy
cp .env.example .env
# PLAYGO_PUBLIC_URL=https://play.example.com
docker compose -f docker-compose.baota.yml up -d --build
```

容器只绑 `127.0.0.1:8787`，公网访问不到 8787。然后在宝塔里：

1. 「网站」→ 添加站点 `play.example.com`（纯静态即可）；
2. 「设置」→「反向代理」→ 目标 URL `http://127.0.0.1:8787`；
3. 确认反代配置包含 WebSocket 头（宝塔模板不一定自带，可直接参考 [nginx-playgo.conf](../deploy/nginx-playgo.conf)）；
4. 「SSL」→ Let's Encrypt → 申请证书，开启强制 HTTPS；
5. 域名 DNS 的 A 记录指向服务器公网 IP；申请证书期间先关闭 CDN/代理（DNS only），否则 HTTP-01 验证可能失败。

最小反代配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

验证：

```bash
curl https://play.example.com/api/health
curl https://play.example.com/api/networks
```

宝塔面板的端口（默认 8888，可能已改）不要长期对公网开放：在腾讯云安全组里限制来源 IP，面板设置里开启面板 SSL、改掉默认入口，并定期看面板日志。

### 4.6 没有域名时的临时 HTTPS（Cloudflare Quick Tunnel）

域名过期、暂时不想买域名时，可以用 Cloudflare 的免费 quick tunnel 先拿到一个 HTTPS 地址。不需要开放 8787，也不需要证书：

```bash
docker run -d --name playgo-tunnel --restart unless-stopped \
  --network host cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://127.0.0.1:8787

docker logs playgo-tunnel 2>&1 | grep trycloudflare.com
```

拿到 `https://xxx.trycloudflare.com` 后，把 `PLAYGO_PUBLIC_URL` 和 `PLAYGO_ALLOWED_ORIGINS` 改成这个地址，二维码和 WebSocket 就会走 HTTPS/WSS。

注意：

- quick tunnel 的 URL 是随机的，cloudflared 容器重启/服务器重启后会变；可以在 cron 里同步新 URL 并重启 playGo 容器；
- Cloudflare 不保证可用性，只适合临时测试，不适合正式服务；
- 流量会经过 Cloudflare，延迟取决于就近节点；
- 正式上线还是建议自己的域名 + Let's Encrypt（或 Cloudflare 命名隧道）。

---

## 5. 环境变量

| 变量                            | 默认                 | 远程版建议                        | 说明                                           |
| ------------------------------- | -------------------- | --------------------------------- | ---------------------------------------------- |
| `PLAYGO_PUBLIC_URL`             | 空                   | `https://play.example.com`        | 二维码/分享链接使用；同时决定 WS Origin 白名单 |
| `PLAYGO_HOST`                   | `0.0.0.0`            | 容器内保持 `0.0.0.0`              | 监听地址；不要直接暴露到公网                   |
| `PORT`                          | `8787`               | `8787`                            | 容器内端口，由 Caddy 反代                      |
| `PLAYGO_ROOM_DISCOVERY`         | `1`                  | `0`                               | `0` 关闭全服房间列表，只能扫码/输房间码        |
| `PLAYGO_ALLOWED_ORIGINS`        | 由 `PUBLIC_URL` 推导 | 显式填 `https://play.example.com` | WebSocket Origin 白名单，逗号分隔              |
| `PLAYGO_TRUST_PROXY`            | `0`                  | `1`                               | 信任 `X-Forwarded-For`，用于按 IP 限连接       |
| `PLAYGO_MAX_ROOMS`              | `0`（不限）          | `200`                             | 单进程房间上限，保护内存                       |
| `PLAYGO_MAX_CONNECTIONS`        | `0`（不限）          | `1000`                            | WebSocket 总连接上限                           |
| `PLAYGO_MAX_CONNECTIONS_PER_IP` | `0`（不限）          | `20`                              | 单 IP 连接上限，防单机刷连接                   |

`PLAYGO_ROOM_DISCOVERY=0` 很重要：局域网里“看到房间就点加入”是便利，公网上等于把房间码公开给所有人。远程版默认只允许两种加入方式：

1. 房主把二维码/链接发给朋友；
2. 朋友手动输入 4 位房间码。

如果做的是“陌生人匹配”产品，再单独设计公开大厅、房间密码和举报机制，不要直接打开现在的 `list()`。

---

## 6. 安全设计

### 6.1 必须做的

- **全站 HTTPS**：Caddy 自动证书；不要用自签证书，手机浏览器会拦。
- **只暴露 443**：8787 只在 Docker 网络内；云安全组不要放行 8787。
- **关闭房间列表**：`PLAYGO_ROOM_DISCOVERY=0`。
- **限制 Origin**：默认只允许 `PLAYGO_PUBLIC_URL` 的 origin，降低跨站 WebSocket 滥用。
- **按 IP 限制连接**：`PLAYGO_MAX_CONNECTIONS_PER_IP`，并可在 Cloudflare / WAF 层再加一层速率限制。
- **限制房间数**：`PLAYGO_MAX_ROOMS`，防止有人无限建房把内存吃满。
- **日志与告警**：至少监控容器重启、健康检查失败、连接数突增。

### 6.2 房间码不是密码

房间码是 4 位、字符集 32 个，理论空间约 100 万。它适合“朋友之间报个码”，不适合防暴力枚举。公网部署时：

- 应用层已限制单 IP 每分钟最多 30 次失败 join（房间不存在 / token 错误），超过后临时拒绝；
- 在反代/WAF 层对 `/ws` 和连接频率再加一层速率限制；
- 房间列表关闭后，攻击者仍可猜码，但需要先建立 WebSocket 并持续尝试；
- 如果业务需要更强保护，下一步加“房间密码/邀请 token”，而不是把房间码加长到 8 位（体验会明显变差）。

### 6.3 内容与滥用

当前没有账号体系，昵称、聊天、画布内容都不做审核。公开服务需要补：

- 昵称/聊天敏感词过滤与长度限制（协议层已有长度上限）；
- 举报/踢人/封 IP；
- 上传图片大小上限（协议已限制单帧 512 KB，拍照 base64 最大约 320 KB）；
- 必要时接入内容安全服务。

### 6.4 反代注意

- Caddy 默认支持 WebSocket Upgrade，不需要额外开关；
- 如果前面再套 Cloudflare，确认 WebSocket 已开启，且不要让 100 秒超时切断长连接（playGo 有 30 秒心跳，一般没问题）；
- 不要把 `X-Forwarded-For` 直接透传给不受信任的上游；只有 `PLAYGO_TRUST_PROXY=1` 时才按它取 IP。

---

## 7. 容量与监控

### 7.1 粗略估算

以一个房间 8 人、每 500ms 一次游戏 tick 估算：

- 1 核 1 GB：几十个同时在线房间、几百个 WebSocket，通常够用；
- 2 核 2 GB：百级房间、千级连接，需要看广播频率和拍照上传；
- 真正先打满的通常是**上行带宽**（拍颜色每张照片几十 KB，多人同时上传）和**事件循环延迟**，不是 CPU 核数。

这些是量级参考，不是 SLA。上线前用真实手机和真实网络压一轮。

### 7.2 建议监控

- `/api/health` 的 `rooms` 字段（当前房间数）；
- 容器 CPU / 内存 / 网络出带宽；
- Node 事件循环延迟（可加 `perf_hooks` 或 APM）；
- WebSocket 连接数、异常断开率；
- Caddy 的 5xx、TLS 证书到期时间。

### 7.3 日志

当前服务端输出到 stdout（`console.log` / `console.error`），用 `docker compose logs` 或采集到 Loki/CloudWatch 即可。不要在容器里写本地文件，保持无状态。

---

## 8. 与桌面版的关系

- **桌面版**：离线、零延迟、零成本，适合家里/聚会；防火墙、二维码、托盘都围绕“房主电脑就是服务器”。
- **远程版**：固定域名、任何网络可加入，适合异地朋友和公开入口；运维成本换可达性。
- **代码共用**：游戏规则、协议、前端完全一致；差异只在启动方式、`PLAYGO_PUBLIC_URL` 和容量参数。

如果以后要做“账号 / 战绩 / 排行榜”，再引入数据库；当前远程版刻意保持无状态，是为了让部署和回滚足够简单。

---

## 9. 常见问题

**Q：手机扫码一直转圈？**
A：远程版先看 `https://域名/api/health` 是否可达；再看 Caddy 日志和容器健康检查。局域网版的转圈通常是 Windows 防火墙没放行，远程版没有这个问题。

**Q：能不能不用 Docker？**
A：可以。`pnpm install && pnpm build`，用 `node` 跑 esbuild 产物，systemd 托管，前面用 Nginx/Caddy 反代即可；环境变量与第 5 节一致。Docker 只是把构建和运行固定下来。

**Q：能不能多开几个 Node 进程？**
A：可以，但必须解决状态共享和跨实例广播，见第 3 节。没有做这两件事之前，多副本会出现“同一个房间的人落到不同进程、互相看不到”。

**Q：需要 WebRTC / TURN 吗？**
A：不需要。游戏数据走 WebSocket，拍照是 HTTP 表单式的 base64 上传，不建立 P2P 连接。

**Q：服务器在海外，国内手机延迟高怎么办？**
A：选靠近玩家的区域；WebSocket 对 100–200ms 延迟不敏感，但拍照上传会受上行带宽影响。优先保证上行带宽和 TLS 握手路径。

---

## 10. 上线检查清单

- [ ] 域名 A 记录指向服务器
- [ ] 80 / 443 放行，8787 未对公网开放
- [ ] `PLAYGO_PUBLIC_URL` 与域名完全一致
- [ ] `PLAYGO_ROOM_DISCOVERY=0`
- [ ] `PLAYGO_TRUST_PROXY=1` 且只在反代后面
- [ ] `PLAYGO_MAX_ROOMS` / `PLAYGO_MAX_CONNECTIONS` 已设置
- [ ] `/api/health` 返回 `mode: "remote"`
- [ ] 手机用移动网络扫码能加入
- [ ] 容器重启后能自动恢复服务
- [ ] 日志/监控/证书到期提醒已配置

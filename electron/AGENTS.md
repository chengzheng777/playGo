# electron/AGENTS.md

本目录是 Electron 主进程与打包入口。

- 打包后主进程在 `app.asar` 里，服务端/前端在 `resources/app`；不要用 `__dirname` 直接当资源路径，按 `app.isPackaged` 区分。
- 不要假设 exe 所在目录可写；日志写到用户数据目录或 `process.env.APPDATA`。
- 服务端通过 `utilityProcess.fork` 启动，退出/重启时要清理子进程。
- 自动更新只在安装版 + `app-update.yml` 或 `PLAYGO_UPDATE_URL` 存在时启用。
- 改打包逻辑后至少跑 `pnpm package:app` 的 `win-unpacked` 产物；不要提交 `electron/app/`、`main.build.cjs`。
- 安装包/更新/签名细节见 `docs/PACKAGING.md`；部署见 `docs/REMOTE.md`。
- 不要提交证书、私钥或更新源凭据。

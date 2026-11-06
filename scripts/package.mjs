/**
 * Windows 便携包：把服务端打成单文件 JS，连同 Node 运行时和前端产物打成一个压缩包。
 *
 *   pnpm package:win
 *
 * 产物：release/playGo-<版本>-win-x64.zip
 * 解压后双击 playGo.cmd 即可，目标电脑不需要装 Node。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { firewallCmd } from "./firewall-cmd.mjs";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseDir = process.env.PLAYGO_RELEASE_DIR
  ? path.resolve(process.env.PLAYGO_RELEASE_DIR)
  : path.join(root, "release");
const appDir = path.join(releaseDir, "playGo");
const zipPath = path.join(releaseDir, `playGo-${pkg.version}-win-x64.zip`);

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", cwd: root, ...options });
}

const node = process.execPath;

console.log("\n[1/6] 构建前端");
run(node, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"]);

console.log("[2/6] 打包服务端");
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(path.join(appDir, "app"), { recursive: true });
fs.mkdirSync(path.join(appDir, "runtime"), { recursive: true });

run(node, [
  path.join(root, "node_modules", "esbuild", "bin", "esbuild"),
  "server/index.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node20",
  "--external:vite",
  "--external:bufferutil",
  "--external:utf-8-validate",
  `--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`,
  `--outfile=${path.join(appDir, "app", "server.mjs")}`,
]);

console.log("[3/6] 复制前端产物");
fs.cpSync(path.join(root, "dist"), path.join(appDir, "app", "dist"), { recursive: true });

console.log("[4/6] 复制 Node 运行时");
fs.copyFileSync(process.execPath, path.join(appDir, "runtime", "node.exe"));

console.log("[5/6] 编译启动器（无命令行窗口）");
const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
if (!fs.existsSync(csc)) throw new Error("找不到 csc.exe，需要 .NET Framework 4.x");
run(csc, [
  "/nologo",
  "/target:winexe",
  `/out:${path.join(appDir, "playGo.exe")}`,
  "/r:System.dll",
  "/r:System.Windows.Forms.dll",
  "/r:System.Drawing.dll",
  "/r:System.Net.Http.dll",
  path.join(root, "launcher", "Program.cs"),
  `/win32icon:${path.join(root, "electron", "icon.ico")}`,
]);

console.log("[6/6] 写启动脚本并压缩");
fs.writeFileSync(
  path.join(appDir, "playGo.cmd"),
  [
    "@echo off",
    "chcp 65001 >nul",
    'cd /d "%~dp0"',
    "set PLAYGO_ROOT=%~dp0app",
    '"%~dp0runtime\\node.exe" "%~dp0app\\server.mjs" --prod --open',
    "if errorlevel 1 pause",
    "",
  ].join("\r\n"),
);

fs.writeFileSync(path.join(appDir, "修复防火墙.cmd"), firewallCmd(String.raw`runtime\node.exe`));

fs.writeFileSync(
  path.join(appDir, "使用说明.txt"),
  [
    "playGo 局域网多人游戏",
    "",
    "1. 解压到任意目录（路径不要有特殊符号）。",
    "2. 双击 playGo.exe（推荐）：没有命令行窗口，会自动打开游戏窗口。",
    "   如果双击没反应，改用 playGo.cmd（命令行版，能看到日志）。",
    "3. 手机和电脑连同一个 WiFi，扫码加入。",
    "",
    "托盘图标右键：打开游戏窗口 / 在浏览器中打开 / 退出。",
    "关闭游戏窗口不会停服务；要完全退出，请右键托盘图标 → 退出。",
    "",
    "手机扫码一直转圈 / 无法访问：",
    "  右键「修复防火墙.cmd」→「以管理员身份运行」，然后重新打开 playGo.exe。",
    "  也可以在房间二维码下方点「一键放行」（会弹系统授权）。",
    "",
    "首次运行如果 Windows 防火墙弹窗，请勾选“专用网络”。",
    "如果窗口没自动打开，手动访问 http://localhost:8787（端口被占用时会顺延到 8788 等）。",
    "",
  ].join("\r\n"),
);

run("tar.exe", ["-a", "-c", "-f", zipPath, "-C", releaseDir, "playGo"]);

const zipSize = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
const nodeSize = (fs.statSync(path.join(appDir, "runtime", "node.exe")).size / 1024 / 1024).toFixed(
  1,
);
console.log(`\n完成：${path.relative(root, zipPath)}（${zipSize} MB，Node 运行时 ${nodeSize} MB）`);

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

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseDir = path.join(root, "release");
const appDir = path.join(releaseDir, "playGo");
const zipPath = path.join(releaseDir, `playGo-${pkg.version}-win-x64.zip`);

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", cwd: root, ...options });
}

const node = process.execPath;

console.log("\n[1/5] 构建前端");
run(node, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"]);

console.log("[2/5] 打包服务端");
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

console.log("[3/5] 复制前端产物");
fs.cpSync(path.join(root, "dist"), path.join(appDir, "app", "dist"), { recursive: true });

console.log("[4/5] 复制 Node 运行时");
fs.copyFileSync(process.execPath, path.join(appDir, "runtime", "node.exe"));

console.log("[5/5] 写启动脚本并压缩");
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

fs.writeFileSync(
  path.join(appDir, "使用说明.txt"),
  [
    "playGo 局域网多人游戏",
    "",
    "1. 解压到任意目录（路径不要有特殊符号）。",
    "2. 双击 playGo.cmd，会自动打开浏览器并显示房间二维码。",
    "3. 手机和电脑连同一个 WiFi，扫码加入。",
    "",
    "首次运行如果 Windows 防火墙弹窗，请勾选“专用网络”。",
    "如果浏览器没自动打开，手动访问 http://localhost:8787",
    "",
    "关闭命令行窗口即可停止服务。",
    "",
  ].join("\r\n"),
);

run("tar.exe", ["-a", "-c", "-f", zipPath, "-C", releaseDir, "playGo"]);

const zipSize = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
const nodeSize = (fs.statSync(path.join(appDir, "runtime", "node.exe")).size / 1024 / 1024).toFixed(
  1,
);
console.log(
  `\n完成：release/playGo-${pkg.version}-win-x64.zip（${zipSize} MB，Node 运行时 ${nodeSize} MB）`,
);

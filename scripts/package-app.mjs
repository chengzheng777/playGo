/**
 * 打桌面应用（Electron）：一个带窗口的 playGo.exe，没有命令行黑框。
 *
 *   pnpm package:app
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseDir = path.join(root, "release");
const electronDir = path.join(root, "electron");
const appResources = path.join(electronDir, "app");
const outDir = path.join(releaseDir, "app");
const zipPath = path.join(releaseDir, `playGo-${pkg.version}-win-x64-app.zip`);
const node = process.execPath;
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8"),
).version;
const zipCacheDir = path.join(root, ".cache", "electron");
const electronZip = path.join(zipCacheDir, `electron-v${electronVersion}-win32-x64.zip`);

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", cwd: root, ...options });
}

async function ensureElectronZip() {
  fs.mkdirSync(zipCacheDir, { recursive: true });
  if (fs.existsSync(electronZip) && fs.statSync(electronZip).size > 50 * 1024 * 1024) return;
  if (fs.existsSync(electronZip)) fs.rmSync(electronZip);

  const url = `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-win32-x64.zip`;
  console.log(`  下载 Electron ${electronVersion}：${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(electronZip));
}

console.log("\n[1/5] 构建前端");
run(node, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"]);

console.log("[2/5] 打包服务端");
fs.rmSync(appResources, { recursive: true, force: true });
fs.mkdirSync(appResources, { recursive: true });

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
  `--outfile=${path.join(appResources, "server.mjs")}`,
]);

console.log("[3/5] 复制前端产物");
fs.cpSync(path.join(root, "dist"), path.join(appResources, "dist"), { recursive: true });

console.log("[4/5] 同步版本号");
const electronPkgPath = path.join(electronDir, "package.json");
const electronPkg = JSON.parse(fs.readFileSync(electronPkgPath, "utf8"));
electronPkg.version = pkg.version;
fs.writeFileSync(electronPkgPath, `${JSON.stringify(electronPkg, null, 2)}\n`);

console.log("[5/5] Electron 打包");
await ensureElectronZip();
fs.rmSync(outDir, { recursive: true, force: true });
run(node, [
  path.join(root, "node_modules", "@electron", "packager", "bin", "electron-packager.mjs"),
  electronDir,
  "playGo",
  "--platform=win32",
  "--arch=x64",
  "--out=release/app",
  "--overwrite",
  "--asar=false",
  `--icon=${path.join(electronDir, "icon.ico")}`,
  `--electron-zip-dir=${zipCacheDir}`,
  "--app-version",
  pkg.version,
  "--win32metadata.CompanyName=playGo",
  "--win32metadata.FileDescription=playGo 局域网多人游戏",
  "--win32metadata.ProductName=playGo",
]);

const appDir = path.join(outDir, "playGo-win32-x64");
if (!fs.existsSync(appDir)) throw new Error(`打包目录不存在：${appDir}`);

run("tar.exe", ["-a", "-c", "-f", zipPath, "-C", outDir, "playGo-win32-x64"]);

const zipSize = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n完成：release/playGo-${pkg.version}-win-x64-app.zip（${zipSize} MB）`);
console.log(`可执行文件：${path.join(appDir, "playGo.exe")}`);

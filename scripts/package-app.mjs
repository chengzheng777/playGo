/**
 * Windows 安装版（Electron + NSIS）：生成带开始菜单 / 桌面快捷方式和卸载入口的安装包。
 *
 *   pnpm package:app
 *
 * 产物：
 *   release/app/playGo-<版本>-setup-x64.exe   安装包
 *   release/app/latest.yml                    自动更新清单（配置了 PLAYGO_UPDATE_URL 时）
 *   release/app/win-unpacked/                 免安装目录（调试用）
 *
 * 可选环境变量：
 *   PLAYGO_UPDATE_URL      自动更新源（静态目录，需能访问 latest.yml 和安装包）
 *   CSC_LINK / CSC_KEY_PASSWORD
 *                          代码签名证书（.pfx 路径或 base64）与密码；不填则不签名
 *   PLAYGO_SKIP_BUILD=1    跳过前端 / 服务端构建，只重打安装包（调试脚本用）
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { firewallCmd } from "./firewall-cmd.mjs";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const electronDir = path.join(root, "electron");
const appResources = path.join(electronDir, "app");
const outDir = path.join(root, "release", "app");
const workDir = path.join(root, ".cache", "electron-builder");
const updateUrl = (process.env.PLAYGO_UPDATE_URL ?? "").trim().replace(/\/+$/, "");
const skipBuild = process.env.PLAYGO_SKIP_BUILD === "1";
/** 只出免安装目录，不生成 NSIS 安装包；本地快速验证用。 */
const dirOnly = process.env.PLAYGO_DIR_ONLY === "1";

const node = process.execPath;
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
const esbuildCli = path.join(root, "node_modules", "esbuild", "bin", "esbuild");
const builderCli = path.join(root, "node_modules", "electron-builder", "cli.js");

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", cwd: root, ...options });
}

if (!fs.existsSync(builderCli)) {
  throw new Error("找不到 electron-builder，请先运行 pnpm install");
}

if (!skipBuild) {
  console.log("\n[1/6] 构建前端");
  run(node, [viteCli, "build"]);

  console.log("[2/6] 打包服务端");
  fs.rmSync(appResources, { recursive: true, force: true });
  fs.mkdirSync(appResources, { recursive: true });
  run(node, [
    esbuildCli,
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

  console.log("[3/6] 复制前端产物");
  fs.cpSync(path.join(root, "dist"), path.join(appResources, "dist"), { recursive: true });
} else {
  console.log("\n[1-3/6] 跳过构建，复用 electron/app 里已有的服务端与前端产物");
  if (!fs.existsSync(path.join(appResources, "server.mjs"))) {
    throw new Error("electron/app/server.mjs 不存在，不能跳过构建");
  }
}

console.log("[4/6] 同步版本号并打包主进程");
const electronPkgPath = path.join(electronDir, "package.json");
const electronPkg = JSON.parse(fs.readFileSync(electronPkgPath, "utf8"));
electronPkg.version = pkg.version;
fs.writeFileSync(electronPkgPath, `${JSON.stringify(electronPkg, null, 2)}\n`);

// electron-updater 一起打进主进程，安装包不需要再带 node_modules。
run(node, [
  esbuildCli,
  path.join(electronDir, "main.cjs"),
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node20",
  "--external:electron",
  `--outfile=${path.join(electronDir, "main.build.cjs")}`,
]);

console.log("[5/6] 生成安装包配置");
fs.mkdirSync(workDir, { recursive: true });

// 防火墙规则按 exe 完整路径匹配；安装后由用户右键这个脚本放行。
const firewallFile = path.join(workDir, "修复防火墙.cmd");
fs.writeFileSync(firewallFile, firewallCmd("playGo.exe"));

const config = {
  appId: "com.playgo.app",
  productName: "playGo",
  copyright: `Copyright © ${new Date().getFullYear()} playGo`,
  directories: {
    app: electronDir,
    output: outDir,
    buildResources: electronDir,
  },
  files: ["main.build.cjs", "package.json", "!**/*.map"],
  extraResources: [{ from: appResources, to: "app" }],
  extraFiles: [{ from: firewallFile, to: "修复防火墙.cmd" }],
  asar: true,
  compression: "normal",
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: path.join(electronDir, "icon.ico"),
    // electron-builder 的宏，不是 JS 模板字符串
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder artifactName 宏
    artifactName: "playGo-${version}-setup-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "playGo",
    uninstallDisplayName: "playGo",
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    installerIcon: path.join(electronDir, "icon.ico"),
    uninstallerIcon: path.join(electronDir, "icon.ico"),
  },
};

// 本机缓存过 Electron 时直接用，避免每次打包都从 GitHub 重新下载。
const electronDist = path.join(root, ".cache", "electron", "runtime");
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8"),
).version;
const cachedVersion = fs.existsSync(path.join(electronDist, "version"))
  ? fs.readFileSync(path.join(electronDist, "version"), "utf8").trim()
  : "";
if (cachedVersion === electronVersion && fs.existsSync(path.join(electronDist, "electron.exe"))) {
  config.electronDist = electronDist;
}

if (updateUrl) {
  config.publish = [{ provider: "generic", url: updateUrl }];
  // electron-builder 只在 NSIS 产物里写 app-update.yml；这里显式补一份，
  // 保证免安装目录/不同版本也能被 electron-updater 识别。
  const updateConfig = path.join(workDir, "app-update.yml");
  fs.writeFileSync(
    updateConfig,
    ["provider: generic", `url: ${updateUrl}`, "updaterCacheDirName: playgo-updater", ""].join(
      "\n",
    ),
  );
  config.extraResources.push({ from: updateConfig, to: "app-update.yml" });
  console.log(`  自动更新源：${updateUrl}`);
} else {
  console.log("  未设置 PLAYGO_UPDATE_URL：本次不生成自动更新清单，安装后也不会自动更新");
}

const configPath = path.join(workDir, "electron-builder.json");
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(
  dirOnly ? "[6/6] electron-builder 生成免安装目录" : "[6/6] electron-builder 生成 NSIS 安装包",
);
fs.rmSync(outDir, { recursive: true, force: true });
try {
  run(node, [
    builderCli,
    "--win",
    dirOnly ? "dir" : "nsis",
    "--x64",
    "--config",
    configPath,
    "--publish",
    "never",
  ]);
} catch (error) {
  // NSIS 两步构建会在失败时留下只写了一半的 setup.exe；不要让它被误当成安装包发出去。
  if (fs.existsSync(outDir)) {
    for (const name of fs.readdirSync(outDir)) {
      if (name.endsWith("-setup-x64.exe") || name.endsWith(".nsis.7z")) {
        fs.rmSync(path.join(outDir, name), { force: true });
      }
    }
  }
  throw error;
}

if (dirOnly) {
  console.log(`\n完成：${path.relative(root, path.join(outDir, "win-unpacked", "playGo.exe"))}`);
  console.log("（PLAYGO_DIR_ONLY=1，未生成安装包）");
  process.exit(0);
}

const setupFile = fs.readdirSync(outDir).find((name) => name.endsWith(`-setup-x64.exe`));
if (!setupFile) throw new Error(`安装包未生成：${outDir}`);

const setupPath = path.join(outDir, setupFile);
const setupSize = (fs.statSync(setupPath).size / 1024 / 1024).toFixed(1);
const latestYml = path.join(outDir, "latest.yml");

// 某些 electron-builder 版本在 --publish never 下不写 latest.yml；自动更新源
// 需要它，这里按 electron-updater 的格式补一份（没有 blockmap 时走整包下载）。
if (updateUrl && !fs.existsSync(latestYml)) {
  const data = fs.readFileSync(setupPath);
  const sha512 = crypto.createHash("sha512").update(data).digest("base64");
  fs.writeFileSync(
    latestYml,
    [
      `version: ${pkg.version}`,
      "files:",
      `  - url: ${setupFile}`,
      `    sha512: ${sha512}`,
      `    size: ${data.length}`,
      `path: ${setupFile}`,
      `sha512: ${sha512}`,
      `releaseDate: '${new Date().toISOString()}'`,
      "",
    ].join("\n"),
  );
}
console.log(`\n完成：${path.relative(root, path.join(outDir, setupFile))}（${setupSize} MB）`);
console.log(`免安装目录：${path.relative(root, path.join(outDir, "win-unpacked", "playGo.exe"))}`);
if (fs.existsSync(latestYml)) {
  console.log(`更新清单：${path.relative(root, latestYml)}`);
  console.log("");
  console.log(
    "发布更新时，把 latest.yml、安装包和 *.blockmap 一起放到 PLAYGO_UPDATE_URL 指向的目录。",
  );
} else {
  console.log("");
  console.log("没有生成 latest.yml：自动更新未启用。设置 PLAYGO_UPDATE_URL 后重新打包即可。");
}
if (!process.env.CSC_LINK) {
  console.log("");
  console.log("提示：当前安装包未签名，首次运行可能触发 SmartScreen。");
  console.log("      设置 CSC_LINK / CSC_KEY_PASSWORD 后重新打包即可签名。");
}

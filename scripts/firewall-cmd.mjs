/**
 * 生成 Windows 防火墙放行脚本（双击会自己请求管理员权限）。
 *
 * 便携包里的 node.exe / Electron 的 playGo.exe 都换了一个路径，等于一个新程序，
 * 没有入站放行规则时手机的连接会被整包丢掉。压缩包没法带安装器去写规则，所以给一个 .cmd。
 *
 * @param {string} exe 相对于包根目录的可执行文件路径，例如 "runtime\\node.exe"
 */
export function firewallCmd(exe) {
  return [
    "@echo off",
    "chcp 65001 >nul",
    'cd /d "%~dp0"',
    "net session >nul 2>&1",
    'if not "%errorlevel%"=="0" (',
    "  echo 需要管理员权限，正在请求授权……",
    "  powershell -NoProfile -ExecutionPolicy Bypass -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"",
    "  exit /b",
    ")",
    `set "PLAYGO_EXE=%~dp0${exe}"`,
    "echo 正在放行：%PLAYGO_EXE%",
    'netsh advfirewall firewall delete rule name="playGo 局域网访问" >nul 2>&1',
    'netsh advfirewall firewall add rule name="playGo 局域网访问" dir=in action=allow program="%PLAYGO_EXE%" enable=yes profile=any',
    "if errorlevel 1 (",
    "  echo.",
    "  echo 放行失败：请确认这个窗口是「以管理员身份运行」的。",
    ") else (",
    "  echo.",
    "  echo 已放行。关掉这个窗口，重新打开 playGo，再让手机扫码。",
    ")",
    "echo.",
    "pause",
    "",
  ].join("\r\n");
}

/** 用了放行脚本时，使用说明里统一的一句提示 */
export const FIREWALL_TIP =
  "手机扫码一直转圈 / 无法访问：右键「修复防火墙.cmd」→「以管理员身份运行」。";

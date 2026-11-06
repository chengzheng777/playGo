import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Windows 防火墙自检 + 一键放行。
 *
 * 便携包里的 node.exe（或 Electron 的 playGo.exe）换了一个路径，就等于一个新程序：
 * 没有入站放行规则时，手机的连接会被整包丢掉，表现是扫码后一直转圈 / 无法访问。
 * 放行规则按「可执行文件完整路径」匹配，所以开发时的 node.exe 被放行过，并不能让打包版也被放行。
 */

const RULE_KEY = String.raw`HKLM\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules`;
const POLICY_KEY = String.raw`HKLM\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy`;

export const RULE_NAME = "playGo 局域网访问";

export type ProfileName = "domain" | "private" | "public";

const ALL_PROFILES: ProfileName[] = ["domain", "private", "public"];

const PROFILE_MAP: Record<string, ProfileName> = {
  domain: "domain",
  private: "private",
  public: "public",
};

const PROFILE_LABEL: Record<ProfileName, string> = {
  domain: "域",
  private: "专用",
  public: "公用",
};

export function profileLabel(profile: ProfileName): string {
  return PROFILE_LABEL[profile];
}

export interface FirewallRule {
  /** 规则生效的网络类型；空数组表示全部 */
  profiles: ProfileName[];
}

export interface FirewallStatus {
  /** 只有 Windows 才有这套防火墙 */
  applicable: boolean;
  /** 是否成功读到规则（读注册表不需要管理员） */
  readable: boolean;
  /** 防火墙是否开启；null = 读不到 */
  enabled: boolean | null;
  /** 是否已有放行本程序的入站规则；null = 无法判断 */
  allowed: boolean | null;
  /** 当前可执行文件 */
  program: string;
  rules: FirewallRule[];
  /** 规则没覆盖到的网络类型（例如只放行了公用网络） */
  missingProfiles: ProfileName[];
  /** 给用户复制的手动放行命令 */
  command: string;
}

export interface FirewallFixResult {
  ok: boolean;
  reason?: "unsupported" | "timeout";
  status: FirewallStatus;
}

/** 手动放行命令，直接贴进「管理员 PowerShell」就能执行 */
export function firewallCommand(program: string): string {
  return [
    "netsh advfirewall firewall add rule",
    `name="${RULE_NAME}"`,
    "dir=in action=allow",
    `program="${program}"`,
    "enable=yes profile=any",
  ].join(" ");
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** 交给提权 PowerShell 执行的脚本 */
export function renderFixScript(program: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$name = ${psQuote(RULE_NAME)}`,
    `$program = ${psQuote(program)}`,
    'netsh advfirewall firewall delete rule name="$name" 2>$null | Out-Null',
    'netsh advfirewall firewall add rule name="$name" dir=in action=allow program="$program" enable=yes profile=any | Out-Null',
    "Write-Output 'ok'",
    "",
  ].join("\r\n");
}

function execFileRaw(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "reg",
      args,
      { windowsHide: true, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout as unknown as Buffer);
      },
    );
  });
}

/**
 * reg.exe 往管道里写的是控制台代码页（中文系统是 GBK），
 * 不按这个解码的话，解压到中文目录下的路径会变成乱码、比对失败。
 */
let encodingPromise: Promise<string> | null = null;

function consoleEncoding(): Promise<string> {
  encodingPromise ??= (async () => {
    const map: Record<string, string> = {
      "932": "shift_jis",
      "936": "gbk",
      "949": "euc-kr",
      "950": "big5",
      "65001": "utf-8",
      "866": "ibm866",
    };
    try {
      const raw = await execFileRaw([
        "query",
        String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage`,
        "/v",
        "OEMCP",
      ]);
      const match = /OEMCP\s+REG_SZ\s+(\d+)/i.exec(raw.toString("latin1"));
      return map[match?.[1] ?? ""] ?? "windows-1252";
    } catch {
      return "utf-8";
    }
  })();
  return encodingPromise;
}

async function runReg(args: string[]): Promise<string> {
  const buffer = await execFileRaw(args);
  const label = await consoleEncoding();
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function normalizeProgram(value: string): string {
  return value
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\//g, "\\")
    .toLowerCase();
}

function parseRuleBody(value: string): Record<string, string[]> {
  const parts: Record<string, string[]> = {};
  for (const chunk of value.split("|")) {
    const index = chunk.indexOf("=");
    if (index <= 0) continue;
    const key = chunk.slice(0, index).trim().toLowerCase();
    const item = chunk.slice(index + 1).trim();
    const list = parts[key] ?? [];
    list.push(item);
    parts[key] = list;
  }
  return parts;
}

function firstValue(parts: Record<string, string[]>, key: string): string {
  return parts[key]?.[0] ?? "";
}

function coversPort(parts: Record<string, string[]>, port: number): boolean {
  const raw = firstValue(parts, "lport");
  if (!raw || raw === "*") return true;
  for (const item of raw.split(",")) {
    const piece = item.trim();
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
    if (range) {
      if (port >= Number(range[1]) && port <= Number(range[2])) return true;
      continue;
    }
    if (/^\d+$/.test(piece) && Number(piece) === port) return true;
  }
  return false;
}

/**
 * 从 `reg query ...\FirewallRules` 的输出里挑出放行本程序的入站规则。
 * 导出是为了能拿真实输出做单元测试。
 */
export function parseRules(text: string, program: string, port?: number): FirewallRule[] {
  const target = normalizeProgram(program);
  const rules: FirewallRule[] = [];

  for (const line of text.split(/\r?\n/)) {
    const marker = line.indexOf("REG_SZ");
    if (marker < 0) continue;
    const value = line.slice(marker + "REG_SZ".length).trim();
    if (!value.includes("App=")) continue;

    const parts = parseRuleBody(value);
    const app = firstValue(parts, "app");
    if (!app || normalizeProgram(app) !== target) continue;

    if (firstValue(parts, "action").toLowerCase() !== "allow") continue;
    if (firstValue(parts, "dir").toLowerCase() !== "in") continue;
    if (firstValue(parts, "active").toLowerCase() === "false") continue;
    if (firstValue(parts, "enabled").toLowerCase() === "false") continue;

    const protocol = firstValue(parts, "protocol").toLowerCase();
    if (protocol && protocol !== "6" && protocol !== "256" && protocol !== "tcp") continue;
    if (port !== undefined && !coversPort(parts, port)) continue;

    const profiles = (parts.profile ?? [])
      .map((item) => PROFILE_MAP[item.toLowerCase()])
      .filter((item): item is ProfileName => Boolean(item));

    rules.push({ profiles: profiles.length > 0 ? profiles : [...ALL_PROFILES] });
  }

  return rules;
}

async function readEnabled(): Promise<boolean | null> {
  const flags = await Promise.all(
    ["DomainProfile", "StandardProfile", "PublicProfile"].map(async (profile) => {
      try {
        const text = await runReg(["query", `${POLICY_KEY}\\${profile}`, "/v", "EnableFirewall"]);
        const match = /EnableFirewall\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(text);
        return match ? Number.parseInt(match[1], 16) === 1 : null;
      } catch {
        return null;
      }
    }),
  );

  if (flags.every((flag) => flag === null)) return null;
  return flags.some((flag) => flag === true);
}

async function readStatus(program: string, port?: number): Promise<FirewallStatus> {
  const base: FirewallStatus = {
    applicable: process.platform === "win32",
    readable: false,
    enabled: null,
    allowed: null,
    program,
    rules: [],
    missingProfiles: [],
    command: firewallCommand(program),
  };
  if (!base.applicable) return base;

  let text: string;
  try {
    text = await runReg(["query", RULE_KEY]);
  } catch {
    return base;
  }

  const rules = parseRules(text, program, port);
  const enabled = await readEnabled();
  const allowed = enabled === false ? true : rules.length > 0;
  const covered = new Set(rules.flatMap((rule) => rule.profiles));
  const missingProfiles =
    rules.length > 0 && enabled !== false ? ALL_PROFILES.filter((item) => !covered.has(item)) : [];

  return { ...base, readable: true, enabled, allowed, rules, missingProfiles };
}

let cache: { at: number; status: FirewallStatus } | null = null;

export async function firewallStatus(
  options: { port?: number; program?: string; refresh?: boolean } = {},
): Promise<FirewallStatus> {
  const program = options.program ?? process.execPath;
  if (
    !options.refresh &&
    cache &&
    cache.status.program === program &&
    Date.now() - cache.at < 5_000
  ) {
    return cache.status;
  }

  const status = await readStatus(program, options.port);
  cache = { at: Date.now(), status };
  return status;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* 临时文件删不掉不影响结果 */
  }
}

/**
 * 弹 UAC 提权加一条入站放行规则，然后等规则出现。
 * 用户点了「否」或者系统策略禁用提权时，会等到超时再返回 ok:false。
 */
export async function openFirewall(port?: number): Promise<FirewallFixResult> {
  const before = await firewallStatus({ port, refresh: true });
  if (!before.applicable) return { ok: false, reason: "unsupported", status: before };
  if (before.allowed && before.missingProfiles.length === 0) return { ok: true, status: before };

  const script = path.join(os.tmpdir(), `playgo-firewall-${process.pid}-${Date.now()}.ps1`);
  try {
    // 带 BOM，Windows PowerShell 5.1 才会按 UTF-8 读中文规则名
    fs.writeFileSync(script, `\uFEFF${renderFixScript(before.program)}`, "utf8");
  } catch {
    return { ok: false, reason: "timeout", status: before };
  }

  const inner = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}"`;
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList '${inner}'`,
  ];

  try {
    execFile("powershell.exe", args, { windowsHide: true }, () => undefined);
  } catch {
    /* 提权失败按超时处理 */
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await delay(700);
    const status = await firewallStatus({ port, refresh: true });
    if (status.allowed && status.missingProfiles.length === 0) {
      removeQuietly(script);
      return { ok: true, status };
    }
  }

  removeQuietly(script);
  return { ok: false, reason: "timeout", status: await firewallStatus({ port, refresh: true }) };
}

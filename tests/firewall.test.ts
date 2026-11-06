import { describe, expect, it } from "vitest";
import { firewallCommand, parseRules, renderFixScript } from "../server/firewall";

const EXE = String.raw`D:\Git\playGo\release\playGo\runtime\node.exe`;

/** 一行 reg query 输出 */
function rule(fields: string): string {
  return `    {7A1B0C2D-0000-0000-0000-000000000000}    REG_SZ    ${fields}`;
}

const HEADER = [
  "",
  "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules",
  "",
];

describe("parseRules", () => {
  it("认出处放行本程序的入站 TCP 规则", () => {
    const text = [
      ...HEADER,
      rule(`v2.10|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Public|App=${EXE}`),
      "",
    ].join("\r\n");

    expect(parseRules(text, EXE)).toEqual([{ profiles: ["public"] }]);
  });

  it("没有 Profile 的规则视为覆盖全部网络", () => {
    const text = rule(`v2.33|Action=Allow|Active=TRUE|Dir=In|App=${EXE}`);
    expect(parseRules(text, EXE)).toEqual([{ profiles: ["domain", "private", "public"] }]);
  });

  it("路径比对不区分大小写和斜杠方向", () => {
    const text = rule(
      "v2.33|Action=Allow|Dir=In|App=d:/git/PLAYGO/release/playgo/runtime/NODE.EXE",
    );
    expect(parseRules(text, EXE)).toHaveLength(1);
  });

  it("只放行 UDP、出站或已停用的规则不算", () => {
    const text = [
      rule(`v2.33|Action=Allow|Dir=In|Protocol=17|App=${EXE}`),
      rule(`v2.33|Action=Allow|Active=FALSE|Dir=In|App=${EXE}`),
      rule(`v2.33|Action=Allow|Dir=Out|App=${EXE}`),
      rule(`v2.33|Action=Block|Dir=In|App=${EXE}`),
    ].join("\r\n");

    expect(parseRules(text, EXE)).toEqual([]);
  });

  it("别的程序（例如开发用的系统 node.exe）不会误判", () => {
    const text = rule(
      "v2.10|Action=Allow|Dir=In|Protocol=6|Profile=Private|App=C:\\program files\\nodejs\\node.exe",
    );
    expect(parseRules(text, EXE)).toEqual([]);
  });

  it("端口范围要覆盖当前端口", () => {
    const covered = rule(`v2.33|Action=Allow|Dir=In|Protocol=6|LPort=8787-8797|App=${EXE}`);
    const other = rule(`v2.33|Action=Allow|Dir=In|Protocol=6|LPort=9000|App=${EXE}`);

    expect(parseRules(covered, EXE, 8788)).toHaveLength(1);
    expect(parseRules(covered, EXE, 9999)).toEqual([]);
    expect(parseRules(other, EXE, 8788)).toEqual([]);
    expect(parseRules(other, EXE, 9000)).toHaveLength(1);
  });
});

describe("firewallCommand", () => {
  it("给出可直接粘贴的 netsh 放行命令", () => {
    const command = firewallCommand(EXE);
    expect(command).toContain("netsh advfirewall firewall add rule");
    expect(command).toContain("dir=in action=allow");
    expect(command).toContain("profile=any");
    expect(command).toContain(`program="${EXE}"`);
  });
});

describe("renderFixScript", () => {
  it("先删同名规则再放行，并对路径里的单引号做转义", () => {
    const script = renderFixScript(String.raw`D:\it's\playGo\node.exe`);
    expect(script).toContain("netsh advfirewall firewall delete rule");
    expect(script).toContain("netsh advfirewall firewall add rule");
    expect(script).toContain("D:\\it''s\\playGo\\node.exe");
  });
});

import type { IncomingMessage } from "node:http";
import os from "node:os";

export type NetKind = "wifi" | "ethernet" | "other" | "virtual";

export interface LanAddress {
  ip: string;
  iface: string;
  kind: NetKind;
}

const VIRTUAL_RE =
  /(vethernet|vmware|virtualbox|hyper-v|wsl|docker|loopback|tailscale|zerotier|wireguard|openvpn|vpn|tap|tun|utun|hamachi|radmin|npcap)/i;
const WIFI_RE = /(wi-?fi|wlan|wireless|无线)/i;
const ETH_RE = /(ethernet|以太网|本地连接)/i;

const RANK: Record<NetKind, number> = { wifi: 0, ethernet: 1, other: 2, virtual: 3 };

/**
 * 列出可用于局域网访问的 IPv4 地址。
 * 过滤掉回环、链路本地（169.254/16）与常见虚拟网卡，按「无线 > 有线 > 其他 > 虚拟」排序。
 */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  const seen = new Set<string>();

  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (addr.address.startsWith("169.254.")) continue;
      if (seen.has(addr.address)) continue;
      seen.add(addr.address);

      let kind: NetKind = "other";
      if (VIRTUAL_RE.test(name)) kind = "virtual";
      else if (WIFI_RE.test(name)) kind = "wifi";
      else if (ETH_RE.test(name)) kind = "ethernet";

      out.push({ ip: addr.address, iface: name, kind });
    }
  }

  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.ip.localeCompare(b.ip));
}

/**
 * 取客户端 IP：反代后面用 X-Forwarded-For 的第一段；直连时用 socket 地址。
 * 只有明确设置 PLAYGO_TRUST_PROXY=1 才信任代理头，避免被伪造。
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

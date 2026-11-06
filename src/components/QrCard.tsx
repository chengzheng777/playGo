import { useEffect, useState } from "react";

interface Networks {
  port: number;
  urls: { ip: string; iface: string; kind: string }[];
  host?: string;
  publicUrl?: string;
}

interface FirewallStatus {
  applicable: boolean;
  readable: boolean;
  enabled: boolean | null;
  allowed: boolean | null;
  program: string;
  rules: { profiles: string[] }[];
  missingProfiles: string[];
  command: string;
}

interface FixResult {
  ok: boolean;
  reason?: string;
  status: FirewallStatus;
}

const KIND_LABEL: Record<string, string> = {
  wifi: "无线",
  ethernet: "有线",
  other: "网络",
  virtual: "虚拟网卡",
};

const PROFILE_LABEL: Record<string, string> = {
  domain: "域",
  private: "专用",
  public: "公用",
};

const SHARE_KEY = "playgo:share";

type ShareMode = "lan" | "public";

interface SharePref {
  mode: ShareMode;
  url: string;
}

function readShare(): SharePref | null {
  try {
    const raw = localStorage.getItem(SHARE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SharePref>;
    if (value.mode !== "lan" && value.mode !== "public") return null;
    return { mode: value.mode, url: typeof value.url === "string" ? value.url : "" };
  } catch {
    return null;
  }
}

function normalizeBase(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function QrCard({ code }: { code: string }) {
  const [networks, setNetworks] = useState<Networks | null>(null);
  const [ip, setIp] = useState("");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<ShareMode>("lan");
  const [publicUrl, setPublicUrl] = useState("");
  const [firewall, setFirewall] = useState<FirewallStatus | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixNote, setFixNote] = useState("");
  const [copiedFix, setCopiedFix] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/networks")
      .then((response) => response.json() as Promise<Networks>)
      .then((data) => {
        if (!alive) return;
        setNetworks(data);
        setIp(data.urls[0]?.ip ?? "");
        const saved = readShare();
        const serverPublic = normalizeBase(data.publicUrl ?? "");
        if (saved) {
          setMode(saved.mode);
          setPublicUrl(saved.url || serverPublic);
        } else if (serverPublic) {
          setMode("public");
          setPublicUrl(serverPublic);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/firewall")
      .then((response) => response.json() as Promise<FirewallStatus>)
      .then((data) => {
        if (alive) setFirewall(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!networks) return;
    try {
      localStorage.setItem(SHARE_KEY, JSON.stringify({ mode, url: publicUrl }));
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [mode, publicUrl, networks]);

  const port = networks?.port ?? (location.port || "8787");
  const publicBase = normalizeBase(publicUrl);
  const usePublic = mode === "public" && publicBase.length > 0;
  const lanUrl = ip ? `http://${ip}:${port}/j/${code}` : `${location.origin}/j/${code}`;
  const url = usePublic ? `${publicBase}/j/${code}` : lanUrl;

  const programName = firewall?.program.split(/[\\/]/).pop() ?? "playGo";
  const missingProfiles = firewall?.missingProfiles ?? [];
  const needsFix =
    firewall?.applicable === true &&
    (firewall.allowed === false || (firewall.allowed === true && missingProfiles.length > 0));
  const coveredLabel = ["domain", "private", "public"]
    .filter((item) => !missingProfiles.includes(item))
    .map((item) => PROFILE_LABEL[item] ?? item)
    .join(" / ");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function copyCommand() {
    if (!firewall) return;
    try {
      await navigator.clipboard.writeText(firewall.command);
      setCopiedFix(true);
      window.setTimeout(() => setCopiedFix(false), 1500);
    } catch {
      setCopiedFix(false);
    }
  }

  async function allowFirewall() {
    setFixing(true);
    setFixNote("");
    try {
      const response = await fetch("/api/firewall/open", { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as FixResult;
      setFirewall(data.status);
      setFixNote(
        data.ok
          ? "已放行，用手机重新扫码试试。"
          : "没有放行成功：可能取消了系统授权，或这台电脑的策略不允许自动放行。可以复制下面的命令手动执行。",
      );
    } catch {
      setFixNote("放行失败，请在管理员 PowerShell 里执行下面的命令。");
    } finally {
      setFixing(false);
    }
  }

  return (
    <section className="panel qr-panel">
      <div className="qr-frame">
        <img
          src={`/api/qr?text=${encodeURIComponent(url)}`}
          alt={`加入房间 ${code} 的二维码`}
          width={320}
          height={320}
        />
      </div>
      <p className="qr-tip">
        <span className={`share-badge${usePublic ? " public" : ""}`}>
          {usePublic ? "公网地址" : "局域网地址"}
        </span>
        手机相机扫码加入
      </p>

      <div className="url-line">
        <code>{url}</code>
        <button className="btn btn-mini" onClick={copy}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>

      <div className="share-row">
        <span className="label">分享方式</span>
        <div className="segmented">
          <button
            type="button"
            className={mode === "lan" ? "on" : ""}
            onClick={() => setMode("lan")}
          >
            局域网
          </button>
          <button
            type="button"
            className={mode === "public" ? "on" : ""}
            onClick={() => setMode("public")}
          >
            公网
          </button>
        </div>
      </div>

      {mode === "public" && (
        <div className="public-share">
          <input
            className="input"
            value={publicUrl}
            placeholder="https://xxxx.trycloudflare.com"
            onChange={(event) => setPublicUrl(event.target.value)}
          />
          {publicBase ? (
            <p className="hint">
              公网地址需要先做端口映射或内网穿透。拿到链接的人都能加入，注意分享范围。
            </p>
          ) : (
            <p className="warn">填写可访问的公网地址（含 http/https），或切回局域网。</p>
          )}
        </div>
      )}

      {networks && networks.urls.length > 1 && mode === "lan" && (
        <div className="net-picker">
          <label className="label" htmlFor="net">
            用哪个网络
          </label>
          <select id="net" value={ip} onChange={(event) => setIp(event.target.value)}>
            {networks.urls.map((item) => (
              <option key={item.ip} value={item.ip}>
                {item.ip} · {KIND_LABEL[item.kind] ?? item.kind}（{item.iface}）
              </option>
            ))}
          </select>
        </div>
      )}

      {networks && networks.urls.length === 0 && (
        <p className="warn">没检测到局域网地址，先把电脑连上 WiFi 或网线。</p>
      )}

      {needsFix && firewall && !usePublic && (
        <div className="fw-card">
          <p className="fw-title">手机扫码连不上？</p>
          <p className="fw-text">
            {firewall.allowed
              ? `防火墙只对「${coveredLabel}」网络放行，换成另一种网络手机就又连不上了。`
              : `Windows 防火墙还没放行 ${programName}，手机发来的请求会被整包丢掉——不只是端口，是整个程序都没放行。`}
          </p>
          <div className="fw-actions">
            <button
              type="button"
              className="btn btn-mini btn-primary"
              onClick={allowFirewall}
              disabled={fixing}
            >
              {fixing ? "等待授权…" : "一键放行"}
            </button>
            <button type="button" className="btn btn-mini" onClick={copyCommand}>
              {copiedFix ? "已复制" : "复制手动命令"}
            </button>
          </div>
          <p className="fw-hint">
            点「一键放行」会弹出 Windows
            的账户控制，选「是」就行；也可以右键包里的「修复防火墙.cmd」，用管理员身份运行。
          </p>
          {fixNote && <p className="fw-hint">{fixNote}</p>}
          <code className="fw-cmd">{firewall.command}</code>
        </div>
      )}
    </section>
  );
}

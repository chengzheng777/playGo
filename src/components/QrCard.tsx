import { useEffect, useState } from "react";

interface Networks {
  port: number;
  urls: { ip: string; iface: string; kind: string }[];
}

const KIND_LABEL: Record<string, string> = {
  wifi: "无线",
  ethernet: "有线",
  other: "网络",
  virtual: "虚拟网卡",
};

export function QrCard({ code }: { code: string }) {
  const [networks, setNetworks] = useState<Networks | null>(null);
  const [ip, setIp] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/networks")
      .then((response) => response.json() as Promise<Networks>)
      .then((data) => {
        if (!alive) return;
        setNetworks(data);
        setIp(data.urls[0]?.ip ?? "");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const port = networks?.port ?? (location.port || "8787");
  const url = ip ? `http://${ip}:${port}/j/${code}` : `${location.origin}/j/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
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
      <p className="qr-tip">手机相机扫码加入</p>

      <div className="url-line">
        <code>{url}</code>
        <button className="btn btn-mini" onClick={copy}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>

      {networks && networks.urls.length > 1 && (
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
    </section>
  );
}

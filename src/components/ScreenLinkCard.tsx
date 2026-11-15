import { useEffect, useState } from "react";

interface Networks {
  port: number;
  urls: { ip: string; iface: string; kind: string }[];
  publicUrl?: string;
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

/** 房主参赛时展示独立观战大屏链接；不打开也能正常玩 */
export function ScreenLinkCard({ code }: { code: string }) {
  const [base, setBase] = useState(location.origin);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/networks")
      .then((response) => response.json() as Promise<Networks>)
      .then((data) => {
        if (!alive) return;
        const publicBase = normalizeBase(data.publicUrl ?? "");
        if (publicBase) {
          setBase(publicBase);
          return;
        }
        const ip = data.urls[0]?.ip;
        if (ip) setBase(`http://${ip}:${data.port}`);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const url = `${base}/s/${code}`;

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
    <section className="panel screen-link-panel">
      <div className="panel-head">
        <h2>独立大屏</h2>
        <span className="count">可选 · 观战席</span>
      </div>
      <p className="setting-hint">
        用电视或另一台设备打开这个链接。大屏只展示游戏画面，不占玩家名额，也没有开始/踢人等房主控制。
      </p>
      <div className="url-line">
        <code>{url}</code>
        <button type="button" className="btn btn-mini" onClick={copy}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <a className="btn btn-ghost btn-block" href={url} target="_blank" rel="noreferrer">
        在新标签页打开大屏
      </a>
    </section>
  );
}

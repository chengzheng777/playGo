import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientIp } from "../server/net";

function request(headers: Record<string, string>, remoteAddress: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe("clientIp", () => {
  it("直连时使用 socket 地址", () => {
    expect(clientIp(request({}, "192.168.1.20"), false)).toBe("192.168.1.20");
  });

  it("不信任代理头时忽略 X-Forwarded-For", () => {
    const req = request({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.2");
    expect(clientIp(req, false)).toBe("10.0.0.2");
  });

  it("信任代理时取 X-Forwarded-For 第一段", () => {
    const req = request({ "x-forwarded-for": "1.2.3.4, 10.0.0.2" }, "10.0.0.2");
    expect(clientIp(req, true)).toBe("1.2.3.4");
  });

  it("代理头为空时回退到 socket 地址", () => {
    const req = request({ "x-forwarded-for": "  " }, "10.0.0.2");
    expect(clientIp(req, true)).toBe("10.0.0.2");
  });
});

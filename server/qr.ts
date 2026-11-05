import QRCode from "qrcode";

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
    color: { dark: "#0b1015", light: "#ffffff" },
  });
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface PhotoAnalysis {
  photo: string;
  rgb: Rgb;
  width: number;
  height: number;
}

const MAX_EDGE = 360;
const CENTER_RATIO = 0.44;

/**
 * 用原生相机拍完后在本地压缩 + 取中心色：
 * - 不申请摄像头流，避免实时预览的解码开销，也不受局域网 HTTP 的安全上下文限制
 * - 只做一次缩放 + 一次 getImageData，几百毫秒内完成
 */
export async function analyzePhoto(file: File): Promise<PhotoAnalysis> {
  const bitmap = await loadImage(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(bitmap.source, 0, 0, width, height);

    const cw = Math.max(1, Math.round(width * CENTER_RATIO));
    const ch = Math.max(1, Math.round(height * CENTER_RATIO));
    const cx = Math.round((width - cw) / 2);
    const cy = Math.round((height - ch) / 2);
    const data = ctx.getImageData(cx, cy, cw, ch).data;

    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }

    return {
      photo: canvas.toDataURL("image/jpeg", 0.62),
      rgb: {
        r: Math.round(r / count),
        g: Math.round(g / count),
        b: Math.round(b / count),
      },
      width,
      height,
    };
  } finally {
    bitmap.cleanup();
  }
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      /* 某些浏览器不支持 options，退回 <img> */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image decode failed"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function rgbText(rgb: Rgb): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

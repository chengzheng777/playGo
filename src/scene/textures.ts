import * as THREE from "three";

function makeTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

/** 固定种子，保证每次进房间的木纹一致 */
function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

function plankTexture(
  base: string,
  seam: string,
  highlight: string,
  seed: number,
): THREE.CanvasTexture {
  const random = seeded(seed);
  const texture = makeTexture(32, 32, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 32, 32);
    for (let row = 0; row < 8; row++) {
      ctx.fillStyle = row % 2 === 0 ? base : highlight;
      ctx.fillRect(0, row * 4, 32, 4);
      ctx.fillStyle = seam;
      ctx.fillRect(0, row * 4 + 3, 32, 1);
      // 木纹
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = random() > 0.5 ? seam : highlight;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(Math.floor(random() * 32), Math.floor(random() * 32), 2, 1);
      }
      ctx.globalAlpha = 1;
      // 错缝
      const offset = (row * 13) % 32;
      ctx.fillStyle = seam;
      ctx.fillRect(offset, row * 4, 1, 4);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createFloorTexture(): THREE.CanvasTexture {
  const texture = plankTexture("#8a5f3c", "#5d3d27", "#a4714a", 7);
  texture.repeat.set(5.4, 4.4);
  return texture;
}

export function createOakTexture(): THREE.CanvasTexture {
  const texture = plankTexture("#b98b52", "#7b5735", "#c9a063", 19);
  texture.repeat.set(2, 2);
  return texture;
}

export function createTableTexture(): THREE.CanvasTexture {
  const texture = plankTexture("#c9a063", "#8a6238", "#d8b57c", 31);
  texture.repeat.set(3, 3);
  return texture;
}

export function createDarkOakTexture(): THREE.CanvasTexture {
  const texture = plankTexture("#7b5735", "#523620", "#8a6238", 43);
  texture.repeat.set(2, 2);
  return texture;
}

export function createWallTexture(): THREE.CanvasTexture {
  const random = seeded(61);
  const texture = makeTexture(32, 32, (ctx) => {
    ctx.fillStyle = "#cbb794";
    ctx.fillRect(0, 0, 32, 32);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? "#c2ab88" : "#d5c3a1";
        ctx.globalAlpha = 0.55;
        ctx.fillRect(col * 8, row * 8, 8, 8);
        ctx.globalAlpha = 1;
      }
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = random() > 0.5 ? "#b39d7c" : "#ddccab";
      ctx.globalAlpha = 0.4;
      ctx.fillRect(Math.floor(random() * 32), Math.floor(random() * 32), 1, 1);
    }
    ctx.globalAlpha = 1;
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 2);
  return texture;
}

export function createRugTexture(): THREE.CanvasTexture {
  const texture = makeTexture(32, 32, (ctx) => {
    ctx.fillStyle = "#315048";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "#3f6b5c";
    ctx.fillRect(2, 2, 28, 28);
    ctx.fillStyle = "#315048";
    ctx.fillRect(5, 5, 22, 22);
    ctx.fillStyle = "#3ee08f";
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(7 + i * 5, 8, 2, 2);
      ctx.fillRect(7 + i * 5, 22, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#264038";
    ctx.fillRect(0, 14, 32, 4);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createNightTexture(): THREE.CanvasTexture {
  const random = seeded(97);
  return makeTexture(32, 32, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 32);
    gradient.addColorStop(0, "#0b1626");
    gradient.addColorStop(1, "#23324a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = random() > 0.75 ? "#ffe9a8" : "#c9dcff";
      ctx.fillRect(Math.floor(random() * 32), Math.floor(random() * 20), 1, 1);
    }
    ctx.fillStyle = "#f5e6b8";
    ctx.fillRect(23, 4, 4, 4);
    ctx.fillStyle = "#d8c58f";
    ctx.fillRect(24, 5, 2, 2);
  });
}

export function createScreenTexture(code: string): THREE.CanvasTexture {
  return makeTexture(64, 32, (ctx) => {
    ctx.fillStyle = "#07120d";
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = "#123324";
    ctx.fillRect(2, 2, 60, 28);
    ctx.fillStyle = "#3ee08f";
    ctx.fillRect(2, 2, 60, 1);
    ctx.fillRect(2, 29, 60, 1);
    ctx.fillRect(2, 2, 1, 28);
    ctx.fillRect(61, 2, 1, 28);
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "#d9ffe9";
    ctx.fillText("playGo", 5, 13);
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#3ee08f";
    ctx.fillText(code, 5, 25);
    ctx.fillStyle = "#ffd98a";
    ctx.fillRect(48, 18, 8, 3);
    ctx.fillStyle = "#8a9bad";
    ctx.fillRect(48, 23, 5, 2);
  });
}

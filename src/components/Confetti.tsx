import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
  shape: "rect" | "circle";
}

const COLORS = ["#3ee08f", "#38e1ff", "#8b5cf6", "#fbbf24", "#fb7185", "#f8fafc"];

/** 答对时炸一束，获胜时持续飘落。纯 Canvas，不引第三方库。 */
export function Confetti({ burst, rain }: { burst: number; rain: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const rainRef = useRef(rain);
  const lastBurst = useRef(burst);

  useEffect(() => {
    rainRef.current = rain;
  }, [rain]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const spawnRain = () => {
      particles.current.push({
        x: Math.random() * width,
        y: -24,
        vx: (Math.random() - 0.5) * 1.4,
        vy: 1.6 + Math.random() * 2.2,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.22,
        size: 6 + Math.random() * 7,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 4200,
        shape: Math.random() > 0.4 ? "rect" : "circle",
      });
    };

    let raf = 0;
    let last = performance.now();

    const loop = (time: number) => {
      const dt = Math.min(48, time - last);
      last = time;
      const step = dt / 16.67;

      if (rainRef.current && particles.current.length < 240) {
        for (let i = 0; i < 3; i++) spawnRain();
      }

      const alive: Particle[] = [];
      for (const particle of particles.current) {
        particle.life -= dt;
        if (particle.life <= 0) continue;
        particle.vy += 0.13 * step;
        particle.vx *= 0.994;
        particle.x += particle.vx * step;
        particle.y += particle.vy * step;
        particle.rot += particle.vr * step;
        alive.push(particle);
      }
      particles.current = alive;

      ctx.clearRect(0, 0, width, height);
      for (const particle of particles.current) {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot);
        ctx.globalAlpha = Math.min(1, particle.life / 420);
        ctx.fillStyle = particle.color;
        if (particle.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    if (burst === lastBurst.current) return;
    lastBurst.current = burst;
    if (burst === 0) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    for (let i = 0; i < 96; i++) {
      const angle = (Math.PI * 2 * i) / 96 + Math.random() * 0.25;
      const speed = 4 + Math.random() * 7.5;
      particles.current.push({
        x: width / 2 + (Math.random() - 0.5) * 90,
        y: height * 0.4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.32,
        size: 6 + Math.random() * 7,
        color: COLORS[i % COLORS.length],
        life: 1400 + Math.random() * 900,
        shape: Math.random() > 0.3 ? "rect" : "circle",
      });
    }
  }, [burst]);

  return <canvas ref={canvasRef} className="confetti" aria-hidden="true" />;
}

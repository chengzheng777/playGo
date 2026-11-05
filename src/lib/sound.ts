const KEY = "playgo:muted";

let muted = false;
try {
  muted = localStorage.getItem(KEY) === "1";
} catch {
  /* ignore */
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!context) {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(
  frequency: number,
  offset: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.05,
): void {
  const ctx = audio();
  if (!ctx) return;

  const start = ctx.currentTime + offset;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (!value) void context?.resume();
}

export const sfx = {
  tick: () => tone(1180, 0, 0.05, "square", 0.022),
  turn: () => {
    tone(520, 0, 0.09, "triangle", 0.032);
    tone(780, 0.08, 0.12, "triangle", 0.032);
  },
  correct: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
      tone(freq, index * 0.055, 0.16, "sine", 0.05);
    });
  },
  timeout: () => {
    tone(240, 0, 0.22, "sawtooth", 0.032);
    tone(170, 0.16, 0.3, "sawtooth", 0.032);
  },
  win: () => {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, index) => {
      tone(freq, index * 0.11, 0.32, "triangle", 0.042);
    });
  },
  wrong: () => tone(200, 0, 0.12, "square", 0.028),
};

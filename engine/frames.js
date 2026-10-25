// Small pure helpers for choosing frames and timing.
export const MAX_SECONDS = 6;

/** Shrink to fit inside maxSide on the long edge (never enlarge). Sizes are whole numbers, at least 2. */
export function fitSize(w, h, maxSide) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(2, Math.round(w * k)), height: Math.max(2, Math.round(h * k)) };
}

/** Times (seconds) to grab from a video: up to maxSeconds from `start`, fps per second, never past the end. */
export function frameTimes(duration, fps, { start = 0, maxSeconds = MAX_SECONDS } = {}) {
  if (!(duration > 0) || !(fps > 0)) return [];
  const s = Math.min(Math.max(0, start), Math.max(0, duration - 0.05));
  const len = Math.min(maxSeconds, duration - s);
  const n = Math.max(1, Math.floor(len * fps));
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.min(duration - 0.001, s + i / fps));
  return out;
}

/** Order frames play in. "pingpong" goes forward then back without repeating the end frames, so it loops smoothly. */
export function sequence(n, mode = "forward") {
  const a = Array.from({ length: n }, (_, i) => i);
  if (mode === "pingpong" && n > 2) for (let i = n - 2; i >= 1; i--) a.push(i);
  return a;
}

/** GIF delays are in hundredths of a second, and most viewers treat anything under 2 as slow. */
export const delayCs = (fps, speed = 1) => Math.max(2, Math.round(100 / (fps * speed)));

export function fmtBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

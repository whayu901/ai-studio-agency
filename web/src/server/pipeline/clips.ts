import type { Json } from "./context";

export interface ClipPlan {
  clip_id: string;
  start_seconds: number;
  end_seconds: number;
}

/**
 * Split an ad into generation clips that respect the provider's configured maximum length.
 * Equal-length clips keep pacing even (8 s → 1×8, 16 s → 2×8, 24 s → 3×8, 30 s → 4×7.5 for an
 * 8-second model; 30 s → 3×10 for a 10-second model). Providers with fixed lengths warn in the
 * validator when a clip is not one of them.
 */
export function splitClips(durationSeconds: number, model: Json): ClipPlan[] {
  const max = Number(model.max_clip_seconds);
  if (!(max > 0)) throw new Error("provider model has no max_clip_seconds");
  const n = Math.max(1, Math.ceil(durationSeconds / max - 1e-9));
  const len = durationSeconds / n;
  return Array.from({ length: n }, (_, i) => ({
    clip_id: `C${String(i + 1).padStart(2, "0")}`,
    start_seconds: round(i * len),
    end_seconds: i === n - 1 ? round(durationSeconds) : round((i + 1) * len),
  }));
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

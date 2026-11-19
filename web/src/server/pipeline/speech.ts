/** Speech-duration estimates. Rates match prompts/scriptwriter.md (EN ≈ 2.3 words/s, ID ≈ 2.0 words/s). */
export const WORDS_PER_SECOND: Record<string, number> = { en: 2.3, id: 2.0 };
export const CLIP_EDGE_SILENCE = 1.0; // ≈0.5 s of no speech at each edge of every generated clip

export function rateFor(language: string): number {
  return WORDS_PER_SECOND[language.slice(0, 2).toLowerCase()] ?? 2.1;
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Split a script into sentences, keeping the punctuation. Never splits inside a sentence. */
export function sentences(script: string): string[] {
  const parts = script.replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+["”')\]]*|[^.!?…]+$/g) ?? [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

export interface SpeechEstimate {
  words: number;
  seconds: number;
  rate: number;
  budget_seconds: number;
  fits: boolean;
  lines: { text: string; words: number; seconds: number }[];
}

export function estimateSpeech(script: string, language: string, durationSeconds: number, clipCount = 1): SpeechEstimate {
  const rate = rateFor(language);
  const lines = sentences(script).map((text) => {
    const words = countWords(text);
    return { text, words, seconds: +(words / rate).toFixed(2) };
  });
  const words = lines.reduce((a, l) => a + l.words, 0);
  const seconds = +(words / rate).toFixed(2);
  const budget = Math.max(0, durationSeconds - CLIP_EDGE_SILENCE * clipCount);
  return { words, seconds, rate, budget_seconds: +budget.toFixed(2), fits: seconds <= budget + 0.01, lines };
}

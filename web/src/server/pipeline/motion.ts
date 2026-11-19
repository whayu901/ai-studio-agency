/**
 * Natural Motion Director and Audio Director (deterministic modules). Text prompts guide motion;
 * they do not control it exactly, so every line here is phrased as direction, not a guarantee.
 */
export type PerformanceMode = "talking_influencer" | "fashion_showcase" | "voiceover_showcase";

const COMMON = [
  "Every movement has a reason: she reaches for, lifts, turns or adjusts something; no idle choreography.",
  "Weight shifts are small and balanced; feet stay planted unless she is walking.",
  "Hands touch the product with plausible contact: fingers wrap the handle or strap, the product's weight pulls slightly down.",
  "The product swings and settles with gravity after she moves it (small secondary motion, no floating).",
  "Relaxed face, natural blinks, eyes move to the product and back.",
  "Camera stays close to static, phone-like; no fast pans, zooms or orbits.",
];

const BY_MODE: Record<PerformanceMode, string[]> = {
  talking_influencer: [
    "Speaks to the lens in a relaxed, conversational way, with natural pauses between sentences.",
    "Small head tilts and hand gestures on stressed words; gestures end before the next line.",
    "Mouth moves only while she speaks; closed, relaxed lips during pauses.",
  ],
  fashion_showcase: [
    "No speaking: mouth stays relaxed or softly smiling throughout.",
    "Show the product from at least two angles through her own movement (a quarter turn, a step, a lift).",
    "Pauses of about a second in each pose so the product reads clearly.",
  ],
  voiceover_showcase: [
    "She does not speak on camera: lips stay closed or softly smiling; narration is added in editing.",
    "Actions line up with the narration beats (one clear action per line).",
    "Occasional glances to camera are fine; no mouthing words.",
  ],
};

export function motionDirection(mode: PerformanceMode): string[] {
  return [...COMMON, ...BY_MODE[mode]];
}

export function audioDirection(mode: PerformanceMode, language: string, supportsDialogue: boolean | null): { plan: string; notes: string[] } {
  if (mode === "fashion_showcase") {
    return { plan: "music_only", notes: ["No dialogue is generated.", "Add licensed background music in editing (record the licence); none is chosen automatically."] };
  }
  if (mode === "voiceover_showcase") {
    return {
      plan: "voiceover",
      notes: [
        `Record the narration separately (${language}): your own voice or a licensed voice. No voice cloning of real people.`,
        "Render clips without speech; assemble.py ducks clip audio under the voice-over (--voiceover-rights required).",
      ],
    };
  }
  return {
    plan: "on_camera_dialogue",
    notes: [
      `Dialogue in ${language}, spoken on camera.`,
      supportsDialogue === true
        ? "The provider is configured for spoken dialogue; check lip-sync and wording on every take."
        : "Spoken dialogue for this provider is unverified: if speech or lip-sync fails, re-render without speech and use the same script as a voice-over.",
    ],
  };
}

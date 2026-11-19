/**
 * Video providers. Both supported providers are MANUAL: the app prepares prompts, asset
 * manifests and instructions, a person renders in the provider's web UI and uploads the MP4.
 * No vendor API is called and none is pretended. The ApiVideoProvider interface is the shape
 * a future integration must implement after its official API has been verified.
 */
import type { Json } from "../pipeline/context";

export interface ApiVideoProvider {
  id: string;
  submitGeneration(input: { prompt: string; images: string[]; durationSeconds: number; aspectRatio: string }): Promise<{ generationId: string }>;
  pollStatus(generationId: string): Promise<{ state: "queued" | "running" | "succeeded" | "failed"; error?: string }>;
  fetchResult(generationId: string): Promise<{ downloadUrl: string; durationSeconds: number }>;
  recordCost(generationId: string): Promise<{ amount: number; currency: string; actual: boolean }>;
}

export interface ManualProvider {
  id: "google_flow" | "seedance";
  label: string;
  web_ui: string;
  manual: true;
  config_file: string;
  render_steps: string[];
}

export const PROVIDERS: ManualProvider[] = [
  {
    id: "google_flow",
    label: "Google Flow (manual)",
    web_ui: "https://labs.google/flow",
    manual: true,
    config_file: "config/google-flow.json",
    render_steps: [
      "Open a Flow project named after the job.",
      "For each clip: choose the model and mode shown, upload the ingredients in the listed order, paste the prompt.",
      "Set the aspect ratio and length; generate.",
      "Download the take and upload it on the job's Render & QC tab (one file per clip).",
    ],
  },
  {
    id: "seedance",
    label: "Seedance / Dreamina (manual)",
    web_ui: "https://dreamina.capcut.com",
    manual: true,
    config_file: "config/seedance.json",
    render_steps: [
      "Make each clip's first frame with its image prompt (any image tool you are licensed to use), attaching only this character's references and the product photo.",
      "Upload the first frame on the Prompts tab so the plan can check it.",
      "In Dreamina: image-to-video, upload the first frame, paste the motion prompt, choose the length and aspect ratio.",
      "Download the take and upload it on the job's Render & QC tab.",
    ],
  },
];

/** Future API providers: listed so the UI can show them as unavailable, never as working. */
export const FUTURE_API_PROVIDERS = [
  { id: "google_flow_api", label: "Google video API", status: "not_integrated", reason: "No verified official API for the user's plan; Flow subscriptions do not include Gemini API access." },
  { id: "seedance_api", label: "Seedance API", status: "not_integrated", reason: "Not integrated. Requires verifying the vendor's current official API, pricing and credentials first." },
];

export function providerSummary(configs: { google_flow: Json | null; seedance: Json | null }) {
  return PROVIDERS.map((p) => {
    const cfg = p.id === "google_flow" ? configs.google_flow : configs.seedance;
    return {
      ...p,
      models: (cfg?.models ?? []).map((m: Json) => ({
        model_id: m.model_id, label: m.label, enabled: m.enabled, verified: m.verified,
        max_clip_seconds: m.max_clip_seconds, generation_modes: m.generation_modes, aspect_ratios: m.aspect_ratios,
        supports_spoken_dialogue: m.supports_spoken_dialogue,
      })),
      verified_by_user_on: cfg?.verified_by_user_on ?? null,
    };
  });
}

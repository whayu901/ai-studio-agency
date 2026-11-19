import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { splitClips } from "@/server/pipeline/clips";
import { estimateSpeech, sentences } from "@/server/pipeline/speech";
import { mockCompile, mockScript, mockStoryboard } from "@/server/pipeline/mock";
import { extractJson, parseStageOutput } from "@/server/pipeline/manual";
import { campaignToBrief } from "@/server/pipeline/brief";
import { sniff, safeFileName } from "@/server/files";
import { scoreReview } from "@/server/qc";
import { CampaignInput } from "@/server/schemas";

beforeAll(() => {
  process.env.ACS_REPO_ROOT = path.resolve(__dirname, "../..");
});

const flow = { model_id: "omni-flash-1.2", max_clip_seconds: 8, generation_modes: ["ingredients_to_video"], max_ingredients: 3, verified: false, supports_spoken_dialogue: null };
const character = {
  character_id: "female_02", physical_description: null,
  references: { front: ["characters/female_02/references/f.jpg"], close_up: ["characters/female_02/references/c.jpg"], side: [], full_body: [] },
  styling_rules: { default_wardrobe: ["Grey top"], accessories: [] }, identity_consistency_instructions: ["Same face"],
};
const input = CampaignInput.parse({
  name: "T", creation_mode: "original", performance_mode: "talking_influencer", character_id: "female_02",
  brand: { name: "B", guidelines: [] }, product: { name: "Bag X — mini", category: "bag", description: "d", key_features: ["3 ways"], visual_identity: ["grey"] },
  product_images: ["assets/products/x/bag.png"], verified_claims: [{ claim: "Bisa dipakai 3 cara", source: "listing" }], prohibited_claims: ["Waterproof"],
  audience: { description: "a", locale: "ID" }, language: "id", objective: "o", cta: "Cek link di bio", duration_seconds: 16, visual_style: "phone",
  script_mode: "custom", custom_script: "Halo semua. Bisa dipakai 3 cara. Cek link di bio!",
});
const brief = campaignToBrief("t-1", input);

describe("clip splitting", () => {
  it("splits by the provider maximum", () => {
    expect(splitClips(8, flow).length).toBe(1);
    expect(splitClips(16, flow).map((c) => c.end_seconds)).toEqual([8, 16]);
    expect(splitClips(24, flow).length).toBe(3);
    expect(splitClips(30, flow).map((c) => c.end_seconds - c.start_seconds)).toEqual([7.5, 7.5, 7.5, 7.5]);
    expect(splitClips(30, { max_clip_seconds: 10 }).length).toBe(3);
  });
});

describe("speech", () => {
  it("never splits inside a sentence and estimates by language", () => {
    expect(sentences("Halo! Apa kabar? Baik.")).toEqual(["Halo!", "Apa kabar?", "Baik."]);
    const e = estimateSpeech("satu dua tiga empat", "id", 8, 1);
    expect(e.seconds).toBe(2);
    expect(e.budget_seconds).toBe(7);
    expect(e.fits).toBe(true);
  });
});

describe("mock engine", () => {
  it("keeps an exact custom script verbatim", () => {
    const s = mockScript(brief, "talking_influencer", 16, 2);
    expect(s.script).toBe(input.custom_script);
    expect(s.claims_used).toEqual(["Bisa dipakai 3 cara"]);
  });
  it("fashion showcase has no dialogue anywhere", () => {
    const s = mockScript({ ...brief, script: { mode: "ai_generated", custom_script: null, language: "id" } }, "fashion_showcase", 8, 1);
    expect(s.script).toBe("");
    const sb = mockStoryboard(brief, character, "fashion_showcase", "", 8, flow).storyboard;
    expect(sb.every((x) => x.dialogue === null)).toBe(true);
  });
  it("AI-drafted script uses only verified claims, word for word", () => {
    const s = mockScript({ ...brief, script: { mode: "ai_generated", custom_script: null, language: "id" } }, "talking_influencer", 16, 2);
    expect(s.script).toContain("Bisa dipakai 3 cara.");
    expect(s.script.toLowerCase()).not.toContain("waterproof");
    for (const c of s.claims_used) expect(brief.verified_claims.map((v: { claim: string }) => v.claim)).toContain(c);
  });
  it("storyboard covers the duration with no gaps and clips within the limit", () => {
    const { storyboard, clips } = mockStoryboard(brief, character, "talking_influencer", input.custom_script!, 16, flow);
    expect(storyboard[0].start_seconds).toBe(0);
    expect(storyboard.at(-1)!.end_seconds).toBe(16);
    for (let i = 1; i < storyboard.length; i++) expect(storyboard[i].start_seconds).toBe(storyboard[i - 1].end_seconds);
    expect(clips.every((c) => c.end_seconds - c.start_seconds <= 8)).toBe(true);
  });
  it("prompts use only the job's character, describe identity only via references when no description", () => {
    const production = { performance_mode: "voiceover_showcase", aspect_ratio: "9:16", storyboard: mockStoryboard(brief, character, "voiceover_showcase", input.custom_script!, 16, flow).storyboard };
    const out = mockCompile({ jobId: "t-1", brief, character, production, provider: "google_flow", model: flow, isTest: true, productRights: "owned" });
    expect(out.flow_prompts.length).toBe(2);
    expect(out.flow_prompts.every((c) => c.dialogue === null)).toBe(true);
    expect(out.flow_prompts.flatMap((c) => c.ingredients).filter((p: string) => p.startsWith("characters/")).every((p: string) => p.startsWith("characters/female_02/"))).toBe(true);
    expect(out.flow_prompts[0].prompt).toContain("attached reference images");
    expect(out.continuity[0]).toMatchObject({ from_clip: "C01", to_clip: "C02" });
    expect(out.reference_assets.every((a) => a.rights_basis === "internal_test_only")).toBe(true);
  });
});

describe("QC scoring", () => {
  it("weighted mean, pass only when every applicable check meets its minimum", () => {
    const all = (n: number) => Object.fromEntries(["QC01", "QC02", "QC11", "QC03", "QC04", "QC05", "QC12", "QC13", "QC06", "QC09", "QC10"].map((k) => [k, n]));
    const r = scoreReview("fashion_showcase", { ...all(5) });
    expect(r.passed).toBe(true);
    expect(r.overall).toBe(5);
    expect(scoreReview("fashion_showcase", { ...all(5), QC10: 4 }).passed).toBe(false);
    expect(scoreReview("talking_influencer", all(5)).missing).toEqual(expect.arrayContaining(["QC07", "QC08", "QC14"]));
    expect(scoreReview("fashion_showcase", { ...all(5), QC01: "na" }).invalid_na).toEqual(["QC01"]);
  });
});

describe("uploads and imports", () => {
  it("checks file content, not only extensions", () => {
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniff(Buffer.from("....ftypisom"))).toBe("mp4");
    expect(sniff(Buffer.from("hello world!"))).toBe(null);
    expect(() => safeFileName("x.exe", "video")).toThrow();
    expect(safeFileName("../../My Clip.MP4", "video")).toBe("my-clip.mp4");
  });
  it("reads fenced JSON and validates the stage shape", () => {
    expect(extractJson("text\n```json\n{\"script\":\"a\"}\n```")).toEqual({ script: "a" });
    expect(() => extractJson("no json")).toThrow();
    expect(() => parseStageOutput("storyboard", { storyboard: [] })).toThrow();
    expect(parseStageOutput("script", { script: "x" }).claims_used).toEqual([]);
  });
});

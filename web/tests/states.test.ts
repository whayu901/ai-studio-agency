import { describe, expect, it } from "vitest";
import { canTransition, isApprovalTransition, productionStatusFor, type Actor } from "@/server/states";

const human: Actor = { type: "human", name: "Rina", source: "dashboard" };
const anon: Actor = { type: "human", name: null, source: "dashboard" };
const n8n: Actor = { type: "orchestrator", name: "n8n", source: "n8n", executionId: "42" };
const system: Actor = { type: "system", source: "direct" };

describe("job state machine", () => {
  it("allows the forward path", () => {
    expect(canTransition("DRAFT", "BRIEF_READY", n8n).ok).toBe(true);
    expect(canTransition("STORYBOARD_APPROVED", "PROMPTS_READY", n8n).ok).toBe(true);
    expect(canTransition("PROMPTS_READY", "AWAITING_RENDER", system).ok).toBe(true);
    expect(canTransition("QC_APPROVED", "DELIVERED", n8n).ok).toBe(true);
  });
  it("refuses skipping stages", () => {
    expect(canTransition("DRAFT", "SCRIPT_READY", human).ok).toBe(false);
    expect(canTransition("BRIEF_READY", "STORYBOARD_READY", human).ok).toBe(false);
    expect(canTransition("AWAITING_RENDER", "QC_PENDING", human).ok).toBe(false);
    expect(canTransition("DELIVERED", "DRAFT", human).ok).toBe(false);
  });
  it("approvals need a named human and only from the review state", () => {
    expect(canTransition("BRIEF_READY", "BRIEF_APPROVED", human).ok).toBe(true);
    expect(canTransition("BRIEF_READY", "BRIEF_APPROVED", anon).ok).toBe(false);
    expect(canTransition("BRIEF_READY", "BRIEF_APPROVED", n8n).ok).toBe(false);
    expect(canTransition("QC_PENDING", "QC_APPROVED", system).ok).toBe(false);
    expect(canTransition("DRAFT", "BRIEF_APPROVED", human).ok).toBe(false);
    expect(canTransition("RENDER_UPLOADED", "QC_APPROVED", human).ok).toBe(false);
    expect(isApprovalTransition("SCRIPT_READY", "SCRIPT_APPROVED")).toBe(true);
  });
  it("only people reopen earlier stages, and only before rendering", () => {
    expect(canTransition("STORYBOARD_READY", "SCRIPT_READY", human).ok).toBe(true);
    expect(canTransition("STORYBOARD_READY", "SCRIPT_READY", n8n).ok).toBe(false);
    expect(canTransition("QC_PENDING", "SCRIPT_READY", human).ok).toBe(false);
  });
  it("QC outcomes", () => {
    expect(canTransition("QC_PENDING", "REVISION_REQUIRED", human).ok).toBe(true);
    expect(canTransition("QC_PENDING", "AWAITING_RENDER", human).ok).toBe(true);
    expect(canTransition("REVISION_REQUIRED", "STORYBOARD_READY", human).ok).toBe(true);
  });
  it("failure and retry go back to exactly the failed state, including approved ones", () => {
    expect(canTransition("SCRIPT_APPROVED", "FAILED", n8n).ok).toBe(true);
    expect(canTransition("DELIVERED", "FAILED", n8n).ok).toBe(false);
    expect(canTransition("FAILED", "BRIEF_APPROVED", human, { stateBeforeFailure: "BRIEF_APPROVED" }).ok).toBe(true);
    expect(canTransition("FAILED", "QC_APPROVED", human, { stateBeforeFailure: "BRIEF_APPROVED" }).ok).toBe(false);
    expect(canTransition("FAILED", "DELIVERED", human, { stateBeforeFailure: "QC_APPROVED" }).ok).toBe(false);
  });
  it("maps job states to production.json status", () => {
    expect(productionStatusFor("AWAITING_RENDER", { renderReady: true, humanApprovedRealJob: false })).toBe("READY_FOR_MANUAL_RENDER");
    expect(productionStatusFor("AWAITING_RENDER", { renderReady: false, humanApprovedRealJob: false })).toBe("NEEDS_REVIEW");
    expect(productionStatusFor("QC_APPROVED", { renderReady: true, humanApprovedRealJob: false })).toBe("RENDERED_PENDING_QC");
    expect(productionStatusFor("QC_APPROVED", { renderReady: true, humanApprovedRealJob: true })).toBe("APPROVED");
  });
});

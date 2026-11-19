/**
 * Central job state machine. Every state change in the app goes through `assertTransition`
 * (via jobs.transition), so invalid jumps are impossible regardless of the caller (UI, n8n, tests).
 */
export const JOB_STATES = [
  "DRAFT",
  "BRIEF_READY",
  "BRIEF_APPROVED",
  "SCRIPT_READY",
  "SCRIPT_APPROVED",
  "STORYBOARD_READY",
  "STORYBOARD_APPROVED",
  "PROMPTS_READY",
  "AWAITING_RENDER",
  "RENDER_UPLOADED",
  "QC_PENDING",
  "QC_APPROVED",
  "REVISION_REQUIRED",
  "DELIVERED",
  "FAILED",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export type ActorType = "human" | "system" | "orchestrator";
export interface Actor {
  type: ActorType;
  name?: string | null;
  source: "dashboard" | "n8n" | "direct" | "api" | "import" | "test";
  executionId?: string | null;
}

/** Transitions that record a human decision. Only a named human may perform them. */
export const APPROVAL_TRANSITIONS: Partial<Record<JobState, JobState>> = {
  BRIEF_READY: "BRIEF_APPROVED",
  SCRIPT_READY: "SCRIPT_APPROVED",
  STORYBOARD_READY: "STORYBOARD_APPROVED",
  QC_PENDING: "QC_APPROVED",
};
const APPROVED_STATES = new Set<JobState>(Object.values(APPROVAL_TRANSITIONS) as JobState[]);

/** Earlier review states a human may reopen for editing before rendering starts. */
const REOPENABLE: JobState[] = ["BRIEF_READY", "SCRIPT_READY", "STORYBOARD_READY", "PROMPTS_READY"];
const PRE_RENDER: JobState[] = [
  "BRIEF_READY", "BRIEF_APPROVED", "SCRIPT_READY", "SCRIPT_APPROVED", "STORYBOARD_READY", "STORYBOARD_APPROVED", "PROMPTS_READY", "AWAITING_RENDER",
];
const ORDER = JOB_STATES as readonly JobState[];

const FORWARD: Record<JobState, JobState[]> = {
  DRAFT: ["BRIEF_READY"],
  BRIEF_READY: ["BRIEF_APPROVED"],
  BRIEF_APPROVED: ["SCRIPT_READY"],
  SCRIPT_READY: ["SCRIPT_APPROVED"],
  SCRIPT_APPROVED: ["STORYBOARD_READY"],
  STORYBOARD_READY: ["STORYBOARD_APPROVED"],
  STORYBOARD_APPROVED: ["PROMPTS_READY"],
  PROMPTS_READY: ["AWAITING_RENDER"],
  AWAITING_RENDER: ["RENDER_UPLOADED"],
  RENDER_UPLOADED: ["QC_PENDING", "RENDER_UPLOADED"],
  // QC outcomes: approve, request a revision, or reject the take (back to rendering).
  QC_PENDING: ["QC_APPROVED", "REVISION_REQUIRED", "AWAITING_RENDER", "RENDER_UPLOADED"],
  QC_APPROVED: ["DELIVERED"],
  // A revision reopens one stage; downstream work is redone from there.
  REVISION_REQUIRED: ["SCRIPT_READY", "STORYBOARD_READY", "PROMPTS_READY", "AWAITING_RENDER", "BRIEF_READY"],
  DELIVERED: [],
  FAILED: [],
};

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

export function canTransition(from: JobState, to: JobState, actor: Actor, opts: { stateBeforeFailure?: JobState | null } = {}): TransitionCheck {
  if (!JOB_STATES.includes(to)) return { ok: false, reason: `unknown state ${to}` };
  // Retry restores the exact state a job failed in (including an already-approved state): it is
  // not a new approval, and it can only go back to that one state.
  if (from === "FAILED") {
    return opts.stateBeforeFailure === to ? { ok: true } : { ok: false, reason: `a failed job can only be retried back to ${opts.stateBeforeFailure ?? "its previous state"}` };
  }
  const isApproval = APPROVED_STATES.has(to) && APPROVAL_TRANSITIONS[from] === to;
  if (APPROVED_STATES.has(to) && !isApproval) {
    return { ok: false, reason: `${to} can only be reached by approving ${Object.entries(APPROVAL_TRANSITIONS).find(([, v]) => v === to)?.[0]}` };
  }
  if (isApproval && (actor.type !== "human" || !actor.name?.trim())) {
    return { ok: false, reason: `${from} → ${to} is an approval and needs a named human reviewer (actor ${actor.type} refused)` };
  }

  // Failure: any active state can fail; recovery returns to where it failed.
  if (to === "FAILED") return from === "DELIVERED" ? { ok: false, reason: "a delivered job cannot fail" } : { ok: true };
  if (FORWARD[from].includes(to)) return { ok: true };

  // Reopen an earlier review stage (human only), before any render exists.
  if (REOPENABLE.includes(to) && PRE_RENDER.includes(from) && ORDER.indexOf(to) < ORDER.indexOf(from)) {
    return actor.type === "human" ? { ok: true } : { ok: false, reason: "only a person can reopen an earlier stage" };
  }
  return { ok: false, reason: `invalid transition ${from} → ${to}` };
}

export function isApprovalTransition(from: JobState, to: JobState) {
  return APPROVAL_TRANSITIONS[from] === to;
}

/** Map a job state to the production.json status vocabulary used by the Python tools. */
export function productionStatusFor(state: JobState, opts: { renderReady: boolean; humanApprovedRealJob: boolean }): string {
  switch (state) {
    case "PROMPTS_READY":
    case "AWAITING_RENDER":
      return opts.renderReady ? "READY_FOR_MANUAL_RENDER" : "NEEDS_REVIEW";
    case "RENDER_UPLOADED":
    case "QC_PENDING":
    case "REVISION_REQUIRED":
      return "RENDERED_PENDING_QC";
    case "QC_APPROVED":
    case "DELIVERED":
      return opts.humanApprovedRealJob ? "APPROVED" : "RENDERED_PENDING_QC";
    default:
      return "DRAFT";
  }
}

/** Plain-language label per state for the UI. */
export const STATE_LABELS: Record<JobState, string> = {
  DRAFT: "Draft",
  BRIEF_READY: "Brief ready for review",
  BRIEF_APPROVED: "Brief approved",
  SCRIPT_READY: "Script ready for review",
  SCRIPT_APPROVED: "Script approved",
  STORYBOARD_READY: "Storyboard ready for review",
  STORYBOARD_APPROVED: "Storyboard approved",
  PROMPTS_READY: "Prompts ready",
  AWAITING_RENDER: "Awaiting manual render",
  RENDER_UPLOADED: "Render uploaded",
  QC_PENDING: "Quality review pending",
  QC_APPROVED: "QC approved",
  REVISION_REQUIRED: "Revision required",
  DELIVERED: "Delivered (package ready)",
  FAILED: "Failed",
};

export const AWAITING_HUMAN: JobState[] = ["BRIEF_READY", "SCRIPT_READY", "STORYBOARD_READY", "QC_PENDING", "REVISION_REQUIRED"];

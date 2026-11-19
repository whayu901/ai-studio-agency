import crypto from "node:crypto";
import fs from "node:fs";
import { route, ok, orchestratorActor, type Ctx } from "@/server/http";
import { env } from "@/server/env";
import { forbidden } from "@/server/errors";
import { repoPath } from "@/server/files";
import { campaignInput } from "@/server/jobs";
import { linkExecution } from "@/server/orchestrator";
import { getJob } from "@/server/repo";
import { OrchestrationPayload, zodMessage } from "@/server/schemas";
export const dynamic = "force-dynamic";
/**
 * First node of every workflow ("Validate job" / "Validate reference" / "Receive render metadata").
 * 1. n8n's own callback token (x-acs-token).
 * 2. Proof that the webhook call that started this execution carried the token too: n8n forwards
 *    the inbound header as x-acs-inbound-token (the webhook node has no stored credential).
 * Only then is the execution linked to the run, so a forged webhook call cannot touch a job.
 */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const actor = orchestratorActor(req);
  const inbound = Buffer.from(req.headers.get("x-acs-inbound-token") ?? "");
  const token = Buffer.from(env().orchestratorToken);
  if (inbound.length !== token.length || !crypto.timingSafeEqual(inbound, token)) throw forbidden("the webhook call did not carry a valid token");
  linkExecution(req.headers.get("x-acs-run-key"), actor.executionId ?? null);
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = OrchestrationPayload.safeParse(raw);
  if (!parsed.success) return ok({ valid: false, errors: zodMessage(parsed.error).issues }, 422);
  const p = parsed.data;
  const job = getJob(id);
  const errors: string[] = [];
  if (p.job_id !== id) errors.push("job_id does not match the URL");
  if (p.character_id !== job.character_id) errors.push(`character ${p.character_id} does not match the job's ${job.character_id}`);
  if (p.creation_mode !== job.creation_mode) errors.push("creation_mode mismatch");
  if (p.performance_mode !== job.performance_mode) errors.push("performance_mode mismatch");
  if (p.provider !== job.video_provider) errors.push("provider mismatch");
  if (job.creation_mode === "reference_guided") {
    const ref = campaignInput(job.campaign_id).reference_video;
    if (!ref) errors.push("no authorized reference video on the campaign");
    else if (!fs.existsSync(repoPath(ref.path))) errors.push(`reference video ${ref.path} is missing`);
  }
  if (errors.length) return ok({ valid: false, errors }, 422);
  return ok({ valid: true, job_id: id, state: job.state, execution_id: actor.executionId });
});

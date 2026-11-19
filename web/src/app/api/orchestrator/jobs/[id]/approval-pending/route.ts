import { route, ok, type Ctx } from "@/server/http";
import { callbackActor } from "../../../_shared";
import { getJob } from "@/server/repo";
import { AWAITING_HUMAN, STATE_LABELS } from "@/server/states";
export const dynamic = "force-dynamic";
/** End of Workflows A/B/C: report which human decision the job is waiting for. No state change. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { actor } = callbackActor(req);
  const job = getJob((await ctx.params).id);
  const waiting = AWAITING_HUMAN.includes(job.state) || job.state === "AWAITING_RENDER" || job.state === "BRIEF_APPROVED";
  return ok({ job_id: job.id, state: job.state, label: STATE_LABELS[job.state], waiting_for_human: waiting, execution_id: actor.executionId });
});

import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { approveGate, GATES, type Gate } from "@/server/jobs";
import { ReviewerConfirm } from "@/server/schemas";
import { badRequest } from "@/server/errors";
export const dynamic = "force-dynamic";
/** A person approves the brief, script or storyboard (typed name + typed job id). */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string; gate: string }>) => {
  const { id, gate } = await ctx.params;
  if (!(gate in GATES)) throw badRequest(`unknown gate ${gate}`);
  const b = await body(req, ReviewerConfirm);
  return ok({ job: await approveGate(id, gate as Gate, dashboardActor(b.reviewer), b.confirm_job_id, b.notes) });
});

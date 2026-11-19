import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { submit } from "@/server/orchestrator";
export const dynamic = "force-dynamic";
/** Send the job through the orchestrator (n8n, or direct in-process when n8n is not configured). */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const b = await body(req, z.object({ event: z.enum(["job.submitted", "render.uploaded", "job.approved"]).default("job.submitted") }));
  return ok(await submit((await ctx.params).id, b.event, dashboardActor("dashboard user")));
});

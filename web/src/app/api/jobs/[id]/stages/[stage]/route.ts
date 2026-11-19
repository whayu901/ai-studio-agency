import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { runStage, STAGES, type Stage } from "@/server/pipeline/stages";
import { badRequest } from "@/server/errors";
export const dynamic = "force-dynamic";
/** Run one stage directly from the dashboard (force = a person asks for regeneration). */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string; stage: string }>) => {
  const { id, stage } = await ctx.params;
  if (!STAGES.includes(stage as Stage)) throw badRequest(`unknown stage ${stage}`);
  const b = await body(req, z.object({ force: z.boolean().default(false), reviewer: z.string().max(120).default("") }));
  return ok(await runStage(id, stage as Stage, dashboardActor(b.reviewer || "dashboard user"), { force: b.force }));
});

import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { selectConcept } from "@/server/pipeline/stages";
export const dynamic = "force-dynamic";
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const b = await body(req, z.object({ concept_id: z.string().regex(/^K\d{2}$/), reviewer: z.string().max(120).default("") }));
  return ok(await selectConcept((await ctx.params).id, b.concept_id, dashboardActor(b.reviewer || "dashboard user")));
});

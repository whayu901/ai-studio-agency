import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { saveScript } from "@/server/pipeline/stages";
export const dynamic = "force-dynamic";
export const PUT = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const b = await body(req, z.object({ script: z.string().max(5000), claims_used: z.array(z.string()).max(40).default([]), author: z.string().max(120).default("") }));
  return ok({ report: await saveScript((await ctx.params).id, b.script, b.claims_used, dashboardActor(b.author || "dashboard user")) });
});

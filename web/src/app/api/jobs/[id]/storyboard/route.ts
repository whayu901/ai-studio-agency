import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { saveStoryboard } from "@/server/pipeline/stages";
export const dynamic = "force-dynamic";
export const PUT = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const b = await body(req, z.object({ storyboard: z.array(z.record(z.string(), z.unknown())).min(1).max(60), author: z.string().max(120).default("") }));
  return ok({ report: await saveStoryboard((await ctx.params).id, b.storyboard, dashboardActor(b.author || "dashboard user")) });
});

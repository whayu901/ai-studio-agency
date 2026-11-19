import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { savePromptText } from "@/server/pipeline/stages";
export const dynamic = "force-dynamic";
export const PUT = route(async (req: Request, ctx: Ctx<{ id: string; clip: string }>) => {
  const { id, clip } = await ctx.params;
  const b = await body(req, z.object({ prompt: z.string().min(1).max(8000) }));
  return ok({ report: await savePromptText(id, clip, b.prompt, dashboardActor("dashboard user")) });
});

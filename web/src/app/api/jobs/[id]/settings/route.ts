import { z } from "zod";
import { route, ok, body, type Ctx } from "@/server/http";
import { updateJobFields } from "@/server/repo";
import { AiMode } from "@/server/schemas";
export const dynamic = "force-dynamic";
export const PUT = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const b = await body(req, z.object({ ai_mode: AiMode }));
  return ok({ job: updateJobFields((await ctx.params).id, { ai_mode: b.ai_mode }) });
});

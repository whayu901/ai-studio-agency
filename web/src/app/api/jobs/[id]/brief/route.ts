import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { readJobBrief, saveJobBrief } from "@/server/jobs";
export const dynamic = "force-dynamic";
export const GET = route(async (_req: Request, ctx: Ctx<{ id: string }>) => ok({ brief: readJobBrief((await ctx.params).id) }));
export const PUT = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const b = await body(req, z.object({ brief: z.record(z.string(), z.unknown()), author: z.string().max(120).default("") }));
  return ok({ report: await saveJobBrief((await ctx.params).id, b.brief, dashboardActor(b.author || "dashboard user")) });
});

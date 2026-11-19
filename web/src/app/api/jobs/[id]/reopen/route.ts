import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { reopen } from "@/server/jobs";
export const dynamic = "force-dynamic";
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const b = await body(req, z.object({ to: z.enum(["BRIEF_READY", "SCRIPT_READY", "STORYBOARD_READY", "PROMPTS_READY", "AWAITING_RENDER"]), reviewer: z.string().trim().min(1).max(120), reason: z.string().max(500).default("") }));
  return ok({ job: await reopen((await ctx.params).id, b.to, dashboardActor(b.reviewer), b.reason) });
});

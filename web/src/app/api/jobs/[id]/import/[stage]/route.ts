import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { importStage } from "@/server/pipeline/stages";
import { badRequest } from "@/server/errors";
import type { AiStage } from "@/server/pipeline/manual";
export const dynamic = "force-dynamic";
const OK: AiStage[] = ["reference_analysis", "concepts", "script", "storyboard", "prompts"];
/** Manual Claude mode: import the JSON answer, validate it, continue the pipeline. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string; stage: string }>) => {
  const { id, stage } = await ctx.params;
  if (!OK.includes(stage as AiStage)) throw badRequest(`no import for stage ${stage}`);
  const b = await body(req, z.object({ text: z.string().min(2).max(500_000), author: z.string().max(120).default("") }));
  return ok(await importStage(id, stage as AiStage, b.text, dashboardActor(b.author || "dashboard user")));
});

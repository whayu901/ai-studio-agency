import { route, ok, type Ctx } from "@/server/http";
import { exportPrompt } from "@/server/pipeline/stages";
import { badRequest } from "@/server/errors";
import type { AiStage } from "@/server/pipeline/manual";
export const dynamic = "force-dynamic";
const OK: AiStage[] = ["reference_analysis", "concepts", "script", "storyboard", "prompts"];
/** Manual Claude mode: the filled prompt for one stage. */
export const GET = route(async (_req: Request, ctx: Ctx<{ id: string; stage: string }>) => {
  const { id, stage } = await ctx.params;
  if (!OK.includes(stage as AiStage)) throw badRequest(`no prompt for stage ${stage}`);
  return ok(await exportPrompt(id, stage as AiStage));
});

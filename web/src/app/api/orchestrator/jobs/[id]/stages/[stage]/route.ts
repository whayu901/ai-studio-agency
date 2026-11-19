import { route, ok, type Ctx } from "@/server/http";
import { callbackActor } from "../../../../_shared";
import { idempotent } from "@/server/orchestrator";
import { runStage, STAGES, type Stage } from "@/server/pipeline/stages";
import { badRequest } from "@/server/errors";
export const dynamic = "force-dynamic";
/** One pipeline stage, run by n8n. Halts at human gates; never approves anything. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string; stage: string }>) => {
  const { actor, key } = callbackActor(req);
  const { id, stage } = await ctx.params;
  if (!STAGES.includes(stage as Stage)) throw badRequest(`unknown stage ${stage}`);
  return ok(await idempotent(key, id, `stage:${stage}`, () => runStage(id, stage as Stage, actor)));
});

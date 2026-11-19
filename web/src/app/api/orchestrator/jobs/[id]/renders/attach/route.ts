import { z } from "zod";
import { route, ok, type Ctx } from "@/server/http";
import { callbackActor } from "../../../../_shared";
import { idempotent } from "@/server/orchestrator";
import { attachRenders } from "@/server/review";
export const dynamic = "force-dynamic";
/** Workflow C: attach uploaded renders (technical checks, contact sheet, first frame). */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { actor, key } = callbackActor(req);
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => ({}));
  const ids = z.object({ render_ids: z.array(z.number().int().positive()).default([]) }).parse(raw ?? {}).render_ids;
  return ok(await idempotent(key, id, "attach", () => attachRenders(id, ids.length ? ids : null, actor)));
});

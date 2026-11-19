import { route, ok, type Ctx } from "@/server/http";
import { callbackActor } from "../../../_shared";
import { idempotent } from "@/server/orchestrator";
import { markDelivered } from "@/server/delivery";
export const dynamic = "force-dynamic";
/** Workflow D: mark delivered (= package ready to download). Never publishes anything. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { actor, key } = callbackActor(req);
  const id = (await ctx.params).id;
  return ok(await idempotent(key, id, "delivered", async () => ({ state: markDelivered(id, actor).state })));
});

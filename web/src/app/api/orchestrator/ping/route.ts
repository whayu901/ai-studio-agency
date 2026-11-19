import { route, ok } from "@/server/http";
import { callbackActor } from "../_shared";
export const dynamic = "force-dynamic";
export const POST = route(async (req: Request) => {
  const { actor } = callbackActor(req);
  return ok({ ok: true, execution_id: actor.executionId });
});

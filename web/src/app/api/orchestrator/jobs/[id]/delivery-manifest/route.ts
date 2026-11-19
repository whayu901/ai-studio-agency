import { route, ok, type Ctx } from "@/server/http";
import { callbackActor } from "../../../_shared";
import { deliveryManifest } from "@/server/delivery";
export const dynamic = "force-dynamic";
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  callbackActor(req);
  const pkg = deliveryManifest((await ctx.params).id);
  const m = pkg.manifest as Record<string, unknown>;
  return ok({ package: m.package, is_test: m.is_test, commercial_delivery_allowed: m.commercial_delivery_allowed, files: (m.files as unknown[]).length });
});

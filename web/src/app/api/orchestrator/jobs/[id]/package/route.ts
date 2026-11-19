import { route, ok, type Ctx } from "@/server/http";
import { callbackActor } from "../../../_shared";
import { idempotent } from "@/server/orchestrator";
import { buildPackage } from "@/server/delivery";
export const dynamic = "force-dynamic";
/** Workflow D: package assets of an approved job. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { actor, key } = callbackActor(req);
  const id = (await ctx.params).id;
  return ok(await idempotent(key, id, "package", async () => {
    const r = await buildPackage(id, actor);
    return { dir: r.dir, zip: r.zip, files: (r.manifest.files as unknown[]).length, is_test: r.manifest.is_test };
  }));
});

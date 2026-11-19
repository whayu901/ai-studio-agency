import { route, ok, dashboardActor, type Ctx } from "@/server/http";
import { buildPackage, markDelivered } from "@/server/delivery";
import { env } from "@/server/env";
import { submit } from "@/server/orchestrator";
export const dynamic = "force-dynamic";
/** Build the delivery package (Workflow D through n8n, or directly). Nothing is published. */
export const POST = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const actor = dashboardActor("dashboard user");
  if (env().orchestrator === "n8n") return ok(await submit(id, "job.approved", actor));
  const pkg = await buildPackage(id, { ...actor, source: "direct" });
  const job = markDelivered(id, { ...actor, source: "direct" });
  return ok({ mode: "direct", package: pkg, job });
});

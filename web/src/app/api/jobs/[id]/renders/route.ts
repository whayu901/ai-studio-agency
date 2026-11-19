import { route, ok, dashboardActor, type Ctx } from "@/server/http";
import { uploadRender, attachRenders } from "@/server/review";
import { env } from "@/server/env";
import { submit } from "@/server/orchestrator";
import { badRequest } from "@/server/errors";
export const dynamic = "force-dynamic";
const num = (v: string | null) => (v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
/**
 * Upload one manually rendered MP4 (raw body). Query: clip, filename, credits, cost, currency, test=1.
 * Then attach it: through n8n Workflow C when the orchestrator is n8n, otherwise directly.
 */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const credits = num(q.get("credits"));
  const cost = num(q.get("cost"));
  if (Number.isNaN(credits) || Number.isNaN(cost) || (credits ?? 0) < 0 || (cost ?? 0) < 0) throw badRequest("credits and cost must be non-negative numbers");
  const actor = dashboardActor("dashboard user");
  const render = await uploadRender(id, q.get("clip") ?? "", req.body, {
    filename: q.get("filename") ?? "render.mp4", credits, est_cost: cost, currency: q.get("currency") || null, is_test_media: q.get("test") === "1",
  }, actor);
  let orchestration: unknown = null;
  if (env().orchestrator === "n8n") {
    try {
      orchestration = await submit(id, "render.uploaded", actor);
    } catch (e) {
      orchestration = { error: e instanceof Error ? e.message : String(e), fallback: await attachRenders(id, [render.id], { ...actor, source: "direct" }) };
    }
  } else {
    orchestration = { mode: "direct", attach: await attachRenders(id, [render.id], { ...actor, source: "direct" }) };
  }
  return ok({ render, orchestration }, 201);
});

import { z } from "zod";
import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { getCampaign, listBriefRevisions } from "@/server/repo";
import { campaignJobs, saveCampaign } from "@/server/campaigns";
export const dynamic = "force-dynamic";
export const GET = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  return ok({ campaign: getCampaign(id), jobs: campaignJobs(id), revisions: listBriefRevisions(id) });
});
export const PUT = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  getCampaign(id);
  const b = await body(req, z.object({ data: z.record(z.string(), z.unknown()) }));
  return ok(await saveCampaign(id, b.data, dashboardActor()));
});

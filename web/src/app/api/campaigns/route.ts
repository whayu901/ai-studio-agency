import { z } from "zod";
import { route, ok, body, dashboardActor } from "@/server/http";
import { listCampaigns } from "@/server/repo";
import { saveCampaign } from "@/server/campaigns";
export const dynamic = "force-dynamic";
export const GET = route(async () => ok({ campaigns: listCampaigns() }));
export const POST = route(async (req: Request) => {
  const b = await body(req, z.object({ data: z.record(z.string(), z.unknown()) }));
  return ok(await saveCampaign(null, b.data, dashboardActor()), 201);
});

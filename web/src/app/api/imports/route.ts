import { z } from "zod";
import { route, ok, body, dashboardActor } from "@/server/http";
import { importableProductions, importProduction } from "@/server/campaigns";
export const dynamic = "force-dynamic";
export const GET = route(async () => ok({ productions: importableProductions() }));
export const POST = route(async (req: Request) => {
  const b = await body(req, z.object({ job_id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/), reviewer: z.string().trim().min(1).max(120) }));
  return ok({ job: await importProduction(b.job_id, dashboardActor(b.reviewer)) }, 201);
});

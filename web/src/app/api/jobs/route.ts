import { route, ok, body, dashboardActor } from "@/server/http";
import { listJobs, getCampaign } from "@/server/repo";
import { createJob } from "@/server/jobs";
import { JobCreate } from "@/server/schemas";
import { STATE_LABELS } from "@/server/states";
export const dynamic = "force-dynamic";
export const GET = route(async () => ok({ jobs: listJobs().map((j) => ({ ...j, state_label: STATE_LABELS[j.state], campaign_name: getCampaign(j.campaign_id).name })) }));
export const POST = route(async (req: Request) => {
  const b = await body(req, JobCreate);
  return ok({ job: await createJob(b.campaign_id, b.ai_mode, dashboardActor(), b.job_id) }, 201);
});

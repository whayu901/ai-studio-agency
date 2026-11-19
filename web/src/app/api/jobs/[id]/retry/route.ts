import { route, ok, dashboardActor, type Ctx } from "@/server/http";
import { retryJob } from "@/server/orchestrator";
export const dynamic = "force-dynamic";
export const POST = route(async (_req: Request, ctx: Ctx<{ id: string }>) => ok(await retryJob((await ctx.params).id, dashboardActor("dashboard user"))));

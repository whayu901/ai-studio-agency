import { route, ok, dashboardActor, type Ctx } from "@/server/http";
import { attachRenders } from "@/server/review";
export const dynamic = "force-dynamic";
export const POST = route(async (_req: Request, ctx: Ctx<{ id: string }>) => ok(await attachRenders((await ctx.params).id, null, { ...dashboardActor("dashboard user"), source: "direct" })));

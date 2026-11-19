import { route, ok, type Ctx } from "@/server/http";
import { jobDetail } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route(async (_req: Request, ctx: Ctx<{ id: string }>) => ok(await jobDetail((await ctx.params).id)));

import { route, ok, body, dashboardActor, type Ctx } from "@/server/http";
import { submitReview } from "@/server/review";
import { QcReviewInput } from "@/server/schemas";
export const dynamic = "force-dynamic";
/** A person's QC review. The app never scores a video itself. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const b = await body(req, QcReviewInput);
  return ok(await submitReview((await ctx.params).id, b, dashboardActor(b.reviewer)));
});

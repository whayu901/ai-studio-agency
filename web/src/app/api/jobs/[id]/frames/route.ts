import { route, ok, type Ctx } from "@/server/http";
import { uploadFirstFrame } from "@/server/review";
export const dynamic = "force-dynamic";
/** First-frame still for a clip (raw image body). Query: clip, filename. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const q = new URL(req.url).searchParams;
  return ok(await uploadFirstFrame((await ctx.params).id, q.get("clip") ?? "", req.body, q.get("filename") ?? ""), 201);
});

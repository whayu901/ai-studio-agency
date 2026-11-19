import { route, ok, type Ctx } from "@/server/http";
import { uploadReferenceVideo } from "@/server/campaigns";
export const dynamic = "force-dynamic";
/** Raw MP4/MOV body; ?filename=. Only for videos the user is authorized to use (rights are recorded on the campaign). */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const name = new URL(req.url).searchParams.get("filename") ?? "";
  return ok(await uploadReferenceVideo(id, req.body, name), 201);
});

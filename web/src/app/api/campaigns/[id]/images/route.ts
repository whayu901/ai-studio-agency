import { route, ok, type Ctx } from "@/server/http";
import { uploadProductImage } from "@/server/campaigns";
export const dynamic = "force-dynamic";
/** Raw image body; ?filename=. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const name = new URL(req.url).searchParams.get("filename") ?? "";
  return ok(await uploadProductImage(id, req.body, name), 201);
});

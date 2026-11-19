import fs from "node:fs";
import path from "node:path";
import { route, type Ctx } from "@/server/http";
import { latestPackage } from "@/server/repo";
import { repoPath } from "@/server/files";
import { notFound } from "@/server/errors";
export const dynamic = "force-dynamic";
export const GET = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const pkg = latestPackage((await ctx.params).id);
  if (!pkg) throw notFound("no package built yet");
  const abs = repoPath(String(pkg.zip_path));
  if (!fs.existsSync(abs)) throw notFound("package file is missing");
  return new Response(fs.createReadStream(abs) as unknown as ReadableStream, {
    headers: { "content-type": "application/zip", "content-length": String(fs.statSync(abs).size), "content-disposition": `attachment; filename="${path.basename(abs)}"`, "cache-control": "no-store" },
  });
});

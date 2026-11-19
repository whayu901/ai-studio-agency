import fs from "node:fs";
import path from "node:path";
import { route, ok } from "@/server/http";
import { buildTemplatePack } from "@/server/delivery";
import { env } from "@/server/env";
import { notFound } from "@/server/errors";
export const dynamic = "force-dynamic";
export const POST = route(async () => {
  const r = await buildTemplatePack();
  return ok({ file: path.basename(r.zip), files: r.files });
});
export const GET = route(async (req: Request) => {
  const name = new URL(req.url).searchParams.get("file") ?? "";
  if (!/^template-pack-\d{4}-\d{2}-\d{2}\.zip$/.test(name)) throw notFound("no such export");
  const abs = path.join(env().dataDir, "exports", name);
  if (!fs.existsSync(abs)) throw notFound("no such export");
  return new Response(fs.createReadStream(abs) as unknown as ReadableStream, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"` } });
});

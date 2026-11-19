import fs from "node:fs";
import path from "node:path";
import { route } from "@/server/http";
import { assertServable, MEDIA_TYPES, repoPath } from "@/server/files";
import { notFound } from "@/server/errors";
export const dynamic = "force-dynamic";
/** Serves local media to the local dashboard only (with Range support for video seeking). */
export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") ?? "";
  assertServable(rel);
  const abs = repoPath(rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw notFound("file not found");
  const size = fs.statSync(abs).size;
  const type = MEDIA_TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (url.searchParams.get("download")) headers["content-disposition"] = `attachment; filename="${path.basename(abs)}"`;
  const range = req.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const stream = fs.createReadStream(abs, { start, end });
    return new Response(stream as unknown as ReadableStream, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(fs.createReadStream(abs) as unknown as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
});

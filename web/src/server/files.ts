import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "./env";
import { badRequest, forbidden, AppError } from "./errors";

/** Repo-relative path → absolute path, refusing traversal and symlink escapes. */
export function repoPath(rel: string): string {
  if (typeof rel !== "string" || rel === "" || rel.includes("\0") || path.isAbsolute(rel)) throw badRequest("invalid path");
  const root = fs.realpathSync(env().repoRoot);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw forbidden("path is outside the project");
  if (fs.existsSync(abs)) {
    const real = fs.realpathSync(abs);
    if (!real.startsWith(root + path.sep)) throw forbidden("path resolves outside the project");
  }
  return abs;
}

export function toRel(abs: string): string {
  return path.relative(fs.realpathSync(env().repoRoot), abs).split(path.sep).join("/");
}

/** Which repo folders the dashboard may serve files from (local only). Everything else is refused. */
const SERVABLE = [/^outputs\/[a-z0-9-]+\//, /^assets\/products\//, /^assets\/reference-videos\//, /^characters\/[a-z][a-z0-9_]*\/references\//];
export function assertServable(rel: string) {
  if (!SERVABLE.some((re) => re.test(rel)) || rel.split("/").some((p) => p === ".." || p.startsWith("."))) {
    throw forbidden("this file is not served by the dashboard");
  }
}

export const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".json": "application/json", ".md": "text/markdown; charset=utf-8",
  ".zip": "application/zip", ".txt": "text/plain; charset=utf-8",
};

const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const VIDEO_EXT = [".mp4", ".mov"];

/** Check the first bytes, not only the extension. */
export function sniff(head: Buffer): "jpeg" | "png" | "webp" | "mp4" | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (head.length >= 12 && head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp") return "mp4"; // MP4 and MOV both use ftyp
  return null;
}

export function safeFileName(name: string, kind: "image" | "video"): string {
  const ext = path.extname(name).toLowerCase();
  const allowed = kind === "image" ? IMAGE_EXT : VIDEO_EXT;
  if (!allowed.includes(ext)) throw badRequest(`file type ${ext || "(none)"} is not allowed; use ${allowed.join(", ")}`);
  const base = path.basename(name, path.extname(name)).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  return base + ext;
}

/**
 * Stream a request body to disk with a size limit and magic-byte check. Writes to a temp name and
 * renames on success, so a failed upload never leaves a partial file behind.
 */
export async function saveUpload(body: ReadableStream<Uint8Array> | null, destAbs: string, kind: "image" | "video"): Promise<{ bytes: number; sha256: string }> {
  if (!body) throw badRequest("empty upload");
  const limit = kind === "image" ? env().maxUploadBytes.image : env().maxUploadBytes.video;
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  if (fs.existsSync(destAbs)) throw new AppError(409, "exists", `${path.basename(destAbs)} already exists`);
  const tmp = `${destAbs}.part-${process.pid}-${Date.now()}`;
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  let head = Buffer.alloc(0);
  const source = Readable.fromWeb(body as never);
  source.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
    hash.update(chunk);
    if (bytes > limit) source.destroy(new AppError(413, "too_large", `file is larger than ${Math.round(limit / 1024 / 1024)} MB`));
  });
  try {
    await pipeline(source, fs.createWriteStream(tmp, { flags: "wx" }));
    const kindFound = sniff(head);
    const ok = kind === "image" ? kindFound === "jpeg" || kindFound === "png" || kindFound === "webp" : kindFound === "mp4";
    if (!ok) throw badRequest(`the file content is not a valid ${kind === "image" ? "JPEG/PNG/WebP image" : "MP4/MOV video"}`);
    if (bytes === 0) throw badRequest("empty upload");
    fs.renameSync(tmp, destAbs);
    return { bytes, sha256: hash.digest("hex") };
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function sha256File(abs: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

export function readJsonFile<T>(abs: string): T {
  return JSON.parse(fs.readFileSync(abs, "utf8")) as T;
}

/** Atomic JSON write (temp file + rename). */
export function writeJsonFile(abs: string, data: unknown) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, abs);
}

export function writeTextFile(abs: string, text: string) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, abs);
}

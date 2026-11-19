import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { route, ok } from "@/server/http";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { tailLog } from "@/server/log";
import { listRuns } from "@/server/orchestrator";
import { listUsage } from "@/server/repo";
export const dynamic = "force-dynamic";
const run = promisify(execFile);
async function version(cmd: string, args: string[]) {
  try {
    const { stdout, stderr } = await run(cmd, args, { timeout: 5000 });
    return (stdout || stderr).split("\n")[0].trim();
  } catch {
    return "not found";
  }
}
export const GET = route(async () => {
  const counts = Object.fromEntries(
    ["campaigns", "jobs", "job_events", "renders", "qc_reviews", "orchestration_runs", "usage", "packages"].map((t) => [t, (db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
  );
  return ok({
    versions: { node: process.version, python: await version(env().python, ["--version"]), ffmpeg: await version("ffmpeg", ["-version"]), docker: await version("docker", ["--version"]) },
    counts,
    runs: listRuns(),
    usage: listUsage(),
    log: tailLog(80),
  });
});

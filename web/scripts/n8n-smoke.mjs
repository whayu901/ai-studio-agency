#!/usr/bin/env node
/**
 * n8n smoke test: is the local n8n healthy, are the ACS workflows imported and active, and can
 * the container reach the app's callback API with the shared token?
 *
 *   node scripts/n8n-smoke.mjs            # the app must be running on port 3000 for the last check
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envText = fs.existsSync(path.join(REPO, "n8n/.env")) ? fs.readFileSync(path.join(REPO, "n8n/.env"), "utf8") : "";
const PORT = /^N8N_HOST_PORT=(\d+)$/m.exec(envText)?.[1] ?? "5678";
const DC = ["compose", "-f", path.join(REPO, "n8n/docker-compose.yml"), "--env-file", path.join(REPO, "n8n/.env")];
let failed = 0;
const ok = (name, cond, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : ` ${detail}`}`); if (!cond) failed++; };

try {
  const r = await fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(3000) });
  ok(`n8n healthy on 127.0.0.1:${PORT}`, r.ok, String(r.status));
} catch (e) {
  ok(`n8n healthy on 127.0.0.1:${PORT}`, false, `${e.message} — start it: docker compose -f n8n/docker-compose.yml --env-file n8n/.env up -d`);
}
try {
  const all = execFileSync("docker", [...DC, "exec", "-T", "n8n", "n8n", "list:workflow"], { encoding: "utf8" });
  const active = execFileSync("docker", [...DC, "exec", "-T", "n8n", "n8n", "list:workflow", "--active=true"], { encoding: "utf8" });
  for (const id of ["acsWfOriginal001", "acsWfReference01", "acsWfReview00001", "acsWfDelivery001"]) ok(`workflow ${id} imported and active`, active.includes(id));
  ok("error workflow acsWfErrors00001 imported (runs via errorWorkflow, stays inactive)", all.includes("acsWfErrors00001"));
} catch (e) {
  ok("n8n CLI reachable through docker compose", false, e.message.split("\n")[0]);
}
try {
  const out = execFileSync("docker", [...DC, "exec", "-T", "n8n", "sh", "-c",
    'wget -qO- --header="x-acs-token: $ACS_ORCHESTRATOR_TOKEN" --header="x-acs-execution-id: smoke" --header="content-type: application/json" --post-data="{}" "$ACS_APP_URL/api/orchestrator/ping"'], { encoding: "utf8" });
  ok("container reaches the app at ACS_APP_URL with the shared token", out.includes('"ok":true'), out.slice(0, 200));
} catch (e) {
  ok("container reaches the app at ACS_APP_URL with the shared token", false, "is the app running on port 3000 with the same ACS_ORCHESTRATOR_TOKEN? " + (e.stderr?.toString() ?? e.message).split("\n")[0]);
}
console.log(failed ? `\n${failed} check(s) failed` : "\nn8n smoke test passed");
process.exit(failed ? 1 : 0);

import { orchestratorActor } from "@/server/http";
import { linkExecution } from "@/server/orchestrator";

/** Authenticate an n8n callback and link its execution id to the submitted run. */
export function callbackActor(req: Request) {
  const actor = orchestratorActor(req);
  linkExecution(req.headers.get("x-acs-run-key"), actor.executionId ?? null);
  return { actor, key: req.headers.get("x-acs-idempotency-key") };
}

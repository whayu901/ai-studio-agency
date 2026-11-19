import { z } from "zod";
import { route, ok, body } from "@/server/http";
import { callbackActor } from "../_shared";
import { recordWorkflowError } from "@/server/orchestrator";
export const dynamic = "force-dynamic";
/** Workflow E (Error Trigger) reports a failed execution here. */
export const POST = route(async (req: Request) => {
  const { actor } = callbackActor(req);
  const b = await body(req, z.object({
    execution_id: z.string().max(64).nullable().default(null),
    workflow: z.string().max(200).default("unknown"),
    message: z.string().max(4000).default("unknown error"),
    last_node: z.string().max(200).nullable().default(null),
  }));
  return ok(recordWorkflowError(b, actor));
});

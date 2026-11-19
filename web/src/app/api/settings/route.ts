import { route, ok } from "@/server/http";
import { env } from "@/server/env";
import { n8nHealth } from "@/server/orchestrator";
import { aiStatus } from "@/server/providers/ai";
import { FUTURE_API_PROVIDERS, providerSummary } from "@/server/providers/video";
import { loadConfigs } from "@/server/pipeline/context";
import { qcConfig } from "@/server/qc";
export const dynamic = "force-dynamic";
/** Configuration summary. Secrets are reported only as set / not set. */
export const GET = route(async () => {
  const e = env();
  const configs = await loadConfigs();
  return ok({
    storage: { repo_root: e.repoRoot, data_dir: e.dataDir, database: e.dbPath, logs: e.logDir },
    limits: { max_image_mb: e.maxUploadBytes.image / 1048576, max_video_mb: e.maxUploadBytes.video / 1048576, max_retries: e.maxRetries },
    orchestrator: { mode: e.orchestrator, token_configured: e.orchestratorToken.length >= 16, health: await n8nHealth() },
    ai: aiStatus(),
    providers: providerSummary(configs),
    provider_reports: { google_flow: configs.google_flow_report, seedance: configs.seedance_report },
    future_api_providers: FUTURE_API_PROVIDERS,
    costs: { flow_cost_per_credit: e.flowCreditCost.amount, currency: e.flowCreditCost.currency, note: "Costs are estimates unless a provider reports actual usage." },
    qc: qcConfig(),
  });
});

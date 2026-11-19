import path from "node:path";

/** All runtime configuration comes from environment variables (see web/.env.example). */
function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

export function env() {
  const repoRoot = path.resolve(process.env.ACS_REPO_ROOT ?? path.join(process.cwd(), ".."));
  const dataDir = path.resolve(process.env.ACS_DATA_DIR ?? path.join(repoRoot, "data"));
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
  return {
    repoRoot,
    dataDir,
    dbPath: path.join(dataDir, "studio.db"),
    logDir: path.join(dataDir, "logs"),
    python: process.env.ACS_PYTHON ?? "python3",
    /** "n8n" sends jobs through the local n8n; "direct" runs the same stages in-process. */
    orchestrator: (process.env.ACS_ORCHESTRATOR ?? "direct") as "n8n" | "direct",
    n8nUrl: (process.env.ACS_N8N_URL ?? "http://127.0.0.1:5678").replace(/\/$/, ""),
    /** Shared secret n8n sends back on every callback (header x-acs-token) and the app sends to n8n webhooks. */
    orchestratorToken: process.env.ACS_ORCHESTRATOR_TOKEN ?? "",
    maxUploadBytes: {
      image: num("ACS_MAX_IMAGE_MB", 20) * 1024 * 1024,
      video: num("ACS_MAX_VIDEO_MB", 500) * 1024 * 1024,
    },
    maxRetries: num("ACS_MAX_RETRIES", 3),
    anthropic: {
      configured: anthropicKey.length > 0,
      apiKey: anthropicKey,
      model: process.env.ACS_ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      /** Hard spending cap in USD. 0 = paid calls disabled even when a key is present. */
      budgetUsd: num("ACS_AI_BUDGET_USD", 0),
    },
    flowCreditCost: { amount: num("ACS_FLOW_COST_PER_CREDIT", 0), currency: process.env.ACS_COST_CURRENCY ?? "USD" },
  };
}

export type Env = ReturnType<typeof env>;

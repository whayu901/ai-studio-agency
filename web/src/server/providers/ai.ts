/**
 * AI execution modes for the creative stages:
 *   mock      — deterministic templates (src/server/pipeline/mock.ts). No AI, no cost.
 *   manual    — export the prompt, run it yourself in Claude, import the JSON answer.
 *   anthropic — optional. Calls the Claude API only when ANTHROPIC_API_KEY is set AND a
 *               budget (ACS_AI_BUDGET_USD > 0) is configured; refuses when the estimate would
 *               exceed what is left of the budget.
 * Claude Pro / Claude Code subscriptions do not give this app API access; only an API key does.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { AppError, forbidden } from "../errors";
import { log } from "../log";
import { recordUsage, spentUsd } from "../repo";

/** USD per million tokens (Anthropic first-party list prices, cached 2026-11-03). Estimates only. */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
const MAX_OUTPUT_TOKENS = 16000;

export function aiStatus() {
  const a = env().anthropic;
  const spent = a.configured ? spentUsd("anthropic") : 0;
  return {
    modes: {
      mock: { available: true, label: "Mock (deterministic templates, no AI)" },
      manual: { available: true, label: "Manual Claude (export prompt → paste JSON back)" },
      anthropic: {
        available: a.configured && a.budgetUsd > 0 && !!PRICES[a.model],
        label: "Anthropic API (paid, budget-limited)",
        reason: !a.configured
          ? "ANTHROPIC_API_KEY is not set"
          : a.budgetUsd <= 0
            ? "ACS_AI_BUDGET_USD is 0 (paid calls disabled)"
            : !PRICES[a.model]
              ? `no price on file for ${a.model}`
              : null,
      },
    },
    model: a.model,
    budget_usd: a.budgetUsd,
    spent_usd_estimate: +spent.toFixed(4),
  };
}

export function estimateCostUsd(model: string, inputChars: number, outputTokens = MAX_OUTPUT_TOKENS): number {
  const p = PRICES[model];
  if (!p) return Infinity;
  const inputTokens = Math.ceil(inputChars / 3); // conservative: ~3 characters per token
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Run one stage prompt through the Claude API and return the reply text. */
export async function runAnthropic(prompt: string, jobId: string, stage: string): Promise<string> {
  const a = env().anthropic;
  const status = aiStatus().modes.anthropic;
  if (!status.available) throw forbidden(`Anthropic mode is not available: ${status.reason}`);
  const worstCase = estimateCostUsd(a.model, prompt.length);
  const spent = spentUsd("anthropic");
  if (spent + worstCase > a.budgetUsd) {
    throw new AppError(402, "budget", `estimated worst-case cost $${worstCase.toFixed(3)} would exceed the remaining budget ($${(a.budgetUsd - spent).toFixed(3)} of $${a.budgetUsd})`);
  }
  const client = new Anthropic({ apiKey: a.apiKey });
  try {
    const stream = client.beta.messages.stream({
      model: a.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: "You are a stage of a local ad-production pipeline. Follow the prompt exactly and reply with only the requested JSON in one ```json block.",
      messages: [{ role: "user", content: prompt }],
    });
    const msg = await stream.finalMessage();
    const p = PRICES[msg.model] ?? PRICES[a.model];
    const cost = ((msg.usage.input_tokens ?? 0) * p.input + (msg.usage.output_tokens ?? 0) * p.output) / 1_000_000;
    recordUsage({
      job_id: jobId, provider: "anthropic", kind: "actual", units: (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0), unit_type: "tokens",
      amount: +cost.toFixed(6), currency: "USD",
      note: `${stage}: ${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out tokens on ${msg.model}; cost computed from reported usage × list price`,
    });
    if (msg.stop_reason === "refusal") throw new AppError(422, "refusal", "the model declined this request; use manual mode or adjust the brief");
    if (msg.stop_reason === "max_tokens") throw new AppError(422, "truncated", "the reply hit the output limit before finishing; try manual mode");
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (!text.trim()) throw new AppError(422, "empty", "the model returned no text");
    return text;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AppError(401, "anthropic_auth", "the Anthropic API key was rejected");
    if (e instanceof Anthropic.RateLimitError) throw new AppError(429, "anthropic_rate_limit", "Anthropic API rate limit; try again later");
    if (e instanceof Anthropic.APIError) throw new AppError(502, "anthropic_api", `Anthropic API error ${e.status ?? ""}`.trim());
    log("error", "anthropic call failed", { job: jobId, stage, error: String(e) });
    throw new AppError(502, "anthropic_unreachable", "could not reach the Anthropic API");
  }
}

/**
 * Layer 12 — API Cost Logger
 *
 * Wraps invokeLLM and automatically logs token usage + estimated cost to the
 * api_cost_log table after each successful call.
 *
 * Cost model (approximate, based on Gemini 2.5 Flash pricing):
 *   Input:  $0.075 / 1M tokens
 *   Output: $0.30  / 1M tokens
 *
 * Usage:
 *   import { invokeLLMWithCost } from "../apiCostLogger";
 *   const result = await invokeLLMWithCost(params, { userId, feature });
 */

import { invokeLLM, InvokeParams, InvokeResult } from "./_core/llm";
import { getDb } from "./db";
import { apiCostLog } from "../drizzle/schema";

export type CostLogContext = {
  userId?: number | null;
  feature?: typeof apiCostLog.$inferInsert["feature"];
};

/** Cost per million tokens in USD */
const COST_PER_M_INPUT = 0.075;
const COST_PER_M_OUTPUT = 0.30;

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * COST_PER_M_INPUT +
    (outputTokens / 1_000_000) * COST_PER_M_OUTPUT;
}

/**
 * Calls invokeLLM and, on success, writes a row to api_cost_log.
 * If the DB write fails, the error is logged but NOT re-thrown — the LLM
 * result is always returned to the caller.
 */
export async function invokeLLMWithCost(
  params: InvokeParams,
  ctx: CostLogContext = {}
): Promise<InvokeResult> {
  const result = await invokeLLM(params);

  // Log cost asynchronously — don't block the caller
  setImmediate(async () => {
    try {
      const usage = result.usage;
      if (!usage) return;

      const inputTokens = usage.prompt_tokens ?? 0;
      const outputTokens = usage.completion_tokens ?? 0;
      const estimatedCostUsd = estimateCost(inputTokens, outputTokens).toFixed(6);

      const db = await getDb();
      if (!db) return;
      await db.insert(apiCostLog).values({
        userId: ctx.userId ?? null,
        model: result.model ?? "gemini-2.5-flash",
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        feature: ctx.feature ?? "other",
      });
    } catch (err) {
      // Never let cost logging break the main flow
      console.error("[apiCostLogger] Failed to write cost log:", err);
    }
  });

  return result;
}

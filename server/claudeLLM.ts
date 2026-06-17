/**
 * claudeLLM.ts
 *
 * LLM transport layer — routes all Claude calls through OpenRouter's
 * OpenAI-compatible endpoint instead of Anthropic directly.
 *
 * Drop-in replacement: exports the same function signatures as before.
 * Only the HTTP transport changes; all prompts, scoring, and engine logic
 * remain untouched.
 */

import OpenAI from "openai";
import type { InvokeParams, InvokeResult } from "./_core/llm";
import { getDb } from "./db";
import { apiCostLog } from "../drizzle/schema";

// ---------------------------------------------------------------------------
// OpenRouter client (OpenAI-compatible)
// ---------------------------------------------------------------------------

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://blogbatcher-ewwkvhui.manus.space",
    "X-Title": "Blog Batcher",
  },
});

// ---------------------------------------------------------------------------
// Model constant — change here to switch Claude versions globally
// ---------------------------------------------------------------------------

export const OPENROUTER_MODEL = "anthropic/claude-sonnet-4-5";

// ---------------------------------------------------------------------------
// Types (kept for backward compatibility with any callers)
// ---------------------------------------------------------------------------

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeLLMOptions {
  messages: ClaudeMessage[];
  system?: string;
  maxTokens?: number;
  model?: string;
}

export interface ClaudeLLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Cost estimation (Claude Sonnet 4.5 pricing via OpenRouter)
// ---------------------------------------------------------------------------

const COST_PER_M_INPUT = 3.0;   // USD per million input tokens
const COST_PER_M_OUTPUT = 15.0; // USD per million output tokens

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * COST_PER_M_INPUT +
    (outputTokens / 1_000_000) * COST_PER_M_OUTPUT;
}

// ---------------------------------------------------------------------------
// invokeClaude — simple interface (used by testClaudeConnection)
// ---------------------------------------------------------------------------

export async function invokeClaude(
  options: ClaudeLLMOptions
): Promise<ClaudeLLMResponse> {
  const model = options.model ?? OPENROUTER_MODEL;
  const maxTokens = options.maxTokens ?? 8192;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  for (const m of options.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  const response = await openrouter.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;

  return { content, inputTokens, outputTokens, model };
}

// ---------------------------------------------------------------------------
// Cost log context type
// ---------------------------------------------------------------------------

export type CostLogContext = {
  userId?: number | null;
  feature?: typeof apiCostLog.$inferInsert["feature"];
};

// ---------------------------------------------------------------------------
// invokeClaudeWithCost — drop-in for articleEngine.ts
// Accepts InvokeParams, returns InvokeResult, logs cost asynchronously.
// ---------------------------------------------------------------------------

export async function invokeClaudeWithCost(
  params: InvokeParams,
  ctx: CostLogContext = {}
): Promise<InvokeResult> {
  const model = OPENROUTER_MODEL;

  // Build OpenAI-format messages array
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const msg of params.messages) {
    const content =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

    if (msg.role === "system") {
      // Merge multiple system messages into one (OpenRouter accepts only one)
      const existing = messages.find((m) => m.role === "system");
      if (existing && typeof existing.content === "string") {
        existing.content = `${existing.content}\n\n${content}`;
      } else {
        messages.unshift({ role: "system", content });
      }
    } else if (msg.role === "user" || msg.role === "assistant") {
      messages.push({ role: msg.role, content });
    }
  }

  // Ensure at least one user message
  if (!messages.some((m) => m.role === "user")) {
    messages.push({ role: "user", content: "Continue." });
  }

  // If json_object format requested, add instruction to system prompt
  if (params.response_format?.type === "json_object") {
    const jsonInstruction =
      "Return ONLY a valid JSON object. No markdown, no code fences, no explanation.";
    const sys = messages.find((m) => m.role === "system");
    if (sys && typeof sys.content === "string") {
      sys.content = `${sys.content}\n\n${jsonInstruction}`;
    } else {
      messages.unshift({ role: "system", content: jsonInstruction });
    }
  }

  const maxTokens = params.max_tokens ?? params.maxTokens ?? 8192;

  const response = await openrouter.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;

  // Log cost asynchronously — non-blocking
  setImmediate(async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.insert(apiCostLog).values({
        userId: ctx.userId ?? null,
        model,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCost(inputTokens, outputTokens).toFixed(6),
        feature: ctx.feature ?? "other",
      });
    } catch (err) {
      console.error("[claudeLLM] Failed to write cost log:", err);
    }
  });

  // Return InvokeResult shape (same as before)
  return {
    id: response.id,
    created: response.created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: response.choices[0]?.finish_reason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// testClaudeConnection — validates the OpenRouter key is working
// ---------------------------------------------------------------------------

export async function testClaudeConnection(): Promise<boolean> {
  try {
    const result = await invokeClaude({
      messages: [{ role: "user", content: "Reply with the word OK only." }],
      maxTokens: 10,
    });
    return result.content.toLowerCase().includes("ok");
  } catch {
    return false;
  }
}

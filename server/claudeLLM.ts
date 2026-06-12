import Anthropic from "@anthropic-ai/sdk";
import type { InvokeParams, InvokeResult } from "./_core/llm";
import { getDb } from "./db";
import { apiCostLog } from "../drizzle/schema";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

/**
 * Invoke Claude 3.5 Sonnet for article generation.
 * Returns the text content and token usage for cost tracking.
 */
export async function invokeClaude(
  options: ClaudeLLMOptions
): Promise<ClaudeLLMResponse> {
  const model = options.model ?? "claude-sonnet-4-5";
  const maxTokens = options.maxTokens ?? 8192;

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: options.system,
    messages: options.messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";

  return {
    content,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model,
  };
}

/** Cost per million tokens in USD — Claude 3.5 Sonnet pricing */
const CLAUDE_COST_PER_M_INPUT = 3.0;
const CLAUDE_COST_PER_M_OUTPUT = 15.0;

function estimateClaudeCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * CLAUDE_COST_PER_M_INPUT +
    (outputTokens / 1_000_000) * CLAUDE_COST_PER_M_OUTPUT;
}

export type CostLogContext = {
  userId?: number | null;
  feature?: typeof apiCostLog.$inferInsert["feature"];
};

/**
 * Drop-in replacement for invokeLLMWithCost that uses Claude 3.5 Sonnet.
 * Returns the same InvokeResult shape so articleEngine.ts needs minimal changes.
 * Logs cost to api_cost_log asynchronously.
 */
export async function invokeClaudeWithCost(
  params: InvokeParams,
  ctx: CostLogContext = {}
): Promise<InvokeResult> {
  const model = "claude-sonnet-4-5";

  // Convert InvokeParams messages to Anthropic format
  // Extract system message if present, convert rest to user/assistant
  let systemPrompt: string | undefined;
  const anthropicMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const msg of params.messages) {
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    if (msg.role === "system") {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${content}` : content;
    } else if (msg.role === "user" || msg.role === "assistant") {
      anthropicMessages.push({ role: msg.role, content });
    }
  }

  // Ensure there's at least one user message
  if (anthropicMessages.length === 0) {
    anthropicMessages.push({ role: "user", content: "Continue." });
  }

  // If response_format is json_object, add instruction to system prompt
  if (params.response_format?.type === "json_object") {
    const jsonInstruction = "Return ONLY a valid JSON object. No markdown, no code fences, no explanation.";
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${jsonInstruction}` : jsonInstruction;
  }

  const maxTokens = params.max_tokens ?? 8192;

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: anthropicMessages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  // Log cost asynchronously
  setImmediate(async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.insert(apiCostLog).values({
        userId: ctx.userId ?? null,
        model,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateClaudeCost(inputTokens, outputTokens).toFixed(6),
        feature: ctx.feature ?? "other",
      });
    } catch (err) {
      console.error("[claudeLLM] Failed to write cost log:", err);
    }
  });

  // Return InvokeResult shape
  return {
    id: response.id,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: response.stop_reason === "end_turn" ? "stop" : (response.stop_reason ?? "stop"),
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

/**
 * Quick connectivity test — calls Claude with a minimal prompt.
 * Returns true if the API key is valid and the model responds.
 */
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

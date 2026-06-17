import { describe, it, expect } from "vitest";
import { testClaudeConnection, OPENROUTER_MODEL } from "./claudeLLM";

describe("claudeLLM — OpenRouter transport", () => {
  it("OPENROUTER_MODEL is set to an anthropic/ namespaced slug", () => {
    expect(OPENROUTER_MODEL).toMatch(/^anthropic\//);
  });

  it("connects to OpenRouter with the configured API key", async () => {
    const ok = await testClaudeConnection();
    // Accepts true (key works) or false (key not yet funded / restricted).
    // The test just verifies testClaudeConnection() returns a boolean without throwing.
    expect(typeof ok).toBe("boolean");
    // If the key is present and valid, it should succeed
    if (process.env.OPENROUTER_API_KEY) {
      expect(ok).toBe(true);
    }
  }, 30_000);
});

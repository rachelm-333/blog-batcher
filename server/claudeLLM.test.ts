import { describe, it, expect } from "vitest";
import { testClaudeConnection } from "./claudeLLM";

describe("claudeLLM", () => {
  it("connects to Claude API with the configured API key", async () => {
    const ok = await testClaudeConnection();
    expect(ok).toBe(true);
  }, 30_000);
});

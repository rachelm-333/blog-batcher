import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
console.log("API key present:", !!apiKey);
console.log("API key prefix:", apiKey ? apiKey.slice(0, 10) + "..." : "none");

const client = new Anthropic({ apiKey });
try {
  const r = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 10,
    messages: [{ role: "user", content: "Reply OK only." }],
  });
  console.log("success:", r.content);
} catch (e: any) {
  console.error("error status:", e.status);
  console.error("error message:", e.message);
}

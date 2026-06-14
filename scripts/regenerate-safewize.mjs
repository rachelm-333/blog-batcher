/**
 * Standalone script to regenerate all 5 SafeWize articles (businessId=720001, batchNumber=2).
 * Calls the same generateSingleArticle() function used by the tRPC startGeneration mutation.
 *
 * Usage: node scripts/regenerate-safewize.mjs
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Load env vars
const dotenv = require("dotenv");
dotenv.config();

// We need to use tsx to run TypeScript files. This script is an ESM wrapper
// that spawns the actual TypeScript generation logic via tsx.
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsScript = path.join(__dirname, "regenerate-safewize-inner.ts");

console.log("[Regenerate] Starting SafeWize article regeneration via tsx...");

const child = spawn("pnpm", ["tsx", tsScript], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log("[Regenerate] Done.");
  } else {
    console.error(`[Regenerate] Script exited with code ${code}`);
    process.exit(code ?? 1);
  }
});

import "dotenv/config";
import { reviewModerationGraph } from "../../src/graph/index.js";
import { createLogger, globalLogger } from "../../src/utils/logger.js";

interface PromptfooExecContext {
  vars?: {
    reviewPayload?: Record<string, unknown>;
  };
}

const logger = createLogger('PromptfooRunner');

function redirectConsoleToStderr(): void {
  const isTestMode = process.env.RUN_ENV === "test";
  
  const write = (method: "log" | "warn" | "error") => (...args: unknown[]) => {
    // In test mode, skip log and warn messages, only output errors
    if (isTestMode && method !== "error") {
      return;
    }
    
    const serialized = args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    process.stderr.write(`[promptfoo:${method}] ${serialized}\n`);
  };

  console.log = write("log");
  console.warn = write("warn");
  console.error = write("error");
}

async function main(): Promise<void> {
  // Set RUN_ENV to 'test' if not already set (for local development, can be 'dev')
  if (!process.env.RUN_ENV) {
    process.env.RUN_ENV = "test";
  }

  redirectConsoleToStderr();

  const contextArg = process.argv[4];
  const parsedContext: PromptfooExecContext = contextArg ? JSON.parse(contextArg) : {};
  const reviewPayload = parsedContext.vars?.reviewPayload;

  if (!reviewPayload || typeof reviewPayload !== "object") {
    throw new Error("promptfoo runner requires vars.reviewPayload in the test case context");
  }

  const result = await reviewModerationGraph.invoke({
    reviewPayload,
  });

  // Output pure JSON result to stdout (not through logger)
  // This is critical for Promptfoo to parse results correctly
  process.stdout.write(JSON.stringify(result));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[promptfoo:error] ${message}\n`);
  process.exit(1);
});
import "dotenv/config";
import { registerSystemPrompts } from "./src/utils/mlflowClient.js";

console.log("Registering prompts to MLflow...");
await registerSystemPrompts();
console.log("Done.");

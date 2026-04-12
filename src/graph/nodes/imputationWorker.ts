import { z } from "zod";
import { ReviewGraphState } from "../state.js";
import { createLLM } from "../../utils/llmFactory.js";
import { STANDARD_IMPUTATION_WORKER_PROMPT } from "../../prompts/catalog.js";

const llm = createLLM("kimi-k2-0711-preview");

export const imputationWorkerNode = async (state: typeof ReviewGraphState.State) => {
    console.log("Imputation Worker: inferring missing score...");
    const { text } = state.reviewPayload;

    const imputationSchema = z.object({
        inferredScore: z.number().int().min(1).max(5).describe("The calculated star rating from 1 to 5."),
        reasoning: z.string().describe("Explanation of how the score was deduced from the text sentiment.")
    });

    const structuredImputationLlm = llm.withStructuredOutput(imputationSchema, {
        method: "functionCalling",     
    });

    const prompt = String(STANDARD_IMPUTATION_WORKER_PROMPT.template).replace("{{text}}", text ?? "");

    const result = await structuredImputationLlm.invoke(prompt);

    return { 
        reasoningLogs: [`[Imputation Worker] Inferred Score: ${result.inferredScore}. Reason: ${result.reasoning}`],
        executedPrompts: [{ name: STANDARD_IMPUTATION_WORKER_PROMPT.name }],
        inferredScore: result.inferredScore
    };
};
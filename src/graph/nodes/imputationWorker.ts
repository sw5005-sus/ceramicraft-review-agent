import { z } from "zod";
import { ReviewGraphState, type SpanRecord } from "../state.js";
import { createLLMFromPromptConfig, globalTokenTracker } from "../../utils/llmFactory.js";
import { STANDARD_IMPUTATION_WORKER_PROMPT } from "../../prompts/catalog.js";
import { listReviewsByUserIdHttp } from "../../mcp/tools-http.js";

const llm = createLLMFromPromptConfig(STANDARD_IMPUTATION_WORKER_PROMPT.modelConfig);

export const imputationWorkerNode = async (state: typeof ReviewGraphState.State) => {
    console.log("Imputation Worker: inferring missing score...");
    // Support both field name conventions (content from real API, text from test)
    const text = state.reviewPayload?.content || state.reviewPayload?.text || "";
    const user_id = state.reviewPayload?.user_id;
    const localSpans: SpanRecord[] = [];

    // Fetch user's review history as sentiment-to-rating calibration examples
    let userHistoryContext = "";
    if (user_id) {
        const toolSpanStart = Date.now();
        let toolStatusCode: "OK" | "ERROR" = "OK";
        let toolOutputs = "";
        try {
            console.log(`[Imputation Worker] Fetching review history for user_id=${user_id}`);
            const result = await listReviewsByUserIdHttp(user_id);
            toolOutputs = "[Omitted for brevity, data fetched successfully]"; 
            // Robustly extract reviews array from all possible MCP return shapes
            let reviews: any[] = [];
            if (result?.reviews) {
                reviews = result.reviews;
            } else if (Array.isArray(result?.data)) {
                reviews = result.data;
            } else if (result?.content?.[0]?.text) {
                try {
                    const parsed = JSON.parse(result.content[0].text);
                    if (Array.isArray(parsed?.data)) {
                        reviews = parsed.data;
                    }
                } catch (e) {
                    console.warn('[Imputation Worker] Failed to parse MCP content[0].text:', e);
                }
            }

            // Only keep reviews that have both text and a star rating as calibration samples
            const calibrationSamples = reviews
                .filter((r: any) => r.stars != null && r.content)
                .slice(0, 10)
                .map((r: any) => `- "${r.content}" → ${r.stars} stars`);

            if (calibrationSamples.length > 0) {
                userHistoryContext = `\n\nIMPORTANT — SENTIMENT CALIBRATION:
Below are this user's past reviews with their actual ratings. Use them as few-shot examples to learn this specific user's sentiment-to-rating mapping style, then apply that calibration to infer the rating for the current review.
${calibrationSamples.join("\n")}`;
                console.log(`[Imputation Worker] Found ${calibrationSamples.length} calibration samples for user_id=${user_id}`);
            } else {
                // No usable calibration, let LLM decide as before
                console.log(`[Imputation Worker] No usable calibration samples for user_id=${user_id}`);
            }
        } catch (error: any) {
            console.warn(`[Imputation Worker] Warning: Could not fetch user history:`, error);
            toolStatusCode = "ERROR";
            toolOutputs = error.message;
        } finally {
            // 将 Tool 调用记录进 Span
            localSpans.push({
                name: "tool-listReviewsByUserId",
                spanType: "TOOL", 
                startTimeMs: toolSpanStart,
                endTimeMs: Date.now(),
                inputs: JSON.stringify({ user_id }),
                outputs: toolOutputs,
                statusCode: toolStatusCode,
            });
        }
    }

    const imputationSchema = z.object({
        inferredScore: z.number().int().min(1).max(5).describe("The calculated star rating from 1 to 5."),
        reasoning: z.string().describe("Explanation of how the score was deduced from the text sentiment.")
    });

    const structuredImputationLlm = llm.withStructuredOutput(imputationSchema, {
        method: "functionCalling",     
    });

    const prompt = String(STANDARD_IMPUTATION_WORKER_PROMPT.template).replace("{{text}}", text ?? "") + userHistoryContext;

    const tokensBefore = { input: globalTokenTracker.inputTokens, output: globalTokenTracker.outputTokens };
    const spanStart = Date.now();
    const result = await structuredImputationLlm.invoke(prompt);
    const spanEnd = Date.now();

    localSpans.push({
        name: "imputationWorker-llm",
        spanType: "LLM",
        startTimeMs: spanStart,
        endTimeMs: spanEnd,
        inputs: JSON.stringify({ prompt }),
        outputs: JSON.stringify(result),
        inputTokens: globalTokenTracker.inputTokens - tokensBefore.input,
        outputTokens: globalTokenTracker.outputTokens - tokensBefore.output,
        model: STANDARD_IMPUTATION_WORKER_PROMPT.modelConfig?.model_name,
        statusCode: "OK",
    });

    return { 
        reasoningLogs: [`[Imputation Worker] Inferred Score: ${result.inferredScore}. Reason: ${result.reasoning}`],
        executedPrompts: [{ name: STANDARD_IMPUTATION_WORKER_PROMPT.name }],
        inferredScore: result.inferredScore,
        spanRecords: localSpans,
    };
};
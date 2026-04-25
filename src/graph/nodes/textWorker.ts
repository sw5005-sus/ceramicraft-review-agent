// textWorker.ts
import { z } from "zod";
import { ReviewGraphState, type SpanRecord } from "../state.js";
import { createLLMFromPromptConfig, globalTokenTracker } from "../../utils/llmFactory.js";
import { STANDARD_TEXT_WORKER_PROMPT } from "../../prompts/catalog.js";

const llm = createLLMFromPromptConfig(STANDARD_TEXT_WORKER_PROMPT.modelConfig);

export const textWorkerNode = async (state: typeof ReviewGraphState.State) => {
    console.log("Text Worker: analyzing text, context, and drafting responses if needed...");
    
    // Support both field name conventions (content/stars from real API, text/rating from test)
    const text = state.reviewPayload?.content || state.reviewPayload?.text || "";
    const rating = state.reviewPayload?.stars ?? state.reviewPayload?.rating;
    const originalStars = state.reviewPayload?.stars;
    const productContext = state.productContext ? `\nProduct Info: ${state.productContext}` : "";

    // 1. Expanded Zod Schema for After-Sales drafting
    const textAnalysisSchema = z.object({
        isProductRelevant: z.boolean().describe("True if review is actually about the product/service (not spam or off-topic)."),
        isSafe: z.boolean().describe("False if text contains profanity, hate speech, or spam."),
        isMismatch: z.boolean().describe("True if sentiment strongly contradicts the numeric rating."),
        requiresAfterSales: z.boolean().describe("True if the user explicitly seeks refund, return, or technical support."),
        
        // Conditionally populated fields for after-sales
        issueSummary: z.string().optional().describe("A concise summary of the customer's problem. Only provide if requiresAfterSales is true."),
        suggestedSolution: z.string().optional().describe("The recommended internal action (e.g., issue full refund, send replacement). Only provide if requiresAfterSales is true."),
        customerServiceScript: z.string().optional().describe("A professional, empathetic email draft responding to the user. Only provide if requiresAfterSales is true."),
        
        reasoning: z.string().describe("Detailed explanation of the analysis.")
    });

    const structuredLlm = llm.withStructuredOutput(textAnalysisSchema, {
        method: "functionCalling",     
    });

    // 2. Updated Prompt
    const prompt = String(STANDARD_TEXT_WORKER_PROMPT.template)
        .replace("{{text}}", text)
        .replace("{{rating}}", String(rating !== undefined ? rating : "None provided"))
        .replace("{{product_context}}", productContext);

    // 3. Invoke LLM — capture span
    const tokensBefore = { input: globalTokenTracker.inputTokens, output: globalTokenTracker.outputTokens };
    const spanStart = Date.now();
    const result = await structuredLlm.invoke(prompt);
    const spanEnd = Date.now();

    const spanRecord: SpanRecord = {
        name: "textWorker",
        spanType: "LLM",
        startTimeMs: spanStart,
        endTimeMs: spanEnd,
        inputs: JSON.stringify({ prompt }),
        outputs: JSON.stringify(result),
        inputTokens: globalTokenTracker.inputTokens - tokensBefore.input,
        outputTokens: globalTokenTracker.outputTokens - tokensBefore.output,
        model: STANDARD_TEXT_WORKER_PROMPT.modelConfig?.model_name,
        statusCode: "OK",
    };

    // 4. Construct the afterSalesDraft object if applicable
    const draft = result.requiresAfterSales 
        ? {
            summary: result.issueSummary || "No summary provided.",
            solution: result.suggestedSolution || "Review manually.",
            script: result.customerServiceScript || "Please contact support."
          } 
        : null;

    // 5. Update State
    // Special case: if original stars = 0 (no rating provided), don't mark as mismatch 
    // (it's an imputation case, not a rating-sentiment contradiction)
    const finalIsMismatch = originalStars === 0 ? false : result.isMismatch;
    
    return {
        reasoningLogs: [`[Text Worker] Relevant: ${result.isProductRelevant}, Safe: ${result.isSafe}, Mismatch: ${finalIsMismatch}, Support: ${result.requiresAfterSales}. Reason: ${result.reasoning}`],
        executedPrompts: [{ name: STANDARD_TEXT_WORKER_PROMPT.name }],
        isProductRelevant: result.isProductRelevant,
        isSafe: result.isSafe,
        isMismatch: finalIsMismatch,
        requiresAfterSales: result.requiresAfterSales,
        afterSalesDraft: draft,
        spanRecords: [spanRecord],
    };
};

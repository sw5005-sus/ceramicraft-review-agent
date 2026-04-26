/**
 * Enhanced Text Worker with MCP tool integration
 * EVIDENCE COLLECTION ONLY - No verdicts, only findings
 * 
 * Responsibilities:
 * - Check if review is product-relevant (getProduct)
 * - Check if text is safe (no profanity/hate/spam)
 * - Check for rating/text mismatch
 * - Detect after-sales requests
 * 
 * NO VERDICTS: Final Decision will interpret this evidence
 */

import { z } from "zod";
import { ReviewGraphState } from "../state.js";
import { createLLMFromPromptConfig } from "../../utils/llmFactory.js";
import { getProduct } from "../../mcp/tools.js";
import { ENHANCED_TEXT_WORKER_PROMPT } from "../../prompts/catalog.js";

const llm = createLLMFromPromptConfig(ENHANCED_TEXT_WORKER_PROMPT.modelConfig);

export const textWorkerNode = async (state: typeof ReviewGraphState.State) => {
    console.log("Text Worker: Collecting evidence for review...");
    const { text, rating, productId } = state.reviewPayload;
    let productContext = "";

    // EVIDENCE 1: Product Relevance (if productId provided)
    if (productId) {
        try {
            console.log(`[Text Worker] Fetching product for relevance check: ${productId}`);
            const productData = await getProduct(productId);
            productContext = `
Product: ${productData.name}
Category: ${productData.category || "N/A"}
`;
            console.log(`[Text Worker] ✓ Got product info`);
        } catch (error) {
            console.warn(`[Text Worker] Warning: Could not fetch product:`, error);
            // Continue anyway - don't let tool failure block analysis
        }
    }

    // Schema for collecting evidence (not for verdicts)
    const textAnalysisSchema = z.object({
        isRelevant: z.boolean().describe("Evidence: Is this review actually about the product? (null if unknown)"),
        isSafe: z.boolean().describe("Evidence: Does text contain no profanity/hate/spam?"),
        isMismatch: z.boolean().describe("Evidence: Is sentiment very different from the rating?"),
        requiresAfterSales: z.boolean().describe("Evidence: Does user explicitly ask for refund/replacement/support?"),
        
        issueSummary: z.string().optional().describe("If requiresAfterSales=true, summarize the issue in 1 sentence."),
        suggestedSolution: z.string().optional().describe("If requiresAfterSales=true, what action should we take?"),
        
        reasoning: z.string().describe("Detailed analysis explaining each finding.")
    });

    const structuredLlm = llm.withStructuredOutput(textAnalysisSchema, {
        method: "functionCalling",     
    });

    // Collect all evidence
    const prompt = `
You are an expert review analyzer. Your job is to collect evidence about this review.
You are NOT making a verdict - just reporting facts.

${productContext ? `PRODUCT INFO:\n${productContext}` : ""}

REVIEW TEXT: "${text}"
Star Rating: ${rating !== undefined ? rating : "Not provided"}

Collect evidence by answering:
1. RELEVANCE: Is this review actually about the product? Or is it spam/off-topic/random text?
2. SAFETY: Does the text have no profanity, hate speech, or obvious spam?
3. MISMATCH: Is the sentiment very different from the rating? (e.g., praising but 1 star)
4. AFTER-SALES: Does the user ask for refund/replacement/support?

Report your findings. If requiresAfterSales=true, provide issue summary and solution.
`;

    const result = await structuredLlm.invoke(prompt);

    // BUILD RETURN VALUE: Report evidence, not verdicts
    const returnValue: any = {
        reasoningLogs: [
            `[Text Worker] Evidence collected: Relevant=${result.isRelevant}, Safe=${result.isSafe}, Mismatch=${result.isMismatch}, NeedsSupport=${result.requiresAfterSales}. ${result.reasoning}`
        ],
        isProductRelevant: result.isRelevant,
        isSafe: result.isSafe,
        isMismatch: result.isMismatch,
        requiresAfterSales: result.requiresAfterSales
    };

    // Attach after-sales evidence if present
    if (result.requiresAfterSales) {
        returnValue.afterSalesDraft = {
            summary: result.issueSummary || "Customer support needed",
            solution: result.suggestedSolution || "Review manually",
            script: ""
        };
    }

    return returnValue;
};

// textWorker.ts
import { z } from "zod";
import { ReviewGraphState } from "../state.js";
import { createLLM } from "../../utils/llmFactory.js";
import { getProductHttp } from "../../mcp/tools-http.js";

const llm = createLLM("kimi-k2-0711-preview");

export const textWorkerNode = async (state: typeof ReviewGraphState.State) => {
    console.log("Text Worker: analyzing text, context, and drafting responses if needed...");
    
    // Support both field name conventions (content/stars from real API, text/rating from test)
    const text = state.reviewPayload?.content || state.reviewPayload?.text || "";
    const rating = state.reviewPayload?.stars ?? state.reviewPayload?.rating;
    const productId = state.reviewPayload?.product_id || state.reviewPayload?.productId;
    
    // Fetch product details if available for relevance check
    let productContext = "";
    if (productId) {
        try {
            const response = await getProductHttp(String(productId));
            
            // Parse MCP HTTP response format: {"content":[{"type":"text","text":"JSON_STRING"}]}
            let productData: any = null;
            if (response?.content && Array.isArray(response.content) && response.content[0]?.text) {
                try {
                    const jsonText = response.content[0].text;
                    const parsed = JSON.parse(jsonText);
                    productData = parsed?.data || parsed;
                } catch (e) {
                    // If direct parse fails, try extracting JSON from the text
                    console.log(`[Text Worker] Could not parse product response JSON`);
                }
            } else if (response?.data) {
                // Direct response format
                productData = response.data;
            } else if (response?.name) {
                // Fallback: response is already the product object
                productData = response;
            }
            
            if (productData?.name) {
                productContext = `\nProduct Info: Category=${productData.category || "unknown"}, Name=${productData.name}`;
                console.log(`[Text Worker] Fetched product: ${productData.name}`);
            } else {
                console.log(`[Text Worker] Product response missing name field`);
            }
        } catch (error: any) {
            console.log(`[Text Worker] Could not fetch product: ${error.message}`);
        }
    }

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
    const prompt = `
You are an expert e-commerce review moderator for a ceramic products platform.
Analyze the following user review text and the provided star rating (if any).

Review Text: "${text}"
Star Rating: ${rating !== undefined ? rating : "None provided"}${productContext}

Your tasks:
1. Relevance: Determine if this review is actually about the ceramic product (not food, kids, or off-topic).
   - If the review talks about eating/food/kids rather than the product quality, it's NOT relevant.
   - Example: "my kids loves eating it" - This is about food/kids, NOT the ceramic product.
2. Safety: Flag any toxic, abusive, or spam content.
3. Logic Match: Determine if the text sentiment contradicts the numeric rating.
4. After-Sales Intent: Identify if the user needs customer service. 
   CRITICAL: If 'requiresAfterSales' is true, you MUST also generate:
   - 'issueSummary': A 1-sentence summary of the problem.
   - 'suggestedSolution': What our internal team should do.
   - 'customerServiceScript': A complete, polite email draft addressing the issue.
`;

    // 3. Invoke LLM
    const result = await structuredLlm.invoke(prompt);

    // 4. Construct the afterSalesDraft object if applicable
    const draft = result.requiresAfterSales 
        ? {
            summary: result.issueSummary || "No summary provided.",
            solution: result.suggestedSolution || "Review manually.",
            script: result.customerServiceScript || "Please contact support."
          } 
        : null;

    // 5. Update State
    return {
        reasoningLogs: [`[Text Worker] Relevant: ${result.isProductRelevant}, Safe: ${result.isSafe}, Mismatch: ${result.isMismatch}, Support: ${result.requiresAfterSales}. Reason: ${result.reasoning}`],
        isProductRelevant: result.isProductRelevant,
        isSafe: result.isSafe,
        isMismatch: result.isMismatch,
        requiresAfterSales: result.requiresAfterSales,
        afterSalesDraft: draft
    };
};

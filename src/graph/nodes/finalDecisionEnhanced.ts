/**
 * Enhanced Final Decision Node with MCP integration
 * Synthesizes worker reports and persists decisions back to the backend
 * 
 * NOTE: Persists moderation decision using updateReviewStatus
 * No merchant replies (separate process if needed)
 */

import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ReviewGraphState } from "../state.js";
import { createLLM } from "../../utils/llmFactory.js";
import { updateReviewStatus } from "../../mcp/tools.js";

const llm = createLLM("kimi-k2-0711-preview");

export const finalDecisionNode = async (state: typeof ReviewGraphState.State) => {
    console.log("Final Decision: Synthesizing worker reports and making final verdict...");
    
    // 1. Extract all evidence gathered by the Supervisor and parallel Workers
    const { reasoningLogs, autoFlag, afterSalesDraft, inferredScore, reviewPayload } = state;
    const { reviewId } = reviewPayload;

    // 2. Define the exact JSON structure for the final verdict
    const finalDecisionSchema = z.object({
        finalStatus: z.enum(["approved", "rejected", "pending_review"]).describe("The ultimate outcome of the moderation workflow."),
        summaryReason: z.string().describe("A concise 1-sentence explanation synthesizing why this final status was chosen based on the evidence.")
    });

    const structuredLlm = llm.withStructuredOutput(finalDecisionSchema, {
        method: "functionCalling",     
    });

    // 3. Strictly separate System Rules from the dynamic User Data
    const promptTemplate = ChatPromptTemplate.fromMessages([
        ["system", `You are the Chief Review Moderator for an e-commerce platform.
Your job is to make the final moderation decision based ONLY on the logs and flags provided by your specialized worker agents.

Strict Rules for Final Status:
1. If 'Auto Flag' is "not_relevant" -> review is off-topic/not about product -> return "rejected" (SPAM category)
2. If 'Auto Flag' is "supervisor_rejected" -> spam/high_risk detected -> return "rejected"
3. If 'Auto Flag' is "mismatch" OR "After-Sales Triggered" = "Yes" -> return "pending_review" (needs manual review)
4. Otherwise, all workers passed and no critical flags -> return "approved"

Base your decision ONLY on the provided evidence. Do not guess.`],
        
        ["user", `Worker Reasoning Logs:
{logs}

Current System Flags:
- Auto Flag: {flag}
- Inferred Score: {score}
- After-Sales Triggered: {afterSales}`]
    ]);

    // 4. Format the dynamic data into the User Prompt
    const formattedPrompt = await promptTemplate.invoke({
        logs: reasoningLogs.length > 0 ? reasoningLogs.join("\n") : "No worker logs available.",
        flag: autoFlag || "None",
        score: inferredScore?.toString() ?? "N/A",
        afterSales: afterSalesDraft ? "Yes" : "No"
    });

    // 5. Invoke LLM to make the final judgment
    const result = await structuredLlm.invoke(formattedPrompt);

    // 6. Persist the decision back to the backend via MCP tools
    const logs: string[] = [`[Final Decision] Verdict: ${result.finalStatus}. Justification: ${result.summaryReason}`];

    if (reviewId) {
        try {
            console.log(`[Final Decision] Persisting review status to backend: review_id=${reviewId}, status=${result.finalStatus}`);
            
            // Map to backend status names
            const backendStatus = result.finalStatus === "rejected" ? "rejected" : 
                                result.finalStatus === "approved" ? "approved" : 
                                "pending";
            
            // Update review status in backend
            await updateReviewStatus(
                reviewId,
                backendStatus as any,
                autoFlag === "mismatch",
                autoFlag === "supervisor_rejected",
                autoFlag || undefined
            );

            logs.push(`[Final Decision] Successfully updated review status in backend`);

        } catch (persistError: any) {
            console.error(`[Final Decision] Error persisting decision:`, persistError);
            logs.push(`[Final Decision] WARNING: Could not persist to backend: ${persistError.message}`);
            // Continue anyway - decision is made even if persistence fails
        }
    }

    // 7. Update the State with the final authoritative status
    return {
        finalStatus: result.finalStatus,
        reasoningLogs: logs
    };
};

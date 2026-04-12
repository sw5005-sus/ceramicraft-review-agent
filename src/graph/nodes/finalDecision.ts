import { ReviewGraphState } from "../state.js";
import { updateReviewStatusHttp } from "../../mcp/tools-http.js";
import {
    logModerationRun,
    logModerationTrace,
    type PromptVersionRef,
    registerSystemPrompts,
    resolvePromptVersionRefs,
} from "../../utils/mlflowClient.js";

export const finalDecisionNode = async (state: typeof ReviewGraphState.State) => {
    console.log("Final Decision: Analyzing all evidence and making final verdict...");
    
    // 1. Extract ALL evidence fields from workers
    const { 
        reasoningLogs, 
        autoFlag,           // "supervisor_rejected" if Supervisor flagged it
        reviewPayload,      // Original review data
        
        // Text Worker Evidence
        isProductRelevant,
        isSafe,
        isMismatch,
        requiresAfterSales,
        afterSalesDraft,
        
        // Vision Worker Evidence
        isImageSafe,
        isImageRelevant,
        
        // Imputation Worker Evidence
        inferredScore,

        // Timing
        graphStartTime,

        // Prompt lineage
        executedPrompts
    } = state;
    
    // Prepare stars parameter for backend (same as inferredScore)
    const stars = inferredScore;

    // 2. Apply business rules:
    // - REJECTED: if harmful/unsafe content (highest priority)
    // - HIDDEN: if quality issues (off-topic, rating/text mismatch)
    // - APPROVED: all other cases (including after-sales requests for admin handling)
    
    let finalStatus: "approved" | "hidden" | "rejected";
    let summaryReason: string;

    // Rule 1: REJECT if Supervisor flagged as harmful/spam
    if (autoFlag === "supervisor_rejected") {
        finalStatus = "rejected";
        summaryReason = "Supervisor detected spam or high-risk content";
    }
    // Rule 2: REJECT if text contains unsafe/harmful content
    else if (isSafe === false) {
        finalStatus = "rejected";
        summaryReason = "Review contains unsafe or inappropriate content";
    }
    // Rule 3: REJECT if any image is unsafe
    else if (isImageSafe === false) {
        finalStatus = "rejected";
        summaryReason = "Review images contain unsafe or inappropriate content";
    }
    // Rule 4: HIDDEN if review is not about the product (quality issue, not safety)
    else if (isProductRelevant === false) {
        finalStatus = "hidden";
        summaryReason = "Review is not about the product - flagged for manual review";
    }
    // Rule 5: HIDDEN if rating/text mismatch (quality issue)
    else if (isMismatch === true) {
        finalStatus = "hidden";
        summaryReason = "Review has rating/sentiment mismatch - flagged for manual review";
    }
    // Rule 6: APPROVED if all other evidence passes
    // (includes cases with after-sales or image not relevant, as admin can handle)
    else {
        finalStatus = "approved";
        summaryReason = "Review passed all quality checks";
    }

    // 3. Build autoFlag based on detected evidence
    // Supervisor can set "supervisor_rejected", but we can also add other flags for quality issues
    let finalAutoFlag = autoFlag; // Keep supervisor's flag if present
    
    // Add quality issue flags
    const flags: string[] = [];
    if (!autoFlag || autoFlag !== "supervisor_rejected") {
        // Only add additional flags if not already rejected by supervisor
        if (isMismatch === true) {
            flags.push("mismatch");
        }
        if (isProductRelevant === false) {
            flags.push("off_topic");
        }
        if (requiresAfterSales === true) {
            flags.push("after_sales");
        }
        
        // Combine flags if multiple issues found
        if (flags.length > 0) {
            finalAutoFlag = flags.join("|");
        }
    }

    // 4. Prepare parameters for updateReviewStatus call
    // Support both field name conventions (id from real API, reviewId from test)
    const reviewId = reviewPayload?.id || reviewPayload?.reviewId;
    const isHarmful = autoFlag === "supervisor_rejected" || isSafe === false || isImageSafe === false;

    // 6. Build final logs
    const logs = [
        `[Final Decision] Decision Rules Applied`,
        `[Final Decision] Status: ${finalStatus}`,
        `[Final Decision] Reason: ${summaryReason}`
    ];
    
    // Add context for hidden reviews
    if (finalStatus === "hidden") {
        logs.push(`[Final Decision] Reason: Rating (${reviewPayload?.rating}) does not match sentiment`);
    }
    
    // Add after-sales context if present
    if (requiresAfterSales && afterSalesDraft) {
        logs.push(`[Final Decision] After-Sales Issue: ${afterSalesDraft.summary}`);
    }
    
    // Add auto flag info if present
    if (finalAutoFlag) {
        logs.push(`[Final Decision] Auto Flags: ${finalAutoFlag}`);
    }

    // 7. Persist decision to backend (if reviewId provided)
    if (reviewId) {
        try {
            console.log(`[Final Decision] Persisting decision to backend...`);
            await updateReviewStatusHttp(
                reviewId,
                finalStatus,
                isMismatch ?? undefined,
                isHarmful,
                finalAutoFlag ?? undefined,
                stars ?? undefined
            );
            logs.push(`[Final Decision] ✓ Decision persisted (reviewId: ${reviewId})`);
        } catch (error: any) {
            logs.push(`[Final Decision] ⚠️ Failed to persist: ${error.message}`);
        }
    }

    let linkedPrompts: PromptVersionRef[] = [];
    try {
        await registerSystemPrompts();
        linkedPrompts = await resolvePromptVersionRefs(executedPrompts ?? []);
    } catch (error: any) {
        logs.push(`[Final Decision] MLflow prompt lineage resolution skipped: ${error.message}`);
    }

    // 8. Push run data to MLflow (non-blocking on failure)
    await logModerationRun({
        reviewId: reviewId ?? undefined,
        productId: reviewPayload?.product_id ?? reviewPayload?.productId,
        isSafe,
        isProductRelevant,
        isMismatch,
        isImageSafe,
        isImageRelevant,
        inferredScore,
        finalStatus,
        autoFlag: finalAutoFlag ?? null,
        isHarmful,
        linkedPrompts,
        reasoningLogs: logs,
        latencyMs: Date.now() - graphStartTime,
    });

    // 9. Push GenAI Trace (visible in Traces tab)
    await logModerationTrace({
        reviewId:      reviewId ?? undefined,
        reviewContent: reviewPayload?.content ?? reviewPayload?.text,
        productId:     reviewPayload?.product_id ?? reviewPayload?.productId,
        finalStatus,
        autoFlag:      finalAutoFlag ?? null,
        isHarmful,
        linkedPrompts,
        reasoningLogs: logs,
        startTimeMs:   graphStartTime,
        latencyMs:     Date.now() - graphStartTime,
    });

    return {
        finalStatus,
        reasoningLogs: logs,
        afterSalesDraft: requiresAfterSales ? afterSalesDraft : undefined,
        // Include evidence fields for test visibility
        autoFlag: finalAutoFlag ?? undefined,
        isMismatch: isMismatch ?? undefined,
        isHarmful: isHarmful,
        inferredScore: inferredScore ?? undefined
    };
};
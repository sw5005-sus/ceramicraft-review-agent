import { z } from "zod";
import { ReviewGraphState } from "../state.js";
import { updateReviewStatusHttp } from "../../mcp/tools-http.js";
import {
    logModerationRun,
    logModerationTrace,
    type PromptVersionRef,
    registerSystemPrompts,
    resolvePromptVersionRefs,
} from "../../utils/mlflowClient.js";
import { globalTokenTracker, createLLMFromPromptConfig } from "../../utils/llmFactory.js";
import { sendModerationNotification } from "../../utils/emailService.js";

const CONFIDENCE_THRESHOLD = 80; // Reviews with confidence < 80 escalated to manual review

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
        executedPrompts,

        // Span records from workers
        spanRecords,
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
    // Rule 3: HIDDEN if review is not about the product (quality issue, not safety)
    else if (isProductRelevant === false) {
        finalStatus = "hidden";
        summaryReason = "Review is not about the product - flagged for manual review";
    }
    // Rule 4: HIDDEN if images are not relevant to the product (quality issue, higher priority than image safety)
    else if (isImageRelevant === false) {
        finalStatus = "hidden";
        summaryReason = "Review images are not relevant to the product - flagged for manual review";
    }
    // Rule 5: REJECT if any image is unsafe (only after relevance check)
    else if (isImageSafe === false) {
        finalStatus = "rejected";
        summaryReason = "Review images contain unsafe or inappropriate content";
    }
    // Rule 6: HIDDEN if rating/text mismatch (quality issue)
    // BUT: if original stars=0 (no rating provided) and we inferred a score, that's NOT a mismatch - it's successful imputation
    else if (isMismatch === true && reviewPayload?.stars !== 0) {
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
    
    // Build all applicable flags (independent of finalStatus decision)
    const flags: string[] = [];
    if (!autoFlag || autoFlag !== "supervisor_rejected") {
        // Score imputation flag: if original stars = 0 (no rating) and we inferred a score
        if (reviewPayload?.stars === 0 && inferredScore != null) {
            flags.push("score_inferred");
        }
        // Other quality flags (can coexist with score_inferred)
        if (isMismatch === true && reviewPayload?.stars !== 0) {
            flags.push("mismatch");
        }
        if (isProductRelevant === false) {
            flags.push("off_topic");
        }
        if (isImageRelevant === false) {
            flags.push("image_off_topic");
        }
        if (requiresAfterSales === true) {
            flags.push("after_sales");
        }
        
        // Combine all flags if multiple issues found
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
    
    // 6.5 Evaluate confidence score based on reasoning logs (LLM-based)
    let confidenceScore = 50;
    try {
        const llm = createLLMFromPromptConfig({ model_name: process.env.LLM_MODEL ?? "kimi-k2-0711-preview", temperature: 0 });
        const confidenceSchema = z.object({
            confidenceScore: z.number().min(0).max(100).describe("Confidence in this decision from 0 to 100.")
        });
        const structuredLlm = llm.withStructuredOutput(confidenceSchema, { method: "functionCalling" });
        
        const confidencePrompt = `Based on the worker evidence and reasoning logs below, evaluate your confidence in the final moderation decision.

Worker Evidence:
${reasoningLogs.join("\n")}
Final Status Decision: ${finalStatus}
Summary Reason: ${summaryReason}

Rating Guidelines:
- 90-100: High confidence. Evidence is clear, consistent, and unambiguous.
- 70-89: Medium-high confidence. Most evidence aligns, minor ambiguities.
- 50-69: Medium confidence. Mixed signals or some contradictory evidence.
- 30-49: Low confidence. Significant ambiguity or contradictions.
- 0-29: Very low confidence. Evidence is unclear or conflicting.

Rate your confidence from 0 to 100:`;
        
        const result = await structuredLlm.invoke(confidencePrompt);
        confidenceScore = result.confidenceScore;
        logs.push(`[Final Decision] LLM Confidence: ${confidenceScore}`);
    } catch (err: any) {
        logs.push(`[Final Decision] Confidence evaluation failed: ${err.message}. Using default fallback.`);
    }
    
    // 6.6 Auto-escalate low-confidence approvals to manual review
    if (finalStatus === "approved" && confidenceScore < CONFIDENCE_THRESHOLD) {
        finalStatus = "hidden";
        summaryReason = `Automated decision confidence too low (${confidenceScore}%); escalated for manual review.`;
        logs.push(`[Final Decision] ⚠️  Confidence ${confidenceScore}% < ${CONFIDENCE_THRESHOLD}%; escalated to manual review`);
    }
    
    // Add context for hidden reviews
    if (finalStatus === "hidden") {
        const displayRating = reviewPayload?.stars ?? reviewPayload?.rating;
        logs.push(`[Final Decision] Reason: Rating (${displayRating}) does not match sentiment`);
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
        confidenceScore,
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
        confidenceScore,
        linkedPrompts,
        reasoningLogs: logs,
        startTimeMs:   graphStartTime,
        latencyMs:     Date.now() - graphStartTime,
        inputTokens:   globalTokenTracker.inputTokens,
        outputTokens:  globalTokenTracker.outputTokens,
        totalTokens:   globalTokenTracker.totalTokens,
        spanRecords:   spanRecords ?? [],
    });

    // 10. Send moderation notification to admin
    // Only notify admin if: review is REJECTED (dangerous user) OR has after-sales (needs action) OR escalated due to low confidence
    const shouldNotifyAdmin = finalStatus === "rejected" || requiresAfterSales || (confidenceScore < CONFIDENCE_THRESHOLD && finalStatus === "hidden");
    const adminEmail = process.env.EMAIL_RECEIVER;
    
    if (adminEmail && shouldNotifyAdmin) {
        try {
            console.log(`[Final Decision] Sending moderation notification to admin (${adminEmail})...`);
            const reviewContent = reviewPayload?.content ?? reviewPayload?.text ?? "(no content)";
            const userId = reviewPayload?.user_id;
            
            // Add risk warning for rejected reviews
            const isRejected = finalStatus === "rejected";
            
            const emailResult = await sendModerationNotification(
                adminEmail,
                reviewId ?? 'UNKNOWN',
                userId,
                reviewContent,
                finalStatus,
                finalAutoFlag ?? null,
                requiresAfterSales ? afterSalesDraft : null,
                isRejected  // Pass flag to highlight dangerous user
            );
            
            if (emailResult.success) {
                logs.push(`[Final Decision] ✅ Moderation notification sent to admin`);
            } else {
                logs.push(`[Final Decision] ⚠️ Failed to send admin notification: ${emailResult.error}`);
            }
        } catch (error: any) {
            logs.push(`[Final Decision] ⚠️ Exception while sending admin email: ${error.message}`);
        }
    } else if (!shouldNotifyAdmin) {
        logs.push(`[Final Decision] ℹ️  Skipped admin notification: review approved, no after-sales`);
    } else {
        logs.push(`[Final Decision] ⚠️ No admin email configured (EMAIL_RECEIVER), skipping notification`);
    }

    return {
        finalStatus,
        confidenceScore,
        reasoningLogs: logs,
        afterSalesDraft: requiresAfterSales ? afterSalesDraft : undefined,
        // Include evidence fields for test visibility
        autoFlag: finalAutoFlag ?? undefined,
        isMismatch: isMismatch ?? undefined,
        isImageRelevant: isImageRelevant ?? undefined,
        isHarmful: isHarmful,
        inferredScore: inferredScore ?? undefined
    };
};
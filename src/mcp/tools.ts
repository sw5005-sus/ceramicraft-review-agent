/**
 * Tool wrapper layer for CeramiCraft backend operations
 * SIMPLIFIED: Only essential tools for review moderation
 * 
 * Tools included:
 * 1. getProduct - Check if review is product-relevant
 * 2. listReviewsByStatus - Get pending reviews for moderation
 * 3. updateReviewStatus - Persist moderation decision
 * 4. getUserReviews - Analyze user's review history (requires JWT from caller)
 */

import { callRemoteTool } from "./client.js";

/**
 * Get product details by ID
 * Used to verify review relevance to product
 * @param productId - The product ID
 */
export async function getProduct(productId: string): Promise<any> {
    return callRemoteTool("get_product", {
        product_id: productId
    });
}

/**
 * List reviews by moderation status (internal M2M call)
 * Get pending reviews that need moderation
 * @param status - Moderation status filter
 * @param limit - Max number of reviews
 * @param offset - Pagination offset
 */
export async function listReviewsByStatus(
    status: "pending" | "approved" | "rejected",
    limit: number = 20,
    offset: number = 0
): Promise<any> {
    return callRemoteTool("list_reviews_by_status", {
        status,
        limit,
        offset
    });
}

/**
 * Update review moderation status (internal M2M call)
 * Persist the moderation decision back to backend
 * @param reviewId - The review ID
 * @param status - New status
 * @param isMismatch - Whether review has rating/text mismatch
 * @param isHarmful - Whether review contains harmful content
 * @param autoFlag - Auto-flagging reason if any
 */
export async function updateReviewStatus(
    reviewId: string,
    status: "pending" | "approved" | "rejected",
    isMismatch?: boolean,
    isHarmful?: boolean,
    autoFlag?: string
): Promise<any> {
    return callRemoteTool("update_review_status", {
        review_id: reviewId,
        status,
        ...(isMismatch !== undefined && { is_mismatch: isMismatch }),
        ...(isHarmful !== undefined && { is_harmful: isHarmful }),
        ...(autoFlag && { auto_flag: autoFlag })
    });
}

/**
 * Get current user's reviews
 * For analyzing user's review history and detecting patterns (spam, manipulation)
 * @param jwtToken - JWT token for user identification (you need to provide this)
 * @param limit - Max number of reviews
 * @param offset - Pagination offset
 */
export async function getUserReviews(
    jwtToken: string,
    limit: number = 10,
    offset: number = 0
): Promise<any> {
    return callRemoteTool("get_user_reviews", {
        jwt_token: jwtToken,
        limit,
        offset
    });
}

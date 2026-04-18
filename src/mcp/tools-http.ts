/**
 * HTTP Tool wrapper layer - For MCP server running on HTTP
 * These are HTTP versions of the tool wrappers
 */

import { callRemoteToolHttp } from "./http-client.js";

/**
 * Get product details by ID
 * @param productId - The product ID
 */
export async function getProductHttp(productId: string): Promise<any> {
    return callRemoteToolHttp("get_product", {
        product_id: productId
    });
}

/**
 * List reviews by moderation status
 * @param status - Moderation status filter
 * @param limit - Max number of reviews
 * @param offset - Pagination offset
 */
export async function listReviewsByStatusHttp(
    status: "pending" | "approved" | "rejected" | "processing",
    limit: number = 20,
    offset: number = 0
): Promise<any> {
    return callRemoteToolHttp("list_reviews_by_status", {
        status,
        limit,
        offset
    });
}

/**
 * Update review moderation status
 * @param reviewId - The review ID
 * @param status - New status: approved | hidden | rejected
 * @param isMismatch - Whether review has rating/text mismatch
 * @param isHarmful - Whether review contains harmful content
 * @param autoFlag - Auto-flagging reason if any
 * @param stars - Inferred/imputed rating (1-5 range, optional)
 */
export async function updateReviewStatusHttp(
    reviewId: string,
    status: "approved" | "hidden" | "rejected" | "processing",
    isMismatch?: boolean,
    isHarmful?: boolean,
    autoFlag?: string,
    stars?: number
): Promise<any> {
    return callRemoteToolHttp("update_review_status", {
        review_id: reviewId,
        status,
        ...(isMismatch !== undefined && { is_mismatch: isMismatch }),
        ...(isHarmful !== undefined && { is_harmful: isHarmful }),
        ...(autoFlag && { auto_flag: autoFlag }),
        ...(stars !== undefined && { stars })
    });
}

/**
 * Get all non-rejected reviews by a specific user ID (no auth required)
 * @param userId - The user ID to look up
 */
export async function listReviewsByUserIdHttp(userId: number): Promise<any> {
    return callRemoteToolHttp("list_reviews_by_user_id", {
        user_id: userId
    });
}

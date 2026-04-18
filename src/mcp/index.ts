/**
 * MCP Server Module Index
 * Exports MCP client setup and essential tools for review moderation
 * 
 * Simplified to only include necessary tools:
 * - getProduct (check review relevance)
 * - listReviewsByStatus (get pending reviews)
 * - updateReviewStatus (persist decisions)
 * - getUserReviews (analyze user history - JWT from caller)
 * 
 * Supports both:
 * - Stdio transport (for local server spawning): use client.ts
 * - HTTP transport (for already-running server): use http-client.ts
 */

export {
    initializeMcpClient,
    getMcpClient,
    listAvailableTools,
    callRemoteTool,
    closeMcpClient
} from "./client.js";

export {
    getProduct,
    listReviewsByStatus,
    updateReviewStatus,
    getUserReviews
} from "./tools.js";

export {
    initializeHttpMcpClient,
    listAvailableToolsHttp,
    callRemoteToolHttp,
    checkMcpServerHealth
} from "./http-client.js";

export {
    getProductHttp,
    listReviewsByStatusHttp,
    updateReviewStatusHttp,
    listReviewsByUserIdHttp
} from "./tools-http.js";

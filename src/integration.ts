/**
 * Integration guide for MCP client + LangGraph workflow
 * Shows how to initialize the MCP client and run the review moderation graph
 */

import { initializeMcpClient, listAvailableTools } from "./mcp/index.js";
import { reviewModerationGraph } from "./graph/index.js";
import "dotenv/config";

/**
 * Example: Initialize MCP client and run moderation workflow
 */
export async function runModerationWithMCP(reviewData: {
    text: string;
    rating?: number;
    imageUrls?: string[];
    reviewId?: string;
    productId?: string;
    userId?: string;
    userJwtToken?: string;
}) {
    try {
        // 1. Initialize MCP client connection to remote server
        // The command should match your CeramiCraft MCP server startup
        const mcpServerCommand = process.env.MCP_SERVER_COMMAND || "python";
        const mcpServerArgs = process.env.MCP_SERVER_ARGS 
            ? JSON.parse(process.env.MCP_SERVER_ARGS) 
            : ["-m", "ceramicraft_mcp_server.serve"];

        console.log(`[Main] Initializing MCP client with command: ${mcpServerCommand} ${mcpServerArgs.join(" ")}`);
        await initializeMcpClient(mcpServerCommand, mcpServerArgs);

        // 2. (Optional) List available tools
        console.log(`[Main] Fetching available tools from remote server...`);
        const tools = await listAvailableTools();
        console.log(`[Main] Found ${tools.length} tools available`);

        // 3. Run the moderation workflow
        console.log(`[Main] Starting review moderation workflow...`);
        const finalState = await reviewModerationGraph.invoke({
            reviewPayload: reviewData
        });

        console.log(`[Main] Moderation complete!`);
        console.log(`[Main] Final Status: ${finalState.finalStatus}`);
        console.log(`[Main] Logs:`, finalState.reasoningLogs);

        return {
            status: finalState.finalStatus,
            flag: finalState.autoFlag,
            logs: finalState.reasoningLogs,
            afterSalesDraft: finalState.afterSalesDraft
        };

    } catch (error) {
        console.error(`[Main] Error during moderation:`, error);
        throw error;
    }
}

/**
 * Example usage in main function
 */
if (process.argv[1]?.endsWith("index.ts")) {
    (async () => {
        // Test example
        const result = await runModerationWithMCP({
            text: "The product arrived broken and the seller is not responsive. I need a full refund!",
            rating: 1,
            reviewId: "review_123",
            productId: "prod_456",
            userId: "user_789",
            userJwtToken: "jwt_token_here" // In real usage, get from Zitadel
        });

        console.log("Result:", JSON.stringify(result, null, 2));
        process.exit(0);
    })().catch(error => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}

export default runModerationWithMCP;

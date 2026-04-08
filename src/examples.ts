/**
 * Example: Running review moderation with full MCP integration
 * 
 * This example demonstrates how to:
 * 1. Initialize MCP client connection
 * 2. Set up the review moderation graph
 * 3. Process a review with full tool integration
 * 4. Handle results and persistence
 */

import { initializeMcpClient, closeMcpClient, listAvailableTools } from "./mcp/index.js";
import { reviewModerationGraph } from "./graph/index.js";
import "dotenv/config";

/**
 * Example 1: Basic moderation without MCP context
 * (Works even if MCP server is unavailable)
 */
async function example1_BasicModeration() {
    console.log("\n=== Example 1: Basic Moderation (MCP Optional) ===\n");
    
    const simpleReview = {
        text: "The product broke after 2 days",
        rating: 2
    };

    try {
        const result = await reviewModerationGraph.invoke({ reviewPayload: simpleReview });
        
        console.log("Result:");
        console.log(`- Status: ${result.finalStatus}`);
        console.log(`- Flag: ${result.autoFlag}`);
        console.log(`- Logs:`, result.reasoningLogs);
        
        return result;
    } catch (error) {
        console.error("Error:", error);
    }
}

/**
 * Example 2: Full integration with MCP
 * (Fetches context, persists decisions)
 */
async function example2_FullMCPIntegration() {
    console.log("\n=== Example 2: Full MCP Integration ===\n");
    
    try {
        // Step 1: Initialize MCP client
        console.log("[Init] Connecting to MCP server...");
        const mcpCommand = process.env.MCP_SERVER_COMMAND || "python";
        const mcpArgs = process.env.MCP_SERVER_ARGS 
            ? JSON.parse(process.env.MCP_SERVER_ARGS)
            : ["-m", "ceramicraft_mcp_server.serve"];
        
        await initializeMcpClient(mcpCommand, mcpArgs);
        console.log("[Init] ✓ MCP client connected\n");

        // Step 2: List available tools
        console.log("[Info] Fetching available tools...");
        const tools = await listAvailableTools();
        console.log(`[Info] ✓ Found ${tools.length} tools available`);
        console.log(`[Info] First 10 tools: ${tools.slice(0, 10).map(t => t.name).join(", ")}\n`);

        // Step 3: Run moderation with full context
        const reviewWithContext = {
            text: "Product quality is terrible and seller won't respond. I want a refund!",
            rating: 1,
            reviewId: "review_abc123",
            productId: "prod_xyz789",
            userId: "user_user001",
            userJwtToken: process.env.ZITADEL_JWT_TOKEN || "test_token"
        };

        console.log("[Graph] Starting moderation workflow...");
        console.log("[Graph] Input:", JSON.stringify(reviewWithContext, null, 2));

        const result = await reviewModerationGraph.invoke({ 
            reviewPayload: reviewWithContext 
        });

        console.log("\n[Graph] Moderation complete!");
        console.log("[Graph] Final Status:", result.finalStatus);
        console.log("[Graph] Auto Flag:", result.autoFlag);
        console.log("[Graph] After-Sales Draft:", result.afterSalesDraft ? "Generated" : "None");
        console.log("[Graph] Logs:");
        result.reasoningLogs.forEach((log: string) => console.log("  -", log));

        return result;

    } catch (error: any) {
        console.error("[Error]", error.message);
        if (error.message.includes("spawn")) {
            console.info("\n[Info] Tip: Is the MCP server running?");
            console.info("  Try: python -m ceramicraft_mcp_server.serve");
        }
    } finally {
        // Step 4: Clean up
        console.log("\n[Cleanup] Closing MCP connection...");
        await closeMcpClient();
    }
}

/**
 * Example 3: Batch processing multiple reviews
 */
async function example3_BatchProcessing() {
    console.log("\n=== Example 3: Batch Processing ===\n");
    
    const reviews = [
        {
            text: "Great product! Highly recommend.",
            rating: 5 as const,
            reviewId: "rev_001",
            productId: "prod_A"
        },
        {
            text: "asdfghjkl!!! DELETE THIS!!!",
            reviewId: "rev_002",
            productId: "prod_B"
        },
        {
            text: "Good quality but shipping took too long",
            rating: 4 as const,
            reviewId: "rev_003",
            productId: "prod_C"
        }
    ];

    try {
        await initializeMcpClient(
            process.env.MCP_SERVER_COMMAND || "python",
            process.env.MCP_SERVER_ARGS ? JSON.parse(process.env.MCP_SERVER_ARGS) : []
        );

        const results = [];
        
        for (const review of reviews) {
            console.log(`\n[Processing] Review: "${review.text.substring(0, 50)}..."`);
            
            try {
                const result = await reviewModerationGraph.invoke({ 
                    reviewPayload: review 
                });
                
                console.log(`  ✓ Status: ${result.finalStatus}`);
                results.push(result);
            } catch (error: any) {
                console.error(`  ✗ Error: ${error.message}`);
                results.push({ error: error.message });
            }
        }

        console.log("\n[Summary]");
        console.log(`Total processed: ${results.length}`);
        console.log(`Approved: ${results.filter((r: any) => r.finalStatus === "approved").length}`);
        console.log(`Rejected: ${results.filter((r: any) => r.finalStatus === "rejected").length}`);
        console.log(`Pending: ${results.filter((r: any) => r.finalStatus === "pending_review").length}`);
        console.log(`Errors: ${results.filter((r: any) => r.error).length}`);

        return results;
    } finally {
        await closeMcpClient();
    }
}

/**
 * Example 4: Error recovery scenario
 */
async function example4_ErrorRecovery() {
    console.log("\n=== Example 4: Error Recovery ===\n");
    console.log("[Info] This example shows graceful degradation when MCP fails\n");

    // Don't initialize MCP intentionally to simulate failure
    
    const review = {
        text: "The product quality is poor",
        rating: 2,
        reviewId: "rev_004",
        productId: "prod_D" // Won't be fetched, but analysis still works
    };

    try {
        console.log("[Graph] Processing review without MCP context...");
        const result = await reviewModerationGraph.invoke({ 
            reviewPayload: review 
        });
        
        console.log("[Graph] ✓ Moderation still completed!");
        console.log(JSON.stringify(result, null, 2));
        
        return result;
    } catch (error) {
        console.error("[Error] Unrecoverable error:", error);
    }
}

/**
 * CLI interface to run examples
 */
async function main() {
    const exampleNum = process.argv[2] || "1";
    
    console.log("=".repeat(60));
    console.log("ECOMMERCE REVIEW MODERATION - MCP INTEGRATION EXAMPLES");
    console.log("=".repeat(60));

    try {
        switch (exampleNum) {
            case "1":
                await example1_BasicModeration();
                break;
            case "2":
                await example2_FullMCPIntegration();
                break;
            case "3":
                await example3_BatchProcessing();
                break;
            case "4":
                await example4_ErrorRecovery();
                break;
            default:
                console.log(`\nUsage: ts-node src/examples.ts [EXAMPLE_NUM]`);
                console.log(`\nAvailable examples:`);
                console.log(`  1 - Basic moderation without MCP`);
                console.log(`  2 - Full MCP integration with context`);
                console.log(`  3 - Batch processing multiple reviews`);
                console.log(`  4 - Error recovery and graceful degradation`);
                console.log(`\nDefault: Example 1\n`);
        }
    } catch (error) {
        console.error("\nFatal error:", error);
        process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
}

// Run examples
main().catch(console.error);

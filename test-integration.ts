/**
 * Integration Test: Test MCP client connection + Review moderation workflow
 * 
 * Usage:
 *   npx tsx test-integration.ts
 * 
 * Prerequisites:
 *   1. Python MCP server is already running: python -m ceramicraft_mcp_server.serve
 *   2. .env is properly configured with MOONSHOT_API_KEY and MCP_SERVER_ARGS
 */

import "dotenv/config";
import { initializeMcpClient, listAvailableTools, closeMcpClient } from "./src/mcp/index.js";
import { reviewModerationGraph } from "./src/graph/index.js";

async function testIntegration() {
    console.log("\n========================================");
    console.log("🚀 MCP + LangGraph Integration Test");
    console.log("========================================\n");

    try {
        // Step 1: Initialize MCP client and connect to server
        console.log("📡 Step 1: Initializing MCP client connection...");
        const mcpServerCommand = process.env.MCP_SERVER_COMMAND || "python";
        const mcpServerArgs = process.env.MCP_SERVER_ARGS 
            ? JSON.parse(process.env.MCP_SERVER_ARGS) 
            : ["-m", "ceramicraft_mcp_server.serve"];

        console.log(`   Command: ${mcpServerCommand} ${mcpServerArgs.join(" ")}\n`);
        
        await initializeMcpClient(mcpServerCommand, mcpServerArgs);
        console.log("   ✅ MCP client connected successfully!\n");

        // Step 2: List available tools
        console.log("📋 Step 2: Fetching available tools from MCP server...");
        const tools = await listAvailableTools();
        console.log(`   ✅ Found ${tools.length} tools available\n`);
        console.log("   Tools:");
        tools.slice(0, 10).forEach(tool => {
            console.log(`     - ${tool.name}: ${tool.description}`);
        });
        if (tools.length > 10) {
            console.log(`     ... and ${tools.length - 10} more\n`);
        } else {
            console.log("");
        }

        // Step 3: Run review moderation workflow
        console.log("🔄 Step 3: Running review moderation workflow...\n");

        const testCases = [
            {
                name: "Normal Review (Should Approve)",
                data: {
                    text: "Great product! Good quality and fast delivery. Would buy again.",
                    rating: 5,
                    productId: "prod_001",
                    reviewId: "review_001"
                }
            },
            {
                name: "Spam Review (Should Short-Circuit)",
                data: {
                    text: "asdfghjkl 123456 kill everyone explosion SCAM",
                    rating: 1,
                    reviewId: "review_002"
                }
            },
            {
                name: "After-Sales Request (Should Pending Review)",
                data: {
                    text: "Item arrived damaged. I need a refund or replacement immediately!",
                    rating: 1,
                    productId: "prod_002",
                    reviewId: "review_003"
                }
            }
        ];

        for (const testCase of testCases) {
            console.log(`\n   📝 Test: ${testCase.name}`);
            console.log(`      Input: "${testCase.data.text.substring(0, 50)}..."`);
            
            try {
                const result = await reviewModerationGraph.invoke({
                    reviewPayload: testCase.data
                });

                console.log(`      ✅ Result: ${result.finalStatus}`);
                console.log(`      📊 Logs: ${result.reasoningLogs[0]?.substring(0, 80)}...`);
                
                if (result.afterSalesDraft) {
                    console.log(`      🆘 After-Sales: ${result.afterSalesDraft.summary}`);
                }
            } catch (error: any) {
                console.log(`      ❌ Error: ${error.message}`);
            }
        }

        console.log("\n========================================");
        console.log("✅ All tests completed!");
        console.log("========================================\n");

    } catch (error: any) {
        console.error("\n❌ Integration test failed:");
        console.error(error.message || error);
        process.exit(1);
    } finally {
        // Always close the MCP client
        await closeMcpClient();
    }
}

// Run the test
testIntegration().catch(console.error);

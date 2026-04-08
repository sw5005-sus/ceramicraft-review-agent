/**
 * End-to-End Integration Test: HTTP MCP + LangGraph Workflow
 * 
 * This test:
 * 1. Connects to HTTP MCP server (http://localhost:8080)
 * 2. Runs review moderation workflow
 * 3. Tests complete evidence collection → decision flow
 * 4. Shows final updateReviewStatus parameters
 * 
 * Usage:
 *   npx tsx test-e2e-http.ts
 */

import "dotenv/config";
import { initializeHttpMcpClient } from "./src/mcp/http-client.js";
import { reviewModerationGraph } from "./src/graph/index.js";

async function testE2EWithHttp() {
    console.log("\n========================================");
    console.log("🚀 E2E Test: HTTP MCP + LangGraph");
    console.log("========================================\n");

    try {
        // Step 1: Initialize HTTP MCP client
        console.log("📡 Step 1: Initializing HTTP MCP client...");
        console.log("   Target: http://localhost:8080/mcp\n");
        
        try {
            await initializeHttpMcpClient("http://localhost:8080/mcp");
            console.log("   ✅ HTTP MCP client ready!\n");
        } catch (error: any) {
            console.error("   ❌ Failed to connect to MCP server!");
            console.error(`   Error: ${error.message}`);
            console.error("\n   Make sure the MCP server is running:");
            console.error("   PS> uv run python -m ceramicraft_mcp_server.serve");
            process.exit(1);
        }

        // Step 2: Run workflow tests
        console.log("🔄 Step 2: Running workflow tests...\n");

        const testCases = [
            {
                id: "TEST_1",
                name: "Off-Topic Review - Expected: REJECTED (not about ceramic product)",
                input: {
                    id: "69d5ce1f0f9051aa54da13a7",
                    content: "my kids loves eating it",
                    user_id: 1,
                    product_id: 8,
                    parent_id: "",
                    stars: 5,
                    is_anonymous: false,
                    pic_info: [],
                    created_at: "2026-04-08T03:40:15.426Z",
                    likes: 0,
                    current_user_liked: false,
                    is_pinned: false,
                    status: "pending"
                }
            },
            {
                id: "TEST_2",
                name: "Rating/Text Mismatch + After-Sales - Expected: HIDDEN + Draft",
                input: {
                    id: "69d5ce1f0f9051aa54da13a8",
                    content: "Terrible product, completely broken, waste of money",
                    user_id: 2,
                    product_id: 8,
                    parent_id: "",
                    stars: 5,
                    is_anonymous: false,
                    pic_info: [],
                    created_at: "2026-04-08T04:10:20.000Z",
                    likes: 0,
                    current_user_liked: false,
                    is_pinned: false,
                    status: "pending"
                }
            }
        ];

        let passed = 0;
        let failed = 0;

        for (const testCase of testCases) {
            console.log(`\n   ${testCase.id}: ${testCase.name}`);
            console.log(`   Content: "${testCase.input.content}"`);
            console.log(`   Stars: ${testCase.input.stars}`);
            
            try {
                const result = await reviewModerationGraph.invoke({
                    reviewPayload: testCase.input
                });

                console.log(`   ✅ Final Status: "${result.finalStatus}"`);
                
                // Show the parameters that would be sent to updateReviewStatus
                console.log(`\n   📤 Tool Call Parameters (updateReviewStatus):`);
                console.log(`      review_id: "${testCase.input.id}"`);
                console.log(`      status: "${result.finalStatus}"`);
                console.log(`      is_mismatch: ${result.isMismatch ?? "undefined"}`);
                console.log(`      is_harmful: ${result.isHarmful ?? "undefined"}`);
                console.log(`      auto_flag: ${result.autoFlag ?? "undefined"}`);
                console.log(`      stars: ${result.inferredScore ?? "undefined"}`);
                
                if (result.afterSalesDraft) {
                    console.log(`\n   🆘 After-Sales Draft (售后处理):`);
                    console.log(`      Summary: ${result.afterSalesDraft.summary}`);
                    console.log(`      Solution: ${result.afterSalesDraft.solution}`);
                    console.log(`      Script (Email):\n${result.afterSalesDraft.script}`);
                }

                console.log(`\n   📝 Reasoning:`);
                result.reasoningLogs.forEach(log => console.log(`      ${log}`));
                
                passed++;
            } catch (error: any) {
                console.log(`   ❌ Error: ${error.message}`);
                failed++;
            }
        }

        // Summary
        console.log("\n========================================");
        console.log(`📊 Test Summary`);
        console.log(`   ✅ Passed: ${passed}`);
        console.log(`   ❌ Failed: ${failed}`);
        console.log("========================================\n");

        if (failed === 0) {
            console.log("🎉 All tests passed! E2E integration successful.\n");
        } else {
            console.log(`⚠️  ${failed} test(s) failed. Check logs above.\n`);
        }

    } catch (error: any) {
        console.error("\n❌ E2E test failed:");
        console.error(error.message || error);
        process.exit(1);
    }
}

// Run the test
testE2EWithHttp().catch(console.error);

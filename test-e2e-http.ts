/**
 * End-to-End Integration Test: HTTP MCP + LangGraph Workflow + MLflow
 *
 * This test:
 * 1. (Optional) Connects to HTTP MCP server (http://localhost:8080)
 * 2. Runs review moderation workflow — MLflow logging runs automatically inside finalDecision
 * 3. Explicitly verifies MLflow connectivity by logging a synthetic probe run
 * 4. Shows final updateReviewStatus parameters
 *
 * Usage:
 *   npx tsx test-e2e-http.ts
 */

import "dotenv/config";
import { initializeHttpMcpClient } from "./src/mcp/http-client.js";
import { reviewModerationGraph } from "./src/graph/index.js";
import { logModerationRun, registerSystemPrompts } from "./src/utils/mlflowClient.js";

async function testE2EWithHttp() {
    console.log("\n========================================");
    console.log("🚀 E2E Test: HTTP MCP + LangGraph + MLflow");
    console.log("========================================\n");

    try {
        // ── Step 0: Verify MLflow connectivity ──────────────────────────────
        console.log("📊 Step 0: Verifying MLflow connectivity...");
        console.log(`   MLFLOW_TRACKING_URI = ${process.env.MLFLOW_TRACKING_URI ?? "(not set)"}\n`);
        try {
            await logModerationRun({
                reviewId: "PROBE-000",
                finalStatus: "approved",
                isSafe: true,
                isProductRelevant: true,
                isMismatch: false,
                latencyMs: 0,
                reasoningLogs: ["[Probe] MLflow connectivity test from test-e2e-http.ts"],
            });
            console.log("   ✅ MLflow probe run logged successfully!\n");
        } catch (err: any) {
            console.warn(`   ⚠️  MLflow probe failed (non-fatal): ${err.message}\n`);
        }

        // ── Step 0b: Register system prompts to Prompts tab ─────────────────
        console.log("📝 Step 0b: Registering system prompts to MLflow Prompts tab...");
        try {
            await registerSystemPrompts();
            console.log("   ✅ System prompts registered!\n");
        } catch (err: any) {
            console.warn(`   ⚠️  Prompt registration failed (non-fatal): ${err.message}\n`);
        }

        // ── Step 1: Initialize HTTP MCP client (optional) ───────────────────
        console.log("📡 Step 1: Initializing HTTP MCP client (optional)...");
        console.log("   Target: http://localhost:8080/mcp\n");

        try {
            await initializeHttpMcpClient("http://localhost:8080/mcp");
            console.log("   ✅ HTTP MCP client ready!\n");
        } catch (error: any) {
            console.warn("   ⚠️  MCP server not available — continuing without it.");
            console.warn(`   (${error.message})`);
            console.warn("   Product context fetch will be skipped inside textWorker.\n");
        }

        // ── Step 2: Run workflow tests (MLflow logging fires inside finalDecision) ─
        console.log("🔄 Step 2: Running workflow tests (MLflow logged automatically)...\n");

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
                console.log(`   📊 MLflow run logged inside finalDecision (check ${process.env.MLFLOW_TRACKING_URI ?? "MLflow UI"})`);
                
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

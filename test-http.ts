/**
 * Integration Test v2: Test HTTP MCP client connection + Direct tool calls
 * 
 * For when MCP server is ALREADY RUNNING on http://localhost:8080
 * (Not spawning a new server process)
 * 
 * Usage:
 *   npx tsx test-http.ts
 */

import "dotenv/config";
import { 
    initializeHttpMcpClient, 
    listAvailableToolsHttp, 
    checkMcpServerHealth,
    callRemoteToolHttp 
} from "./src/mcp/http-client.js";

async function testHttpIntegration() {
    console.log("\n========================================");
    console.log("🌐 HTTP MCP Client Integration Test");
    console.log("========================================\n");

    try {
        // Step 1: Check server health
        console.log("🏥 Step 1: Checking MCP server health...");
        const isHealthy = await checkMcpServerHealth();
        if (isHealthy) {
            console.log("   ✅ MCP server is healthy\n");
        } else {
            console.log("   ⚠️  MCP server may not be responding\n");
        }

        // Step 2: Initialize HTTP client
        console.log("📡 Step 2: Initializing HTTP MCP client...");
        console.log("   Connecting to: http://localhost:8080/mcp\n");
        
        await initializeHttpMcpClient("http://localhost:8080/mcp");
        console.log("   ✅ HTTP client initialized!\n");

        // Step 3: List available tools
        console.log("📋 Step 3: Fetching available tools...");
        const tools = await listAvailableToolsHttp();
        console.log(`   ✅ Found ${tools.length} tools available\n`);
        
        if (tools.length > 0) {
            console.log("   First 10 tools:");
            tools.slice(0, 10).forEach((tool: any, idx: number) => {
                const name = typeof tool === 'string' ? tool : tool.name || JSON.stringify(tool).substring(0, 50);
                console.log(`     ${idx + 1}. ${name}`);
            });
        }

        // Step 4: Test essential tools
        console.log("\n🧪 Step 4: Testing essential tools...\n");

        // Test 4a: getProduct
        console.log("   Test 4a: Calling getProduct...");
        try {
            const product = await callRemoteToolHttp("get_product", { product_id: 12 });
            console.log("   ✅ getProduct result:", JSON.stringify(product));
        } catch (error: any) {
            console.log(`   ⚠️  getProduct failed (may not be implemented): ${error.message}`);
        }

        // Test 4b: listReviewsByStatus
        console.log("\n   Test 4b: Calling listReviewsByStatus...");
        try {
            const reviews = await callRemoteToolHttp("list_reviews_by_status", { 
                status: "pending"
            });
            console.log("   ✅ listReviewsByStatus result:", JSON.stringify(reviews));
        } catch (error: any) {
            console.log(`   ⚠️  listReviewsByStatus failed: ${error.message}`);
        }

        console.log("\n========================================");
        console.log("✅ HTTP integration test completed!");
        console.log("========================================\n");

        console.log("💡 Next steps:");
        console.log("   1. Run the full workflow test:");
        console.log("      npx tsx test-integration-http-workflow.ts");
        console.log("   2. Or integrate into your LangGraph workflow\n");

    } catch (error: any) {
        console.error("\n❌ HTTP integration test failed:");
        console.error(error.message || error);
        console.error("\n💡 Troubleshooting:");
        console.error("   - Is the MCP server running? Check: http://localhost:8080");
        console.error("   - Try: uv run python -m ceramicraft_mcp_server.serve");
        process.exit(1);
    }
}

// Run the test
testHttpIntegration().catch(console.error);

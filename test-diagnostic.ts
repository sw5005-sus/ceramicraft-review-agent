/**
 * Diagnostic test to check MCP server connectivity
 * Directly tests what endpoints the server has and what they return
 */

import "dotenv/config";

async function diagnosticTest() {
    console.log("\n========================================");
    console.log("🔍 MCP Server Diagnostic Test");
    console.log("========================================\n");

    const baseUrl = "http://localhost:8080";

    // Test 1: Basic HEAD request
    console.log("Test 1: HEAD request to root");
    try {
        const response = await fetch(baseUrl, { method: "HEAD" });
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Headers:`, Object.fromEntries(response.headers.entries()));
    } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`);
    }

    // Test 2: GET request to root
    console.log("\nTest 2: GET request to root");
    try {
        const response = await fetch(baseUrl, { method: "GET" });
        console.log(`   Status: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log(`   Response body (first 200 chars): ${text.substring(0, 200)}`);
    } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`);
    }

    // Test 3: POST request to root (what StreamableHTTP tries)
    console.log("\nTest 3: POST request to root (JSON-RPC initialize)");
    try {
        const payload = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11",
                capabilities: {},
                clientInfo: {
                    name: "diagnostic-client",
                    version: "1.0"
                }
            }
        };

        const response = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Headers:`, Object.fromEntries(response.headers.entries()));
        
        const text = await response.text();
        console.log(`   Response body (first 300 chars): ${text.substring(0, 300)}`);
    } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`);
    }

    // Test 4: Try common alternative paths
    console.log("\nTest 4: Trying alternative paths...");
    const paths = ["/", "/mcp", "/api", "/sse", "/anthropic-mcp", "/streamablehttp"];
    
    for (const path of paths) {
        const fullUrl = `${baseUrl}${path}`;
        try {
            const response = await fetch(fullUrl, { method: "GET" });
            console.log(`   ${fullUrl.padEnd(35)} -> ${response.status}`);
        } catch (error: any) {
            console.log(`   ${fullUrl.padEnd(35)} -> Error: ${error.message.substring(0, 20)}`);
        }
    }

    console.log("\n========================================");
    console.log("📋 Summary:");
    console.log("   Please check the responses above");
    console.log("   Share this diagnostic output with the server AI");
    console.log("========================================\n");
}

diagnosticTest().catch(console.error);

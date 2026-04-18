import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Global MCP client instance
 */
let mcpClient: Client | null = null;
let httpTransport: StreamableHTTPClientTransport | null = null;

/**
 * Initialize HTTP MCP client using Streamable HTTP (SSE + JSON-RPC 2.0)
 * Uses the official MCP SDK StreamableHTTPClientTransport
 * @param mcpUrl - The base URL of the MCP server (e.g., http://localhost:8080/mcp)
 */
const getMcpServerUrl = process.env.MCP_SERVER_URL || "http://localhost:8080/mcp";

export async function initializeHttpMcpClient(mcpUrl: string = getMcpServerUrl): Promise<Client> {
    if (mcpClient) {
        console.log("[HTTP MCP Client] Already connected");
        return mcpClient;
    }

    try {
        console.log(`[HTTP MCP Client] Initializing connection to ${mcpUrl}...`);
        
        // Create StreamableHTTP transport with proper SSE headers
        // Required for Server-Sent Events (SSE) communication
        const url = new URL(mcpUrl);
        httpTransport = new StreamableHTTPClientTransport(url, {
            requestInit: {
                headers: {
                    "Accept": "text/event-stream",
                    "Connection": "keep-alive"
                }
            }
        });

        mcpClient = new Client({
            name: "ecommerce-comment-moderate-client",
            version: "1.0.0"
        }, {
            capabilities: {}
        });

        await mcpClient.connect(httpTransport as any);
        console.log(`[HTTP MCP Client] ✅ Connected to MCP server at ${mcpUrl}`);

        return mcpClient;
    } catch (error: any) {
        console.error(`[HTTP MCP Client] ❌ Failed to connect:`, error.message);
        mcpClient = null;
        httpTransport = null;
        throw error;
    }
}

/**
 * Get the initialized MCP client
 */
export function getMcpClient(): Client {
    if (!mcpClient) {
        throw new Error("[HTTP MCP Client] Client not initialized. Call initializeHttpMcpClient() first.");
    }
    return mcpClient;
}

/**
 * List all available tools from the MCP server
 */
export async function listAvailableToolsHttp(): Promise<any[]> {
    try {
        console.log(`[HTTP MCP Client] Fetching tools list...`);
        const client = getMcpClient();
        const response = await client.listTools();
        const tools = response.tools || [];
        console.log(`[HTTP MCP Client] ✅ Found ${tools.length} tools`);
        return tools;
    } catch (error: any) {
        console.error(`[HTTP MCP Client] Error listing tools:`, error.message);
        throw error;
    }
}

/**
 * Call a tool on the MCP server
 */
export async function callRemoteToolHttp(toolName: string, args: Record<string, any>): Promise<any> {
    try {
        console.log(`[HTTP MCP Client] Calling tool: ${toolName}`);
        let client = getMcpClient();
        
        try {
            const result = await client.callTool({
                name: toolName,
                arguments: args
            });
            console.log(`[HTTP MCP Client] ✅ Tool result:`, JSON.stringify(result).substring(0, 100));
            return result;
            
        } catch (callError: any) {
            if (callError.message && (callError.message.includes("Session not found") || callError.message.includes("fetch failed"))) {
                console.warn(`[HTTP MCP Client] ⚠️ Session lost or server disconnected. Attempting to reconnect...`);
                
                await closeMcpClient();
                
                await initializeHttpMcpClient();
                
                client = getMcpClient();
                console.log(`[HTTP MCP Client] 🔄 Reconnection successful. Retrying tool call: ${toolName}...`);
                const retryResult = await client.callTool({
                    name: toolName,
                    arguments: args
                });
                console.log(`[HTTP MCP Client] ✅ Tool result after retry:`, JSON.stringify(retryResult).substring(0, 100));
                return retryResult;
            }
            
            throw callError;
        }
    } catch (error: any) {
        console.error(`[HTTP MCP Client] Error calling tool ${toolName}:`, error.message);
        throw error;
    }
}

/**
 * Check if MCP server is running and healthy
 */
export async function checkMcpServerHealth(): Promise<boolean> {
    try {
        const response = await fetch(getMcpServerUrl, {
            method: "HEAD"
        });
        // 406 is expected for HEAD requests to SSE endpoint, means server is there
        return response.status === 200 || response.status === 406;
    } catch {
        return false;
    }
}

/**
 * Close the MCP client connection
 */
export async function closeMcpClient(): Promise<void> {
    if (mcpClient) {
        await mcpClient.close();
        mcpClient = null;
    }
    if (httpTransport) {
        await httpTransport.close();
        httpTransport = null;
    }
    console.log("[HTTP MCP Client] ✅ Connection closed");
}

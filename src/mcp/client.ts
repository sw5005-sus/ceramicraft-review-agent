import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP Client singleton for calling remote CeramiCraft backend tools
 * Connects to the remote MCP server via stdio transport
 */

let client: Client | null = null;
let transport: StdioClientTransport | null = null;

/**
 * Initialize the MCP client connection
 * @param serverCommand - The command to spawn the MCP server (e.g., "python -m ceramicraft_mcp_server.serve")
 * @param serverArgs - Optional arguments to pass to the server command
 */
export async function initializeMcpClient(serverCommand: string, serverArgs?: string[]): Promise<Client> {
    if (client) {
        console.log("[MCP Client] Already connected");
        return client;
    }

    console.log("[MCP Client] Initializing connection to remote MCP server...");
    
    // Create stdio transport to communicate with the remote server
    transport = new StdioClientTransport({
        command: serverCommand,
        args: serverArgs || []
    });

    // Create client and connect
    client = new Client({
        name: "ecommerce-comment-moderate-client",
        version: "1.0.0"
    }, {
        capabilities: {}
    });

    await client.connect(transport);
    console.log("[MCP Client] Successfully connected to remote MCP server");

    return client;
}

/**
 * Get the initialized MCP client (must call initializeMcpClient first)
 */
export function getMcpClient(): Client {
    if (!client) {
        throw new Error("[MCP Client] Client not initialized. Call initializeMcpClient() first.");
    }
    return client;
}

/**
 * List all available tools from the remote server
 */
export async function listAvailableTools(): Promise<Tool[]> {
    const client = getMcpClient();
    const response = await client.listTools();
    return response.tools;
}

/**
 * Call a tool on the remote MCP server with error handling
 * @param toolName - The name of the tool to call
 * @param args - The arguments for the tool
 * @returns The tool result
 */
export async function callRemoteTool(toolName: string, args: Record<string, any>): Promise<any> {
    try {
        const client = getMcpClient();
        
        console.log(`[MCP Client] Calling tool: ${toolName}`, JSON.stringify(args, null, 2));
        
        const result = await client.callTool({
            name: toolName,
            arguments: args
        });

        if (result.isError) {
            const contentArray = (result.content as any[]) || [];
            throw new Error(`Tool error: ${contentArray[0]?.text || "Unknown error"}`);
        }

        // Extract text content from the response
        const contentArray = (result.content as any[]) || [];
        const content = contentArray[0];
        if (content.type === "text") {
            try {
                return JSON.parse(content.text);
            } catch {
                return content.text;
            }
        }

        return result.content;
    } catch (error: any) {
        console.error(`[MCP Client] Error calling tool ${toolName}:`, error.message);
        throw error;
    }
}

/**
 * Gracefully close the MCP client connection
 */
export async function closeMcpClient(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
    }
    if (transport) {
        transport = null;
    }
    console.log("[MCP Client] Connection closed");
}

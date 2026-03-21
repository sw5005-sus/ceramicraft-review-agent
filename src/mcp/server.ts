import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod"; // SDK uses Zod for input validation
import { reviewModerationGraph } from "../graph/index.js";

// Create MCP Server instance
const server = new McpServer({ 
  name: "ecommerce-review-graph", 
  version: "1.0.0" 
});

server.registerTool(
  "moderate_review",
  {
    title: "Moderate review",
    description: "Orchestrates a multi-agent workflow to moderate e-commerce reviews.",
    // 使用 Zod 的 object schema 作为 inputSchema（推荐）
    // Use a Zod object schema for input (recommended)
    inputSchema: z.object({
      text: z.string().describe("Review text"),
      rating: z.number().optional().describe("Numerical rating (if provided)"),
      imageUrl: z.string().optional().describe("URL of uploaded image (if any)")
    })
  },
  async (args) => {
    // registerTool 回调接收解析后的 args（由 Zod 校验过）
    const { text, rating, imageUrl } = args as { text: string; rating?: number; imageUrl?: string };
    const payload = { text, rating, imageUrl };
    console.log("Received moderation task from host:", payload);

    // Invoke the LangGraph workflow
    const finalState = await reviewModerationGraph.invoke({ reviewPayload: payload });

    // 将 Graph 的最终状态作为工具的返回值，丢回给 Python 端
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: finalState.finalStatus,
          flag: finalState.autoFlag,
          logs: finalState.reasoningLogs
        }, null, 2)
      }]
    };
  }
);

// 启动基于标准输入输出的传输层 (跨语言通信利器)
export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("MCP Server running on stdio");
}
# MCP Client Configuration Guide

## Environment Variables

Create a `.env` file in the project root with the following variables:

```bash
# Moonshot API Key (for LLM inference)
MOONSHOT_API_KEY=sk-xxxxx

# MCP Server Connection
# The command to start the remote CeramiCraft MCP server
# This is usually a Python command that starts the server
MCP_SERVER_COMMAND=python

# Arguments to pass to the server command
# Must be valid JSON array format
MCP_SERVER_ARGS=["- m", "ceramicraft_mcp_server.serve"]

# OAuth / Authentication (optional)
# If using Zitadel JWT tokens, store them here (for testing)
ZITADEL_JWT_TOKEN=your_jwt_token_here

# Backend URLs (used by the MCP server internally)
MCP_ZITADEL_ISSUER=https://your-zitadel-instance.com
MCP_ZITADEL_JWKS_URL=https://your-zitadel-instance.com/.well-known/jwks.json
```

## Usage Example

```typescript
import { initializeMcpClient, listProductReviews, updateReviewStatus } from "./mcp/index.js";
import { reviewModerationGraph } from "./graph/index.js";

async function main() {
    // Initialize MCP client
    await initializeMcpClient(
        process.env.MCP_SERVER_COMMAND || "python",
        process.env.MCP_SERVER_ARGS ? JSON.parse(process.env.MCP_SERVER_ARGS) : []
    );

    // Run moderation workflow
    const reviewData = {
        text: "This product is amazing!",
        rating: 5,
        reviewId: "review_123",
        productId: "prod_456",
        userId: "user_789",
        userJwtToken: process.env.ZITADEL_JWT_TOKEN
    };

    const result = await reviewModerationGraph.invoke({ reviewPayload: reviewData });
    console.log(result);
}

main().catch(console.error);
```

## Architecture

```
Your LangGraph Agent
        ↓
    MCP Client (Node.js/TypeScript)
        ↓ (Stdio transport)
    Remote MCP Server (Python)
        ↓ (HTTP)
    Backend Microservices (product-ms, comment-ms, order-ms, etc.)
```

## Key Integration Points

### 1. **Text Worker** (`textWorkerEnhanced.ts`)
- Fetches product details via `getProduct()`
- Fetches similar reviews via `listProductReviews()`
- Uses context for better LLM analysis

### 2. **Supervisor** (`supervisorEnhanced.ts`)
- Fetches user history via `getUserReviews()`
- Detects repeat spammers or manipulators
-Based on pattern analysis

### 3. **Final Decision** (`finalDecisionEnhanced.ts`)
- Persists decisions via `updateReviewStatus()`
- Sends merchant responses via `replyToReview()`
- All moderation outcomes recorded in backend

## Tool Availability

The following tools are currently wrapped in `src/mcp/tools.ts`:

**Product Tools:**
- `getProduct()` - Get product details
- `searchProducts()` - Search by keyword

**Review Tools:**
- `listProductReviews()` - Get product reviews
- `getUserReviews()` - Get user's review history
- `listReviewsByStatus()` - List reviews by moderation status
- `updateReviewStatus()` - Persist moderation decision
- `deleteReview()` - Delete a review
- `replyToReview()` - Send merchant response

**User Tools:**
- `getUserProfile()` - Get user profile info

**Order Tools:**
- `getOrderDetail()` - Get order details
- `listMyOrders()` - List user's orders

See `src/mcp/tools.ts` for complete function signatures.

## Error Handling

All tool calls include error handling:
- Network errors are logged and workflows continue (graceful degradation)
- Failed tool calls don't stop the moderation process
- Decisions can be made without external context if needed

## Authentication

The MCP server handles authentication via Zitadel JWT tokens:
- Pass `jwtToken` parameter to functions that need authentication
- The backend extracts user identity from JWT claims
- Some tools require specific roles (e.g., `merchant_admin` for admin operations)

For testing without full Zitadel setup, you can mock requests or skip authenticated calls.

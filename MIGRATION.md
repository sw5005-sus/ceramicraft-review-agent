# MCP Tool Integration for ecommerce-review-graph

This guide explains the MCP (Model Context Protocol) client integration for your e-commerce review moderation agent.

## What's New

Your project now has the ability to:
1. **Connect to remote MCP server** - Call 43+ tools from the CeramiCraft backend
2. **Fetch contextual data** - Product details, user history, similar reviews
3. **Persist decisions** - Write moderation outcomes back to the backend
4. **Send merchant responses** - Auto-reply to reviews with customer service solutions

## File Structure

### New Files Created

```
src/mcp/
├── client.ts                 # MCP client connection management
├── tools.ts                  # Wrapped tool functions for easy use
└── index.ts                  # Module exports

src/graph/nodes/
├── textWorkerEnhanced.ts     # Text analysis with product context
├── supervisorEnhanced.ts     # Triage with user history analysis
└── finalDecisionEnhanced.ts  # Decision persistence to backend

Root:
├── MCP_INTEGRATION_GUIDE.md  # Detailed setup & usage guide
└── MIGRATION.md              # This file
```

## How to Use

### Option 1: Replace Existing Nodes (Clean Integration)

Update `src/graph/index.ts` to use enhanced nodes:

```typescript
import { supervisorNode } from "./nodes/supervisorEnhanced.js";
import { textWorkerNode } from "./nodes/textWorkerEnhanced.js";
import { finalDecisionNode } from "./nodes/finalDecisionEnhanced.js";

// ... rest of the workflow setup remains the same
```

### Option 2: Keep Existing Nodes (Gradual Migration)

Your original nodes work fine without MCP. Use enhanced nodes only where needed:
- Keep `textWorker.ts` for basic text analysis
- Add `supervisorEnhanced.ts` for spam detection with user history
- Add `finalDecisionEnhanced.ts` to persist decisions

### Option 3: Switch Based on Configuration

```typescript
const useMcpIntegration = process.env.USE_MCP_INTEGRATION === "true";

const supervisorNode = useMcpIntegration 
    ? supervisorEnhancedNode 
    : supervisorBasicNode;

const textWorkerNode = useMcpIntegration
    ? textWorkerEnhancedNode
    : textWorkerBasicNode;
```

## Quick Start

1. **Install dependencies** (already in package.json):
   ```bash
   npm install
   ```

2. **Configure environment** (`.env`):
   ```bash
   MOONSHOT_API_KEY=sk-xxxxx
   MCP_SERVER_COMMAND=python
   MCP_SERVER_ARGS=["- m", "ceramicraft_mcp_server.serve"]
   ```

3. **Initialize MCP client** in your main entry point:
   ```typescript
   import { initializeMcpClient } from "./mcp/index.js";
   
   await initializeMcpClient("python", ["-m", "ceramicraft_mcp_server.serve"]);
   ```

4. **Run moderation**:
   ```typescript
   import { runModerationWithMCP } from "./integration.js";
   
   const result = await runModerationWithMCP({
       text: "Amazing product!",
       rating: 5,
       reviewId: "rev_123",
       productId: "prod_456",
       userId: "user_789",
       userJwtToken: "jwt_token_here"
   });
   ```

## Features & Benefits

### Text Worker Enhancements
- ✅ Fetches product details for context
- ✅ Retrieves similar reviews for comparison
- ✅ Better LLM analysis with background knowledge
- ✅ Graceful degradation if context fetch fails

### Supervisor Enhancements  
- ✅ Analyzes user review history
- ✅ Detects repeat spammers or manipulators
- ✅ Patterns like "always 1 star" are flagged
- ✅ Fallback to basic triage if history unavailable

### Final Decision Enhancements
- ✅ Persists moderation decision to backend
- ✅ Updates review status (approved/rejected/pending)
- ✅ Sends professional merchant responses
- ✅ Marks mismatches and harmful content flags
- ✅ Non-critical persistence errors don't block workflow

## Input Payload Format

Enhanced node-compatible review payload:

```typescript
{
    text: string;              // Required: Review text
    rating?: number;           // Optional: Star rating (1-5)
    imageUrl?: string;         // Optional: Review image URL
    
    // MCP Integration fields
    reviewId?: string;         // For backend persistence
    productId?: string;        // For context fetching
    userId?: string;           // For history analysis
    userJwtToken?: string;     // For authenticated MCP calls
}
```

## Available Tools in ./mcp/tools.ts

### Product
- `getProduct(productId, jwtToken?)` - Get product details
- `searchProducts(keyword, jwtToken?)` - Search products

### Reviews  
- `listProductReviews(productId, jwtToken?, limit, offset)` - Get product reviews
- `getUserReviews(jwtToken, limit, offset)` - Get user's reviews
- `listReviewsByStatus(status, limit, offset)` - List by moderation status
- `updateReviewStatus(reviewId, status, isMismatch?, isHarmful?, autoFlag?)` - Update status
- `deleteReview(reviewId, jwtToken, reason?)` - Delete review
- `replyToReview(reviewId, replyText, jwtToken)` - Send merchant response

### User
- `getUserProfile(jwtToken)` - Get user info

### Orders
- `getOrderDetail(orderNumber, jwtToken)` - Get order details
- `listMyOrders(jwtToken, limit, offset)` - List user's orders

## Fallback & Error Handling

All MCP tool calls are wrapped with error handling:
- Network failures don't crash the workflow
- Missing tool calls degrade gracefully
- Moderation proceeds even if backend is unreachable
- Errors are logged in `reasoningLogs` for debugging

Example scenario:
- Backend unavailable → Basic LLM analysis still runs
- Product fetch fails → Text analysis continues without context
- User history unavailable → Supervisor proceeds with basic triage
- No JWT token → Public tools still work

## Performance Considerations

1. **Parallel Worker Execution**: Text, Vision, and Imputation workers run in parallel
2. **Tool Calls**: Product/review/user fetches happen in parallel where possible
3. **Timeout Handling**: Configure reasonable timeouts for tool calls
4. **Caching**: Consider caching product/user data if same products reviewed repeatedly

## Troubleshooting

### "Client not initialized" Error
```typescript
// Make sure to call this first
await initializeMcpClient("python", ["-m", "ceramicraft_mcp_server.serve"]);
```

### JWT Token Not Working
- Verify Zitadel configuration on the backend
- Check token hasn't expired
- Confirm user has required roles for the operation

### Tool Not Found Error
- Verify remote MCP server is running
- Check tool name matches exactly (case-sensitive)
- Run `listAvailableTools()` to see what's available

### Context Fetch Failures
- These are non-critical and logged
- Workflow continues without that context
- Check network connectivity to backend

## Next Steps

1. Replace original nodes with enhanced versions
2. Test with local MCP server
3. Configure proper JWT token flow from Zitadel
4. Add more tools as needed (currently ~20 of 43 are wrapped)
5. Implement caching for frequently accessed data
6. Add monitoring/alerting for MCP tool performance

## Architecture Diagram

```
Review Incoming
      ↓
   Supervisor (enhanced)
   ├─ Fetch user review history via getUserReviews()
   ├─ Detect repeat spammers
   └─ Route to workers or short-circuit
      ↓
   [Workers] (parallel execution)
   ├─ TextWorker (enhanced)
   │  ├─ getProduct()
   │  ├─ listProductReviews()
   │  └─ LLM analysis
   │
   ├─ VisionWorker
   │  └─ Image analysis
   │
   └─ ImputationWorker
      └─ Infer missing rating
      ↓
   FinalDecision (enhanced)
   ├─ Synthesize all evidence
   ├─ updateReviewStatus()  → Backend
   ├─ replyToReview()       → Backend  
   └─ Return approved/rejected/pending_review
```

## Contributing

When adding new MCP tools:

1. Add the tool wrapper in `src/mcp/tools.ts`
2. Export from `src/mcp/index.ts`
3. Use in appropriate worker node
4. Add error handling
5. Document in this guide

---

For detailed MCP server documentation, see [MCP_INTEGRATION_GUIDE.md](./MCP_INTEGRATION_GUIDE.md)

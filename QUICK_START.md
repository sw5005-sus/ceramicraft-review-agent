# Quick Start Guide - MCP Tool Integration

> **Time to Integration: 5-10 minutes** ⚡

## 1️⃣ Configuration (2 minutes)

### Create `.env` file in project root:
```bash
# Required
MOONSHOT_API_KEY=sk-your-api-key

# MCP Server connection
MCP_SERVER_COMMAND=python
MCP_SERVER_ARGS=["- m", "ceramicraft_mcp_server.serve"]

# Optional but recommended
ZITADEL_JWT_TOKEN=your_jwt_token
```

## 2️⃣ Choose Integration Method (1 minute)

### Option A: Use Enhanced Nodes (Recommended)
Replace nodes in `src/graph/index.ts`:
```typescript
// Before
import { textWorkerNode } from "./nodes/textWorker.js";
import { supervisorNode } from "./nodes/supervisor.js";
import { finalDecisionNode } from "./nodes/finalDecision.js";

// After
import { textWorkerNode } from "./nodes/textWorkerEnhanced.js";
import { supervisorNode } from "./nodes/supervisorEnhanced.js";
import { finalDecisionNode } from "./nodes/finalDecisionEnhanced.js";
```

### Option B: Keep Original Nodes
No changes needed - everything works independently.

## 3️⃣ Initialize MCP Client (1 minute)

In your main entry point:
```typescript
import { initializeMcpClient } from "./mcp/index.js";

// Before first review
await initializeMcpClient(
    process.env.MCP_SERVER_COMMAND || "python",
    process.env.MCP_SERVER_ARGS ? JSON.parse(process.env.MCP_SERVER_ARGS) : []
);
```

## 4️⃣ Update Review Payload (1 minute)

Add MCP context fields when creating reviews:
```typescript
const reviewData = {
    // Existing fields
    text: "Amazing product!",
    rating: 5,
    
    // Add these for MCP integration
    reviewId: "rev_123",      // For persistence
    productId: "prod_456",    // For context
    userId: "user_789",       // For history
    userJwtToken: "jwt_..."   // For auth
};

const result = await reviewModerationGraph.invoke({ 
    reviewPayload: reviewData 
});
```

## 5️⃣ Run & Test (1 minute)

### Run without MCP (no server needed):
```bash
npx ts-node src/examples.ts 1
```

### Run with full MCP integration:
```bash
# Terminal 1: Start MCP server
python -m ceramicraft_mcp_server.serve

# Terminal 2: Run examples
npx ts-node src/examples.ts 2
```

### Run batch processing:
```bash
npx ts-node src/examples.ts 3
```

## ✅ Verification

You should see output like:
```
[MCP Client] Successfully connected to remote MCP server
[Graph] Starting moderation workflow...
[Text Worker] Fetching product details...
[Supervisor] Fetching review history...
[Graph] Moderation complete!
[Final Decision] Successfully updated review status in backend
```

## 🎯 What Each Tool Does

### Product Context (Text Worker)
```typescript
// Gets product info for context
const product = await getProduct(productId);  
// Result: {name, category, price, rating, stock, ...}
```

### User History (Supervisor)
```typescript
// Gets user's past reviews to detect patterns
const history = await getUserReviews(jwtToken, limit=5);
// Result: {reviews: [...], total_count}
```

### Persistence (Final Decision)
```typescript
// Saves moderation decision
await updateReviewStatus(reviewId, status, flags...);
// Status: "approved" | "rejected" | "pending"

// Send merchant reply if needed
await replyToReview(reviewId, message, jwtToken);
```

## 🔍 Debugging

### Check MCP client initialized:
```typescript
import { getMcpClient } from "./mcp/index.js";
const client = getMcpClient(); // Throws if not initialized
```

### List available tools:
```typescript
import { listAvailableTools } from "./mcp/index.js";
const tools = await listAvailableTools();
console.log(tools.map(t => t.name));
```

### Enable verbose logging:
```bash
export LOG_LEVEL=debug
# or in .env
LOG_LEVEL=debug
```

## 📊 Expected Performance

| Operation | Time |
|-----------|------|
| Initialize client | ~100ms |
| Review moderation (no MCP) | ~500ms |
| + Product context | ~1s |
| + User history | ~1.5s |
| Full integration | ~2s |

## 🚨 Common Issues

### "Client not initialized"
```typescript
// ✓ Call this first
await initializeMcpClient(...)
```

### MCP Server not running
```bash
# Start it first
python -m ceramicraft_mcp_server.serve
```

### JWT token errors
- Verify token from Zitadel
- Check it hasn't expired
- Confirm user has required roles

### Module not found errors
```bash
# Reinstall dependencies
npm install
npm run build  # if needed
```

## 📚 Next Steps

1. ✅ Follow Quick Start above
2. 📖 Read `MCP_INTEGRATION_GUIDE.md` for details
3. 🔧 Check `MIGRATION.md` for advanced setup
4. 🧪 Run examples to verify everything works
5. 🚀 Deploy to production

## 🎓 Learn More

### Architecture
See diagram in `IMPLEMENTATION_SUMMARY.md`

### All Available Tools
See tool catalog in `MCP_INTEGRATION_GUIDE.md`

### Examples & Patterns
See `src/examples.ts` for 4 complete examples

### Configuration Options
See `.env.example` for all variables

## 💡 Pro Tips

1. **No JWT token?** Public tools still work (product search, etc.)
2. **MCP unavailable?** Workflow continues with LLM-only analysis
3. **Want to add tools?** Edit `src/mcp/tools.ts` - very simple
4. **Performance issues?** Run review analysis in parallel

## ⚡ Minimal Example

```typescript
import { initializeMcpClient } from "./mcp/index.js";
import { reviewModerationGraph } from "./graph/index.js";

// 1. Init
await initializeMcpClient("python", ["-m", "ceramicraft_mcp_server.serve"]);

// 2. Run
const result = await reviewModerationGraph.invoke({
    reviewPayload: {
        text: "Great product!",
        rating: 5,
        reviewId: "rev_123",
        productId: "prod_456"
    }
});

// 3. Done!
console.log(result.finalStatus); // "approved"
```

---

**Questions?** Check the documentation files or examples:
- `MCP_INTEGRATION_GUIDE.md` - Full reference
- `MIGRATION.md` - Integration details
- `src/examples.ts` - Working code
- `CHECKLIST.md` - Status & roadmap

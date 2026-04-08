# 联调指南

## 📌 重要：MCP Server 连接方式

**你的服务器已在运行：** ✅
```
PS C:\H\ceramicraft-mcp-server> uv run python -m ceramicraft_mcp_server.serve
INFO:     Uvicorn running on http://0.0.0.0:8080
```

所以我们使用 **HTTP 方式** 连接，不需要生成新进程。

---

## 架构概览

```
┌─────────────────────────────────────────┐
│  Node.js LangGraph Workflow             │
│  (Review Moderation Graph)              │
└────────────┬────────────────────────────┘
             │ HTTP Client (axios)
             │ to http://localhost:8080
             ▼
┌─────────────────────────────────────────┐
│  Python MCP Server (Already Running!)   │
│  ✅ Running on http://0.0.0.0:8080      │
│  - getProduct                           │
│  - listReviewsByStatus                  │
│  - updateReviewStatus                   │
│  - getUserReviews                       │
│  - ... 40+ more tools                   │
└─────────────────────────────────────────┘
```

---

## 🚀 快速联调

### Step 1: 验证 MCP Server 正在运行

确保你的 server 仍在运行：
```bash
# 你的终端应该显示
PS C:\H\ceramicraft-mcp-server> uv run python -m ceramicraft_mcp_server.serve
INFO:     Uvicorn running on http://0.0.0.0:8080
```

### Step 2: 测试 HTTP 连接

```bash
cd c:\H\ecommerce-comment-moderate
npx tsx test-http.ts
```

**预期输出：**
```
========================================
🌐 HTTP MCP Client Integration Test
========================================

🏥 Step 1: Checking MCP server health...
   ✅ MCP server is healthy

📡 Step 2: Initializing HTTP MCP client...
   Connecting to: http://localhost:8080
   ✅ HTTP client initialized!

📋 Step 3: Fetching available tools...
   ✅ Found 40+ tools available
```

### Step 3: 运行端到端工作流测试

```bash
npx tsx test-e2e-http.ts
```

**预期输出：**
```
========================================
🚀 E2E Test: HTTP MCP + LangGraph
========================================

📡 Step 1: Initializing HTTP MCP client...
   ✅ HTTP MCP client ready!

🔄 Step 2: Running workflow tests...

   TEST_1: Normal Review (Expected: APPROVED)
   ✅ Result: finalStatus = "approved"
   
   TEST_2: Spam/Risk (Expected: REJECTED)
   ✅ Result: finalStatus = "rejected"
   
   TEST_3: After-Sales Request (Expected: PENDING_REVIEW)
   ✅ Result: finalStatus = "pending_review"
```

---

## 📋 核心测试场景

### Scenario 1: 正常评论
```json
{
    "text": "Great product! Good quality and fast delivery.",
    "rating": 5,
    "productId": "PROD_001"
}
```
**预期结果：** 
- `finalStatus = "approved"`
- 所有证据通过检查

### Scenario 2: 垃圾/高风险
```json
{
    "text": "asdfghjkl kiill everyone SCAM"
}
```
**预期结果：**
- `finalStatus = "rejected"`
- `autoFlag = "supervisor_rejected"`
- **短路**（跳过所有 worker，直接到 Final Decision）

### Scenario 3: 售后请求
```json
{
    "text": "Item damaged! I need refund or replacement",
    "rating": 1
}
```
**预期结果：**
- `finalStatus = "pending_review"`
- `afterSalesDraft` 包含问题摘要和建议方案
- 人工审核队列需要处理

### Scenario 4: 评分/文本不匹配
```json
{
    "text": "Horrible product, waste of money",
    "rating": 5
}
```
**预期结果：**
- `finalStatus = "pending_review"`
- 标记为可疑（用户可能被压制的评论）

---

## 🔄 完整工作流走向

```
START
  ↓
📋 Supervisor Node
  ├─ 语义分诊 (垃圾/高风险检测)
  ├─ 可选: 获取用户历史 (需 JWT)
  └─ 返回: autoFlag 路由标志
  ↓
[autoFlag = "supervisor_rejected"?]
  ├─ YES → 短路直接到 Final Decision ⚡
  └─ NO → 并行执行所有 Workers 🔀
  ↓
🎯 Parallel Workers (同时运行)
  ├─ 📝 Text Worker
  │  ├─ 调用 getProduct() 检查相关性
  │  ├─ 分析文本安全性
  │  ├─ 检查评分/文本一致性
  │  └─ 识别售后需求
  ├─ 👁️ Vision Worker (条件)
  │  ├─ 处理 imageUrls[] 数组
  │  └─ 逐个用 vision LLM 分析
  └─ 🔢 Imputation Worker (条件)
     └─ 推测缺失的评分
  ↓
📊 Final Decision Node
  ├─ 聚合所有证据
  ├─ 应用决策规则
  ├─ 调用 updateReviewStatus() 持久化
  └─ 返回: finalStatus + logs
  ↓
END
```

---

## 📂 新增文件说明

| 文件 | 用途 |
|------|------|
| `src/mcp/http-client.ts` | HTTP 版本的 MCP 客户端（使用 axios） |
| `src/mcp/tools-http.ts` | HTTP 版本的工具包装器 |
| `test-http.ts` | 简单 HTTP 连接测试 |
| `test-e2e-http.ts` | 端到端工作流测试 ✨ |

---

## 🧪 逐项调试命令

```bash
# 1. 测试 HTTP 连接
npx tsx test-http.ts

# 2. 测试单个工具（需要自己编写）
npx tsx -e "
import { callRemoteToolHttp } from './src/mcp/http-client.js';

const result = await callRemoteToolHttp('list_reviews_by_status', {
  status: 'pending',
  limit: 5
});

console.log(result);
"

# 3. 运行完整 E2E
npx tsx test-e2e-http.ts

# 4. 编译检查
npm run build
```

---

## 🚨 问题排查

### 问题：连接超时
```
Error: Cannot connect to MCP server at http://localhost:8080
```

**解决**：
1. 确保 MCP server 仍在运行
2. 尝试浏览器访问：http://localhost:8080/tools
3. 重启 server：`uv run python -m ceramicraft_mcp_server.serve`

### 问题：工具调用返回 404
```
Error: 404 Not Found - Tool not found
```

**解决**：
1. 列出可用工具：`npx tsx test-http.ts`
2. 检查工具名称是否正确
3. 检查请求参数格式

### 问题：Port 8080 already in use
```
OSError: [WinError 10048] Only one usage of each socket address
```

**解决**：
1. 关闭现有 server：`Ctrl+C`
2. 检查占用端口的进程：`netstat -ano | findstr 8080`
3. 重新启动 server

---

## ✅ 联调清单

- [ ] MCP server 在 http://0.0.0.0:8080 运行
- [ ] 环境变量 `MOONSHOT_API_KEY` 已设置
- [ ] 运行 `npm run build` 无错误
- [ ] `npx tsx test-http.ts` 连接成功
- [ ] `npx tsx test-e2e-http.ts` 所有场景通过
- [ ] 检查 reasoning logs 是否包含完整证据链
- [ ] 验证 autoFlag 路由逻辑

---

## 📖 下一步

✅ 联调完成后，可以：

1. **集成到 HTTP API**
   - 构建 Express/Fastify 服务器
   - 暴露 `/moderate-review` 端点

2. **持久化结果**
   - 保存决策到 MongoDB/PostgreSQL
   - 跟踪处理历史

3. **监控和告警**
   - 记录模型延迟
   - 监测错误率
   - 告警审核队列堆积

4. **性能优化**
   - 并发批处理
   - 缓存产品信息
   - 异步回调




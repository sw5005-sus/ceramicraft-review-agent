# 🛡️ Review Moderation Agent

A standalone, AI-driven backend microservice designed to autonomously moderate user-generated product reviews. Built with **LangGraph.js** and the **Model Context Protocol (MCP)**, this agent ensures content safety, evaluates multimodal relevance, detects after-sales intent, and intelligently imputes missing ratings through a highly deterministic batch-processing workflow.

## 📖 Overview

This agent operates under a strict "hidden until approved" policy. Triggered via a scheduled endpoint, it processes pending reviews using a directed graph state machine. To maintain a Zero-Trust architecture, **the agent does not directly connect to any database**. Instead, it utilizes an external MCP Server as a secure gateway to execute downstream state mutations and fetch contextual data.

## ✨ Key Features

*   **🛡️ Prompt Injection Defense**: Features a Regex-based Supervisor node that short-circuits adversarial inputs (e.g., *"ignore previous instructions"*) before they reach the LLM, saving compute and ensuring security.
*   **🔀 Parallel Multimodal Reasoning**: Utilizes LangGraph to concurrently execute specialized workers (Text Analysis, Vision/Image Analysis, and Score Imputation).
*   **🧠 Intelligent Score Imputation**: Uses dynamic few-shot prompting to accurately infer and bridge missing 0-star ratings based on user-specific communication styles.
*   **📧 Autonomous After-Sales Support**: Detects refund/complaint intents and automatically drafts actionable customer service emails based on the review context.
*   **🔒 Zero-Trust Tooling via MCP**: Acts as an MCP client. All external actions (fetching products, updating review statuses) are securely proxied to an external MCP server, keeping the LLM entirely decoupled from database credentials.
*   **🚦 Human-in-the-Loop (HITL)**: Deterministic fallback mechanisms automatically hide reviews and escalate them to human administrators if the aggregated confidence score is low or if conflicting evidence is found.

## 🛠️ Tech Stack

*   **Core Environment**: Node.js, TypeScript, Express (API triggering)
*   **AI Orchestration**: [LangGraph.js](https://github.com/langchain-ai/langgraphjs)
*   **Tooling Protocol**: [Model Context Protocol (MCP) SDK](https://modelcontextprotocol.io/) (HTTP SSE Client)
*   **LLMs**: 
    *   `kimi-k2-0711-preview` (Text reasoning & routing)
    *   `moonshot-v1-8k-vision-preview` (Image safety & relevance)
*   **Observability & Prompt Registry**: MLflow
*   **Testing & DevSecOps**: Vitest, Promptfoo, Zod, Snyk, SonarQube

## 📂 Project Structure

```text
.
├── .github/workflows/       # DevSecOps pipelines (CI/CD, Promptfoo, Snyk, SonarQube)
├── eval-datasets/           # Promptfoo test cases & adversarial payloads
├── src/
│   ├── graph/               # LangGraph state definitions and orchestrator nodes
│   │   ├── nodes/           # Supervisor, parallel workers, and finalDecision logic
│   │   └── state.ts         # GraphState schema definition
│   ├── mcp/                 # MCP client and tool definitions (proxying external services)
│   │   ├── client.ts        # SSE Connection logic
│   │   └── tools.ts         # Tool schemas mapped to the external MCP Server
│   ├── prompts/             # Prompt template catalog
│   └── utils/               # MLflow client, LLM factory, and shared utilities
├── tests/                   # Vitest unit test suites
├── Dockerfile               # Containerization config
└── package.json
```
## 🚀 Getting Started

### Prerequisites
*   Node.js (v18 or higher)
*   Docker (Optional, for containerized deployment)
*   An external MCP Server running (to handle database and service tool execution)

### 1. Environment Setup
Copy the example environment file and configure your API keys:

```bash
cp .env.example .env
```

### 2. Installation
Install the project dependencies:
```bash
npm install
```

### 3. Running the Agent (Development)
Start the Express server to listen for task triggers:
```bash
npm run dev
```
Note: To manually trigger a batch processing run, send a POST request to the exposed moderation endpoint (e.g., POST /api/v1/moderate/run).

## 🧪 Testing and Evaluation
This project enforces strict deterministic and probabilistic testing to ensure AI reliability.

### Run Unit Tests (Vitest)
Validates deterministic graph routing, supervisor short-circuiting, and edge-case fallbacks without consuming LLM tokens.
```bash
npm run test
# For coverage report:
npm run test:coverage
```
### Run LLM Evaluations (Promptfoo)
Executes systematic red-teaming and semantic regression tests against the LangGraph node prompts.
```bash
npm run promptfoo:eval
```
### 📊 Observability (MLflow)
The agent integrates deeply with MLflow. Once a moderation cycle completes, you can view the execution traces, latency, token usage, and custom metrics (such as confidence_score and is_image_relevant) in your MLflow dashboard.
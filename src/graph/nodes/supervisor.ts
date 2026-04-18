import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ReviewGraphState, type SpanRecord } from "../state.js";
import { createLLMFromPromptConfig } from "../../utils/llmFactory.js";
import { globalTokenTracker } from "../../utils/llmFactory.js";
import { STANDARD_SUPERVISOR_PROMPT } from "../../prompts/catalog.js";

const llm = createLLMFromPromptConfig(STANDARD_SUPERVISOR_PROMPT.modelConfig);

// Pre-LLM Input Sanitization: Detect common prompt injection patterns
const INJECTION_PATTERNS = [
  /ignore\s+(previous|prior|above)\s+instructions?/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*/i,
  /\[INST\]|\<\|system\|\>/i,
  /disregard\s+(your\s+)?(rules|guidelines)/i,
  /forget\s+(all\s+)?(previous|prior|above)\s+/i,
  /override\s+(your\s+)?.*?instructions/i,
];

function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

export const supervisorNode = async (state: typeof ReviewGraphState.State) => {
    // Reset token tracker at the start of every new graph execution (supervisor is always first).
    globalTokenTracker.reset();
    console.log("Supervisor: Conducting semantic triage and routing...");
    
    // Support both field name conventions (content from real API, text from test)
    const text = state.reviewPayload?.content || state.reviewPayload?.text || "";
    
    if (!text || text.trim() === "") {
        console.log("Supervisor: Empty or missing review text. Treating as potential spam.");
        return {
            reasoningLogs: [`[Supervisor Triage] Category: spam. Action: short_circuit. Reason: Empty or missing review content.`],
            executedPrompts: [{ name: STANDARD_SUPERVISOR_PROMPT.name }],
            autoFlag: "supervisor_rejected"
        };
    }

    // Pre-LLM sanitization: Detect prompt injection attempts
    if (detectPromptInjection(text)) {
        console.log("Supervisor: Detected potential prompt injection attempt in review text.");
        return {
            reasoningLogs: [`[Supervisor Triage] Category: spam. Action: short_circuit. Reason: Detected prompt injection/manipulation attempt in review text.`],
            executedPrompts: [{ name: STANDARD_SUPERVISOR_PROMPT.name }],
            autoFlag: "supervisor_rejected"
        };
    }

    // 1. 定义大模型的输出结构（分诊结果）
    const routingSchema = z.object({
        category: z.enum(["normal", "spam", "high_risk"]).describe("The high-level category of the review text."),
        action: z.enum(["continue", "short_circuit"]).describe("If spam or high_risk, select short_circuit. Otherwise continue."),
        reason: z.string().describe("Brief reason for this triage decision.")
    });

    const structuredLlm = llm.withStructuredOutput(routingSchema, {
        method: "functionCalling",     
    });

    // 2. 手动替换模板变量（与 textWorker / imputationWorker 保持一致）
    const messages = (STANDARD_SUPERVISOR_PROMPT.template as Array<{ role: "system" | "user"; content: string }>)
        .map(m => ({ ...m, content: m.content.replace("{{text}}", text) }));

    // 3. 组装并调用大模型 — capture span
    const inputText = messages.map(m => `[${m.role}] ${m.content}`).join("\n");
    const tokensBefore = { input: globalTokenTracker.inputTokens, output: globalTokenTracker.outputTokens };
    const spanStart = Date.now();

    const formattedPrompt = ChatPromptTemplate.fromMessages(messages);
    const triageResult = await structuredLlm.invoke(await formattedPrompt.invoke({}));

    const spanEnd = Date.now();
    const spanRecord: SpanRecord = {
        name: "supervisor",
        spanType: "LLM",
        startTimeMs: spanStart,
        endTimeMs: spanEnd,
        inputs: JSON.stringify({ prompt: inputText }),
        outputs: JSON.stringify(triageResult),
        inputTokens: globalTokenTracker.inputTokens - tokensBefore.input,
        outputTokens: globalTokenTracker.outputTokens - tokensBefore.output,
        model: STANDARD_SUPERVISOR_PROMPT.modelConfig?.model_name,
        statusCode: "OK",
    };

    // 4. 将分诊结果写入 State，供图的条件路由 (Conditional Edge) 读取
    return {
        reasoningLogs: [`[Supervisor Triage] Category: ${triageResult.category}. Action: ${triageResult.action}. Reason: ${triageResult.reason}`],
        executedPrompts: [{ name: STANDARD_SUPERVISOR_PROMPT.name }],
        // 如果我们发现可以直接短路，就打个标记
        autoFlag: triageResult.action === "short_circuit" ? "supervisor_rejected" : null,
        spanRecords: [spanRecord],
    };
};

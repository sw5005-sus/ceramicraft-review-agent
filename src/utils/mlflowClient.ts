/**
 * MLflow REST API client for logging comment moderation runs, traces, and prompts.
 * (Migrated to native fetch to bypass VPN TUN network resets)
 * 
 * Supports test mode via RUN_ENV=test environment variable:
 * - When RUN_ENV='test', MLflow calls are mocked and return immediately
 * - This prevents test data pollution in production MLflow instances
 */

import crypto from "crypto";
import "dotenv/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ChatOpenAI } from "@langchain/openai";
import { ALL_PROMPT_DEFINITIONS, type PromptDefinition } from "../prompts/catalog.js";
import type { SpanRecord } from "../graph/state.js";
import { createLogger } from "./logger.js";

const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-1" });
const S3_BUCKET = "ceramicraft-mlflow";

const MLFLOW_BASE = (process.env.MLFLOW_TRACKING_URI ?? "").replace(/\/$/, "");
const EXPERIMENT_NAME = "comment-moderate-traces";
const DEFAULT_MODEL_NAME = "kimi-k2-0711-preview";
const PROMPT_EXPERIMENT_IDS_TAG_KEY = "_mlflow_experiment_ids";
const LINKED_PROMPTS_TAG_KEY = "mlflow.linkedPrompts";
const PROMPT_ASSOCIATED_RUN_IDS_TAG_KEY = "mlflow.prompt.associatedRunIds";
const PROMPT_TEXT_TAG_KEY = "mlflow.prompt.text";
const PROMPT_TYPE_TAG_KEY = "_mlflow_prompt_type";
const PROMPT_MODEL_CONFIG_TAG_KEY = "_mlflow_prompt_model_config";

const logger = createLogger("MLflow");
// Skip MLflow logging only in test mode (to avoid polluting test data)
const shouldSkipMLflow = process.env.RUN_ENV === "test";

let cachedExperimentId: string | null = null;
let promptsRegistered = false;

export interface PromptVersionRef {
  name: string;
  version: string;
}

async function resolveExperimentId(): Promise<string> {
  if (cachedExperimentId) return cachedExperimentId;

  try {
    const query = new URLSearchParams({ experiment_name: EXPERIMENT_NAME }).toString();
    const res = await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/experiments/get-by-name?${query}`);
    
    if (res.ok) {
      const data = await res.json();
      cachedExperimentId = data.experiment.experiment_id as string;
    } else if (res.status === 404) {
      const createRes = await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/experiments/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: EXPERIMENT_NAME }),
      });
      if (!createRes.ok) throw new Error(`Failed to create experiment: ${createRes.status}`);
      const createData = await createRes.json();
      cachedExperimentId = createData.experiment_id as string;
    } else {
      throw new Error(`HTTP Error: ${res.status}`);
    }
  } catch (err: any) {
    throw err;
  }

  return cachedExperimentId!;
}

export interface ModerationRunData {
  reviewId?: string | undefined;
  productId?: string | number | undefined;
  isSafe?: boolean | null | undefined;
  isProductRelevant?: boolean | null | undefined;
  isMismatch?: boolean | null | undefined;
  isImageSafe?: boolean | null | undefined;
  isImageRelevant?: boolean | null | undefined;
  inferredScore?: number | null | undefined;
  finalStatus?: "approved" | "hidden" | "rejected" | undefined;
  autoFlag?: string | null | undefined;
  isHarmful?: boolean | undefined;
  linkedPrompts?: PromptVersionRef[] | undefined;
  reasoningLogs?: string[] | undefined;
  latencyMs?: number | undefined;
}

export async function logModerationRun(data: ModerationRunData): Promise<string | undefined> {
  // Test mode: Skip actual MLflow logging
  if (shouldSkipMLflow) {
    const mockRunId = `mock-run-${Date.now()}`;
    logger.debug(`Skipped MLflow run log in test mode (mock run_id=${mockRunId})`);
    return mockRunId;
  }

  if (!MLFLOW_BASE) {
    logger.warn("MLFLOW_TRACKING_URI is not set - skipping run log.");
    return undefined;
  }

  try {
    const experimentId = await resolveExperimentId();
    const startTime = Date.now();

    const runRes = await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/runs/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experiment_id: experimentId,
        run_name: data.reviewId ? `review-${data.reviewId}` : `review-${startTime}`,
        start_time: startTime,
      }),
    });
    if (!runRes.ok) throw new Error(`Run create failed: ${runRes.status}`);
    const runData = await runRes.json();
    const runId: string = runData.run.info.run_id;

    await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/runs/log-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        params: buildRunParams(data),
        metrics: buildRunMetrics(data, startTime),
        tags: buildRunTags(data),
      }),
    });

    if (data.reasoningLogs && data.reasoningLogs.length > 0) {
      try {
        const query = new URLSearchParams({ run_id: runId }).toString();
        await fetch(`${MLFLOW_BASE}/api/2.0/mlflow-artifacts/artifacts/reasoning_logs.txt?${query}`, {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: data.reasoningLogs.join("\n"),
        });
      } catch {
        // Best-effort only.
      }
    }

    if (data.linkedPrompts && data.linkedPrompts.length > 0) {
      await associatePromptsWithRun(runId, data.linkedPrompts);
    }

    await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/runs/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        status: "FINISHED",
        end_time: Date.now(),
      }),
    });

    console.log(`[MLflow] Run logged successfully (run_id=${runId})`);
    return runId;
  } catch (error: any) {
    logger.warn(`Failed to log run: ${error.message}`);
    return undefined;
  }
}

function buildRunParams(data: ModerationRunData): Array<{ key: string; value: string }> {
  const params: Array<{ key: string; value: string }> = [
    { key: "model_name", value: DEFAULT_MODEL_NAME },
  ];
  const modelsUsed = getModelsUsedFromLinkedPrompts(data.linkedPrompts);

  if (data.reviewId) {
    params.push({ key: "review_id", value: data.reviewId });
  }
  if (data.productId !== undefined && data.productId !== null) {
    params.push({ key: "product_id", value: String(data.productId) });
  }
  if (modelsUsed.length > 0) {
    params.push({ key: "models_used", value: modelsUsed.join(",") });
  }
  if (data.linkedPrompts && data.linkedPrompts.length > 0) {
    params.push({ key: "prompt_count", value: String(data.linkedPrompts.length) });
  }

  return params;
}

function buildRunMetrics(
  data: ModerationRunData,
  timestamp: number
): Array<{ key: string; value: number; timestamp: number; step: number }> {
  const metrics: Array<{ key: string; value: number; timestamp: number; step: number }> = [];
  const booleanFields: Array<[string, boolean | null | undefined]> = [
    ["is_safe", data.isSafe],
    ["is_product_relevant", data.isProductRelevant],
    ["is_mismatch", data.isMismatch],
    ["is_image_safe", data.isImageSafe],
    ["is_image_relevant", data.isImageRelevant],
  ];

  for (const [key, value] of booleanFields) {
    if (value !== null && value !== undefined) {
      metrics.push({ key, value: value ? 1 : 0, timestamp, step: 0 });
    }
  }

  if (data.inferredScore !== null && data.inferredScore !== undefined) {
    metrics.push({ key: "inferred_score", value: data.inferredScore, timestamp, step: 0 });
  }
  if (data.latencyMs !== undefined) {
    metrics.push({ key: "latency_ms", value: data.latencyMs, timestamp, step: 0 });
  }

  return metrics;
}

function buildRunTags(data: ModerationRunData): Array<{ key: string; value: string }> {
  const tags: Array<{ key: string; value: string }> = [];
  if (data.finalStatus !== undefined) tags.push({ key: "final_status", value: data.finalStatus });
  if (data.autoFlag) tags.push({ key: "auto_flag", value: data.autoFlag });
  if (data.isHarmful !== undefined) tags.push({ key: "is_harmful", value: String(data.isHarmful) });
  if (data.linkedPrompts && data.linkedPrompts.length > 0) {
    tags.push({ key: LINKED_PROMPTS_TAG_KEY, value: JSON.stringify(data.linkedPrompts) });
  }
  return tags;
}

export interface ModerationTraceData {
  reviewId?: string | undefined;
  reviewContent?: string | undefined;
  productId?: string | number | undefined;
  finalStatus?: "approved" | "hidden" | "rejected" | undefined;
  autoFlag?: string | null | undefined;
  isHarmful?: boolean | undefined;
  linkedPrompts?: PromptVersionRef[] | undefined;
  reasoningLogs?: string[] | undefined;
  startTimeMs?: number | undefined;
  latencyMs?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  spanRecords?: SpanRecord[] | undefined;
}

async function generateThinkingSummary(
  reasoningLogs: string[],
  finalStatus: string | undefined
): Promise<string> {
  if (!reasoningLogs || reasoningLogs.length === 0) return "";
  try {
    const llm = new ChatOpenAI({
      modelName: process.env.LLM_MODEL ?? DEFAULT_MODEL_NAME,
      openAIApiKey: process.env.LLM_API_KEY!,
      configuration: {
        apiKey: process.env.LLM_API_KEY!,
        baseURL: process.env.LLM_API_BASEURL,
      },
      temperature: 0.3,
      maxTokens: 200,
      callbacks: [], // no globalTokenTracker — avoids polluting token counts for the review
    });
    const logsText = reasoningLogs.join("\n");
    const resp = await llm.invoke([
      {
        role: "system",
        content:
          "You are a concise audit log summarizer. Write 2-3 sentences in English summarizing the AI agent's moderation reasoning.",
      },
      {
        role: "user",
        content: `The agent analyzed a product review and reached a final decision of "${finalStatus ?? "unknown"}". Here are its reasoning steps:\n\n${logsText}\n\nSummarize in 2-3 sentences what the agent found and why it reached this decision.`,
      },
    ]);
    return typeof resp.content === "string" ? resp.content.trim() : reasoningLogs.join(" | ");
  } catch {
    return reasoningLogs.join(" | ");
  }
}

export async function logModerationTrace(data: ModerationTraceData): Promise<void> {
  // Test mode: Skip actual MLflow logging
  if (shouldSkipMLflow) {
    logger.debug(`Skipped MLflow trace log in test mode`);
    return;
  }

  if (!MLFLOW_BASE) return;

  try {
    const experimentId = await resolveExperimentId();
    const startTime = data.startTimeMs ?? Date.now() - (data.latencyMs ?? 0);
    const executionTime = data.latencyMs ?? 0;

    // Generate thinking summary and capture as a span
    const allSpans = [...(data.spanRecords ?? [])];
    const thinkingStart = Date.now();
    const thinkingSummary = await generateThinkingSummary(
      data.reasoningLogs ?? [],
      data.finalStatus
    );
    const thinkingEnd = Date.now();
    if (thinkingSummary) {
      allSpans.push({
        name: "thinkingSummary",
        spanType: "LLM",
        startTimeMs: thinkingStart,
        endTimeMs: thinkingEnd,
        inputs: JSON.stringify({ reasoningLogs: data.reasoningLogs, finalStatus: data.finalStatus }),
        outputs: JSON.stringify({ summary: thinkingSummary }),
        model: process.env.LLM_MODEL ?? DEFAULT_MODEL_NAME,
        statusCode: "OK",
      });
    }

    const request = JSON.stringify({
      review_id: data.reviewId,
      content: data.reviewContent,
      product_id: data.productId,
    });
    const response = JSON.stringify({
      final_status: data.finalStatus,
      auto_flag: data.autoFlag ?? null,
      is_harmful: data.isHarmful ?? false,
    });

    // --- V3 Trace API (flat dict tags + trace_metadata) ---
    const traceId = "tr-" + crypto.randomBytes(16).toString("hex");
    const models = getModelsUsedFromLinkedPrompts(data.linkedPrompts);

    const traceMetadata: Record<string, string> = {
      "mlflow.trace_schema.version": "3",
      "mlflow.source.name": "comment-moderate-langgraph",
      "mlflow.traceInputs": request,
      "mlflow.traceOutputs": response,
      "llm_duration_ms": String(executionTime),
    };
    if (data.inputTokens !== undefined) traceMetadata["llm_input_tokens"] = String(data.inputTokens);
    if (data.outputTokens !== undefined) traceMetadata["llm_output_tokens"] = String(data.outputTokens);
    if (data.totalTokens !== undefined) {
      traceMetadata["mlflow.tokens"] = String(data.totalTokens);
      traceMetadata["llm_total_tokens"] = String(data.totalTokens);
    }
    if (models.length > 0 && models[0]) traceMetadata["llm_model"] = models[0];
    if (thinkingSummary) traceMetadata["thinking_process"] = thinkingSummary;
    if (data.finalStatus) traceMetadata["final_status"] = data.finalStatus;
    if (data.autoFlag) traceMetadata["auto_flag"] = data.autoFlag;

    const traceTags: Record<string, string> = {
      "mlflow.traceName": "comment-moderation",
    };

    const executionDuration = `${(executionTime / 1000).toFixed(3)}s`;

    await fetch(`${MLFLOW_BASE}/api/3.0/mlflow/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trace: {
          trace_info: {
            trace_id: traceId,
            trace_location: {
              type: "MLFLOW_EXPERIMENT",
              mlflow_experiment: { experiment_id: experimentId },
            },
            request_time: new Date(startTime).toISOString(),
            execution_duration: executionDuration,
            state: "OK",
            trace_metadata: traceMetadata,
            tags: traceTags,
            request_preview: request.substring(0, 1000),
            response_preview: response.substring(0, 1000),
          },
        },
      }),
    });

    if (data.linkedPrompts && data.linkedPrompts.length > 0) {
      await linkPromptsToTrace(traceId, data.linkedPrompts);
    }

    // Upload multi-span artifacts to S3
    try {
      await uploadTraceSpans(traceId, experimentId, request, response, startTime, executionTime, allSpans, {
        thinking_process: thinkingSummary || undefined,
        llm_model: models[0] || undefined,
      });
    } catch (e: any) {
      console.warn("[MLflow] Failed to upload trace spans:", e.message);
    }

    console.log(`[MLflow] Trace logged (trace_id=${traceId})`);
  } catch (error: any) {
    console.warn(`[MLflow] Failed to log trace: ${error.message}`);
  }
}

function generateHexId(length: number): string {
  return Array.from({ length: Math.ceil(length / 2) }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("").slice(0, length);
}

async function uploadTraceSpans(
  traceId: string,
  experimentId: string,
  request: string,
  response: string,
  startTimeMs: number,
  executionTimeMs: number,
  childSpanRecords: SpanRecord[],
  rootExtra: { thinking_process?: string | undefined; llm_model?: string | undefined },
): Promise<void> {
  const traceIdHex = traceId.replace(/-/g, "");
  const startTimeNs = startTimeMs * 1_000_000;
  const endTimeNs = (startTimeMs + Math.max(0, executionTimeMs)) * 1_000_000;

  const rootSpanId = generateHexId(16);
  const rootAttributes: Record<string, string> = {
    "mlflow.spanType": "CHAIN",
    "mlflow.traceRequestId": traceId,
    "mlflow.spanInputs": request,
    "mlflow.spanOutputs": response,
  };
  if (rootExtra.thinking_process) rootAttributes["thinking_process"] = rootExtra.thinking_process;
  if (rootExtra.llm_model) rootAttributes["llm_model"] = rootExtra.llm_model;

  const spans: any[] = [
    {
      name: "comment-moderation",
      context: { span_id: rootSpanId, trace_id: traceIdHex },
      parent_id: null,
      start_time: startTimeNs,
      end_time: endTimeNs,
      status_code: "OK",
      status_message: "",
      attributes: rootAttributes,
      events: [],
    },
  ];

  for (const rec of childSpanRecords) {
    const childSpanId = generateHexId(16);
    const childAttrs: Record<string, string> = {
      "mlflow.spanType": rec.spanType,
      "mlflow.traceRequestId": traceId,
      "mlflow.spanInputs": rec.inputs,
      "mlflow.spanOutputs": rec.outputs,
    };
    if (rec.inputTokens !== undefined) childAttrs["llm_input_tokens"] = String(rec.inputTokens);
    if (rec.outputTokens !== undefined) childAttrs["llm_output_tokens"] = String(rec.outputTokens);
    if (rec.inputTokens !== undefined && rec.outputTokens !== undefined) {
      childAttrs["llm_total_tokens"] = String(rec.inputTokens + rec.outputTokens);
    }
    if (rec.model) childAttrs["llm_model"] = rec.model;

    spans.push({
      name: rec.name,
      context: { span_id: childSpanId, trace_id: traceIdHex },
      parent_id: rootSpanId,
      start_time: rec.startTimeMs * 1_000_000,
      end_time: rec.endTimeMs * 1_000_000,
      status_code: rec.statusCode ?? "OK",
      status_message: "",
      attributes: childAttrs,
      events: [],
    });
  }

  const body = JSON.stringify({ spans });

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${experimentId}/traces/${traceId}/artifacts/traces.json`,
    Body: body,
    ContentType: "application/json",
  }));
}

async function finalizeTrace(traceId: string, startTimeMs: number, executionTimeMs: number): Promise<void> {
  const endTimestampMs = Math.max(Date.now(), startTimeMs + Math.max(0, executionTimeMs));

  try {
    await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/traces/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp_ms: endTimestampMs,
        status: "OK",
      }),
    });
  } catch {
    // Best-effort only
  }
}

export async function registerSystemPrompts(): Promise<void> {
  if (!MLFLOW_BASE || promptsRegistered) return;

  const experimentId = await resolveExperimentId();

  for (const prompt of ALL_PROMPT_DEFINITIONS) {
    try {
      await ensurePromptRegistered(prompt, experimentId);
      await ensurePromptVersion(prompt);
    } catch (error: any) {
      console.warn(`[MLflow] Failed to register prompt "${prompt.name}": ${error.message}`);
    }
  }

  promptsRegistered = true;
}

export async function resolvePromptVersionRefs(
  promptRefs: Array<{ name: string }>
): Promise<PromptVersionRef[]> {
  if (!MLFLOW_BASE || promptRefs.length === 0) {
    return [];
  }

  const uniqueNames = [...new Set(promptRefs.map((prompt) => prompt.name))];
  const resolved: PromptVersionRef[] = [];

  for (const name of uniqueNames) {
    const latestVersion = await getLatestPromptVersion(name);
    if (latestVersion?.version) {
      resolved.push({ name, version: String(latestVersion.version) });
    }
  }

  return resolved;
}

async function ensurePromptRegistered(prompt: PromptDefinition, experimentId: string): Promise<void> {
  const existing = await getRegisteredPrompt(prompt.name);
  const currentExperimentTag = getTagValue(existing?.tags, PROMPT_EXPERIMENT_IDS_TAG_KEY);
  const mergedExperimentTag = mergeExperimentIds(currentExperimentTag, experimentId);

  if (!existing) {
    try {
      const res = await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/registered-models/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: prompt.name,
          description: prompt.description,
          tags: [
            { key: "mlflow.prompt.is_prompt", value: "true" },
            { key: PROMPT_EXPERIMENT_IDS_TAG_KEY, value: mergedExperimentTag },
            { key: "project", value: "comment-moderate" },
          ],
        }),
      });

      if (!res.ok) {
        const status = res.status;
        const text = await res.text();
        const alreadyExists = status === 409 || (status === 400 && text.toLowerCase().includes("already"));
        if (!alreadyExists) {
          throw new Error(`HTTP Error ${status}: ${text}`);
        }
      } else {
        console.log(`[MLflow] Prompt registered: ${prompt.name}`);
        return;
      }
    } catch (error: any) {
      throw error;
    }
  }

  await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/registered-models/set-tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: prompt.name,
      key: PROMPT_EXPERIMENT_IDS_TAG_KEY,
      value: mergedExperimentTag,
    }),
  });
}

async function ensurePromptVersion(prompt: PromptDefinition): Promise<void> {
  const latestVersion = await getLatestPromptVersion(prompt.name);
  const desiredTags = buildPromptVersionTags(prompt);

  if (latestVersion && isSamePromptVersion(latestVersion, prompt, desiredTags)) {
    return;
  }

  await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/model-versions/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: prompt.name,
      description: prompt.commitMessage,
      source: "dummy-source",
      tags: desiredTags,
    }),
  });
  console.log(`[MLflow] Prompt version created: ${prompt.name}`);
}

async function getRegisteredPrompt(name: string): Promise<any | null> {
  try {
    const query = new URLSearchParams({ name }).toString();
    const res = await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/registered-models/get?${query}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();
    return data?.registered_model ?? null;
  } catch (error: any) {
    throw error;
  }
}

async function getLatestPromptVersion(name: string): Promise<any | null> {
  const prompt = await getRegisteredPrompt(name);
  const versions = prompt?.latest_versions;
  if (!versions || versions.length === 0) {
    return null;
  }

  return versions.reduce((latest: any, current: any) => {
    if (!latest) return current;
    return Number(current.version) > Number(latest.version) ? current : latest;
  }, null);
}

function buildPromptVersionTags(prompt: PromptDefinition): Array<{ key: string; value: string }> {
  const isChatPrompt = Array.isArray(prompt.template);
  let promptText: string;

  if (Array.isArray(prompt.template)) {
    promptText = JSON.stringify(prompt.template);
  } else {
    promptText = prompt.template;
  }

  const tags: Array<{ key: string; value: string }> = [
    { key: "mlflow.prompt.is_prompt", value: "true" },
    { key: PROMPT_TEXT_TAG_KEY, value: promptText },
    { key: PROMPT_TYPE_TAG_KEY, value: isChatPrompt ? "chat" : "text" },
  ];

  if (prompt.modelConfig) {
    tags.push({ key: PROMPT_MODEL_CONFIG_TAG_KEY, value: JSON.stringify(prompt.modelConfig) });
  }

  return tags;
}

function isSamePromptVersion(
  latestVersion: any,
  prompt: PromptDefinition,
  desiredTags: Array<{ key: string; value: string }>
): boolean {
  const currentTags = arrayTagsToMap(latestVersion.tags);
  const expectedTags = arrayTagsToMap(desiredTags);

  return latestVersion.description === prompt.commitMessage &&
    currentTags["mlflow.prompt.is_prompt"] === "true" &&
    currentTags[PROMPT_TEXT_TAG_KEY] === expectedTags[PROMPT_TEXT_TAG_KEY] &&
    currentTags[PROMPT_TYPE_TAG_KEY] === expectedTags[PROMPT_TYPE_TAG_KEY] &&
    currentTags[PROMPT_MODEL_CONFIG_TAG_KEY] === expectedTags[PROMPT_MODEL_CONFIG_TAG_KEY];
}

function arrayTagsToMap(tags?: Array<{ key: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tag of tags ?? []) {
    result[tag.key] = tag.value;
  }
  return result;
}

function getTagValue(tags: Array<{ key: string; value: string }> | undefined, key: string): string | undefined {
  return tags?.find((tag) => tag.key === key)?.value;
}

function mergeExperimentIds(existingValue: string | undefined, experimentId: string): string {
  const ids = new Set((existingValue ?? "").split(",").filter(Boolean));
  ids.add(experimentId);
  return `,${[...ids].join(",")},`;
}

async function associatePromptsWithRun(runId: string, promptRefs: PromptVersionRef[]): Promise<void> {
  await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/runs/set-tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      run_id: runId,
      key: LINKED_PROMPTS_TAG_KEY,
      value: JSON.stringify(promptRefs),
    }),
  });

  for (const promptRef of promptRefs) {
    const current = await getModelVersionTag(promptRef.name, promptRef.version, PROMPT_ASSOCIATED_RUN_IDS_TAG_KEY);
    await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/model-versions/set-tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: promptRef.name,
        version: promptRef.version,
        key: PROMPT_ASSOCIATED_RUN_IDS_TAG_KEY,
        value: mergeCsvValues(current, runId),
      }),
    });
  }
}

async function linkPromptsToTrace(traceId: string, promptRefs: PromptVersionRef[]): Promise<void> {
  try {
    await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/traces/link-prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trace_id: traceId,
        prompt_versions: promptRefs.map((promptRef) => ({
          name: promptRef.name,
          version: promptRef.version,
        })),
      }),
    });
  } catch {
    // Best-effort only
  }
}

async function getModelVersionTag(name: string, version: string, key: string): Promise<string | undefined> {
  try {
    const query = new URLSearchParams({ name, version }).toString();
    const res = await fetch(`${MLFLOW_BASE}/api/2.0/mlflow/model-versions/get?${query}`);
    if (!res.ok) return undefined;
    const data = await res.json();
    return getTagValue(data?.model_version?.tags, key);
  } catch {
    return undefined;
  }
}

function mergeCsvValues(existingValue: string | undefined, nextValue: string): string {
  const values = new Set((existingValue ?? "").split(",").filter(Boolean));
  values.add(nextValue);
  return [...values].join(",");
}

function getModelsUsedFromLinkedPrompts(promptRefs: PromptVersionRef[] | undefined): string[] {
  if (!promptRefs || promptRefs.length === 0) {
    return [];
  }

  const promptByName = new Map(ALL_PROMPT_DEFINITIONS.map((prompt) => [prompt.name, prompt]));
  const models = new Set<string>();

  for (const ref of promptRefs) {
    const promptDef = promptByName.get(ref.name);
    const modelName = promptDef?.modelConfig?.model_name;
    if (modelName) {
      models.add(modelName);
    }
  }

  return [...models];
}
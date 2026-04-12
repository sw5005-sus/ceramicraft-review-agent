/**
 * MLflow REST API client for logging comment moderation runs, traces, and prompts.
 */

import axios from "axios";
import "dotenv/config";
import { ALL_PROMPT_DEFINITIONS, type PromptDefinition } from "../prompts/catalog.js";

const MLFLOW_BASE = (process.env.MLFLOW_TRACKING_URI ?? "").replace(/\/$/, "");
const EXPERIMENT_NAME = "comment-moderate-traces";
const DEFAULT_MODEL_NAME = "kimi-k2-0711-preview";
const PROMPT_EXPERIMENT_IDS_TAG_KEY = "_mlflow_experiment_ids";
const LINKED_PROMPTS_TAG_KEY = "mlflow.linkedPrompts";
const PROMPT_ASSOCIATED_RUN_IDS_TAG_KEY = "mlflow.prompt.associatedRunIds";
const PROMPT_TEXT_TAG_KEY = "mlflow.prompt.text";
const PROMPT_TYPE_TAG_KEY = "_mlflow_prompt_type";
const PROMPT_MODEL_CONFIG_TAG_KEY = "_mlflow_prompt_model_config";

let cachedExperimentId: string | null = null;
let promptsRegistered = false;

export interface PromptVersionRef {
  name: string;
  version: string;
}

async function resolveExperimentId(): Promise<string> {
  if (cachedExperimentId) return cachedExperimentId;

  try {
    const res = await axios.get(
      `${MLFLOW_BASE}/api/2.0/mlflow/experiments/get-by-name`,
      { params: { experiment_name: EXPERIMENT_NAME } }
    );
    cachedExperimentId = res.data.experiment.experiment_id as string;
  } catch (err: any) {
    if (err.response?.status === 404) {
      const res = await axios.post(
        `${MLFLOW_BASE}/api/2.0/mlflow/experiments/create`,
        { name: EXPERIMENT_NAME }
      );
      cachedExperimentId = res.data.experiment_id as string;
    } else {
      throw err;
    }
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
  if (!MLFLOW_BASE) {
    console.warn("[MLflow] MLFLOW_TRACKING_URI is not set - skipping run log.");
    return undefined;
  }

  try {
    const experimentId = await resolveExperimentId();
    const startTime = Date.now();

    const runRes = await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/runs/create`, {
      experiment_id: experimentId,
      run_name: data.reviewId ? `review-${data.reviewId}` : `review-${startTime}`,
      start_time: startTime,
    });

    const runId: string = runRes.data.run.info.run_id;

    await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/runs/log-batch`, {
      run_id: runId,
      params: buildRunParams(data),
      metrics: buildRunMetrics(data, startTime),
      tags: buildRunTags(data),
    });

    if (data.reasoningLogs && data.reasoningLogs.length > 0) {
      try {
        await axios.put(
          `${MLFLOW_BASE}/api/2.0/mlflow-artifacts/artifacts/reasoning_logs.txt`,
          data.reasoningLogs.join("\n"),
          {
            params: { run_id: runId },
            headers: { "Content-Type": "text/plain" },
          }
        );
      } catch {
        // Best-effort only.
      }
    }

    if (data.linkedPrompts && data.linkedPrompts.length > 0) {
      await associatePromptsWithRun(runId, data.linkedPrompts);
    }

    await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/runs/update`, {
      run_id: runId,
      status: "FINISHED",
      end_time: Date.now(),
    });

    console.log(`[MLflow] Run logged successfully (run_id=${runId})`);
    return runId;
  } catch (error: any) {
    console.warn(`[MLflow] Failed to log run: ${error.message}`);
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
}

export async function logModerationTrace(data: ModerationTraceData): Promise<void> {
  if (!MLFLOW_BASE) return;

  try {
    const experimentId = await resolveExperimentId();
    const startTime = data.startTimeMs ?? Date.now() - (data.latencyMs ?? 0);
    const executionTime = data.latencyMs ?? 0;
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

    const res = await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/traces`, {
      experiment_id: experimentId,
      timestamp_ms: startTime,
      execution_time_ms: executionTime,
      status: "OK",
      request,
      response,
      request_metadata: [
        { key: "mlflow.traceInputs", value: request },
        { key: "mlflow.traceOutputs", value: response },
      ],
      tags: [
        { key: "mlflow.source.name", value: "comment-moderate-langgraph" },
        { key: "final_status", value: data.finalStatus ?? "" },
        ...(data.autoFlag ? [{ key: "auto_flag", value: data.autoFlag }] : []),
        ...(data.linkedPrompts && data.linkedPrompts.length > 0
          ? [{ key: LINKED_PROMPTS_TAG_KEY, value: JSON.stringify(data.linkedPrompts) }]
          : []),
      ],
    });

    const traceId: string = res.data?.trace_info?.request_id ?? "unknown";

    if (traceId !== "unknown") {
      await finalizeTrace(traceId, startTime, executionTime);
    }

    if (traceId !== "unknown" && data.linkedPrompts && data.linkedPrompts.length > 0) {
      await linkPromptsToTrace(traceId, data.linkedPrompts);
    }

    console.log(`[MLflow] Trace logged (trace_id=${traceId})`);
  } catch (error: any) {
    console.warn(`[MLflow] Failed to log trace: ${error.message}`);
  }
}

async function finalizeTrace(traceId: string, startTimeMs: number, executionTimeMs: number): Promise<void> {
  const endTimestampMs = Math.max(Date.now(), startTimeMs + Math.max(0, executionTimeMs));

  try {
    await axios.patch(`${MLFLOW_BASE}/api/2.0/mlflow/traces/${traceId}`, {
      timestamp_ms: endTimestampMs,
      status: "OK",
    });
  } catch {
    // Best-effort only: tracing still exists even if finalization fails.
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
      await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/registered-models/create`, {
        name: prompt.name,
        description: prompt.description,
        tags: [
          { key: "mlflow.prompt.is_prompt", value: "true" },
          { key: PROMPT_EXPERIMENT_IDS_TAG_KEY, value: mergedExperimentTag },
          { key: "project", value: "comment-moderate" },
        ],
      });
      console.log(`[MLflow] Prompt registered: ${prompt.name}`);
      return;
    } catch (error: any) {
      const status = error.response?.status ?? 0;
      const message = String(error.response?.data?.message ?? "");
      const alreadyExists = status === 409 || (status === 400 && message.toLowerCase().includes("already"));
      if (!alreadyExists) {
        throw error;
      }
    }
  }

  await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/registered-models/set-tag`, {
    name: prompt.name,
    key: PROMPT_EXPERIMENT_IDS_TAG_KEY,
    value: mergedExperimentTag,
  });
}

async function ensurePromptVersion(prompt: PromptDefinition): Promise<void> {
  const latestVersion = await getLatestPromptVersion(prompt.name);
  const desiredTags = buildPromptVersionTags(prompt);

  if (latestVersion && isSamePromptVersion(latestVersion, prompt, desiredTags)) {
    return;
  }

  await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/model-versions/create`, {
    name: prompt.name,
    description: prompt.commitMessage,
    source: "dummy-source",
    tags: desiredTags,
  });
  console.log(`[MLflow] Prompt version created: ${prompt.name}`);
}

async function getRegisteredPrompt(name: string): Promise<any | null> {
  try {
    const res = await axios.get(`${MLFLOW_BASE}/api/2.0/mlflow/registered-models/get`, {
      params: { name },
    });
    return res.data?.registered_model ?? null;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
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
  await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/runs/set-tag`, {
    run_id: runId,
    key: LINKED_PROMPTS_TAG_KEY,
    value: JSON.stringify(promptRefs),
  });

  for (const promptRef of promptRefs) {
    const current = await getModelVersionTag(promptRef.name, promptRef.version, PROMPT_ASSOCIATED_RUN_IDS_TAG_KEY);
    await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/model-versions/set-tag`, {
      name: promptRef.name,
      version: promptRef.version,
      key: PROMPT_ASSOCIATED_RUN_IDS_TAG_KEY,
      value: mergeCsvValues(current, runId),
    });
  }
}

async function linkPromptsToTrace(traceId: string, promptRefs: PromptVersionRef[]): Promise<void> {
  try {
    await axios.post(`${MLFLOW_BASE}/api/2.0/mlflow/traces/link-prompts`, {
      trace_id: traceId,
      prompt_versions: promptRefs.map((promptRef) => ({
        name: promptRef.name,
        version: promptRef.version,
      })),
    });
  } catch {
    // Best-effort only. The trace tag already contains linked prompts.
  }
}

async function getModelVersionTag(name: string, version: string, key: string): Promise<string | undefined> {
  try {
    const res = await axios.get(`${MLFLOW_BASE}/api/2.0/mlflow/model-versions/get`, {
      params: { name, version },
    });
    return getTagValue(res.data?.model_version?.tags, key);
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

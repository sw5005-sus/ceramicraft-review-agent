// visionWorker.ts
import { z } from "zod";
import { createLLMFromPromptConfig, globalTokenTracker } from "../../utils/llmFactory.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ReviewGraphState, type SpanRecord } from "../state.js";
import axios from "axios";
import { STANDARD_VISION_WORKER_PROMPT } from "../../prompts/catalog.js";

const llm = createLLMFromPromptConfig(STANDARD_VISION_WORKER_PROMPT.modelConfig);

// S3 configuration (same as in your other project)
const S3_CONFIG = {
  BASE_URL: 'https://ceramicraft.s3.ap-southeast-1.amazonaws.com/',
} as const;

async function fetchImageToBase64(url: string): Promise<string> {
    try {
        console.log(`[Vision Worker Helper] Fetching image data from URL: ${url}`);
        const response = await axios.get(url, {
            responseType: "arraybuffer", // Important: get the raw binary data
            timeout: 15000 // Set a reasonable timeout
        });
        
        // Convert the binary buffer to a base64 encoded string
        const base64String = Buffer.from(response.data).toString("base64");
        // Combine with the data-uri standard prefix
        // (Assuming jpeg for simplicity, but a robust impl should check mime-type)
        return `data:image/jpeg;base64,${base64String}`;
        
    } catch (error) {
        console.error(`[Vision Worker Helper] Error fetching image from URL: ${url}`, error);
        // Throw the error so the main node can handle it
        throw new Error("Failed to fetch image data for vision analysis."); 
    }
}

export const visionWorkerNode = async (state: typeof ReviewGraphState.State) => {
    console.log("Vision Worker: analyzing images...");
    // Support both imageUrls (test) and pic_info (real API) field names
    const imageUrls = state.reviewPayload?.imageUrls || state.reviewPayload?.pic_info || [];

    if (!imageUrls || imageUrls.length === 0) {
        return {
            reasoningLogs: ["[Vision Worker] No images provided."],
            executedPrompts: [{ name: STANDARD_VISION_WORKER_PROMPT.name }]
        };
    }

    // 1. Define the Schema
    const visionAnalysisSchema = z.object({
        isSafe: z.boolean().describe("False if the image contains NSFW, violence, or inappropriate content."),
        isRelevant: z.boolean().describe("False if the image is completely unrelated to a product review."),
        reasoning: z.string().describe("Explanation of what the image contains and why it was flagged or approved.")
    });

    // 2. Enforce JSON Mode
    const structuredVisionLlm = llm.withStructuredOutput(visionAnalysisSchema, {
        method: "jsonMode"
    });

    // 3. System Prompt with strict JSON injection
    const visionPromptTemplate = STANDARD_VISION_WORKER_PROMPT.template as Array<{ role: "system" | "user" | "assistant"; content: string }>;
    const systemPrompt = visionPromptTemplate[0]?.content ?? "";
    let userPrompt = visionPromptTemplate[1]?.content ?? "Please analyze this image and return the required JSON.";
    if (state.productContext) {
        userPrompt += `\n\n[CRITICAL CONTEXT FOR RELEVANCE CHECK]
This image belongs to a review for the following product: ${state.productContext}. 
Please use this product information to accurately determine the 'isRelevant' field. If the image shows something completely unrelated to this specific product or category, set 'isRelevant' to false.`;
    }
    // Process each image and collect evidence
    let allImagesSafe = true;
    let allImagesRelevant = true;
    const imageLogs: string[] = [];
    const spanRecords: SpanRecord[] = [];

    for (let i = 0; i < imageUrls.length; i++) {
        const imageInput = imageUrls[i]!; // Non-null assertion: we know it exists in the array
        let finalImageUrl = imageInput;

        // Convert different image input formats to a fetchable URL
        if (imageInput.startsWith("data:image/")) {
            // Already a data URI, can use directly
            // No need to fetch
        } else if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
            // Already a full URL, can use as-is
            // Will fetch below
        } else {
            // Treat as S3 file name (e.g., "1895fe774b3d02e4.jpg")
            // Convert to full S3 URL
            finalImageUrl = S3_CONFIG.BASE_URL + imageInput;
        }

        // If it's a URL (not already a data URI), fetch and convert to base64
        if (!imageInput.startsWith("data:image/")) {
            try {
                finalImageUrl = await fetchImageToBase64(finalImageUrl);
            } catch (error: any) {
                // If fetching fails, log and skip this image
                imageLogs.push(`[Vision Worker] Image ${i + 1}: ERROR - ${error.message}`);
                allImagesSafe = false;
                continue;
            }
        }

        // 4. Constructing a Multi-modal Message for this image
        const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage({
                content: [
                    {
                        type: "text",
                        text: userPrompt
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: finalImageUrl 
                        }
                    }
                ]
            })
        ];

        // 5. Invoke the LLM for this image
        try {
            const tokensBefore = { input: globalTokenTracker.inputTokens, output: globalTokenTracker.outputTokens };
            const spanStart = Date.now();
            const result = await structuredVisionLlm.invoke(messages);
            const spanEnd = Date.now();

            spanRecords.push({
                name: `visionWorker-image-${i + 1}`,
                spanType: "LLM",
                startTimeMs: spanStart,
                endTimeMs: spanEnd,
                inputs: JSON.stringify({ systemPrompt, userPrompt, imageIndex: i + 1 }),
                outputs: JSON.stringify(result),
                inputTokens: globalTokenTracker.inputTokens - tokensBefore.input,
                outputTokens: globalTokenTracker.outputTokens - tokensBefore.output,
                model: STANDARD_VISION_WORKER_PROMPT.modelConfig?.model_name,
                statusCode: "OK",
            });

            imageLogs.push(`[Vision Worker] Image ${i + 1}: Safe=${result.isSafe}, Relevant=${result.isRelevant}. ${result.reasoning}`);
            
            // Update aggregate evidence: if ANY image is unsafe or irrelevant, flag it
            if (!result.isSafe) allImagesSafe = false;
            if (!result.isRelevant) allImagesRelevant = false;
        } catch (error: any) {
            imageLogs.push(`[Vision Worker] Image ${i + 1}: Analysis error - ${error.message}`);
            allImagesSafe = false;
        }
    }

    return {
        reasoningLogs: imageLogs,
        executedPrompts: [{ name: STANDARD_VISION_WORKER_PROMPT.name }],
        isImageSafe: allImagesSafe,
        isImageRelevant: allImagesRelevant,
        spanRecords,
    };
};
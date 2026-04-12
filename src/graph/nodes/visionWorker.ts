// visionWorker.ts
import { z } from "zod";
import { createLLM } from "../../utils/llmFactory.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ReviewGraphState } from "../state.js";
import axios from "axios";
import { STANDARD_VISION_WORKER_PROMPT } from "../../prompts/catalog.js";

const llm = createLLM("moonshot-v1-8k-vision-preview", 1);

async function fetchImageToBase64(url: string): Promise<string> {
    try {
        console.log(`[Vision Worker Helper] Fetching image data from URL: ${url}`);
        const response = await axios.get(url, {
            responseType: "arraybuffer", // Important: get the raw binary data
            timeout: 5000 // Set a reasonable timeout
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
    const { imageUrls } = state.reviewPayload;

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
        const userPrompt = visionPromptTemplate[1]?.content ?? "Please analyze this image and return the required JSON.";

    // Process each image and collect evidence
    let allImagesSafe = true;
    let allImagesRelevant = true;
    const imageLogs: string[] = [];

    for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i]!; // Non-null assertion: we know it exists in the array
        let finalImageData = imageUrl;

        // If it looks like a public HTTP/S URL, fetch it and convert to base64
        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
            try {
                finalImageData = await fetchImageToBase64(imageUrl);
            } catch (error: any) {
                // If fetching fails, log and skip this image
                imageLogs.push(`[Vision Worker] Image ${i + 1}: ERROR - ${error.message}`);
                allImagesSafe = false;
                continue;
            }
        } else if (!imageUrl.startsWith("data:image/")) {
            // Basic validation: if not a URL, must be a data URI already
            imageLogs.push(`[Vision Worker] Image ${i + 1}: ERROR - Invalid image input format`);
            allImagesSafe = false;
            continue;
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
                            url: finalImageData 
                        }
                    }
                ]
            })
        ];

        // 5. Invoke the LLM for this image
        try {
            const result = await structuredVisionLlm.invoke(messages);
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
        isImageRelevant: allImagesRelevant
    };
};
import "dotenv/config";
import express from "express";
import { reviewModerationGraph } from "./graph/index.js";
import { listReviewsByStatusHttp, updateReviewStatusHttp } from "./mcp/tools-http.js";
import { initializeHttpMcpClient } from "./mcp/http-client.js";
import cron from 'node-cron';

const app = express();
app.use(express.json());

let isBatchRunning = false;

// Health check endpoint
app.get("/review-agent/v1/ping", (req, res) => {
    res.status(200).json({ 
        status: "ok",
        timestamp: new Date().toISOString()
    });
});

const startInternalTimer = () => {
    cron.schedule(process.env.BATCH_CRON_SCHEDULE || '*/2 * * * *', async () => {
        console.log('[Timer] Triggering scheduled moderation batch...');
        try {
            await runBatchModeration(); 
        } catch (err) {
            console.error('[Timer] Cron job failed:', err);
        }
    });
    console.log('⏰ Internal Cron Job scheduled.');
};

async function runBatchModeration() {
    if (isBatchRunning) {
        console.log("[Batch] A batch is already running. Skipping this trigger.");
        return;
    }
    
    isBatchRunning = true;
    console.log("[Batch] Starting moderation batch process...");

    try {
        const pendingResult = await listReviewsByStatusHttp("pending", 2, 0);
        const reviews: any[] = pendingResult?.reviews ?? pendingResult?.data ?? [];

        if (reviews.length === 0) {
            console.log("[Batch] No pending reviews found. Batch finished.");
            isBatchRunning = false;
            return;
        }

        console.log(`[Batch] Found ${reviews.length} pending reviews. Marking as 'processing'...`);

        for (const review of reviews) {
            await updateReviewStatusHttp(review.id, "processing");
        }

        for (const review of reviews) {
            console.log(`[Batch] Processing review ID: ${review.id}`);
            try {
                await reviewModerationGraph.invoke({
                    reviewPayload: review
                });
                console.log(`[Batch] Review ID: ${review.id} processed successfully.`);
            } catch (invokeErr) {
                console.error(`[Batch] Error processing review ID: ${review.id}`, invokeErr);
                await updateReviewStatusHttp(review.id, "pending" as any);
            }
        }

        console.log("[Batch] All reviews in current batch completed.");

    } catch (error) {
        console.error("[Batch] Critical error in batch process:", error);
    } finally {
        isBatchRunning = false;
    }
}

app.post("/review-agent/v1/moderate-batch", (req, res) => {
    console.log("[API] Received trigger from CronJob.");

    // 429 (Too Many Requests) 
    if (isBatchRunning) {
        return res.status(429).json({ 
            success: false, 
            message: "A batch is already running. Try again later." 
        });
    }

    // 202 Accepted
    res.status(202).json({
        success: true,
        message: "Batch moderation job accepted and is running in the background."
    });

    // 触发即忘 (Fire-and-forget)：在后台静默运行核心逻辑
    runBatchModeration().catch(err => {
        console.error("Unhandled error in background job:", err);
    });
});

const PORT = 3000;
const HOST = '0.0.0.0';
initializeHttpMcpClient()
    .then(() => {
        app.listen(PORT, HOST, () => {
            startInternalTimer();
            console.log(`🚀 Review Moderation Agent API is running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error("🔥 CRITICAL: Failed to initialize MCP client. Exiting...", err);
        process.exit(1); 
    });
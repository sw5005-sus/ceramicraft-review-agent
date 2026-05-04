import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalDecisionNode } from '../../src/graph/nodes/finalDecision.js'; 

vi.mock('../../src/mcp/tools-http.js', () => ({
    updateReviewStatusHttp: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../src/utils/emailService.js', () => ({
    sendModerationNotification: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('../../src/utils/mlflowClient.js', () => ({
    logModerationRun: vi.fn().mockResolvedValue(true),
    logModerationTrace: vi.fn().mockResolvedValue(true),
    registerSystemPrompts: vi.fn().mockResolvedValue(true),
    resolvePromptVersionRefs: vi.fn().mockResolvedValue([])
}));

vi.mock('../../src/utils/llmFactory.js', () => ({
    globalTokenTracker: { inputTokens: 10, outputTokens: 20, totalTokens: 30, reset: vi.fn() },
    createLLMFromPromptConfig: vi.fn().mockReturnValue({
        withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ confidenceScore: 95 }) 
        })
    })
}));

describe('Final Decision Node - Business Rules', () => {
    
    // Clear previous mock calls before each test
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Helper function: Generate a "perfect" mock state that should be Approved
    const getPassingState = (): any => ({
        reasoningLogs: [],
        autoFlag: null,
        reviewPayload: { id: 'test-123', stars: 5, content: 'This mug is amazing!' },
        isProductRelevant: true,
        isSafe: true,
        isMismatch: false,
        requiresAfterSales: false,
        isImageSafe: true,
        isImageRelevant: true,
        inferredScore: null,
        graphStartTime: Date.now(),
        executedPrompts: [],
        spanRecords: []
    });

    it('✅ Rule 7: Should be APPROVED when all conditions are met and confidence is high', async () => {
        const state = getPassingState();
        const result = await finalDecisionNode(state);
        
        expect(result.finalStatus).toBe('approved');
        expect(result.isHarmful).toBe(false);
    });

    it('🚫 Rules 1 & 2: Should be REJECTED if flagged by Supervisor or text is unsafe', async () => {
        const state1 = getPassingState();
        state1.autoFlag = 'supervisor_rejected'; // Supervisor short-circuit flag
        const result1 = await finalDecisionNode(state1);
        expect(result1.finalStatus).toBe('rejected');
        expect(result1.isHarmful).toBe(true);

        const state2 = getPassingState();
        state2.isSafe = false; // Text Worker identified as unsafe
        const result2 = await finalDecisionNode(state2);
        expect(result2.finalStatus).toBe('rejected');
    });

    it('👀 Rules 3 & 4: Should be HIDDEN if text or image is irrelevant to the product', async () => {
        const state = getPassingState();
        state.isProductRelevant = false;
        
        const result = await finalDecisionNode(state);
        expect(result.finalStatus).toBe('hidden');
        expect(result.autoFlag).toContain('off_topic'); // Check if the correct flag was applied
    });

    it('🧠 Rule 6 Exception: Should not be Hidden for Mismatch if a 0-star rating is successfully imputed', async () => {
        // Scenario A: Standard Mismatch (e.g., 5 stars but extremely negative text), should be Hidden
        const stateMismatch = getPassingState();
        stateMismatch.isMismatch = true;
        stateMismatch.reviewPayload.stars = 5;
        const resultMismatch = await finalDecisionNode(stateMismatch);
        expect(resultMismatch.finalStatus).toBe('hidden');

        // Scenario B: 0-star review, AI successfully imputed 4 stars. This should be Approved!
        const stateImputed = getPassingState();
        stateImputed.isMismatch = true; 
        stateImputed.reviewPayload.stars = 0; // Original 0 stars
        stateImputed.inferredScore = 4;       // Imputed score
        
        const resultImputed = await finalDecisionNode(stateImputed);
        expect(resultImputed.finalStatus).toBe('approved'); // Perfect! Bypassed the Mismatch rule
        expect(resultImputed.autoFlag).toContain('score_inferred');
    });
});
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
    
    // 每次测试前清空之前的调用记录
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // 辅助函数：生成一个“完美”的、理应被 Approved 的假 State
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

    it('✅ 规则 7: 所有条件满足且置信度高时，应该 APPROVED', async () => {
        const state = getPassingState();
        const result = await finalDecisionNode(state);
        
        expect(result.finalStatus).toBe('approved');
        expect(result.isHarmful).toBe(false);
    });

    it('🚫 规则 1 & 2: 如果被 Supervisor 标记或文本不安全，应该 REJECTED', async () => {
        const state1 = getPassingState();
        state1.autoFlag = 'supervisor_rejected'; // Supervisor 短路标记
        const result1 = await finalDecisionNode(state1);
        expect(result1.finalStatus).toBe('rejected');
        expect(result1.isHarmful).toBe(true);

        const state2 = getPassingState();
        state2.isSafe = false; // Text Worker 发现不安全
        const result2 = await finalDecisionNode(state2);
        expect(result2.finalStatus).toBe('rejected');
    });

    it('👀 规则 3 & 4: 文本或图片与商品不相关时，应该 HIDDEN', async () => {
        const state = getPassingState();
        state.isProductRelevant = false;
        
        const result = await finalDecisionNode(state);
        expect(result.finalStatus).toBe('hidden');
        expect(result.autoFlag).toContain('off_topic'); // 检查是否正确打上了标签
    });

    it('🧠 规则 6 特例: 0分补全成功时不应被判为 Mismatch 而被 Hidden', async () => {
        // 场景 A：普通 Mismatch（比如打5星但狂骂），应该 Hidden
        const stateMismatch = getPassingState();
        stateMismatch.isMismatch = true;
        stateMismatch.reviewPayload.stars = 5;
        const resultMismatch = await finalDecisionNode(stateMismatch);
        expect(resultMismatch.finalStatus).toBe('hidden');

        // 场景 B：0星评论，AI 成功补全了 4 星。这应该被 Approved！
        const stateImputed = getPassingState();
        stateImputed.isMismatch = true; 
        stateImputed.reviewPayload.stars = 0; // 原始0星
        stateImputed.inferredScore = 4;       // 补全了分数
        
        const resultImputed = await finalDecisionNode(stateImputed);
        expect(resultImputed.finalStatus).toBe('approved'); // 完美！绕过了 Mismatch 规则
        expect(resultImputed.autoFlag).toContain('score_inferred');
    });
});
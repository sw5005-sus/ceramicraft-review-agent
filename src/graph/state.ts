import { Annotation } from "@langchain/langgraph";

// Defines the shared data structure used through the Graph
export const ReviewGraphState = Annotation.Root({
  // 1. Input data (provided by the host/driver process)
  reviewPayload: Annotation<{
    // Real review data from backend
    id?: string;              // Review ID from backend
    content?: string;         // Review content/text
    text?: string;            // Alternative: review text
    stars?: number;           // Rating (1-5)
    rating?: number;          // Alternative: numeric rating
    user_id?: number;         // User ID
    product_id?: number;      // Product ID
    parent_id?: string;       // Parent comment ID
    is_anonymous?: boolean;
    pic_info?: any[];         // Image info array
    created_at?: string;
    likes?: number;
    current_user_liked?: boolean;
    is_pinned?: boolean;
    imageUrls?: string[];     // Multiple images possible
    // MCP-related context
    reviewId?: string;        // Unique review identifier for backend persistence
    productId?: string;       // Product ID for context fetching
    userId?: string;          // User ID for history analysis
    userJwtToken?: string;    // JWT token for authenticated MCP calls
    [key: string]: any;       // Allow flexible fields
  }>(), 
  
  // 2. Process data (inference logs written by workers)
  reasoningLogs: Annotation<string[]>({
    reducer: (curr, update) => curr.concat(update), // append new log entries
    default: () => [],
  }),

  executedPrompts: Annotation<Array<{ name: string }>>({
    reducer: (curr, update) => curr.concat(update),
    default: () => [],
  }),

  // 3. EVIDENCE COLLECTION (collected by Workers, not decisions)
  // These are factual findings, not verdicts
  isProductRelevant: Annotation<boolean | null>(),  // Evidence: Is review about the product? (TextWorker)
  isSafe: Annotation<boolean | null>(),             // Evidence: No profanity/hate/spam? (TextWorker)
  isMismatch: Annotation<boolean | null>(),         // Evidence: Rating/text mismatch? (TextWorker)
  isImageSafe: Annotation<boolean | null>(),        // Evidence: Image safe? (VisionWorker)
  isImageRelevant: Annotation<boolean | null>(),    // Evidence: Image relevant to shopping? (VisionWorker)
  inferredScore: Annotation<number | null>(),       // Evidence: Inferred rating (ImputationWorker)
  
  // 4. EVIDENCE: After-sales context (collected by TextWorker, not a decision)
  requiresAfterSales: Annotation<boolean>({
    reducer: (curr, update) => curr || update,      // OR logic: if any worker found it, mark true
    default: () => false
  }),
  afterSalesDraft: Annotation<{
    summary: string;
    solution: string;
    script: string;
  } | null>(),

  // 5. Timing: set automatically when the graph state is first created
  graphStartTime: Annotation<number>({
    value: (_: number, update: number) => update,
    default: () => Date.now(),
  }),

  // 6. FINAL VERDICT (set by Final Decision node only - do NOT set elsewhere)
  finalStatus: Annotation<"approved" | "hidden" | "rejected">(),
  autoFlag: Annotation<string | null>(),
  isHarmful: Annotation<boolean | undefined>(),      // Computed during final decision
});
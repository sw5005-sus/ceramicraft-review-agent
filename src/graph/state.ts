import { Annotation } from "@langchain/langgraph";

// Defines the shared data structure used through the Graph
export const ReviewGraphState = Annotation.Root({
  // 1. Input data (provided by the host/driver process)
  reviewPayload: Annotation<any>(), 
  
  // 2. Process data (inference logs written by workers)
  reasoningLogs: Annotation<string[]>({
    reducer: (curr, update) => curr.concat(update), // append new log entries
    default: () => [],
  }),

  // 3. Final output (decided by the Supervisor)
  finalStatus: Annotation<"approved" | "rejected" | "pending_review">(),
  autoFlag: Annotation<string | null>(),
  inferredScore: Annotation<number | null>(),
});
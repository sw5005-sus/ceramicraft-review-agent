import { StateGraph, END, START } from "@langchain/langgraph";
import { ReviewGraphState } from "./state.js";
import { textWorkerNode } from "./nodes/textWorker.js";
import { visionWorkerNode } from "./nodes/visionWorker.js";
import { imputationWorkerNode } from "./nodes/imputationWorker.js";
import { supervisorNode } from "./nodes/supervisor.js";
import { finalDecisionNode } from "./nodes/finalDecision.js";

// Define the dynamic routing logic based on the Supervisor's triage
const routeAfterSupervisor = (state: typeof ReviewGraphState.State): string[] => {
    const { reviewPayload, autoFlag } = state;
    
    // 1. Short-circuit logic: Skip all workers if Supervisor flagged as spam or high risk
    if (autoFlag === "supervisor_rejected") {
        console.log("Routing: High risk or spam detected. Short-circuiting directly to final decision.");
        return ["finalDecision"];
    }
    
    // 2. Standard routing logic for legitimate reviews
    const nextNodes = ["textWorker"]; 
    
    // Conditionally fan-out based on payload presence
    if (reviewPayload?.imageUrls && reviewPayload.imageUrls.length > 0) {
        nextNodes.push("visionWorker");
    }
    
    // Support both stars and rating field names
    const rating = reviewPayload?.stars ?? reviewPayload?.rating;
    if (rating === undefined || rating === null) {
        nextNodes.push("imputationWorker");
    }
    
    console.log(`Routing: Proceeding to workers: [${nextNodes.join(", ")}]`);
    return nextNodes;
};

const workflow = new StateGraph(ReviewGraphState)
    .addNode("supervisor", supervisorNode)
    .addNode("textWorker", textWorkerNode)
    .addNode("visionWorker", visionWorkerNode)
    .addNode("imputationWorker", imputationWorkerNode)
    .addNode("finalDecision", finalDecisionNode)
    
    // 4. Define edges (transitions)
    .addEdge(START, "supervisor")
    
    // Dynamic parallel branching
    .addConditionalEdges("supervisor", routeAfterSupervisor)
    
    // Fan-in: All executed workers must converge to the final decision node
    .addEdge("textWorker", "finalDecision")
    .addEdge("visionWorker", "finalDecision")
    .addEdge("imputationWorker", "finalDecision")
    
    .addEdge("finalDecision", END)

export const reviewModerationGraph = workflow.compile();
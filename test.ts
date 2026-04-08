import "dotenv/config";
import { reviewModerationGraph } from "./src/graph/index.js";

async function runTests() {
    console.log("======================================================");
    console.log("=== TEST 1: Spam / High Risk (Should Short-Circuit) ===");
    console.log("======================================================");
    const result1 = await reviewModerationGraph.invoke({
        reviewPayload: { text: "asdfghjkl12345 kill everyone explosion", rating: 5 }
    });
    // Print the final structured state returned by the graph
    console.log("\n[TEST 1 OUTPUT]:");
    console.log(JSON.stringify(result1, null, 2));


    console.log("\n======================================================");
    console.log("=== TEST 2: Normal Text Only (Should route to Text) ===");
    console.log("======================================================");
    const result2 = await reviewModerationGraph.invoke({
        reviewPayload: { text: "The quality of this shirt is surprisingly good for the price. Very comfortable.", rating: 4 }
    });
    console.log("\n[TEST 2 OUTPUT]:");
    console.log(JSON.stringify(result2, null, 2));


    console.log("\n======================================================");
    console.log("=== TEST 3: Text + Images + No Rating (Should Fan-out) ===");
    console.log("======================================================");
    const result3 = await reviewModerationGraph.invoke({
        reviewPayload: { 
            text: "The box arrived slightly damaged, but the item inside works fine so far. I need customer service to send me a new cable though.", 
            imageUrls: ["https://img2.baidu.com/it/u=935365276,378312474&fm=253&app=138&f=JPEG?w=800&h=1067"] 
        }
    });
    console.log("\n[TEST 3 OUTPUT]:");
    console.log(JSON.stringify(result3, null, 2));
}

runTests().catch(console.error);
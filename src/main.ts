import { ragPipeline } from "./rag_system";
import { processAllQueries } from "./code_generation/code";
import { codeExpander } from "./code_generation/code_expand";

async function main() {
    const voyageApiKey = process.env.VOYAGE_API_KEY;
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";

    if (!voyageApiKey) {
        console.error("Please set VOYAGE_API_KEY environment variable");
        process.exit(1);
    }

    const BAL_FILE_PATH = './ballerina';

    try {
        console.log("Starting RAG Pipeline...");
        // Step 1: Run RAG pipeline
        await ragPipeline(BAL_FILE_PATH, voyageApiKey, qdrantUrl);
        console.log("RAG Pipeline completed successfully!");

        console.log("Starting Code Expansion...");
        // Step 2: Run code expander (after RAG pipeline completes)
        await codeExpander();
        console.log("Code Expansion completed successfully!");

        console.log("Starting Code Generation...");
        // Step 3: Run code generation (after code expansion completes)
        await processAllQueries();
        console.log("Code Generation completed successfully!");

        console.log("All processes completed successfully!");

    } catch (error) {
        console.error("Error in pipeline:", error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
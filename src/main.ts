import { statSync } from "fs";
import { BallerinaRAGSystem } from "./rag_system";
import { QueryProcessor } from "./queries";

// Usage example and CLI interface
async function main() {
    const voyageApiKey = process.env.VOYAGE_API_KEY;
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";

    if (!voyageApiKey) {
        console.error("Please set VOYAGE_API_KEY environment variable");
        process.exit(1);
    }

    const ragSystem = new BallerinaRAGSystem(qdrantUrl, voyageApiKey);
    const queryProcessor = new QueryProcessor(ragSystem);

    const command = process.argv[2];
    const arg1 = process.argv[3];
    const arg2 = process.argv[4];

    try {
        if (!command) {
            const ballerinaDir = "ballerina";
            console.log(`No command provided. Running default pipeline...`);
            await ragSystem.indexChunks(ballerinaDir);

            const queriesFile = "user_queries.txt";
            try {
                if (statSync(queriesFile).isFile()) {
                    console.log(`\nFound ${queriesFile}, processing user queries...`);
                    await queryProcessor.processUserQueries(queriesFile, 5);
                }
            } catch (error) {
                const defaultQuery = process.env.DEFAULT_QUERY || "list all functions";
                console.log(`Running default query: "${defaultQuery}"`);
                await queryProcessor.saveContextToFile(defaultQuery, 5);
            }

            console.log("Finished processing!");
            return;
        }

        switch (command) {
            case "index":
                await ragSystem.indexChunks(arg1 || "ballerina");
                break;

            case "chunk":
                await ragSystem.chunkAndSave(arg1 || "ballerina");
                break;

            case "query":
                if (!arg1) {
                    console.error("Please provide a query");
                    process.exit(1);
                }
                await queryProcessor.saveContextToFile(arg1, parseInt(arg2 ?? "5"));
                break;

            case "queries":
                const queriesFile = arg1 || "user_queries.txt";
                const limit = parseInt(arg2 ?? "5");
                await queryProcessor.processUserQueries(queriesFile, limit);
                break;

            case "info":
                const info = await ragSystem.getCollectionInfo();
                console.log("Collection info:", JSON.stringify(info, null, 2));
                break;

            default:
                console.log("Usage:");
                console.log("  bun run main.ts                    # Run default pipeline");
                console.log("  bun run main.ts index [dir]        # Index a specific dir");
                console.log("  bun run main.ts chunk [dir]        # Only chunk and save to JSON");
                console.log("  bun run main.ts query \"q\" [n]    # Query with text");
                console.log("  bun run main.ts queries [file] [n] # Process queries from file (supports both text and JSON formats)");
                console.log("  bun run main.ts info               # Show Qdrant info");
        }
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { BallerinaRAGSystem };
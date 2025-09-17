import { ragPipeline } from "./rag_system";


async function main() {
    const voyageApiKey = process.env.VOYAGE_API_KEY;
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";

    if (!voyageApiKey) {
        console.error("Please set VOYAGE_API_KEY environment variable");
        process.exit(1);
    }

    const BAL_FILE_PATH = './ballerina'

    const ragSystem = ragPipeline(BAL_FILE_PATH, voyageApiKey, qdrantUrl);

    


}

main()
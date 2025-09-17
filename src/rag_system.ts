import type { Chunk } from "./types";
import { loadFiles, readFiles } from "./file_extractor";
import { BallerinaChunker } from "./chunker";
import { getEmbeddings } from "./embeddings";
import { createQdrantClient, createCollection, upsertChunks } from "./qdrant";
import { chunkUserQuery } from "./queries";

const QUERIES = "user_queries.txt";

export async function ragPipeline(
    ballerinaDir: string,
    voyageApiKey: string,
    qdrantUrl: string = "http://localhost:6333"
): Promise<void> {
    const chunker = new BallerinaChunker();
    const qdrantClient = createQdrantClient(qdrantUrl);

    console.log("Loading Ballerina files...");
    const ballerinaFiles = loadFiles(ballerinaDir);

    console.log("Chunking code...");
    let allChunks: Chunk[] = [];
    for (const file of ballerinaFiles) {
        const code = readFiles(file);
        allChunks = allChunks.concat(chunker.chunkBallerinaCode(code, file));
    }

    console.log(`Generated ${allChunks.length} chunks`);

    // Save chunks to JSON file in tests folder
    chunker.saveChunksToJson(allChunks, ballerinaDir);

    // Create Qdrant collection
    await createCollection(qdrantClient);

    // Prepare texts for embeddings
    const textsForEmbedding = allChunks.map((chunk) => chunk.content);
    console.log(textsForEmbedding);

    // Generate embeddings
    console.log("Generating embeddings with VoyageAI...");
    const embeddings = await getEmbeddings(textsForEmbedding, voyageApiKey);

    // Upserting chunks
    console.log("Upserting chunks into Qdrant...");
    await upsertChunks(qdrantClient, allChunks, embeddings, textsForEmbedding);

    console.log("All the chunks indexed successfully!");

    // Chunk the user query
    const userQueries = await chunkUserQuery(QUERIES);

    // Embedding the user query
    const userQueryTexts = userQueries.map(q => q.query);
    const embededUserQuery = await getEmbeddings(userQueryTexts, voyageApiKey);

    console.log(embededUserQuery);



}

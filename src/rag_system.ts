import type { Chunk } from "./types";
import { loadFiles, readFiles } from "./file_extractor";
import { BallerinaChunker } from "./chunker";
import { getEmbeddings } from "./embeddings";
import { createQdrantClient, createCollection, upsertChunks, searchRelevantChunks } from "./qdrant";
import { chunkUserQuery } from "./queries";
import fs from 'fs/promises';

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
    // console.log(textsForEmbedding);

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

    console.log(embededUserQuery.length);

    const dirPath = './relevant_chunks'
    await fs.mkdir(dirPath, { recursive: true })

    // Return relevant chunks for every user query
    for (let i = 0; i < userQueries.length; i++) {
        const docId = i + 1;
        const queryEmbedding = embededUserQuery[i];
        const userQuery = userQueries[i];

        if (queryEmbedding && userQuery) {
            const relevantChunks = await searchRelevantChunks(qdrantClient, queryEmbedding);

            console.log(`\nUser Query: ${userQuery.query}`);
            // console.log("Top relevant chunks:");

            const dataToSave = relevantChunks.map((chunk, idx) => {
                // console.log(`${idx + 1}. [Score: ${chunk.score}] ${chunk.payload.content}`);
                return {
                    score: chunk.score,
                    payload: chunk.payload
                };
            });

            const filePath = `${dirPath}/${docId}.json`;
            await fs.writeFile(filePath, JSON.stringify({
                userQuery: userQuery.query,
                relevantChunks: dataToSave
            }, null, 2));

            console.log(`Saved relevant chunks to ${filePath}`);
        } else if (userQuery) {
            console.warn(`No embedding found for user query: ${userQuery.query}`);
        } else {
            console.warn(`User query at index ${i} is undefined.`);
        }
    }
}

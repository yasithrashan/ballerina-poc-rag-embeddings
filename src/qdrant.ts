import { QdrantClient } from "@qdrant/js-client-rest";
import type { Chunk } from "./types";

export class QdrantService {
    private qdrantClient: QdrantClient;
    private collectionName: string = "ballerina_code_chunks";

    constructor(qdrantUrl: string = "http://localhost:6333") {
        this.qdrantClient = new QdrantClient({
            url: qdrantUrl,
            checkCompatibility: false
        });
    }

    async createCollection(): Promise<void> {
        const collections = await this.qdrantClient.getCollections();
        const collectionExists = collections.collections.some(
            collection => collection.name === this.collectionName
        );

        if (!collectionExists) {
            await this.qdrantClient.createCollection(this.collectionName, {
                vectors: {
                    size: 1024,
                    distance: "Cosine"
                }
            });
            console.log(`Created collection: ${this.collectionName}`);
        }
    }

    async upsertChunks(chunks: Chunk[], embeddings: number[][], textsForEmbedding: string[], startIndex: number = 0): Promise<void> {
        const points = chunks
            .map((chunk, index) => {
                const embedding = embeddings[index];
                if (!embedding) return null;
                return {
                    id: startIndex + index + 1,
                    vector: embedding,
                    payload: {
                        content: chunk.content,
                        metadata: chunk.metadata,
                        text_for_embedding: textsForEmbedding[index] || ""
                    }
                };
            })
            .filter((point): point is { id: number; vector: number[]; payload: any } => point !== null);

        await this.qdrantClient.upsert(this.collectionName, {
            wait: true,
            points: points
        });
    }

    async search(queryEmbedding: number[], limit: number = 5): Promise<any[]> {
        const searchResult = await this.qdrantClient.search(this.collectionName, {
            vector: queryEmbedding,
            limit: limit,
            with_payload: true
        });
        return searchResult;
    }

    async getCollectionInfo(): Promise<any> {
        return await this.qdrantClient.getCollection(this.collectionName);
    }
}
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

    async upsertChunks(
        chunks: Chunk[],
        embeddings: number[][],
        textsForEmbedding: string[],
        startIndex: number = 0
    ): Promise<void> {
        if (chunks.length !== embeddings.length) {
            throw new Error('Chunks and embeddings arrays must be the same length')
        }

        const points = chunks
            .map((chunk, idx) => {
                const vector = embeddings[idx];
                if (!vector) return null;
                return {
                    id: startIndex + idx,
                    vector,
                    payload: {
                        content: chunk.content,
                        type: chunk.metadata,
                        line: chunk.metadata.line,
                        endLine: chunk.metadata.endLine,
                        moduleName: chunk.metadata.moduleName,
                        file: chunk.metadata.file,
                        chunkId: chunk.metadata.id,
                        hash: chunk.metadata.hash,
                        textForEmbedding: textsForEmbedding[idx]
                    }
                };
            })
            .filter((point): point is { id: number; vector: number[]; payload: any } => point !== null);
        await this.qdrantClient.upsert(this.collectionName, { points });
    }

}
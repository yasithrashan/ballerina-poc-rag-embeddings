import type { VoyageEmbeddingResponse } from "./types";
import fs from 'fs/promises';

export class EmbeddingsService {
    private voyageApiKey: string;

    constructor(voyageApiKey: string) {
        this.voyageApiKey = voyageApiKey;
    }

    // Get embeddings from VoyageAI
    async getEmbeddings(texts: string[]): Promise<number[][]> {
        const response = await fetch("https://api.voyageai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.voyageApiKey}`,
            },
            body: JSON.stringify({
                input: texts,
                model: "voyage-code-3"
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`VoyageAI API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const rawData = await response.json();
        await fs.writeFile(`embedding_response.json`, JSON.stringify(rawData, null, 2), "utf-8");

        if (!this.isVoyageEmbeddingResponse(rawData)) {
            throw new Error("Invalid response format from VoyageAI API");
        }

        const data: VoyageEmbeddingResponse = rawData;
        const embeddings = data.data.map(item => item.embedding);
        return embeddings;
    }

    private isVoyageEmbeddingResponse(data: unknown): data is VoyageEmbeddingResponse {
        return (
            typeof data === "object" &&
            data !== null &&
            (data as any).object === "list" &&
            Array.isArray((data as any).data) &&
            (data as any).data.every(
                (item: any) =>
                    item.object === "embedding" &&
                    typeof item.index === "number" &&
                    Array.isArray(item.embedding) &&
                    item.embedding.every((v: any) => typeof v === "number")
            ) &&
            typeof (data as any).model === "string" &&
            typeof (data as any).usage?.total_tokens === "number"
        );
    }

}
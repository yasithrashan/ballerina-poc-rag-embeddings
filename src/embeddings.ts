import type { VoyageEmbeddingResponse, Chunk } from "./types";

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
        if (!this.isVoyageEmbeddingResponse(rawData)) {
            throw new Error("Invalid response format from VoyageAI API");
        }

        const data: VoyageEmbeddingResponse = rawData;
        return data.data.map(item => item.embedding);
    }

    private isVoyageEmbeddingResponse(data: any): data is VoyageEmbeddingResponse {
        return (
            data &&
            typeof data === 'object' &&
            Array.isArray(data.data) &&
            data.data.every((item: any) =>
                item &&
                typeof item === 'object' &&
                Array.isArray(item.embedding) &&
                typeof item.index === 'number'
            ) &&
            typeof data.model === 'string' &&
            data.usage &&
            typeof data.usage.total_tokens === 'number'
        );
    }

    // Updated to use new chunk structure
    prepareTextForEmbedding(chunk: Chunk): string {
        let text = `Type: ${chunk.metadata.type}\n`;

        if (chunk.metadata.name) text += `Name: ${chunk.metadata.name}\n`;
        if (chunk.metadata?.servicePath) text += `Service: ${chunk.metadata.servicePath}\n`;
        if (chunk.metadata?.httpMethod) text += `HTTP Method: ${chunk.metadata.httpMethod}\n`;
        if (chunk.metadata?.returnType && chunk.metadata.returnType !== "void") {
            text += `Returns: ${chunk.metadata.returnType}\n`;
        }

        text += `Content:\n${chunk.content}`;
        return text;
    }
}
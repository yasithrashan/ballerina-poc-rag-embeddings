export interface Chunk {
    content: string;
    metadata: {};
}

export interface VoyageEmbeddingResponse {
    data: Array<{
        embedding: number[];
        index: number;
    }>;
    model: string;
    usage: {
        total_tokens: number;
    };
}

export interface QueryWithId {
    id: number;
    query: string;
}
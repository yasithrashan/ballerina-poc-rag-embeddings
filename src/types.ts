export interface Chunk {
    content: string;
    metadata: {
        type: string;
        name: string | null;
        line: number;
        file: string;
        [key: string]: any;
    };
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
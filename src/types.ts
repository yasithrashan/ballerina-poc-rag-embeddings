export interface Chunk {
    content: string;
    metadata: {
        type: string;
        name: string | null;
        file: string;
        line: number;
        endLine: number;
        position: {
            start: { line: number; column: number };
            end: { line: number; column: number };
        };
        id: string;
        hash: string;
        moduleName?: string;
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

export interface RelevantChunk {
    score: number;
    payload: {
        content: string;
        metadata: {
            type: string;
            name: string;
            visibility?: string;
            line: number;
            endLine: number;
            file: string;
            moduleName: string;
            [key: string]: any;
        };
        file: string;
        textForEmbedding: string;
    };
}
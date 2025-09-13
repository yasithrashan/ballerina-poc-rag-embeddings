import type { Chunk } from "./types";
import { BallerinaFileExtractor } from "./file_extractor";
import { BallerinaChunker } from "./chunker";
import { EmbeddingsService } from "./embeddings";
import { QdrantService } from "./qdrant";

export class BallerinaRAGSystem {
    private fileExtractor: BallerinaFileExtractor;
    private chunker: BallerinaChunker;
    private embeddingsService: EmbeddingsService;
    private qdrantService: QdrantService;

    constructor(qdrantUrl: string = "http://localhost:6333", voyageApiKey: string) {
        this.fileExtractor = new BallerinaFileExtractor();
        this.chunker = new BallerinaChunker();
        this.embeddingsService = new EmbeddingsService(voyageApiKey);
        this.qdrantService = new QdrantService(qdrantUrl);
    }

    async indexChunks(ballerinaDir: string): Promise<void> {
        console.log("Loading Ballerina files...");
        const ballerinaFiles = this.fileExtractor.loadBallerinaFiles(ballerinaDir);

        console.log("Chunking code...");
        let allChunks: Chunk[] = [];
        for (const file of ballerinaFiles) {
            const code = this.fileExtractor.readFile(file);
            allChunks = allChunks.concat(this.chunker.chunkBallerinaCode(code, file));
        }

        console.log(`Generated ${allChunks.length} chunks`);

        // Save chunks to JSON file in tests folder
        this.chunker.saveChunksToJson(allChunks, ballerinaDir);

        await this.qdrantService.createCollection();

        const batchSize = 10;
        for (let i = 0; i < allChunks.length; i += batchSize) {
            const batch = allChunks.slice(i, i + batchSize);
            const texts = batch.map(chunk => this.embeddingsService.prepareTextForEmbedding(chunk));
            const embeddings = await this.embeddingsService.getEmbeddings(texts);

            await this.qdrantService.upsertChunks(batch, embeddings, texts, i);
        }

        console.log("Successfully indexed all chunks!");
    }

    // New method to only chunk and save without indexing
    async chunkAndSave(ballerinaDir: string): Promise<string> {
        console.log("Loading Ballerina files...");
        const ballerinaFiles = this.fileExtractor.loadBallerinaFiles(ballerinaDir);

        console.log("Chunking code...");
        let allChunks: Chunk[] = [];
        for (const file of ballerinaFiles) {
            const code = this.fileExtractor.readFile(file);
            allChunks = allChunks.concat(this.chunker.chunkBallerinaCode(code, file));
        }

        console.log(`Generated ${allChunks.length} chunks`);

        // Save chunks to JSON file in tests folder
        const jsonFilePath = this.chunker.saveChunksToJson(allChunks, ballerinaDir);

        console.log("Chunking completed and saved to JSON!");
        return jsonFilePath;
    }

    async queryRelevantChunks(userQuery: string, limit: number = 5): Promise<any[]> {
        const queryEmbedding = await this.embeddingsService.getEmbeddings([userQuery]);
        if (!queryEmbedding[0]) {
            throw new Error("Failed to generate embedding for the query.");
        }
        const searchResult = await this.qdrantService.search(queryEmbedding[0], limit);
        return searchResult;
    }

    async getCollectionInfo(): Promise<any> {
        return await this.qdrantService.getCollectionInfo();
    }
}
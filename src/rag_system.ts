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

        // Create Qdrant collection
        await this.qdrantService.createCollection();

        // Prepare texts for Embeddings
        const textsForEmbedding = allChunks.map(chunk => chunk.content);

        // Generate Embeddings
        console.log('Generation embeddings with VoyageAI...')
        const embeddings = await this.embeddingsService.getEmbeddings(textsForEmbedding);

        // Upserting chunks
        console.log('Upserting chunks into Qdrant...')
        await this.qdrantService.upsertChunks(allChunks, embeddings, textsForEmbedding);

        console.log('All the chunks indexed successfully!');
    }

}
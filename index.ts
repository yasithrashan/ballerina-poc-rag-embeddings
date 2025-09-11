import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { QdrantClient } from "@qdrant/js-client-rest";

interface Chunk {
  type: string;
  name?: string;
  content: string;
  meta: any;
}

interface VoyageEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

class BallerinaRAGSystem {
  private qdrantClient: QdrantClient;
  private voyageApiKey: string;
  private collectionName: string = "ballerina_code_chunks";

  constructor(qdrantUrl: string = "http://localhost:6333", voyageApiKey: string) {
    this.qdrantClient = new QdrantClient({
      url: qdrantUrl,
      checkCompatibility: false // prevent version check error
    });
    this.voyageApiKey = voyageApiKey;
  }

  // Load all .bal files recursively
  private loadBallerinaFiles(dir: string): string[] {
    let files: string[] = [];
    try {
      for (const file of readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files = files.concat(this.loadBallerinaFiles(fullPath));
        } else if (file.endsWith(".bal")) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
    }
    return files;
  }

  // Get line number from index
  private getLineNumber(code: string, index: number): number {
    return code.slice(0, index).split(/\r?\n/).length;
  }

  // Chunk Ballerina code into logical parts
  private chunkBallerinaCode(code: string, filePath: string): Chunk[] {
    const chunks: Chunk[] = [];
    let match: RegExpExecArray | null;

    // Imports
    const importRegex = /import\s+[^;]+;/g;
    while ((match = importRegex.exec(code)) !== null) {
      const startLine = this.getLineNumber(code, match.index);
      chunks.push({
        type: "import",
        content: match[0],
        meta: { file: filePath, line: startLine }
      });
    }

    // Configurable variables
    const configurableRegex = /configurable\s+[\w:]+\s+\w+\s*=\s*[^;]+;/g;
    while ((match = configurableRegex.exec(code)) !== null) {
      const startLine = this.getLineNumber(code, match.index);
      chunks.push({
        type: "configurable_variable",
        content: match[0],
        meta: { file: filePath, line: startLine }
      });
    }

    // Module-level variables
    const moduleVariableRegex = /^(?!.*(?:function|service|resource)).*?(?:final\s+)?[\w:]+\s+\w+\s*=\s*[^;]+;/gm;
    while ((match = moduleVariableRegex.exec(code)) !== null) {
      const startLine = this.getLineNumber(code, match.index);
      chunks.push({
        type: "module_variable",
        content: match[0].trim(),
        meta: { file: filePath, line: startLine }
      });
    }

    // Type definitions and records
    const typeRegex = /(public\s+)?type\s+(\w+)\s+([^;]+;|record\s*\{[^}]*\};?)/g;
    while ((match = typeRegex.exec(code)) !== null) {
      const typeName = match[2];
      const startLine = this.getLineNumber(code, match.index);
      chunks.push({
        type: "type_definition",
        name: typeName,
        content: match[0],
        meta: { file: filePath, line: startLine }
      });
    }

    // Functions
    const functionRegex = /^(?!.*resource).*?function\s+(\w+)\s*\(([^)]*)\)(?:\s+returns\s*([^\{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/gm;
    while ((match = functionRegex.exec(code)) !== null) {
      const name = match[1] ?? "unknown_function";
      const params = match[2] ?? "";
      const returnType = (match[3] ?? "").trim();
      const body = match[4] ?? "";
      const startLine = this.getLineNumber(code, match.index);
      const endLine = this.getLineNumber(code, match.index + match[0].length);

      chunks.push({
        type: "function_signature",
        name,
        content: `function ${name}(${params})${returnType ? ` returns ${returnType}` : ""}`,
        meta: {
          parameters: params.split(",").map(p => p.trim()).filter(Boolean),
          returnType: returnType || "void",
          file: filePath,
          startLine,
          endLine
        }
      });

      chunks.push({
        type: "function_body",
        name,
        content: body.trim(),
        meta: {
          parameters: params.split(",").map(p => p.trim()).filter(Boolean),
          returnType: returnType || "void",
          file: filePath,
          startLine,
          endLine
        }
      });
    }

    // Services
    const serviceRegex = /service\s+(\/[\w\d_/-]*|\w+)(?:\s+on\s+[^{]+)?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
    while ((match = serviceRegex.exec(code)) !== null) {
      const servicePath = match[1]?.replace(/^\//, "") ?? "unknown_service";
      const serviceBody = match[2] ?? "";
      const startLine = this.getLineNumber(code, match.index);
      const endLine = this.getLineNumber(code, match.index + match[0].length);

      chunks.push({
        type: "service_signature",
        name: servicePath,
        content: `service ${match[1]}`,
        meta: { file: filePath, startLine, endLine }
      });

      const resourceRegex = /resource\s+function\s+(\w+)\s+([^\s(]*)\s*\(([^)]*)\)(?:\s*returns\s*([^\{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
      let resourceMatch: RegExpExecArray | null;

      while ((resourceMatch = resourceRegex.exec(serviceBody)) !== null) {
        const method = resourceMatch[1] ?? "unknown_method";
        const pathPart = resourceMatch[2] ?? "";
        const params = resourceMatch[3] ?? "";
        const returnType = (resourceMatch[4] ?? "").trim();
        const body = resourceMatch[5] ?? "";

        const resourceName = `${method} ${pathPart}`.trim();

        chunks.push({
          type: "resource_signature",
          name: resourceName,
          content: `resource function ${method} ${pathPart}(${params})${returnType ? ` returns ${returnType}` : ""}`,
          meta: {
            parameters: params.split(",").map(p => p.trim()).filter(Boolean),
            returnType: returnType || "void",
            file: filePath,
            servicePath: servicePath,
            httpMethod: method
          }
        });

        chunks.push({
          type: "resource_body",
          name: resourceName,
          content: body.trim(),
          meta: {
            parameters: params.split(",").map(p => p.trim()).filter(Boolean),
            returnType: returnType || "void",
            file: filePath,
            servicePath: servicePath,
            httpMethod: method
          }
        });
      }
    }

    return chunks;
  }

  // Save chunks to JSON file in tests folder
  private saveChunksToJson(chunks: Chunk[], ballerinaDir: string): string {
    const testsDir = "tests";
    mkdirSync(testsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedDirName = path.basename(ballerinaDir).replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `chunks_${sanitizedDirName}_${timestamp}.json`;
    const filepath = path.join(testsDir, filename);

    const jsonOutput = {
      metadata: {
        sourceDirectory: ballerinaDir,
        generatedAt: new Date().toISOString(),
        totalChunks: chunks.length,
        chunkTypes: this.getChunkTypesStatistics(chunks)
      },
      chunks: chunks
    };

    writeFileSync(filepath, JSON.stringify(jsonOutput, null, 2), "utf-8");
    console.log(`Chunks saved to JSON: ${filepath}`);
    return filepath;
  }

  // Get statistics about chunk types
  private getChunkTypesStatistics(chunks: Chunk[]): Record<string, number> {
    const stats: Record<string, number> = {};
    chunks.forEach(chunk => {
      stats[chunk.type] = (stats[chunk.type] || 0) + 1;
    });
    return stats;
  }

  // Get embeddings from VoyageAI
  private async getEmbeddings(texts: string[]): Promise<number[][]> {
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

  private async createCollection(): Promise<void> {
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

  private prepareTextForEmbedding(chunk: Chunk): string {
    let text = `Type: ${chunk.type}\n`;

    if (chunk.name) text += `Name: ${chunk.name}\n`;
    if (chunk.meta?.servicePath) text += `Service: ${chunk.meta.servicePath}\n`;
    if (chunk.meta?.httpMethod) text += `HTTP Method: ${chunk.meta.httpMethod}\n`;
    if (chunk.meta?.returnType && chunk.meta.returnType !== "void") {
      text += `Returns: ${chunk.meta.returnType}\n`;
    }

    text += `Content:\n${chunk.content}`;
    return text;
  }

  async indexChunks(ballerinaDir: string): Promise<void> {
    console.log("Loading Ballerina files...");
    const ballerinaFiles = this.loadBallerinaFiles(ballerinaDir);

    console.log("Chunking code...");
    let allChunks: Chunk[] = [];
    for (const file of ballerinaFiles) {
      const code = readFileSync(file, "utf-8");
      allChunks = allChunks.concat(this.chunkBallerinaCode(code, file));
    }

    console.log(`Generated ${allChunks.length} chunks`);

    // Save chunks to JSON file in tests folder
    this.saveChunksToJson(allChunks, ballerinaDir);

    await this.createCollection();

    const batchSize = 10;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      const texts = batch.map(chunk => this.prepareTextForEmbedding(chunk));
      const embeddings = await this.getEmbeddings(texts);

      const points = batch
        .map((chunk, index) => {
          const embedding = embeddings[index];
          if (!embedding) return null;
          return {
            id: i + index + 1,
            vector: embedding,
            payload: {
              type: chunk.type,
              name: chunk.name || null,
              content: chunk.content,
              meta: chunk.meta,
              text_for_embedding: texts[index] || ""
            }
          };
        })
        .filter((point): point is { id: number; vector: number[]; payload: any } => point !== null);

      await this.qdrantClient.upsert(this.collectionName, {
        wait: true,
        points: points
      });
    }

    console.log("Successfully indexed all chunks!");
  }

  // New method to only chunk and save without indexing
  async chunkAndSave(ballerinaDir: string): Promise<string> {
    console.log("Loading Ballerina files...");
    const ballerinaFiles = this.loadBallerinaFiles(ballerinaDir);

    console.log("Chunking code...");
    let allChunks: Chunk[] = [];
    for (const file of ballerinaFiles) {
      const code = readFileSync(file, "utf-8");
      allChunks = allChunks.concat(this.chunkBallerinaCode(code, file));
    }

    console.log(`Generated ${allChunks.length} chunks`);

    // Save chunks to JSON file in tests folder
    const jsonFilePath = this.saveChunksToJson(allChunks, ballerinaDir);

    console.log("Chunking completed and saved to JSON!");
    return jsonFilePath;
  }

  async queryRelevantChunks(userQuery: string, limit: number = 5): Promise<any[]> {
    const queryEmbedding = await this.getEmbeddings([userQuery]);
    if (!queryEmbedding[0]) {
      throw new Error("Failed to generate embedding for the query.");
    }
    const searchResult = await this.qdrantClient.search(this.collectionName, {
      vector: queryEmbedding[0],
      limit: limit,
      with_payload: true
    });
    return searchResult;
  }

  async saveContextToFile(userQuery: string, limit: number = 5, outputDir: string = "context_files"): Promise<string> {
    const results = await this.queryRelevantChunks(userQuery, limit);
    mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedQuery = userQuery.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const filename = `context_${sanitizedQuery}_${timestamp}.txt`;
    const filepath = path.join(outputDir, filename);

    let contextContent = `Query: ${userQuery}\n`;
    contextContent += `Generated at: ${new Date().toISOString()}\n`;
    contextContent += `Number of relevant chunks: ${results.length}\n`;
    contextContent += "=".repeat(80) + "\n\n";

    results.forEach((result, index) => {
      const payload = result.payload;
      contextContent += `CHUNK ${index + 1} (Score: ${result.score.toFixed(4)})\n`;
      contextContent += "-".repeat(50) + "\n";
      contextContent += `Type: ${payload.type}\n`;
      if (payload.name) contextContent += `Name: ${payload.name}\n`;
      if (payload.meta?.file) contextContent += `File: ${payload.meta.file}\n`;
      if (payload.meta?.startLine) {
        contextContent += `Line: ${payload.meta.startLine}${payload.meta?.endLine ? `-${payload.meta.endLine}` : ""}\n`;
      }
      if (payload.meta?.servicePath) contextContent += `Service: ${payload.meta.servicePath}\n`;
      if (payload.meta?.httpMethod) contextContent += `HTTP Method: ${payload.meta.httpMethod}\n`;

      contextContent += `\nContent:\n${payload.content}\n\n`;
      contextContent += "=".repeat(80) + "\n\n";
    });

    writeFileSync(filepath, contextContent, "utf-8");
    console.log(`Context saved to: ${filepath}`);
    return filepath;
  }

  async getCollectionInfo(): Promise<any> {
    return await this.qdrantClient.getCollection(this.collectionName);
  }
}

// Usage example and CLI interface
async function main() {
  const voyageApiKey = process.env.VOYAGE_API_KEY;
  const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";

  if (!voyageApiKey) {
    console.error("Please set VOYAGE_API_KEY environment variable");
    process.exit(1);
  }

  const ragSystem = new BallerinaRAGSystem(qdrantUrl, voyageApiKey);

  const command = process.argv[2];
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

  try {
    if (!command) {
      // Default behavior when running `bun run .`
      const ballerinaDir = "ballerina";
      console.log(`No command provided. Running default pipeline...`);
      await ragSystem.indexChunks(ballerinaDir);

      // User query
      const defaultQuery = process.env.DEFAULT_QUERY || "list all functions";
      console.log(`Running default query: "${defaultQuery}"`);
      await ragSystem.saveContextToFile(defaultQuery, 5);
      console.log("Finished indexing and saved default context file.");
      return;
    }

    switch (command) {
      case "index":
        await ragSystem.indexChunks(arg1 || "ballerina");
        break;

      case "chunk":
        // New command to only chunk and save without indexing
        await ragSystem.chunkAndSave(arg1 || "ballerina");
        break;

      case "query":
        if (!arg1) {
          console.error("Please provide a query");
          process.exit(1);
        }
        await ragSystem.saveContextToFile(arg1, parseInt(arg2 ?? "5"));
        break;

      case "info":
        const info = await ragSystem.getCollectionInfo();
        console.log("Collection info:", JSON.stringify(info, null, 2));
        break;

      default:
        console.log("Usage:");
        console.log("  bun run .               # Run default pipeline");
        console.log("  bun run . index [dir]   # Index a specific dir");
        console.log("  bun run . chunk [dir]   # Only chunk and save to JSON");
        console.log("  bun run . query \"q\" [n] # Query with text");
        console.log("  bun run . info          # Show Qdrant info");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { BallerinaRAGSystem };
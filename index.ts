import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { QdrantClient } from "@qdrant/js-client-rest";

interface Chunk {
  content: string;
  metadata: {
    type: string;
    name: string | null;
    line: number;
    file: string;
    [key: string]: any;
  };
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
      checkCompatibility: false
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

  // Improved chunking logic for Ballerina code
  private chunkBallerinaCode(code: string, filePath: string): Chunk[] {
    const chunks: Chunk[] = [];
    let match: RegExpExecArray | null;

    // 1. Import statements
    const importRegex = /import\s+[^;]+;/g;
    while ((match = importRegex.exec(code)) !== null) {
      const startLine = this.getLineNumber(code, match.index);
      chunks.push({
        content: match[0],
        metadata: {
          type: "import",
          name: null,
          line: startLine,
          file: path.basename(filePath)
        }
      });
    }

    // 2. Configurable variables
    const configurableRegex = /configurable\s+[\w:]+\s+\w+\s*=\s*[^;]+;/g;
    while ((match = configurableRegex.exec(code)) !== null) {
      const startLine = this.getLineNumber(code, match.index);
      const variableMatch = match[0].match(/configurable\s+[\w:]+\s+(\w+)/);
      const variableName = variableMatch ? variableMatch[1] : null;

      chunks.push({
        content: match[0],
        metadata: {
          type: "configurable_variable",
          name: variableName ?? null,
          line: startLine,
          file: path.basename(filePath)
        }
      });
    }

    // 3. Module-level variables
    const moduleVariableRegex = /^(?!.*(?:function|service|resource|type|import|configurable)).*?(?:final\s+)?[\w:]+\s+(\w+)\s*=\s*[^;]+;/gm;
    while ((match = moduleVariableRegex.exec(code)) !== null) {
      const startLine = this.getLineNumber(code, match.index);
      const variableMatch = match[0].match(/(?:final\s+)?[\w:]+\s+(\w+)/);
      const variableName = variableMatch ? variableMatch[1] : null;

      chunks.push({
        content: match[0].trim(),
        metadata: {
          type: "module_variable",
          name: variableName ?? null,
          line: startLine,
          file: path.basename(filePath)
        }
      });
    }

    // 4. Type definitions (including records, enums, classes)
    const typeRegex = /(public\s+)?(type\s+(\w+)\s+([^;{]+(?:;|\{[^}]*\}));?)/g;
    while ((match = typeRegex.exec(code)) !== null) {
      const typeName = match[3];
      const startLine = this.getLineNumber(code, match.index);

      chunks.push({
        content: match[2] ?? "",
        metadata: {
          type: "type_definition",
          name: typeName ?? null,
          line: startLine,
          file: path.basename(filePath),
          visibility: match[1] ? "public" : "private"
        }
      });
    }

    // 5. Standalone functions (not inside services)
    const functionRegex = /^(?!.*resource).*?((?:public\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s+returns\s*([^\{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\})/gm;
    while ((match = functionRegex.exec(code)) !== null) {
      // Check if this function is inside a service by looking backwards
      const beforeFunction = code.substring(0, match.index);
      const lastServiceStart = beforeFunction.lastIndexOf('service');
      const lastServiceEnd = beforeFunction.lastIndexOf('}');

      // Skip if function is inside a service
      if (lastServiceStart > lastServiceEnd && lastServiceStart !== -1) {
        continue;
      }

      const functionName = match[2];
      const params = match[3] || "";
      const returnType = (match[4] || "").trim();
      const body = match[5] || "";
      const startLine = this.getLineNumber(code, match.index);
      const endLine = this.getLineNumber(code, match.index + match[0].length);

      chunks.push({
        content: match[1] ?? "",
        metadata: {
          type: "function",
          name: functionName ?? null,
          line: startLine,
          file: path.basename(filePath),
          endLine,
          parameters: params.split(",").map(p => p.trim()).filter(Boolean),
          returnType: returnType || "void",
          visibility: match[1] && match[1].includes("public") ? "public" : "private"
        }
      });
    }

    // 6. Services and their resources
    const serviceRegex = /service\s+(\/[\w\d_/-]*|\w+)(?:\s+on\s+([^{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
    while ((match = serviceRegex.exec(code)) !== null) {
      const servicePath = match[1];
      const listener = match[2] ? match[2].trim() : null;
      const serviceBody = match[3] || "";
      const startLine = this.getLineNumber(code, match.index);

      // Add service definition as a chunk
      chunks.push({
        content: `service ${servicePath}${listener ? ` on ${listener}` : ""}`,
        metadata: {
          type: "service",
          name: (servicePath ?? "").replace(/^\//, "") || "unnamed_service",
          line: startLine,
          file: path.basename(filePath),
          path: servicePath,
          listener: listener
        }
      });

      // Extract resources from service body
      const resourceRegex = /resource\s+function\s+(\w+)\s+([^\s(]*)\s*\(([^)]*)\)(?:\s*returns\s*([^\{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
      let resourceMatch: RegExpExecArray | null;

      while ((resourceMatch = resourceRegex.exec(serviceBody)) !== null) {
        const httpMethod = resourceMatch[1];
        const pathPart = resourceMatch[2] || "";
        const params = resourceMatch[3] || "";
        const returnType = (resourceMatch[4] || "").trim();
        const body = resourceMatch[5] || "";

        // Calculate line number relative to the service body
        const resourceStartInService = resourceMatch.index;
        const serviceBodyStartLine = startLine + 1; // Service body starts after the service declaration
        const resourceLine = serviceBodyStartLine + serviceBody.substring(0, resourceStartInService).split('\n').length - 1;

        const resourceName = `${httpMethod} ${pathPart}`.trim();
        const fullPath = servicePath + (pathPart.startsWith('/') ? pathPart : `/${pathPart}`);

        chunks.push({
          content: `resource function ${httpMethod} ${pathPart}(${params})${returnType ? ` returns ${returnType}` : ""} {\n${body.trim()}\n}`,
          metadata: {
            type: "resource",
            name: resourceName,
            line: resourceLine,
            file: path.basename(filePath),
            servicePath: servicePath,
            serviceListener: listener,
            httpMethod: httpMethod,
            resourcePath: pathPart,
            fullPath: fullPath,
            parameters: params.split(",").map(p => p.trim()).filter(Boolean),
            returnType: returnType || "void"
          }
        });
      }
    }

    // 7. Classes and class methods
    const classRegex = /((?:public\s+)?class\s+(\w+)(?:\s*\{[^}]*\}|\s*;))/g;
    while ((match = classRegex.exec(code)) !== null) {
      const className = match[2];
      const startLine = this.getLineNumber(code, match.index);

      chunks.push({
        content: match[1] ?? "",
        metadata: {
          type: "class",
          name: className ?? null,
          line: startLine,
          file: path.basename(filePath),
          visibility: match[1] && match[1].includes("public") ? "public" : "private"
        }
      });
    }

    // 8. Constants and final variables
    const constantRegex = /^(final\s+[\w:]+\s+(\w+)\s*=\s*[^;]+;)/gm;
    while ((match = constantRegex.exec(code)) !== null) {
      const constantName = match[2];
      const startLine = this.getLineNumber(code, match.index);

      chunks.push({
        content: match[1] ?? "",
        metadata: {
          type: "constant",
          name: constantName ?? null,
          line: startLine,
          file: path.basename(filePath)
        }
      });
    }

    return chunks;
  }

  // Save chunks to JSON file in tests folder with full output
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

    console.log(`File saved: ${filepath}`);

    return filepath;
  }



  // Get statistics about chunk types - updated for new structure
  private getChunkTypesStatistics(chunks: Chunk[]): Record<string, number> {
    const stats: Record<string, number> = {};
    chunks.forEach(chunk => {
      stats[chunk.metadata.type] = (stats[chunk.metadata.type] || 0) + 1;
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

  // Updated to use new chunk structure
  private prepareTextForEmbedding(chunk: Chunk): string {
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
              content: chunk.content,
              metadata: chunk.metadata,
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

    let contextContent = `Query: ${userQuery}\nGenerated at: ${new Date().toISOString()}\n\n`;
    results.forEach((result, index) => {
      contextContent += result.payload.content + "\n\n";
    });

    writeFileSync(filepath, contextContent, "utf-8");

    console.log(`Query matches saved: ${filepath}`);

    return filepath;
  }


  async getCollectionInfo(): Promise<any> {
    return await this.qdrantClient.getCollection(this.collectionName);
  }
}

// Process user queries from text file
async function processUserQueries(ragSystem: BallerinaRAGSystem, queriesFilePath: string, limit: number = 5): Promise<void> {
  try {
    if (!statSync(queriesFilePath).isFile()) return;

    const fileContent = readFileSync(queriesFilePath, "utf-8");
    const queries = fileContent
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"));

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      await ragSystem.saveContextToFile(
        query ?? "",
        limit,
        `context_files/query_${i + 1}`
      );
    }
  } catch (error) {
    console.error(error);
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
      const ballerinaDir = "ballerina";
      console.log(`No command provided. Running default pipeline...`);
      await ragSystem.indexChunks(ballerinaDir);

      const queriesFile = "user_queries.txt";
      try {
        if (statSync(queriesFile).isFile()) {
          console.log(`\nFound ${queriesFile}, processing user queries...`);
          await processUserQueries(ragSystem, queriesFile, 5);
        }
      } catch (error) {
        const defaultQuery = process.env.DEFAULT_QUERY || "list all functions";
        console.log(`Running default query: "${defaultQuery}"`);
        await ragSystem.saveContextToFile(defaultQuery, 5);
      }

      console.log("Finished processing!");
      return;
    }

    switch (command) {
      case "index":
        await ragSystem.indexChunks(arg1 || "ballerina");
        break;

      case "chunk":
        await ragSystem.chunkAndSave(arg1 || "ballerina");
        break;

      case "query":
        if (!arg1) {
          console.error("Please provide a query");
          process.exit(1);
        }
        await ragSystem.saveContextToFile(arg1, parseInt(arg2 ?? "5"));
        break;

      case "queries":
        const queriesFile = arg1 || "user_queries.txt";
        const limit = parseInt(arg2 ?? "5");
        await processUserQueries(ragSystem, queriesFile, limit);
        break;

      case "info":
        const info = await ragSystem.getCollectionInfo();
        console.log("Collection info:", JSON.stringify(info, null, 2));
        break;

      default:
        console.log("Usage:");
        console.log("  bun run .                    # Run default pipeline");
        console.log("  bun run . index [dir]        # Index a specific dir");
        console.log("  bun run . chunk [dir]        # Only chunk and save to JSON");
        console.log("  bun run . query \"q\" [n]    # Query with text");
        console.log("  bun run . queries [file] [n] # Process queries from file");
        console.log("  bun run . info               # Show Qdrant info");
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
import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import path from "path";
import type { QueryWithId } from "./types";
import { BallerinaRAGSystem } from "./rag_system";

export class QueryProcessor {
    private ragSystem: BallerinaRAGSystem;

    constructor(ragSystem: BallerinaRAGSystem) {
        this.ragSystem = ragSystem;
    }

    // Enhanced saveContextToFile with better formatting and chunk information
    async saveContextToFile(userQuery: string, limit: number = 5, outputDir: string = "context_files", queryId?: number): Promise<string> {
        const results = await this.ragSystem.queryRelevantChunks(userQuery, limit);
        mkdirSync(outputDir, { recursive: true });

        let filename: string;
        if (queryId !== undefined) {
            filename = `${queryId}.txt`;
        } else {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const sanitizedQuery = userQuery.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
            filename = `context_${sanitizedQuery}_${timestamp}.txt`;
        }

        const filepath = path.join(outputDir, filename);

        // Header section
        let contextContent = "# RAG QUERY RESULTS\n";
        contextContent += "================================================================================\n";
        contextContent += `Query: ${userQuery}\n`;
        contextContent += `Generated: ${new Date().toISOString()}\n`;
        contextContent += `Total Relevant Chunks: ${results.length}\n`;
        contextContent += `Limit Applied: ${limit}\n`;
        contextContent += "================================================================================\n\n";

        // Process each result chunk
        results.forEach((result, index) => {
            const metadata = result.payload.metadata;
            const score = result.score;
            const content = result.payload.content;

            contextContent += `## CHUNK ${index + 1}\n`;
            contextContent += "----------------------------------------\n";
            contextContent += `**Relevance Score:** ${score.toFixed(6)}\n`;
            contextContent += `**Type:** ${metadata.type}\n`;

            // Handle different metadata fields based on chunk type
            if (metadata.name) {
                contextContent += `**Name:** ${metadata.name}\n`;
            }

            contextContent += `**File:** ${metadata.file}\n`;

            // Enhanced line information
            if (metadata.endLine && metadata.endLine !== metadata.line) {
                contextContent += `**Lines:** ${metadata.line}-${metadata.endLine} (${metadata.endLine - metadata.line + 1} lines)\n`;
            } else {
                contextContent += `**Line:** ${metadata.line}\n`;
            }

            // Add position information if available
            if (metadata.position) {
                const pos = metadata.position;
                contextContent += `**Position:** Start(${pos.start.line}:${pos.start.column}) - End(${pos.end.line}:${pos.end.column})\n`;
            }

            // Add type-specific information
            switch (metadata.type) {
                case 'function':
                    if (metadata.parameters) {
                        contextContent += `**Parameters:** ${metadata.parameters.join(', ')}\n`;
                    }
                    if (metadata.returnType) {
                        contextContent += `**Return Type:** ${metadata.returnType}\n`;
                    }
                    if (metadata.visibility) {
                        contextContent += `**Visibility:** ${metadata.visibility}\n`;
                    }
                    break;

                case 'service':
                    if (metadata.path) {
                        contextContent += `**Service Path:** ${metadata.path}\n`;
                    }
                    if (metadata.listener) {
                        contextContent += `**Listener:** ${metadata.listener}\n`;
                    }
                    break;

                case 'resource':
                    if (metadata.httpMethod) {
                        contextContent += `**HTTP Method:** ${metadata.httpMethod.toUpperCase()}\n`;
                    }
                    if (metadata.resourcePath) {
                        contextContent += `**Resource Path:** ${metadata.resourcePath}\n`;
                    }
                    if (metadata.fullPath) {
                        contextContent += `**Full Path:** ${metadata.fullPath}\n`;
                    }
                    if (metadata.servicePath) {
                        contextContent += `**Service:** ${metadata.servicePath}\n`;
                    }
                    if (metadata.parameters && metadata.parameters.length > 0) {
                        contextContent += `**Parameters:** ${metadata.parameters.join(', ')}\n`;
                    }
                    if (metadata.returnType) {
                        contextContent += `**Return Type:** ${metadata.returnType}\n`;
                    }
                    break;

                case 'type_definition':
                    if (metadata.visibility) {
                        contextContent += `**Visibility:** ${metadata.visibility}\n`;
                    }
                    break;

                case 'configurable_variable':
                case 'module_variable':
                    // Variable-specific information already covered by name
                    break;

                case 'import':
                    // Import information is in the content
                    break;
            }

            contextContent += "\n**Content:**\n";
            contextContent += "```ballerina\n";
            contextContent += content;
            contextContent += "\n```\n";

            // Add separator between chunks (except for the last one)
            if (index < results.length - 1) {
                contextContent += "\n" + "=".repeat(80) + "\n\n";
            }
        });

        // Footer section
        contextContent += "\n" + "=".repeat(80) + "\n";
        contextContent += "# END OF RESULTS\n";
        contextContent += `Total chunks processed: ${results.length}\n`;
        contextContent += `File saved: ${new Date().toISOString()}\n`;

        writeFileSync(filepath, contextContent, "utf-8");

        console.log(`✓ Query results saved: ${filepath} (${results.length} chunks, ${Math.round(contextContent.length / 1024)}KB)`);
        return filepath;
    }

    // Enhanced query processing with better error handling and progress tracking
    async processUserQueries(queriesFilePath: string, limit: number = 5): Promise<void> {
        try {
            if (!statSync(queriesFilePath).isFile()) {
                console.error(`File not found: ${queriesFilePath}`);
                return;
            }

            const fileContent = readFileSync(queriesFilePath, "utf-8");
            let queries: Array<{ id?: number, query: string }> = [];

            // Try to parse as JSON first
            try {
                const parsedData = JSON.parse(fileContent);

                if (Array.isArray(parsedData) && parsedData.length > 0 &&
                    parsedData[0].id !== undefined && parsedData[0].query !== undefined) {

                    queries = parsedData.map((item: QueryWithId) => ({
                        id: item.id,
                        query: item.query
                    }));

                    console.log(`Processing ${queries.length} queries from JSON format...`);
                } else {
                    throw new Error("Invalid JSON format");
                }
            } catch (jsonError) {
                // Fall back to text file processing
                console.log("Processing as text file (one query per line)...");

                queries = fileContent
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith("#"))
                    .map((query, index) => ({ id: index + 1, query }));
            }

            if (queries.length === 0) {
                console.warn("No valid queries found in the file");
                return;
            }

            // Process each query with progress tracking
            for (let i = 0; i < queries.length; i++) {
                const queryObj = queries[i];
                if (!queryObj) {
                    console.warn(`Query at index ${i} is undefined, skipping.`);
                    continue;
                }
                const { id, query } = queryObj;
                const progress = `[${i + 1}/${queries.length}]`;

                console.log(`${progress} Processing Query ${id}: ${query.substring(0, 60)}${query.length > 60 ? '...' : ''}`);

                try {
                    await this.saveContextToFile(
                        query,
                        limit,
                        "context_files",
                        id
                    );
                } catch (error) {
                    console.error(`Error processing query ${id}:`, error);
                }
            }

            console.log(`Completed processing ${queries.length} queries`);

        } catch (error) {
            console.error("Error processing queries file:", error);
            throw error;
        }
    }

    // New method to get summary of saved files
    async getSavedFilesSummary(outputDir: string = "context_files"): Promise<void> {
        try {
            const files = require("fs").readdirSync(outputDir);
            console.log(`Found ${files.length} saved context files in ${outputDir}/`);

            files.forEach((file: string) => {
                const filepath = path.join(outputDir, file);
                const stats = statSync(filepath);
                console.log(`  - ${file} (${Math.round(stats.size / 1024)}KB, modified: ${stats.mtime.toISOString()})`);
            });
        } catch (error) {
            console.log(`No context files found in ${outputDir}/`);
        }
    }
}
import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import path from "path";
import type { QueryWithId } from "./types";
import { BallerinaRAGSystem } from "./rag_system";

export class QueryProcessor {
    private ragSystem: BallerinaRAGSystem;

    constructor(ragSystem: BallerinaRAGSystem) {
        this.ragSystem = ragSystem;
    }

    // Modified to accept queryId parameter for custom filename and include detailed information
    async saveContextToFile(userQuery: string, limit: number = 5, outputDir: string = "context_files", queryId?: number): Promise<string> {
        const results = await this.ragSystem.queryRelevantChunks(userQuery, limit);
        mkdirSync(outputDir, { recursive: true });

        let filename: string;
        if (queryId !== undefined) {
            // Use query ID as filename if provided
            filename = `${queryId}.txt`;
        } else {
            // Use the original naming convention
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const sanitizedQuery = userQuery.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
            filename = `context_${sanitizedQuery}_${timestamp}.txt`;
        }

        const filepath = path.join(outputDir, filename);

        let contextContent = `Query: ${userQuery}\n`;
        contextContent += `Generated at: ${new Date().toISOString()}\n`;
        contextContent += `Number of relevant chunks: ${results.length}\n`;

        results.forEach((result, index) => {
            const metadata = result.payload.metadata;
            const score = result.score;

            contextContent += "================================================================================\n";
            contextContent += `CHUNK ${index + 1} (Score: ${score.toFixed(4)})\n`;
            contextContent += "--------------------------------------------------\n";
            contextContent += `Type: ${metadata.type}\n`;

            if (metadata.name) {
                contextContent += `Name: ${metadata.name}\n`;
            }

            contextContent += `File: ${metadata.file}\n`;

            // Format line information
            if (metadata.endLine) {
                contextContent += `Line: ${metadata.line}-${metadata.endLine}\n`;
            } else {
                contextContent += `Line: ${metadata.line}\n`;
            }

            contextContent += `Content:\n`;
            contextContent += result.payload.content + "\n";

            // Don't add the separator line after the last chunk
            if (index < results.length - 1) {
                contextContent += "================================================================================\n";
            }
        });

        // Add final separator
        contextContent += "================================================================================\n";

        writeFileSync(filepath, contextContent, "utf-8");

        console.log(`Query matches saved: ${filepath} (${results.length} results)`);
        return filepath;
    }

    // Modified function to handle both text file and JSON array formats
    async processUserQueries(queriesFilePath: string, limit: number = 5): Promise<void> {
        try {
            if (!statSync(queriesFilePath).isFile()) return;

            const fileContent = readFileSync(queriesFilePath, "utf-8");

            // Check if the file content is JSON format
            try {
                const parsedData = JSON.parse(fileContent);

                // Check if it's an array of objects with id and query properties
                if (Array.isArray(parsedData) && parsedData.length > 0 &&
                    parsedData[0].id !== undefined && parsedData[0].query !== undefined) {

                    console.log(`Processing ${parsedData.length} queries from JSON format...`);

                    // Process each query with its ID
                    for (const queryObj of parsedData) {
                        const { id, query } = queryObj as QueryWithId;
                        console.log(`Processing Query ID ${id}: ${query.substring(0, 50)}...`);

                        await this.saveContextToFile(
                            query,
                            limit,
                            "context_files",
                            id  // Pass the query ID for filename
                        );
                    }

                    return;
                }
            } catch (jsonError) {
                // If JSON parsing fails, fall back to text processing
                console.log("File is not in JSON format, processing as text file...");
            }

            // Original text file processing
            const queries = fileContent
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line && !line.startsWith("#"));

            for (let i = 0; i < queries.length; i++) {
                const query = queries[i];
                await this.saveContextToFile(
                    query ?? "",
                    limit,
                    `context_files/query_${i + 1}`
                );
            }
        } catch (error) {
            console.error("Error processing queries:", error);
        }
    }
}
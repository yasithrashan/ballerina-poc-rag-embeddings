import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import * as fs from "fs";
import path from "path";
import type { RelevantChunk } from "../types";

interface RelevantChunksData {
    userQuery: string;
    relevantChunks: RelevantChunk[];
}

interface CodeExpanderParams {
    chunksFilePath: string;
    projectPath: string;
    outputDir?: string;
}

export async function expandCode(params: CodeExpanderParams): Promise<string> {
    const { chunksFilePath, projectPath, outputDir = "expand_code" } = params;

    // Validate chunks file exists
    if (!fs.existsSync(chunksFilePath)) {
        throw new Error(`Relevant chunks file not found: ${chunksFilePath}`);
    }

    // Validate project path exists
    if (!fs.existsSync(projectPath)) {
        throw new Error(`Project path not found: ${projectPath}`);
    }

    try {
        // Read the relevant chunks JSON file
        const relevantChunksData: RelevantChunksData = JSON.parse(
            fs.readFileSync(chunksFilePath, "utf-8")
        );

        // Extract relevant information for context
        const userQuery = relevantChunksData.userQuery;
        const chunks = relevantChunksData.relevantChunks;

        // Get all .bal files
        const balFiles = fs.readdirSync(projectPath).filter(f => f.endsWith(".bal"));

        if (balFiles.length === 0) {
            throw new Error("No .bal files found in project path.");
        }

        // Read all .bal file contents
        let allBalContent = "## Complete Source Files\n\n";
        for (const file of balFiles) {
            const fullPath = path.join(projectPath, file);
            const content = fs.readFileSync(fullPath, "utf-8");
            allBalContent += `### File: ${file}\n\n\`\`\`ballerina\n${content}\n\`\`\`\n\n`;
        }

        // Build context from relevant chunks
        let chunksContext = "## Relevant Code Chunks\n\n";

        chunks.forEach((chunk, index) => {
            chunksContext += `### Chunk ${index + 1} (Score: ${chunk.score.toFixed(4)})\n`;
            chunksContext += `**File:** ${chunk.payload.file}\n`;
            chunksContext += `**Type:** ${chunk.payload.metadata.type}\n`;
            chunksContext += `**Name:** ${chunk.payload.metadata.name}\n`;
            chunksContext += `**Lines:** ${chunk.payload.metadata.line}-${chunk.payload.metadata.endLine}\n\n`;
            chunksContext += `\`\`\`ballerina\n${chunk.payload.content}\n\`\`\`\n\n`;
        });

        console.log(chunksContext);
        console.log(allBalContent);

        // Create comprehensive system prompt for code expansion
        const systemPrompt = `
You are a code analysis assistant that helps developers understand and organize relevant Ballerina code based on their queries. Your task is to analyze Ballerina source code files, identify code relevant to a user's question, and present it in a structured, organized format.

Here are the source code files you should analyze:

<source_code_files>
${allBalContent}
</source_code_files>

Here are relevant chunks that provide guidance on which parts of the codebase are most important:

<relevant_chunks>
${chunksContext}
</relevant_chunks>

Here is the user's query:

<user_query>
${userQuery}
</user_query>

## Instructions

Your task is to expand and organize the relevant Ballerina code based on the user query and relevant chunks. Do NOT modify the code - only expand and organize existing code that is relevant.

## What to Include
- Ballerina code that directly relates to the user query and relevant chunks
- Related dependencies: imports, helper functions, connected services and resources
- Type definitions, records, and data structures used by the relevant code
- Configurable variables and constants
- Module-level variables and their definitions
- Service definitions, resource functions, and listener configurations
- Utility functions, connectors, and helper modules
- Any additional matching resources that complement the main code

## What to Exclude
- Code that is not directly relevant to the user query
- Incomplete code fragments that lack proper context
- Unrelated functions or services

## Output Format

Structure your response using markdown with exactly these sections in this order (omit any section that has no relevant content):

## Imports
## Types
## Configuration Variables
## Module Level Variables
## Services
## Resources
## Matching Resources

Present all code using proper markdown code blocks with Ballerina syntax highlighting:

\`\`\`ballerina
import ballerina/http;
import ballerina/log;
\`\`\`

\`\`\`ballerina
type User record {
    string id;
    string name;
    string email;
};
\`\`\`

Focus on providing complete, actionable Ballerina code snippets with full context. If code references other functions, services, or types, include those as well to provide complete understanding.

IMPORTANT: Do not modify the existing code. Only expand and organize the relevant existing code from the source files.
`;

        // Generate expanded code using Claude
        const { text } = await generateText({
            model: anthropic('claude-3-5-sonnet-20240620'),
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: `Please analyze the provided Ballerina code files and relevant chunks to expand the code relevant to the query: "${userQuery}"`
                }
            ],
            maxOutputTokens: 4096 * 2,
        });

        // Create report with query and organized code sections
        const timestamp = new Date().toISOString();
        const chunkCount = chunks.length;
        const filesInvolved = [...new Set(chunks.map(chunk => chunk.payload.file))];

        const reportContent = `# Ballerina Code Expansion

**Query:** ${userQuery}

---

${text}

---

*Code expansion generated from ${chunkCount} relevant chunks across ${filesInvolved.length} files*
`;

        // Ensure output directory exists
        const outputDirPath = path.resolve(outputDir);
        if (!fs.existsSync(outputDirPath)) {
            fs.mkdirSync(outputDirPath, { recursive: true });
        }

        // Create filename with timestamp
        const timestampForFile = timestamp.replace(/[:.]/g, "-");
        const outputPath = path.join(outputDirPath, `code_expansion_${timestampForFile}.md`);

        // Write the report
        fs.writeFileSync(outputPath, reportContent, "utf-8");

        console.log("Code expansion completed successfully!");
        console.log(`Output saved to: ${outputPath}`);
        console.log(`Processed ${balFiles.length} .bal files and ${chunkCount} relevant chunks`);

        return outputPath;

    } catch (error) {
        console.error("Failed to expand code:", error);
        throw error;
    }
}

// Example usage
export async function main() {
    try {
        const result = await expandCode({
            chunksFilePath: "./relevant_chunks/1.json",
            projectPath: "./ballerina",
            outputDir: "expand_code"
        });

        console.log(`Code expansion completed: ${result}`);
    } catch (error) {
        console.error("Error:", error);
    }
}

main();
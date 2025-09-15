import { generateText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import * as fs from "fs";
import type { Library } from "../../libs/types";
import { LANGLIBS } from "../../libs/langlibs";
import path from "path";
import { z } from "zod";

interface QueryItem {
    id: number;
    query: string;
}

// Define constants
const ANTHROPIC_SONNET_4 = "claude-3-5-sonnet-20241022";

// Create the anthropic client
const anthropicClient = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Helper function for getting the client
function getAnthropicClient(modelName: string) {
    return anthropicClient(modelName);
}

const predefinedUserQueries = [
    {
        id: 1,
        query: "Update the pagination logic so it validates 'page' and 'limit' values, returning a 400 Bad Request if they are less than or equal to zero."
    },
    {
        id: 2,
        query: "Modify the PUT /books/{bookId} endpoint to reuse the validation logic (validateAndFormatBook) so updates also check for empty titles, negative prices, etc."
    },
    {
        id: 3,
        query: "Modify the update books endpoint to prevent duplicate ISBNs and return a 409 Conflict error if a book with the same ISBN already exists."
    },
    {
        id: 4,
        query: "Extend the category service to also support update and delete operations for categories."
    },
    {
        id: 5,
        query: "Standardize the error responses so they always return a JSON object with an error message (e.g., { \"error\": \"Book not found\" }) instead of just plain HTTP status codes."
    },
    {
        id: 6,
        query: "Add a new HTTP server to the current implementation."
    }
];

// Helper function to ensure directories exist
function ensureDirectoryExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Helper function to load API docs for a specific query
function loadApiDocs(queryId: number): Library {
    const apiDocsPath = path.join(process.cwd(), "api_docs", `${queryId}.json`);
    if (!fs.existsSync(apiDocsPath)) {
        throw new Error(`API docs file not found: ${apiDocsPath}`);
    }
    return JSON.parse(fs.readFileSync(apiDocsPath, "utf-8")) as Library;
}

// Helper function to extract relevant context based on user query
function extractRelevantContext(userQuery: string, fileMemory: Record<string, string>) {
    const query = userQuery.toLowerCase();
    const relevantContent: Record<string, string> = {};

    // Define keywords that indicate what imports/context is needed
    const contextKeywords = {
        http: ['http', 'server', 'endpoint', 'service', 'request', 'response', 'listener'],
        database: ['sql', 'database', 'query', 'connection', 'table', 'mysql', 'postgresql'],
        validation: ['validation', 'validate', 'constraint', 'check'],
        error: ['error', 'exception', 'handle'],
        json: ['json', 'parse', 'stringify'],
        pagination: ['pagination', 'page', 'limit', 'offset'],
        category: ['category', 'categories'],
        book: ['book', 'books', 'isbn'],
        client: ['client', 'connector']
    };

    // Determine which contexts are relevant
    const relevantContexts = new Set<string>();
    Object.entries(contextKeywords).forEach(([context, keywords]) => {
        if (keywords.some(keyword => query.includes(keyword))) {
            relevantContexts.add(context);
        }
    });

    // Extract only relevant parts from each file
    Object.entries(fileMemory).forEach(([filePath, content]) => {
        const lines = content.split('\n');
        const relevantLines: string[] = [];
        let inRelevantBlock = false;
        let currentFunction = '';

        lines.forEach((line, index) => {
            const trimmedLine = line.trim().toLowerCase();

            // Always include import statements if they're relevant
            if (line.trim().startsWith('import ')) {
                const importLine = line.trim().toLowerCase();
                if (Array.from(relevantContexts).some(context =>
                    contextKeywords[context as keyof typeof contextKeywords]?.some(keyword =>
                        importLine.includes(keyword)))) {
                    relevantLines.push(line);
                }
                return;
            }

            // Include type definitions, configurables, and client initializations if relevant
            if (line.trim().startsWith('type ') ||
                line.trim().startsWith('configurable ') ||
                line.trim().startsWith('final ')) {
                if (Array.from(relevantContexts).some(context =>
                    contextKeywords[context as keyof typeof contextKeywords]?.some(keyword =>
                        trimmedLine.includes(keyword)))) {
                    relevantLines.push(line);
                }
                return;
            }

            // Detect function/service/resource starts
            if (trimmedLine.includes('function ') ||
                trimmedLine.includes('service ') ||
                trimmedLine.includes('resource ')) {

                currentFunction = line;
                inRelevantBlock = Array.from(relevantContexts).some(context =>
                    contextKeywords[context as keyof typeof contextKeywords]?.some(keyword =>
                        trimmedLine.includes(keyword) || currentFunction.toLowerCase().includes(keyword)));

                if (inRelevantBlock) {
                    relevantLines.push(line);
                }
                return;
            }

            // Include lines within relevant blocks
            if (inRelevantBlock) {
                relevantLines.push(line);

                // End block detection
                if (line.trim() === '}' &&
                    (lines[index + 1]?.trim() === '' ||
                     lines[index + 1]?.trim().startsWith('function ') ||
                     lines[index + 1]?.trim().startsWith('service ') ||
                     lines[index + 1]?.trim().startsWith('resource ') ||
                     index === lines.length - 1)) {
                    inRelevantBlock = false;
                }
            } else {
                // Check if this line contains relevant keywords
                if (Array.from(relevantContexts).some(context =>
                    contextKeywords[context as keyof typeof contextKeywords]?.some(keyword =>
                        trimmedLine.includes(keyword)))) {
                    relevantLines.push(line);
                }
            }
        });

        // Only include files that have relevant content
        if (relevantLines.length > 0) {
            relevantContent[filePath] = relevantLines.join('\n');
        }
    });

    return relevantContent;
}

// Helper function to save tool response as markdown
function saveToolResponseAsMarkdown(queryId: number, toolResponse: any) {
    try {
        // Ensure tool_response directory exists
        const toolResponseDir = path.join(process.cwd(), "tool_response");
        ensureDirectoryExists(toolResponseDir);

        // Extract only relevant context based on user query
        const relevantContent = extractRelevantContext(toolResponse.userQuery, toolResponse.fileMemory);

        // Create markdown content with only relevant expanded code
        const markdownContent = `# Relevant Context Analysis - Query ${queryId}

## User Query
${toolResponse.userQuery}

## Context Content
${toolResponse.contextContent.length > 0 ?
    `\`\`\`markdown\n${toolResponse.contextContent}\n\`\`\`` :
    '_No context content available_'}

## Relevant Code Context

${Object.keys(relevantContent).length > 0 ?
    Object.entries(relevantContent).map(([filePath, content]) => `
### ${filePath}

\`\`\`ballerina
${content}
\`\`\`
`).join('\n') :
    '_No relevant code context found for this query_'}

---
*Analysis completed at: ${toolResponse.analysisTime}*
*Total files scanned: ${Object.keys(toolResponse.fileMemory).length}*
*Relevant files identified: ${Object.keys(relevantContent).length}*
`;

        // Save the markdown file
        const markdownPath = path.join(toolResponseDir, `${queryId}.md`);
        fs.writeFileSync(markdownPath, markdownContent, "utf-8");

        console.log(`[SUCCESS] Relevant context saved as markdown: ${markdownPath}`);
        console.log(`[INFO] Extracted relevant context from ${Object.keys(relevantContent).length} out of ${Object.keys(toolResponse.fileMemory).length} files`);
        return markdownPath;
    } catch (error) {
        console.error(`[ERROR] Failed to save tool response as markdown for Query ${queryId}:`, error);
        return null;
    }
}

// Main processing loop
async function processAllQueries() {
    for (const q of predefinedUserQueries) {
        console.log(`\n=== Processing Query ${q.id} ===`);
        console.log(`Query: ${q.query}`);

        // Load API docs for this specific query
        let API_DOC: Library;
        try {
            API_DOC = loadApiDocs(q.id);
            console.log(`Loaded API docs from: api_docs/${q.id}.json`);
        } catch (error) {
            console.error(`Failed to load API docs for query ${q.id}:`, error);
            continue;
        }

        const ballerinaCodeExpander = tool({
            name: "ballerinaCodeExpander",
            description: 'Acts as a Ballerina compiler AST expander. Reads all .bal files from a project directory, saves them in memory, and processes context chunks from markdown files to provide relevant code context for the user query.',
            inputSchema: z.object({
                contextNeeded: z.string().describe("Describe what specific context or code sections are needed for the user query"),
                contextFilesPath: z.string().optional().describe("Path to the context_files folder containing relevant chunks (default: context_files/{queryId}.txt)")
            }),
            execute: async ({ contextNeeded, contextFilesPath }) => {
                try {
                    // Get project directory from environment
                    const projectDir = process.env.PROJECT_DIRECTORY;
                    if (!projectDir) {
                        throw new Error("[ERROR] PROJECT_DIRECTORY environment variable is not set.");
                    }

                    if (!fs.existsSync(projectDir)) {
                        throw new Error(`[ERROR] Project directory not found at path: ${projectDir}`);
                    }

                    // Use the current query from the loop
                    const userQuery = q.query;
                    const queryId = q.id;

                    // Determine context file path - use query-specific chunk file
                    let contextFile: string;
                    if (contextFilesPath) {
                        contextFile = path.resolve(contextFilesPath);
                    } else {
                        // Use query-specific chunk file: context_files/{queryId}.txt
                        contextFile = path.join(process.cwd(), "context_files", `${queryId}.txt`);

                        // If not found in current directory, check project directory
                        if (!fs.existsSync(contextFile)) {
                            const projectContextFile = path.join(projectDir, "context_files", `${queryId}.txt`);
                            if (fs.existsSync(projectContextFile)) {
                                contextFile = projectContextFile;
                            }
                        }
                    }

                    // Read context file (markdown format)
                    let contextContent = "";
                    if (fs.existsSync(contextFile)) {
                        contextContent = fs.readFileSync(contextFile, "utf-8");
                        console.log(`[INFO] Context loaded from: ${contextFile}`);
                    } else {
                        console.log(`[WARNING] Context file not found at: ${contextFile}`);
                    }

                    // Recursively find all .bal files in the project directory
                    const findBalFiles = (dir: string): string[] => {
                        const balFiles: string[] = [];
                        const items = fs.readdirSync(dir);

                        for (const item of items) {
                            const fullPath = path.join(dir, item);
                            const stat = fs.statSync(fullPath);

                            if (stat.isDirectory()) {
                                // Skip common non-source directories
                                if (!['node_modules', '.git', 'target', 'build', '.ballerina', 'context', 'context_files', 'code_expander', 'poc', 'api_docs', 'tool_response', 'llm_result'].includes(item)) {
                                    balFiles.push(...findBalFiles(fullPath));
                                }
                            } else if (item.endsWith('.bal')) {
                                balFiles.push(fullPath);
                            }
                        }
                        return balFiles;
                    };

                    const balFiles = findBalFiles(projectDir);

                    if (balFiles.length === 0) {
                        console.log("[WARNING] No .bal files found in the project directory.");
                    }

                    // Store all files in memory with their content
                    const fileMemory: Record<string, string> = {};
                    const projectStructure: Record<string, any> = {};

                    for (const filePath of balFiles) {
                        const relativePath = path.relative(projectDir, filePath);
                        const fileContent = fs.readFileSync(filePath, "utf-8");

                        // Save file content in memory
                        fileMemory[relativePath] = fileContent;

                        // Store basic file info
                        projectStructure[relativePath] = {
                            path: relativePath,
                            absolutePath: filePath,
                            lines: fileContent.split('\n').length,
                            size: fileContent.length,
                            lastModified: fs.statSync(filePath).mtime
                        };
                    }

                    // Prepare response object with raw data (let LLM format the markdown)
                    const toolResponse = {
                        queryId: queryId,
                        userQuery: userQuery,
                        contextNeeded: contextNeeded,
                        projectDirectory: projectDir,
                        contextFilePath: contextFile,
                        contextContent: contextContent,
                        totalFiles: balFiles.length,
                        fileMemory: fileMemory,
                        projectStructure: projectStructure,
                        analysisTime: new Date().toISOString(),
                        summary: {
                            queryId: queryId,
                            filesAnalyzed: Object.keys(fileMemory).length,
                            contextLoaded: contextContent.length > 0,
                            contextSource: contextFile,
                            ready: true
                        }
                    };

                    // **NEW: Save tool response as markdown**
                    saveToolResponseAsMarkdown(queryId, toolResponse);

                    console.log(`[SUCCESS] AST Analysis completed for Query ${queryId}:`);
                    console.log(`  - Analyzed ${balFiles.length} .bal files`);
                    console.log(`  - Context loaded: ${contextContent.length > 0 ? 'Yes' : 'No'}`);

                    return toolResponse;

                } catch (error) {
                    const errorMessage = `[ERROR] Failed to expand Ballerina code for Query ${q.id}: ${error instanceof Error ? error.message : String(error)}`;
                    console.error(errorMessage);
                    throw new Error(errorMessage);
                }
            }
        });

        // Helper function to create file summaries
        function createFileSummary(filePath: string, content: string): string {
            const lines = content.split('\n').length;
            const size = content.length;
            return `File: ${filePath} (${lines} lines, ${size} bytes)`;
        }

        function getSystemPromptPrefix(api_docs: Library[]): string {
            return `You are an expert Ballerina code assistant with AST (Abstract Syntax Tree) analysis capabilities. Your role is to analyze existing Ballerina codebases and generate accurate, functional Ballerina code that integrates seamlessly with the existing project structure.

You have access to a powerful ballerinaCodeExpander tool that acts like a Ballerina compiler AST API, allowing you to:
- Analyze entire Ballerina project structures
- Extract relevant code sections based on context
- Understand existing imports, functions, services, types, and configurables
- Process context chunks from markdown files to provide targeted code assistance
- Return structured project data for analysis

You will be provided with the following inputs:

1. API_DOCS: A JSON string containing the API documentation for various Ballerina libraries and their functions, types, and clients.
<api_docs>
${JSON.stringify(api_docs)}
</api_docs>
`;
        }

        function getSystemPromptSuffix(langlibs: Library[]): string {
            return `2. Langlibs
<langlibs>
${JSON.stringify(langlibs)}
</langlibs>

3. ballerinaCodeExpander Tool:
    - This tool provides comprehensive project analysis by:
    - Acting as Compiler APIs when expanding code tasks.
    - Providing expanded context similar to how Compiler APIs work.
    - Loading all .bal files from the project directory into memory.
    - Processing context chunks from context_files/{queryId}.txt (or a custom path).
    - Returning only the expanded code along with related dependencies.
    - Providing full access to all project files for analysis and modification.

**IMPORTANT**: Always call the ballerinaCodeExpander tool first to load and analyze the existing codebase before generating any code.

When the ballerinaCodeExpander tool returns data, you should:

1. **Create a comprehensive markdown analysis** that includes:
   - Project overview with query details
   - Context information from the loaded context file
   - Project structure analysis showing all files
   - Complete source code listing for all .bal files
   - Analysis summary and recommendations

2. **Save the analysis** to tool_response/{queryId}.md file using standard file operations

3. **Generate integration-aware code** based on the analysis

When answering queries, follow these steps:

1. **Load and Analyze Existing Project**
   - ALWAYS start by calling ballerinaCodeExpander to load all .bal files into memory
   - The tool will automatically look for context_files/{queryId}.txt for relevant context chunks
   - Create a comprehensive markdown analysis of the returned data
   - Save the analysis to tool_response/{queryId}.md
   - Review the complete project structure and existing code
   - Understand the current implementation patterns and conventions

2. **Understand Requirements**
   - Analyze the user query in the context of the existing codebase
   - Use the context chunks from context_files/{queryId}.txt to understand specific requirements
   - Identify what needs to be added, modified, or integrated
   - Determine which existing files need changes
   - Plan how new functionality should integrate with existing code

3. **Leverage Existing Code Structure**
   - Reuse existing imports, types, and configurations where appropriate
   - Follow existing naming conventions and code organization
   - Maintain consistency with current architecture patterns
   - Build upon existing functions and services rather than duplicating

4. **Generate Integration-Aware Code**
   - Only modify files that actually need changes
   - Preserve existing functionality unless explicitly asked to change it
   - Use existing client configurations and connection patterns
   - Ensure new code follows the same error handling approaches

5. **Code Quality and Standards**
   - Follow Ballerina best practices and conventions
   - Use proper type definitions and error handling
   - Maintain backward compatibility with existing functionality
   - Ensure all imports and dependencies are correctly managed

6. **Documentation and Context**
   - Provide clear explanations of what changes are being made
   - Explain how new code integrates with existing components
   - Document any new types, functions, or configurations added
   - Reference the analysis saved in tool_response/{queryId}.md for project understanding

**Key Integration Guidelines:**
- Always load existing project files first using ballerinaCodeExpander
- Create and save comprehensive markdown analysis from the tool response
- Respect existing project structure and file organization
- Reuse existing types, imports, and client configurations
- Maintain consistency with existing code patterns
- Only suggest modifications to files that need changes
- Preserve existing configurables and connection settings
- Follow established patterns for services, functions, and error handling

**Context Files Integration:**
- The tool automatically processes context_files/{queryId}.txt for relevant chunks
- Context chunks provide specific requirements and implementation guidance
- Use context information to understand the specific scope and requirements
- Integrate context-specific requirements with existing codebase analysis

**Output Requirements:**
- Start with calling ballerinaCodeExpander tool
- Create comprehensive markdown analysis from the tool response data
- Save analysis to tool_response/{queryId}.md
- Provide comprehensive explanation of integration approach
- Show complete file content for any modified files
- Include proper code blocks with filename headers
- Maintain existing code quality and conventions

The ballerinaCodeExpander tool returns structured data that you should use to create a complete project analysis in markdown format.

NOTE:

1. Read user query carefully

2. Carefully analyze the provided API documentation:
   - Identify the available libraries, clients, their functions and their relevant types.

3. Thoroughly read and understand the given query:
   - Identify the main requirements and objectives of the integration.
   - Determine which libraries, functions and their relevant records and types from the API documentation are needed to achieve the query and forget about unused API docs.
   - Note the libraries needed to achieve the query and plan the control flow of the application based on input and output parameters of each function of the connector according to the API documentation.

4. Plan your code structure:
   - Decide which libraries need to be imported (Avoid importing lang.string, lang.boolean, lang.float, lang.decimal, lang.int, lang.map langlibs as they are already imported by default).
   - Determine the necessary client initialization.
   - Define Types needed for the query in the types.bal file.
   - Outline the service OR main function for the query.
   - Outline the required function usages as noted in Step 3.
   - Based on the types of identified functions, plan the data flow. Transform data as necessary.

5. Generate the Ballerina code:
   - Start with the required import statements.
   - Define required configurables for the query. Use only string, int, boolean types in configurable variables.
   - Initialize any necessary clients with the correct configuration at the module level(before any function or service declarations).
   - Implement the main function OR service to address the query requirements.
   - Use defined connectors based on the query by following the API documentation.
   - Use only the functions, types, and clients specified in the API documentation.
   - Use dot notation to access a normal function. Use -> to access a remote function or resource function.
   - Ensure proper error handling and type checking.
   - Do not invoke methods on json access expressions. Always use separate statements.
   - Use langlibs ONLY IF REQUIRED.

6. Review and refine your code:
   - Check that all query requirements are met.
   - Verify that you're only using elements from the provided API documentation.
   - Ensure the code follows Ballerina best practices and conventions.

Provide a brief explanation of how your code addresses the query and then output your generated ballerina code.

Important reminders:
- Only use the libraries, functions, types, services and clients specified in the provided API documentation.
- Always strictly respect the types given in the API Docs.
- Do not introduce any additional libraries or functions not mentioned in the API docs.
- Only use specified fields in records according to the api docs. this applies to array types of that record as well.
- Ensure your code is syntactically correct and follows Ballerina conventions.
- Do not use dynamic listener registrations.
- Do not write code in a way that requires updating/assigning values of function parameters.
- ALWAYS Use two words camel case identifiers (variable, function parameter, resource function parameter and field names).
- If the library name contains a . Always use an alias in the import statement. (import org/package.one as one;)
- Treat generated connectors/clients inside the generated folder as submodules.
- A submodule MUST BE imported before being used.  The import statement should only contain the package name and submodule name.  For package my_pkg, folder structure generated/fooApi the import should be import my_pkg.fooApi;
- If the return parameter typedesc default value is marked as <> in the given API docs, define a custom record in the code that represents the data structure based on the use case and assign to it.
- Whenever you have a Json variable, NEVER access or manipulate Json variables. ALWAYS define a record and convert the Json to that record and use it.
- When invoking resource function from a client, use the correct paths with accessor and parameters. (eg: exampleClient->/path1/["param"]/path2.get(key="value"))
- When you are accessing a field of a record, always assign it into new variable and use that variable in the next statement.
- Avoid long comments in the code. Use // for single line comments.
- Always use named arguments when providing values to any parameter. (eg: .get(key="value"))
- Mention types EXPLICITLY in variable declarations and foreach statements.
- Do not modify the README.md file unless asked to be modified explicitly in the query.
- Do not add/modify toml files(Config.toml/Ballerina.toml) unless asked.
- In the library API documentation if the service type is specified as generic, adhere to the instructions specified there on writing the service.
- For GraphQL service related queries, If the user haven't specified their own GraphQL Schema, Write the proposed GraphQL schema for the user query right after explanation before generating the ballerina code. Use same names as the GraphQL Schema when defining record types.

Begin your response with:
1. Call ballerinaCodeExpander tool to load project data
2. Create comprehensive markdown analysis from the tool response
3. Save the analysis to tool_response/{queryId}.md
4. Provide explanation of the approach
5. Include codeblock segments (if any) at the end

Each file which needs modifications, should have a codeblock segment and it MUST have complete file content with the proposed change.

Example Codeblock segment:
<code filename="main.bal">
\`\`\`ballerina
//code goes here
\`\`\`
</code>
`;
        }

        async function generateBallerinaCode(
            userQuery: string,
            queryId: number,
            API_DOC: Library[]
        ): Promise<{ response: string }> {
            const systemPromptPrefix = getSystemPromptPrefix(API_DOC);
            const systemPromptSuffix = getSystemPromptSuffix(LANGLIBS);
            const systemPrompt = systemPromptPrefix + "\n\n" + systemPromptSuffix + "\n\n";

            console.log(`Generating Code for Query ${queryId} with simplified AST analysis...`);

            const result = await generateText({
                model: getAnthropicClient(ANTHROPIC_SONNET_4),
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userQuery },
                ],
                tools: { ballerinaCodeExpander },
                stopWhen: stepCountIs(25),
            });

            return { response: result.text };
        }

        // Process current query
        async function processQuery() {
            try {
                const projectDir = process.env.PROJECT_DIRECTORY;
                if (!projectDir || !projectDir.trim()) {
                    console.error("[ERROR] PROJECT_DIRECTORY environment variable is not set or empty.");
                    return;
                }

                console.log(`Starting Ballerina code generation for Query ${q.id}...`);
                console.log(`Project Directory: ${projectDir}`);
                console.log(`User Query: ${q.query}`);

                // Check for context files
                const contextFilesPath = path.join(process.cwd(), "context_files", `${q.id}.txt`);
                const projectContextPath = path.join(projectDir, "context_files", `${q.id}.txt`);

                console.log(`Primary context file path: ${contextFilesPath}`);
                console.log(`Project context file path: ${projectContextPath}`);

                if (fs.existsSync(contextFilesPath)) {
                    console.log(`✓ Context file found at: ${contextFilesPath}`);
                } else if (fs.existsSync(projectContextPath)) {
                    console.log(`✓ Context file found at: ${projectContextPath}`);
                } else {
                    console.log(`⚠ No context file found at either location`);
                }

                // Run the code generator with simplified AST analysis
                const { response } = await generateBallerinaCode(q.query, q.id, [API_DOC]);

                // Ensure output directories
                const llmResultDir = path.join(process.cwd(), "llm_result");
                ensureDirectoryExists(llmResultDir);

                // Save LLM result as {queryId}.txt
                const llmResultPath = path.join(llmResultDir, `${q.id}.txt`);

                // Final content with response
                const finalContent = `=== QUERY ID ===
${q.id}

=== USER QUERY ===
${q.query}

=== PROJECT DIRECTORY ===
${projectDir}

=== API DOCS USED ===
api_docs/${q.id}.json

=== CONTEXT FILES ===
Primary Path: ${contextFilesPath}
Project Path: ${projectContextPath}
Context File Used: context_files/${q.id}.txt

=== RESPONSE ===
${response}

=== GENERATION METADATA ===
Generated At: ${new Date().toISOString()}
Query ID: ${q.id}
Model Used: ${ANTHROPIC_SONNET_4}
Max Output Tokens: 8192
Step Count Limit: 25
AST Analysis: Simplified (LLM-formatted)
Context Files Support: Enabled
LLM Result Output: llm_result/${q.id}.txt
Tool Response Markdown: tool_response/${q.id}.md
`;

                // Write output to file
                fs.writeFileSync(llmResultPath, finalContent, "utf-8");
                console.log(`[SUCCESS] Query ${q.id} output written to: ${llmResultPath}`);

            } catch (error) {
                console.error(`Error generating Ballerina code for Query ${q.id}:`, error);

                // Save error to llm_result folder
                const llmResultDir = path.join(process.cwd(), "llm_result");
                ensureDirectoryExists(llmResultDir);

                const errorPath = path.join(llmResultDir, `${q.id}_error.txt`);
                const errorContent = `=== QUERY ID ===
${q.id}

=== USER QUERY ===
${q.query}

=== ERROR ===
${error instanceof Error ? error.message : String(error)}

=== ERROR TIME ===
${new Date().toISOString()}

=== STACK TRACE ===
${error instanceof Error ? error.stack : 'No stack trace available'}
`;

                fs.writeFileSync(errorPath, errorContent, "utf-8");
                console.log(`[ERROR] Error details saved to: ${errorPath}`);
            }
        }

        // Execute the current query
        await processQuery();
    }
}

// Execute the main function
processAllQueries().catch(console.error);
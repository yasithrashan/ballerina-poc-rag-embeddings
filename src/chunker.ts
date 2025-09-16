import path from "path";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import type { Chunk } from "./types";

interface EnhancedChunk extends Chunk {
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

export class BallerinaChunker {
    private readonly MAX_CHUNK_SIZE = 5000; // characters
    private processedChunks = new Set<string>(); // For deduplication

    // Get line number from index
    private getLineNumber(code: string, index: number): number {
        return code.slice(0, index).split(/\r?\n/).length;
    }

    // Get column number from index
    private getColumnNumber(code: string, index: number): number {
        const lastNewline = code.lastIndexOf("\n", index - 1);
        return index - (lastNewline + 1) + 1; // 1-based column
    }

    // Generate hash for chunk content
    private generateHash(content: string): string {
        return createHash('sha256').update(content.trim()).digest('hex').substring(0, 16);
    }

    // Generate hierarchical ID
    private generateId(metadata: any, filePath: string): string {
        const fileName = path.basename(filePath, '.bal');
        const moduleName = metadata.moduleName || 'unknown';

        switch (metadata.type) {
            case 'import':
                return `${moduleName}:${fileName}:import:${metadata.line}`;
            case 'configurable_variable':
                return `${moduleName}:${fileName}:configurable:${metadata.name || 'unnamed'}`;
            case 'module_variable':
                return `${moduleName}:${fileName}:variable:${metadata.name || 'unnamed'}`;
            case 'type_definition':
                return `${moduleName}:${fileName}:type:${metadata.name || 'unnamed'}`;
            case 'function':
                return `${moduleName}:${fileName}:function:${metadata.name || 'unnamed'}`;
            case 'service':
                return `${moduleName}:${fileName}:service:${metadata.name}:${metadata.listener || 'default'}`;
            case 'resource':
                return `${moduleName}:${fileName}:service:${metadata.servicePath?.replace(/^\//, '') || 'unnamed'}:${metadata.httpMethod}:${metadata.resourcePath || ''}`;
            case 'class':
                return `${moduleName}:${fileName}:class:${metadata.name || 'unnamed'}`;
            case 'constant':
                return `${moduleName}:${fileName}:constant:${metadata.name || 'unnamed'}`;
            default:
                return `${moduleName}:${fileName}:${metadata.type}:${metadata.line}`;
        }
    }

    // Extract module name from file path
    private extractModuleName(filePath: string): string {
        const pathParts = filePath.split(path.sep);
        // Look for Ballerina.toml or assume the parent directory is the module name
        for (let i = pathParts.length - 1; i >= 0; i--) {
            if (pathParts[i] === 'modules' && i > 0) {
                return pathParts[i + 1] || 'default';
            }
        }
        // If no modules directory, use the parent directory of the .bal file
        return pathParts[pathParts.length - 2] || 'default';
    }

    // Normalize whitespace and extract doc comments
    private normalizeContent(content: string): { content: string; docComment?: string } {
        // Extract documentation comments (/// or #)
        const docCommentRegex = /^(\s*(?:\/\/\/.*\n|#.*\n)+)/m;
        const docMatch = content.match(docCommentRegex);
        const docComment = docMatch && docMatch[1] !== undefined ? docMatch[1].trim() : undefined;

        // Remove extra whitespace while preserving structure
        const normalized = content
            .split('\n')
            .map(line => line.trimRight())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n') // Collapse multiple empty lines
            .trim();

        return { content: normalized, docComment };
    }

    // Split large chunks into smaller logical blocks (for functions only)
    private splitLargeFunction(content: string, metadata: any): string[] {
        if (content.length <= this.MAX_CHUNK_SIZE) {
            return [content];
        }

        const chunks: string[] = [];
        const lines = content.split('\n');
        let currentChunk = '';
        let braceCount = 0;

        for (const line of lines) {
            const testChunk = currentChunk + (currentChunk ? '\n' : '') + line;

            // Count braces to maintain logical boundaries
            braceCount += (line.match(/\{/g) || []).length;
            braceCount -= (line.match(/\}/g) || []).length;

            if (testChunk.length > this.MAX_CHUNK_SIZE && braceCount === 0 && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = line;
            } else {
                currentChunk = testChunk;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks.length > 1 ? chunks : [content];
    }

    // Split resource into signature and body when too large
    private splitLargeResource(content: string, metadata: any): { signature: string; body: string } | null {
        if (content.length <= this.MAX_CHUNK_SIZE) {
            return null; // Don't split if under limit
        }

        // Extract signature and body for resources
        const resourceMatch = content.match(/^(resource\s+function\s+\w+\s+[^{]*\{)\s*((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\s*(\})$/s);
        if (resourceMatch) {
            const signature = resourceMatch[1]; // "resource function get users() {"
            const body = resourceMatch[2] ? resourceMatch[2].trim() : ""; // function body content
            const closingBrace = resourceMatch[3]; // "}"

            return {
                signature: (signature ?? '').trim(),
                body: body + '\n' + closingBrace
            };
        }

        return null; // Couldn't parse, return as-is
    }

    // Build enhanced metadata with all improvements
    private buildEnhancedMetadata(base: any, code: string, match: RegExpExecArray, filePath: string): any {
        const startLine = this.getLineNumber(code, match.index!);
        const endLine = this.getLineNumber(code, match.index! + match[0].length);
        const startColumn = this.getColumnNumber(code, match.index!);
        const endColumn = this.getColumnNumber(code, match.index! + match[0].length);
        const moduleName = this.extractModuleName(filePath);

        const metadata = {
            ...base,
            line: startLine,
            endLine,
            position: {
                start: { line: startLine, column: startColumn },
                end: { line: endLine, column: endColumn }
            },
            moduleName,
            file: path.basename(filePath)
        };

        metadata.id = this.generateId(metadata, filePath);
        return metadata;
    }

    // Check for duplicates and add to processed set
    private isDuplicate(chunk: EnhancedChunk): boolean {
        const key = `${chunk.metadata.type}:${chunk.metadata.name}:${chunk.metadata.hash}`;
        if (this.processedChunks.has(key)) {
            return true;
        }
        this.processedChunks.add(key);
        return false;
    }

    // Helper function to find matching brace
    private findMatchingBrace(code: string, startIndex: number): number {
        let braceCount = 0;
        let index = startIndex;

        while (index < code.length) {
            if (code[index] === '{') {
                braceCount++;
            } else if (code[index] === '}') {
                braceCount--;
                if (braceCount === 0) {
                    return index;
                }
            }
            index++;
        }

        return -1; // No matching brace found
    }

    // Improved Ballerina-specific chunking logic
    chunkBallerinaCode(code: string, filePath: string): EnhancedChunk[] {
        const chunks: EnhancedChunk[] = [];
        this.processedChunks.clear(); // Reset for each file
        let match: RegExpExecArray | null;

        // 1. Import statements - Ballerina specific
        const importRegex = /import\s+(?:ballerina\/\w+|[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*(?:\s+as\s+\w+)?)\s*;/g;
        while ((match = importRegex.exec(code)) !== null) {
            const { content: normalizedContent, docComment } = this.normalizeContent(match[0]);
            const hash = this.generateHash(normalizedContent);

            const chunk: EnhancedChunk = {
                content: normalizedContent,
                metadata: {
                    ...this.buildEnhancedMetadata(
                        { type: "import" },
                        code,
                        match,
                        filePath
                    ),
                    hash,
                    docComment
                }
            };

            if (!this.isDuplicate(chunk)) {
                chunks.push(chunk);
            }
        }

        // 2. Configurable variables - Ballerina specific (FIXED REGEX)
        const configurableRegex = /configurable\s+(?:readonly\s+)?([a-zA-Z_]\w*(?:\[\])?(?:<[^>]+>)?)\s+(\w+)\s*=\s*[^;]+;/g;
        while ((match = configurableRegex.exec(code)) !== null) {
            const dataType = match[1];
            const variableName = match[2];

            const { content: normalizedContent, docComment } = this.normalizeContent(match[0]);
            const hash = this.generateHash(normalizedContent);

            const chunk: EnhancedChunk = {
                content: normalizedContent,
                metadata: {
                    ...this.buildEnhancedMetadata(
                        {
                            type: "configurable_variable",
                            name: variableName,
                            dataType: dataType
                        },
                        code,
                        match,
                        filePath
                    ),
                    hash,
                    docComment
                }
            };

            if (!this.isDuplicate(chunk)) {
                chunks.push(chunk);
            }
        }

        // 3. Module-level variables - Enhanced Ballerina patterns (IMPROVED)
        const moduleVariableRegex = /^(?!.*(function|service|resource|type|import|configurable|class)).*?(?:(public|isolated|final)\s+)?([a-zA-Z_]\w*(?:<[^>]+>)?(?:\[\])?)\s+(\w+)\s*=\s*[^;]+;/gm;
        while ((match = moduleVariableRegex.exec(code)) !== null) {
            const visibility = match[1] || 'private';
            const dataType = match[2];
            const variableName = match[3];

            const { content: normalizedContent, docComment } = this.normalizeContent(match[0]);
            const hash = this.generateHash(normalizedContent);

            const chunk: EnhancedChunk = {
                content: normalizedContent,
                metadata: {
                    ...this.buildEnhancedMetadata(
                        {
                            type: "module_variable",
                            name: variableName,
                            visibility,
                            dataType
                        },
                        code,
                        match,
                        filePath
                    ),
                    hash,
                    docComment
                }
            };

            if (!this.isDuplicate(chunk)) {
                chunks.push(chunk);
            }
        }

        // 4. Type definitions - Enhanced Ballerina patterns
        const typeRegex = /((?:(public|isolated)\s+)?type\s+(\w+)\s+([^;{]+(?:;|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}));?)/g;
        while ((match = typeRegex.exec(code)) !== null) {
            const visibility = match[2] || 'private';
            const typeName = match[3];

            const { content: normalizedContent, docComment } = this.normalizeContent(match[1] ?? "");
            const hash = this.generateHash(normalizedContent);

            const chunk: EnhancedChunk = {
                content: normalizedContent,
                metadata: {
                    ...this.buildEnhancedMetadata(
                        {
                            type: "type_definition",
                            name: typeName,
                            visibility
                        },
                        code,
                        match,
                        filePath
                    ),
                    hash,
                    docComment
                }
            };

            if (!this.isDuplicate(chunk)) {
                chunks.push(chunk);
            }
        }

        // 5. Standalone functions - Enhanced Ballerina patterns (FIXED)
        const functionRegex = /((?:(public|isolated|transactional)\s+)*function\s+(\w+)\s*\(([^)]*)\)(?:\s+returns\s*([^{]+?))?\s*\{)/g;
        while ((match = functionRegex.exec(code)) !== null) {
            // Check if this function is inside a service - improved check
            const beforeFunction = code.substring(0, match.index!);
            const afterFunction = code.substring(match.index!);

            // Find the last service declaration before this function
            const serviceMatches = [...beforeFunction.matchAll(/service\s+(?:class\s+\w+\s+)?[^\s{]+(?:\s+on\s+[^{]+)?\s*\{/g)];
            const lastServiceMatch = serviceMatches[serviceMatches.length - 1];

            if (lastServiceMatch) {
                const serviceStart = lastServiceMatch.index! + beforeFunction.length - beforeFunction.length;
                // Check if we're still inside a service by counting braces
                const codeBetween = code.substring(serviceStart, match.index!);
                const openBraces = (codeBetween.match(/\{/g) || []).length;
                const closeBraces = (codeBetween.match(/\}/g) || []).length;

                if (openBraces > closeBraces) {
                    continue; // Skip functions inside services
                }
            }

            const modifiers = match[2] || '';
            const functionName = match[3];
            const params = match[4] || "";
            const returnType = (match[5] || "").trim() || "()";

            // Find the complete function body
            const functionStart = match.index!;
            const openBraceIndex = match.index! + match[0].length - 1; // Position of opening brace
            const closeBraceIndex = this.findMatchingBrace(code, openBraceIndex);

            if (closeBraceIndex === -1) {
                continue; // Skip if we can't find matching brace
            }

            const fullFunction = code.substring(functionStart, closeBraceIndex + 1);
            const { content: normalizedContent, docComment } = this.normalizeContent(fullFunction);

            // Split large functions only
            const functionChunks = this.splitLargeFunction(normalizedContent, { type: 'function', name: functionName });

            functionChunks.forEach((chunkContent, index) => {
                const hash = this.generateHash(chunkContent);
                const chunk: EnhancedChunk = {
                    content: chunkContent,
                    metadata: {
                        ...this.buildEnhancedMetadata(
                            {
                                type: "function",
                                name: functionName + (index > 0 ? `_part${index + 1}` : ''),
                                originalName: functionName,
                                modifiers: modifiers.trim().split(/\s+/).filter(Boolean),
                                parameters: params.split(",").map((p) => p.trim()).filter(Boolean),
                                returnType,
                                visibility: modifiers.includes('public') ? 'public' : 'private',
                                partIndex: index,
                                totalParts: functionChunks.length
                            },
                            code,
                            match!,
                            filePath
                        ),
                        hash,
                        docComment: index === 0 ? docComment : undefined
                    }
                };

                if (!this.isDuplicate(chunk)) {
                    chunks.push(chunk);
                }
            });
        }

        // 6. Services and resources - COMPLETELY REWRITTEN
        const serviceRegex = /service(?:\s+class\s+(\w+))?\s+(\/[\/\w\d_-]*|\w+)(?:\s+on\s+([^{]+))?\s*\{/g;
        while ((match = serviceRegex.exec(code)) !== null) {
            const serviceClass = match[1];
            const servicePath = match[2];
            const listener = match[3] ? match[3].trim() : null;

            // Find the complete service body
            const serviceStart = match.index!;
            const openBraceIndex = match.index! + match[0].length - 1;
            const closeBraceIndex = this.findMatchingBrace(code, openBraceIndex);

            if (closeBraceIndex === -1) {
                continue; // Skip if we can't find matching brace
            }

            const serviceBody = code.substring(openBraceIndex + 1, closeBraceIndex);
            const serviceDeclaration = code.substring(serviceStart, openBraceIndex + 1).trim();

            const { content: normalizedContent, docComment } = this.normalizeContent(serviceDeclaration);
            const hash = this.generateHash(normalizedContent);

            const chunk: EnhancedChunk = {
                content: normalizedContent,
                metadata: {
                    ...this.buildEnhancedMetadata(
                        {
                            type: "service",
                            name: (servicePath ?? "").replace(/^\//, "") || "unnamed_service",
                            path: servicePath,
                            listener,
                            serviceClass
                        },
                        code,
                        match,
                        filePath
                    ),
                    hash,
                    docComment
                }
            };

            if (!this.isDuplicate(chunk)) {
                chunks.push(chunk);
            }

            // Extract resources from service body - IMPROVED REGEX
            const resourceRegex = /resource\s+function\s+(get|post|put|delete|patch|head|options)\s+([^\s(]*)\s*\(([^)]*)\)(?:\s*returns\s*([^{]+?))?\s*\{/g;
            let resourceMatch: RegExpExecArray | null;

            while ((resourceMatch = resourceRegex.exec(serviceBody)) !== null) {
                const httpMethod = resourceMatch[1];
                const pathPart = resourceMatch[2] || "";
                const params = resourceMatch[3] || "";
                const returnType = (resourceMatch[4] || "").trim() || "()";

                // Find complete resource body
                const resourceStartInService = resourceMatch.index!;
                const resourceOpenBraceIndex = resourceMatch.index! + resourceMatch[0].length - 1;
                const resourceCloseBraceIndex = this.findMatchingBrace(serviceBody, resourceOpenBraceIndex);

                if (resourceCloseBraceIndex === -1) {
                    continue; // Skip if we can't find matching brace
                }

                const resourceBody = serviceBody.substring(resourceOpenBraceIndex + 1, resourceCloseBraceIndex);
                const resourceName = `${httpMethod} ${pathPart}`.trim();
                const fullPath = servicePath + (pathPart.startsWith("/") ? pathPart : `/${pathPart}`);

                const resourceContent = `resource function ${httpMethod} ${pathPart}(${params})${returnType && returnType !== "()" ? ` returns ${returnType}` : ""} {\n${resourceBody.trim()}\n}`;

                const { content: normalizedResourceContent, docComment: resourceDocComment } = this.normalizeContent(resourceContent);

                // Try to keep complete resource in one chunk
                if (normalizedResourceContent.length <= this.MAX_CHUNK_SIZE) {
                    // Resource fits in one chunk - keep it complete
                    const resourceHash = this.generateHash(normalizedResourceContent);
                    const resourceChunk: EnhancedChunk = {
                        content: normalizedResourceContent,
                        metadata: {
                            ...this.buildEnhancedMetadata(
                                {
                                    type: "resource",
                                    name: resourceName,
                                    servicePath,
                                    serviceListener: listener,
                                    serviceClass,
                                    httpMethod,
                                    resourcePath: pathPart,
                                    fullPath,
                                    parameters: params.split(",").map((p) => p.trim()).filter(Boolean),
                                    returnType,
                                    isComplete: true
                                },
                                code,
                                resourceMatch,
                                filePath
                            ),
                            hash: resourceHash,
                            docComment: resourceDocComment
                        }
                    };

                    if (!this.isDuplicate(resourceChunk)) {
                        chunks.push(resourceChunk);
                    }
                } else {
                    // Resource is too large - split into signature and body
                    const splitResult = this.splitLargeResource(normalizedResourceContent, { type: 'resource', name: resourceName });

                    if (splitResult) {
                        // Add signature chunk
                        const signatureHash = this.generateHash(splitResult.signature);
                        const signatureChunk: EnhancedChunk = {
                            content: splitResult.signature,
                            metadata: {
                                ...this.buildEnhancedMetadata(
                                    {
                                        type: "resource",
                                        name: `${resourceName}_signature`,
                                        originalName: resourceName,
                                        servicePath,
                                        serviceListener: listener,
                                        serviceClass,
                                        httpMethod,
                                        resourcePath: pathPart,
                                        fullPath,
                                        parameters: params.split(",").map((p) => p.trim()).filter(Boolean),
                                        returnType,
                                        isComplete: false,
                                        chunkPart: "signature"
                                    },
                                    code,
                                    resourceMatch,
                                    filePath
                                ),
                                hash: signatureHash,
                                docComment: resourceDocComment
                            }
                        };

                        // Add body chunk
                        const bodyHash = this.generateHash(splitResult.body);
                        const bodyChunk: EnhancedChunk = {
                            content: splitResult.body,
                            metadata: {
                                ...this.buildEnhancedMetadata(
                                    {
                                        type: "resource",
                                        name: `${resourceName}_body`,
                                        originalName: resourceName,
                                        servicePath,
                                        serviceListener: listener,
                                        serviceClass,
                                        httpMethod,
                                        resourcePath: pathPart,
                                        fullPath,
                                        parameters: params.split(",").map((p) => p.trim()).filter(Boolean),
                                        returnType,
                                        isComplete: false,
                                        chunkPart: "body"
                                    },
                                    code,
                                    resourceMatch,
                                    filePath
                                ),
                                hash: bodyHash
                            }
                        };

                        if (!this.isDuplicate(signatureChunk)) {
                            chunks.push(signatureChunk);
                        }
                        if (!this.isDuplicate(bodyChunk)) {
                            chunks.push(bodyChunk);
                        }
                    } else {
                        // Fallback: couldn't split properly, add as single large chunk
                        const resourceHash = this.generateHash(normalizedResourceContent);
                        const resourceChunk: EnhancedChunk = {
                            content: normalizedResourceContent,
                            metadata: {
                                ...this.buildEnhancedMetadata(
                                    {
                                        type: "resource",
                                        name: resourceName,
                                        servicePath,
                                        serviceListener: listener,
                                        serviceClass,
                                        httpMethod,
                                        resourcePath: pathPart,
                                        fullPath,
                                        parameters: params.split(",").map((p) => p.trim()).filter(Boolean),
                                        returnType,
                                        isComplete: true,
                                        oversized: true
                                    },
                                    code,
                                    resourceMatch,
                                    filePath
                                ),
                                hash: resourceHash,
                                docComment: resourceDocComment
                            }
                        };

                        if (!this.isDuplicate(resourceChunk)) {
                            chunks.push(resourceChunk);
                        }
                    }
                }
            }
        }

        // 7. Classes - Enhanced Ballerina patterns
        const classRegex = /((?:(public|isolated|readonly|service|client)\s+)*(?:class\s+(\w+)(?:\s*\*[^{;]*)?(?:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\s*;)))/g;
        while ((match = classRegex.exec(code)) !== null) {
            const modifiers = match[1] || '';
            const className = match[3];

            const { content: normalizedContent, docComment } = this.normalizeContent(match[1] ?? "");
            const hash = this.generateHash(normalizedContent);

            const chunk: EnhancedChunk = {
                content: normalizedContent,
                metadata: {
                    ...this.buildEnhancedMetadata(
                        {
                            type: "class",
                            name: className,
                            modifiers: modifiers.trim().split(/\s+/).filter(Boolean),
                            visibility: modifiers.includes('public') ? 'public' : 'private'
                        },
                        code,
                        match,
                        filePath
                    ),
                    hash,
                    docComment
                }
            };

            if (!this.isDuplicate(chunk)) {
                chunks.push(chunk);
            }
        }

        // 8. Constants - Enhanced Ballerina patterns
        const constantRegex = /^((?:(public|isolated)\s+)?(?:const|final)\s+([a-zA-Z_]\w*(?:<[^>]+>)?)\s+(\w+)\s*=\s*[^;]+;)/gm;
        while ((match = constantRegex.exec(code)) !== null) {
            const visibility = match[2] || 'private';
            const dataType = match[3];
            const constantName = match[4];

            const { content: normalizedContent, docComment } = this.normalizeContent(match[1] ?? "");
            const hash = this.generateHash(normalizedContent);

            const chunk: EnhancedChunk = {
                content: normalizedContent,
                metadata: {
                    ...this.buildEnhancedMetadata(
                        {
                            type: "constant",
                            name: constantName,
                            visibility,
                            dataType
                        },
                        code,
                        match,
                        filePath
                    ),
                    hash,
                    docComment
                }
            };

            if (!this.isDuplicate(chunk)) {
                chunks.push(chunk);
            }
        }

        return chunks;
    }

    saveChunksToJson(chunks: EnhancedChunk[], ballerinaDir: string): string {
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
                chunkTypes: this.getChunkTypesStatistics(chunks),
                modules: this.getModuleStatistics(chunks),
                averageChunkSize: Math.round(chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunks.length),
                maxChunkSize: Math.max(...chunks.map(chunk => chunk.content.length)),
                chunksWithDocComments: chunks.filter(chunk => chunk.metadata.docComment).length
            },
            chunks: chunks
        };

        writeFileSync(filepath, JSON.stringify(jsonOutput, null, 2), "utf-8");
        console.log(`Enhanced chunks saved: ${filepath}`);
        console.log(`Total chunks: ${chunks.length}`);
        console.log(`Modules processed: ${Object.keys(jsonOutput.metadata.modules).length}`);
        console.log(`Average chunk size: ${jsonOutput.metadata.averageChunkSize} characters`);

        return filepath;
    }

    private getChunkTypesStatistics(chunks: EnhancedChunk[]): Record<string, number> {
        const stats: Record<string, number> = {};
        chunks.forEach((chunk) => {
            stats[chunk.metadata.type] = (stats[chunk.metadata.type] || 0) + 1;
        });
        return stats;
    }

    private getModuleStatistics(chunks: EnhancedChunk[]): Record<string, number> {
        const stats: Record<string, number> = {};
        chunks.forEach((chunk) => {
            const moduleName = chunk.metadata.moduleName || 'unknown';
            stats[moduleName] = (stats[moduleName] || 0) + 1;
        });
        return stats;
    }

    // Utility method to get chunks by type
    getChunksByType(chunks: EnhancedChunk[], type: string): EnhancedChunk[] {
        return chunks.filter(chunk => chunk.metadata.type === type);
    }

    // Utility method to get chunks by module
    getChunksByModule(chunks: EnhancedChunk[], moduleName: string): EnhancedChunk[] {
        return chunks.filter(chunk => chunk.metadata.moduleName === moduleName);
    }
}
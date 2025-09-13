import path from "path";
import { writeFileSync, mkdirSync } from "fs";
import type { Chunk } from "./types";

export class BallerinaChunker {
    // Get line number from index
    private getLineNumber(code: string, index: number): number {
        return code.slice(0, index).split(/\r?\n/).length;
    }

    // Improved chunking logic for Ballerina code
    chunkBallerinaCode(code: string, filePath: string): Chunk[] {
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
    saveChunksToJson(chunks: Chunk[], ballerinaDir: string): string {
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
}
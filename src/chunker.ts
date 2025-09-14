import path from "path";
import { writeFileSync, mkdirSync } from "fs";
import type { Chunk } from "./types";

export class BallerinaChunker {
    // Get line number from index
    private getLineNumber(code: string, index: number): number {
        return code.slice(0, index).split(/\r?\n/).length;
    }

    // Get column number from index
    private getColumnNumber(code: string, index: number): number {
        const lastNewline = code.lastIndexOf("\n", index - 1);
        return index - (lastNewline + 1) + 1; // 1-based column
    }

    // Build metadata with line/column ranges
    private buildMetadata(base: any, code: string, match: RegExpExecArray): any {
        const startLine = this.getLineNumber(code, match.index);
        const endLine = this.getLineNumber(code, match.index + match[0].length);
        const startColumn = this.getColumnNumber(code, match.index);
        const endColumn = this.getColumnNumber(code, match.index + match[0].length);

        return {
            ...base,
            line: startLine,
            endLine,
            position: {
                start: { line: startLine, column: startColumn },
                end: { line: endLine, column: endColumn }
            }
        };
    }

    // Improved chunking logic for Ballerina code
    chunkBallerinaCode(code: string, filePath: string): Chunk[] {
        const chunks: Chunk[] = [];
        let match: RegExpExecArray | null;

        // 1. Import statements
        const importRegex = /import\s+[^;]+;/g;
        while ((match = importRegex.exec(code)) !== null) {
            chunks.push({
                content: match[0],
                metadata: this.buildMetadata(
                    {
                        type: "import",
                        file: path.basename(filePath)
                    },
                    code,
                    match
                )
            });
        }

        // 2. Configurable variables
        const configurableRegex = /configurable\s+[\w:]+\s+\w+\s*=\s*[^;]+;/g;
        while ((match = configurableRegex.exec(code)) !== null) {
            const variableMatch = match[0].match(/configurable\s+[\w:]+\s+(\w+)/);
            const variableName = variableMatch ? variableMatch[1] : null;

            chunks.push({
                content: match[0],
                metadata: this.buildMetadata(
                    {
                        type: "configurable_variable",
                        name: variableName ?? null,
                        file: path.basename(filePath)
                    },
                    code,
                    match
                )
            });
        }

        // 3. Module-level variables
        const moduleVariableRegex =
            /^(?!.*(?:function|service|resource|type|import|configurable)).*?(?:final\s+)?[\w:]+\s+(\w+)\s*=\s*[^;]+;/gm;
        while ((match = moduleVariableRegex.exec(code)) !== null) {
            const variableMatch = match[0].match(/(?:final\s+)?[\w:]+\s+(\w+)/);
            const variableName = variableMatch ? variableMatch[1] : null;

            chunks.push({
                content: match[0].trim(),
                metadata: this.buildMetadata(
                    {
                        type: "module_variable",
                        name: variableName ?? null,
                        file: path.basename(filePath)
                    },
                    code,
                    match
                )
            });
        }

        // 4. Type definitions
        const typeRegex = /(public\s+)?(type\s+(\w+)\s+([^;{]+(?:;|\{[^}]*\}));?)/g;
        while ((match = typeRegex.exec(code)) !== null) {
            const typeName = match[3];
            chunks.push({
                content: match[2] ?? "",
                metadata: this.buildMetadata(
                    {
                        type: "type_definition",
                        name: typeName ?? null,
                        file: path.basename(filePath),
                        visibility: match[1] ? "public" : "private"
                    },
                    code,
                    match
                )
            });
        }

        // 5. Standalone functions
        const functionRegex =
            /^(?!.*resource).*?((?:public\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s+returns\s*([^\{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\})/gm;
        while ((match = functionRegex.exec(code)) !== null) {
            const beforeFunction = code.substring(0, match.index);
            const lastServiceStart = beforeFunction.lastIndexOf("service");
            const lastServiceEnd = beforeFunction.lastIndexOf("}");

            if (lastServiceStart > lastServiceEnd && lastServiceStart !== -1) {
                continue;
            }

            const functionName = match[2];
            const params = match[3] || "";
            const returnType = (match[4] || "").trim();

            chunks.push({
                content: match[1] ?? "",
                metadata: this.buildMetadata(
                    {
                        type: "function",
                        name: functionName ?? null,
                        file: path.basename(filePath),
                        parameters: params.split(",").map((p) => p.trim()).filter(Boolean),
                        returnType: returnType || "void",
                        visibility: match[1] && match[1].includes("public") ? "public" : "private"
                    },
                    code,
                    match
                )
            });
        }

        // 6. Services and resources
        const serviceRegex =
            /service\s+(\/[\w\d_/-]*|\w+)(?:\s+on\s+([^{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
        while ((match = serviceRegex.exec(code)) !== null) {
            const servicePath = match[1];
            const listener = match[2] ? match[2].trim() : null;
            const serviceBody = match[3] || "";

            chunks.push({
                content: `service ${servicePath}${listener ? ` on ${listener}` : ""}`,
                metadata: this.buildMetadata(
                    {
                        type: "service",
                        name: (servicePath ?? "").replace(/^\//, "") || "unnamed_service",
                        file: path.basename(filePath),
                        path: servicePath,
                        listener: listener
                    },
                    code,
                    match
                )
            });

            const resourceRegex =
                /resource\s+function\s+(\w+)\s+([^\s(]*)\s*\(([^)]*)\)(?:\s*returns\s*([^\{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
            let resourceMatch: RegExpExecArray | null;

            while ((resourceMatch = resourceRegex.exec(serviceBody)) !== null) {
                const httpMethod = resourceMatch[1];
                const pathPart = resourceMatch[2] || "";
                const params = resourceMatch[3] || "";
                const returnType = (resourceMatch[4] || "").trim();
                const body = resourceMatch[5] || "";

                const resourceName = `${httpMethod} ${pathPart}`.trim();
                const fullPath = servicePath + (pathPart.startsWith("/") ? pathPart : `/${pathPart}`);

                chunks.push({
                    content: `resource function ${httpMethod} ${pathPart}(${params})${
                        returnType ? ` returns ${returnType}` : ""
                    } {\n${body.trim()}\n}`,
                    metadata: this.buildMetadata(
                        {
                            type: "resource",
                            name: resourceName,
                            file: path.basename(filePath),
                            servicePath: servicePath,
                            serviceListener: listener,
                            httpMethod: httpMethod,
                            resourcePath: pathPart,
                            fullPath: fullPath,
                            parameters: params.split(",").map((p) => p.trim()).filter(Boolean),
                            returnType: returnType || "void"
                        },
                        code,
                        resourceMatch
                    )
                });
            }
        }

        // 7. Classes
        const classRegex = /((?:public\s+)?class\s+(\w+)(?:\s*\{[^}]*\}|\s*;))/g;
        while ((match = classRegex.exec(code)) !== null) {
            const className = match[2];
            chunks.push({
                content: match[1] ?? "",
                metadata: this.buildMetadata(
                    {
                        type: "class",
                        name: className ?? null,
                        file: path.basename(filePath),
                        visibility: match[1] && match[1].includes("public") ? "public" : "private"
                    },
                    code,
                    match
                )
            });
        }

        // 8. Constants
        const constantRegex = /^(final\s+[\w:]+\s+(\w+)\s*=\s*[^;]+;)/gm;
        while ((match = constantRegex.exec(code)) !== null) {
            const constantName = match[2];
            chunks.push({
                content: match[1] ?? "",
                metadata: this.buildMetadata(
                    {
                        type: "constant",
                        name: constantName ?? null,
                        file: path.basename(filePath)
                    },
                    code,
                    match
                )
            });
        }

        return chunks;
    }

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

    private getChunkTypesStatistics(chunks: Chunk[]): Record<string, number> {
        const stats: Record<string, number> = {};
        chunks.forEach((chunk) => {
            stats[chunk.metadata.type] = (stats[chunk.metadata.type] || 0) + 1;
        });
        return stats;
    }
}

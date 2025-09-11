import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

interface Chunk {
  type: string;
  name?: string;
  content: string;
  meta: any;
}

// Load all .bal files recursively
function loadBallerinaFiles(dir: string): string[] {
  let files: string[] = [];
  for (const file of readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files = files.concat(loadBallerinaFiles(fullPath));
    } else if (file.endsWith(".bal")) {
      files.push(fullPath);
    }
  }
  return files;
}

// Get line number from index
function getLineNumber(code: string, index: number): number {
  return code.slice(0, index).split(/\r?\n/).length;
}

// Chunk Ballerina code into logical parts
function chunkBallerinaCode(code: string, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  let match: RegExpExecArray | null;

  // Imports
  const importRegex = /import\s+[^;]+;/g;
  while ((match = importRegex.exec(code)) !== null) {
    const startLine = getLineNumber(code, match.index);
    chunks.push({
      type: "import",
      content: match[0],
      meta: { file: filePath, line: startLine }
    });
  }

  // Configurable variables - more specific pattern
  const configurableRegex = /configurable\s+[\w:]+\s+\w+\s*=\s*[^;]+;/g;
  while ((match = configurableRegex.exec(code)) !== null) {
    const startLine = getLineNumber(code, match.index);
    chunks.push({
      type: "configurable_variable",
      content: match[0],
      meta: { file: filePath, line: startLine }
    });
  }

  // Module-level variables (excluding those inside functions/services)
  const moduleVariableRegex = /^(?!.*(?:function|service|resource)).*?(?:final\s+)?[\w:]+\s+\w+\s*=\s*[^;]+;/gm;
  while ((match = moduleVariableRegex.exec(code)) !== null) {
    const startLine = getLineNumber(code, match.index);
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
    const startLine = getLineNumber(code, match.index);
    chunks.push({
      type: "type_definition",
      name: typeName,
      content: match[0],
      meta: { file: filePath, line: startLine }
    });
  }

  // Functions (not inside services)
  const functionRegex = /^(?!.*resource).*?function\s+(\w+)\s*\(([^)]*)\)(?:\s+returns\s*([^\{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/gm;
  while ((match = functionRegex.exec(code)) !== null) {
    const name = match[1] ?? "unknown_function";
    const params = match[2] ?? "";
    const returnType = (match[3] ?? "").trim();
    const body = match[4] ?? "";
    const startLine = getLineNumber(code, match.index);
    const endLine = getLineNumber(code, match.index + match[0].length);

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

  // Services with improved regex
  const serviceRegex = /service\s+(\/[\w\d_/-]*|\w+)(?:\s+on\s+[^{]+)?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
  while ((match = serviceRegex.exec(code)) !== null) {
    const servicePath = match[1]?.replace(/^\//, "") ?? "unknown_service";
    const serviceBody = match[2] ?? "";
    const startLine = getLineNumber(code, match.index);
    const endLine = getLineNumber(code, match.index + match[0].length);

    // Service signature
    chunks.push({
      type: "service_signature",
      name: servicePath,
      content: `service ${match[1]}`,
      meta: { file: filePath, startLine, endLine }
    });

    // Extract resource functions from service body
    const resourceRegex = /resource\s+function\s+(\w+)\s+([^\s(]*)\s*\(([^)]*)\)(?:\s*returns\s*([^\{]+))?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
    let resourceMatch: RegExpExecArray | null;

    while ((resourceMatch = resourceRegex.exec(serviceBody)) !== null) {
      const method = resourceMatch[1] ?? "unknown_method";
      const pathPart = resourceMatch[2] ?? "";
      const params = resourceMatch[3] ?? "";
      const returnType = (resourceMatch[4] ?? "").trim();
      const body = resourceMatch[5] ?? "";

      // Calculate line numbers relative to the original code
      const resourceStartInService = resourceMatch.index;
      const serviceStartInCode = match.index + code.substring(match.index).indexOf('{') + 1;
      const resourceStartLine = getLineNumber(code, serviceStartInCode + resourceStartInService);
      const resourceEndLine = getLineNumber(code, serviceStartInCode + resourceStartInService + resourceMatch[0].length);

      const resourceName = `${method} ${pathPart}`.trim();

      chunks.push({
        type: "resource_signature",
        name: resourceName,
        content: `resource function ${method} ${pathPart}(${params})${returnType ? ` returns ${returnType}` : ""}`,
        meta: {
          parameters: params.split(",").map(p => p.trim()).filter(Boolean),
          returnType: returnType || "void",
          file: filePath,
          startLine: resourceStartLine,
          endLine: resourceEndLine,
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
          startLine: resourceStartLine,
          endLine: resourceEndLine,
          servicePath: servicePath,
          httpMethod: method
        }
      });
    }
  }

  return chunks;
}

// Save chunks to file
function saveChunks(chunks: Chunk[], outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `${timestamp}.json`);

  const jsonArray = JSON.stringify(chunks, null, 2);
  writeFileSync(outFile, jsonArray, "utf-8");
  console.log(`Generated ${chunks.length} chunks and saved to ${outFile}`);

  // Print summary
  const chunkTypes = chunks.reduce((acc, chunk) => {
    acc[chunk.type] = (acc[chunk.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log("\nChunk Summary:");
  Object.entries(chunkTypes).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
}

// Run
const ballerinaFiles = loadBallerinaFiles("ballerina");
let allChunks: Chunk[] = [];
for (const file of ballerinaFiles) {
  const code = readFileSync(file, "utf-8");
  allChunks = allChunks.concat(chunkBallerinaCode(code, file));
}
saveChunks(allChunks, "tests");
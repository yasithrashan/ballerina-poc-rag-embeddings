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
    if (statSync(fullPath).isDirectory()) {
      files = files.concat(loadBallerinaFiles(fullPath));
    } else if (file.endsWith(".bal")) {
      files.push(fullPath);
    }
  }
  return files;
}

// Utility: get line number of match in code
function getLineNumber(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

// Chunk a single Ballerina file
function chunkBallerinaCode(filePath: string, code: string): Chunk[] {
  const chunks: Chunk[] = [];
  let match: RegExpExecArray | null;

  // Imports
  const importRegex = /^import\s+[^\n;]+;/gm;
  while ((match = importRegex.exec(code)) !== null) {
    const startLine = getLineNumber(code, match.index);
    chunks.push({
      type: "import",
      content: match[0],
      meta: { file: filePath, line: startLine }
    });
  }

  // Variables
  const varRegex = /^(configurable\s+\w+\s+\w+\s*=\s*[^;]+;|(?:int|boolean|string|map<[^>]+>)\s+\w+\s*=\s*[^;]+;)/gm;
  while ((match = varRegex.exec(code)) !== null) {
    const startLine = getLineNumber(code, match.index);
    chunks.push({
      type: "variable",
      content: match[0],
      meta: { file: filePath, line: startLine }
    });
  }

  // Functions
  const funcRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*(?:returns\s*([^{]*))?\{([\s\S]*?)\n\}/gm;
  while ((match = funcRegex.exec(code)) !== null) {
    const name = match[1] ?? "unknown_function";
    const params = match[2] ?? "";
    const returnType = (match[3] ?? "void").trim();
    const body = match[4] ?? "";
    const startLine = getLineNumber(code, match.index);
    const endLine = getLineNumber(code, match.index + match[0].length);

    chunks.push({
      type: "function_signature",
      name,
      content: `function ${name}(${params})${returnType !== "void" ? ` returns ${returnType}` : ""}`,
      meta: { parameters: params.split(",").map(p => p.trim()).filter(Boolean), returnType, file: filePath, startLine, endLine }
    });

    chunks.push({
      type: "function_body",
      name,
      content: body,
      meta: { parameters: params.split(",").map(p => p.trim()).filter(Boolean), returnType, file: filePath, startLine, endLine }
    });
  }

  // Services & resources
  const serviceRegex = /service\s+\/([\w\d_-]+)\s+on\s+new\s+http:Listener\([^)]+\)\s*\{([\s\S]*?)\n\}/gm;
  while ((match = serviceRegex.exec(code)) !== null) {
    const servicePath = match[1] ?? "unknown_service";
    const serviceFullCode = match[0];
    const serviceBody = match[2] ?? "";
    const startLine = getLineNumber(code, match.index);
    const endLine = getLineNumber(code, match.index + match[0].length);

    chunks.push({
      type: "service_signature",
      name: servicePath,
      content: `service /${servicePath}`,
      meta: { file: filePath, startLine, endLine }
    });

    chunks.push({
      type: "service_body",
      name: servicePath,
      content: serviceFullCode,
      meta: { file: filePath, startLine, endLine }
    });

    const resourceRegex = /resource function\s+(\w+)\s+([\w\[\]\/]*)\s*\(([^)]*)\)(?:\s*returns\s*([^{]+))?\s*\{([\s\S]*?)\n\}/gm;
    let resourceMatch: RegExpExecArray | null;
    while ((resourceMatch = resourceRegex.exec(serviceBody)) !== null) {
      const method = resourceMatch[1] ?? "unknown_method";
      const pathPart = resourceMatch[2] ?? "";
      const params = resourceMatch[3] ?? "";
      const returnType = (resourceMatch[4] ?? "void").trim();
      const body = resourceMatch[5] ?? "";
      const resStartLine = getLineNumber(serviceBody, resourceMatch.index);
      const resEndLine = getLineNumber(serviceBody, resourceMatch.index + resourceMatch[0].length);

      chunks.push({
        type: "resource_signature",
        name: `${method} ${pathPart}`,
        content: `resource function ${method} ${pathPart}(${params})${returnType !== "void" ? ` returns ${returnType}` : ""}`,
        meta: { parameters: params.split(",").map(p => p.trim()).filter(Boolean), returnType, file: filePath, startLine: resStartLine, endLine: resEndLine, servicePath }
      });

      chunks.push({
        type: "resource_body",
        name: `${method} ${pathPart}`,
        content: body,
        meta: { parameters: params.split(",").map(p => p.trim()).filter(Boolean), returnType, file: filePath, startLine: resStartLine, endLine: resEndLine, servicePath }
      });
    }
  }

  return chunks;
}

// Main
const files = loadBallerinaFiles("./ballerina");
let allChunks: Chunk[] = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  allChunks = allChunks.concat(chunkBallerinaCode(file, content));
}

// Generate timestamp-based file name
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-");
}

// Ensure tests folder exists
mkdirSync("tests", { recursive: true });

const timestamp = getTimestamp();
const jsonFile = `tests/${timestamp}_chunks.json`;

// Save JSON only
writeFileSync(jsonFile, JSON.stringify(allChunks, null, 2), "utf8");

console.log(JSON.stringify(allChunks, null, 2));
console.log(`\nChunks saved to: ${jsonFile}`);

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

interface Chunk {
  type: string;        // import, variable, function_signature, function_body, service_signature, service_body, resource_signature, resource_body
  name?: string;       // function/resource/service name
  content: string;     // code snippet
  meta: any;           // metadata: parameters, returnType, file, startLine, endLine, servicePath, resourcePath
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

  // 1️⃣ Imports
  const importRegex = /^import\s+[^\n;]+;/gm;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code)) !== null) {
    const startLine = getLineNumber(code, match.index);
    chunks.push({
      type: "import",
      content: match[0],
      meta: { file: filePath, line: startLine }
    });
  }

  // 2️⃣ Variables
  const varRegex = /^(configurable\s+\w+\s+\w+\s*=\s*[^;]+;|(?:int|boolean|string|map<[^>]+>)\s+\w+\s*=\s*[^;]+;)/gm;
  while ((match = varRegex.exec(code)) !== null) {
    const startLine = getLineNumber(code, match.index);
    chunks.push({
      type: "variable",
      content: match[0],
      meta: { file: filePath, line: startLine }
    });
  }

  // 3️⃣ Functions
  const funcRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*returns\s*([^{]*)\{([\s\S]*?)\n\}/gm;
  while ((match = funcRegex.exec(code)) !== null) {
    const name = match[1] ?? "unknown_function";
    const params = match[2] ?? "";
    const returnType = match[3] ?? "void";
    const body = match[4] ?? "";
    const startLine = getLineNumber(code, match.index);
    const endLine = getLineNumber(code, match.index + match[0].length);

    // Function signature
    chunks.push({
      type: "function_signature",
      name,
      content: `function ${name}(${params}) returns ${returnType.trim()} {...}`,
      meta: { parameters: params.split(",").map(p => p.trim()), returnType: returnType.trim(), file: filePath, startLine, endLine }
    });

    // Function body
    chunks.push({
      type: "function_body",
      name,
      content: body,
      meta: { parameters: params.split(",").map(p => p.trim()), returnType: returnType.trim(), file: filePath, startLine, endLine }
    });
  }

  // 4️⃣ Services & resource functions
  const serviceRegex = /service\s+\/([\w\d_-]+)\s+on\s+new\s+http:Listener\([^)]+\)\s*\{([\s\S]*?)\n\}/gm;
  while ((match = serviceRegex.exec(code)) !== null) {
    const servicePath = match[1] ?? "unknown_service";
    const serviceFullCode = match[0];
    const serviceBody = match[2] ?? "";
    const startLine = getLineNumber(code, match.index);
    const endLine = getLineNumber(code, match.index + match[0].length);

    // Service signature
    chunks.push({
      type: "service_signature",
      name: servicePath,
      content: `service /${servicePath} {...}`,
      meta: { file: filePath, startLine, endLine }
    });

    // Service body
    chunks.push({
      type: "service_body",
      name: servicePath,
      content: serviceFullCode,
      meta: { file: filePath, startLine, endLine }
    });

    // Resource functions inside service
    const resourceRegex = /resource function\s+(\w+)\s+([\w\[\]\/]*)\s*\(([^)]*)\)(?:\s*returns\s*([^{]+))?\s*\{([\s\S]*?)\n\}/gm;
    let resourceMatch: RegExpExecArray | null;
    while ((resourceMatch = resourceRegex.exec(serviceBody)) !== null) {
      const method = resourceMatch[1] ?? "unknown_method";
      const path = resourceMatch[2] ?? "";
      const params = resourceMatch[3] ?? "";
      const returnType = resourceMatch[4] ?? "void";
      const body = resourceMatch[5] ?? "";
      const resStartLine = getLineNumber(serviceBody, resourceMatch.index);
      const resEndLine = getLineNumber(serviceBody, resourceMatch.index + resourceMatch[0].length);

      // Resource signature
      chunks.push({
        type: "resource_signature",
        name: `${method} ${path}`,
        content: `resource function ${method} ${path}(${params}) returns ${returnType.trim()} {...}`,
        meta: { parameters: params.split(",").map(p => p.trim()), returnType: returnType.trim(), file: filePath, startLine: resStartLine, endLine: resEndLine, servicePath }
      });

      // Resource body
      chunks.push({
        type: "resource_body",
        name: `${method} ${path}`,
        content: body,
        meta: { parameters: params.split(",").map(p => p.trim()), returnType: returnType.trim(), file: filePath, startLine: resStartLine, endLine: resEndLine, servicePath }
      });
    }
  }

  return chunks;
}

// ===== Main =====
const files = loadBallerinaFiles("./ballerina");
let allChunks: Chunk[] = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  allChunks = allChunks.concat(chunkBallerinaCode(file, content));
}

// Print chunks JSON only
console.log(JSON.stringify(allChunks, null, 2));

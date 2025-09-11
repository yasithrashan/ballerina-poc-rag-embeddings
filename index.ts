import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";

interface Chunk {
  type: string;        // import, variable, function_signature, function_body, service, resource_signature, resource_body
  id: string;          // unique ID for each chunk
  name?: string;       // function/resource/service name
  content: string;     // code snippet
  meta: any;           // metadata: parameters, returnType, part, servicePath, etc.
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

// Read file contents
function readFileContents(files: string[]): string[] {
  return files.map(filePath => readFileSync(filePath, "utf8"));
}

// Generate unique ID
let chunkCounter = 0;
function generateId(): string {
  chunkCounter++;
  return `chunk_${chunkCounter}`;
}

// Chunk a single Ballerina file
function chunkBallerinaCode(code: string): Chunk[] {
  const chunks: Chunk[] = [];

  // Imports
  const importRegex = /^import\s+[^\n;]+;/gm;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code)) !== null) {
    chunks.push({ type: "import", id: generateId(), content: match[0], meta: {} });
  }

  // Variables
  const varRegex = /^(configurable\s+\w+\s+\w+\s*=\s*[^;]+;|(?:int|boolean|string|map<[^>]+>)\s+\w+\s*=\s*[^;]+;)/gm;
  while ((match = varRegex.exec(code)) !== null) {
    chunks.push({ type: "variable", id: generateId(), content: match[0], meta: {} });
  }

  // Functions
  const funcRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*returns\s*([^{]*)\{([\s\S]*?)\n\}/gm;
  while ((match = funcRegex.exec(code)) !== null) {
    const funcId = generateId();
    const name = match[1] ?? "unknown_function";
    const params = match[2] ?? "";
    const returnType = match[3] ?? "void";
    const body = match[4] ?? "";

    // Signature
    chunks.push({
      type: "function_signature",
      id: funcId,
      name,
      content: `function ${name}(${params}) returns ${returnType.trim()} {...}`,
      meta: { parameters: params.split(",").map(p => p.trim()), returnType: returnType.trim() }
    });

    // Body
    const MAX_BODY_LENGTH = 300;
    for (let i = 0; i < body.length; i += MAX_BODY_LENGTH) {
      chunks.push({
        type: "function_body",
        id: funcId,
        name,
        content: body.slice(i, i + MAX_BODY_LENGTH),
        meta: { part: Math.floor(i / MAX_BODY_LENGTH) + 1 }
      });
    }
  }

  // Services & resource functions
  const serviceRegex = /service\s+\/([\w\d_-]+)\s+on\s+new\s+http:Listener\([^)]+\)\s*\{([\s\S]*?)\n\}/gm;
  let serviceMatch: RegExpExecArray | null;
  while ((serviceMatch = serviceRegex.exec(code)) !== null) {
    const servicePath = serviceMatch[1] ?? "unknown_service";
    const serviceBody = serviceMatch[2] ?? "";
    const serviceFullCode = serviceMatch[0]; // full service including resources
    const serviceId = generateId();

    // Full service chunk
    chunks.push({
      type: "service",
      id: serviceId,
      name: servicePath,
      content: serviceFullCode,
      meta: { servicePath }
    });

    // Resource functions inside service
    const resourceRegex = /resource function\s+(\w+)\s+([\w\[\]\/]*)\s*\(([^)]*)\)(?:\s*returns\s*([^{]+))?\s*\{([\s\S]*?)\n\}/gm;
    let resourceMatch: RegExpExecArray | null;
    while ((resourceMatch = resourceRegex.exec(serviceBody)) !== null) {
      const resourceId = generateId();
      const method = resourceMatch[1] ?? "unknown_method";
      const path = resourceMatch[2] ?? "";
      const params = resourceMatch[3] ?? "";
      const returnType = resourceMatch[4] ?? "void";
      const body = resourceMatch[5] ?? "";

      // Signature
      chunks.push({
        type: "resource_signature",
        id: resourceId,
        name: `${method} ${path}`,
        content: `resource function ${method} ${path}(${params}) returns ${returnType.trim()} {...}`,
        meta: { parameters: params.split(",").map(p => p.trim()), returnType: returnType.trim(), servicePath }
      });

      // Body
      for (let i = 0; i < body.length; i += 300) {
        chunks.push({
          type: "resource_body",
          id: resourceId,
          name: `${method} ${path}`,
          content: body.slice(i, i + 300),
          meta: { part: Math.floor(i / 300) + 1, servicePath }
        });
      }
    }
  }

  return chunks;
}

// ===== Main =====
const files = loadBallerinaFiles("./ballerina");
const fileContents = readFileContents(files);

let allChunks: Chunk[] = [];
for (const content of fileContents) {
  allChunks = allChunks.concat(chunkBallerinaCode(content));
}

// Print all chunks
console.log(JSON.stringify(allChunks, null, 2));

// Optional: save to bal.md
const markdownContent = allChunks.map(chunk => {
  let md = `### ${chunk.type.toUpperCase()} | ID: ${chunk.id}`;
  if (chunk.name) md += ` | Name: ${chunk.name}`;
  md += `\n\n\`\`\`ballerina\n${chunk.content.trim()}\n\`\`\`\n`;
  return md;
}).join("\n");

writeFileSync("bal.md", markdownContent);
console.log("\nAll chunks written to bal.md");
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export function loadFiles(dir: string): string[] {
  let files: string[] = [];
  try {
    for (const file of readdirSync(dir)) {
      const fullPath = path.join(dir, file);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files = files.concat(loadFiles(fullPath));
      } else if (file.endsWith(".bal")) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
  return files;
}

// Read file content
export function readFiles(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

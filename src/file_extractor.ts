import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export class BallerinaFileExtractor {
    // Load all .bal files recursively
    loadBallerinaFiles(dir: string): string[] {
        let files: string[] = [];
        try {
            for (const file of readdirSync(dir)) {
                const fullPath = path.join(dir, file);
                const stat = statSync(fullPath);
                if (stat.isDirectory()) {
                    files = files.concat(this.loadBallerinaFiles(fullPath));
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
    readFile(filePath: string): string {
        return readFileSync(filePath, "utf-8");
    }
}
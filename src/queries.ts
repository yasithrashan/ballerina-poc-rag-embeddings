import { readFileSync, mkdirSync } from "fs";

import type { QueryWithId } from "./types";


export async function saveRelevantChunksFromJson(jsonFilePath: string, limit: number = 5, outputDir: string = "relevant_chunks") {
    mkdirSync(outputDir, { recursive: true });

    // Read and parse JSON file
    const fileContent = readFileSync(jsonFilePath, "utf-8");
    let queries: QueryWithId[];
    try {
        queries = JSON.parse(fileContent);
    } catch (err) {
        console.error("Failed to parse JSON file:", err);
        return;
    }

    for (const queryItem of queries) {
        const { id, query } = queryItem;
        const texts = query.split(" ");
        console.log(texts);

        console.log(`Processing query ID ${id}: ${query}`);

    }

    console.log("All queries processed successfully!");
}


import { readFileSync } from "fs";
import type { QueryWithId } from "./types";

export async function chunkUserQuery(jsonFilePath: string) {
    // Read and parse JSON file
    const fileContent = readFileSync(jsonFilePath, "utf-8");
    let queries: QueryWithId[];
    try {
        queries = JSON.parse(fileContent);
    } catch (err) {
        console.error("Failed to parse JSON file:", err);
        return [];
    }

    const result = queries.map(queryItem => {
        const { id, query } = queryItem;
        const texts = query.split(" ");
        return {
            id,
            query,
            chunks: texts,
        };
    });
    return result;
}

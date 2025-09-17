import { QdrantClient } from "@qdrant/js-client-rest";
import type { Chunk } from "./types";
import { getEmbeddings } from "./embeddings";

const COLLECTION_NAME = "ballerina_code_chunks";

// Create a Qdrant client
export function createQdrantClient(qdrantUrl: string = "http://localhost:6333") {
  return new QdrantClient({
    url: qdrantUrl,
    checkCompatibility: false,
  });
}

// Ensure collection exists
export async function createCollection(qdrantClient: QdrantClient): Promise<void> {
  const collections = await qdrantClient.getCollections();
  const collectionExists = collections.collections.some(
    (collection) => collection.name === COLLECTION_NAME
  );

  if (!collectionExists) {
    await qdrantClient.createCollection(COLLECTION_NAME, {
      vectors: {
        size: 1024,
        distance: "Cosine",
      },
    });
    console.log(`Created collection: ${COLLECTION_NAME}`);
  }
}

// Upsert code chunks into Qdrant
export async function upsertChunks(
  qdrantClient: QdrantClient,
  chunks: Chunk[],
  embeddings: number[][],
  textsForEmbedding: string[],
  startIndex: number = 0
): Promise<void> {
  if (chunks.length !== embeddings.length) {
    throw new Error("Chunks and embeddings arrays must be the same length");
  }

  const points = chunks
    .map((chunk, idx) => {
      const vector = embeddings[idx];
      if (!vector) return null;
      return {
        id: startIndex + idx,
        vector,
        payload: {
          content: chunk.content,
          type: chunk.metadata,
          line: chunk.metadata.line,
          endLine: chunk.metadata.endLine,
          moduleName: chunk.metadata.moduleName,
          file: chunk.metadata.file,
          chunkId: chunk.metadata.id,
          hash: chunk.metadata.hash,
          textForEmbedding: textsForEmbedding[idx],
        },
      };
    })
    .filter(
      (point): point is { id: number; vector: number[]; payload: any } =>
        point !== null
    );

  await qdrantClient.upsert(COLLECTION_NAME, { points });
}

// Get collection details
export async function getCollection(
  qdrantClient: QdrantClient,
  collectionName: string = COLLECTION_NAME
) {
  try {
    const collectionInfo = await qdrantClient.getCollection(collectionName);
    return collectionInfo;
  } catch (err: any) {
    if (err.response?.status === 404) {
      console.warn(`Collection "${collectionName}" does not exist.`);
      return null;
    }
    throw err;
  }
}


// Query relevant chunks from Qdrant
export async function queryRelevantChunks(
  qdrantClient: QdrantClient,
  query: string,
  voyageApiKey: string,
  limit: number = 8
): Promise<Array<{ score: number; payload: { content: string; metadata: Chunk["metadata"] } }>> {
  if (!query) return [];

  // Generate embedding for query
  const [queryEmbedding] = await getEmbeddings([query], voyageApiKey);
  console.log("Query Embeddings", queryEmbedding);

  // TODO: Add Qdrant search logic here...
  return [];
}

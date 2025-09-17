# Ballerina Code Intelligence System

A sophisticated Retrieval-Augmented Generation (RAG) system designed for semantic code analysis and intelligent querying of Ballerina codebases. This system provides deep understanding of Ballerina code structure through intelligent chunking, vector embeddings, and semantic search capabilities.

## Prerequisites

- **Node.js**: Version 16 or higher
- **Bun runtime**: For optimal performance
- **Qdrant server**: Vector database (local or remote)
- **VoyageAI API key**: For code embeddings

## Quick Start

### 1. Installation

```bash
# Clone and install dependencies
bun install
# or
npm install

# Install Qdrant client
bun add @qdrant/js-client-rest
```

### 2. Start Qdrant Server

```bash
# Using Docker (recommended)
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant

# Access web UI at http://localhost:6333/dashboard
```

### 3. Configure Environment

```bash
export VOYAGE_API_KEY="your_voyage_api_key_here"
export QDRANT_URL="http://localhost:6333"  # Optional, defaults to localhost
```

### 4. Run the System

```bash
# Index Ballerina code and process queries
bun start

# Or specify a custom directory
bun run src/main.ts
```

## Usage Guide

### Core Components

#### BallerinaChunker
The heart of the code analysis system with sophisticated parsing capabilities:

- **Large Function Splitting**: Automatically splits oversized functions while maintaining logical boundaries
- **Resource Decomposition**: Separates HTTP resource signatures from implementation bodies
- **Duplicate Detection**: Content-based deduplication using SHA-256 hashes
- **Context Preservation**: Maintains relationships between related code components

#### Enhanced Metadata System
Each code chunk includes comprehensive metadata:

```typescript
interface EnhancedChunk {
    content: string;
    metadata: {
        type: string;           // Code element type
        name: string | null;    // Element name
        file: string;           // Source filename
        line: number;           // Start line number
        endLine: number;        // End line number
        position: {             // Precise positioning
            start: { line: number; column: number };
            end: { line: number; column: number };
        };
        id: string;             // Hierarchical identifier
        hash: string;           // Content hash for deduplication
        moduleName: string;     // Ballerina module name
        // Type-specific metadata...
    };
}
```

### Query Processing
#### JSON Query Format
For structured queries with IDs, create a JSON file (e.g., `user_queries.json`):
```json
[
    {
        "id": 1,
        "query": "Your query text here"
    },
    {
        "id": 2,
        "query": "Another query"
    }
]
```

Then run:
```bash
bun start
```

## Output Structure

### Code Chunks Export
Generated chunks are saved with comprehensive statistics:
```
tests/
└── chunks_ballerina_2025-01-15T10-30-00-000Z.json
```

The JSON output includes:
- **Metadata**: Source directory, generation timestamp, chunk statistics
- **Type Distribution**: Count of each code element type
- **Module Statistics**: Chunks per module breakdown
- **Size Metrics**: Average and maximum chunk sizes
- **Documentation Coverage**: Chunks with extracted doc comments

### Query Results
Results are organized in the `relevant_chunks/` directory:
```
relevant_chunks/
├── 1.json              # Results for query ID 1
├── 2.json              # Results for query ID 2
└── ...
```

Each result file contains:
```json
{
    "userQuery": "How to create HTTP services?",
    "relevantChunks": [
        {
            "score": 0.89,
            "payload": {
                "content": "service /api on new http:Listener(8080) { ... }",
                "metadata": { /* detailed metadata */ }
            }
        }
    ]
}
```

## Configuration Options

### Environment Variables
```bash
VOYAGE_API_KEY=your_api_key              # Required: VoyageAI API key
QDRANT_URL=http://localhost:6333         # Optional: Qdrant server URL
BAL_FILE_PATH=./ballerina               # Optional: Ballerina source directory
```

### System Parameters
```typescript
// Configurable in chunker.ts
const MAX_CHUNK_SIZE = 5000;            // Maximum characters per chunk
const COLLECTION_NAME = "ballerina_code_chunks";  // Qdrant collection name
const EMBEDDING_MODEL = "voyage-code-3"; // VoyageAI model
```

## Supported Ballerina Constructs

The system recognizes and processes:

| Construct | Detection | Metadata Extracted |
|-----------|-----------|-------------------|
| Imports | `import ballerina/http;` | Package name, alias |
| Configurable Variables | `configurable string host = ?;` | Type, name, default |
| Type Definitions | `type Person record {...}` | Name, visibility, structure |
| Functions | `public function getData() returns json` | Signature, modifiers, parameters, return type |
| Services | `service /api on listener {...}` | Path, listener, resources |
| Resources | `resource function get users() {...}` | HTTP method, path, parameters |
| Classes | `public client class HttpClient {...}` | Name, modifiers, type |
| Constants | `const string API_URL = "...";` | Type, name, visibility |

## Contributing

This system is designed with modularity in mind. Key extension points:

- **Language Support**: Modify `chunker.ts` for other programming languages
- **Embedding Models**: Update `embeddings.ts` for different providers
- **Vector Databases**: Extend `qdrant.ts` for alternative vector stores
- **Query Processing**: Enhance `queries.ts` for advanced query types

## License

This is a research and development system. Please ensure compliance with VoyageAI and Qdrant usage terms.

---

**Note**: This system represents a sophisticated approach to code intelligence, specifically optimized for Ballerina's unique language constructs and patterns. The architecture supports extension to other languages through the modular chunking system.
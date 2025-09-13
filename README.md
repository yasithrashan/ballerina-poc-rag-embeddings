# Code Embedding and Retrieval for BI Copilot

A powerful Retrieval-Augmented Generation (RAG) system specifically designed for indexing and querying Ballerina code. This system chunks Ballerina source code into logical components, creates embeddings using VoyageAI, stores them in Qdrant vector database, and enables semantic search for code understanding and documentation.

## Features

- **Intelligent Code Chunking**: Automatically parses and chunks Ballerina code into logical components:
  - Import statements
  - Configurable variables
  - Module-level variables
  - Type definitions and records
  - Function signatures and bodies
  - Service definitions and resource functions

- **Vector Embeddings**: Uses VoyageAI's `voyage-code-3` model for high-quality code embeddings
- **Vector Database**: Stores and queries embeddings using Qdrant
- **Batch Processing**: Processes multiple user queries from files (supports both text and JSON formats)
- **Context Export**: Saves query results to organized text files for easy review
- **Modular Architecture**: Clean separation of concerns with dedicated modules for each functionality
- **Flexible CLI**: Multiple commands for different use cases

## Prerequisites

- Node.js (v16 or higher)
- Bun runtime
- Qdrant server running locally or remotely
- VoyageAI API key

## Installation

1. Clone the repository and install dependencies:
```bash
bun install
# or
npm install
```

2. Install required dependencies:
```bash
bun add @qdrant/js-client-rest
# or
npm install @qdrant/js-client-rest
# Access web UI at http://localhost:6333/dashboard
```

3. Start Qdrant server (using Docker):
```bash
docker run -p 6333:6333 qdrant/qdrant
```

## Configuration

Set up your environment variables:

```bash
export VOYAGE_API_KEY="your_voyage_api_key_here"
export QDRANT_URL="http://localhost:6333"  # Optional, defaults to localhost
export DEFAULT_QUERY="list all functions"  # Optional default query
```

## Architecture

The system is built with a modular architecture for better maintainability and testability:

```
src/
├── main.ts                 # Main entry point and CLI interface
├── types.ts               # Type definitions and interfaces
├── file_extractor.ts      # Ballerina file loading logic
├── chunker.ts             # Code chunking and JSON export logic
├── embeddings.ts          # VoyageAI embeddings service
├── qdrant.ts              # Qdrant vector database operations
├── queries.ts             # Query processing and context file generation
└── rag_system.ts          # Main RAG system orchestrator
```

### Core Modules

#### `BallerinaRAGSystem` (rag_system.ts)
The main orchestrator that coordinates all components:
- File loading and chunking
- Embedding generation and indexing
- Query processing

#### `BallerinaFileExtractor` (file_extractor.ts)
Handles Ballerina source file operations:
- Recursive directory scanning for `.bal` files
- File content reading

#### `BallerinaChunker` (chunker.ts)
Processes Ballerina code into logical chunks:
- Smart regex-based parsing
- Chunk metadata extraction
- JSON export functionality

#### `EmbeddingsService` (embeddings.ts)
Manages VoyageAI integration:
- Text embedding generation
- Chunk text preparation for embedding
- API response validation

#### `QdrantService` (qdrant.ts)
Handles vector database operations:
- Collection management
- Vector storage and retrieval
- Similarity search

#### `QueryProcessor` (queries.ts)
Processes user queries and generates context files:
- Single and batch query processing
- Context file generation
- Support for both text and JSON query formats

## Usage

### Basic Commands

#### 1. Default Pipeline
Runs the complete indexing pipeline and processes queries:
```bash
bun start
# or
bun run src/main.ts
```
This will:
- Index all `.bal` files in the `ballerina/` directory
- Process queries from `user_queries.txt` if it exists
- Run a default query if no queries file is found

#### 2. Index Ballerina Code
Index a specific directory of Ballerina files:
```bash
bun run src/main.ts index [directory]
bun run src/main.ts index ballerina        # Index the 'ballerina' directory
bun run src/main.ts index ../my-project    # Index a different directory
```

#### 3. Chunk Only (No Indexing)
Generate chunks and save to JSON without indexing to vector database:
```bash
bun run src/main.ts chunk [directory]
bun run src/main.ts chunk ballerina
```

#### 4. Single Query
Run a single query against the indexed code:
```bash
bun run src/main.ts query "How do I create an HTTP service?" 5
bun run src/main.ts query "Show me all error handling functions"
```

#### 5. Batch Query Processing
Process multiple queries from a text file or JSON file:
```bash
bun run src/main.ts queries user_queries.txt 5
bun run src/main.ts queries queries.json 10
```

#### 6. Collection Information
View Qdrant collection statistics:
```bash
bun run src/main.ts info
```

### Query File Formats

#### Text Format
Create a `user_queries.txt` file with one query per line:
```
# This is a comment and will be ignored
How do I create an HTTP service in Ballerina?
What are the available error handling mechanisms?
Show me examples of database connections
How do I handle JSON in Ballerina?
What are the authentication options?
```

#### JSON Format
Create a JSON file with query objects containing ID and query:
```json
[
  {
    "id": 1,
    "query": "How do I create an HTTP service in Ballerina?"
  },
  {
    "id": 2,
    "query": "What are the available error handling mechanisms?"
  },
  {
    "id": 3,
    "query": "Show me examples of database connections"
  }
]
```

Lines starting with `#` in text format are treated as comments and ignored.

## Output Structure

### Chunks JSON Output
The system saves chunked code to `tests/` directory:
```
tests/
├── chunks_ballerina_2024-01-15T10-30-00-000Z.json
└── chunks_my_project_2024-01-15T11-00-00-000Z.json
```

### Context Files Output
Query results are saved to organized directories:

For JSON format queries (using query IDs):
```
context_files/
├── 1.txt
├── 2.txt
└── 3.txt
```

For text format queries:
```
context_files/
├── query_1/
│   └── context_How_do_I_create_2024-01-15T10-30-00-000Z.txt
├── query_2/
│   └── context_What_are_the_available_2024-01-15T10-30-00-000Z.txt
└── single_queries/
    └── context_Show_me_all_functions_2024-01-15T10-30-00-000Z.txt
```

## API Integration

### VoyageAI Configuration
- **Model**: `voyage-code-3` (optimized for code)
- **Embedding Dimension**: 1024
- **Rate Limiting**: Built-in delays between requests

### Qdrant Configuration
- **Distance Metric**: Cosine similarity
- **Collection Name**: `ballerina_code_chunks`
- **Vector Dimension**: 1024


### Batch Processing Settings
- **Batch Size**: 10 chunks per embedding request
- **Error Handling**: Continues processing even if individual queries fail
- **Memory Management**: Efficient chunk processing for large codebases


## Support

For issues and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review the VoyageAI and Qdrant documentation

---

**Note**: This is a Proof of Concept (PoC) system specifically designed for Ballerina code but can be adapted for other programming languages by modifying the chunking regular expressions and patterns in the `chunker.ts` module.
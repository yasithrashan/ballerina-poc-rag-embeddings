# Ballerina RAG System

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
- **Batch Processing**: Processes multiple user queries from files
- **Context Export**: Saves query results to organized text files for easy review
- **Flexible CLI**: Multiple commands for different use cases

## Prerequisites

- Node.js (v16 or higher)
- Bun runtime
- Qdrant server running locally or remotely
- VoyageAI API key

## Installation

1. Clone the repository and install dependencies:
```bash
npm install
# or
bun install
```

2. Install required dependencies:
```bash
npm install @qdrant/js-client-rest
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

## Usage

### Basic Commands

#### 1. Default Pipeline
Runs the complete indexing pipeline and processes queries:
```bash
bun run .
```
This will:
- Index all `.bal` files in the `ballerina/` directory
- Process queries from `user_queries.txt` if it exists
- Run a default query if no queries file is found

#### 2. Index Ballerina Code
Index a specific directory of Ballerina files:
```bash
bun run . index [directory]
bun run . index ballerina        # Index the 'ballerina' directory
bun run . index ../my-project    # Index a different directory
```

#### 3. Chunk Only (No Indexing)
Generate chunks and save to JSON without indexing to vector database:
```bash
bun run . chunk [directory]
bun run . chunk ballerina
```

#### 4. Single Query
Run a single query against the indexed code:
```bash
bun run . query "How do I create an HTTP service?" 5
bun run . query "Show me all error handling functions"
```

#### 5. Batch Query Processing
Process multiple queries from a text file:
```bash
bun run . queries user_queries.txt 5
bun run . queries my_questions.txt 10
```

#### 6. Collection Information
View Qdrant collection statistics:
```bash
bun run . info
```

### Query File Format

Create a `user_queries.txt` file with one query per line:

```
# This is a comment and will be ignored
How do I create an HTTP service in Ballerina?
What are the available error handling mechanisms?
Show me examples of database connections
How do I handle JSON in Ballerina?
What are the authentication options?
```

Lines starting with `#` are treated as comments and ignored.

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
```
context_files/
├── query_1/
│   └── context_How_do_I_create_2024-01-15T10-30-00-000Z.txt
├── query_2/
│   └── context_What_are_the_available_2024-01-15T10-30-00-000Z.txt
└── single_queries/
    └── context_Show_me_all_functions_2024-01-15T10-30-00-000Z.txt
```

## Code Structure

### Main Classes

#### `BallerinaRAGSystem`
The main class that handles all RAG operations:

```typescript
const ragSystem = new BallerinaRAGSystem(qdrantUrl, voyageApiKey);
```

**Key Methods:**
- `indexChunks(directory)`: Complete indexing pipeline
- `chunkAndSave(directory)`: Chunk code and save to JSON only
- `queryRelevantChunks(query, limit)`: Search for relevant code chunks
- `saveContextToFile(query, limit, outputDir)`: Save query results to file

### Chunk Types

The system identifies and processes these Ballerina code elements:

| Type | Description | Example |
|------|-------------|---------|
| `import` | Import statements | `import ballerina/http;` |
| `configurable_variable` | Configurable variables | `configurable string host = "localhost";` |
| `module_variable` | Module-level variables | `final string API_VERSION = "v1";` |
| `type_definition` | Type and record definitions | `type User record { string name; int age; };` |
| `function_signature` | Function declarations | `function getName(User user) returns string` |
| `function_body` | Function implementations | `return user.name;` |
| `service_signature` | Service declarations | `service /api on listener` |
| `resource_signature` | Resource function declarations | `resource function get users() returns User[]` |
| `resource_body` | Resource function implementations | HTTP handling logic |

## API Integration

### VoyageAI Configuration
- **Model**: `voyage-code-3` (optimized for code)
- **Embedding Dimension**: 1024
- **Rate Limiting**: Built-in delays between requests

### Qdrant Configuration
- **Distance Metric**: Cosine similarity
- **Collection Name**: `ballerina_code_chunks`
- **Vector Dimension**: 1024

## Advanced Usage

### Custom Embedding Text Format
The system prepares text for embedding with structured format:
```
Type: function_signature
Name: getUserById
Returns: User|error
Content:
function getUserById(int id) returns User|error
```

### Batch Processing Settings
- **Batch Size**: 10 chunks per embedding request
- **Query Delay**: 2 seconds between queries
- **Error Handling**: Continues processing even if individual queries fail

## Troubleshooting

### Common Issues

1. **VoyageAI API Errors**
   - Check your API key is valid
   - Ensure you have sufficient API credits
   - Verify network connectivity

2. **Qdrant Connection Issues**
   - Ensure Qdrant server is running
   - Check the connection URL
   - Verify port 6333 is accessible

3. **Empty Results**
   - Verify Ballerina files exist in the specified directory
   - Check if indexing completed successfully
   - Try more specific queries

### Debug Information
Enable verbose logging by checking collection info:
```bash
bun run . info
```

## Performance Considerations

- **Indexing Time**: ~1-2 seconds per batch of 10 chunks
- **Memory Usage**: Moderate for large codebases
- **Query Speed**: ~500ms per query including embedding generation
- **Batch Processing**: 2-second delays prevent API rate limiting

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request


## Support

For issues and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review the VoyageAI and Qdrant documentation

---

**Note**: This is a Proof of Concept (PoC) system specifically designed for Ballerina code but can be adapted for other programming languages by modifying the chunking regular expressions and patterns.
# Ballerina Code Intelligence System

A sophisticated Retrieval-Augmented Generation (RAG) system designed for semantic code analysis and intelligent querying of Ballerina codebases. This system provides deep understanding of Ballerina code structure through intelligent chunking, vector embeddings, semantic search capabilities, and AI-powered code generation.

## Prerequisites

- **Node.js**: Version 16 or higher
- **Bun runtime**: For optimal performance
- **Qdrant server**: Vector database (local or remote)
- **VoyageAI API key**: For code embeddings
- **Anthropic API key**: For AI-powered code generation and expansion

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
export ANTHROPIC_API_KEY="your_anthropic_api_key_here"  # Required for AI features
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

### AI-Powered Features

#### Code Expansion System
Automatically expands and organizes relevant code based on semantic search results:

- **Intelligent Context Building**: Analyzes complete Ballerina projects to extract relevant code segments
- **Semantic Organization**: Structures code by imports, configurations, services, and resources
- **Dependency Resolution**: Includes related functions, types, and dependencies for complete context

#### AI Code Generation
Generates high-quality Ballerina code using Claude AI:

- **Context-Aware Generation**: Leverages expanded code context and API documentation
- **Best Practices Compliance**: Follows Ballerina conventions and coding standards
- **Multi-File Support**: Handles complex projects with multiple files and dependencies

#### Connection Manager
Manages Anthropic AI model configurations:

```typescript
// Supported models
export const ANTHROPIC_HAIKU = "claude-3-5-haiku-20241022";
export const ANTHROPIC_SONNET_4 = "claude-sonnet-4-20250514";
export const ANTHROPIC_SONNET_3_5 = "claude-3-5-sonnet-20241022";

// Client initialization with API key validation
export function getAnthropicClinet(model: AnthropicModel): AnthropicModel
```

#### Query Processor
Processes user queries and generates Ballerina code using AI:

- **Multi-Query Processing**: Handles batch processing of multiple user queries
- **API Documentation Integration**: Incorporates Ballerina API docs for accurate code generation
- **Context-Aware Generation**: Uses expanded code context for intelligent modifications
- **Error Handling**: Robust error handling with query-level isolation

#### Code Expander
Expands relevant code chunks into comprehensive, organized documentation:

- **Semantic Analysis**: Uses AI to identify and organize relevant code sections
- **Complete Context**: Includes all necessary dependencies and related components
- **Structured Output**: Organizes code by type (imports, services, resources, etc.)
- **Batch Processing**: Handles multiple query expansions automatically

### Query Processing
#### JSON Query Format
For structured queries with IDs, create a JSON file (e.g., `user_queries.txt`):
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

#### API Documentation Integration
Place API documentation for each query in the `api_docs/` directory:
```
api_docs/
├── 1.json              # API docs for query ID 1
├── 2.json              # API docs for query ID 2
└── ...
```

## Output Structure

### Code Chunks Export
Generated chunks are saved with comprehensive statistics:
```
tests/
└── chunks_ballerina_2025-01-15T10-30-00-000Z.json
```

### Query Results
Results are organized in multiple directories:

```
relevant_chunks/         # Semantic search results
├── 1.json              # Results for query ID 1
├── 2.json              # Results for query ID 2
└── ...

expand_code/            # AI-expanded code context
├── 1.md                # Expanded code for query ID 1
├── 2.md                # Expanded code for query ID 2
└── ...

llm_response/           # AI-generated Ballerina code
├── 1.md                # Generated code for query ID 1
├── 2.md                # Generated code for query ID 2
└── ...
```

### AI-Generated Code Structure
Each generated response includes:
- **Explanation**: Detailed explanation of the solution approach
- **Code Blocks**: Complete, functional Ballerina code organized by file
- **Integration Notes**: How the code integrates with existing systems

Example structure:
```markdown
## Explanation
This solution creates an HTTP service that handles user data...

<code filename="main.bal">
```ballerina
import ballerina/http;
import ballerina/log;

service /api on new http:Listener(8080) {
    // Generated service implementation
}
```
</code>
```

## Configuration Options

### Environment Variables
```bash
VOYAGE_API_KEY=your_voyage_api_key         # Required: VoyageAI API key
ANTHROPIC_API_KEY=your_anthropic_key       # Required: Anthropic API key
QDRANT_URL=http://localhost:6333           # Optional: Qdrant server URL
BAL_FILE_PATH=./ballerina                  # Optional: Ballerina source directory
```

### System Parameters
```typescript
// Configurable in chunker.ts
const MAX_CHUNK_SIZE = 5000;               // Maximum characters per chunk
const COLLECTION_NAME = "ballerina_code_chunks";  // Qdrant collection name
const EMBEDDING_MODEL = "voyage-code-3";    // VoyageAI model

// AI model selection in connection.ts
const ANTHROPIC_SONNET_4 = "claude-sonnet-4-20250514";  // Primary model
const ANTHROPIC_SONNET_3_5 = "claude-3-5-sonnet-20241022";  // Alternative
const ANTHROPIC_HAIKU = "claude-3-5-haiku-20241022";  // Fast model
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

## AI Code Generation Features

### Intelligent Code Generation
- **Context-Aware**: Uses existing code structure and patterns
- **API-Compliant**: Strictly follows provided API documentation
- **Best Practices**: Enforces Ballerina coding conventions
- **Error Handling**: Includes proper error handling patterns

### Code Modification Support
- **Existing Code Analysis**: Understands current implementation
- **Incremental Changes**: Modifies existing code while preserving functionality
- **Dependency Management**: Handles import and dependency updates
- **Integration Safety**: Ensures changes integrate seamlessly

### Advanced Features
- **Multi-File Generation**: Creates complete project structures
- **Type Safety**: Ensures type correctness throughout generated code
- **Resource Optimization**: Efficient use of Ballerina language features
- **Documentation Integration**: Includes relevant comments and documentation

## Contributing

This system is designed with modularity in mind. Key extension points:

- **Language Support**: Modify `chunker.ts` for other programming languages
- **Embedding Models**: Update `embeddings.ts` for different providers
- **Vector Databases**: Extend `qdrant.ts` for alternative vector stores
- **Query Processing**: Enhance `queries.ts` for advanced query types
- **AI Models**: Update `connection.ts` to support additional AI providers
- **Code Expansion**: Extend `expander.ts` for different analysis patterns

## Workflow

1. **Code Analysis**: System chunks and indexes Ballerina code
2. **Semantic Search**: Finds relevant code segments for user queries
3. **Code Expansion**: AI analyzes and organizes relevant code context
4. **Code Generation**: AI generates new Ballerina code based on requirements
5. **Integration**: Generated code is designed to integrate with existing systems

## License

This is a research and development system. Please ensure compliance with VoyageAI, Anthropic, and Qdrant usage terms.

---

**Note**: This system represents a sophisticated approach to AI-powered code intelligence, specifically optimized for Ballerina's unique language constructs and patterns. The architecture supports extension to other languages through the modular chunking system and can be adapted for different AI providers.
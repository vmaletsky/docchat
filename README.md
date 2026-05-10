# DocChat

Chat with your documents using RAG (Retrieval-Augmented Generation).

Upload PDFs → ask questions → get answers grounded in your documents with source citations.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js App (Frontend + API)                           │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │ Upload   │  │ Chat UI  │  │ Document Manager      │  │
│  │ Dropzone │  │ Streaming│  │ List / Delete / Status │  │
│  └────┬─────┘  └────┬─────┘  └───────────────────────┘  │
│       │              │                                   │
│  ─────┼──────────────┼───── API Routes ────────────────  │
│       │              │                                   │
│  ┌────▼─────┐  ┌─────▼──────────────────────────────┐   │
│  │ Ingest   │  │ Chat Handler                        │   │
│  │ Pipeline │  │  1. Hybrid retrieval (vector + FTS) │   │
│  │          │  │  2. Build context from top-K chunks │   │
│  │ Extract  │  │  3. Stream LLM response             │   │
│  │ Chunk    │  │  4. Save to conversation history    │   │
│  │ Embed    │  └─────┬───────────────────────────────┘   │
│  │ Store    │        │                                   │
│  └────┬─────┘        │                                   │
└───────┼──────────────┼───────────────────────────────────┘
        │              │
   ┌────▼──────────────▼────┐     ┌────────────────────┐
   │  PostgreSQL + pgvector │     │  OpenAI API        │
   │                        │     │  (embeddings only) │
   │  • documents           │     └────────────────────┘
   │  • chunks + embeddings │
   │  • conversations       │     ┌────────────────────┐
   │  • messages            │     │  Anthropic API     │
   └────────────────────────┘     │  (chat completion) │
                                  └────────────────────┘
```

## Key Technical Decisions

### No LangChain
Every piece of the RAG pipeline is written from scratch:
- **Chunker**: Recursive text splitter with configurable overlap (~100 LOC)
- **Embeddings**: Direct OpenAI API calls with batching
- **Retrieval**: Custom hybrid search with Reciprocal Rank Fusion

This is intentional. I want to understand and own every step, not hide behind abstractions.

### Hybrid Search (Vector + Full-Text)
Most RAG demos only use vector similarity. This project combines:
- **pgvector** cosine similarity (semantic meaning)
- **PostgreSQL tsvector** full-text search (exact keyword matching)
- **Reciprocal Rank Fusion** to merge both result sets

This matters because vector search alone misses exact terms (names, acronyms, IDs), and full-text search alone misses semantic similarity. Hybrid catches both.

### pgvector over Pinecone/Weaviate
Using Postgres for everything (relational data + vectors) instead of a separate vector database:
- Simpler infrastructure (one database)
- Transactional consistency (chunks and documents in the same DB)
- HNSW indexing for fast approximate nearest neighbor search
- This is what most production systems actually use

### Streaming
Chat responses stream token-by-token via Vercel AI SDK + Server-Sent Events. No waiting for the full response.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL + pgvector (hosted on Neon)
- **ORM**: Drizzle
- **LLM**: Anthropic Claude (via Vercel AI SDK)
- **Embeddings**: OpenAI text-embedding-3-small
- **Styling**: Tailwind CSS
- **Validation**: Zod

## Getting Started

### Prerequisites
- Node.js 20+
- A Neon account (free tier works) — [neon.tech](https://neon.tech)
- OpenAI API key (for embeddings)
- Anthropic API key (for chat)

### Setup

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/docchat.git
cd docchat
npm install

# Configure environment
cp .env.example .env.local
# Fill in DATABASE_URL, OPENAI_API_KEY, ANTHROPIC_API_KEY

# Enable pgvector on your Neon database
# Run the SQL in drizzle/0000_enable_pgvector.sql via Neon console

# Run migrations
npm run db:push

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts        # Streaming chat endpoint
│   │   ├── documents/route.ts   # Document CRUD
│   │   └── upload/route.ts      # File upload + ingestion
│   ├── chat/                    # Chat page
│   └── documents/               # Document management page
├── components/
│   ├── chat/                    # Chat UI components
│   ├── documents/               # Upload, list components
│   └── ui/                      # Shared UI primitives
├── db/
│   ├── index.ts                 # Database connection
│   └── schema.ts                # Drizzle schema (documents, chunks, messages)
└── lib/
    ├── chunker.ts               # Recursive text splitter
    ├── embeddings.ts            # OpenAI embedding API wrapper
    ├── ingest.ts                # Document processing pipeline
    └── retrieval.ts             # Hybrid search + RRF
```

## License

MIT

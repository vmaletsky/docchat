# DocChat

Chat with your documents using RAG (Retrieval-Augmented Generation).

Upload PDFs → ask questions → get answers grounded in your documents with source citations.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js App (Frontend + API)                           │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │ Upload   │  │ Chat UI  │  │ Document Tree Sidebar │  │
│  │ Dropzone │  │ Streaming│  │ Documents + Threads   │  │
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
   │  • messages            │     │  OpenAI API        │
   │  • users               │     │  (chat completion) │
   └────────────────────────┘     └────────────────────┘
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
- **LLM**: OpenAI GPT-4o Mini (via Vercel AI SDK)
- **Embeddings**: OpenAI text-embedding-3-small
- **Auth**: Auth.js v5 (GitHub OAuth, Google OAuth, email/password credentials)
- **Rate limiting**: Upstash Redis
- **Styling**: Tailwind CSS
- **Validation**: Zod

## Features

- **Per-user data isolation** — documents and conversations are scoped to the authenticated user
- **Multiple auth methods** — GitHub OAuth, Google OAuth, or email/password registration
- **Documents-first sidebar** — conversations are nested under their source document
- **Rate limiting** — chat (per user/minute), uploads (10/hour), registration (5 attempts/hour per IP)
- **Client-side file validation** — 20 MB limit with inline error feedback before upload

## Getting Started

### Prerequisites
- Node.js 20+ and pnpm
- A Neon account (free tier works) — [neon.tech](https://neon.tech)
- OpenAI API key
- GitHub OAuth app and/or Google OAuth credentials (for social login)
- Upstash Redis database (free tier works) — [upstash.com](https://upstash.com)

### Setup

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/docchat.git
cd docchat
pnpm install

# Configure environment
cp .env.example .env.local
# Fill in the variables listed below
```

**Required environment variables:**

```env
# Database
DATABASE_URL=postgresql://...

# OpenAI
OPENAI_API_KEY=sk-...

# Auth.js
AUTH_SECRET=<random secret — run: npx auth secret>

# GitHub OAuth (https://github.com/settings/developers)
AUTH_GITHUB_ID=...
AUTH_GITHUB_SECRET=...

# Google OAuth (https://console.cloud.google.com)
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...

# Upstash Redis (https://console.upstash.com)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

```bash
# Enable pgvector and run migrations
pnpm db:push

# Start dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/  # Auth.js handler
│   │   ├── chat/route.ts        # Streaming chat endpoint
│   │   ├── conversations/       # Conversation CRUD + message history
│   │   ├── documents/route.ts   # Document listing
│   │   ├── register/route.ts    # Email/password registration
│   │   └── upload/route.ts      # File upload + ingestion
│   ├── signin/                  # Sign-in page (OAuth + credentials)
│   ├── register/                # Registration page
│   ├── HomeClient.tsx           # Main app shell (client component)
│   └── page.tsx                 # Auth-guarded entry point
├── auth.ts                      # Auth.js config
├── components/
│   ├── chat/                    # ConversationsList
│   ├── documents/               # DocumentsList, DocumentsTree (sidebar)
│   └── ui/                      # Button, DropArea, TextInput
├── db/
│   ├── index.ts                 # Database connection
│   └── schema.ts                # Drizzle schema (users, documents, chunks, conversations, messages)
└── lib/
    ├── chunker.ts               # Recursive text splitter
    ├── embeddings.ts            # OpenAI embedding API wrapper
    ├── ingest.ts                # Document processing pipeline
    ├── ratelimit.ts             # Upstash Redis rate limiting helpers
    └── retrieval.ts             # Hybrid search + RRF
```

## License

MIT

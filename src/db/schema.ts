import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  vector,
  index,
  serial,
} from "drizzle-orm/pg-core";

// ─── Documents ───────────────────────────────────────────────
// Each uploaded file becomes a document record
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Original filename
  mimeType: text("mime_type").notNull(),
  // Total characters extracted
  charCount: integer("char_count").notNull().default(0),
  // Total chunks created from this document
  chunkCount: integer("chunk_count").notNull().default(0),
  // Processing status
  status: text("status", {
    enum: ["processing", "ready", "error"],
  })
    .notNull()
    .default("processing"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Chunks ──────────────────────────────────────────────────
// Document split into overlapping text chunks with embeddings
export const chunks = pgTable(
  "chunks",
  {
    id: serial("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    // Which chunk number within the document (for ordering)
    chunkIndex: integer("chunk_index").notNull(),
    // Approximate page number (for citation)
    pageNumber: integer("page_number"),
    // OpenAI text-embedding-3-small outputs 1536 dimensions
    embedding: vector("embedding", { dimensions: 1536 }),
    // For full-text search (hybrid search)
    searchVector: text("search_vector"),
  },
  (table) => ({
    // HNSW index for fast vector similarity search
    embeddingIdx: index("chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    // GIN index for full-text search
    searchIdx: index("chunks_search_idx").using("gin", table.searchVector),
    // For fetching all chunks of a document
    documentIdx: index("chunks_document_id_idx").on(table.documentId),
  })
);

// ─── Conversations ───────────────────────────────────────────
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("New conversation"),
  // Which documents this conversation is about
  documentIds: uuid("document_ids").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Messages ────────────────────────────────────────────────
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  // Store which chunks were used to generate this response (for citations)
  sourceChunkIds: integer("source_chunk_ids").array().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Types ───────────────────────────────────────────────────
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

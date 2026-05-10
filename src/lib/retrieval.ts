/**
 * Hybrid retrieval: combines pgvector cosine similarity with
 * PostgreSQL full-text search (tsvector/tsquery).
 *
 * This is the differentiator feature — most portfolio RAG projects
 * only do vector search. Production systems almost always use hybrid.
 *
 * Strategy: Reciprocal Rank Fusion (RRF)
 * - Run both searches independently
 * - Score each result by 1/(k + rank) where k=60 (standard RRF constant)
 * - Sum scores for results appearing in both lists
 * - Return top-N by combined score
 */

import { db } from "@/db";
import { chunks, documents } from "@/db/schema";
import { embedText } from "./embeddings";
import { sql, eq, inArray, and } from "drizzle-orm";

interface RetrievedChunk {
  id: number;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  documentId: string;
  documentName: string;
  // Retrieval metadata
  score: number;
  matchedBy: "vector" | "fulltext" | "both";
}

interface RetrievalOptions {
  documentIds: string[];
  topK?: number;
  vectorWeight?: number; // 0-1, how much to weight vector vs fulltext
}

const RRF_K = 60; // Standard RRF constant

/**
 * Vector similarity search using pgvector.
 */
async function vectorSearch(
  queryEmbedding: number[],
  documentIds: string[],
  limit: number
): Promise<Array<{ id: number; rank: number }>> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const results = await db.execute(sql`
    SELECT c.id,
           1 - (c.embedding <=> ${embeddingStr}::vector) as similarity
    FROM chunks c
    WHERE c.document_id = ANY(${documentIds}::uuid[])
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);

  return results.rows.map((row: any, index: number) => ({
    id: row.id as number,
    rank: index + 1,
  }));
}

/**
 * Full-text search using PostgreSQL tsvector/tsquery.
 */
async function fulltextSearch(
  query: string,
  documentIds: string[],
  limit: number
): Promise<Array<{ id: number; rank: number }>> {
  // Convert natural language query to tsquery
  // plainto_tsquery handles this safely without SQL injection risk
  const results = await db.execute(sql`
    SELECT c.id,
           ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', ${query})) as rank_score
    FROM chunks c
    WHERE c.document_id = ANY(${documentIds}::uuid[])
      AND to_tsvector('english', c.content) @@ plainto_tsquery('english', ${query})
    ORDER BY rank_score DESC
    LIMIT ${limit}
  `);

  return results.rows.map((row: any, index: number) => ({
    id: row.id as number,
    rank: index + 1,
  }));
}

/**
 * Reciprocal Rank Fusion: merge two ranked lists into one.
 */
function reciprocalRankFusion(
  vectorResults: Array<{ id: number; rank: number }>,
  fulltextResults: Array<{ id: number; rank: number }>,
  vectorWeight: number
): Map<number, { score: number; matchedBy: "vector" | "fulltext" | "both" }> {
  const scores = new Map<
    number,
    { score: number; matchedBy: "vector" | "fulltext" | "both" }
  >();

  const fulltextWeight = 1 - vectorWeight;

  for (const { id, rank } of vectorResults) {
    const rrfScore = vectorWeight * (1 / (RRF_K + rank));
    scores.set(id, { score: rrfScore, matchedBy: "vector" });
  }

  for (const { id, rank } of fulltextResults) {
    const rrfScore = fulltextWeight * (1 / (RRF_K + rank));
    const existing = scores.get(id);

    if (existing) {
      scores.set(id, {
        score: existing.score + rrfScore,
        matchedBy: "both",
      });
    } else {
      scores.set(id, { score: rrfScore, matchedBy: "fulltext" });
    }
  }

  return scores;
}

/**
 * Main retrieval function: hybrid search with RRF.
 */
export async function retrieveChunks(
  query: string,
  options: RetrievalOptions
): Promise<RetrievedChunk[]> {
  const { documentIds, topK = 8, vectorWeight = 0.7 } = options;

  if (documentIds.length === 0) return [];

  // Run both searches in parallel
  const queryEmbedding = await embedText(query);

  const [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(queryEmbedding, documentIds, topK * 2),
    fulltextSearch(query, documentIds, topK * 2),
  ]);

  // Fuse results
  const fusedScores = reciprocalRankFusion(
    vectorResults,
    fulltextResults,
    vectorWeight
  );

  // Sort by score and take top K
  const topIds = [...fusedScores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK)
    .map(([id]) => id);

  if (topIds.length === 0) return [];

  // Fetch full chunk data + document names
  const chunkRows = await db
    .select({
      id: chunks.id,
      content: chunks.content,
      chunkIndex: chunks.chunkIndex,
      pageNumber: chunks.pageNumber,
      documentId: chunks.documentId,
      documentName: documents.name,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(inArray(chunks.id, topIds));

  // Attach scores and sort by fused score
  const result: RetrievedChunk[] = chunkRows
    .map((row) => {
      const scoreData = fusedScores.get(row.id)!;
      return {
        ...row,
        score: scoreData.score,
        matchedBy: scoreData.matchedBy,
      };
    })
    .sort((a, b) => b.score - a.score);

  return result;
}

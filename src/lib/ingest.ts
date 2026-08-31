import { db } from "@/db";
import { documents, chunks, type NewChunk } from "@/db/schema";
import { chunkText } from "./chunker";
import { embedTexts } from "./embeddings";
import { and, eq, lt } from "drizzle-orm";
import { createHash } from "crypto";
import { callParser } from "./parser";
import { deleteFromS3 } from "./storage";

/** Parser service can return null bytes; Postgres rejects them in text columns. */
function stripNullBytes(text: string): string {
  return text.replace(/\u0000/g, "");
}

// If the waitUntil invocation running runIngest is killed (timeout, cold-start
// eviction, etc.) before its catch block runs, a document is left stuck in
// "processing" forever with no error and nothing polling it. This TTL bounds
// how long we wait before treating it as failed.
const STUCK_INGEST_TIMEOUT_MS = 10 * 60 * 1000;

type CreateDocumentResult = {
  documentId: string;
  buffer: Buffer;
  deduplicated: boolean;
  status: "processing" | "ready";
  needsIngest: boolean;
};

type ExistingDocument = {
  id: string;
  status: "processing" | "ready" | "error";
};

async function findDuplicate(
  userId: string,
  contentHash: string
): Promise<ExistingDocument | undefined> {
  const [existing] = await db
    .select({ id: documents.id, status: documents.status })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.contentHash, contentHash)))
    .limit(1);
  return existing;
}

/**
 * A duplicate whose previous ingest failed is reset to "processing" (with any
 * partial chunks cleared) so the caller re-runs the pipeline; otherwise the
 * duplicate is returned with its actual status.
 */
async function resolveDuplicate(
  existing: ExistingDocument,
  buffer: Buffer
): Promise<CreateDocumentResult> {
  if (existing.status === "error") {
    await db.delete(chunks).where(eq(chunks.documentId, existing.id));
    await db
      .update(documents)
      .set({ status: "processing", errorMessage: null })
      .where(eq(documents.id, existing.id));
    return {
      documentId: existing.id,
      buffer,
      deduplicated: true,
      status: "processing",
      needsIngest: true,
    };
  }
  return {
    documentId: existing.id,
    buffer,
    deduplicated: true,
    status: existing.status,
    needsIngest: false,
  };
}

/**
 * Check for a duplicate upload and, if none, insert a document row in
 * "processing" status. Returns immediately — does not run the pipeline.
 */
export async function createDocumentRecord(
  file: File,
  userId: string
): Promise<CreateDocumentResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const existing = await findDuplicate(userId, contentHash);
  if (existing) {
    return resolveDuplicate(existing, buffer);
  }

  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      name: file.name,
      mimeType: file.type,
      status: "processing",
      contentHash,
    })
    .onConflictDoNothing({ target: [documents.userId, documents.contentHash] })
    .returning({ id: documents.id });

  if (!doc) {
    // A concurrent upload of the same file won the insert race.
    const winner = await findDuplicate(userId, contentHash);
    if (!winner) {
      throw new Error("Failed to create document record");
    }
    return resolveDuplicate(winner, buffer);
  }

  return {
    documentId: doc.id,
    buffer,
    deduplicated: false,
    status: "processing",
    needsIngest: true,
  };
}

/**
 * Run the full ingest pipeline for a document already stored in S3.
 * Intended to be passed to waitUntil() so it runs after the HTTP response.
 * Deletes the S3 object on success (non-fatal if the delete fails).
 */
export async function runIngest(
  documentId: string,
  s3Key: string
): Promise<void> {
  try {
    const parseResult = await callParser(documentId, s3Key);

    const textPages = parseResult.pages
      .filter((p) => p.has_text && p.text.trim().length > 0)
      .map((p) => ({ pageNumber: p.page_number, text: stripNullBytes(p.text) }));

    if (textPages.length === 0) {
      throw new Error("No text could be extracted from this PDF");
    }

    const pending: Array<{ content: string; pageNumber: number }> = [];
    for (const page of textPages) {
      const pageChunks = chunkText(page.text, {
        maxChunkSize: 1000,
        overlapSize: 200,
      });
      for (const c of pageChunks) {
        pending.push({ content: c.content, pageNumber: page.pageNumber });
      }
    }

    if (pending.length === 0) {
      throw new Error("Document produced no chunks after splitting");
    }

    const embeddings = await embedTexts(pending.map((c) => c.content));

    const chunkRecords: NewChunk[] = pending.map((c, i) => ({
      documentId,
      content: c.content,
      chunkIndex: i,
      pageNumber: c.pageNumber,
      embedding: embeddings[i],
    }));

    const BATCH_SIZE = 50;
    for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
      await db.insert(chunks).values(chunkRecords.slice(i, i + BATCH_SIZE));
    }

    await db
      .update(documents)
      .set({
        status: "ready",
        charCount: parseResult.metadata.total_char_count,
        chunkCount: chunkRecords.length,
      })
      .where(eq(documents.id, documentId));

    try {
      await deleteFromS3(s3Key);
    } catch (err) {
      console.error("Failed to delete S3 object after ingest:", err);
    }
  } catch (error) {
    await db
      .update(documents)
      .set({
        status: "error",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error occurred",
      })
      .where(eq(documents.id, documentId));
  }
}

/**
 * Flip documents stuck in "processing" past STUCK_INGEST_TIMEOUT_MS to
 * "error" so the UI stops polling them and the existing re-upload retry
 * path (resolveDuplicate) can take over. Scoped to one user and intended to
 * run opportunistically (e.g. on each GET /api/documents).
 */
export async function sweepStuckDocuments(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_INGEST_TIMEOUT_MS);

  const stuck = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.status, "processing"),
        lt(documents.createdAt, cutoff)
      )
    );

  for (const doc of stuck) {
    await db
      .update(documents)
      .set({
        status: "error",
        errorMessage: "Processing timed out. Please try uploading again.",
      })
      .where(eq(documents.id, doc.id));
  }
}

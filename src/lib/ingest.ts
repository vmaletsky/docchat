/**
 * Document ingestion pipeline:
 *   Upload → Extract text → Chunk → Embed → Store in pgvector
 *
 * This is the "backend" of the RAG system. Each step is explicit
 * and testable — no LangChain magic.
 */

import { db } from "@/db";
import { documents, chunks, type NewChunk } from "@/db/schema";
import { chunkText, estimatePageNumber } from "./chunker";
import { embedTexts } from "./embeddings";
import { eq } from "drizzle-orm";
import pdfParse from "pdf-parse";

/**
 * Process an uploaded PDF file end-to-end.
 * Returns the document ID.
 */
export async function processDocument(
  file: File
): Promise<{ documentId: string }> {
  // 1. Create document record (status: processing)
  const [doc] = await db
    .insert(documents)
    .values({
      name: file.name,
      mimeType: file.type,
      status: "processing",
    })
    .returning({ id: documents.id });

  try {
    // 2. Extract text from PDF
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await pdfParse(buffer);
    const text = parsed.text;

    if (!text || text.trim().length === 0) {
      throw new Error("No text could be extracted from this PDF");
    }

    // 3. Chunk the text
    const textChunks = chunkText(text, {
      maxChunkSize: 1000,
      overlapSize: 200,
    });

    if (textChunks.length === 0) {
      throw new Error("Document produced no chunks after splitting");
    }

    // 4. Generate embeddings for all chunks (batched)
    const chunkContents = textChunks.map((c) => c.content);
    const embeddings = await embedTexts(chunkContents);

    // 5. Store chunks with embeddings
    const chunkRecords: NewChunk[] = textChunks.map((chunk, i) => {
      // Calculate approximate character offset for page estimation
      const charOffset = text.indexOf(chunk.content.slice(0, 50));

      return {
        documentId: doc.id,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        pageNumber: estimatePageNumber(charOffset >= 0 ? charOffset : i * 1000),
        embedding: embeddings[i],
      };
    });

    // Insert in batches of 50 to avoid query size limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
      const batch = chunkRecords.slice(i, i + BATCH_SIZE);
      await db.insert(chunks).values(batch);
    }

    // 6. Update document status
    await db
      .update(documents)
      .set({
        status: "ready",
        charCount: text.length,
        chunkCount: textChunks.length,
      })
      .where(eq(documents.id, doc.id));

    return { documentId: doc.id };
  } catch (error) {
    // Mark document as failed
    await db
      .update(documents)
      .set({
        status: "error",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error occurred",
      })
      .where(eq(documents.id, doc.id));

    throw error;
  }
}

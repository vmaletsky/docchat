/**
 * Document ingestion pipeline:
 *   Upload → Extract per-page text → Chunk → Embed → Store in pgvector
 *
 * This is the "backend" of the RAG system. Each step is explicit
 * and testable — no LangChain magic.
 */

import { db } from "@/db";
import { documents, chunks, type NewChunk } from "@/db/schema";
import { chunkText } from "./chunker";
import { embedTexts } from "./embeddings";
import { eq } from "drizzle-orm";
import pdfParse from "pdf-parse";

/** pdf-parse can emit null bytes; Postgres rejects them in text columns. */
function stripNullBytes(text: string): string {
  return text.replace(/\u0000/g, "");
}

/**
 * Extract a PDF as an ordered array of per-page text using pdf-parse's
 * `pagerender` hook, which is invoked once per page with that page's
 * pdf.js page proxy. Index `i` holds page `i + 1`'s text.
 *
 * The text comes from pdf.js `getTextContent()` — real extracted text,
 * not OCR — so scanned/image-only pages yield an empty string.
 */
async function extractPages(buffer: Buffer): Promise<string[]> {
  const pages: string[] = [];

  await pdfParse(buffer, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pagerender: async (pageData: any) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });

      // Reconstruct text, inserting a newline whenever the vertical
      // position changes (mirrors pdf-parse's default renderer, which
      // preserves line breaks for cleaner chunk boundaries).
      let lastY: number | undefined;
      let text = "";
      for (const item of textContent.items as Array<{
        str: string;
        transform: number[];
      }>) {
        if (lastY === undefined || lastY === item.transform[5]) {
          text += item.str;
        } else {
          text += "\n" + item.str;
        }
        lastY = item.transform[5];
      }

      // pdf-parse processes pages in order; pageNumber is 1-based.
      const pageNumber: number = pageData.pageNumber ?? pages.length + 1;
      pages[pageNumber - 1] = stripNullBytes(text);

      // Returned value flows into the (unused) concatenated `data.text`.
      return text;
    },
  });

  return pages;
}

/**
 * Process an uploaded PDF file end-to-end.
 * Returns the document ID.
 */
export async function processDocument(
  file: File,
  userId: string
): Promise<{ documentId: string }> {
  // 1. Create document record (status: processing)
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      name: file.name,
      mimeType: file.type,
      status: "processing",
    })
    .returning({ id: documents.id });

  try {
    // 2. Extract text from PDF, one entry per page
    const buffer = Buffer.from(await file.arrayBuffer());
    const pages = await extractPages(buffer);

    if (pages.every((p) => !p || p.trim().length === 0)) {
      throw new Error("No text could be extracted from this PDF");
    }

    // 3. Chunk each page independently so every chunk carries its
    //    true page number (no more character-offset estimation).
    const pending: Array<{ content: string; pageNumber: number }> = [];
    pages.forEach((pageText, pageIdx) => {
      if (!pageText || pageText.trim().length === 0) return; // skip blank pages
      const pageChunks = chunkText(pageText, {
        maxChunkSize: 1000,
        overlapSize: 200,
      });
      for (const c of pageChunks) {
        pending.push({ content: c.content, pageNumber: pageIdx + 1 });
      }
    });

    if (pending.length === 0) {
      throw new Error("Document produced no chunks after splitting");
    }

    // 4. Generate embeddings for all chunks (batched)
    const embeddings = await embedTexts(pending.map((c) => c.content));

    // 5. Assemble records with a global, monotonic chunk index
    const chunkRecords: NewChunk[] = pending.map((c, i) => ({
      documentId: doc.id,
      content: c.content,
      chunkIndex: i,
      pageNumber: c.pageNumber,
      embedding: embeddings[i],
    }));

    // Insert in batches of 50 to avoid query size limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
      const batch = chunkRecords.slice(i, i + BATCH_SIZE);
      await db.insert(chunks).values(batch);
    }

    // 6. Update document status
    const charCount = pages.reduce((sum, p) => sum + (p?.length ?? 0), 0);
    await db
      .update(documents)
      .set({
        status: "ready",
        charCount,
        chunkCount: chunkRecords.length,
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

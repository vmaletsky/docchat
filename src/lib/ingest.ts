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
import { and, eq } from "drizzle-orm";
import { createHash } from "crypto";
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
 * Check for a duplicate upload and, if none, insert a document row in
 * "processing" status. Returns immediately — does not run the pipeline.
 */
export async function createDocumentRecord(
  file: File,
  userId: string
): Promise<{ documentId: string; buffer: Buffer; deduplicated: boolean }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.contentHash, contentHash)))
    .limit(1);

  if (existing) {
    return { documentId: existing.id, buffer, deduplicated: true };
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
    .returning({ id: documents.id });

  return { documentId: doc.id, buffer, deduplicated: false };
}

/**
 * Run the full ingest pipeline for a document that already has a DB record.
 * Intended to be passed to waitUntil() so it runs after the HTTP response.
 */
export async function runIngest(
  documentId: string,
  buffer: Buffer
): Promise<void> {
  try {
    const pages = await extractPages(buffer);

    if (pages.every((p) => !p || p.trim().length === 0)) {
      throw new Error("No text could be extracted from this PDF");
    }

    const pending: Array<{ content: string; pageNumber: number }> = [];
    pages.forEach((pageText, pageIdx) => {
      if (!pageText || pageText.trim().length === 0) return;
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

    const charCount = pages.reduce((sum, p) => sum + (p?.length ?? 0), 0);
    await db
      .update(documents)
      .set({ status: "ready", charCount, chunkCount: chunkRecords.length })
      .where(eq(documents.id, documentId));
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

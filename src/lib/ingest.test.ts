import { describe, it, expect, beforeEach, vi } from "vitest";
import PDFDocument from "pdfkit";

// Capture the chunk rows that processDocument tries to insert.
// Hoisted so the vi.mock factory below can close over it.
const { insertedChunks, reset } = vi.hoisted(() => {
  const insertedChunks: Array<{
    content: string;
    chunkIndex: number;
    pageNumber: number | null;
  }> = [];
  return { insertedChunks, reset: () => (insertedChunks.length = 0) };
});

// Stub the database: capture chunk batches, no-op everything else.
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (vals: unknown) => {
        // Chunk inserts pass an array (a batch); the document insert
        // passes a single object — only the former is interesting here.
        if (Array.isArray(vals)) insertedChunks.push(...vals);
        const thenable = Promise.resolve(undefined) as Promise<undefined> & {
          returning?: () => Promise<Array<{ id: string }>>;
        };
        thenable.returning = async () => [{ id: "test-doc-id" }];
        return thenable;
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

// Avoid hitting OpenAI: deterministic 1536-dim zero vectors.
vi.mock("@/lib/embeddings", () => ({
  embedTexts: async (texts: string[]) =>
    texts.map(() => new Array(1536).fill(0)),
}));

// Imported after the mocks (vi.mock + vi.hoisted are hoisted above this).
import { processDocument } from "./ingest";

/** Build an in-memory PDF with one line of text per page. */
// pdfkit emits classic PDF 1.3 structure that the old pdf.js bundled
// inside pdf-parse parses reliably.
function makePdf(pageTexts: string[]): Promise<File> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const parts: Buffer[] = [];
    doc.on("data", (c: Buffer) => parts.push(c));
    doc.on("error", reject);
    doc.on("end", () =>
      resolve(new File([Buffer.concat(parts)], "sample.pdf", { type: "application/pdf" }))
    );
    for (const text of pageTexts) {
      doc.addPage().fontSize(24).text(text, 50, 100);
    }
    doc.end();
  });
}

describe("processDocument page numbering", () => {
  beforeEach(() => reset());

  it("tags each chunk with the real page its text came from", async () => {
    // Underscore markers stay intact even if pdf.js drops inter-word spacing.
    const file = await makePdf([
      "PAGEONEMARKER alpha content on the first page",
      "PAGETWOMARKER bravo content on the second page",
      "PAGETHREEMARKER charlie content on the third page",
    ]);

    await processDocument(file, "user-1");

    expect(insertedChunks.length).toBeGreaterThanOrEqual(3);

    const pageOf = (marker: string) =>
      insertedChunks.find((c) => c.content.includes(marker))?.pageNumber;

    expect(pageOf("PAGEONEMARKER")).toBe(1);
    expect(pageOf("PAGETWOMARKER")).toBe(2);
    expect(pageOf("PAGETHREEMARKER")).toBe(3);
  });

  it("assigns a global, gap-free, ascending chunkIndex across pages", async () => {
    const file = await makePdf([
      "PAGEONEMARKER first",
      "PAGETWOMARKER second",
      "PAGETHREEMARKER third",
    ]);

    await processDocument(file, "user-1");

    const indices = insertedChunks.map((c) => c.chunkIndex);
    expect(indices).toEqual(indices.map((_, i) => i)); // 0,1,2,... no gaps, ordered
  });
});

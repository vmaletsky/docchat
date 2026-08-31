import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockCallParser,
  mockDeleteFromS3,
  dbUpdateCalls,
  dbDeleteCount,
  selectQueue,
  insertConflict,
  insertedChunks,
  resetMocks,
} = vi.hoisted(() => {
  process.env.PARSER_URL = "http://parser:8000";
  process.env.PARSER_API_SECRET = "test-secret";
  const mockCallParser = vi.fn();
  const mockDeleteFromS3 = vi.fn();
  const dbUpdateCalls: Record<string, unknown>[] = [];
  const dbDeleteCount = { value: 0 };
  // Each entry is the result set of one select; selects past the end return [].
  const selectQueue: unknown[][] = [];
  const insertConflict = { value: false };
  const insertedChunks: unknown[] = [];
  return {
    mockCallParser,
    mockDeleteFromS3,
    dbUpdateCalls,
    dbDeleteCount,
    selectQueue,
    insertConflict,
    insertedChunks,
    resetMocks: () => {
      mockCallParser.mockReset();
      mockDeleteFromS3.mockReset();
      dbUpdateCalls.length = 0;
      dbDeleteCount.value = 0;
      selectQueue.length = 0;
      insertConflict.value = false;
      insertedChunks.length = 0;
    },
  };
});

vi.mock("@/lib/parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parser")>();
  return { ...actual, callParser: mockCallParser };
});

vi.mock("@/lib/storage", () => ({
  deleteFromS3: mockDeleteFromS3,
  uploadToS3: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const result = selectQueue.shift() ?? [];
          const thenable = Promise.resolve(result) as Promise<unknown[]> & {
            limit?: (n: number) => Promise<unknown[]>;
          };
          thenable.limit = async () => result;
          return thenable;
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        dbDeleteCount.value += 1;
      },
    }),
    insert: () => ({
      values: (vals: unknown) => {
        if (Array.isArray(vals)) insertedChunks.push(...vals);
        const returning = async () =>
          insertConflict.value ? [] : [{ id: "test-doc-id" }];
        const thenable = Promise.resolve(undefined) as Promise<undefined> & {
          returning?: typeof returning;
          onConflictDoNothing?: () => { returning: typeof returning };
        };
        thenable.returning = returning;
        thenable.onConflictDoNothing = () => ({ returning });
        return thenable;
      },
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        dbUpdateCalls.push(vals);
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock("@/lib/embeddings", () => ({
  embedTexts: async (texts: string[]) => texts.map(() => new Array(1536).fill(0)),
}));

import { createDocumentRecord, runIngest, sweepStuckDocuments } from "./ingest";
import { ParserError } from "./parser";

function makePdfFile(content = "%PDF-1.4 test"): File {
  return new File([content], "test.pdf", { type: "application/pdf" });
}

function makeParseResponse(pages: Array<{ page_number: number; text: string }>) {
  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  return {
    document_id: "doc-id",
    page_count: pages.length,
    pages: pages.map((p) => ({
      page_number: p.page_number,
      text: p.text,
      char_count: p.text.length,
      has_text: p.text.length > 0,
    })),
    metadata: {
      title: null,
      author: null,
      subject: null,
      total_char_count: totalChars,
      image_only_pages: [],
    },
  };
}

describe("createDocumentRecord", () => {
  beforeEach(() => resetMocks());

  it("inserts a new document in processing status when no duplicate exists", async () => {
    const result = await createDocumentRecord(makePdfFile(), "user-1");

    expect(result).toMatchObject({
      documentId: "test-doc-id",
      deduplicated: false,
      status: "processing",
      needsIngest: true,
    });
  });

  it("returns the duplicate's actual status without re-ingesting when it is ready", async () => {
    selectQueue.push([{ id: "existing-1", status: "ready" }]);

    const result = await createDocumentRecord(makePdfFile(), "user-1");

    expect(result).toMatchObject({
      documentId: "existing-1",
      deduplicated: true,
      status: "ready",
      needsIngest: false,
    });
    expect(dbUpdateCalls).toHaveLength(0);
    expect(dbDeleteCount.value).toBe(0);
  });

  it("returns status=processing without re-ingesting when the duplicate is still processing", async () => {
    selectQueue.push([{ id: "existing-2", status: "processing" }]);

    const result = await createDocumentRecord(makePdfFile(), "user-1");

    expect(result).toMatchObject({
      documentId: "existing-2",
      deduplicated: true,
      status: "processing",
      needsIngest: false,
    });
    expect(dbUpdateCalls).toHaveLength(0);
  });

  it("resets an errored duplicate to processing, clears partial chunks, and requests re-ingest", async () => {
    selectQueue.push([{ id: "existing-3", status: "error" }]);

    const result = await createDocumentRecord(makePdfFile(), "user-1");

    expect(result).toMatchObject({
      documentId: "existing-3",
      deduplicated: true,
      status: "processing",
      needsIngest: true,
    });
    expect(dbDeleteCount.value).toBe(1);
    expect(dbUpdateCalls).toHaveLength(1);
    expect(dbUpdateCalls[0]).toMatchObject({
      status: "processing",
      errorMessage: null,
    });
  });

  it("treats the document as a duplicate when a concurrent upload wins the insert race", async () => {
    // First lookup finds nothing; the insert then conflicts, and the
    // follow-up lookup finds the row the concurrent request created.
    insertConflict.value = true;
    selectQueue.push([]);
    selectQueue.push([{ id: "winner-doc", status: "processing" }]);

    const result = await createDocumentRecord(makePdfFile(), "user-1");

    expect(result).toMatchObject({
      documentId: "winner-doc",
      deduplicated: true,
      status: "processing",
      needsIngest: false,
    });
  });
});

describe("runIngest", () => {
  beforeEach(() => resetMocks());

  it("sets status=ready with correct chunkCount and charCount on success", async () => {
    const response = makeParseResponse([
      { page_number: 1, text: "Hello world on page one" },
      { page_number: 2, text: "More content on page two" },
    ]);
    mockCallParser.mockResolvedValue(response);
    mockDeleteFromS3.mockResolvedValue(undefined);

    await runIngest("doc-id", "uploads/user-1/doc-id.pdf");

    const successUpdate = dbUpdateCalls.find((c) => c.status === "ready");
    expect(successUpdate).toBeDefined();
    expect(successUpdate).toMatchObject({
      status: "ready",
      charCount: response.metadata.total_char_count,
      chunkCount: insertedChunks.length,
    });
    expect(insertedChunks.length).toBeGreaterThan(0);
  });

  it("sets status=error with errorMessage=error.detail when callParser throws ParserError", async () => {
    const parserErr = new ParserError("no_extractable_text", "PDF contains no extractable text");
    mockCallParser.mockRejectedValue(parserErr);

    await runIngest("doc-id", "uploads/user-1/doc-id.pdf");

    expect(dbUpdateCalls).toHaveLength(1);
    expect(dbUpdateCalls[0]).toMatchObject({
      status: "error",
      errorMessage: "PDF contains no extractable text",
    });
  });

  it("still sets status=ready when deleteFromS3 throws after successful ingest", async () => {
    mockCallParser.mockResolvedValue(
      makeParseResponse([{ page_number: 1, text: "Some content here for testing" }])
    );
    mockDeleteFromS3.mockRejectedValue(new Error("S3 delete failed"));

    await runIngest("doc-id", "uploads/user-1/doc-id.pdf");

    expect(dbUpdateCalls.find((c) => c.status === "ready")).toBeDefined();
    expect(dbUpdateCalls.find((c) => c.status === "error")).toBeUndefined();
  });

  it("strips NUL bytes from page text before chunking", async () => {
    mockCallParser.mockResolvedValue(
      makeParseResponse([
        { page_number: 1, text: "Before\u0000After and more\u0000content here" },
      ])
    );
    mockDeleteFromS3.mockResolvedValue(undefined);

    await runIngest("doc-id", "uploads/user-1/doc-id.pdf");

    expect(insertedChunks.length).toBeGreaterThan(0);
    const contents = (insertedChunks as Array<{ content: string }>).map(
      (c) => c.content
    );
    expect(contents.join("")).not.toContain("\u0000");
    expect(contents[0]).toContain("BeforeAfter");
  });

  it("calls deleteFromS3 with the same s3Key passed to runIngest", async () => {
    mockCallParser.mockResolvedValue(
      makeParseResponse([{ page_number: 1, text: "Content for deletion test" }])
    );
    mockDeleteFromS3.mockResolvedValue(undefined);

    await runIngest("doc-id", "uploads/user-1/doc-id.pdf");

    expect(mockDeleteFromS3).toHaveBeenCalledWith("uploads/user-1/doc-id.pdf");
  });
});

describe("sweepStuckDocuments", () => {
  beforeEach(() => resetMocks());

  it("does nothing when no documents are stuck", async () => {
    selectQueue.push([]);

    await sweepStuckDocuments("user-1");

    expect(dbUpdateCalls).toHaveLength(0);
  });

  it("marks a stuck processing document as error", async () => {
    selectQueue.push([{ id: "stuck-doc-1" }]);

    await sweepStuckDocuments("user-1");

    expect(dbUpdateCalls).toHaveLength(1);
    expect(dbUpdateCalls[0]).toMatchObject({
      status: "error",
      errorMessage: "Processing timed out. Please try uploading again.",
    });
  });

  it("marks every stuck document returned by the query", async () => {
    selectQueue.push([{ id: "stuck-doc-1" }, { id: "stuck-doc-2" }]);

    await sweepStuckDocuments("user-1");

    expect(dbUpdateCalls).toHaveLength(2);
    for (const call of dbUpdateCalls) {
      expect(call).toMatchObject({ status: "error" });
    }
  });
});

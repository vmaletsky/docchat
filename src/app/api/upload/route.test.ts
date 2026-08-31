import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockCreateDocumentRecord,
  mockRunIngest,
  mockUploadToS3,
  mockWaitUntil,
  mockAuth,
  mockRatelimitLimit,
  mockDbSet,
  mockDbWhere,
  resetMocks,
} = vi.hoisted(() => {
  const mockCreateDocumentRecord = vi.fn();
  const mockRunIngest = vi.fn();
  const mockUploadToS3 = vi.fn();
  const mockWaitUntil = vi.fn();
  const mockAuth = vi.fn();
  const mockRatelimitLimit = vi.fn();
  const mockDbWhere = vi.fn().mockResolvedValue(undefined);
  const mockDbSet = vi.fn().mockReturnValue({ where: mockDbWhere });

  return {
    mockCreateDocumentRecord,
    mockRunIngest,
    mockUploadToS3,
    mockWaitUntil,
    mockAuth,
    mockRatelimitLimit,
    mockDbSet,
    mockDbWhere,
    resetMocks: () => {
      mockCreateDocumentRecord.mockReset();
      mockRunIngest.mockReset();
      mockUploadToS3.mockReset();
      mockWaitUntil.mockReset();
      mockAuth.mockReset();
      mockRatelimitLimit.mockReset();
      mockDbSet.mockClear();
      mockDbWhere.mockClear();
    },
  };
});

vi.mock("@/lib/ingest", () => ({
  createDocumentRecord: mockCreateDocumentRecord,
  runIngest: mockRunIngest,
}));

vi.mock("@/lib/storage", () => ({
  uploadToS3: mockUploadToS3,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: mockWaitUntil,
}));

vi.mock("@/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/ratelimit", () => ({
  uploadRatelimit: { limit: mockRatelimitLimit },
}));

vi.mock("@/db", () => ({
  db: {
    update: vi.fn().mockReturnValue({ set: mockDbSet }),
  },
}));

vi.mock("@/db/schema", () => ({
  documents: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function makeRequest(file: File): NextRequest {
  const formData = new FormData();
  formData.append("file", file);
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: formData,
  });
}

function makePdfFile(name = "test.pdf"): File {
  return new File([Buffer.from("%PDF-1.4 test")], name, { type: "application/pdf" });
}

function setupDefaults(overrides: {
  deduplicated?: boolean;
  documentId?: string;
  buffer?: Buffer;
  status?: "processing" | "ready";
  needsIngest?: boolean;
} = {}) {
  const buffer = overrides.buffer ?? Buffer.from("pdf-data");
  const documentId = overrides.documentId ?? "doc-123";
  const deduplicated = overrides.deduplicated ?? false;
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockRatelimitLimit.mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 });
  mockCreateDocumentRecord.mockResolvedValue({
    documentId,
    buffer,
    deduplicated,
    status: overrides.status ?? (deduplicated ? "ready" : "processing"),
    needsIngest: overrides.needsIngest ?? !deduplicated,
  });
  return { documentId, buffer };
}

describe("POST /api/upload", () => {
  beforeEach(() => resetMocks());

  it("calls uploadToS3 with correct key and buffer; returns documentId and status=processing", async () => {
    const { documentId, buffer } = setupDefaults();
    mockUploadToS3.mockResolvedValue(undefined);
    mockRunIngest.mockResolvedValue(undefined);

    const res = await POST(makeRequest(makePdfFile()));
    const body = await res.json();

    expect(mockUploadToS3).toHaveBeenCalledWith(buffer, `uploads/user-1/${documentId}.pdf`);
    expect(body).toMatchObject({ documentId, status: "processing" });
    expect(res.status).toBe(200);
  });

  it("returns 500 and sets document status=error when uploadToS3 throws", async () => {
    const { documentId } = setupDefaults();
    mockUploadToS3.mockRejectedValue(new Error("S3 unavailable"));

    const res = await POST(makeRequest(makePdfFile()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
    expect(mockDbSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" })
    );
    expect(mockDbWhere).toHaveBeenCalled();
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });

  it("does not call uploadToS3 for a deduplicated upload of a ready document", async () => {
    setupDefaults({ deduplicated: true });

    const res = await POST(makeRequest(makePdfFile()));
    const body = await res.json();

    expect(mockUploadToS3).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: "ready", deduplicated: true });
  });

  it("reports status=processing for a deduplicated upload of a still-processing document", async () => {
    setupDefaults({ deduplicated: true, status: "processing", needsIngest: false });

    const res = await POST(makeRequest(makePdfFile()));
    const body = await res.json();

    expect(mockUploadToS3).not.toHaveBeenCalled();
    expect(mockWaitUntil).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: "processing", deduplicated: true });
  });

  it("re-runs ingest when the duplicate previously failed", async () => {
    const { documentId, buffer } = setupDefaults({
      deduplicated: true,
      status: "processing",
      needsIngest: true,
    });
    mockUploadToS3.mockResolvedValue(undefined);
    mockRunIngest.mockResolvedValue(undefined);

    const res = await POST(makeRequest(makePdfFile()));
    const body = await res.json();

    expect(mockUploadToS3).toHaveBeenCalledWith(buffer, `uploads/user-1/${documentId}.pdf`);
    expect(mockRunIngest).toHaveBeenCalledWith(documentId, `uploads/user-1/${documentId}.pdf`);
    expect(body).toMatchObject({ status: "processing", deduplicated: true });
  });

  it("calls runIngest via waitUntil with the derived s3Key, not the raw buffer", async () => {
    const { documentId } = setupDefaults();
    mockUploadToS3.mockResolvedValue(undefined);
    const ingestPromise = Promise.resolve(undefined);
    mockRunIngest.mockReturnValue(ingestPromise);

    await POST(makeRequest(makePdfFile()));

    expect(mockRunIngest).toHaveBeenCalledWith(documentId, `uploads/user-1/${documentId}.pdf`);
    expect(mockWaitUntil).toHaveBeenCalledWith(ingestPromise);
  });
});

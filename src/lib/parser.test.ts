import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockFetch, resetMocks } = vi.hoisted(() => {
  process.env.PARSER_URL = "http://parser:8000";
  process.env.PARSER_API_SECRET = "test-secret";
  process.env.S3_BUCKET = "test-bucket";
  const mockFetch = vi.fn();
  return { mockFetch, resetMocks: () => mockFetch.mockReset() };
});

vi.stubGlobal("fetch", mockFetch);

import { callParser, ParserError, type ParseResponse } from "./parser";

const successResponse: ParseResponse = {
  document_id: "doc1",
  page_count: 2,
  pages: [
    { page_number: 1, text: "Hello", char_count: 5, has_text: true },
    { page_number: 2, text: "World", char_count: 5, has_text: true },
  ],
  metadata: {
    title: "Test Doc",
    author: null,
    subject: null,
    total_char_count: 10,
    image_only_pages: [],
  },
};

function mockSuccess(body: unknown = successResponse) {
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
}

function mockFailure(status: number, body: unknown) {
  mockFetch.mockResolvedValue({ ok: false, status, json: () => Promise.resolve(body) });
}

describe("callParser", () => {
  beforeEach(() => resetMocks());

  it("returns ParseResponse with correct shape on success", async () => {
    mockSuccess();
    const result = await callParser("doc1", "uploads/user1/doc1.pdf");
    expect(result).toEqual(successResponse);
  });

  it("throws ParserError with error and detail on non-2xx response", async () => {
    mockFailure(404, { error: "s3_key_not_found", detail: "Key not found in bucket" });

    const err = await callParser("doc1", "uploads/user1/doc1.pdf").catch((e) => e);

    expect(err).toBeInstanceOf(ParserError);
    expect(err.error).toBe("s3_key_not_found");
    expect(err.detail).toBe("Key not found in bucket");
  });

  it("propagates network errors without swallowing them", async () => {
    const networkError = new Error("fetch failed");
    mockFetch.mockImplementationOnce(() => Promise.reject(networkError));

    let caught: unknown;
    try {
      await callParser("doc1", "uploads/user1/doc1.pdf");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(networkError);
  });

  it("sends Authorization: Bearer header with PARSER_API_SECRET", async () => {
    mockSuccess();

    await callParser("doc1", "uploads/user1/doc1.pdf");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://parser:8000/parse",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
        }),
      })
    );
  });

  it("sends document_id, s3_key, and bucket in request body", async () => {
    mockSuccess();

    await callParser("doc1", "uploads/user1/doc1.pdf");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      document_id: "doc1",
      s3_key: "uploads/user1/doc1.pdf",
      bucket: "test-bucket",
    });
  });
});

describe("startup env validation", () => {
  const required = ["PARSER_URL", "PARSER_API_SECRET"];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of required) saved[name] = process.env[name];
  });

  afterEach(() => {
    for (const name of required) process.env[name] = saved[name];
  });

  it.each(required)("throws on missing %s", async (name) => {
    delete process.env[name];
    vi.resetModules();

    await expect(import("./parser")).rejects.toThrow(
      `Missing required environment variable: ${name}`
    );
  });
});

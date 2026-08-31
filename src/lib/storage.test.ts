import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockSend, resetMocks } = vi.hoisted(() => {
  process.env.S3_BUCKET = "test-bucket";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test-key-id";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
  const mockSend = vi.fn();
  return { mockSend, resetMocks: () => mockSend.mockReset() };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () {
    return { send: mockSend };
  }),
  PutObjectCommand: vi.fn(function (input: unknown) {
    return input;
  }),
  DeleteObjectCommand: vi.fn(function (input: unknown) {
    return input;
  }),
}));

import { uploadToS3, deleteFromS3 } from "./storage";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

describe("uploadToS3", () => {
  beforeEach(() => resetMocks());

  it("calls PutObjectCommand with correct Bucket, Key, Body, and ContentType", async () => {
    mockSend.mockResolvedValue({});
    const buffer = Buffer.from("pdf-data");

    await uploadToS3(buffer, "uploads/user1/doc1.pdf");

    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "uploads/user1/doc1.pdf",
      Body: buffer,
      ContentType: "application/pdf",
    });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("propagates S3 client errors", async () => {
    const err = new Error("S3 upload failed");
    mockSend.mockImplementationOnce(() => Promise.reject(err));

    await expect(uploadToS3(Buffer.from("x"), "uploads/user1/doc1.pdf")).rejects.toBe(err);
  });
});

describe("deleteFromS3", () => {
  beforeEach(() => resetMocks());

  it("calls DeleteObjectCommand with correct Bucket and Key", async () => {
    mockSend.mockResolvedValue({});

    await deleteFromS3("uploads/user1/doc1.pdf");

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "uploads/user1/doc1.pdf",
    });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("propagates S3 client errors", async () => {
    const err = new Error("S3 delete failed");
    mockSend.mockImplementationOnce(() => Promise.reject(err));

    await expect(deleteFromS3("uploads/user1/doc1.pdf")).rejects.toBe(err);
  });
});

describe("startup env validation", () => {
  const required = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "S3_BUCKET"];
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

    await expect(import("./storage")).rejects.toThrow(
      `Missing required environment variable: ${name}`
    );
  });
});

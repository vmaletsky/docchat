/**
 * POST /api/upload
 *
 * Accepts PDF file upload, triggers ingestion pipeline.
 */

import { createDocumentRecord, runIngest } from "@/lib/ingest";
import { uploadToS3 } from "@/lib/storage";
import { waitUntil } from "@vercel/functions";
import { auth } from "@/auth";
import { NextRequest } from "next/server";
import { uploadRatelimit } from "@/lib/ratelimit";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq } from "drizzle-orm";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_TYPES = ["application/pdf"];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success, limit, remaining, reset } = await uploadRatelimit.limit(session.user.id);
  if (!success) {
    return Response.json(
      { error: "Upload limit reached. You can upload up to 10 files per hour." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(remaining),
          "X-RateLimit-Reset": String(reset),
        },
      }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json(
      { error: `Unsupported file type: ${file.type}. Only PDF is supported.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
      { status: 400 }
    );
  }

  try {
    const userId = session.user.id;
    const { documentId, buffer, deduplicated, status, needsIngest } =
      await createDocumentRecord(file, userId);

    if (!needsIngest) {
      return Response.json({ documentId, status, deduplicated });
    }

    const s3Key = `uploads/${userId}/${documentId}.pdf`;

    try {
      await uploadToS3(buffer, s3Key);
    } catch (uploadError) {
      await db
        .update(documents)
        .set({
          status: "error",
          errorMessage:
            uploadError instanceof Error ? uploadError.message : "S3 upload failed",
        })
        .where(eq(documents.id, documentId));
      return Response.json({ error: "Failed to upload document" }, { status: 500 });
    }

    waitUntil(runIngest(documentId, s3Key));
    return Response.json({ documentId, status: "processing", deduplicated });
  } catch (error) {
    console.error("Upload processing error:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process document",
      },
      { status: 500 }
    );
  }
}

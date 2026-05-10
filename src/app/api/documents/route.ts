/**
 * GET  /api/documents — List all documents
 * DELETE /api/documents?id=... — Delete a document
 */

import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET() {
  const docs = await db
    .select()
    .from(documents)
    .orderBy(documents.createdAt);

  return Response.json(docs);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing document id" }, { status: 400 });
  }

  // Chunks are cascade-deleted via FK constraint
  await db.delete(documents).where(eq(documents.id, id));

  return Response.json({ deleted: true });
}

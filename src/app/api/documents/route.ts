/**
 * GET  /api/documents — List the caller's documents
 * DELETE /api/documents?id=... — Delete one of the caller's documents
 */

import { db } from "@/db";
import { documents } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.userId, session.user.id))
    .orderBy(documents.createdAt);

  return Response.json(docs);
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Missing document id" }, { status: 400 });
  }

  // Chunks cascade via FK. Filter on userId so a caller can only delete their own.
  const deleted = await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
    .returning({ id: documents.id });

  if (deleted.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ deleted: true });
}

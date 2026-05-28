/**
 * GET  /api/conversations — List the caller's conversations, newest first.
 * POST /api/conversations — Create a new conversation scoped to documents the caller owns.
 */

import { db } from "@/db";
import { conversations, documents } from "@/db/schema";
import { auth } from "@/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      documentIds: conversations.documentIds,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, session.user.id))
    .orderBy(desc(conversations.updatedAt));

  return Response.json(rows);
}

const createSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1),
  title: z.string().min(1).max(200).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Verify the caller owns every document being attached.
  const owned = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, session.user.id),
        inArray(documents.id, parsed.data.documentIds)
      )
    );

  if (owned.length !== parsed.data.documentIds.length) {
    return Response.json(
      { error: "One or more documents not found" },
      { status: 404 }
    );
  }

  const [conv] = await db
    .insert(conversations)
    .values({
      userId: session.user.id,
      documentIds: parsed.data.documentIds,
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
    })
    .returning({ id: conversations.id });

  return Response.json({ id: conv.id });
}

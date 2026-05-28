/**
 * GET /api/conversations/[id]/messages
 *
 * Return the messages of a conversation the caller owns, newest last.
 * Sources for assistant messages are reconstructed from their stored
 * chunk ids so the UI can re-render citations on resume.
 */

import { db } from "@/db";
import { conversations, messages, chunks, documents } from "@/db/schema";
import { auth } from "@/auth";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const idSchema = z.string().uuid();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return Response.json({ error: "Invalid conversation id" }, { status: 400 });
  }

  const [conv] = await db
    .select({
      id: conversations.id,
      documentIds: conversations.documentIds,
    })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));

  if (!conv) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      sourceChunkIds: messages.sourceChunkIds,
    })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt), asc(messages.id));

  // Resolve every referenced chunk once, then rebuild per-message sources.
  const allChunkIds = [...new Set(rows.flatMap((m) => m.sourceChunkIds ?? []))];
  const chunkMap = new Map<
    number,
    { documentName: string; pageNumber: number | null; content: string }
  >();
  if (allChunkIds.length > 0) {
    const chunkRows = await db
      .select({
        id: chunks.id,
        documentName: documents.name,
        pageNumber: chunks.pageNumber,
        content: chunks.content,
      })
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(inArray(chunks.id, allChunkIds));
    for (const c of chunkRows) {
      chunkMap.set(c.id, {
        documentName: c.documentName,
        pageNumber: c.pageNumber,
        content: c.content,
      });
    }
  }

  const out = rows.map((m) => {
    const base = { id: String(m.id), role: m.role, content: m.content };
    const chunkIds = m.sourceChunkIds ?? [];
    if (m.role !== "assistant" || chunkIds.length === 0) return base;

    // Keep the original ordinal as the citation index even when a chunk
    // (e.g. from a since-deleted document) can no longer be resolved.
    const sources = chunkIds
      .map((cid, i) => {
        const c = chunkMap.get(cid);
        if (!c) return null;
        return {
          index: i + 1,
          id: cid,
          documentName: c.documentName,
          pageNumber: c.pageNumber,
          preview: c.content.slice(0, 240),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return sources.length > 0 ? { ...base, sources } : base;
  });

  // Surviving documents this conversation is about, for display on resume.
  const docRows = conv.documentIds.length
    ? await db
        .select({ id: documents.id, name: documents.name })
        .from(documents)
        .where(
          and(
            eq(documents.userId, userId),
            inArray(documents.id, conv.documentIds)
          )
        )
    : [];

  return Response.json({
    documentIds: conv.documentIds,
    documents: docRows,
    messages: out,
  });
}

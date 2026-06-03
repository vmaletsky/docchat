/**
 * POST /api/chat
 *
 * Streaming chat endpoint using Vercel AI SDK + OpenAI.
 * Retrieves relevant chunks, builds context, streams response.
 */

import { openai } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import { retrieveChunks } from "@/lib/retrieval";
import { db } from "@/db";
import { messages, conversations, documents } from "@/db/schema";
import { auth } from "@/auth";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { chatRatelimit } from "@/lib/ratelimit";

const requestSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(10000),
  documentIds: z.array(z.string().uuid()).min(1),
});

// Matches the schema default; we only auto-title conversations still using it.
const DEFAULT_CONVERSATION_TITLE = "New conversation";

async function summarizeAsTitle(message: string): Promise<string | null> {
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    system:
      "Summarize the user's message as a short conversation title of at most 6 words. " +
      "Use title case. Do not wrap it in quotes or add trailing punctuation.",
    prompt: message,
  });
  const title = text.trim().replace(/^["']+|["']+$/g, "").trim().slice(0, 80);
  return title.length > 0 ? title : null;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { success, limit, remaining, reset } = await chatRatelimit.limit(userId);
  if (!success) {
    return Response.json(
      { error: "Too many requests. Please wait before sending another message." },
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

  const body = await req.json();
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { conversationId, message, documentIds } = parsed.data;

  // Verify the conversation and every document belong to this user.
  const [ownedConv, ownedDocs] = await Promise.all([
    db
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(
        and(eq(conversations.id, conversationId), eq(conversations.userId, userId))
      ),
    db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.userId, userId), inArray(documents.id, documentIds))),
  ]);

  if (ownedConv.length === 0 || ownedDocs.length !== documentIds.length) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // 1. Retrieve relevant chunks via hybrid search
  const relevantChunks = await retrieveChunks(message, {
    documentIds,
    topK: 8,
    vectorWeight: 0.7,
  });

  // 2. Build context string from retrieved chunks
  const context = relevantChunks
    .map(
      (chunk, i) =>
        `[Source ${i + 1} — "${chunk.documentName}", p.${chunk.pageNumber ?? "?"}]\n${chunk.content}`,
    )
    .join("\n\n---\n\n");

  // 3. Fetch conversation history (last 10 messages for context)
  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(10);

  // 4. Save user message
  await db.insert(messages).values({
    conversationId,
    role: "user",
    content: message,
  });

  // For a brand-new conversation, derive a title from this first message.
  // Done before streaming so the title is persisted by the time the client
  // refreshes its conversation list. Failures here are non-fatal.
  if (history.length === 0 && ownedConv[0].title === DEFAULT_CONVERSATION_TITLE) {
    try {
      const title = await summarizeAsTitle(message);
      if (title) {
        await db
          .update(conversations)
          .set({ title })
          .where(eq(conversations.id, conversationId));
      }
    } catch {
      // Keep the default title if summarization fails.
    }
  }

  // 5. Build messages array for the LLM
  const systemPrompt = `You are DocChat, a helpful assistant that answers questions based on uploaded documents.

RULES:
- Answer ONLY based on the provided document context. If the context doesn't contain the answer, say so clearly.
- Cite your sources using [Source N] notation matching the source labels in the context.
- Be concise and direct. Don't repeat the question back.
- If multiple sources agree, synthesize them. If they conflict, note the discrepancy.
- Never fabricate information not present in the sources.

DOCUMENT CONTEXT:
${context || "No relevant context found for this query."}`;

  const llmMessages = [
    ...history.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
    { role: "user" as const, content: message },
  ];

  // 6. Stream response
  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: systemPrompt,
    messages: llmMessages,
    onFinish: async ({ text }) => {
      // Save assistant message after streaming completes
      await db.insert(messages).values({
        conversationId,
        role: "assistant",
        content: text,
        sourceChunkIds: relevantChunks.map((c) => c.id),
      });

      // Update conversation timestamp
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    },
  });

  const sourcesForClient = relevantChunks.map((chunk, i) => ({
    index: i + 1,
    id: chunk.id,
    documentName: chunk.documentName,
    pageNumber: chunk.pageNumber,
    preview: chunk.content.slice(0, 240),
  }));

  return result.toTextStreamResponse({
    headers: {
      "X-Sources": encodeURIComponent(JSON.stringify(sourcesForClient)),
    },
  });
}

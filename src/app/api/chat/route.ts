/**
 * POST /api/chat
 *
 * Streaming chat endpoint using Vercel AI SDK + OpenAI.
 * Retrieves relevant chunks, builds context, streams response.
 */

import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { retrieveChunks } from "@/lib/retrieval";
import { db } from "@/db";
import { messages, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const requestSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(10000),
  documentIds: z.array(z.string().uuid()).min(1),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { conversationId, message, documentIds } = parsed.data;

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
        `[Source ${i + 1} — "${chunk.documentName}", p.${chunk.pageNumber ?? "?"}]\n${chunk.content}`
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
    model: openai("gpt-4o"),
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

  return result.toDataStreamResponse();
}

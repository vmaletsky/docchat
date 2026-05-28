"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Loader2 } from "lucide-react";

export interface ConversationItem {
  id: string;
  title: string;
  documentIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationsListProps {
  refreshKey?: number;
  activeId?: string | null;
  onSelect?: (conversation: ConversationItem) => void;
}

export function ConversationsList({
  refreshKey = 0,
  activeId,
  onSelect,
}: ConversationsListProps) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error(`Failed to load conversations (${res.status})`);
      setConversations(await res.json());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load conversations"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <section className="flex flex-col">
      <h2 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Conversations
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <p className="px-4 py-2 text-sm text-red-600">{error}</p>
      ) : conversations.length === 0 ? (
        <p className="px-4 py-2 text-sm text-gray-400">No conversations yet.</p>
      ) : (
        <ul className="flex flex-col">
          {conversations.map((conv) => {
            const Tag = onSelect ? "button" : "div";
            return (
              <li key={conv.id}>
                <Tag
                  {...(onSelect
                    ? { type: "button" as const, onClick: () => onSelect(conv) }
                    : {})}
                  className={`flex w-full items-start gap-2 px-4 py-2 text-left text-sm ${
                    conv.id === activeId ? "bg-blue-50" : "hover:bg-gray-50"
                  } ${onSelect ? "cursor-pointer" : ""}`}
                >
                  <MessageSquare size={16} className="mt-0.5 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-gray-800" title={conv.title}>
                      {conv.title}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatDate(conv.updatedAt)}
                    </p>
                  </div>
                </Tag>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

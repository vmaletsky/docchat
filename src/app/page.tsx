"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { DropArea } from "@/components/ui/DropArea";
import {
  DocumentsTree,
  type DocumentItem,
  type ConversationItem,
} from "@/components/documents/DocumentsTree";

type UploadState = "idle" | "uploading" | "ready" | "error";

interface Source {
  index: number;
  id: number;
  documentName: string;
  pageNumber: number | null;
  preview: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeDocName, setActiveDocName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function resetSession() {
    setDocumentId(null);
    setConversationId(null);
    setActiveDocName(null);
    setErrorMessage(null);
    setMessages([]);
  }

  async function handleFileSelected(selected: File) {
    setFile(selected);
    setUploadState("uploading");
    resetSession();

    try {
      const formData = new FormData();
      formData.append("file", selected);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Upload failed (${res.status})`);
      }
      setDocumentId(data.documentId);
      setUploadState("ready");
      setSidebarRefreshKey((k) => k + 1);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
      setUploadState("error");
    }
  }

  function handleClear() {
    setFile(null);
    setUploadState("idle");
    resetSession();
  }

  async function ensureConversation(docId: string): Promise<string> {
    if (conversationId) return conversationId;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: [docId] }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error ?? "Could not create conversation");
    }
    setConversationId(data.id);
    setSidebarRefreshKey((k) => k + 1);
    return data.id as string;
  }

  function handleDocumentDeleted(id: string) {
    if (id === documentId) handleClear();
  }

  function handleNewChat(doc: DocumentItem) {
    if (isStreaming) return;
    setFile(null);
    setDocumentId(doc.id);
    setActiveDocName(doc.name);
    setConversationId(null);
    setMessages([]);
    setErrorMessage(null);
    setUploadState("ready");
  }

  async function handleConversationSelected(conv: ConversationItem) {
    if (isStreaming || conv.id === conversationId) return;
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/conversations/${conv.id}/messages`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Could not open conversation (${res.status})`);
      }
      const docId: string | null = data.documentIds?.[0] ?? null;
      setFile(null);
      setConversationId(conv.id);
      setDocumentId(docId);
      setActiveDocName(data.documents?.[0]?.name ?? null);
      setMessages(data.messages as ChatMessage[]);
      if (docId) {
        setUploadState("ready");
      } else {
        setUploadState("error");
        setErrorMessage("This conversation's document is no longer available.");
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not open conversation"
      );
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || uploadState !== "ready" || !documentId || isStreaming) return;

    setMessage("");
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    try {
      const convId = await ensureConversation(documentId);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          message: text,
          documentIds: [documentId],
        }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `Chat failed (${res.status})`);
      }

      const sourcesHeader = res.headers.get("X-Sources");
      if (sourcesHeader) {
        try {
          const sources: Source[] = JSON.parse(decodeURIComponent(sourcesHeader));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, sources } : m
            )
          );
        } catch {
          // Bad header; skip sources but keep streaming.
        }
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m
          )
        );
      }
      // The first message may have auto-titled the conversation; refresh the
      // sidebar so the new title (and updated ordering) shows.
      setSidebarRefreshKey((k) => k + 1);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "Chat failed";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: `⚠ ${errText}` } : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }

  const canSend =
    message.trim().length > 0 &&
    uploadState === "ready" &&
    documentId !== null &&
    !isStreaming;

  return (
    <div className="flex">
      <aside className="hidden md:block w-72 shrink-0 border-r bg-white">
        <DocumentsTree
          refreshKey={sidebarRefreshKey}
          activeDocId={documentId}
          activeConvId={conversationId}
          onNewChat={handleNewChat}
          onConversationSelect={handleConversationSelected}
          onDocumentDeleted={handleDocumentDeleted}
        />
      </aside>
      <main className="flex flex-col flex-1 min-w-0 min-h-screen p-4">
        <div className="w-full max-w-2xl mx-auto flex flex-col gap-4 flex-1">
          <h1 className="text-2xl font-bold text-center">DocChat</h1>

        <DropArea
          file={file}
          fileName={activeDocName}
          onFileSelected={handleFileSelected}
          onClear={handleClear}
          disabled={uploadState === "uploading" || isStreaming}
        />

        <UploadStatus state={uploadState} errorMessage={errorMessage} />

        {messages.length > 0 && (
          <div className="flex flex-col gap-3 py-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        <form
          onSubmit={handleSend}
          className="flex gap-2 mt-auto sticky bottom-0 bg-white py-2"
        >
          <TextInput
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              uploadState === "ready"
                ? "Ask a question about your document..."
                : "Upload a document first..."
            }
            disabled={uploadState !== "ready" || isStreaming}
            className="flex-1"
          />
          <Button type="submit" disabled={!canSend} aria-label="Send">
            {isStreaming ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Send size={20} />
            )}
          </Button>
        </form>
        </div>
      </main>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser ? "bg-blue-600 text-white whitespace-pre-wrap" : "bg-gray-100 text-gray-900"
        }`}
      >
        {isUser ? (
          message.content
        ) : message.content ? (
          <div className="prose prose-sm max-w-none prose-p:my-2 prose-pre:my-2 prose-headings:my-2">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        ) : (
          <Loader2 size={16} className="animate-spin text-gray-400" />
        )}
      </div>
      {!isUser && message.sources && message.sources.length > 0 && (
        <SourcesStrip sources={message.sources} />
      )}
    </div>
  );
}

function SourcesStrip({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 max-w-[80%]">
      {sources.map((s) => (
        <span
          key={s.id}
          title={s.preview}
          className="text-xs px-2 py-0.5 bg-white border border-gray-200 rounded text-gray-600 cursor-help"
        >
          [{s.index}] {s.documentName}
          {s.pageNumber !== null ? ` · p.${s.pageNumber}` : ""}
        </span>
      ))}
    </div>
  );
}

function UploadStatus({
  state,
  errorMessage,
}: {
  state: UploadState;
  errorMessage: string | null;
}) {
  if (state === "idle") return null;

  if (state === "uploading") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Loader2 size={16} className="animate-spin" />
        <span>Processing document…</span>
      </div>
    );
  }

  if (state === "ready") {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700">
        <CheckCircle2 size={16} />
        <span>Document ready. Ask a question below.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-red-700">
      <AlertCircle size={16} />
      <span>{errorMessage ?? "Upload failed"}</span>
    </div>
  );
}

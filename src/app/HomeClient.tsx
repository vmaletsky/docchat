"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import {
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Menu,
  FileText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
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

const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;

export default function HomeClient() {
  const [message, setMessage] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [duplicateNotice, setDuplicateNotice] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!duplicateNotice) return;
    const t = setTimeout(() => setDuplicateNotice(false), 4000);
    return () => clearTimeout(t);
  }, [duplicateNotice]);

  function resetSession() {
    setDocumentId(null);
    setConversationId(null);
    setErrorMessage(null);
    setMessages([]);
  }

  function confirmSwitch(): boolean {
    if (!isStreaming) return true;
    return window.confirm(
      "A response is still loading. Switch document and discard it?",
    );
  }

  async function handleFileSelected(selected: File) {
    if (selected.size > MAX_UPLOAD_SIZE) {
      setErrorMessage("File too large. Maximum size is 20 MB.");
      setUploadState("error");
      return;
    }

    setUploadState("uploading");
    setMobileDrawerOpen(false);
    resetSession();

    try {
      const formData = new FormData();
      formData.append("file", selected);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        let msg = `Upload failed (${res.status})`;
        try {
          const data = await res.json();
          msg = data?.error ?? msg;
        } catch {
          // non-JSON response (e.g. 413 from proxy)
        }
        throw new Error(msg);
      }
      const data = await res.json();
      setDocumentId(data.documentId);
      setUploadState("ready");
      setSidebarRefreshKey((k) => k + 1);
      if (data.deduplicated) {
        setDuplicateNotice(true);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
      setUploadState("error");
    }
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
    if (id === documentId) {
      resetSession();
      setUploadState("idle");
    }
  }

  function handleNewChat(doc: DocumentItem) {
    if (!confirmSwitch()) return;
    setDocumentId(doc.id);
    setConversationId(null);
    setMessages([]);
    setErrorMessage(null);
    setUploadState("ready");
    setMobileDrawerOpen(false);
  }

  async function handleConversationSelected(conv: ConversationItem) {
    if (conv.id === conversationId) return;
    if (!confirmSwitch()) return;
    setErrorMessage(null);
    setMobileDrawerOpen(false);
    try {
      const res = await fetch(`/api/conversations/${conv.id}/messages`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ?? `Could not open conversation (${res.status})`,
        );
      }
      const docId: string | null = data.documentIds?.[0] ?? null;
      setConversationId(conv.id);
      setDocumentId(docId);
      setMessages(data.messages as ChatMessage[]);
      if (docId) {
        setUploadState("ready");
      } else {
        setUploadState("error");
        setErrorMessage("This conversation's document is no longer available.");
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not open conversation",
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
          const sources: Source[] = JSON.parse(
            decodeURIComponent(sourcesHeader),
          );
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, sources } : m)),
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
            m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m,
          ),
        );
      }
      setSidebarRefreshKey((k) => k + 1);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "Chat failed";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: `⚠ ${errText}` } : m,
        ),
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

  const sidebarProps = {
    refreshKey: sidebarRefreshKey,
    activeDocId: documentId,
    activeConvId: conversationId,
    onNewChat: handleNewChat,
    onConversationSelect: handleConversationSelected,
    onDocumentDeleted: handleDocumentDeleted,
    onFileSelected: handleFileSelected,
    isUploading: uploadState === "uploading",
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Mobile drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white border-r z-50 flex flex-col">
            <DocumentsTree
              {...sidebarProps}
              onClose={() => setMobileDrawerOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-72 shrink-0 border-r bg-white flex-col">
        <DocumentsTree {...sidebarProps} />
      </aside>

      <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b md:hidden shrink-0">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Open sidebar"
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <Menu size={20} />
          </button>
          <span className="font-semibold">DocChat</span>
        </div>

        <div className="flex flex-col flex-1 min-h-0 p-4">
          <div className="w-full max-w-2xl mx-auto flex flex-col flex-1 min-h-0">
            {/* Status banners */}
            {uploadState === "uploading" && (
              <div className="flex items-center gap-2 text-sm text-gray-600 shrink-0 pb-2">
                <Loader2 size={16} className="animate-spin" />
                <span>Processing document…</span>
              </div>
            )}

            {uploadState === "error" && errorMessage && (
              <div className="flex items-center gap-2 text-sm text-red-700 shrink-0 pb-2">
                <AlertCircle size={16} />
                <span>{errorMessage}</span>
              </div>
            )}

            {duplicateNotice && (
              <div className="flex items-center gap-2 text-sm text-blue-700 shrink-0 pb-2">
                <CheckCircle2 size={16} />
                <span>This document is already in your library.</span>
              </div>
            )}

            {/* Scrollable area: empty state or messages */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {!documentId && uploadState !== "uploading" && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                  <FileText size={40} strokeWidth={1.5} />
                  <p className="text-sm text-center">
                    Upload a PDF from the sidebar to start chatting
                  </p>
                </div>
              )}

              {messages.length > 0 && (
                <div className="flex flex-col gap-3 py-4">
                  {messages.map((m) => (
                    <MessageBubble key={m.id} message={m} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Message input — always pinned at bottom, no sticky needed */}
            <form
              onSubmit={handleSend}
              className="flex gap-2 shrink-0 border-t pt-3 bg-white"
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
          isUser
            ? "bg-blue-600 text-white whitespace-pre-wrap"
            : "bg-gray-100 text-gray-900"
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
  const [openId, setOpenId] = useState<number | null>(null);
  const openSource = sources.find((s) => s.id === openId) ?? null;

  return (
    <div className="mt-2 max-w-[80%]">
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => {
          const isOpen = s.id === openId;
          return (
            <button
              key={s.id}
              id={`src-chip-${s.id}`}
              aria-expanded={isOpen}
              aria-controls={`src-card-${s.id}`}
              onClick={() => setOpenId(isOpen ? null : s.id)}
              className={`text-xs px-2 py-0.5 border rounded transition-colors ${
                isOpen
                  ? "bg-gray-800 border-gray-800 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-400"
              }`}
            >
              [{s.index}] {s.documentName}
              {s.pageNumber !== null ? ` · p.${s.pageNumber}` : ""}
            </button>
          );
        })}
      </div>
      {openSource && (
        <div
          id={`src-card-${openSource.id}`}
          role="region"
          aria-labelledby={`src-chip-${openSource.id}`}
          className="mt-1.5 p-3 bg-white border border-gray-200 rounded text-xs text-gray-700 border-t-2 border-t-gray-800"
        >
          <div className="font-medium text-gray-900 mb-0.5">
            {openSource.documentName}
            {openSource.pageNumber !== null ? ` · p.${openSource.pageNumber}` : ""}
          </div>
          <p className="leading-relaxed whitespace-pre-wrap">{openSource.preview}</p>
        </div>
      )}
    </div>
  );
}

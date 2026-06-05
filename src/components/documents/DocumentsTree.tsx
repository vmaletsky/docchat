"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Plus,
  Upload,
  X,
} from "lucide-react";

export interface DocumentItem {
  id: string;
  name: string;
  status: "processing" | "ready" | "error";
  createdAt: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  documentIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface DocumentsTreeProps {
  refreshKey?: number;
  activeDocId?: string | null;
  activeConvId?: string | null;
  onNewChat?: (doc: DocumentItem) => void;
  onConversationSelect?: (conv: ConversationItem) => void;
  onDocumentDeleted?: (docId: string) => void;
  onFileSelected?: (file: File) => void;
  isUploading?: boolean;
  onClose?: () => void;
}

export function DocumentsTree({
  refreshKey = 0,
  activeDocId,
  activeConvId,
  onNewChat,
  onConversationSelect,
  onDocumentDeleted,
  onFileSelected,
  isUploading = false,
  onClose,
}: DocumentsTreeProps) {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dragDepth, setDragDepth] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docsRes, convsRes] = await Promise.all([
        fetch("/api/documents"),
        fetch("/api/conversations"),
      ]);
      if (!docsRes.ok)
        throw new Error(`Failed to load documents (${docsRes.status})`);
      if (!convsRes.ok)
        throw new Error(`Failed to load conversations (${convsRes.status})`);
      setDocs(await docsRes.json());
      setConversations(await convsRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Auto-expand the doc that owns the active conversation or is the active doc
  useEffect(() => {
    if (activeConvId) {
      const conv = conversations.find((c) => c.id === activeConvId);
      const docId = conv?.documentIds[0];
      if (docId) setExpandedIds((prev) => new Set([...prev, docId]));
    } else if (activeDocId) {
      setExpandedIds((prev) => new Set([...prev, activeDocId]));
    }
  }, [activeConvId, activeDocId, conversations]);

  function toggleExpand(docId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setDeletingId(id);
    try {
      const res = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDocs((prev) => prev.filter((d) => d.id !== id));
      onDocumentDeleted?.(id);
    } catch {
      setError("Could not delete document");
    } finally {
      setDeletingId(null);
    }
  }

  function handleUploadClick() {
    inputRef.current?.click();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onFileSelected?.(f);
    e.target.value = "";
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    setDragDepth((d) => d + 1);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragDepth(0);
    const f = e.dataTransfer.files?.[0];
    if (f) onFileSelected?.(f);
  }

  const convsByDocId = conversations.reduce<Record<string, ConversationItem[]>>(
    (acc, conv) => {
      const docId = conv.documentIds[0];
      if (docId) {
        (acc[docId] ??= []).push(conv);
      }
      return acc;
    },
    {}
  );

  const isDragOver = dragDepth > 0;

  return (
    <section
      className={`flex flex-col flex-1 relative transition-colors ${isDragOver ? "bg-blue-50" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        onChange={handleInputChange}
      />

      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-blue-600">
            <Upload size={28} />
            <span className="text-sm font-medium">Drop PDF to upload</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Documents
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={isUploading}
            aria-label="Upload document"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Upload size={12} />
            )}
            Upload
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sidebar"
              className="rounded p-1 text-gray-400 hover:bg-gray-100"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <p className="px-4 py-2 text-sm text-red-600">{error}</p>
      ) : docs.length === 0 ? (
        <p className="px-4 py-2 text-sm text-gray-400">No documents yet.</p>
      ) : (
        <ul className="flex flex-col">
          {docs.map((doc) => {
            const convs = (convsByDocId[doc.id] ?? []).sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
            const isExpanded = expandedIds.has(doc.id);
            const isActiveDoc = doc.id === activeDocId && !activeConvId;

            return (
              <li key={doc.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpand(doc.id)}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") && toggleExpand(doc.id)
                  }
                  className={`group flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm ${
                    isActiveDoc ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}
                >
                  <span className="shrink-0 text-gray-400">
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                  <StatusIcon status={doc.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-gray-800" title={doc.name}>
                      {doc.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, doc.id)}
                    disabled={deletingId === doc.id}
                    aria-label={`Delete ${doc.name}`}
                    className="shrink-0 rounded p-1 text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {deletingId === doc.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <ul className="flex flex-col">
                    {convs.map((conv) => (
                      <li key={conv.id}>
                        <button
                          type="button"
                          onClick={() => onConversationSelect?.(conv)}
                          className={`flex w-full items-start gap-2 py-1.5 pl-9 pr-4 text-left text-sm ${
                            conv.id === activeConvId
                              ? "bg-blue-50 text-blue-700"
                              : "text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          <MessageSquare
                            size={14}
                            className="mt-0.5 shrink-0 text-gray-400"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate" title={conv.title}>
                              {conv.title}
                            </p>
                            <p className="text-xs text-gray-400">
                              {formatDate(conv.updatedAt)}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                    {doc.status === "ready" && (
                      <li>
                        <button
                          type="button"
                          onClick={() => onNewChat?.(doc)}
                          className="flex w-full items-center gap-2 py-1.5 pl-9 pr-4 text-sm text-gray-400 hover:bg-gray-50 hover:text-blue-600"
                        >
                          <Plus size={14} className="shrink-0" />
                          New chat
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </section>
  );
}

function StatusIcon({ status }: { status: DocumentItem["status"] }) {
  if (status === "ready")
    return <CheckCircle2 size={16} className="shrink-0 text-green-600" />;
  if (status === "error")
    return <AlertCircle size={16} className="shrink-0 text-red-600" />;
  if (status === "processing")
    return <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" />;
  return <FileText size={16} className="shrink-0 text-gray-400" />;
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

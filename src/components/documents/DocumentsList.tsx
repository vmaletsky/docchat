"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export interface DocumentItem {
  id: string;
  name: string;
  status: "processing" | "ready" | "error";
  createdAt: string;
}

interface DocumentsListProps {
  refreshKey?: number;
  activeId?: string | null;
  onDeleted?: (id: string) => void;
}

export function DocumentsList({
  refreshKey = 0,
  activeId,
  onDeleted,
}: DocumentsListProps) {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      setDocs(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setDeletingId(id);
    try {
      const res = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDocs((prev) => prev.filter((d) => d.id !== id));
      onDeleted?.(id);
    } catch {
      setError("Could not delete document");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="flex flex-col">
      <h2 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Documents
      </h2>

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
          {docs.map((doc) => (
            <li
              key={doc.id}
              className={`group flex items-center gap-2 px-4 py-2 text-sm ${
                doc.id === activeId ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
            >
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusIcon({ status }: { status: DocumentItem["status"] }) {
  if (status === "ready") {
    return <CheckCircle2 size={16} className="shrink-0 text-green-600" />;
  }
  if (status === "error") {
    return <AlertCircle size={16} className="shrink-0 text-red-600" />;
  }
  if (status === "processing") {
    return <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" />;
  }
  return <FileText size={16} className="shrink-0 text-gray-400" />;
}

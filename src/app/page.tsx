"use client";

import { useState, FormEvent } from "react";
import { Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { DropArea } from "@/components/ui/DropArea";

type UploadState = "idle" | "uploading" | "ready" | "error";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleFileSelected(selected: File) {
    setFile(selected);
    setUploadState("uploading");
    setErrorMessage(null);
    setDocumentId(null);

    try {
      const formData = new FormData();
      formData.append("file", selected);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Upload failed (${res.status})`);
      }
      setDocumentId(data.documentId);
      setUploadState("ready");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
      setUploadState("error");
    }
  }

  function handleClear() {
    setFile(null);
    setDocumentId(null);
    setErrorMessage(null);
    setUploadState("idle");
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() || uploadState !== "ready" || !documentId) return;
    // TODO: wire up to /api/chat using documentId
    console.log("Send:", message, documentId);
    setMessage("");
  }

  const canSend =
    message.trim().length > 0 && uploadState === "ready" && documentId !== null;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-center">DocChat</h1>

        <DropArea
          file={file}
          onFileSelected={handleFileSelected}
          onClear={handleClear}
          disabled={uploadState === "uploading"}
        />

        <UploadStatus state={uploadState} errorMessage={errorMessage} />

        <form onSubmit={handleSend} className="flex gap-2">
          <TextInput
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              uploadState === "ready"
                ? "Ask a question about your document..."
                : "Upload a document first..."
            }
            disabled={uploadState !== "ready"}
            className="flex-1"
          />
          <Button type="submit" disabled={!canSend} aria-label="Send">
            <Send size={20} />
          </Button>
        </form>
      </div>
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

"use client";

import { DragEvent, ReactNode, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";

interface DropAreaProps {
  file: File | null;
  onFileSelected: (file: File) => void;
  onClear: () => void;
  accept?: string;
  acceptMimeTypes?: string[];
  maxSize?: number;
  disabled?: boolean;
  prompt?: ReactNode;
  className?: string;
}

export function DropArea({
  file,
  onFileSelected,
  onClear,
  accept = ".pdf",
  acceptMimeTypes = ["application/pdf"],
  maxSize,
  disabled = false,
  prompt = "Drop a PDF here or click to browse",
  className = "",
}: DropAreaProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function accepts(candidate: File): boolean {
    if (acceptMimeTypes.length > 0 && !acceptMimeTypes.includes(candidate.type)) {
      return false;
    }
    if (maxSize !== undefined && candidate.size > maxSize) {
      return false;
    }
    return true;
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files[0];
    if (dropped && accepts(dropped)) {
      onFileSelected(dropped);
    }
  }

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected && accepts(selected)) {
      onFileSelected(selected);
    }
    // Reset so selecting the same file again still fires onChange
    e.target.value = "";
  }

  const stateClass = disabled
    ? "border-gray-200 bg-gray-50 cursor-not-allowed"
    : dragOver
      ? "border-blue-500 bg-blue-50"
      : file
        ? "border-green-400 bg-green-50"
        : "border-gray-300 hover:border-gray-400 cursor-pointer";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => {
        if (!disabled && !file) inputRef.current?.click();
      }}
      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${stateClass} ${className}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={handleSelect}
        className="hidden"
      />
      {file ? (
        <div className="flex items-center justify-center gap-2 text-green-700">
          <FileText size={20} />
          <span className="truncate max-w-xs">{file.name}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            aria-label="Remove file"
            className="ml-2 p-1 rounded hover:bg-green-200"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-gray-500">
          <Upload size={24} />
          <span>{prompt}</span>
        </div>
      )}
    </div>
  );
}

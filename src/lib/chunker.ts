/**
 * Recursive text splitter with overlap.
 *
 * Splits on paragraph breaks first, then sentences, then by character limit.
 * Each chunk overlaps with the previous to preserve context at boundaries.
 *
 * No LangChain dependency — this is ~60 lines and you understand every one.
 */

interface ChunkOptions {
  maxChunkSize: number; // Target size per chunk in characters
  overlapSize: number; // Characters of overlap between consecutive chunks
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChunkSize: 1000,
  overlapSize: 200,
};

const SEPARATORS = [
  "\n\n", // Paragraph breaks (strongest boundary)
  "\n", // Line breaks
  ". ", // Sentence endings
  "? ",
  "! ",
  "; ",
  ", ", // Clause breaks (weakest boundary)
];

/**
 * Split text recursively using a hierarchy of separators.
 * Tries the strongest separator first; if chunks are still too large,
 * recurses with weaker separators.
 */
function splitRecursive(
  text: string,
  separatorIndex: number,
  maxSize: number
): string[] {
  if (text.length <= maxSize) {
    return [text];
  }

  // If we've exhausted all separators, hard-split by character limit
  if (separatorIndex >= SEPARATORS.length) {
    const result: string[] = [];
    for (let i = 0; i < text.length; i += maxSize) {
      result.push(text.slice(i, i + maxSize));
    }
    return result;
  }

  const separator = SEPARATORS[separatorIndex];
  const parts = text.split(separator);

  // If the separator didn't split anything, try the next one
  if (parts.length === 1) {
    return splitRecursive(text, separatorIndex + 1, maxSize);
  }

  // Merge small parts back together up to maxSize
  const merged: string[] = [];
  let current = "";

  for (const part of parts) {
    const candidate = current ? current + separator + part : part;

    if (candidate.length <= maxSize) {
      current = candidate;
    } else {
      if (current) merged.push(current);

      // If this single part exceeds maxSize, recurse with next separator
      if (part.length > maxSize) {
        merged.push(...splitRecursive(part, separatorIndex + 1, maxSize));
        current = "";
      } else {
        current = part;
      }
    }
  }
  if (current) merged.push(current);

  return merged;
}

/**
 * Main entry point: split text into overlapping chunks.
 * Returns array of { content, chunkIndex }.
 */
export function chunkText(
  text: string,
  options: Partial<ChunkOptions> = {}
): Array<{ content: string; chunkIndex: number }> {
  const { maxChunkSize, overlapSize } = { ...DEFAULT_OPTIONS, ...options };

  // Clean up the text
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (!cleaned) return [];

  // Split without overlap first
  const rawChunks = splitRecursive(cleaned, 0, maxChunkSize);

  // Add overlap: prepend tail of previous chunk to current chunk
  const result: Array<{ content: string; chunkIndex: number }> = [];

  for (let i = 0; i < rawChunks.length; i++) {
    let content = rawChunks[i].trim();

    if (i > 0 && overlapSize > 0) {
      const prevChunk = rawChunks[i - 1];
      const overlapText = prevChunk.slice(-overlapSize).trim();
      // Only prepend if it doesn't duplicate the start
      if (!content.startsWith(overlapText.slice(0, 50))) {
        content = overlapText + "\n" + content;
      }
    }

    if (content.length > 0) {
      result.push({ content, chunkIndex: i });
    }
  }

  return result;
}

/**
 * Estimate page number based on character position.
 * Rough heuristic: ~3000 chars per page for typical documents.
 */
export function estimatePageNumber(
  charOffset: number,
  charsPerPage = 3000
): number {
  return Math.floor(charOffset / charsPerPage) + 1;
}

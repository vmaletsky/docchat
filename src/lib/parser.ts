function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const parserUrl = requireEnv("PARSER_URL");
const parserApiSecret = requireEnv("PARSER_API_SECRET");

export type PageResult = {
  page_number: number;
  text: string;
  char_count: number;
  has_text: boolean;
};

export type ParseMetadata = {
  title: string | null;
  author: string | null;
  subject: string | null;
  total_char_count: number;
  image_only_pages: number[];
};

export type ParseResponse = {
  document_id: string;
  page_count: number;
  pages: PageResult[];
  metadata: ParseMetadata;
};

export type ErrorCode =
  | "no_extractable_text"
  | "invalid_pdf"
  | "s3_key_not_found"
  | "file_too_large"
  | "extraction_failed";

export class ParserError extends Error {
  constructor(
    public readonly error: ErrorCode,
    public readonly detail: string
  ) {
    super(detail);
    this.name = "ParserError";
  }
}

export async function callParser(
  documentId: string,
  s3Key: string
): Promise<ParseResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${parserUrl}/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${parserApiSecret}`,
      },
      body: JSON.stringify({
        document_id: documentId,
        s3_key: s3Key,
        bucket: process.env.S3_BUCKET,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json();
      throw new ParserError(body.error, body.detail);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

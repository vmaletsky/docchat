-- Run this ONCE on your Neon database before running drizzle migrations.
-- Neon supports pgvector out of the box, you just need to enable the extension.

CREATE EXTENSION IF NOT EXISTS vector;

-- Verify it works:
-- SELECT '[1,2,3]'::vector;

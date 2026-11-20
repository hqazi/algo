-- v3 Library (SPEC §4.2, §15.1): the index of articles found in the folders
-- the user chose. Rebuilt by scanning; the folders themselves are never
-- written. `folder_id` is a `library.folders[].id` from settings.json.
CREATE TABLE articles (
  id            TEXT PRIMARY KEY,
  folder_id     TEXT NOT NULL,
  rel_path      TEXT NOT NULL,
  title         TEXT NOT NULL,
  source_url    TEXT,
  frontmatter   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(frontmatter)),
  content_hash  TEXT NOT NULL,
  missing_since TEXT,
  scanned_at    TEXT NOT NULL,
  UNIQUE (folder_id, rel_path)
) STRICT;

CREATE INDEX articles_by_hash ON articles (folder_id, content_hash);

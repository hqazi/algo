-- v3 chats on passages (SPEC §4.2, §15.5): threads gain a kind, and article
-- threads (`article:<uuid>`) their article, passage and title. Existing
-- threads are `home` (also archived `home~<n>`) or about a problem.
ALTER TABLE threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'problem'
  CHECK (kind IN ('home', 'problem', 'article'));
ALTER TABLE threads ADD COLUMN article_id TEXT;
ALTER TABLE threads ADD COLUMN anchor TEXT CHECK (anchor IS NULL OR json_valid(anchor));
ALTER TABLE threads ADD COLUMN title TEXT;

UPDATE threads SET kind = 'home' WHERE id = 'home' OR id LIKE 'home~%';

CREATE INDEX threads_by_article ON threads (article_id) WHERE article_id IS NOT NULL;

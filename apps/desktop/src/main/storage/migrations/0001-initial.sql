-- Schema version 1 (SPEC §4.2). Timestamps are ISO 8601 text; JSON columns
-- hold text written by core's stringifyJson (exact 64-bit integers).

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  goal            TEXT NOT NULL,
  interview_date  TEXT,
  experience      TEXT NOT NULL,
  comfort         TEXT NOT NULL,              -- JSON object: topic group -> comfort
  hint_preference TEXT NOT NULL,
  focus_topic     TEXT,
  language        TEXT NOT NULL,
  onboarded       INTEGER NOT NULL CHECK (onboarded IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;

CREATE TABLE topic_progress (
  topic          TEXT PRIMARY KEY,
  level          TEXT NOT NULL CHECK (level IN ('new', 'learning', 'comfortable')),
  unaided_solves INTEGER NOT NULL DEFAULT 0 CHECK (unaided_solves >= 0),
  updated_at     TEXT NOT NULL
) STRICT;

CREATE TABLE problems (
  slug            TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('curated', 'generated', 'pasted', 'imported')),
  topic           TEXT NOT NULL,
  difficulty      TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  title           TEXT NOT NULL,
  path            TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  created_at      TEXT NOT NULL
) STRICT;
CREATE INDEX problems_by_topic ON problems (topic);

-- No foreign key to problems: curated problems come and go with app updates,
-- and attempts on a removed problem are still history.
CREATE TABLE attempts (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL,
  language    TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  passed      INTEGER CHECK (passed IS NULL OR passed >= 0),
  total       INTEGER CHECK (total IS NULL OR total >= 0),
  outcome     TEXT CHECK (outcome IS NULL OR outcome IN ('unaided', 'with_hints', 'gave_up')),
  hints_used  INTEGER NOT NULL DEFAULT 0 CHECK (hints_used >= 0),
  explained   INTEGER NOT NULL DEFAULT 0 CHECK (explained IN (0, 1)),
  notes       TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX attempts_by_slug ON attempts (slug, id);

CREATE TABLE hints (
  attempt_id INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  level      INTEGER NOT NULL CHECK (level >= 1),
  given_at   TEXT NOT NULL
) STRICT;
CREATE INDEX hints_by_attempt ON hints (attempt_id);

CREATE TABLE threads (
  id            TEXT PRIMARY KEY,               -- 'home' or a problem slug
  backend       TEXT NOT NULL,
  backend_state TEXT NOT NULL,                  -- JSON
  created_at    TEXT NOT NULL,
  archived_at   TEXT
) STRICT;

CREATE TABLE messages (
  thread_id  TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL CHECK (seq >= 1),
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,                     -- JSON: text and tool events
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, seq)
) STRICT;

CREATE TABLE test_runs (
  id         INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('run', 'submit')),
  report     TEXT NOT NULL,                     -- JSON, already redacted (SPEC §6.1)
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX test_runs_by_attempt ON test_runs (attempt_id, id);

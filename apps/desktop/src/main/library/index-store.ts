/**
 * The `articles` table (SPEC §4.2, migration 0002): reading and applying a
 * scan. Functions take the raw database; callers write through
 * `SqliteStorage.writeSql` so writes share the one queue.
 */
import {
  GENERATED_FOLDER_ID,
  parseJson,
  stringifyJson,
  type Frontmatter,
  type IndexedArticle,
  type ScanPlan,
} from '@algo/core';
import type { Db } from '../storage/database';

export interface ArticleRow extends IndexedArticle {
  folderId: string;
  title: string;
  frontmatter: Frontmatter;
  scannedAt: string;
  /** T42: written by the tutor; set by the app only, never from frontmatter. */
  generated: boolean;
}

/** What a scanned note contributes to its row. */
export interface IndexedNote {
  relPath: string;
  contentHash: string;
  sourceUrl: string | null;
  title: string;
  frontmatter: Frontmatter;
}

type Row = Record<string, unknown>;

const toRow = (r: Row): ArticleRow => ({
  id: r.id as string,
  folderId: r.folder_id as string,
  relPath: r.rel_path as string,
  title: r.title as string,
  sourceUrl: (r.source_url as string | null) ?? null,
  frontmatter: parseJson(r.frontmatter as string) as Frontmatter,
  contentHash: r.content_hash as string,
  missingSince: (r.missing_since as string | null) ?? null,
  scannedAt: r.scanned_at as string,
  generated: Number(r.generated) === 1,
});

export function listArticles(db: Db, folderId?: string): ArticleRow[] {
  const rows = folderId
    ? db.prepare('SELECT * FROM articles WHERE folder_id = ? ORDER BY rel_path').all(folderId)
    : db.prepare('SELECT * FROM articles ORDER BY folder_id, rel_path').all();
  return (rows as Row[]).map(toRow);
}

export function countArticles(db: Db): Map<string, { articles: number; missing: number }> {
  const rows = db
    .prepare(
      'SELECT folder_id, COUNT(*) AS n, SUM(missing_since IS NOT NULL) AS m FROM articles GROUP BY folder_id',
    )
    .all() as Row[];
  return new Map(
    rows.map((r) => [r.folder_id as string, { articles: Number(r.n), missing: Number(r.m) }]),
  );
}

/**
 * Applies a plan for one folder. A move can land on a path that another
 * moving row still holds (two files swapped), so moving rows are parked on
 * a placeholder path first to keep `UNIQUE (folder_id, rel_path)`. A path
 * that is seen again always matches its own row, so inserts never collide.
 */
export function applyScan(
  db: Db,
  folderId: string,
  plan: ScanPlan<IndexedNote>,
  now: string,
  newId: () => string,
): void {
  const park = db.prepare('UPDATE articles SET rel_path = ? WHERE id = ?');
  for (const u of plan.update) if (u.moved) park.run(`\u0000moving/${u.id}`, u.id);
  const update = db.prepare(
    `UPDATE articles SET rel_path = ?, title = ?, source_url = ?, frontmatter = ?,
       content_hash = ?, missing_since = NULL, scanned_at = ? WHERE id = ?`,
  );
  for (const { id, note } of plan.update) {
    update.run(
      note.relPath,
      note.title,
      note.sourceUrl,
      stringifyJson(note.frontmatter),
      note.contentHash,
      now,
      id,
    );
  }
  const missing = db.prepare('UPDATE articles SET missing_since = ? WHERE id = ?');
  for (const id of plan.missing) missing.run(now, id);
  const insert = db.prepare(
    `INSERT INTO articles (id, folder_id, rel_path, title, source_url, frontmatter, content_hash, scanned_at, generated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // A new file in the app's own folder is the tutor's.
  const generated = folderId === GENERATED_FOLDER_ID ? 1 : 0;
  for (const note of plan.insert) {
    insert.run(
      newId(),
      folderId,
      note.relPath,
      note.title,
      note.sourceUrl,
      stringifyJson(note.frontmatter),
      note.contentHash,
      now,
      generated,
    );
  }
}

export function deleteFolderRows(db: Db, folderId: string): number {
  // T24: the folder's article chats go too (messages cascade).
  db.prepare(
    'DELETE FROM threads WHERE article_id IN (SELECT id FROM articles WHERE folder_id = ?)',
  ).run(folderId);
  return Number(db.prepare('DELETE FROM articles WHERE folder_id = ?').run(folderId).changes);
}

// ---- T42: changes the app makes to the folders itself

/** Marks an article as written by the tutor (T43: saved into a library folder). */
export function markGenerated(db: Db, id: string): void {
  db.prepare('UPDATE articles SET generated = 1 WHERE id = ?').run(id);
}

/** Rows (in `folderId`) at `path` or under it, when `path` is a folder. */
export function rowsUnder(db: Db, folderId: string, path: string, folder: boolean): ArticleRow[] {
  const rows = listArticles(db, folderId);
  if (!folder) return rows.filter((r) => r.relPath === path);
  return rows.filter((r) => path === '' || r.relPath.startsWith(`${path}/`));
}

/**
 * After the app moved files: each row to its new folder and path. Rows are
 * parked first, as in `applyScan`, so a swap cannot break the unique key.
 */
export function moveRows(
  db: Db,
  moves: readonly { id: string; folderId: string; relPath: string }[],
): void {
  const park = db.prepare('UPDATE articles SET rel_path = ? WHERE id = ?');
  for (const m of moves) park.run(`\u0000moving/${m.id}`, m.id);
  const move = db.prepare('UPDATE articles SET folder_id = ?, rel_path = ? WHERE id = ?');
  for (const m of moves) move.run(m.folderId, m.relPath, m.id);
}

const hasThreads = (db: Db, id: string): boolean =>
  db.prepare('SELECT 1 FROM threads WHERE article_id = ? LIMIT 1').get(id) !== undefined;

/**
 * After the app sent files to the trash: an article with chats stays, marked
 * missing (its chats are kept, as for any file that disappears); one
 * without leaves the index.
 */
export function trashedRows(db: Db, ids: readonly string[], now: string): void {
  const missing = db.prepare(
    'UPDATE articles SET missing_since = COALESCE(missing_since, ?) WHERE id = ?',
  );
  const drop = db.prepare('DELETE FROM articles WHERE id = ?');
  for (const id of ids) {
    if (hasThreads(db, id)) missing.run(now, id);
    else drop.run(id);
  }
}

/** Deletes a missing article and its chats (messages cascade). */
export function deleteArticleRow(db: Db, id: string): void {
  db.prepare('DELETE FROM threads WHERE article_id = ?').run(id);
  db.prepare('DELETE FROM articles WHERE id = ?').run(id);
}

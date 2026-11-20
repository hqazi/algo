/**
 * The `articles` table (SPEC §4.2, migration 0002): reading and applying a
 * scan. Functions take the raw database; callers write through
 * `SqliteStorage.writeSql` so writes share the one queue.
 */
import {
  parseJson,
  stringifyJson,
  type Frontmatter,
  type IndexedArticle,
  type ScanPlan,
} from '@algorithm-tutor/core';
import type { Db } from '../storage/database';

export interface ArticleRow extends IndexedArticle {
  folderId: string;
  title: string;
  frontmatter: Frontmatter;
  scannedAt: string;
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
    `INSERT INTO articles (id, folder_id, rel_path, title, source_url, frontmatter, content_hash, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
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
    );
  }
}

export function deleteFolderRows(db: Db, folderId: string): number {
  return Number(db.prepare('DELETE FROM articles WHERE folder_id = ?').run(folderId).changes);
}

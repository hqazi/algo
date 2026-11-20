/**
 * Library scan rules and article identity (SPEC §15.1), without the file
 * system: the main process walks the folder and hashes files, this decides
 * what counts and how a rescan changes the index.
 *
 * Identity is `(folder id, path inside the folder)`. A rescan that finds a
 * path gone and a new path with the same content hash, or the same
 * `source`, moves the article (keeping its id, so its chats follow) instead
 * of dropping it. An article whose file disappears is kept, marked missing.
 */

/** Notes larger than this are skipped. */
export const MAX_NOTE_BYTES = 5 * 1024 * 1024;

/** Folders (and files) whose name starts with a dot are skipped: `.obsidian`, `.trash`, `.git`. */
export function isSkippedName(name: string): boolean {
  return name.startsWith('.');
}

export function isNoteFile(name: string): boolean {
  return /\.md$/i.test(name) && !isSkippedName(name);
}

/** An article as the index has it. */
export interface IndexedArticle {
  id: string;
  relPath: string;
  contentHash: string;
  sourceUrl: string | null;
  missingSince: string | null;
}

/** A note the scan found. `relPath` uses `/`. */
export interface FoundNote {
  relPath: string;
  contentHash: string;
  sourceUrl: string | null;
}

export interface ScanPlan<N extends FoundNote> {
  /** New articles. */
  insert: N[];
  /** Existing articles seen again: same path, or moved (`moved`). */
  update: { id: string; note: N; moved: boolean }[];
  /** Ids whose file is gone as of this scan (not those already missing). */
  missing: string[];
}

const byPath = <T extends { relPath: string }>(a: T, b: T) =>
  a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;

/**
 * How one folder's index changes after a scan. Deterministic: candidates
 * are matched in path order, by hash first, then by `source`.
 */
export function planScan<N extends FoundNote>(
  existing: readonly IndexedArticle[],
  found: readonly N[],
): ScanPlan<N> {
  const plan: ScanPlan<N> = { insert: [], update: [], missing: [] };
  const atPath = new Map(existing.map((a) => [a.relPath, a]));
  const fresh: N[] = [];
  const matched = new Set<string>();
  for (const note of [...found].sort(byPath)) {
    const same = atPath.get(note.relPath);
    if (same && !matched.has(same.id)) {
      matched.add(same.id);
      plan.update.push({ id: same.id, note, moved: false });
    } else {
      fresh.push(note);
    }
  }
  // Articles not seen at their path: gone, or moved.
  const candidates = existing.filter((a) => !matched.has(a.id)).sort(byPath);
  const take = (pred: (a: IndexedArticle) => boolean): IndexedArticle | undefined => {
    const hit = candidates.find((a) => !matched.has(a.id) && pred(a));
    if (hit) matched.add(hit.id);
    return hit;
  };
  const unmatched: N[] = [];
  const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  for (const note of fresh) {
    // Copies with the same content: prefer the one with the same file name.
    const hit =
      take(
        (a) => a.contentHash === note.contentHash && fileName(a.relPath) === fileName(note.relPath),
      ) ?? take((a) => a.contentHash === note.contentHash);
    if (hit) plan.update.push({ id: hit.id, note, moved: true });
    else unmatched.push(note);
  }
  for (const note of unmatched) {
    const hit = note.sourceUrl ? take((a) => a.sourceUrl === note.sourceUrl) : undefined;
    if (hit) plan.update.push({ id: hit.id, note, moved: true });
    else plan.insert.push(note);
  }
  for (const a of candidates) {
    if (!matched.has(a.id) && a.missingSince === null) plan.missing.push(a.id);
  }
  return plan;
}

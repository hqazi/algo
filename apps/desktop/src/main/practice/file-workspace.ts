/**
 * The learner's solution files on disk (SPEC §4.1:
 * `<data>/workspace/<slug>/solution.<ext>`), implementing core's `Workspace`
 * plus what the practice view needs: save as you type (atomic writes) and
 * notice edits made in another editor.
 *
 * Watching uses `fs.watch` on the problem's folder (the file itself is
 * replaced on every atomic save, which ends a watch on the file on some
 * systems). Events are debounced, and a change is reported only when the
 * file's content differs from what this app last wrote or reported, so our
 * own saves never echo back.
 */
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkSlug, SOLUTION_FILES, type Language, type Workspace } from '@algorithm-tutor/core';

/** Largest solution file the app saves or reads (bytes, UTF-8). */
export const MAX_SOLUTION_BYTES = 200_000;
const DEBOUNCE_MS = 120;

export class SolutionTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`the code is ${bytes} bytes; the limit is ${MAX_SOLUTION_BYTES}`);
    this.name = 'SolutionTooLargeError';
  }
}

export interface WatchHandle {
  close(): void;
}

let tmpCounter = 0;

export class FileWorkspace implements Workspace {
  /** Last content written or reported per file, so our own writes are not reported as edits. */
  private readonly known = new Map<string, string>();

  constructor(private readonly root: string) {}

  dir(slug: string): string {
    return join(this.root, checkSlug(slug));
  }

  file(slug: string, language: Language): string {
    return join(this.dir(slug), SOLUTION_FILES[language]);
  }

  async read(slug: string, language: Language): Promise<string | null> {
    const path = this.file(slug, language);
    try {
      const text = await readFile(path, 'utf8');
      this.known.set(path, text);
      return text;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async create(slug: string, language: Language, content: string): Promise<{ created: boolean }> {
    const path = this.file(slug, language);
    await mkdir(this.dir(slug), { recursive: true });
    try {
      await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
      this.known.set(path, content);
      return { created: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { created: false };
      throw e;
    }
  }

  /** Replace the solution atomically (temp file + rename). */
  async write(slug: string, language: Language, content: string): Promise<{ bytes: number }> {
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_SOLUTION_BYTES) throw new SolutionTooLargeError(bytes);
    const path = this.file(slug, language);
    await mkdir(this.dir(slug), { recursive: true });
    const tmp = `${path}.${process.pid}.${++tmpCounter}.tmp`;
    this.known.set(path, content);
    try {
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, path);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return { bytes };
  }

  /**
   * Calls `onChange` with the new content whenever the file is changed by
   * something other than this workspace. Creates the folder if needed.
   */
  async watch(
    slug: string,
    language: Language,
    onChange: (content: string) => void,
  ): Promise<WatchHandle> {
    const dir = this.dir(slug);
    const path = this.file(slug, language);
    const name = SOLUTION_FILES[language];
    await mkdir(dir, { recursive: true });
    if (!this.known.has(path)) await this.read(slug, language);
    let timer: NodeJS.Timeout | undefined;
    let closed = false;
    const check = async (): Promise<void> => {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        return; // deleted or mid-replace: wait for the next event
      }
      if (closed || text === this.known.get(path)) return;
      if (Buffer.byteLength(text, 'utf8') > MAX_SOLUTION_BYTES) return;
      this.known.set(path, text);
      onChange(text);
    };
    const watcher: FSWatcher = watch(dir, (_event, file) => {
      if (file !== null && file !== name) return;
      clearTimeout(timer);
      timer = setTimeout(() => void check(), DEBOUNCE_MS);
    });
    watcher.on('error', () => {
      /* the folder went away; nothing more to report */
    });
    return {
      close: () => {
        closed = true;
        clearTimeout(timer);
        watcher.close();
      },
    };
  }
}

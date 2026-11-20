/**
 * Articles the tutor writes (SPEC §15.1, T25), in the main process: the
 * files in `<data>/articles/generated/<slug>.md` (the app's own folder,
 * never a library folder), the writer over the tutor's backend, and the
 * `library:write-article` channel. The renderer sends a topic, level and
 * length and gets back the new article's id and title.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ArticleWriter,
  GENERATED_FOLDER_ID,
  GenerateError,
  type ArticleToSave,
  type TutorBackend,
} from '@algo/core';
import { IpcRefusal, type IpcRouter } from '../../ipc/router';
import type { LibraryService } from '../service';

/** How long writing one article may take. */
export const WRITE_TIMEOUT_MS = 5 * 60 * 1000;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The generated articles' folder: names checked, written staged then renamed. */
export class GeneratedArticles {
  constructor(readonly dir: string) {}

  ensure(): Promise<string | undefined> {
    return mkdir(this.dir, { recursive: true });
  }

  taken(slug: string): boolean {
    return existsSync(join(this.dir, `${slug}.md`));
  }

  async write(slug: string, markdown: string): Promise<string> {
    if (!SLUG_RE.test(slug) || slug.length > 80) throw new Error(`bad article slug ${slug}`);
    await this.ensure();
    const target = join(this.dir, `${slug}.md`);
    if (existsSync(target)) throw new Error(`article ${slug}.md exists already`);
    // A dot name: a scan meanwhile skips it.
    const staging = join(this.dir, `.${slug}-${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(staging, markdown, { encoding: 'utf8', flag: 'wx' });
      await rename(staging, target);
    } finally {
      await rm(staging, { force: true });
    }
    return `${slug}.md`;
  }
}

export interface GeneratedDeps {
  files: GeneratedArticles;
  library: LibraryService;
  backend: () => TutorBackend;
  now: () => string;
  newId: () => string;
  timeoutMs?: number;
  log?: (message: string, error?: unknown) => void;
}

/** The writer, saving into `files` and indexing the result. */
export function articleWriter(deps: GeneratedDeps): ArticleWriter {
  return new ArticleWriter({
    backend: deps.backend,
    taken: (slug) => deps.files.taken(slug),
    now: deps.now,
    newId: deps.newId,
    ...(deps.log ? { log: deps.log } : {}),
    save: async (a: ArticleToSave) => {
      const relPath = await deps.files.write(a.slug, a.markdown);
      await deps.library.refresh();
      const id = deps.library.articleAt(GENERATED_FOLDER_ID, relPath);
      if (!id) throw new Error('the new article was not indexed');
      return id;
    },
  });
}

export function registerGeneratedHandlers(
  router: IpcRouter,
  writer: ArticleWriter,
  options: { timeoutMs?: number; log?: (message: string, error?: unknown) => void } = {},
): void {
  router.handle('library:write-article', async (request) => {
    const signal = AbortSignal.timeout(options.timeoutMs ?? WRITE_TIMEOUT_MS);
    try {
      const a = await writer.write(request, signal);
      return { id: a.id, title: a.title };
    } catch (e) {
      if (e instanceof GenerateError) {
        const message =
          e.code === 'cancelled' && signal.aborted
            ? 'Writing the article took too long and was stopped. Try again.'
            : e.message;
        throw new IpcRefusal(e.code, message);
      }
      options.log?.('writing an article failed', e);
      throw new IpcRefusal('backend', 'Writing the article failed. Try again.');
    }
  });
}

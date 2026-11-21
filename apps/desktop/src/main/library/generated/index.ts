/**
 * Articles the tutor writes (SPEC §15.1, T25, T43), in the main process: the
 * app's own folder (`<data>/articles/generated`, the default place), the
 * writer over the tutor's backend, and the `library:write` stream. The
 * renderer sends a brief, level, length, how many parts and where to save;
 * it gets progress per part and the articles saved. A series goes into a new
 * folder named after it. Every file is written new (never over another),
 * indexed and marked AI-written by the library service.
 */
import { mkdir } from 'node:fs/promises';
import {
  ArticleWriter,
  GenerateError,
  SeriesStopped,
  type ArticleSink,
  type TutorBackend,
} from '@algo/core';
import { IpcRefusal, type IpcRouter } from '../../ipc/router';
import { LibraryError, type LibraryService } from '../service';

/** How long writing one article (or planning a series) may take. */
export const WRITE_TIMEOUT_MS = 5 * 60 * 1000;

/** The app's own folder for the tutor's articles. */
export class GeneratedArticles {
  constructor(readonly dir: string) {}

  ensure(): Promise<string | undefined> {
    return mkdir(this.dir, { recursive: true });
  }
}

export interface GeneratedDeps {
  backend: () => TutorBackend;
  now: () => string;
  newId: () => string;
  log?: (message: string, error?: unknown) => void;
}

export function articleWriter(deps: GeneratedDeps): ArticleWriter {
  return new ArticleWriter({
    backend: deps.backend,
    now: deps.now,
    newId: deps.newId,
    ...(deps.log ? { log: deps.log } : {}),
  });
}

/** Where the writer saves: `to` for one article, a new folder in `to` for a series. */
export function librarySink(
  library: LibraryService,
  to: { folderId: string; path: string },
): (series: string | null) => Promise<ArticleSink> {
  return async (series) => {
    const at = series === null ? to : await library.seriesFolder(to, series);
    return { save: (a) => library.saveGenerated(at, a) };
  };
}

export function registerGeneratedHandlers(
  router: IpcRouter,
  writer: ArticleWriter,
  library: LibraryService,
  options: { timeoutMs?: number; log?: (message: string, error?: unknown) => void } = {},
): void {
  router.handleStream('library:write', async (request, { signal, emit }) => {
    // Planning and each part get the same allowance.
    const per = options.timeoutMs ?? WRITE_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(per * (request.parts === 1 ? 1 : request.parts + 1));
    const both = AbortSignal.any([signal, timeout]);
    const message = (e: GenerateError) =>
      e.code === 'cancelled' && timeout.aborted
        ? 'Writing took too long and was stopped. Try again.'
        : e.message;
    try {
      // A bad place is refused before the tutor is asked.
      library.place(request.to);
      const written = await writer.write(request, librarySink(library, request.to), both, (p) => {
        if (!signal.aborted) emit(p);
      });
      return { articles: written, stopped: null };
    } catch (e) {
      if (e instanceof SeriesStopped && e.written.length > 0)
        return {
          articles: e.written,
          stopped: { code: e.code, message: message(e) },
        };
      if (e instanceof GenerateError) throw new IpcRefusal(e.code, message(e));
      if (e instanceof LibraryError) throw new IpcRefusal(e.reason, e.message);
      options.log?.('writing an article failed', e);
      throw new IpcRefusal('backend', 'Writing the article failed. Try again.');
    }
  });
}

/**
 * IPC for linked images (T23, SPEC §15.4): load an article's images,
 * "Make available offline" for a folder, and the cache's size / Clear.
 * The renderer sends article and folder ids only; main reads the file and
 * finds the references itself (`readArticle` → `extractRefs`).
 */
import type { ImageView } from '../../../shared/library';
import { IpcRefusal, type IpcRouter } from '../../ipc/router';
import { readArticle, type AssetRegistry } from '../assets';
import { LibraryError, type LibraryService } from '../service';
import type { LinkedImages } from './linked';

/** References that point to a website (`https:` or `//host`). */
export const isRemoteRef = (key: string): boolean => /^https:/i.test(key) || key.startsWith('//');

async function remoteImages(
  library: LibraryService,
  assets: AssetRegistry,
  linked: LinkedImages,
  id: string,
): Promise<Record<string, ImageView>> {
  try {
    const a = await readArticle(library, assets, id, linked);
    return Object.fromEntries(Object.entries(a.images).filter(([k]) => isRemoteRef(k)));
  } catch (e) {
    if (e instanceof LibraryError) throw new IpcRefusal(e.reason, e.message);
    throw e;
  }
}

/** The ids of a folder's articles whose files are there. */
function folderArticles(library: LibraryService, folderId: string): string[] | null {
  const folder = library.tree().find((f) => f.id === folderId);
  if (!folder) return null;
  const out: string[] = [];
  const walk = (t: (typeof folder)['root']) => {
    for (const a of t.articles) if (!a.missing) out.push(a.id);
    for (const sub of t.folders) walk(sub);
  };
  walk(folder.root);
  return out;
}

export function registerImageHandlers(
  router: IpcRouter,
  library: LibraryService,
  deps: { assets: AssetRegistry; linked: LinkedImages },
): void {
  const { assets, linked } = deps;

  router.handle('library:load-images', async ({ id, force, retry }) => {
    const now = await remoteImages(library, assets, linked, id);
    const mode = linked.mode();
    if (mode === 'ask' && !force) return { mode, images: now };
    return { mode, images: await linked.load(Object.keys(now), { retry }) };
  });

  router.handle('library:image-cache', () => linked.usage());
  router.handle('library:clear-image-cache', async () => {
    await linked.clear();
    return linked.usage();
  });

  router.handleStream('library:offline', async ({ id }, { signal, emit }) => {
    const ids = folderArticles(library, id);
    if (!ids) throw new IpcRefusal('not_found', 'That folder is not in the library.');
    let done = 0;
    let failed = 0;
    emit({ done, total: ids.length, failed });
    for (const articleId of ids) {
      if (signal.aborted) break;
      try {
        const refs = Object.keys(await remoteImages(library, assets, linked, articleId));
        const views = await linked.load(refs, { signal });
        failed += Object.values(views).filter((v) => v.kind === 'blocked').length;
      } catch {
        // The article went away meanwhile: skip it.
      }
      if (signal.aborted) break;
      done += 1;
      emit({ done, total: ids.length, failed });
    }
    return { done, total: ids.length, failed, cancelled: signal.aborted };
  });
}

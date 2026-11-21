/**
 * The Library in the main process (T21): the index service, its IPC
 * channels, and watching folders while the Library page is open.
 */
import { IpcRefusal, type IpcRouter } from '../ipc/router';
import { LibraryError, LibraryService, type LibraryDeps } from './service';
import { watchFolders, type WatchFn } from './watcher';

export {
  LibraryError,
  LibraryService,
  type FolderInfo,
  type FolderTree,
  type LibraryItem,
} from './service';
export { scanFolder, type FolderScan, type ScannedFile } from './scanner';

async function refusing<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LibraryError) throw new IpcRefusal(e.reason, e.message);
    throw e;
  }
}

/** Opens the index and rescans in the background (the scan at start). */
export function openLibrary(deps: LibraryDeps): LibraryService {
  const library = new LibraryService(deps);
  void library.refresh().catch((e: unknown) => deps.log?.(`library: start scan: ${String(e)}`));
  return library;
}

export function registerLibraryHandlers(
  router: IpcRouter,
  library: LibraryService,
  options: {
    watch?: WatchFn;
    debounceMs?: number;
    retryMs?: number;
    log?: (m: string) => void;
  } = {},
): void {
  const tree = () => ({ folders: library.tree() });
  router.handle('library:folders', () => ({ folders: library.folders() }));
  router.handle('library:add-folder', () =>
    refusing(async () => ({ added: await library.addFolder(), folders: library.folders() })),
  );
  router.handle('library:remove-folder', ({ id }) =>
    refusing(async () => {
      await library.removeFolder(id);
      return { folders: library.folders() };
    }),
  );
  router.handle('library:open-folder', ({ id }) =>
    refusing(async () => ({ opened: await library.openFolder(id) })),
  );
  router.handle('library:tree', () => tree());
  router.handle('library:refresh', async () => {
    await library.refresh();
    return tree();
  });
  // T42: changes the user asks for in the tree.
  router.handle('library:create-folder', ({ at, name }) =>
    refusing(async () => {
      await library.createFolder(at.folderId, at.path, name);
      return tree();
    }),
  );
  router.handle('library:move', ({ item, to }) =>
    refusing(async () => {
      await library.move(item, to);
      return tree();
    }),
  );
  router.handle('library:delete', ({ item }) =>
    refusing(async () => {
      await library.remove(item);
      return tree();
    }),
  );
  router.handleStream('library:watch', async (_req, { signal, emit }) => {
    // Opening the Library rescans.
    await library.refresh();
    if (signal.aborted) return { closed: true as const };
    emit(tree());
    const watcher = watchFolders({
      folders: () => library.paths(),
      rescan: () => library.refresh(),
      onScanned: () => {
        if (!signal.aborted) emit(tree());
      },
      ...options,
    });
    // A folder added or removed meanwhile: watch the new list.
    const off = library.onFoldersChange(() => watcher.reset());
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    off();
    watcher.stop();
    return { closed: true as const };
  });
}

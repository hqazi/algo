/** Where a dragged or moved tree item may go (T42); main checks again. */
import type { FolderPlace, LibraryItemView } from '../../../shared/library';

const within = (path: string, dir: string): boolean =>
  dir === '' || path === dir || path.startsWith(`${dir}/`);

export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** What is being moved, with the folder it is in now. */
export interface Moving {
  item: LibraryItemView;
  from: FolderPlace;
}

/** True if `m` may go into `to`: not where it is, not into itself. */
export function canDrop(m: Moving, to: FolderPlace): boolean {
  if (m.from.folderId === to.folderId && m.from.path === to.path) return false;
  if (m.item.kind === 'folder' && m.item.folderId === to.folderId)
    return !within(to.path, m.item.path);
  return true;
}

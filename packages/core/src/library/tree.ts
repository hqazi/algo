/**
 * The Library's left pane (SPEC §15.6): a folder's articles as the folder
 * tree, folders first, then articles by title. Only names inside the chosen
 * folder appear; never an absolute path.
 */

export interface TreeArticleInput {
  id: string;
  relPath: string;
  title: string;
  tags: string[];
  missing: boolean;
  generated?: boolean;
  /** T43: a series part's number (tutor-written only): parts list in order, before other notes. */
  order?: number;
}

export interface TreeArticle {
  id: string;
  title: string;
  tags: string[];
  missing: boolean;
  /** T42: written by the tutor (shown with the AI-written mark). */
  generated?: true;
}

export interface TreeFolder {
  name: string;
  /** T42: the folder's path inside the library folder (`''` for the root). */
  path: string;
  folders: TreeFolder[];
  articles: TreeArticle[];
}

const compare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) ||
  (a < b ? -1 : a > b ? 1 : 0);

function sortFolder(f: TreeFolder, order: ReadonlyMap<string, number>): void {
  const at = (id: string) => order.get(id) ?? Infinity;
  f.folders.sort((a, b) => compare(a.name, b.name));
  // Infinity − Infinity is NaN: falls through to the title.
  f.articles.sort(
    (a, b) => at(a.id) - at(b.id) || compare(a.title, b.title) || compare(a.id, b.id),
  );
  for (const x of f.folders) sortFolder(x, order);
}

/**
 * The tree of `articles`, plus `dirs` (T42: folder paths the scan found, so
 * an empty folder shows too).
 */
export function buildTree(
  articles: readonly TreeArticleInput[],
  name = '',
  dirs: readonly string[] = [],
): TreeFolder {
  const root: TreeFolder = { name, path: '', folders: [], articles: [] };
  const folderAt = (parts: readonly string[]): TreeFolder => {
    let at = root;
    for (const part of parts) {
      if (!part) continue;
      let next = at.folders.find((f) => f.name === part);
      if (!next) {
        next = {
          name: part,
          path: at.path ? `${at.path}/${part}` : part,
          folders: [],
          articles: [],
        };
        at.folders.push(next);
      }
      at = next;
    }
    return at;
  };
  for (const d of dirs) folderAt(d.split('/'));
  for (const a of articles) {
    const parts = a.relPath.split('/');
    parts.pop();
    folderAt(parts).articles.push({
      id: a.id,
      title: a.title,
      tags: [...a.tags],
      missing: a.missing,
      ...(a.generated ? { generated: true as const } : {}),
    });
  }
  sortFolder(
    root,
    new Map(articles.flatMap((a) => (a.order === undefined ? [] : [[a.id, a.order] as const]))),
  );
  return root;
}

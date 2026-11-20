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
}

export interface TreeArticle {
  id: string;
  title: string;
  tags: string[];
  missing: boolean;
}

export interface TreeFolder {
  name: string;
  folders: TreeFolder[];
  articles: TreeArticle[];
}

const compare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) ||
  (a < b ? -1 : a > b ? 1 : 0);

function sortFolder(f: TreeFolder): void {
  f.folders.sort((a, b) => compare(a.name, b.name));
  f.articles.sort((a, b) => compare(a.title, b.title) || compare(a.id, b.id));
  f.folders.forEach(sortFolder);
}

export function buildTree(articles: readonly TreeArticleInput[], name = ''): TreeFolder {
  const root: TreeFolder = { name, folders: [], articles: [] };
  for (const a of articles) {
    const parts = a.relPath.split('/');
    parts.pop();
    let at = root;
    for (const part of parts) {
      if (!part) continue;
      let next = at.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, folders: [], articles: [] };
        at.folders.push(next);
      }
      at = next;
    }
    at.articles.push({ id: a.id, title: a.title, tags: [...a.tags], missing: a.missing });
  }
  sortFolder(root);
  return root;
}

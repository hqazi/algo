/**
 * Schemas for the Library index (T21, SPEC §15.1): folders and the article
 * tree. Ids, names and titles only: no absolute path crosses IPC. Shared by
 * main and renderer; imports only zod.
 */
import { z } from 'zod';

const id = z.string().min(1).max(100);
const name = z.string().max(1000);

export const folderView = z.strictObject({
  id,
  /** The folder's own name (its last path part). */
  name,
  articles: z.int().min(0),
  missing: z.int().min(0),
  /** Why the last scan could not read it; `null` if it could. */
  error: z.string().max(500).nullable(),
});

export const foldersResponse = z.strictObject({ folders: z.array(folderView) });

export const folderRequest = z.strictObject({ id });

export const addFolderResponse = z.strictObject({
  /** `false`: the picker was cancelled. */
  added: z.boolean(),
  folders: z.array(folderView),
});

export const treeArticle = z.strictObject({
  id,
  title: z.string().max(2000),
  tags: z.array(z.string().max(500)).max(500),
  /** The file is gone; the article (and its chats) stay until deleted. */
  missing: z.boolean(),
});

export interface TreeFolderView {
  name: string;
  folders: TreeFolderView[];
  articles: z.output<typeof treeArticle>[];
}

export const treeFolder: z.ZodType<TreeFolderView> = z.lazy(() =>
  z.strictObject({
    name,
    folders: z.array(treeFolder),
    articles: z.array(treeArticle),
  }),
);

export const treeResponse = z.strictObject({
  folders: z.array(
    z.strictObject({ id, name, error: z.string().max(500).nullable(), root: treeFolder }),
  ),
});

export type FolderView = z.output<typeof folderView>;
export type TreeArticleView = z.output<typeof treeArticle>;
export type TreeView = z.output<typeof treeResponse>;

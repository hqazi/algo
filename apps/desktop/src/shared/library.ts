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
  /** T42: written by the tutor, outside the tutor's own folder. */
  generated: z.literal(true).optional(),
});

export interface TreeFolderView {
  name: string;
  /** T42: the folder's path inside its library folder (`''` for the root). */
  path: string;
  folders: TreeFolderView[];
  articles: z.output<typeof treeArticle>[];
}

export const treeFolder: z.ZodType<TreeFolderView> = z.lazy(() =>
  z.strictObject({
    name,
    path: z.string().max(4096),
    folders: z.array(treeFolder),
    articles: z.array(treeArticle),
  }),
);

export const treeResponse = z.strictObject({
  folders: z.array(
    z.strictObject({
      id,
      name,
      /** T25: the app's own "Written by the tutor" group. */
      generated: z.literal(true).optional(),
      error: z.string().max(500).nullable(),
      root: treeFolder,
    }),
  ),
});

export type FolderView = z.output<typeof folderView>;
export type TreeArticleView = z.output<typeof treeArticle>;
export type TreeView = z.output<typeof treeResponse>;

// ---- T42: changing the folders from the tree

/** A path inside a library folder, with `/`; main checks every part. */
const innerPath = z.string().max(4096);

/** A file or folder in the tree: an article by id, a folder by its path. */
export const libraryItem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('article'), id }),
  z.strictObject({ kind: z.literal('folder'), folderId: id, path: innerPath }),
]);

/** A folder in the tree to put something in (`path` `''`: the library folder itself). */
export const folderPlace = z.strictObject({ folderId: id, path: innerPath });

export const createFolderRequest = z.strictObject({
  at: folderPlace,
  name: z.string().min(1).max(200),
});

export const moveRequest = z.strictObject({ item: libraryItem, to: folderPlace });

export const deleteRequest = z.strictObject({ item: libraryItem });

export type LibraryItemView = z.output<typeof libraryItem>;
export type FolderPlace = z.output<typeof folderPlace>;

// ---- the reader (T22, SPEC §15.2–15.3)

/** The app asset route for library images (served by main, under the UI's origin). */
export const LIBRARY_ASSET_PREFIX = 'tutor-app://app/library-asset/';

/** Why an image reference is not shown (the placeholder says so). */
export const imageReason = z.enum([
  /** A link to a website, not downloaded yet (`ask` mode, or loading). */
  'remote',
  /** An `http:` link: never loaded. */
  'insecure',
  /** A `data:` URL that is not a base64 PNG, JPEG, GIF or WebP. */
  'data',
  /** Any other scheme (`file:`, `javascript:`…). */
  'scheme',
  /** The path leads outside the library folder. */
  'outside',
  'not_found',
  /** The file's first bytes are not PNG, JPEG, GIF or WebP. */
  'not_image',
  /** SVG is not shown in v3. */
  'svg',
  /** Over 25 MB. */
  'too_large',
  // Linked images (T23, §15.4): why a download was refused or failed.
  /** The host is or resolves to this machine or the local network. */
  'local_address',
  /** Not port 443. */
  'port',
  /** More than 3 redirects. */
  'redirects',
  /** Over 10 MB (2 MB for a `data:` image). */
  'oversize',
  /** Over 15 s. */
  'timeout',
  /** Width × height over 100 megapixels. */
  'pixels',
  /** The site answered with an error. */
  'http',
  /** The site could not be reached. */
  'network',
  /** Over 200 images or 100 MB for this article. */
  'limit',
]);

export const imageView = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('asset'), url: z.string().max(200) }),
  z.strictObject({
    kind: z.literal('blocked'),
    reason: imageReason,
    /** For a link to a website: its host, shown on the placeholder. */
    host: z.string().max(300).nullable(),
  }),
]);

/** Keys are short, except a `data:` image (up to 2 MB as base64). */
const refKeyString = z.string().max(3_000_000);

export const articleResponse = z.strictObject({
  id,
  title: z.string().max(2000),
  source: z.string().max(4096).nullable(),
  author: z.array(z.string().max(1000)).max(100),
  published: z.string().max(200).nullable(),
  created: z.string().max(200).nullable(),
  description: z.string().max(5000).nullable(),
  tags: z.array(z.string().max(500)).max(500),
  /** Frontmatter keys the app does not know, shown as read (values as text). */
  extra: z.array(z.tuple([z.string().max(200), z.string().max(1000)])).max(100),
  /** The file is gone (or cannot be read): the body is empty. */
  missing: z.boolean(),
  /** T25: written by the tutor (from the app's generated folder): labelled AI-written. */
  generated: z.boolean(),
  /** The Markdown after the frontmatter. */
  body: z.string().max(6 * 1024 * 1024),
  /** Per image reference (`refKey`): an asset URL or why it is not shown. */
  images: z.record(refKeyString, imageView),
  /** Per wikilink target (`refKey`): the library article it opens, or `null`. */
  links: z.record(refKeyString, id.nullable()),
});

/** Load an article's linked images (T23): `force` even in `ask` mode, `retry` forgets failures. */
export const loadImagesRequest = z.strictObject({
  id,
  force: z.boolean(),
  retry: z.boolean(),
});

export const imagesMode = z.enum(['on-open', 'ask']);

export const loadImagesResponse = z.strictObject({
  /** `library.images`: in `ask` mode nothing downloads unless `force`. */
  mode: imagesMode,
  /** The linked references (`refKey`) and what each shows now. */
  images: z.record(refKeyString, imageView),
});

export const imageCacheResponse = z.strictObject({
  images: z.int().min(0),
  bytes: z.int().min(0),
});

/** "Make available offline" progress: articles done of total, images that failed. */
export const offlineProgress = z.strictObject({
  done: z.int().min(0),
  total: z.int().min(0),
  failed: z.int().min(0),
});

export const offlineResult = z.strictObject({
  done: z.int().min(0),
  total: z.int().min(0),
  failed: z.int().min(0),
  cancelled: z.boolean(),
});

export const openLinkRequest = z.strictObject({ url: z.string().min(1).max(8192) });

/**
 * The key an image or link reference is looked up by, in main and in the
 * renderer: trimmed, without the `<…>` Markdown allows around a path.
 */
export function refKey(raw: string): string {
  const t = raw.trim();
  return t.startsWith('<') && t.endsWith('>') ? t.slice(1, -1).trim() : t;
}

/**
 * The parts of an Obsidian wikilink's inside (`note#heading|label`, or for an
 * image embed `file.png|300`). `target` is the lookup key (`refKey`).
 */
export function wikiTarget(inner: string): {
  target: string;
  heading: string | null;
  label: string | null;
} {
  const bar = inner.indexOf('|');
  const head = bar < 0 ? inner : inner.slice(0, bar);
  const label = bar < 0 ? null : inner.slice(bar + 1).trim() || null;
  const hash = head.indexOf('#');
  const target = refKey(hash < 0 ? head : head.slice(0, hash));
  const heading = hash < 0 ? null : head.slice(hash + 1).trim() || null;
  return { target, heading, label };
}

/** File names Obsidian embeds as images (others embed as notes). */
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|tiff?|ico|heic)$/i;

export type ImageReason = z.output<typeof imageReason>;
export type ImageView = z.output<typeof imageView>;
export type ArticleView = z.output<typeof articleResponse>;
export type ImagesMode = z.output<typeof imagesMode>;
export type LoadImagesView = z.output<typeof loadImagesResponse>;
export type OfflineProgress = z.output<typeof offlineProgress>;

// ---- T25, T43: articles the tutor writes

export const writeRequest = z.strictObject({
  /** What to cover: the user's own words. */
  brief: z.string().min(1).max(4000),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  length: z.enum(['short', 'medium', 'long']),
  /** 1: one article; 2–12: a series in a new folder. */
  parts: z.int().min(1).max(12),
  /** Where to save it: any library folder or the tutor's (`generated`). */
  to: folderPlace,
});

export const writtenArticle = z.strictObject({ id, title: z.string().max(2000) });

export const writeProgress = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('planning') }),
  z.strictObject({
    kind: z.literal('planned'),
    title: z.string().max(200),
    parts: z.array(z.string().max(200)).max(12),
  }),
  z.strictObject({
    kind: z.literal('writing'),
    part: z.int().min(1),
    of: z.int().min(1),
    title: z.string().max(200).nullable(),
  }),
  z.strictObject({
    kind: z.literal('saved'),
    part: z.int().min(1),
    of: z.int().min(1),
    id,
    title: z.string().max(2000),
  }),
]);

export const writeResult = z.strictObject({
  /** In order; for a series that stopped, the parts saved before it stopped. */
  articles: z.array(writtenArticle).max(12),
  /** Why a series stopped part-way (`cancelled` when the user stopped it); `null` if it finished. */
  stopped: z.strictObject({ code: z.string().max(50), message: z.string().max(1000) }).nullable(),
});

export type WriteRequest = z.output<typeof writeRequest>;
export type WriteProgressView = z.output<typeof writeProgress>;
export type WriteResult = z.output<typeof writeResult>;

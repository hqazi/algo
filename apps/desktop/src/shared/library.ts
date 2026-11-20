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

// ---- the reader (T22, SPEC §15.2–15.3)

/** The app asset route for library images (served by main, under the UI's origin). */
export const LIBRARY_ASSET_PREFIX = 'tutor-app://app/library-asset/';

/** Why an image reference is not shown (the placeholder says so). */
export const imageReason = z.enum([
  /** A link to a website: not downloaded by the reader (linked images: T23). */
  'remote',
  /** An `http:` link: never loaded. */
  'insecure',
  /** A `data:` URL: not shown inline. */
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

const refKeyString = z.string().max(4096);

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
  /** The Markdown after the frontmatter. */
  body: z.string().max(6 * 1024 * 1024),
  /** Per image reference (`refKey`): an asset URL or why it is not shown. */
  images: z.record(refKeyString, imageView),
  /** Per wikilink target (`refKey`): the library article it opens, or `null`. */
  links: z.record(refKeyString, id.nullable()),
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

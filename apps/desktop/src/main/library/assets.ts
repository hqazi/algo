/**
 * The reader's side of the Library in main (T22, SPEC §15.2–15.3): opening
 * an article, resolving its image references and wikilinks, and serving
 * local images under `tutor-app://app/library-asset/<token>`.
 *
 * - The renderer never sees or sends a path: each image it may show gets a
 *   random token for this session, mapped in memory to one file.
 * - A file is served only if its real path is inside the folder's real path,
 *   it is a regular file under 25 MB and it starts with PNG, JPEG, GIF or
 *   WebP magic bytes (that type is sent, with `nosniff`). No SVG.
 * - Reading only: nothing here writes to the folder or uses the network.
 */
import { randomBytes } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import {
  articleMeta,
  isSkippedName,
  MAX_NOTE_BYTES,
  parseNote,
} from '@algo/core';
import {
  IMAGE_FILE,
  LIBRARY_ASSET_PREFIX,
  refKey,
  wikiTarget,
  type ArticleView,
  type ImageReason,
  type ImageView,
} from '../../shared/library';
import { IpcRefusal, type IpcRouter } from '../ipc/router';
import type { LinkedImages } from './images/linked';
import type { ArticleRow } from './index-store';
import { LibraryError, type LibraryService } from './service';

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
/** References resolved per article (the rest show as not found). */
export const MAX_REFS = 1000;
/** Files listed when looking an image up by name. */
const MAX_NAME_INDEX = 100_000;
const ASSET_PATH = '/library-asset/';
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** The image type from the first bytes, or `null`. SVG is never one. */
export function sniffImage(b: Uint8Array): ImageType | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61)
    return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

const fromPosix = (root: string, rel: string): string => join(root, ...rel.split('/'));

type Checked = { path: string } | { reason: ImageReason };

/**
 * Is this file one the reader may show? Its real path must be inside
 * `root` (a real path); a regular file, not SVG, at most 25 MB, image magic.
 * `null` when it does not exist.
 */
export async function checkImageFile(root: string, path: string): Promise<Checked | null> {
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    return null;
  }
  if (!inside(root, real)) return { reason: 'outside' };
  const handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    () => null,
  );
  if (!handle) return { reason: 'not_found' };
  try {
    const st = await handle.stat();
    if (!st.isFile()) return { reason: 'not_found' };
    if (/\.svgz?$/i.test(real)) return { reason: 'svg' };
    if (st.size > MAX_ASSET_BYTES) return { reason: 'too_large' };
    const head = new Uint8Array(16);
    await handle.read(head, 0, 16, 0);
    if (!sniffImage(head)) return { reason: 'not_image' };
    return { path: real };
  } finally {
    await handle.close();
  }
}

/** Library images by token, for this session only. */
export class AssetRegistry {
  private readonly tokens = new Map<
    string,
    { folderId: string | null; root: string; path: string }
  >();
  private readonly byPath = new Map<string, string>();

  constructor(
    private readonly options: {
      newToken?: () => string;
      /** Is this folder still in the library? Tokens of a removed folder stop working. */
      isLibraryFolder?: (folderId: string) => boolean;
      /** Called with the real path of every file served (the security check's log). */
      onServe?: (path: string) => void;
    } = {},
  ) {}

  /**
   * The asset URL for a checked file (the same token for the same file).
   * `folderId` `null`: a file in the linked-image cache (T23), whose real
   * `root` is the cache folder.
   */
  url(folderId: string | null, root: string, path: string): string {
    const key = `${folderId}\0${path}`;
    let token = this.byPath.get(key);
    if (!token) {
      token = this.options.newToken?.() ?? randomBytes(24).toString('base64url');
      this.tokens.set(token, { folderId, root, path });
      this.byPath.set(key, token);
    }
    return `${LIBRARY_ASSET_PREFIX}${token}`;
  }

  /** Serves `tutor-app://app/library-asset/<token>`; anything else is 404. */
  async serve(request: Request): Promise<Response> {
    const notFound = () =>
      new Response('not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' },
      });
    let u: URL;
    try {
      u = new URL(request.url);
    } catch {
      return notFound();
    }
    if (u.host !== 'app' || request.method !== 'GET' || !u.pathname.startsWith(ASSET_PATH))
      return notFound();
    const token = u.pathname.slice(ASSET_PATH.length);
    const entry = TOKEN.test(token) ? this.tokens.get(token) : undefined;
    if (!entry) return notFound();
    if (
      entry.folderId !== null &&
      this.options.isLibraryFolder &&
      !this.options.isLibraryFolder(entry.folderId)
    )
      return notFound();
    // Checked again: the file may have changed since the article was opened.
    const checked = await checkImageFile(entry.root, entry.path);
    if (!checked || !('path' in checked)) return notFound();
    const handle = await open(checked.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
      () => null,
    );
    if (!handle) return notFound();
    this.options.onServe?.(checked.path);
    let bytes: Buffer;
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size > MAX_ASSET_BYTES) return notFound();
      const buf = Buffer.alloc(Math.min(st.size, MAX_ASSET_BYTES) + 1);
      let n = 0;
      while (n < buf.length) {
        const { bytesRead } = await handle.read(buf, n, buf.length - n, n);
        if (!bytesRead) break;
        n += bytesRead;
      }
      if (n > MAX_ASSET_BYTES) return notFound();
      bytes = buf.subarray(0, n);
    } finally {
      await handle.close();
    }
    // The type comes from the bytes served, not the file name.
    const type = sniffImage(bytes);
    if (!type) return notFound();
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  }
}

/** True for a request the asset route handles. */
export function isLibraryAssetRequest(url: string): boolean {
  try {
    const u = new URL(url);
    return u.host === 'app' && u.pathname.startsWith(ASSET_PATH);
  } catch {
    return false;
  }
}

// ---- references in a note

export interface NoteRefs {
  /** Image references (`refKey`): `![[x.png]]` targets and `![alt](path)` paths. */
  images: string[];
  /** Wikilink targets (`refKey`), from `[[note]]` and note embeds `![[note]]`. */
  links: string[];
}

/** The note without fenced code blocks and inline code (shown as written there). */
function withoutCode(body: string): string {
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  for (const line of body.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len) fence = null;
      continue;
    }
    if (m) {
      fence = { ch: m[1]![0]!, len: m[1]!.length };
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/(`+)[\s\S]*?\1/g, '');
}

const MD_IMAGE =
  /!\[(?:[^\]\\\n]|\\.)*\]\(\s*(<[^>\n]*>|(?:[^\s()\\]|\\.|\([^\s()]*\))+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

/**
 * Finds the references the reader resolves. A superset of what the
 * renderer finds is fine: a key it does not ask for is never shown.
 */
export function extractRefs(body: string): NoteRefs {
  const text = withoutCode(body);
  const images = new Set<string>();
  const links = new Set<string>();
  const add = (set: Set<string>, key: string) => {
    // A `data:` image may be long (2 MB as base64, T23); other keys are short.
    const max = key.startsWith('data:') ? 3_000_000 : 4096;
    if (key && key.length <= max && images.size + links.size < MAX_REFS) set.add(key);
  };
  const rest = text.replace(/!\[\[([^[\]\n]+)\]\]/g, (_m, inner: string) => {
    const { target } = wikiTarget(inner);
    add(IMAGE_FILE.test(target) ? images : links, target);
    return '';
  });
  for (const m of rest.matchAll(/\[\[([^[\]\n]+)\]\]/g)) add(links, wikiTarget(m[1]!).target);
  for (const m of rest.matchAll(MD_IMAGE)) add(images, refKey(m[1]!));
  return { images: [...images], links: [...links] };
}

// ---- resolving

/** The folder's files by lower-case name (for "a unique name anywhere"), listed once per open. */
async function nameIndex(root: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let count = 0;
  const visited = new Set<string>([root]);
  async function walk(dir: string, rel: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (count >= MAX_NAME_INDEX || isSkippedName(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const real = await realpath(join(dir, e.name)).catch(() => null);
        if (!real || visited.has(real)) continue;
        visited.add(real);
        await walk(join(dir, e.name), r);
      } else if (e.isFile() || e.isSymbolicLink()) {
        count += 1;
        const k = e.name.toLowerCase();
        out.set(k, [...(out.get(k) ?? []), r]);
      }
    }
  }
  await walk(root, '');
  return out;
}

const shortest = (paths: string[]): string | undefined =>
  [...paths].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];

const escapes = (p: string): boolean => p === '..' || p.startsWith('../') || p.startsWith('/');

export class FolderResolver {
  private names: Promise<Map<string, string[]>> | null = null;

  /** `root` is the folder's real path. */
  constructor(readonly root: string) {}

  private byName(name: string): Promise<string | undefined> {
    this.names ??= nameIndex(this.root);
    return this.names.then((m) => shortest(m.get(name.toLowerCase()) ?? []));
  }

  /**
   * As Obsidian does it: relative to the note, then to the folder root,
   * then a unique file name anywhere in the folder (shortest path wins).
   */
  async image(noteRel: string, ref: string): Promise<Checked & { host?: string | null }> {
    if (/^[a-z]:[\\/]/i.test(ref) || ref.startsWith('\\\\')) return { reason: 'outside' };
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
      let u: URL | null = null;
      try {
        u = new URL(ref);
      } catch {
        // Not a URL: still a scheme the reader does not load.
      }
      const proto = u?.protocol ?? `${ref.split(':')[0]!.toLowerCase()}:`;
      const host = u?.hostname || null;
      if (proto === 'https:') return { reason: 'remote', host };
      if (proto === 'http:') return { reason: 'insecure', host };
      if (proto === 'data:') return { reason: 'data', host: null };
      return { reason: 'scheme', host: null };
    }
    if (ref.startsWith('//')) return { reason: 'remote', host: ref.slice(2).split('/')[0] || null };
    let p = ref;
    try {
      p = decodeURIComponent(ref);
    } catch {
      // Not percent-encoded: use as written.
    }
    if (p.includes('\0')) return { reason: 'not_found' };
    // A Windows separator is a separator: `..\x` cannot slip past the checks.
    p = p.replace(/\\/g, '/');
    if (p.startsWith('/')) return { reason: 'outside' };
    const candidates = [
      ...new Set([posix.normalize(posix.join(posix.dirname(noteRel), p)), posix.normalize(p)]),
    ].filter((c) => !escapes(c));
    if (!candidates.length) return { reason: 'outside' };
    for (const c of candidates) {
      const r = await checkImageFile(this.root, fromPosix(this.root, c));
      if (r) return r;
    }
    const found = await this.byName(posix.basename(p));
    if (found)
      return (
        (await checkImageFile(this.root, fromPosix(this.root, found))) ?? { reason: 'not_found' }
      );
    return { reason: 'not_found' };
  }
}

/** A wikilink target → a library article in the same folder, or `null`. */
export function resolveLink(
  siblings: readonly ArticleRow[],
  noteRel: string,
  target: string,
): string | null {
  const t = target.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!t) return null;
  const bare = t.replace(/\.md$/i, '');
  const byPath = new Map(siblings.map((r) => [r.relPath.toLowerCase(), r.id]));
  for (const c of [posix.join(posix.dirname(noteRel), bare), posix.normalize(bare)]) {
    const id = byPath.get(`${posix.normalize(c)}.md`.toLowerCase());
    if (id) return id;
  }
  const want = `/${bare.toLowerCase()}.md`;
  const matches = siblings.filter((r) => `/${r.relPath.toLowerCase()}`.endsWith(want));
  const best = shortest(matches.map((r) => r.relPath));
  return matches.find((r) => r.relPath === best)?.id ?? null;
}

// ---- opening an article

async function readNote(root: string, relPath: string): Promise<string | null> {
  try {
    const real = await realpath(fromPosix(root, relPath));
    if (!inside(root, real)) return null;
    const st = await stat(real);
    if (!st.isFile() || st.size > MAX_NOTE_BYTES) return null;
    const handle = await open(real, constants.O_RDONLY);
    try {
      return (await handle.readFile()).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

const clip = (s: string | null, n: number): string | null => (s === null ? null : s.slice(0, n));

/**
 * Reads an article for the reader: header, body, image tokens, wikilinks.
 * With `linked` (T23), a linked image shows from the cache (or its recent
 * failure) and a `data:` image is stored and served; nothing downloads here.
 */
export async function readArticle(
  library: LibraryService,
  assets: AssetRegistry,
  id: string,
  linked?: LinkedImages,
): Promise<ArticleView> {
  const { folderPath, row, siblings } = library.article(id);
  const root = await realpath(folderPath).catch(() => null);
  const content = root && row.missingSince === null ? await readNote(root, row.relPath) : null;
  const parsed = content === null ? null : parseNote(content, row.relPath);
  const meta = parsed?.meta ?? articleMeta(row.frontmatter, row.relPath);
  // T25, T42: only the app marks an article AI-written (its own folder, or a
  // file the tutor saved), never a key in a note; the mark moves with it.
  const generated = row.generated;
  const images: Record<string, ImageView> = {};
  const links: Record<string, string | null> = {};
  if (parsed && root) {
    const refs = extractRefs(parsed.body);
    const resolver = new FolderResolver(root);
    for (const ref of refs.images) {
      const r = await resolver.image(row.relPath, ref);
      images[ref] =
        'path' in r
          ? { kind: 'asset', url: assets.url(row.folderId, root, r.path) }
          : linked && r.reason === 'remote'
            ? await linked.view(ref)
            : linked && r.reason === 'data'
              ? await linked.dataImage(ref)
              : { kind: 'blocked', reason: r.reason, host: clip(r.host ?? null, 300) };
    }
    for (const target of refs.links) links[target] = resolveLink(siblings, row.relPath, target);
  }
  return {
    id: row.id,
    title: meta.title.slice(0, 2000),
    source: clip(meta.source, 4096),
    author: meta.author.slice(0, 100).map((a) => a.slice(0, 1000)),
    published: clip(meta.published, 200),
    created: clip(meta.created, 200),
    description: clip(meta.description, 5000),
    tags: meta.tags.slice(0, 500).map((t) => t.slice(0, 500)),
    extra: Object.entries(meta.extra)
      .filter(([k]) => !(generated && k === 'generated'))
      .slice(0, 100)
      .map(([k, v]) => [
        k.slice(0, 200),
        (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 1000),
      ]),
    missing: parsed === null,
    generated,
    body: parsed?.body ?? '',
    images,
    links,
  };
}

/**
 * An article's title, source and Markdown body for a chat turn (T24): the
 * file read as the reader reads it, without resolving images or links.
 * `body` is `null` when the file is missing.
 */
export async function readArticleText(
  library: LibraryService,
  id: string,
): Promise<{ title: string; source: string | null; body: string | null }> {
  const { folderPath, row } = library.article(id);
  const root = await realpath(folderPath).catch(() => null);
  const content = root && row.missingSince === null ? await readNote(root, row.relPath) : null;
  const parsed = content === null ? null : parseNote(content, row.relPath);
  const meta = parsed?.meta ?? articleMeta(row.frontmatter, row.relPath);
  return { title: meta.title, source: meta.source, body: parsed?.body ?? null };
}

/** The URL to give the system browser, or `null`: `https:`, `http:` and `mailto:` only. */
export function externalUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol === 'mailto:') return u.href;
  if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname) return u.href;
  return null;
}

export function registerReaderHandlers(
  router: IpcRouter,
  library: LibraryService,
  options: {
    assets: AssetRegistry;
    openExternal: (url: string) => Promise<boolean>;
    linked?: LinkedImages;
  },
): void {
  router.handle('library:article', async ({ id }) => {
    try {
      return await readArticle(library, options.assets, id, options.linked);
    } catch (e) {
      if (e instanceof LibraryError) throw new IpcRefusal(e.reason, e.message);
      throw e;
    }
  });
  router.handle('library:open-link', async ({ url }) => {
    const safe = externalUrl(url);
    if (!safe) throw new IpcRefusal('scheme', 'Only web and mail links open in the browser.');
    return { opened: await options.openExternal(safe) };
  });
}

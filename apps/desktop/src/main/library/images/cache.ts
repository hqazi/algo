/**
 * The linked-image cache (T23, SPEC §15.4):
 * `<data>/cache/article-images/<sha256 of the URL>` and a small JSON record
 * beside it (type, size, dimensions, fetched at). Shared by every article;
 * never in a library folder and never exported.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageType } from '../assets';
import type { ImageInfo } from './header';

export interface CacheRecord {
  type: ImageType;
  size: number;
  width: number;
  height: number;
  fetchedAt: string;
}

const HEX = /^[0-9a-f]{64}$/;

export const cacheKey = (url: string): string =>
  createHash('sha256').update(url, 'utf8').digest('hex');

export class ImageCache {
  private real: Promise<string> | null = null;

  constructor(readonly dir: string) {}

  /** The cache folder's real path (created on first use). */
  root(): Promise<string> {
    this.real ??= mkdir(this.dir, { recursive: true }).then(() => realpath(this.dir));
    return this.real.catch((e: unknown) => {
      this.real = null;
      throw e;
    });
  }

  /** The cached file and its record, if both are there and agree. */
  async get(url: string): Promise<{ path: string; record: CacheRecord } | null> {
    const root = await this.root();
    const key = cacheKey(url);
    const path = join(root, key);
    try {
      const record = JSON.parse(await readFile(`${path}.json`, 'utf8')) as CacheRecord;
      const st = await stat(path);
      if (!st.isFile() || st.size !== record.size) return null;
      return { path, record };
    } catch {
      return null;
    }
  }

  async put(url: string, bytes: Uint8Array, info: ImageInfo, fetchedAt: string): Promise<string> {
    const root = await this.root();
    const path = join(root, cacheKey(url));
    const record: CacheRecord = {
      type: info.type,
      size: bytes.byteLength,
      width: info.width,
      height: info.height,
      fetchedAt,
    };
    const tmp = `.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(join(root, tmp), bytes);
    await rename(join(root, tmp), path);
    await writeFile(join(root, tmp), JSON.stringify(record));
    await rename(join(root, tmp), `${path}.json`);
    return path;
  }

  /** Images in the cache and their total size in bytes. */
  async usage(): Promise<{ images: number; bytes: number }> {
    let images = 0;
    let bytes = 0;
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return { images, bytes };
    }
    for (const n of names) {
      const st = await stat(join(this.dir, n)).catch(() => null);
      if (!st?.isFile()) continue;
      bytes += st.size;
      if (HEX.test(n)) images += 1;
    }
    return { images, bytes };
  }

  /** Removes every cached image (the folder stays). */
  async clear(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    await Promise.all(names.map((n) => rm(join(this.dir, n), { force: true, recursive: true })));
  }
}

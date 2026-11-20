/**
 * Rescans while the Library page is open (SPEC §15.1): `fs.watch` on each
 * folder, debounced; if watching a folder fails, a full rescan, and the
 * watch is tried again later.
 */
import { watch } from 'node:fs';

export interface WatchHandle {
  close(): void;
}

/** Watches `path` recursively; `onChange` for any change, `onError` if watching fails. */
export type WatchFn = (
  path: string,
  onChange: () => void,
  onError: (e: unknown) => void,
) => WatchHandle;

export const fsWatch: WatchFn = (path, onChange, onError) => {
  const w = watch(path, { recursive: true, persistent: false }, () => onChange());
  w.on('error', onError);
  return { close: () => w.close() };
};

export interface WatchOptions {
  folders: () => { id: string; path: string }[];
  /** Rescan (the service serialises scans). */
  rescan: () => Promise<void>;
  /** After each rescan this watcher started. */
  onScanned: () => void;
  watch?: WatchFn;
  debounceMs?: number;
  retryMs?: number;
  log?: (message: string) => void;
}

/** Starts watching; call the result to stop. Call `reset()` when the folder list changes. */
export function watchFolders(o: WatchOptions): { stop(): void; reset(): void } {
  const watchFn = o.watch ?? fsWatch;
  const debounceMs = o.debounceMs ?? 500;
  const retryMs = o.retryMs ?? 10_000;
  const handles = new Map<string, WatchHandle>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const rescanNow = (): void => {
    if (stopped) return;
    void o.rescan().then(
      () => !stopped && o.onScanned(),
      (e: unknown) => o.log?.(`library: rescan failed: ${String(e)}`),
    );
  };
  const schedule = (): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      rescanNow();
    }, debounceMs);
  };

  const start = (id: string, path: string): void => {
    const failed = (e: unknown): void => {
      handles.get(id)?.close();
      handles.delete(id);
      o.log?.(`library: watching ${id} failed (${String(e)}); rescanning`);
      rescanNow();
      if (stopped || retries.has(id)) return;
      retries.set(
        id,
        setTimeout(() => {
          retries.delete(id);
          const f = o.folders().find((x) => x.id === id);
          if (f && !stopped && !handles.has(id)) start(f.id, f.path);
        }, retryMs),
      );
    };
    try {
      handles.set(id, watchFn(path, schedule, failed));
    } catch (e) {
      failed(e);
    }
  };

  const reset = (): void => {
    for (const h of handles.values()) h.close();
    handles.clear();
    for (const t of retries.values()) clearTimeout(t);
    retries.clear();
    for (const f of o.folders()) start(f.id, f.path);
  };

  reset();
  return {
    reset,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const t of retries.values()) clearTimeout(t);
      for (const h of handles.values()) h.close();
      handles.clear();
    },
  };
}

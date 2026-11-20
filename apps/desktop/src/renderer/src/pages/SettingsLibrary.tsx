/**
 * Settings → Library (SPEC §15.6, T21): the folders the Library reads. The
 * folder picker is the OS's, shown by main; this page sees folder ids and
 * names, never paths. Removing a folder asks first and drops only the
 * app's index of it, never its files.
 */
import { useEffect, useRef, useState } from 'react';
import type { FolderView, OfflineProgress } from '../../../shared/library';
import { invoke, stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Linked images (T23, SPEC §15.4): when they download, the cache's size and
 * Clear. Downloads happen in main; this page sees counts only.
 */
function LinkedImagesSettings() {
  const app = useApp();
  const mode = app.settings?.settings.library.images;
  const [usage, setUsage] = useState<{ images: number; bytes: number } | null>(null);

  useEffect(() => {
    let live = true;
    void invoke('library:image-cache').then(
      (u) => live && setUsage(u),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  async function clear(): Promise<void> {
    try {
      setUsage(await invoke('library:clear-image-cache'));
    } catch (err) {
      app.notify(errorText(err), 'error');
    }
  }

  return (
    <div className="linked-images" data-testid="linked-images">
      <label>
        Images an article links to{' '}
        <select
          value={mode ?? 'on-open'}
          disabled={!mode}
          onChange={(e) =>
            void app.updateSettings({
              library: { images: e.target.value === 'ask' ? 'ask' : 'on-open' },
            })
          }
        >
          <option value="on-open">Download when the article opens</option>
          <option value="ask">Ask first (Load images)</option>
        </select>
      </label>
      <p className="small muted">
        The app downloads them itself, once, and keeps a copy so articles work offline. Websites
        never see what you read after that.
      </p>
      <p className="small" data-testid="image-cache">
        {usage
          ? `Image cache: ${plural(usage.images, 'image')}, ${formatBytes(usage.bytes)}.`
          : 'Image cache: …'}{' '}
        <button type="button" disabled={!usage || usage.images === 0} onClick={() => void clear()}>
          Clear
        </button>
      </p>
    </div>
  );
}

export function LibrarySection() {
  const app = useApp();
  const [folders, setFolders] = useState<FolderView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [offline, setOffline] = useState<{
    id: string;
    progress: OfflineProgress | null;
    finished: boolean;
    cancelled: boolean;
  } | null>(null);
  const offlineStream = useRef<{ cancel(): void } | null>(null);

  // Leaving Settings stops a download in progress.
  useEffect(
    () => () => {
      const s = offlineStream.current;
      offlineStream.current = null;
      s?.cancel();
    },
    [],
  );

  function makeOffline(id: string): void {
    const previous = offlineStream.current;
    offlineStream.current = null;
    previous?.cancel();
    setOffline({ id, progress: null, finished: false, cancelled: false });
    const s = stream('library:offline', { id }, (progress) =>
      setOffline((o) => (o?.id === id ? { ...o, progress } : o)),
    );
    offlineStream.current = s;
    s.result.then(
      (r) =>
        setOffline((o) =>
          o?.id === id ? { ...o, progress: r, finished: true, cancelled: r.cancelled } : o,
        ),
      (err: unknown) => {
        // Cancelled here (or Settings closed): already shown as stopped.
        if (offlineStream.current !== s) return;
        offlineStream.current = null;
        setOffline((o) => (o?.id === id ? null : o));
        app.notify(errorText(err), 'error');
      },
    );
  }

  function cancelOffline(): void {
    const s = offlineStream.current;
    offlineStream.current = null;
    s?.cancel();
    setOffline((o) => (o ? { ...o, finished: true, cancelled: true } : o));
  }

  useEffect(() => {
    let live = true;
    void invoke('library:folders').then(
      (r) => live && setFolders(r.folders),
      () => live && setFolders([]),
    );
    return () => {
      live = false;
    };
  }, []);

  async function run(fn: () => Promise<FolderView[] | null>): Promise<void> {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setFolders(next);
    } catch (err) {
      app.notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(async () => {
      const r = await invoke('library:add-folder');
      return r.added ? r.folders : null;
    });
  const remove = (id: string) =>
    run(async () => {
      setConfirming(null);
      return (await invoke('library:remove-folder', { id })).folders;
    });
  const open = (id: string) =>
    run(async () => {
      await invoke('library:open-folder', { id });
      return null;
    });

  return (
    <section className="card" aria-labelledby="settings-library">
      <h2 id="settings-library">Library</h2>
      <p className="small" data-testid="library-read-only">
        The app reads these folders and never changes them.
      </p>
      {folders !== null && folders.length === 0 && (
        <p className="muted" data-testid="library-empty">
          No folders yet. Add a folder of Markdown notes, such as an Obsidian vault or its Clippings
          folder.
        </p>
      )}
      {folders !== null && folders.length > 0 && (
        <ul className="library-folders" aria-label="Library folders">
          {folders.map((f) => (
            <li key={f.id} data-testid={`library-folder-${f.id}`}>
              <strong>{f.name}</strong>{' '}
              <span className="small muted">
                {plural(f.articles, 'article')}
                {f.missing > 0 && `, ${f.missing} file${f.missing === 1 ? '' : 's'} missing`}
              </span>
              {f.error && (
                <p className="small warning" role="status">
                  {f.error}
                </p>
              )}
              {confirming === f.id ? (
                <div className="actions" role="group" aria-label={`Remove ${f.name}?`}>
                  <span className="small">
                    Remove “{f.name}” from the library? Its files are not touched.
                  </span>
                  <button type="button" disabled={busy} onClick={() => void remove(f.id)}>
                    Remove
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="actions">
                  <button type="button" disabled={busy} onClick={() => void open(f.id)}>
                    Open in file manager
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirming(f.id)}>
                    Remove…
                  </button>
                  {offline?.id === f.id && !offline.finished ? (
                    <button type="button" onClick={cancelOffline}>
                      Cancel download
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => makeOffline(f.id)}>
                      Make available offline
                    </button>
                  )}
                </div>
              )}
              {offline?.id === f.id && (
                <p className="small" role="status" data-testid={`offline-${f.id}`}>
                  {offline.progress
                    ? `${offline.cancelled ? 'Stopped' : offline.finished ? 'Done' : 'Downloading images'}: ` +
                      `${offline.progress.done} of ${plural(offline.progress.total, 'article')}` +
                      (offline.progress.failed > 0
                        ? `, ${plural(offline.progress.failed, 'image')} could not be loaded`
                        : '')
                    : 'Starting…'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => void add()}>
          Add folder…
        </button>
      </div>
      <LinkedImagesSettings />
    </section>
  );
}

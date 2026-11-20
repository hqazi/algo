/**
 * Settings → Library (SPEC §15.6, T21): the folders the Library reads. The
 * folder picker is the OS's, shown by main; this page sees folder ids and
 * names, never paths. Removing a folder asks first and drops only the
 * app's index of it, never its files.
 */
import { useEffect, useState } from 'react';
import type { FolderView } from '../../../shared/library';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function LibrarySection() {
  const app = useApp();
  const [folders, setFolders] = useState<FolderView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

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
                </div>
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
    </section>
  );
}
